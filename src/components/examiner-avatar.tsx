'use client';

interface ExaminerAvatarProps {
  src: string;
  name: string;
  /** Current phase of the interview */
  phase: string;
}

/**
 * Full-bleed examiner portrait that fills the entire video area.
 * Overlays state indicators on top of the portrait.
 */
export function ExaminerAvatar({ src, name, phase }: ExaminerAvatarProps) {
  const isAsking = phase === 'question' || phase === 'followup';
  const isListening = phase === 'recording' || phase === 'followup-recording';

  return (
    <div className="absolute inset-0">
      {/* Full-bleed portrait */}
      {src ? (
        <img
          src={src}
          alt={`Examiner ${name}`}
          className="w-full h-full object-cover"
          style={{ objectPosition: 'center 30%' }}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center">
          <svg className="w-16 h-16 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        </div>
      )}

      {/* Asking overlay — darkens the portrait so the question text on top of
          it stays readable. No audio-wave animation: nothing is being played. */}
      {isAsking && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      )}

      {/* Listening overlay — subtle warm tint */}
      {isListening && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
      )}

      {/* Bottom info bar — name + status */}
      <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            isAsking ? 'bg-[#DA291C]' :
            isListening ? 'bg-red-500 animate-pulse' :
            'bg-emerald-400'
          }`} />
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{name}</p>
            <p className="text-white/60 text-xs">
              {isAsking ? 'Asking a question' :
               isListening ? 'Listening to you...' :
               'Ready'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
