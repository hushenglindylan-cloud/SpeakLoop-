/**
 * Examiner voice mapping — the single source of truth for which examiners the
 * product can offer, and which voice each one speaks with.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The examiner roster spans four nationalities, but DashScope's stock English
 * voices do not cover four English accents. Shipping a British examiner who
 * speaks with an American accent is a credibility problem for an IELTS product
 * — candidates specifically train against examiner accents. So an examiner is
 * only offered when a real voice exists for their (nationality, gender).
 *
 * The examiner list in `mock/data.ts` is left intact; the selection page
 * filters through `isExaminerSupported()`. Restoring an accent is therefore a
 * one-line change here — no examiner data has to be recreated.
 *
 * ⚠️ FILL IN THE VOICE IDS BELOW from the Model Studio voice list
 * (Qwen-TTS 音色列表). They are deliberately blank rather than guessed: a
 * plausible-but-wrong id fails at request time and is harder to spot than an
 * obviously missing one.
 *
 * This module is imported by client components, so it must not depend on
 * server-only configuration — the overrides use the NEXT_PUBLIC_ prefix, which
 * Next.js inlines into the browser bundle. Voice ids are not secrets.
 */

export type Nationality = 'British' | 'American' | 'Australian' | 'Indian';
export type Gender = 'Male' | 'Female';

function key(nationality: string, gender: string): string {
  return `${nationality}:${gender}`;
}

/**
 * (nationality, gender) → DashScope voice id.
 *
 * Add a voice id here (or set the matching NEXT_PUBLIC_TTS_VOICE_* variable)
 * and those examiners immediately become selectable and speak with it.
 */
const VOICE_MAP: Record<string, string | undefined> = {
  [key('American', 'Male')]: process.env.NEXT_PUBLIC_TTS_VOICE_AMERICAN_MALE,
  [key('American', 'Female')]: process.env.NEXT_PUBLIC_TTS_VOICE_AMERICAN_FEMALE,
  [key('British', 'Male')]: process.env.NEXT_PUBLIC_TTS_VOICE_BRITISH_MALE,
  [key('British', 'Female')]: process.env.NEXT_PUBLIC_TTS_VOICE_BRITISH_FEMALE,
  [key('Australian', 'Male')]: process.env.NEXT_PUBLIC_TTS_VOICE_AUSTRALIAN_MALE,
  [key('Australian', 'Female')]: process.env.NEXT_PUBLIC_TTS_VOICE_AUSTRALIAN_FEMALE,
  [key('Indian', 'Male')]: process.env.NEXT_PUBLIC_TTS_VOICE_INDIAN_MALE,
  [key('Indian', 'Female')]: process.env.NEXT_PUBLIC_TTS_VOICE_INDIAN_FEMALE,
};

/**
 * True once at least one voice is configured.
 *
 * Until then the product predates its own voice support, and filtering
 * examiners by voice would leave the student with an empty examiner list and
 * no way to start an interview at all. A silent interview that falls back to
 * showing the question as text is far better than a dead app, so while nothing
 * is configured every examiner stays selectable.
 */
export function isVoiceMappingConfigured(): boolean {
  return Object.values(VOICE_MAP).some(Boolean);
}

/** The voice id for an examiner, or undefined when that accent has no voice. */
export function voiceForExaminer(nationality: string, gender: string): string | undefined {
  return VOICE_MAP[key(nationality, gender)] || undefined;
}

/** Whether this examiner can be offered to a student. */
export function isExaminerSupported(examiner: { nationality: string; gender: string }): boolean {
  if (!isVoiceMappingConfigured()) return true;
  return Boolean(voiceForExaminer(examiner.nationality, examiner.gender));
}

/** Nationalities that currently have at least one usable voice. */
export function supportedNationalities(): string[] {
  const found = new Set<string>();
  for (const [k, voice] of Object.entries(VOICE_MAP)) {
    if (voice) found.add(k.split(':')[0]);
  }
  return Array.from(found).sort();
}
