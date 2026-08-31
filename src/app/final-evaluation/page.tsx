'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { StepIndicator } from '@/components/step-indicator';
import { getAllTranscripts, getAllPracticeTranscripts, getSession } from '@/lib/store/interview-session';
import { examiners } from '@/lib/mock/data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoreEvaluation {
  scores: {
    fluencyCoherence: number;
    lexicalResource: number;
    grammaticalRange: number;
    pronunciation: number;
  };
  overallBand: number;
  mainWeakness?: string;
  improvementFocus?: string;
}

interface PracticeFocus {
  weakness: string;
  improvementFocus: string;
}

interface ProgressArea {
  area: string;
  observation: string;
  evidence: string;
}

interface ProgressAnalysis {
  progress: {
    improved: boolean;
    areas: ProgressArea[];
  };
  remainingFocus: {
    area: string;
    observation: string;
  };
  nextStep: string;
  summary: string;
  mock?: boolean;
}

// ---------------------------------------------------------------------------
// Animated Number Component
// ---------------------------------------------------------------------------

function AnimatedNumber({ target, duration = 1500 }: { target: number; duration?: number }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(parseFloat((eased * target).toFixed(1)));
      if (progress >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);

  return <span className="tabular-nums">{value.toFixed(1)}</span>;
}

// ---------------------------------------------------------------------------
// Score Card Component
// ---------------------------------------------------------------------------

