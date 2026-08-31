'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StepIndicator } from '@/components/step-indicator';
import { ExaminerAvatar } from '@/components/examiner-avatar';
import { getExaminerPortrait } from '@/lib/examiner-portraits';
import { addTranscript, updateTranscriptAnswer, getSession, addUsedQuestionIds } from '@/lib/store/interview-session';
import { examiners } from '@/lib/mock/data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InterviewQuestion {
  questionId: string;
  topic: string;
  question: string;
  originalPrompt: string;
  questionType: string;
  difficulty: string;
}

type Phase = 'loading' | 'examiner-intro' | 'question' | 'recording' | 'followup' | 'followup-recording' | 'finished';

// Simple generic follow-ups (used as fallback when API is unavailable)
const fallbackFollowUps = [
  'Can you give a specific example to support your point?',
  'What about the opposite perspective — do you see any merit in it?',
  'How do you think this might change in the future?',
];

// Fallback only: when the examiner cannot be heard (synthesis failed, no voice
// for this examiner, playback blocked), the question is shown instead and this
// is how long the student gets to read it before the microphone opens.
const READING_SECONDS = 6;

// Pick the best audio format the current browser actually supports for
// MediaRecorder. Safari does not support webm at all (only mp4/aac), so we
// must detect this rather than hardcoding one format for every browser.
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

// Map a MediaRecorder mimeType to a sensible filename + extension so the
// backend receives a file whose name reflects how it was originally
// encoded. Kept as a debugging aid.
function filenameForMimeType(mimeType: string | undefined): string {
  if (!mimeType) return 'recording.webm';
  if (mimeType.includes('mp4')) return 'recording.mp4';
  if (mimeType.includes('ogg')) return 'recording.ogg';
  if (mimeType.includes('wav')) return 'recording.wav';
  return 'recording.webm';
}

// Upload recorded audio to the backend STT endpoint and return the transcript.
// Always resolves — falls back to a placeholder string if anything goes wrong,
// so a question is never silently dropped from the session.
async function transcribeAudio(blob: Blob | null): Promise<string> {
  if (!blob || blob.size === 0) {
    console.error('STT skipped: recorded blob is empty (client-side capture produced 0 bytes)');
    return '[No speech detected (client-empty-blob)]';
  }
  try {
    // Qwen3-ASR-Flash accepts audio in any common format (webm, mp4, ogg, wav).
    // No PCM conversion needed — send the raw recording directly.
    const formData = new FormData();
    formData.append('audio', blob, filenameForMimeType(blob.type));
    const res = await fetch('/api/stt', { method: 'POST', body: formData });
    const data = await res.json();

    if (typeof data.transcript === 'string' && data.transcript.trim().length > 0) {
      return data.transcript.trim();
    }

    // /api/stt always answers 200 with either a transcript or an `error`
    // field (see route.ts) — specifically so a hosting platform's gateway
    // can't quietly replace a non-2xx response body before it reaches us.
    console.error('STT request failed:', res.status, data);
    const stageSuffix = data?.stage ? ` (${data.stage})` : '';
    const detailSuffix = data?.detail ? ` — ${data.detail}` : '';
    return `[Transcription error: ${data?.error || (res.ok ? 'empty response from server' : `HTTP ${res.status}`)}${stageSuffix}${detailSuffix}]`;
  } catch (err) {
    console.error('STT request failed:', err);
    return '[Transcription failed — please check your connection]';
  }
}

