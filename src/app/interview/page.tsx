'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StepIndicator } from '@/components/step-indicator';
import { addTranscript } from '@/lib/store/interview-session';

const mockQuestions = [
  {
    id: 1,
    question: 'Some people believe that technology has made our lives more complex, not simpler. To what extent do you agree or disagree?',
    followUp: 'Can you give a specific example of when technology actually simplified a task that was previously difficult?',
  },
  {
    id: 2,
    question: 'Do you think the government should invest more in space exploration, or should that money be spent on solving problems on Earth?',
    followUp: 'What about the role of private companies in space exploration — do you think they should be involved?',
  },
  {
    id: 3,
    question: 'How has the way people communicate changed over the past few decades, and do you think these changes have been positive overall?',
    followUp: 'Do you think face-to-face communication will become less important in the future?',
  },
];

type Phase = 'examiner-intro' | 'question' | 'recording' | 'followup' | 'followup-recording' | 'finished';

// Simulate question audio playback (no actual audio, just a delay)
function simulateQuestionAudio(onEnded: () => void) {
  setTimeout(() => {
    onEnded();
  }, 3000);
}

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
// so a question is never silently dropped from the session.
async function transcribeAudio(blob: Blob | null): Promise<string> {
  if (!blob || blob.size === 0) {
    return '[No speech detected]';
  }
  try {
    const formData = new FormData();
    formData.append('audio', blob, filenameForMimeType(blob.type));
    const res = await fetch('/api/stt', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.ok && typeof data.transcript === 'string' && data.transcript.trim().length > 0) {
      return data.transcript.trim();
    }

    if (!res.ok) {
      // Surface the real backend error instead of masking every failure as
      // "no speech detected" — check the browser console / Network tab for
      // the full response body from /api/stt if you see this.
      console.error('STT request failed:', res.status, data);
      return `[Transcription error: ${data?.error || `HTTP ${res.status}`}]`;
    }

    return '[No speech detected]';
  } catch (err) {
    console.error('STT request failed:', err);
    return '[Transcription failed — please check your connection]';
  }
}

export default function InterviewPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('examiner-intro');
  const [currentQ, setCurrentQ] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef<string | undefined>(undefined);

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

  // Play question audio and start recording after it ends
  const playQuestionAndRecord = useCallback(() => {
    setPhase('question');
    simulateQuestionAudio(() => {
      setTimeout(() => {
        startRecording();
        setPhase('recording');
      }, 500);
    });
  }, [startRecording]);

  // Play follow-up audio and start recording after it ends
  const playFollowUpAndRecord = useCallback(() => {
    setPhase('followup');
    simulateQuestionAudio(() => {
      setTimeout(() => {
        startRecording();
        setPhase('followup-recording');
      }, 500);
    });
  }, [startRecording]);

  // Stop recording, transcribe via backend STT, and save to global state.
  // Always saves an entry (even a placeholder) so a question can never be
  // silently dropped from the session.
  const stopRecordingAndSave = useCallback(async (isFollowUp: boolean) => {
    setIsRecording(false);
    setShowQuestion(false);
    setIsTranscribing(true);

    const audioBlob = await stopAndCollectAudio();
    setElapsed(0);

    const transcript = await transcribeAudio(audioBlob);

    addTranscript({
      question: isFollowUp ? mockQuestions[currentQ].followUp : mockQuestions[currentQ].question,
      questionType: isFollowUp ? 'followup' : 'main',
      answer: transcript,
    });

    setIsTranscribing(false);

    // Move to next phase
    if (isFollowUp) {
      if (currentQ < mockQuestions.length - 1) {
        setCurrentQ((prev) => prev + 1);
        setTimeout(() => {
          playQuestionAndRecord();
        }, 300);
      } else {
        setPhase('finished');
      }
    } else {
      setTimeout(() => {
        playFollowUpAndRecord();
      }, 300);
    }
  }, [currentQ, playQuestionAndRecord, playFollowUpAndRecord, stopAndCollectAudio]);

  const handleStartQuestion = () => {
    playQuestionAndRecord();
  };

  const handleFinishMainAnswer = () => {
    stopRecordingAndSave(false);
  };

  const handleFinishFollowUp = () => {
    stopRecordingAndSave(true);
  };

  const handleViewQuestion = () => {
    setShowQuestion(true);
  };

  const handleGoToEvaluation = () => {
    router.push('/evaluation');
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
        {/* Status Bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {isRecording && (
              <>
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                <span className="text-sm text-slate-500">Recording in progress...</span>
              </>
            )}
            {isTranscribing && (
              <span className="text-sm text-slate-500">Transcribing your answer...</span>
            )}
            {!isRecording && !isTranscribing && phase !== 'finished' && phase !== 'examiner-intro' && (
              <span className="text-sm text-slate-400">Waiting...</span>
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

          {/* Transcribing Overlay */}
          {isTranscribing && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 mb-4">
                  <span className="w-2.5 h-2.5 bg-white rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-2.5 h-2.5 bg-white rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-2.5 h-2.5 bg-white rounded-full animate-bounce"></span>
                </div>
                <p className="text-white text-lg font-medium">Transcribing your answer...</p>
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

        {/* Question text toggle — lives in the scrollable area, not the sticky bar */}
        {(phase === 'recording' || phase === 'followup-recording') && !isTranscribing && (
          <div className="mt-4">
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
                    ? mockQuestions[currentQ].question
                    : mockQuestions[currentQ].followUp}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Progress Indicator */}
        <div className="mt-6 flex items-center justify-center gap-2">
          {mockQuestions.map((_, index) => (
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
          Question {currentQ + 1} of {mockQuestions.length}
        </p>
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

          {(phase === 'recording' || phase === 'followup-recording') && (
            <button
              onClick={phase === 'recording' ? handleFinishMainAnswer : handleFinishFollowUp}
              disabled={isTranscribing}
              className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isTranscribing ? 'Transcribing...' : 'Finish Answer'}
            </button>
          )}

          {phase === 'finished' && (
            <button
              onClick={handleGoToEvaluation}
              className="w-full py-3.5 bg-[#DA291C] text-white rounded-xl font-medium hover:bg-[#B91C1C] transition-colors"
            >
              View My Evaluation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
