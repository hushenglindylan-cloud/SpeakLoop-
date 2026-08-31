'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StepIndicator } from '@/components/step-indicator';
import { getAllTranscripts, getSession } from '@/lib/store/interview-session';
import { examiners } from '@/lib/mock/data';

// ---------------------------------------------------------------------------
// Types matching /api/evaluate-interview response
// ---------------------------------------------------------------------------

interface CriterionAnalysis {
  band: number;
  evidence: string;
  rationale: string;
  audioEvidenceAvailable?: boolean;
}

interface ImprovedAnswer {
  questionIndex: number;
  question: string;
  originalSummary: string;
  improvedVersion: string;
}

interface EvaluationData {
  scores: {
    fluencyCoherence: number;
    lexicalResource: number;
    grammaticalRange: number;
    pronunciation: number;
  };
  overallBand: number;
  criteriaAnalysis: {
    fluencyCoherence: CriterionAnalysis;
    lexicalResource: CriterionAnalysis;
    grammaticalRange: CriterionAnalysis;
    pronunciation: CriterionAnalysis;
  };
  mainWeakness: string;
  improvementFocus: string;
  improvedAnswers: ImprovedAnswer[];
  mock?: boolean;
  fallback?: boolean;
}

// ---------------------------------------------------------------------------
// UI Components
// ---------------------------------------------------------------------------

function AnimatedScore({ target, duration = 1500 }: { target: number; duration?: number }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * target;
      if (target % 1 === 0) {
        setValue(Math.round(current));
      } else {
        setValue(Math.round(current * 2) / 2);
      }
      if (progress >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);

  return <span className="tabular-nums">{value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}</span>;
}

