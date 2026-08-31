'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StepIndicator } from '@/components/step-indicator';
import { ExaminerAvatar } from '@/components/examiner-avatar';
import { getExaminerPortrait } from '@/lib/examiner-portraits';
import { addPracticeTranscript, updatePracticeTranscriptAnswer, getSession, getUsedQuestionIds } from '@/lib/store/interview-session';
import { examiners } from '@/lib/mock/data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PracticeQuestion {
  questionId: string;
  topic: string;
  question: string;
  followUp: string;
  contextHint: string;
}

interface PracticeFeedback {
  positive: string;
  improve: string;
  tryNext: string;
}

type Phase =
  | 'loading'
  | 'intro'
  | 'question'
  | 'recording'
  | 'feedback'
  | 'retry'
  | 'followup'
  | 'followup-recording'
  | 'followup-feedback'
  | 'finished';

type ProcessingStage = 'idle' | 'recording' | 'stt' | 'feedback';

// Seconds the question stays on screen before recording starts
const READING_SECONDS = 6;

// Pick the best audio format the current browser supports for MediaRecorder
function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return undefined;
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function filenameForMimeType(mimeType: string | undefined): string {
  if (!mimeType) return 'recording.webm';
  if (mimeType.includes('mp4')) return 'recording.mp4';
  if (mimeType.includes('ogg')) return 'recording.ogg';
  if (mimeType.includes('wav')) return 'recording.wav';
  return 'recording.webm';
}

// Upload recorded audio to the backend STT endpoint
async function transcribeAudio(blob: Blob | null): Promise<string> {
  if (!blob || blob.size === 0) {
    console.error('STT skipped: recorded blob is empty');
    return '[No speech detected]';
  }
  try {
    const formData = new FormData();
    formData.append('audio', blob, filenameForMimeType(blob.type));
    const res = await fetch('/api/stt', { method: 'POST', body: formData });
    const data = await res.json();

    if (typeof data.transcript === 'string' && data.transcript.trim().length > 0) {
      return data.transcript.trim();
    }

    console.error('STT request failed:', res.status, data);
    return '[Transcription error]';
  } catch (err) {
    console.error('STT request failed:', err);
    return '[Transcription failed]';
  }
}

// Fetch practice feedback from the API
async function fetchPracticeFeedback(params: {
  question: string;
  answer: string;
  weakness?: string;
  improvementFocus?: string;
}): Promise<PracticeFeedback | null> {
  try {
    const res = await fetch('/api/practice-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (data.positive && data.improve && data.tryNext) {
      return { positive: data.positive, improve: data.improve, tryNext: data.tryNext };
    }
    return null;
  } catch (err) {
    console.error('Failed to fetch practice feedback:', err);
    return null;
  }
}

// Fetch TTS audio URL
async function fetchTtsAudio(text: string, gender: 'male' | 'female'): Promise<string | null> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, gender }),
    });
    const data = await res.json();
    return data.audioUrl || null;
  } catch (err) {
    console.error('TTS request failed:', err);
    return null;
  }
}

