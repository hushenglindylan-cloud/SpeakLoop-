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
  difficulty: string;
  contextHint: string;
}

type Phase =
  | 'loading'
  | 'intro'
  | 'question'
  | 'recording'
  | 'finished';

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

// Fetch TTS audio URL.
// The gender is passed through exactly as the roster spells it ('Male' /
// 'Female'): /api/tts looks it up in a case-sensitive voice map, so lower-
// casing it here would make every request come back without audio.
async function fetchTtsAudio(text: string, gender: string): Promise<string | null> {
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
  const [examinerGender, setExaminerGender] = useState<string | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [readCountdown, setReadCountdown] = useState(READING_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  // True from the moment "Finish Answer" is clicked until the next question is
  // on screen. isProcessingRef is the synchronous re-entry guard against a
  // double click; this mirrors it for rendering.
  const [isSavingAnswer, setIsSavingAnswer] = useState(false);

  // TTS state
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<'loading' | 'playing' | 'unavailable'>('loading');
  const [showQuestionText, setShowQuestionText] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsCacheRef = useRef<Map<string, string>>(new Map());
  const ttsLoadingRef = useRef<Set<string>>(new Set());
  // Which question the examiner is currently speaking. Bumped when a new
  // question starts and when the student takes the turn, so audio that
  // finishes synthesising after either is dropped instead of played.
  const speechSeqRef = useRef(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef<string | undefined>(undefined);
  const pendingTranscriptionsRef = useRef<Promise<void>[]>([]);

  // Race condition protection
  const hasLoadedQuestionsRef = useRef(false);
  const isProcessingRef = useRef(false);

  const question = questions[currentQ];

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
        // Verbatim — see fetchTtsAudio.
        setExaminerGender(examiner.gender);
      }

      try {
        // Get evaluation data from localStorage
        let evalData: { weakness?: string; improvementFocus?: string; criteriaScores?: Record<string, { band: number }> } = {};
        try {
          const stored = localStorage.getItem('speakloop_last_evaluation');
          if (stored) {
            evalData = JSON.parse(stored);
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
        // The first question's audio is preloaded by the `phase === 'intro'`
        // effect below. Calling preloadTts here would run against the
        // mount-time closure, where the examiner's gender is still unknown.
      } catch (err) {
        console.error('Failed to load practice questions:', err);
        setLoadError('Failed to connect to the server. Please try again.');
      }
    }

    loadPracticeQuestions();
  }, []);

  // Preload TTS for a question
  const preloadTts = useCallback(async (text: string, questionIndex: number) => {
    if (!examinerGender) return;
    const cacheKey = String(questionIndex);
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

  // Speak a question aloud. Any failure — synthesis error, no voice for this
  // examiner, playback blocked by the browser — degrades to showing the text
  // with the reading countdown, so the student is never left with nothing.
  // `seq` is the speech generation this call belongs to: if the student skips
  // ahead while the audio is still being synthesised, the counter has moved on
  // and the finished audio is dropped rather than played over their answer.
  const speakQuestion = useCallback(async (text: string, questionIndex: number, seq: number) => {
    const fallbackToText = () => {
      setSpeechStatus('unavailable');
      setShowQuestionText(true);
    };

    if (!examinerGender) {
      fallbackToText();
      return;
    }

    const cacheKey = String(questionIndex);
    let audioUrl: string | null | undefined = ttsCacheRef.current.get(cacheKey);

    if (!audioUrl) {
      // Not cached, fetch now
      setSpeechStatus('loading');
      audioUrl = await fetchTtsAudio(text, examinerGender);
      if (audioUrl) {
        ttsCacheRef.current.set(cacheKey, audioUrl);
      }
    }

    // The student moved on while this was being synthesised.
    if (speechSeqRef.current !== seq) return;

    if (!audioUrl) {
      fallbackToText();
      return;
    }

    setTtsAudioUrl(audioUrl);

    // Use the hidden audio element
    const audio = questionAudioRef.current;
    if (!audio) {
      fallbackToText();
      return;
    }

    setIsTtsPlaying(true);
    setSpeechStatus('playing');
    audio.src = audioUrl;
    audio.play().catch(() => {
      setIsTtsPlaying(false);
      fallbackToText();
    });
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

  // Hand the turn to the student: open the microphone and move into the
  // matching recording phase. Bumping the speech counter cancels a question
  // still being synthesised so it cannot start talking mid-answer.
  const beginAnswering = useCallback(() => {
    speechSeqRef.current += 1;
    if (phase !== 'question') return;
    startRecording();
    setPhase('recording');
  }, [phase, startRecording]);

  // Reading countdown (only used when TTS is unavailable)
  useEffect(() => {
    if (phase !== 'question') return;
    if (speechStatus !== 'unavailable') return; // Only countdown when TTS unavailable
    if (readCountdown <= 0) return;
    const timer = setTimeout(() => setReadCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, readCountdown, speechStatus]);

  // Start recording when countdown finishes (only when TTS unavailable —
  // when the examiner can be heard, the audio ending is what opens the mic)
  useEffect(() => {
    if (readCountdown !== 0) return;
    if (speechStatus !== 'unavailable') return;
    beginAnswering();
  }, [readCountdown, speechStatus, beginAnswering]);

  // Play TTS when entering question phase
  useEffect(() => {
    if (phase === 'question' && question) {
      setShowQuestionText(false);
      setSpeechStatus('loading');
      // Drop the previous question's audio: until this one has been
      // synthesised there is nothing to replay, and "Play again" must never
      // offer the student the question before it.
      setTtsAudioUrl(null);
      setReadCountdown(READING_SECONDS);
      speakQuestion(question.question, currentQ, ++speechSeqRef.current);
    }
  }, [phase, question, currentQ, speakQuestion]);

  // The examiner finished speaking — the student's turn starts now. Guarded
  // by beginAnswering's phase check, so replaying the question while already
  // recording cannot restart the recorder.
  const handleQuestionAudioEnded = useCallback(() => {
    setIsTtsPlaying(false);
    beginAnswering();
  }, [beginAnswering]);

  // Preload the first question's audio while the student reads the intro
  useEffect(() => {
    if (phase === 'intro' && questions.length > 0) {
      preloadTts(questions[0].question, 0);
    }
  }, [phase, questions, preloadTts]);

  // Preload the next question while the student answers this one, so the
  // examiner can speak the moment they move on
  useEffect(() => {
    if (phase !== 'recording') return;
    const nextQ = currentQ + 1;
    if (nextQ >= questions.length) return;
    preloadTts(questions[nextQ].question, nextQ);
  }, [phase, currentQ, questions, preloadTts]);

  const handleStartPractice = async () => {
    // Browsers only allow programmatic audio playback once the page has had a
    // real user gesture, and Safari wants the element itself started inside
    // that gesture. Prime it here — synchronously, before the await below,
    // which would otherwise spend the gesture — so every later question plays
    // without another tap. Same approach as the interview page.
    const audio = questionAudioRef.current;
    if (audio) {
      audio.muted = true;
      audio.play().catch(() => {
        // Priming failed; speakQuestion still falls back to the text.
      });
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    }

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

  // Move to the next question, or end the session after the last one.
  const goToNextQuestion = useCallback(() => {
    if (currentQ < questions.length - 1) {
      setCurrentQ((prev) => prev + 1);
      setReadCountdown(READING_SECONDS);
      setPhase('question');
    } else {
      setPhase('finished');
    }
  }, [currentQ, questions.length]);

  // Finish the answer: stop recording, bank it, move on. Transcription runs in
  // the background — nothing in the practice session reads it, and
  // handleGoToFinalEvaluation waits for whatever is still in flight before the
  // final page analyses the answers.
  const finishAnswer = useCallback(async () => {
    if (isStopping || isProcessingRef.current || questions.length === 0) return;
    isProcessingRef.current = true;
    setIsSavingAnswer(true);
    setIsStopping(true);
    setIsRecording(false);

    try {
      const audioBlob = await stopAndCollectAudio();
      setElapsed(0);
      setIsStopping(false);

      // Reserve this answer's place in question order now; the transcript is
      // patched in when speech-to-text comes back.
      const index = addPracticeTranscript({
        question: questions[currentQ].question,
        questionType: 'main',
        answer: '',
      });

      pendingTranscriptionsRef.current.push(
        transcribeAudio(audioBlob).then((transcript) => {
          updatePracticeTranscriptAnswer(index, transcript);
        })
      );

      goToNextQuestion();
    } catch (err) {
      console.error('finishAnswer failed:', err);
      setIsStopping(false);
    } finally {
      setIsSavingAnswer(false);
      isProcessingRef.current = false;
    }
  }, [currentQ, isStopping, questions, stopAndCollectAudio, goToNextQuestion]);

  const handleFinishAnswer = () => finishAnswer();

  // "Start Answering Now" — cut the examiner off and take the turn. Stopping
  // the audio matters: left playing, the examiner's voice would carry on into
  // the microphone and end up in the transcript.
  const handleStartAnswering = () => {
    const audio = questionAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsTtsPlaying(false);
    beginAnswering();
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
                      Feedback Comes at the End
                    </h3>
                    <p className="text-sm leading-relaxed text-slate-600">
                      The examiner asks each question aloud and you answer straight through, with no
                      interruptions. Your feedback is written once all three answers are in, on the
                      final evaluation page, where it compares this session with your first interview.
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
        {(phase === 'question' || phase === 'recording') && question && (
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
                {isSavingAnswer && (
                  <span className="text-sm text-amber-600">Saving your answer…</span>
                )}
                {!isRecording && !isSavingAnswer && phase === 'question' && (
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
              {phase === 'question' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-6">
                  <div className="max-w-2xl text-center">
                    <p className="text-white/60 text-xs uppercase tracking-wide mb-3">
                      Question {currentQ + 1}
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
                          {question.question}
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
            {phase === 'recording' && (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                  <p className="text-xs text-amber-800">
                    <span className="font-semibold">Focus area:</span> {question.contextHint}
                  </p>
                </div>

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
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Question</p>
                    <p className="text-slate-700 text-base leading-relaxed">
                      {question.question}
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
      {(phase === 'question' || phase === 'recording') && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-100 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="max-w-4xl mx-auto px-6 py-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
            {phase === 'question' ? (
              <button
                onClick={handleStartAnswering}
                className="w-full py-3.5 bg-[#DA291C] text-white rounded-xl font-medium hover:bg-[#B91C1C] transition-colors"
              >
                Start Answering Now
              </button>
            ) : (
              <button
                onClick={handleFinishAnswer}
                disabled={isStopping || isSavingAnswer}
                className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingAnswer ? 'Saving your answer…' : 'Finish Answer'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
