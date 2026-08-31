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

type Phase = 'loading' | 'intro' | 'question' | 'recording' | 'followup' | 'followup-recording' | 'finished';

// Seconds the question stays on screen before recording starts. There is no
// TTS yet (PRD §9), so the examiner asks in text and this is the student's
// window to read it — not a stand-in for audio playback. They can skip it.
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
// so a question is never silently dropped from the session. This transcript
// is only used behind the scenes as evidence for the Final Evaluation
// comparison — it is not shown during the practice session itself.
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

export default function PracticePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [examinerPortrait, setExaminerPortrait] = useState<string>('');
  const [examinerName, setExaminerName] = useState<string>('');
  const [currentQ, setCurrentQ] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [readCountdown, setReadCountdown] = useState(READING_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef<string | undefined>(undefined);
  const pendingTranscriptionsRef = useRef<Promise<void>[]>([]);

  const question = questions[currentQ];

  // Fetch targeted practice questions based on evaluation results.
  // Single-flight for the same reason as the interview page's loader.
  const hasLoadedQuestionsRef = useRef(false);

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
      }

      try {
        // Try to get evaluation data from localStorage (set by evaluation page)
        let evaluationData: { weakness?: string; improvementFocus?: string; criteriaScores?: Record<string, { band: number }> } = {};
        try {
          const stored = localStorage.getItem('speakloop_last_evaluation');
          if (stored) {
            evaluationData = JSON.parse(stored);
          }
        } catch {
          // No evaluation data available — practice without targeting
        }

        const res = await fetch('/api/practice-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            weakness: evaluationData.weakness,
            improvementFocus: evaluationData.improvementFocus,
            criteriaScores: evaluationData.criteriaScores,
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
      } catch (err) {
        console.error('Failed to load practice questions:', err);
        setLoadError('Failed to connect to the server. Please try again.');
      }
    }

    loadPracticeQuestions();
  }, []);

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

  // Tick the reading countdown down while a question is on screen.
  useEffect(() => {
    if (phase !== 'question' && phase !== 'followup') return;
    if (readCountdown <= 0) return;
    const timer = setTimeout(() => setReadCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, readCountdown]);

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

  const handleStartPractice = async () => {
    // Request microphone permission up front (kept alive for the whole session)
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

  // Stop recording and move on immediately — transcription happens in the
  // background (silently — this text is only used later as evidence in the
  // Final Evaluation comparison) so it never stalls the conversation. A
  // placeholder is saved at the question's correct index right away;
  // transcribeAudio patches in the real text whenever it resolves.
  const finishAnswer = useCallback(async (isFollowUp: boolean) => {
    if (isStopping || questions.length === 0) return;
    setIsStopping(true);
    setIsRecording(false);

    const audioBlob = await stopAndCollectAudio();
    setElapsed(0);
    setIsStopping(false);

    const currentQuestion = questions[currentQ];

    const index = addPracticeTranscript({
      question: isFollowUp ? currentQuestion.followUp : currentQuestion.question,
      questionType: isFollowUp ? 'followup' : 'main',
      answer: '',
    });
    pendingTranscriptionsRef.current.push(
      transcribeAudio(audioBlob).then((transcript) => {
        updatePracticeTranscriptAnswer(index, transcript);
      })
    );

    if (isFollowUp) {
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
  }, [currentQ, isStopping, questions, stopAndCollectAudio]);

  const handleFinishMainAnswer = () => finishAnswer(false);
  const handleFinishFollowUp = () => finishAnswer(true);

  // Skip the remaining reading time and start answering now.
  const handleStartAnswering = () => {
    setReadCountdown(0);
  };

  // The only point in the flow where we wait on background transcription —
  // everywhere else the conversation moves on without it. If every answer
  // already finished transcribing by the time the student reaches this
  // screen (the common case), this resolves instantly and nothing is felt.
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

        {/* Practice Session - Same layout as Interview */}
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
                {!isRecording && (phase === 'question' || phase === 'followup') && (
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

              {/* Practice Mode Indicator */}
              <div className="absolute top-4 left-4 rounded-full bg-amber-500/20 px-3 py-1">
                <span className="text-xs font-medium text-amber-400">PRACTICE</span>
              </div>

              {/* Question phase — the question itself is the delivery
                  mechanism, since there is no examiner audio to listen to. */}
              {(phase === 'question' || phase === 'followup') && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-6">
                  <div className="max-w-2xl text-center">
                    <p className="text-white/60 text-xs uppercase tracking-wide mb-3">
                      {phase === 'question' ? `Question ${currentQ + 1}` : 'Follow-up'}
                    </p>
                    <p className="text-white text-lg sm:text-xl font-medium leading-relaxed drop-shadow">
                      {phase === 'question' ? question.question : question.followUp}
                    </p>
                    <p className="text-white/70 text-sm mt-5">
                      Recording starts in {readCountdown}s
                    </p>
                  </div>
                </div>
              )}

            </div>

            {/* The question stays on screen while answering — with no audio
                there is nothing to "not catch", so hiding it behind a toggle
                only made the student work to see what they were answering. */}
            {(phase === 'recording' || phase === 'followup-recording') && (
              <div className="mt-4 space-y-4">
                {phase === 'recording' && (
                  <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                    <p className="text-xs text-amber-800">
                      <span className="font-semibold">Focus area:</span> {question.contextHint}
                    </p>
                  </div>
                )}

                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                    {phase === 'recording' ? 'Question' : 'Follow-up'}
                  </p>
                  <p className="text-slate-700 text-base leading-relaxed">
                    {phase === 'recording'
                      ? question.question
                      : question.followUp}
                  </p>
                </div>
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

      {/* Sticky action bar — mirrors the Interview page exactly */}
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
                disabled={isStopping}
                className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Finish Answer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
