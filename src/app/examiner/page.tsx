'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { examiners, type Examiner } from '@/lib/mock/data';
import { StepIndicator } from '@/components/step-indicator';
import { initSession } from '@/lib/store/interview-session';
import { getExaminerPortrait } from '@/lib/examiner-portraits';
import { isExaminerSupported } from '@/lib/tts-voices';

type FilterKey = 'nationality' | 'gender' | 'personality' | 'difficulty';

// Only examiners with a voice are offered (see lib/tts-voices.ts), so the
// filters are built from that set rather than from a fixed list — otherwise
// the page would advertise, say, a Nationality: British filter that can only
// ever return nothing.
function buildFilters(available: readonly Examiner[]): { key: FilterKey; label: string; options: string[] }[] {
  const optionsFor = (k: FilterKey, order: string[]) =>
    order.filter((option) => available.some((e) => e[k] === option));

  const all: { key: FilterKey; label: string; options: string[] }[] = [
    { key: 'nationality', label: 'Nationality', options: optionsFor('nationality', ['British', 'American', 'Australian', 'Indian']) },
    { key: 'gender', label: 'Gender', options: optionsFor('gender', ['Male', 'Female']) },
    { key: 'personality', label: 'Personality', options: optionsFor('personality', ['Strict', 'Friendly', 'Encouraging', 'Challenging']) },
    { key: 'difficulty', label: 'Difficulty', options: optionsFor('difficulty', ['Easy', 'Standard', 'Challenging']) },
  ];
  // A filter with a single option filters nothing — drop it rather than show
  // a row the student can only toggle uselessly.
  return all.filter((f) => f.options.length > 1);
}

const personalityColors: Record<string, string> = {
  Strict: 'bg-red-50 text-red-700 border-red-200',
  Friendly: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Encouraging: 'bg-amber-50 text-amber-700 border-amber-200',
  Challenging: 'bg-purple-50 text-purple-700 border-purple-200',
};

const nationalityFlags: Record<string, string> = {
  British: '🇬🇧',
  American: '🇺🇸',
  Australian: '🇦🇺',
  Indian: '🇮🇳',
};

export default function ExaminerPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<Examiner | null>(null);
  const [activeFilters, setActiveFilters] = useState<Record<FilterKey, string | null>>({
    nationality: null,
    gender: null,
    personality: null,
    difficulty: null,
  });

  // Only examiners whose accent and gender have a real voice are offered. An
  // IELTS candidate hearing an American voice from a British examiner is worse
  // than not being offered the British examiner at all — see lib/tts-voices.ts.
  const selectable = examiners.filter(isExaminerSupported);
  const filters = buildFilters(selectable);

  const filtered = selectable.filter((e) =>
    Object.entries(activeFilters).every(
      ([key, val]) => val === null || e[key as FilterKey] === val
    )
  );

  const toggleFilter = (key: FilterKey, value: string) => {
    setActiveFilters((prev) => ({
      ...prev,
      [key]: prev[key] === value ? null : value,
    }));
  };

  const [micPermission, setMicPermission] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');

  const handleStartInterview = async () => {
    if (!selected) return;
    
    setMicPermission('requesting');
    
    try {
      // Request microphone permission before entering interview
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately, we just needed the permission
      stream.getTracks().forEach(track => track.stop());
      setMicPermission('granted');
      
      // Initialize session
      initSession(selected.id, selected.name, selected.personality, selected.difficulty);
      
      // Navigate to interview
      router.push('/interview');
    } catch (err) {
      setMicPermission('denied');
      console.error('Microphone permission denied:', err);
    }
  };

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

      <main className="mx-auto max-w-6xl px-6 py-12">
        {/* Title */}
        <div className="mb-10 text-center">
          <h1 className="mb-3 text-3xl font-bold text-slate-900">
            Choose Your Examiner
          </h1>
          <p className="text-slate-500">
            Select an AI examiner to begin your Part 3 mock interview
          </p>
        </div>

        {/* Filters */}
        <div className="mb-10 space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-6">
          {filters.map((filter) => (
            <div key={filter.key} className="flex flex-wrap items-center gap-3">
              <span className="w-28 text-sm font-medium text-slate-500">
                {filter.label}
              </span>
              <div className="flex flex-wrap gap-2">
                {filter.options.map((option) => (
                  <button
                    key={option}
                    onClick={() => toggleFilter(filter.key, option)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${
                      activeFilters[filter.key] === option
                        ? 'border-[#DA291C] bg-[#DA291C] text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {filter.key === 'nationality' && nationalityFlags[option]}{' '}
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Results count */}
        <div className="mb-4 text-sm text-slate-500">
          Showing <span className="font-semibold text-slate-700">{filtered.length}</span> examiners
        </div>

        {/* Examiner Grid */}
        <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((examiner) => (
            <button
              key={examiner.id}
              onClick={() => setSelected(examiner)}
              className={`group rounded-2xl border p-6 text-left transition-all hover:shadow-lg ${
                selected?.id === examiner.id
                  ? 'border-[#DA291C] bg-red-50/30 ring-2 ring-[#DA291C]/20'
                  : 'border-slate-100 bg-white hover:border-slate-200'
              }`}
            >
              <div className="mb-4 flex items-center gap-4">
                <div className="h-14 w-14 rounded-full overflow-hidden border-2 border-slate-100 flex-shrink-0">
                  <img
                    src={getExaminerPortrait(examiner.id)}
                    alt={examiner.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">
                    {examiner.name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{nationalityFlags[examiner.nationality]} {examiner.nationality}</span>
                    <span>·</span>
                    <span>{examiner.ethnicity}</span>
                  </div>
                </div>
              </div>
              <p className="mb-3 text-sm leading-relaxed text-slate-500">
                {examiner.bio}
              </p>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded-md border px-2 py-0.5 text-xs font-medium ${personalityColors[examiner.personality]}`}
                >
                  {examiner.personality}
                </span>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {examiner.difficulty}
                </span>
              </div>
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="py-16 text-center text-slate-400">
            No examiners match your current filters. Try adjusting them.
          </div>
        )}

        {/* CTA */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleStartInterview}
            disabled={!selected || micPermission === 'requesting'}
            className={`rounded-xl px-10 py-3.5 text-base font-semibold transition-all ${
              selected && micPermission !== 'requesting'
                ? 'bg-[#DA291C] text-white shadow-lg shadow-[#DA291C]/20 hover:bg-[#B91C1C] hover:shadow-xl'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'
            }`}
          >
            {micPermission === 'requesting'
              ? 'Requesting Microphone Access...'
              : selected
                ? `Start Interview with ${selected.name.split(' ').pop()} →`
                : 'Select an Examiner to Continue'}
          </button>
          {micPermission === 'denied' && (
            <p className="text-sm text-red-600">
              Microphone access is required. Please allow microphone permission in your browser settings and try again.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
