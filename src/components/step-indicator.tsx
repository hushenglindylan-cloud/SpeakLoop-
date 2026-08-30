'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const steps = [
  { label: 'Examiner', path: '/examiner' },
  { label: 'Interview', path: '/interview' },
  { label: 'Evaluation', path: '/evaluation' },
  { label: 'Practice', path: '/practice' },
  { label: 'Final', path: '/final-evaluation' },
];

export function StepIndicator() {
  const pathname = usePathname();
  const currentIndex = steps.findIndex((s) => pathname.startsWith(s.path));

  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2">
      {steps.map((step, index) => {
        const isActive = index === currentIndex;
        const isCompleted = index < currentIndex;
        return (
          <div key={step.path} className="flex items-center gap-1 sm:gap-2">
            <Link
              href={step.path}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all sm:px-3 sm:text-sm',
                isActive && 'bg-[#DA291C] text-white',
                isCompleted && 'bg-[#DA291C]/10 text-[#B91C1C]',
                !isActive && !isCompleted && 'bg-slate-100 text-slate-400'
              )}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px] font-semibold">
                {isCompleted ? '✓' : index + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </Link>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'h-px w-4 sm:w-8',
                  isCompleted ? 'bg-[#DA291C]/30' : 'bg-slate-200'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