export default function InterviewPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [examinerPortrait, setExaminerPortrait] = useState<string>('');
  const [examinerName, setExaminerName] = useState<string>('');
  const [currentQ, setCurrentQ] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  // True from the moment "Finish Answer" is clicked until the next question/
  // follow-up phase is actually on screen. isStopping alone isn't enough to
  // guard against a double click: it flips back to false as soon as the
  // MediaRecorder stops, but transcription + follow-up generation can still
  // take many seconds afterward, during which the button would otherwise be
  // re-enabled and a second click would submit the same answer twice.
  // isProcessingAnswerRef is the actual (synchronous) re-entry guard;
  // isProcessingAnswer just mirrors it for rendering.
  const isProcessingAnswerRef = useRef(false);
  const [isProcessingAnswer, setIsProcessingAnswer] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [readCountdown, setReadCountdown] = useState(READING_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef<string | undefined>(undefined);
  const pendingTranscriptionsRef = useRef<Promise<void>[]>([]);
  const [followUpText, setFollowUpText] = useState<string>('');

  // --- Examiner speech -----------------------------------------------------
  // The interview is a spoken exam: the examiner asks out loud and the question
  // text stays hidden unless the student asks for it. `speechStatus` drives
  // that — only when speech is 'unavailable' does the text appear on its own,
  // because a student who can neither hear nor read the question is stuck.
  const [speechStatus, setSpeechStatus] = useState<'idle' | 'loading' | 'playing' | 'unavailable'>('idle');
  const [showQuestionText, setShowQuestionText] = useState(false);
  const [examinerGender, setExaminerGender] = useState<string | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  // Which recording phase to enter once the examiner finishes speaking.
  const nextRecordingPhaseRef = useRef<'recording' | 'followup-recording'>('recording');
  // Whether audio is loaded for the current question, so "Play again" is only
  // offered when there is something to replay. State, not a ref: the button's
  // visibility depends on it.
  const [hasPlayableAudio, setHasPlayableAudio] = useState(false);

  // Fetch questions from RAG + LLM on mount. Single-flight: without the guard
  // this runs twice under dev StrictMode, which burns a second LLM selection,
  // lets the later response replace the questions already on screen, and
  // records both sets in usedQuestionIds — so Practice would then skip
  // questions the student was never actually asked.
  const hasLoadedQuestionsRef = useRef(false);

  useEffect(() => {
    if (hasLoadedQuestionsRef.current) return;
    hasLoadedQuestionsRef.current = true;

    async function loadQuestions() {
      const session = getSession();
      if (!session) {
        setLoadError('No session found. Please select an examiner first.');
        setPhase('examiner-intro');
        return;
      }

      const examiner = examiners.find((e) => e.id === session.examinerId);
      if (examiner) {
        setExaminerPortrait(getExaminerPortrait(examiner.id));
        setExaminerName(examiner.name);
        // The voice is chosen server-side from the examiner's gender.
        setExaminerGender(examiner.gender);
      }
      const excludeIds: string[] = [];

      try {
        const res = await fetch('/api/interview-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            examiner: examiner
              ? { personality: examiner.personality, difficulty: examiner.difficulty }
              : { personality: 'Friendly', difficulty: 'Standard' },
            excludeQuestionIds: excludeIds,
          }),
        });

        const data = await res.json();

        if (data.error || !data.questions || data.questions.length === 0) {
          setLoadError(data.error || 'Failed to load questions.');
          setPhase('examiner-intro');
          return;
        }

        setQuestions(data.questions);
        addUsedQuestionIds(data.questions.map((q: InterviewQuestion) => q.questionId));
        setPhase('examiner-intro');
      } catch (err) {
        console.error('Failed to load interview questions:', err);
        setLoadError('Failed to connect to the server. Please try again.');
        setPhase('examiner-intro');
      }
    }

    loadQuestions();
  }, []);

  // Timer for recording
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

  // Clean up mic stream on unmount
  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Start recording with the microphone (audio only, sent to backend STT on stop)
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

  // Stop the MediaRecorder and resolve with the final audio blob, tagged
  // with the format it was actually recorded in (critical for Safari, which
  // records mp4/aac rather than webm).
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

  // Speak a question aloud, then open the microphone when the audio ends.
  // Any failure — synthesis error, no voice for this examiner, a browser that
  // blocks playback — degrades to the readable fallback rather than leaving
  // the student with nothing: the text appears and the reading countdown runs.
  const speakQuestion = useCallback(
    async (text: string, nextPhase: 'recording' | 'followup-recording') => {
      nextRecordingPhaseRef.current = nextPhase;
      setShowQuestionText(false);
      setHasPlayableAudio(false);

      const fallbackToText = () => {
        setSpeechStatus('unavailable');
        setShowQuestionText(true);
        setReadCountdown(READING_SECONDS);
      };

      if (!examinerGender) {
        fallbackToText();
        return;
      }

      setSpeechStatus('loading');
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, gender: examinerGender }),
        });
        const data = await res.json();

        if (!data?.audioUrl) {
          console.error('TTS unavailable:', data);
          fallbackToText();
          return;
        }

        const audio = questionAudioRef.current;
        if (!audio) {
          fallbackToText();
          return;
        }

        setHasPlayableAudio(true);
        audio.src = data.audioUrl;
        setSpeechStatus('playing');
        await audio.play();
      } catch (err) {
        // Includes the autoplay rejection: if the browser refuses to play
        // without a gesture, reading the question is the only way forward.
        console.error('Examiner speech failed:', err);
        fallbackToText();
      }
    },
    [examinerGender]
  );

  const playQuestionAndRecord = useCallback(() => {
    isProcessingAnswerRef.current = false;
    setIsProcessingAnswer(false);
    setPhase('question');
  }, []);

  const playFollowUpAndRecord = useCallback(() => {
    isProcessingAnswerRef.current = false;
    setIsProcessingAnswer(false);
    setPhase('followup');
  }, []);

  // Speak each question once when its phase begins. The key stops the effect
  // from re-synthesising the same question on unrelated re-renders.
  const lastSpokenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (phase !== 'question' && phase !== 'followup') {
      lastSpokenKeyRef.current = null;
      return;
    }

    const text = phase === 'question'
      ? questions[currentQ]?.question
      : followUpText || fallbackFollowUps[currentQ % fallbackFollowUps.length];
    if (!text) return;

    const spokenKey = `${phase}:${currentQ}`;
    if (lastSpokenKeyRef.current === spokenKey) return;
    lastSpokenKeyRef.current = spokenKey;

    speakQuestion(text, phase === 'question' ? 'recording' : 'followup-recording');
  }, [phase, currentQ, questions, followUpText, speakQuestion]);

  // Reading countdown — only runs on the fallback path, when the examiner
  // could not be heard. When speech works, the audio ending starts recording.
  useEffect(() => {
    if (phase !== 'question' && phase !== 'followup') return;
    if (speechStatus !== 'unavailable') return;
    if (readCountdown <= 0) return;
    const timer = setTimeout(() => setReadCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, readCountdown, speechStatus]);

  // Countdown finished (or was skipped) — open the microphone.
  useEffect(() => {
    if (readCountdown !== 0) return;
    if (phase === 'question') {
      startRecording();
      setPhase('recording');
    } else if (phase === 'followup') {
      startRecording();
      setPhase('followup-recording');
    }
  }, [readCountdown, phase, startRecording]);

  // Stop recording and move on — for main answers, we wait for transcription
  // then call /api/follow-up to generate a contextual follow-up question.
  const stopRecordingAndSave = useCallback(async (isFollowUp: boolean) => {
    // isProcessingAnswerRef (not React state) is the real guard: it's read
    // and written synchronously, so a second click that lands before the
    // next render can't slip through the way a state-based check could.
    if (isProcessingAnswerRef.current || isStopping || questions.length === 0) return;
    isProcessingAnswerRef.current = true;
    setIsProcessingAnswer(true);
    setIsStopping(true);
    setIsRecording(false);

    // Releases the re-entry lock. Called on every exit path below, including
    // unexpected errors, so a failure never leaves the button permanently
    // disabled. playQuestionAndRecord/playFollowUpAndRecord also clear it
    // themselves for the normal-completion paths — calling it again here is
    // a harmless no-op in that case.
    const releaseLock = () => {
      isProcessingAnswerRef.current = false;
      setIsProcessingAnswer(false);
    };

    try {
      const audioBlob = await stopAndCollectAudio();
      setElapsed(0);
      setIsStopping(false);

      const currentQuestion = questions[currentQ];

      if (isFollowUp) {
        // Follow-up answer: save and move to next question or finish
        const index = addTranscript({
          question: followUpText || fallbackFollowUps[currentQ % fallbackFollowUps.length],
          questionType: 'followup',
          answer: '',
        });
        pendingTranscriptionsRef.current.push(
          transcribeAudio(audioBlob).then((transcript) => {
            updateTranscriptAnswer(index, transcript);
          })
        );

        if (currentQ < questions.length - 1) {
          setCurrentQ((prev) => prev + 1);
          setTimeout(() => {
            playQuestionAndRecord();
          }, 300);
        } else {
          releaseLock();
          setPhase('finished');
        }
      } else {
        // Main answer: transcribe first, then generate follow-up
        const index = addTranscript({
          question: currentQuestion.question,
          questionType: 'main',
          answer: '',
        });

        // Wait for transcription to complete so we can use it for follow-up
        const transcript = await transcribeAudio(audioBlob);
        updateTranscriptAnswer(index, transcript);

        // Generate contextual follow-up
        let followUp = fallbackFollowUps[currentQ % fallbackFollowUps.length];
        try {
          const session = getSession();
          const examiner = examiners.find((e) => e.id === session?.examinerId);
          const res = await fetch('/api/follow-up', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mainQuestion: currentQuestion.question,
              answer: transcript,
              topic: currentQuestion.topic,
              examinerPersonality: examiner?.personality,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.followUp) {
              followUp = data.followUp;
            }
          }
        } catch (err) {
          console.error('Follow-up generation failed, using fallback:', err);
        }

        setFollowUpText(followUp);
        setTimeout(() => {
          playFollowUpAndRecord();
        }, 300);
      }
    } catch (err) {
      // Unexpected failure somewhere in the stop/transcribe/follow-up chain —
      // release the lock so the student isn't stuck with a dead button.
      console.error('stopRecordingAndSave failed:', err);
      setIsStopping(false);
      releaseLock();
    }
  }, [currentQ, isStopping, questions, followUpText, playQuestionAndRecord, playFollowUpAndRecord, stopAndCollectAudio]);

  const handleStartQuestion = () => {
    // Browsers only allow programmatic audio playback once the page has had a
    // real user gesture. This click is that gesture, so prime the element here
    // — every later question then plays without another tap.
    const audio = questionAudioRef.current;
    if (audio) {
      audio.muted = true;
      audio.play().catch(() => {
        // Priming failed; speakQuestion still falls back to text if needed.
      });
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    }
    playQuestionAndRecord();
  };

  const handleFinishMainAnswer = () => {
    stopRecordingAndSave(false);
  };

  const handleFinishFollowUp = () => {
    stopRecordingAndSave(true);
  };

  // Skip the remaining reading time and start answering now (fallback path).
  const handleStartAnswering = () => {
    setReadCountdown(0);
  };

  // "Didn't catch that?" — replay the examiner's audio, or reveal the text.
  const handleReplayQuestion = () => {
    const audio = questionAudioRef.current;
    if (!audio || !hasPlayableAudio) return;
    audio.currentTime = 0;
    audio.play().catch((err) => console.error('Replay failed:', err));
  };

  const handleViewQuestionText = () => {
    setShowQuestionText(true);
  };

  // The examiner finished speaking — the student's turn starts now. Guarded on
  // phase because this also fires when the student replays the question while
  // already recording, which must not restart the recorder.
  const handleQuestionAudioEnded = () => {
    if (phase !== 'question' && phase !== 'followup') return;
    setSpeechStatus('idle');
    startRecording();
    setPhase(nextRecordingPhaseRef.current);
  };

  const handleQuestionAudioError = () => {
    console.error('Examiner audio failed to load');
    setSpeechStatus('unavailable');
    setShowQuestionText(true);
    setReadCountdown(READING_SECONDS);
  };

  // The only point in the flow where we wait on background transcription —
  // everywhere else the conversation moves on without it. If every answer
  // already finished transcribing by the time the student reaches this
  // screen (the common case), this resolves instantly and nothing is felt.
  const handleGoToEvaluation = async () => {
    if (pendingTranscriptionsRef.current.length > 0) {
      setIsFinalizing(true);
      await Promise.all(pendingTranscriptionsRef.current);
      setIsFinalizing(false);
    }
    router.push('/evaluation');
  };

  return (
    <div className="min-h-screen bg-white pb-32">
      {/* The examiner's voice. One element reused for every question so the
          autoplay permission earned on the first user gesture keeps applying. */}
      <audio
        ref={questionAudioRef}
        onEnded={handleQuestionAudioEnded}
        onError={handleQuestionAudioError}
        className="hidden"
      />

      {/* Header */}
      <header className="border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold text-slate-500">
            SpeakLoop
          </Link>
          <StepIndicator />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {/* Loading State */}
        {phase === 'loading' && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-slate-200 border-t-[#DA291C] rounded-full animate-spin mx-auto mb-4" />
              <p className="text-slate-500 text-sm">Preparing your interview questions...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {loadError && phase !== 'loading' && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center max-w-md">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="text-slate-700 font-medium mb-2">{loadError}</p>
              <Link href="/examiner" className="text-[#DA291C] text-sm font-medium hover:underline">
                ← Back to examiner selection
              </Link>
            </div>
          </div>
        )}

        {/* Interview UI — only show when not loading and no error */}
        {phase !== 'loading' && !loadError && (
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
            {!isRecording && (phase === 'question' || phase === 'followup') && (
              <span className="text-sm text-slate-400">
                {speechStatus === 'unavailable' ? 'Read the question…' : 'Examiner is speaking…'}
              </span>
            )}
            {!isRecording && isProcessingAnswer && (
              <span className="text-sm text-slate-400">Processing your answer…</span>
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
          {/* Examiner Avatar — fills entire video area */}
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

          {/* Question phase. Spoken exam: while the examiner is speaking the
              question is heard, not shown. The text only appears here when
              speech is unavailable and the student would otherwise be stuck. */}
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
                      {phase === 'question'
                        ? questions[currentQ]?.question
                        : followUpText || fallbackFollowUps[currentQ % fallbackFollowUps.length]}
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

          {/* Finished Overlay */}
          {phase === 'finished' && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-white text-xl font-medium">Interview Complete</p>
                <p className="text-slate-300 text-sm mt-2">Great job! Ready to see your results?</p>
              </div>
            </div>
          )}
        </div>

        {/* Answering. This is a listening exam, so the question stays unseen by
            default — the student who missed it can replay the audio or, as a
            last resort, reveal the text. */}
        {(phase === 'recording' || phase === 'followup-recording') && (
          <div className="mt-4">
            {!showQuestionText ? (
              <div className="bg-slate-50 rounded-xl p-4 text-center">
                <p className="text-slate-500 text-sm">
                  Didn&apos;t catch that?{' '}
                  {hasPlayableAudio && (
                    <>
                      <button onClick={handleReplayQuestion} className="text-[#DA291C] font-medium hover:underline">
                        Play again
                      </button>
                      {' · '}
                    </>
                  )}
                  <button onClick={handleViewQuestionText} className="text-[#DA291C] font-medium hover:underline">
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
                  {phase === 'recording'
                    ? questions[currentQ]?.question
                    : followUpText || fallbackFollowUps[currentQ % fallbackFollowUps.length]}
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
                  ? 'w-8 bg-[#DA291C]'
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

      {/* Sticky action bar — always reachable without scrolling, regardless of video height */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-100 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="max-w-4xl mx-auto px-6 py-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {phase === 'examiner-intro' && (
            <button
              onClick={handleStartQuestion}
              className="w-full py-3 bg-[#DA291C] text-white rounded-lg font-medium hover:bg-[#B91C1C] transition-colors"
            >
              I&apos;m Ready — Start Questions
            </button>
          )}

          {/* Only offered on the fallback path: while the examiner is actually
              speaking, cutting them off to start answering makes no sense. */}
          {(phase === 'question' || phase === 'followup') && speechStatus === 'unavailable' && (
            <button
              onClick={handleStartAnswering}
              className="w-full py-3.5 bg-[#DA291C] text-white rounded-xl font-medium hover:bg-[#B91C1C] transition-colors"
            >
              Start Answering Now
            </button>
          )}

          {(phase === 'recording' || phase === 'followup-recording') && (
            <button
              onClick={phase === 'recording' ? handleFinishMainAnswer : handleFinishFollowUp}
              disabled={isStopping || isProcessingAnswer}
              className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isProcessingAnswer ? 'Processing your answer…' : 'Finish Answer'}
            </button>
          )}

          {phase === 'finished' && (
            <button
              onClick={handleGoToEvaluation}
              disabled={isFinalizing}
              className="w-full py-3.5 bg-[#DA291C] text-white rounded-xl font-medium hover:bg-[#B91C1C] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isFinalizing ? 'Finalizing...' : 'View My Evaluation'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