export default function PracticePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [examinerPortrait, setExaminerPortrait] = useState<string>('');
  const [examinerName, setExaminerName] = useState<string>('');
  const [examinerGender, setExaminerGender] = useState<'male' | 'female'>('female');
  const [currentQ, setCurrentQ] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [readCountdown, setReadCountdown] = useState(READING_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>('idle');
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const [lastAnswer, setLastAnswer] = useState<string>('');
  const [isFollowUp, setIsFollowUp] = useState(false);

  // TTS state
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<'loading' | 'playing' | 'unavailable'>('loading');
  const [showQuestionText, setShowQuestionText] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsCacheRef = useRef<Map<string, string>>(new Map());
  const ttsLoadingRef = useRef<Set<string>>(new Set());

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef<string | undefined>(undefined);
  const pendingTranscriptionsRef = useRef<Promise<void>[]>([]);

  // Race condition protection
  const hasLoadedQuestionsRef = useRef(false);
  const feedbackSeqRef = useRef(0);
  const isProcessingRef = useRef(false);

  const question = questions[currentQ];

  // Evaluation data for feedback personalization
  const [evaluationData, setEvaluationData] = useState<{
    weakness?: string;
    improvementFocus?: string;
  }>({});

  // Fetch targeted practice questions based on evaluation results
  useEffect(() => {
    if (hasLoadedQuestionsRef.current) return;
    hasLoadedQuestionsRef.current = true;

    async function loadPracticeQuestions() {
      const session = getSession();
      if (!session) {
        setLoadError('No session found. Please complete an interview first.');
        return;
      }

      const examiner = examiners.find((e) => e.id === session.examinerId);
      if (examiner) {
        setExaminerPortrait(getExaminerPortrait(examiner.id));
        setExaminerName(examiner.name);
        setExaminerGender(examiner.gender === 'Male' ? 'male' : 'female');
      }

      try {
        // Get evaluation data from localStorage
        let evalData: { weakness?: string; improvementFocus?: string; criteriaScores?: Record<string, { band: number }> } = {};
        try {
          const stored = localStorage.getItem('speakloop_last_evaluation');
          if (stored) {
            evalData = JSON.parse(stored);
            setEvaluationData({ weakness: evalData.weakness, improvementFocus: evalData.improvementFocus });
          }
        } catch {
          // No evaluation data available
        }

        const res = await fetch('/api/practice-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            weakness: evalData.weakness,
            improvementFocus: evalData.improvementFocus,
            criteriaScores: evalData.criteriaScores,
            personality: examiner?.personality || session.personality || 'Friendly',
            difficulty: examiner?.difficulty || session.difficulty || 'Standard',
            excludeQuestionIds: getUsedQuestionIds(),
          }),
        });

        const data = await res.json();

        if (data.error || !data.questions || data.questions.length === 0) {
          setLoadError(data.error || 'Failed to load practice questions.');
          return;
        }

        setQuestions(data.questions);
        setPhase('intro');

        // Preload TTS for the first question
        if (data.questions.length > 0) {
          preloadTts(data.questions[0].question, 0, 'main');
        }
      } catch (err) {
        console.error('Failed to load practice questions:', err);
        setLoadError('Failed to connect to the server. Please try again.');
      }
    }

    loadPracticeQuestions();
  }, []);

  // Preload TTS for a question
  const preloadTts = useCallback(async (text: string, questionIndex: number, type: 'main' | 'followup') => {
    const cacheKey = `${questionIndex}-${type}`;
    if (ttsCacheRef.current.has(cacheKey) || ttsLoadingRef.current.has(cacheKey)) {
      return;
    }
    ttsLoadingRef.current.add(cacheKey);
    try {
      const audioUrl = await fetchTtsAudio(text, examinerGender);
      if (audioUrl) {
        ttsCacheRef.current.set(cacheKey, audioUrl);
      }
    } catch (err) {
      console.error('TTS preload failed:', err);
    } finally {
      ttsLoadingRef.current.delete(cacheKey);
    }
  }, [examinerGender]);

  // Play TTS audio for a question
  const speakQuestion = useCallback(async (text: string, questionIndex: number, type: 'main' | 'followup') => {
    const cacheKey = `${questionIndex}-${type}`;
    let audioUrl: string | null | undefined = ttsCacheRef.current.get(cacheKey);

    if (!audioUrl) {
      // Not cached, fetch now
      setSpeechStatus('loading');
      audioUrl = await fetchTtsAudio(text, examinerGender);
      if (audioUrl) {
        ttsCacheRef.current.set(cacheKey, audioUrl);
      }
    }

    if (audioUrl) {
      setTtsAudioUrl(audioUrl);
      setIsTtsPlaying(true);
      setSpeechStatus('playing');

      // Use the hidden audio element
      const audio = questionAudioRef.current;
      if (audio) {
        audio.src = audioUrl;
        audio.play().catch(() => {
          setIsTtsPlaying(false);
          setSpeechStatus('unavailable');
          setShowQuestionText(true);
        });
      }
    } else {
      setSpeechStatus('unavailable');
      setShowQuestionText(true);
    }
  }, [examinerGender]);

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // Clean up mic stream and audio on unmount
  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      ttsAudioRef.current?.pause();
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = pickSupportedMimeType();
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordedMimeTypeRef.current = mediaRecorder.mimeType || mimeType;
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setElapsed(0);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, []);

  // Stop recording and collect audio
  const stopAndCollectAudio = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      const actualType = recordedMimeTypeRef.current || 'audio/webm';
      if (!recorder || recorder.state !== 'recording') {
        resolve(audioChunksRef.current.length > 0 ? new Blob(audioChunksRef.current, { type: actualType }) : null);
        return;
      }
      recorder.onstop = () => {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        resolve(new Blob(audioChunksRef.current, { type: actualType }));
      };
      recorder.stop();
    });
  }, []);

  // Reading countdown (only used when TTS is unavailable)
  useEffect(() => {
    if (phase !== 'question' && phase !== 'followup') return;
    if (speechStatus !== 'unavailable') return; // Only countdown when TTS unavailable
    if (readCountdown <= 0) return;
    const timer = setTimeout(() => setReadCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, readCountdown, speechStatus]);

  // Start recording when countdown finishes (only when TTS unavailable)
  useEffect(() => {
    if (readCountdown !== 0) return;
    if (speechStatus !== 'unavailable') return; // Only start recording after countdown when TTS unavailable
    if (phase === 'question') {
      startRecording();
      setPhase('recording');
    } else if (phase === 'followup') {
      startRecording();
      setPhase('followup-recording');
    }
  }, [readCountdown, phase, startRecording, speechStatus]);

  // Play TTS when entering question phase
  useEffect(() => {
    if ((phase === 'question' || phase === 'followup') && question) {
      setShowQuestionText(false);
      setSpeechStatus('loading');
      setReadCountdown(READING_SECONDS);
      const text = phase === 'question' ? question.question : question.followUp;
      const type = phase === 'question' ? 'main' : 'followup';
      speakQuestion(text, currentQ, type);
    }
  }, [phase, question, currentQ, speakQuestion]);

  // Handle TTS audio ended - start recording
  const handleQuestionAudioEnded = useCallback(() => {
    setIsTtsPlaying(false);
    if (phase === 'question') {
      startRecording();
      setPhase('recording');
    } else if (phase === 'followup') {
      startRecording();
      setPhase('followup-recording');
    }
  }, [phase, startRecording]);

  // Preload next question's TTS when entering a new question
  useEffect(() => {
    if (phase === 'intro' && questions.length > 0) {
      preloadTts(questions[0].question, 0, 'main');
    }
  }, [phase, questions, preloadTts]);

  // Preload follow-up TTS when recording main answer
  useEffect(() => {
    if (phase === 'recording' && question) {
      preloadTts(question.followUp, currentQ, 'followup');
    }
  }, [phase, question, currentQ, preloadTts]);

  // Preload next question's TTS when showing feedback
  useEffect(() => {
    if (phase === 'feedback' && !isFollowUp && question) {
      // Preload follow-up for this question
      preloadTts(question.followUp, currentQ, 'followup');
    }
    if (phase === 'followup-feedback' && question && currentQ < questions.length - 1) {
      // Preload next question
      preloadTts(questions[currentQ + 1].question, currentQ + 1, 'main');
    }
  }, [phase, isFollowUp, question, currentQ, questions, preloadTts]);

  const handleStartPractice = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
      setReadCountdown(READING_SECONDS);
      setPhase('question');
    } catch {
      alert('Microphone access is required for practice. Please allow microphone access and try again.');
    }
  };

  // Process answer: STT -> Feedback
  const processAnswer = useCallback(async (answerText: string, questionText: string, isFollowUpAnswer: boolean) => {
    const seq = ++feedbackSeqRef.current;
    setProcessingStage('stt');

    // STT is already done at this point, answerText is the transcript
    // Now get feedback
    setProcessingStage('feedback');

    const feedbackResult = await fetchPracticeFeedback({
      question: questionText,
      answer: answerText,
      weakness: evaluationData.weakness,
      improvementFocus: evaluationData.improvementFocus,
    });

    // Check if this is still the current request (race condition protection)
    if (feedbackSeqRef.current !== seq) return;

    if (feedbackResult) {
      setFeedback(feedbackResult);
      setLastAnswer(answerText);
      setIsFollowUp(isFollowUpAnswer);
      setPhase(isFollowUpAnswer ? 'followup-feedback' : 'feedback');
    } else {
      // Feedback failed, move to next question
      if (isFollowUpAnswer) {
        if (currentQ < questions.length - 1) {
          setCurrentQ((prev) => prev + 1);
          setReadCountdown(READING_SECONDS);
          setPhase('question');
        } else {
          setPhase('finished');
        }
      } else {
        setReadCountdown(READING_SECONDS);
        setPhase('followup');
      }
    }

    setProcessingStage('idle');
  }, [evaluationData, currentQ, questions.length]);

  // Finish answer (main or follow-up)
  const finishAnswer = useCallback(async (isFollowUpAnswer: boolean) => {
    if (isStopping || isProcessingRef.current || questions.length === 0) return;
    isProcessingRef.current = true;
    setIsStopping(true);
    setIsRecording(false);
    setProcessingStage('recording');

    const audioBlob = await stopAndCollectAudio();
    setElapsed(0);

    const currentQuestion = questions[currentQ];
    const questionText = isFollowUpAnswer ? currentQuestion.followUp : currentQuestion.question;

    // Save transcript placeholder
    const index = addPracticeTranscript({
      question: questionText,
      questionType: isFollowUpAnswer ? 'followup' : 'main',
      answer: '',
    });

    // Transcribe audio
    setProcessingStage('stt');
    const transcript = await transcribeAudio(audioBlob);
    updatePracticeTranscriptAnswer(index, transcript);
    pendingTranscriptionsRef.current.push(Promise.resolve());

    // Process feedback
    await processAnswer(transcript, questionText, isFollowUpAnswer);

    setIsStopping(false);
    isProcessingRef.current = false;
  }, [currentQ, isStopping, questions, stopAndCollectAudio, processAnswer]);

  const handleFinishMainAnswer = () => finishAnswer(false);
  const handleFinishFollowUp = () => finishAnswer(true);

  // Handle retry
  const handleRetry = () => {
    setFeedback(null);
    setLastAnswer('');
    setReadCountdown(READING_SECONDS);
    setPhase(isFollowUp ? 'followup' : 'question');
  };

  // Continue to next phase after feedback
  const handleContinue = () => {
    setFeedback(null);
    setLastAnswer('');

    if (isFollowUp) {
      // Move to next question or finish
      if (currentQ < questions.length - 1) {
        setCurrentQ((prev) => prev + 1);
        setReadCountdown(READING_SECONDS);
        setPhase('question');
      } else {
        setPhase('finished');
      }
    } else {
      // Move to follow-up
      setReadCountdown(READING_SECONDS);
      setPhase('followup');
    }
  };

  const handleStartAnswering = () => {
    setReadCountdown(0);
  };

  // Go to final evaluation
  const handleGoToFinalEvaluation = async () => {
    if (pendingTranscriptionsRef.current.length > 0) {
      setIsFinalizing(true);
      await Promise.all(pendingTranscriptionsRef.current);
      setIsFinalizing(false);
    }
    router.push('/final-evaluation');
  };

  // Get status text based on processing stage
  const getStatusText = () => {
    switch (processingStage) {
      case 'recording':
        return 'Processing your answer...';
      case 'stt':
        return 'Transcribing your answer...';
      case 'feedback':
        return 'Preparing feedback...';
      default:
        return '';
    }
  };

  return (
    <div className="min-h-screen bg-white pb-32">
      {/* Hidden audio element for TTS playback */}
      <audio
        ref={questionAudioRef}
        onEnded={handleQuestionAudioEnded}
        onError={() => {
          setSpeechStatus('unavailable');
          setShowQuestionText(true);
        }}
        className="hidden"
      />

      {/* Header */}
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#DA291C]">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-slate-500">SpeakLoop</span>
          </Link>
          <StepIndicator />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {/* Loading State */}
        {phase === 'loading' && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-slate-500 text-sm">Preparing targeted practice questions...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {loadError && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center max-w-md">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="text-slate-700 font-medium mb-2">{loadError}</p>
              <Link href="/" className="text-[#DA291C] text-sm font-medium hover:underline">
                ← Back to home
              </Link>
            </div>
          </div>
        )}

        {/* Intro Phase */}
        {phase === 'intro' && question && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-8">
              <h2 className="mb-6 text-lg font-semibold text-slate-900">
                Before You Begin
              </h2>
              <div className="space-y-5">
                <div className="flex gap-4">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#DA291C]/10 text-sm font-bold text-[#DA291C]">
                    1
                  </div>
                  <div>
                    <h3 className="mb-1 font-semibold text-slate-900">
                      Building on Your First Interview
                    </h3>
                    <p className="text-sm leading-relaxed text-slate-600">
                      This practice session is designed to address the weaknesses identified in your first interview.
                      The questions are similar but slightly different — focus on applying the improvements suggested
                      in your evaluation.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#DA291C]/10 text-sm font-bold text-[#DA291C]">
                    2
                  </div>
                  <div>
                    <h3 className="mb-1 font-semibold text-slate-900">
                      Focus Areas for This Round
                    </h3>
                    <p className="text-sm leading-relaxed text-slate-600">
                      Based on your evaluation, focus on: {question.contextHint}
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-bold text-emerald-600">
                    3
                  </div>
                  <div>
                    <h3 className="mb-1 font-semibold text-slate-900">
                      Get Instant Feedback
                    </h3>
                    <p className="text-sm leading-relaxed text-slate-600">
                      After each answer, you&apos;ll receive focused feedback and can retry to improve.
                      The examiner will also speak the questions aloud.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-center pt-4">
              <button
                onClick={handleStartPractice}
                className="rounded-xl bg-[#DA291C] px-10 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#DA291C]/20 transition-all hover:bg-[#B91C1C] hover:shadow-xl"
              >
                Start Practice →
              </button>
            </div>
          </div>
        )}

        {/* Feedback Phase */}
        {(phase === 'feedback' || phase === 'followup-feedback') && feedback && (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Practice Focus Badge */}
            <div className="flex items-center justify-center">
              <div className="rounded-full bg-amber-500/10 px-4 py-1.5">
                <span className="text-sm font-medium text-amber-700">
                  Practice Focus: {evaluationData.weakness || 'General Improvement'}
                </span>
              </div>
            </div>

            {/* Feedback Card */}
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Feedback</h3>

              <div className="space-y-4">
                {/* Positive */}
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white mt-0.5">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-emerald-700 mb-1">What went well</p>
                      <p className="text-sm text-emerald-800">{feedback.positive}</p>
                    </div>
                  </div>
                </div>

                {/* Improve */}
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-white mt-0.5">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-amber-700 mb-1">One thing to improve</p>
                      <p className="text-sm text-amber-800">{feedback.improve}</p>
                    </div>
                  </div>
                </div>

                {/* Try Next */}
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 text-white mt-0.5">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-blue-700 mb-1">Try this next</p>
                      <p className="text-sm text-blue-800">{feedback.tryNext}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={handleRetry}
                className="rounded-xl bg-slate-100 px-6 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-200"
              >
                Try Again
              </button>
              <button
                onClick={handleContinue}
                className="rounded-xl bg-[#DA291C] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#DA291C]/20 transition-all hover:bg-[#B91C1C] hover:shadow-xl"
              >
                {isFollowUp
                  ? (currentQ < questions.length - 1 ? 'Next Question →' : 'Finish Practice')
                  : 'Continue to Follow-up →'}
              </button>
            </div>
          </div>
        )}

        {/* Finished State */}
        {phase === 'finished' && (
          <div className="py-20 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50">
              <svg className="h-10 w-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="mb-3 text-2xl font-bold text-slate-900">
              Practice Complete!
            </h2>
            <p className="mb-8 text-slate-500">
              Great job applying the feedback from your first interview. Ready to see your final evaluation?
            </p>
            <button
              onClick={handleGoToFinalEvaluation}
              disabled={isFinalizing}
              className="rounded-xl bg-[#DA291C] px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#DA291C]/20 transition-all hover:bg-[#B91C1C] hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isFinalizing ? 'Finalizing...' : 'View Final Evaluation →'}
            </button>
          </div>
        )}

        {/* Practice Session - Question/Recording phases */}
        {(phase === 'question' || phase === 'recording' || phase === 'followup' || phase === 'followup-recording') && question && (
          <>
            {/* Status Bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {isRecording && (
                  <>
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                    <span className="text-sm text-slate-500">Recording in progress...</span>
                  </>
                )}
                {processingStage !== 'idle' && (
                  <span className="text-sm text-amber-600">{getStatusText()}</span>
                )}
                {!isRecording && processingStage === 'idle' && (phase === 'question' || phase === 'followup') && (
                  <span className="text-sm text-slate-400">Read the question…</span>
                )}
              </div>
              {isRecording && (
                <div className="text-sm text-slate-500 tabular-nums">
                  {formatTime(elapsed)}
                </div>
              )}
            </div>

            {/* Examiner Video Area */}
            <div className="relative w-full aspect-video bg-slate-900 rounded-2xl overflow-hidden shadow-lg">
              <ExaminerAvatar
                src={examinerPortrait}
                name={examinerName}
                phase={phase}
              />

              {/* Recording Indicator Overlay */}
              {isRecording && (
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                  <span className="text-white text-xs tabular-nums">{formatTime(elapsed)}</span>
                </div>
              )}

              {/* Practice Mode Indicator */}
              <div className="absolute top-4 left-4 rounded-full bg-amber-500/20 px-3 py-1">
                <span className="text-xs font-medium text-amber-400">PRACTICE</span>
              </div>

              {/* Question phase — TTS plays, text hidden unless unavailable */}
              {(phase === 'question' || phase === 'followup') && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-6">
                  <div className="max-w-2xl text-center">
                    <p className="text-white/60 text-xs uppercase tracking-wide mb-3">
                      {phase === 'question' ? `Question ${currentQ + 1}` : 'Follow-up'}
                    </p>

                    {speechStatus === 'loading' && (
                      <p className="text-white/90 text-base font-medium">Examiner is about to speak…</p>
                    )}

                    {speechStatus === 'playing' && (
                      <>
                        <div className="flex items-end justify-center gap-1 mb-3 h-6">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <span
                              key={i}
                              className="w-1 bg-white/80 rounded-full animate-pulse"
                              style={{ height: `${10 + ((i * 7) % 14)}px`, animationDelay: `${i * 0.12}s` }}
                            />
                          ))}
                        </div>
                        <p className="text-white/90 text-base font-medium">Listen to the examiner…</p>
                      </>
                    )}

                    {speechStatus === 'unavailable' && (
                      <>
                        <p className="text-white text-lg sm:text-xl font-medium leading-relaxed drop-shadow">
                          {phase === 'question' ? question.question : question.followUp}
                        </p>
                        <p className="text-amber-300/90 text-xs mt-4">
                          Examiner audio unavailable — read the question instead.
                        </p>
                        <p className="text-white/70 text-sm mt-2">
                          Recording starts in {readCountdown}s
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* "Didn't catch that?" — replay audio or reveal text */}
            {(phase === 'recording' || phase === 'followup-recording') && (
              <div className="mt-4 space-y-4">
                {phase === 'recording' && (
                  <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                    <p className="text-xs text-amber-800">
                      <span className="font-semibold">Focus area:</span> {question.contextHint}
                    </p>
                  </div>
                )}

                {!showQuestionText ? (
                  <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <p className="text-slate-500 text-sm">
                      Didn&apos;t catch that?{' '}
                      {ttsAudioUrl && (
                        <>
                          <button
                            onClick={() => {
                              const audio = questionAudioRef.current;
                              if (audio) {
                                audio.currentTime = 0;
                                audio.play().catch((err) => console.error('Replay failed:', err));
                              }
                            }}
                            className="text-[#DA291C] font-medium hover:underline"
                          >
                            Play again
                          </button>
                          {' · '}
                        </>
                      )}
                      <button
                        onClick={() => setShowQuestionText(true)}
                        className="text-[#DA291C] font-medium hover:underline"
                      >
                        View question text
                      </button>
                    </p>
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                      {phase === 'recording' ? 'Question' : 'Follow-up'}
                    </p>
                    <p className="text-slate-700 text-base leading-relaxed">
                      {phase === 'recording' ? question.question : question.followUp}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Progress Indicator */}
            <div className="mt-6 flex items-center justify-center gap-2">
              {questions.map((_, index) => (
                <div
                  key={index}
                  className={`h-1.5 rounded-full transition-all ${
                    index < currentQ
                      ? 'w-8 bg-emerald-500'
                      : index === currentQ
                      ? 'w-8 bg-amber-400'
                      : 'w-4 bg-slate-200'
                  }`}
                />
              ))}
            </div>
            <p className="text-center text-sm text-slate-400 mt-2">
              Question {currentQ + 1} of {questions.length}
            </p>
          </>
        )}
      </main>

      {/* Sticky action bar */}
      {(phase === 'question' || phase === 'followup' || phase === 'recording' || phase === 'followup-recording') && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-100 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="max-w-4xl mx-auto px-6 py-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
            {phase === 'question' || phase === 'followup' ? (
              <button
                onClick={handleStartAnswering}
                className="w-full py-3.5 bg-[#DA291C] text-white rounded-xl font-medium hover:bg-[#B91C1C] transition-colors"
              >
                Start Answering Now
              </button>
            ) : (
              <button
                onClick={phase === 'recording' ? handleFinishMainAnswer : handleFinishFollowUp}
                disabled={isStopping || processingStage !== 'idle'}
                className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {processingStage !== 'idle' ? getStatusText() : 'Finish Answer'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