function ScoreBar({ label, score, color, analysis }: {
  label: string;
  score: number;
  color: string;
  analysis?: CriterionAnalysis;
}) {
  const [expanded, setExpanded] = useState(false);
  const percentage = (score / 9) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-lg font-bold tabular-nums text-slate-900">
          <AnimatedScore target={score} />
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {analysis && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          {expanded ? 'Hide details ▲' : 'Show details ▼'}
        </button>
      )}
      {expanded && analysis && (
        <div className="rounded-lg bg-slate-50 p-3 space-y-1.5">
          <p className="text-xs text-slate-600">
            <span className="font-medium">Evidence:</span> {analysis.evidence}
          </p>
          <p className="text-xs text-slate-500">
            <span className="font-medium">Rationale:</span> {analysis.rationale}
          </p>
          {analysis.audioEvidenceAvailable === false && (
            <p className="text-xs text-amber-600 italic">
              Note: Audio-level pronunciation analysis not available. Score based on transcript evidence only.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const scoreColors: Record<string, string> = {
  high: 'bg-emerald-500',
  mid: 'bg-amber-500',
  low: 'bg-red-400',
};

function getScoreColor(score: number): string {
  if (score >= 7) return scoreColors.high;
  if (score >= 6) return scoreColors.mid;
  return scoreColors.low;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-10 text-center">
        <h1 className="mb-3 text-3xl font-bold text-slate-900">Your Evaluation</h1>
        <p className="text-slate-500">Analyzing your performance...</p>
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-8">
            <div className="animate-pulse space-y-4">
              <div className="mx-auto h-4 w-24 rounded bg-slate-200" />
              <div className="mx-auto h-16 w-32 rounded bg-slate-200" />
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 w-20 rounded bg-slate-200" />
                    <div className="h-2.5 w-full rounded-full bg-slate-200" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-slate-100 bg-white p-8">
            <div className="animate-pulse space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 rounded bg-slate-100" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function EvaluationPage() {
  const router = useRouter();
  const transcripts = getAllTranscripts();

  const [evaluation, setEvaluation] = useState<EvaluationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scoring the same interview twice is never right: it burns a second LLM
  // call and, because whichever response lands last wins, the student sees
  // their band score visibly change for no reason. hasRequestedRef keeps the
  // page to a single evaluation (React's dev StrictMode deliberately mounts
  // effects twice, which is exactly how the duplicate used to slip through),
  // and fetchSeqRef makes a superseded response — e.g. a slow first attempt
  // arriving after a retry — get dropped instead of overwriting the newer one.
  const hasRequestedRef = useRef(false);
  const fetchSeqRef = useRef(0);

  const runEvaluation = useCallback(async () => {
    const currentTranscripts = getAllTranscripts();
    const currentSession = getSession();

    if (currentTranscripts.length === 0) {
      setLoading(false);
      return;
    }

    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      // Get examiner context from session
      const examinerContext = currentSession?.examinerId
        ? examiners.find((e) => e.id === currentSession.examinerId)
        : undefined;

      const response = await fetch('/api/evaluate-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcripts: currentTranscripts,
          examiner: examinerContext
            ? {
                name: examinerContext.name,
                personality: examinerContext.personality,
                difficulty: examinerContext.difficulty,
              }
            : undefined,
        }),
      });

      const data = await response.json();
      if (fetchSeqRef.current !== seq) return;

      // The API only returns scores when it actually produced an evaluation;
      // a failure comes back as { error, stage } with no scores at all.
      if (!data?.scores || typeof data.scores.fluencyCoherence !== 'number') {
        setError(data?.error || 'Evaluation failed. Please try again.');
      } else {
        setEvaluation(data);
        // Save evaluation data for the practice page to use
        try {
          localStorage.setItem('speakloop_last_evaluation', JSON.stringify({
            weakness: data.mainWeakness,
            improvementFocus: data.improvementFocus,
            criteriaScores: data.scores,
          }));
        } catch {
          // localStorage may not be available
        }
      }
    } catch (err) {
      console.error('Failed to fetch evaluation:', err);
      if (fetchSeqRef.current !== seq) return;
      setError('Failed to load evaluation. Please try again.');
    } finally {
      if (fetchSeqRef.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;
    runEvaluation();
  }, [runEvaluation]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
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
        <LoadingState />
      </div>
    );
  }

  if (error || !evaluation) {
    return (
      <div className="min-h-screen bg-white">
        <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
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
        <main className="mx-auto max-w-5xl px-6 py-12 text-center">
          <h1 className="mb-3 text-3xl font-bold text-slate-900">Your Evaluation</h1>
          <p className="text-slate-500 mb-6">
            {error || 'No recordings available. Please complete the interview first.'}
          </p>
          {/* A scoring failure doesn't lose the answers — they're still in the
              session, so offer a retry rather than sending the student back to
              redo the whole interview. */}
          {error && transcripts.length > 0 ? (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={runEvaluation}
                className="inline-flex rounded-xl bg-[#DA291C] px-8 py-3 text-base font-semibold text-white transition-all hover:bg-[#B91C1C]"
              >
                Retry Evaluation
              </button>
              <Link href="/interview" className="text-sm font-medium text-slate-500 hover:text-slate-700">
                Or start a new interview
              </Link>
            </div>
          ) : (
            <Link
              href="/interview"
              className="inline-flex rounded-xl bg-[#DA291C] px-8 py-3 text-base font-semibold text-white transition-all hover:bg-[#B91C1C]"
            >
              Go to Interview
            </Link>
          )}
        </main>
      </div>
    );
  }

  const { scores, overallBand, criteriaAnalysis, mainWeakness, improvementFocus, improvedAnswers } = evaluation;

  const criteria = [
    { key: 'fluencyCoherence' as const, label: 'Fluency & Coherence', score: scores.fluencyCoherence },
    { key: 'lexicalResource' as const, label: 'Lexical Resource', score: scores.lexicalResource },
    { key: 'grammaticalRange' as const, label: 'Grammatical Range & Accuracy', score: scores.grammaticalRange },
    { key: 'pronunciation' as const, label: 'Pronunciation', score: scores.pronunciation },
  ];

  // Build evidence list from criteriaAnalysis
  const evidenceList = criteria.map((c) => {
    const analysis = criteriaAnalysis[c.key];
    return analysis?.evidence || `${c.label}: Band ${c.score}`;
  });

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
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

      <main className="mx-auto max-w-5xl px-6 py-12">
        {/* Title */}
        <div className="mb-10 text-center">
          <h1 className="mb-3 text-3xl font-bold text-slate-900">
            Your Evaluation
          </h1>
          <p className="text-slate-500">
            Detailed analysis of your Part 3 performance
          </p>
          {evaluation.mock && (
            <p className="mt-2 text-xs text-amber-600">
              Demo mode: Configure DASHSCOPE_API_KEY for AI-powered evaluation
            </p>
          )}
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Overall Score */}
          <div className="lg:col-span-1">
            <div className="sticky top-8 rounded-2xl border border-slate-100 bg-slate-50 p-8 text-center">
              <div className="mb-2 text-sm font-medium text-slate-500">
                Overall Band Score
              </div>
              <div className="mb-4 text-6xl font-bold text-[#DA291C]">
                <AnimatedScore target={overallBand} />
              </div>
              <p className="mb-4 text-xs text-slate-400">
                Individual scores are integers (1-9). Overall band is rounded down to nearest 0.5.
              </p>

              {/* Criteria Bars */}
              <div className="space-y-4 text-left">
                {criteria.map((c) => (
                  <ScoreBar
                    key={c.key}
                    label={c.label}
                    score={c.score}
                    color={getScoreColor(c.score)}
                    analysis={criteriaAnalysis[c.key]}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-6 lg:col-span-2">
            {/* Evidence */}
            <div className="rounded-2xl border border-slate-100 bg-white p-8">
              <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <svg className="h-5 w-5 text-[#DA291C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Evidence
              </h2>
              <div className="space-y-4">
                {evidenceList.map((item, i) => (
                  <div key={i} className="flex gap-3 rounded-xl bg-slate-50 p-4">
                    <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#DA291C]/10 text-[10px] font-bold text-[#DA291C]">
                      {i + 1}
                    </div>
                    <p className="text-sm leading-relaxed text-slate-600">
                      {item}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Weakness & Improvement */}
            <div className="rounded-2xl border border-slate-100 bg-white p-8">
              <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <svg className="h-5 w-5 text-[#DA291C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Areas for Improvement
              </h2>
              <div className="space-y-4">
                <div className="rounded-xl bg-red-50 border border-red-100 p-4">
                  <p className="text-xs font-semibold text-red-700 mb-1">Main Weakness</p>
                  <p className="text-sm text-red-800">{mainWeakness}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                  <p className="text-xs font-semibold text-emerald-700 mb-1">Focus for Practice</p>
                  <p className="text-sm text-emerald-800">{improvementFocus}</p>
                </div>
              </div>
            </div>

            {/* Answer Review with AI Improvements */}
            <div className="rounded-2xl border border-slate-200 bg-white p-8">
              <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <svg className="h-5 w-5 text-[#DA291C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Your Interview Review
              </h2>

              <div className="space-y-6">
                {transcripts.length > 0 ? (
                  transcripts.map((t, idx) => {
                    const questionLabel = t.questionType === 'followup'
                      ? 'Follow-up'
                      : `Q${transcripts.slice(0, idx).filter((x) => x.questionType === 'main').length + 1}`;

                    // Find matching improved answer from API
                    const improved = improvedAnswers?.find((a) => a.questionIndex === idx);

                    return (
                      <div key={idx} className="space-y-3">
                        {/* Question */}
                        <div className="rounded-lg bg-slate-50 p-4">
                          <p className="text-xs font-medium text-slate-400 mb-1">{questionLabel}</p>
                          <p className="text-sm text-slate-600">
                            {t.question}
                          </p>
                        </div>

                        {/* Student's Answer */}
                        <div>
                          <h4 className="mb-1.5 text-xs font-semibold text-slate-600">Your answer:</h4>
                          <div className="rounded-lg bg-white border border-slate-200 p-4">
                            <p className="text-sm leading-relaxed text-slate-800">
                              {t.answer || '[No speech detected]'}
                            </p>
                          </div>
                        </div>

                        {/* Improved Version (from AI) */}
                        {improved && (
                          <div>
                            <h4 className="mb-1.5 text-xs font-semibold text-emerald-700">Improved version (Band 7+):</h4>
                            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-4">
                              <p className="text-sm leading-relaxed text-emerald-800">
                                {improved.improvedVersion}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Divider between Q and Follow-up */}
                        {idx < transcripts.length - 1 && t.questionType === 'main' && (
                          <div className="border-t border-dashed border-slate-200 pt-3" />
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">No recordings available. Please complete the interview first.</p>
                )}
              </div>
            </div>

            {/* CTA */}
            <div className="flex justify-center pt-4">
              <button
                onClick={() => router.push('/practice')}
                className="rounded-xl bg-[#DA291C] px-10 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#DA291C]/20 transition-all hover:bg-[#B91C1C] hover:shadow-xl"
              >
                Start Personalized Practice →
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