function ScoreCard({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-5 py-4 text-center">
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-900">
        <AnimatedNumber target={score} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function FinalEvaluationPage() {
  const [coreEvaluation, setCoreEvaluation] = useState<CoreEvaluation | null>(null);
  const [practiceFocus, setPracticeFocus] = useState<PracticeFocus | null>(null);
  const [progressAnalysis, setProgressAnalysis] = useState<ProgressAnalysis | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressError, setProgressError] = useState<string | null>(null);

  // Single-flight guard to prevent duplicate requests
  const hasRequestedRef = useRef(false);
  const fetchSeqRef = useRef(0);

  // Load existing evaluation data from localStorage
  useEffect(() => {
    // Load core evaluation
    const evalData = localStorage.getItem('speakloop_evaluation_core');
    if (evalData) {
      try {
        const parsed = JSON.parse(evalData);
        setCoreEvaluation(parsed);
      } catch {
        console.error('Failed to parse core evaluation from localStorage');
      }
    }

    // Load practice focus
    const evalForPractice = localStorage.getItem('speakloop_last_evaluation');
    if (evalForPractice) {
      try {
        const parsed = JSON.parse(evalForPractice);
        setPracticeFocus({
          weakness: parsed.weakness || '',
          improvementFocus: parsed.improvementFocus || '',
        });
      } catch {
        console.error('Failed to parse practice focus from localStorage');
      }
    }
  }, []);

  // Fetch progress analysis
  useEffect(() => {
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    const currentSeq = ++fetchSeqRef.current;

    async function fetchProgressAnalysis() {
      const interviewTranscripts = getAllTranscripts();
      const practiceTranscripts = getAllPracticeTranscripts();

      if (interviewTranscripts.length === 0 || practiceTranscripts.length === 0) {
        setProgressError('No transcripts found. Please complete both interview and practice sessions.');
        setProgressLoading(false);
        return;
      }

      const session = getSession();
      const examiner = session?.examinerId
        ? examiners.find((e) => e.id === session.examinerId)
        : undefined;

      // Get core evaluation from localStorage
      const evalData = localStorage.getItem('speakloop_evaluation_core');
      let coreEval: CoreEvaluation | undefined;
      if (evalData) {
        try {
          coreEval = JSON.parse(evalData);
        } catch {
          // Ignore parse errors
        }
      }

      // Get practice focus from localStorage
      const evalForPractice = localStorage.getItem('speakloop_last_evaluation');
      let pFocus: PracticeFocus | undefined;
      if (evalForPractice) {
        try {
          const parsed = JSON.parse(evalForPractice);
          pFocus = {
            weakness: parsed.weakness || '',
            improvementFocus: parsed.improvementFocus || '',
          };
        } catch {
          // Ignore parse errors
        }
      }

      try {
        const res = await fetch('/api/final-evaluation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interviewTranscripts,
            practiceTranscripts,
            coreEvaluation: coreEval,
            practiceFocus: pFocus,
            examiner: examiner
              ? { name: examiner.name, personality: examiner.personality, difficulty: examiner.difficulty }
              : undefined,
          }),
        });

        // Race condition check
        if (currentSeq !== fetchSeqRef.current) return;

        const result = await res.json();

        if (result.error) {
          setProgressError(result.error);
        } else {
          setProgressAnalysis(result);
        }
      } catch (err) {
        if (currentSeq !== fetchSeqRef.current) return;
        console.error('Failed to fetch progress analysis:', err);
        setProgressError('Failed to load progress analysis. Please try again.');
      } finally {
        if (currentSeq === fetchSeqRef.current) {
          setProgressLoading(false);
        }
      }
    }

    fetchProgressAnalysis();
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Check if we have minimum data to show anything
  const hasCoreEvaluation = coreEvaluation !== null;
  const hasTranscripts = getAllTranscripts().length > 0 && getAllPracticeTranscripts().length > 0;

  if (!hasTranscripts && !progressLoading) {
    return (
      <div className="min-h-screen bg-[#fafaf9]">
        <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
            <Link href="/" className="text-lg font-semibold text-slate-500">SpeakLoop</Link>
            <StepIndicator />
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-6 py-12">
          <div className="text-center py-20">
            <p className="text-slate-700 font-medium mb-4">No transcripts found</p>
            <p className="text-slate-500 text-sm mb-6">Please complete both interview and practice sessions first.</p>
            <Link href="/" className="text-[#DA291C] text-sm font-medium hover:underline">← Back to home</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      {/* Header */}
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#DA291C]">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-slate-900">SpeakLoop</span>
          </Link>
          <StepIndicator />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12">
        {/* Title */}
        <div className="mb-10 text-center">
          <h1 className="mb-3 text-3xl font-bold text-slate-900">
            Final Evaluation
          </h1>
          <p className="text-slate-500">
            Your learning progress summary
          </p>
        </div>

        {/* Initial Assessment Scores */}
        {hasCoreEvaluation && (
          <div className="mb-10 rounded-2xl border border-slate-100 bg-white p-8">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Initial Assessment</h2>
              <span className="text-xs text-slate-400">From your interview</span>
            </div>
            
            {/* Overall Band */}
            <div className="mb-6 text-center">
              <div className="text-sm font-medium text-slate-500 mb-2">Overall Band</div>
              <div className="text-5xl font-bold text-[#DA291C]">
                <AnimatedNumber target={coreEvaluation!.overallBand} />
              </div>
            </div>

            {/* Criterion Scores */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ScoreCard label="Fluency" score={coreEvaluation!.scores.fluencyCoherence} />
              <ScoreCard label="Vocabulary" score={coreEvaluation!.scores.lexicalResource} />
              <ScoreCard label="Grammar" score={coreEvaluation!.scores.grammaticalRange} />
              <ScoreCard label="Pronunciation" score={coreEvaluation!.scores.pronunciation} />
            </div>
          </div>
        )}

        {/* Practice Focus */}
        {practiceFocus && (practiceFocus.weakness || practiceFocus.improvementFocus) && (
          <div className="mb-10 rounded-2xl border border-slate-200 bg-white p-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <svg className="h-5 w-5 text-[#DA291C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Practice Focus
            </h2>
            <div className="space-y-3">
              {practiceFocus.weakness && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Target Area</div>
                  <p className="text-sm text-slate-700">{practiceFocus.weakness}</p>
                </div>
              )}
              {practiceFocus.improvementFocus && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Improvement Goal</div>
                  <p className="text-sm text-slate-700">{practiceFocus.improvementFocus}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Progress Analysis */}
        <div className="mb-10 rounded-2xl border border-slate-200 bg-white p-8">
          <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
            <svg className="h-5 w-5 text-[#DA291C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Your Progress
          </h2>

          {progressLoading && (
            <div className="space-y-4">
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${85 - i * 10}%` }} />
                ))}
              </div>
              <p className="text-xs text-slate-400">Analyzing your progress…</p>
            </div>
          )}

          {progressError && !progressLoading && (
            <div className="text-center py-8">
              <p className="text-slate-600 mb-4">{progressError}</p>
              <button
                onClick={() => window.location.reload()}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {progressAnalysis && !progressLoading && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-700 leading-relaxed">{progressAnalysis.summary}</p>
                {progressAnalysis.mock && (
                  <p className="mt-2 text-xs text-amber-600">
                    Mock analysis — API key not configured.
                  </p>
                )}
              </div>

              {/* Progress Areas */}
              {progressAnalysis.progress.areas.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">
                    {progressAnalysis.progress.improved ? 'What Improved' : 'Observations'}
                  </h3>
                  <ol className="space-y-3">
                    {progressAnalysis.progress.areas.map((area, idx) => (
                      <li key={idx} className="flex gap-3">
                        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                          {idx + 1}
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-800">{area.area}</p>
                          <p className="text-sm text-slate-600">{area.observation}</p>
                          {area.evidence && (
                            <p className="mt-1 text-xs text-slate-500 italic">Evidence: {area.evidence}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Remaining Focus */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Still Focus On</h3>
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-800">{progressAnalysis.remainingFocus.area}</p>
                  <p className="text-sm text-amber-700">{progressAnalysis.remainingFocus.observation}</p>
                </div>
              </div>

              {/* Next Step */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Next Step</h3>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-sm text-emerald-800">{progressAnalysis.nextStep}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-4 pt-4">
          <Link
            href="/examiner"
            className="rounded-xl bg-[#DA291C] px-10 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#DA291C]/20 transition-all hover:bg-[#B91C1C] hover:shadow-xl"
          >
            Start Another Session →
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-slate-500 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-slate-700"
          >
            Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}
