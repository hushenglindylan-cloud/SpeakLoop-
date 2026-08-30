'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mockEvaluation } from '@/lib/mock/data';
import { StepIndicator } from '@/components/step-indicator';
import { getAllTranscripts } from '@/lib/store/interview-session';

function AnimatedScore({ target, duration = 1500 }: { target: number; duration?: number }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * target;
      // For individual scores (integers), show as integer
      // For overall (can be .5), show with .5 precision
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

function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
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

export default function EvaluationPage() {
  const router = useRouter();
  const { scores, evidence } = mockEvaluation;
  
  // Get student's actual answers from interview session
  const transcripts = getAllTranscripts();

  const criteria = [
    { label: 'Fluency & Coherence', score: scores.fluencyCoherence },
    { label: 'Lexical Resource', score: scores.lexicalResource },
    { label: 'Grammatical Range & Accuracy', score: scores.grammaticalRange },
    { label: 'Pronunciation', score: scores.pronunciation },
  ];

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
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Overall Score */}
          <div className="lg:col-span-1">
            <div className="sticky top-8 rounded-2xl border border-slate-100 bg-slate-50 p-8 text-center">
              <div className="mb-2 text-sm font-medium text-slate-500">
                Overall Band Score
              </div>
              <div className="mb-4 text-6xl font-bold text-[#DA291C]">
                <AnimatedScore target={scores.overallBand} />
              </div>
              <p className="mb-4 text-xs text-slate-400">
                Individual scores are integers (1-9). Overall band is rounded down to nearest 0.5.
              </p>

              {/* Criteria Bars */}
              <div className="space-y-4 text-left">
                {criteria.map((c) => (
                  <ScoreBar
                    key={c.label}
                    label={c.label}
                    score={c.score}
                    color={getScoreColor(c.score)}
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
                {evidence.map((item, i) => (
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

            {/* Answer Review - Interleaved Questions, Answers, and Improvements */}
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
                    // Get the question label
                    const questionLabel = t.questionType === 'followup' 
                      ? 'Follow-up'
                      : `Q${Math.floor(idx / 2) + 1}`;
                    
                    // Generate improved version based on student's answer
                    const improvedText = t.answer.length > 0 
                      ? `[Improved version - more natural expressions, better vocabulary, clearer structure]`
                      : '';
                    
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
                        
                        {/* Improved Version */}
                        {improvedText && (
                          <div>
                            <h4 className="mb-1.5 text-xs font-semibold text-emerald-700">Improved version:</h4>
                            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-4">
                              <p className="text-sm leading-relaxed text-emerald-800">
                                {improvedText}
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
