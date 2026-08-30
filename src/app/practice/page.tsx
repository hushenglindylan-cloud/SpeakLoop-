'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mockPracticeQuestions } from '@/lib/mock/data';
import { StepIndicator } from '@/components/step-indicator';
import { addPracticeTranscript, updatePracticeTranscriptAnswer } from '@/lib/store/interview-session';
import { blobToPcm16kMono } from '@/lib/audio/pcm';

type Phase = 'intro' | 'question' | 'recording' | 'followup' | 'followup-recording' | 'finished';

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
// backend (and OpenAI's Whisper API, which infers format from the filename)
// receives a file that actually matches how it was encoded.
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
    // The MediaRecorder produced zero bytes — this never reaches /api/stt at
    // all, so it's unrelated to whether GROQ_API_KEY/OPENAI_API_KEY is set.
    // Tagged distinctly from the backend's own "couldn't detect voice"
    // responses so the two failure points aren't confused while debugging.
    console.error('STT skipped: recorded blob is empty (client-side capture produced 0 bytes)');
    return '[No speech detected (client-empty-blob)]';
  }
  try {
    // iFlytek's real-time transcription needs raw 16 kHz mono PCM, and the
    // server has no ffmpeg — so the conversion happens here, where the same
    // browser that recorded the audio can decode it. A failure here is
    // reported distinctly rather than being mistaken for a backend problem.
    let uploadBlob: Blob;
    try {
      uploadBlob = await blobToPcm16kMono(blob);
    } catch (conversionError) {
      console.error('Audio conversion to PCM failed:', conversionError);
      return '[Transcription error: could not convert the recording for upload (client-audio-conversion)]';
    }

    const formData = new FormData();
    formData.append('audio', uploadBlob, filenameForMimeType(blob.type));
    const res = await fetch('/api/stt', { method: 'POST', body: formData });
    const data = await res.json();

    if (typeof data.transcript === 'string' && data.transcript.trim().length > 0) {
      return data.transcript.trim();
    }

    // /api/stt always answers 200 with either a transcript or an `error`
    // field (see route.ts) — specifically so a hosting platform's gateway
    // can't quietly replace a non-2xx response body before it reaches us.
    // So `data.error` is the real signal here, not res.status; a non-OK or
    // genuinely empty response means something outside our own code
    // intervened (check the browser Network tab for the raw response).
    console.error('STT request failed:', res.status, data);
    const stageSuffix = data?.stage ? ` (${data.stage})` : '';
    const detailSuffix = data?.providerDetail ? ` — ${data.providerDetail}` : '';
    const rawSuffix = data?.raw ? ` [raw: ${data.raw}]` : '';
    return `[Transcription error: ${data?.error || (res.ok ? 'empty response from server' : `HTTP ${res.status}`)}${stageSuffix}${detailSuffix}${rawSuffix}]`;
  } catch (err) {
    console.error('STT request failed:', err);
    return '[Transcription failed — please check your connection]';
  }
}

export default function PracticePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('intro');
  const [currentQ, setCurrentQ] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  // Guards only the brief moment the MediaRecorder is being stopped and
  // collected (well under a second) — not the STT call itself, which now
  // runs in the background so it never blocks the conversation.
  const [isStopping, setIsStopping] = useState(false);
  // Only used once, if needed, when leaving for /final-evaluation.
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef<string | undefined>(undefined);
  // Background transcription promises in flight — awaited only once, right
  // before leaving for /final-evaluation, so every answer has real text by
  // then (used there as evidence for the progress comparison).
  const pendingTranscriptionsRef = useRef<Promise<void>[]>([]);

  const question = mockPracticeQuestions[currentQ];

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

  const handleStartPractice = async () => {
    // Request microphone permission up front (kept alive for the whole session)
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
      setPhase('question');
      setTimeout(() => {
        setPhase('recording');
        startRecording();
      }, 3000);
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
    if (isStopping) return;
    setIsStopping(true);
    setIsRecording(false);
    setShowQuestion(false);

    const audioBlob = await stopAndCollectAudio();
    setElapsed(0);
    setIsStopping(false);

    const index = addPracticeTranscript({
      question: isFollowUp ? question.aiFollowUp : question.question,
      questionType: isFollowUp ? 'followup' : 'main',
      answer: '',
    });
    pendingTranscriptionsRef.current.push(
      transcribeAudio(audioBlob).then((transcript) => {
        updatePracticeTranscriptAnswer(index, transcript);
      })
    );

    if (isFollowUp) {
      if (currentQ < mockPracticeQuestions.length - 1) {
        setCurrentQ((prev) => prev + 1);
        setPhase('question');
        setTimeout(() => {
          setPhase('recording');
          startRecording();
        }, 3000);
      } else {
        setPhase('finished');
      }
    } else {
      setPhase('followup');
      setTimeout(() => {
        setPhase('followup-recording');
        startRecording();
      }, 3000);
    }
  }, [currentQ, isStopping, question, startRecording, stopAndCollectAudio]);

  const handleFinishMainAnswer = () => finishAnswer(false);
  const handleFinishFollowUp = () => finishAnswer(true);

  const handleViewQuestion = () => {
    setShowQuestion(true);
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
        {/* Intro Phase */}
        {phase === 'intro' && (
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
                      Based on your evaluation, focus on expanding your vocabulary
                      for abstract topics. Practice giving extended answers with
                      specific examples and clear reasoning.
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
                  <span className="text-sm text-slate-400">Examiner is speaking...</span>
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
              {/* Examiner Avatar Placeholder */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 mx-auto mb-3 flex items-center justify-center">
                    <svg className="w-12 h-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                  </div>
                  <p className="text-slate-400 text-sm">AI Examiner</p>
                </div>
              </div>

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

              {/* Question Phase Overlay */}
              {(phase === 'question' || phase === 'followup') && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-white animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                      </svg>
                    </div>
                    <p className="text-white text-lg font-medium">Examiner is speaking...</p>
                  </div>
                </div>
              )}

            </div>

            {/* Focus hint + question text toggle — scrollable area, not the sticky bar */}
            {(phase === 'recording' || phase === 'followup-recording') && (
              <div className="mt-4 space-y-4">
                {phase === 'recording' && (
                  <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                    <p className="text-xs text-amber-800">
                      <span className="font-semibold">Focus area:</span> {question.contextHint}
                    </p>
                  </div>
                )}

                {!showQuestion ? (
                  <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <p className="text-slate-500 text-sm">
                      Didn&apos;t catch that?{' '}
                      <button onClick={handleViewQuestion} className="text-[#DA291C] font-medium hover:underline">
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
                        ? question.question
                        : question.aiFollowUp}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Progress Indicator */}
            <div className="mt-6 flex items-center justify-center gap-2">
              {mockPracticeQuestions.map((_, index) => (
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
              Question {currentQ + 1} of {mockPracticeQuestions.length}
            </p>
          </>
        )}
      </main>

      {/* Sticky action bar — mirrors the Interview page exactly */}
      {(phase === 'recording' || phase === 'followup-recording') && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-100 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="max-w-4xl mx-auto px-6 py-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
            <button
              onClick={phase === 'recording' ? handleFinishMainAnswer : handleFinishFollowUp}
              disabled={isStopping}
              className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Finish Answer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
