'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { mockBeforeScores, mockAfterScores } from '@/lib/mock/data';
import { StepIndicator } from '@/components/step-indicator';
import { getAllTranscripts, getAllPracticeTranscripts } from '@/lib/store/interview-session';

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

interface ScoreRowProps {
  label: string;
  before: number;
  after: number;
}

function ScoreRow({ label, before, after }: ScoreRowProps) {
  const improvement = after - before;
  const isPositive = improvement > 0;

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 rounded-xl border border-slate-100 bg-white px-6 py-4">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="text-center">
        <div className="text-xs text-slate-400">Before</div>
        <div className="text-lg font-bold tabular-nums text-slate-400">
          <AnimatedNumber target={before} />
        </div>
      </div>
      <div className="flex items-center">
        <svg className="h-5 w-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </div>
      <div className="text-center">
        <div className="text-xs text-slate-400">After</div>
        <div className="text-lg font-bold tabular-nums text-slate-900">
          <AnimatedNumber target={after} />
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs text-slate-400">Change</div>
        <div
          className={`text-lg font-bold tabular-nums ${
            isPositive ? 'text-emerald-600' : 'text-slate-400'
          }`}
        >
          {isPositive ? '+' : ''}
          <AnimatedNumber target={improvement} />
        </div>
      </div>
    </div>
  );
}

export default function FinalEvaluationPage() {
  const rows: ScoreRowProps[] = [
    { label: 'Fluency & Coherence', before: mockBeforeScores.fluencyCoherence, after: mockAfterScores.fluencyCoherence },
    { label: 'Lexical Resource', before: mockBeforeScores.lexicalResource, after: mockAfterScores.lexicalResource },
    { label: 'Grammatical Range & Accuracy', before: mockBeforeScores.grammaticalRange, after: mockAfterScores.grammaticalRange },
    { label: 'Pronunciation', before: mockBeforeScores.pronunciation, after: mockAfterScores.pronunciation },
  ];

  const overallBefore = mockBeforeScores.overallBand;
  const overallAfter = mockAfterScores.overallBand;
  const overallImprovement = overallAfter - overallBefore;

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
            Your progress from initial assessment to final performance
          </p>
        </div>

        {/* Overall Comparison */}
        <div className="mb-10 rounded-2xl border border-slate-100 bg-white p-8">
          <div className="grid grid-cols-3 items-center gap-8">
            {/* Before */}
            <div className="text-center">
              <div className="mb-2 text-sm font-medium text-slate-400">
                Before Practice
              </div>
              <div className="text-5xl font-bold text-slate-300">
                <AnimatedNumber target={overallBefore} />
              </div>
              <div className="mt-2 text-xs text-slate-400">Initial Assessment</div>
            </div>

            {/* Arrow */}
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>
              <div className="rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-bold text-emerald-700">
                +{overallImprovement.toFixed(1)} Band Improvement
              </div>
            </div>

            {/* After */}
            <div className="text-center">
              <div className="mb-2 text-sm font-medium text-slate-400">
                After Practice
              </div>
              <div className="text-5xl font-bold text-[#DA291C]">
                <AnimatedNumber target={overallAfter} />
              </div>
              <div className="mt-2 text-xs text-slate-400">Final Assessment</div>
            </div>
          </div>
        </div>

        {/* Detailed Comparison */}
        <div className="mb-10">
          <h2 className="mb-5 text-lg font-semibold text-slate-900">
            Detailed Score Comparison
          </h2>
          <div className="space-y-3">
            {rows.map((row) => (
              <ScoreRow key={row.label} {...row} />
            ))}
          </div>
        </div>

        {/* Interview vs Practice Comparison */}
        <AnswerComparison />

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

function AnswerComparison() {
  const [improvements, setImprovements] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  useEffect(() => {
    const interviewTranscripts = getAllTranscripts();
    const practiceTranscripts = getAllPracticeTranscripts();

    if (interviewTranscripts.length === 0 || practiceTranscripts.length === 0) {
      setStatus('done');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    fetch('/api/analyze-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewTranscripts, practiceTranscripts }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.improvements)) {
          setImprovements(data.improvements);
          setStatus('done');
        } else {
          setStatus('error');
        }
      })
      .catch((err) => {
        console.error('Failed to analyze progress:', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="mb-10 rounded-2xl border border-slate-200 bg-white p-8">
        <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <svg className="h-5 w-5 text-[#DA291C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          Your Progress
        </h2>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${85 - i * 10}%` }} />
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400">Analyzing your answers with AI…</p>
      </div>
    );
  }

  if (status === 'error' || improvements.length === 0) {
    return null;
  }

  return (
    <div className="mb-10 rounded-2xl border border-slate-200 bg-white p-8">
      <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
        <svg className="h-5 w-5 text-[#DA291C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
        Your Progress
      </h2>

      <ol className="space-y-4">
        {improvements.map((item, idx) => (
          <li key={idx} className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
              {idx + 1}
            </span>
            <p className="text-sm leading-relaxed text-slate-700">{item}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
