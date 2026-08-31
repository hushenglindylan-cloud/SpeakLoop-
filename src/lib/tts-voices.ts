/**
 * Examiner voice mapping — the single source of truth for which examiners the
 * product can actually offer.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The examiner roster spans four nationalities, but DashScope's stock English
 * voices do not cover four English accents. Shipping a British examiner who
 * speaks with an American accent is a credibility problem for an IELTS product
 * — candidates specifically train against examiner accents. So instead of
 * faking it, an examiner is only selectable when there is a real voice for
 * their (nationality, gender) combination.
 *
 * The examiner list in `mock/data.ts` is left intact; the selection page
 * filters through `isExaminerSupported()`. Adding an accent back is therefore
 * a one-line change here — no examiner data has to be recreated.
 *
 * ⚠️ VERIFY THE VOICE IDS BELOW before shipping.
 * They could not be confirmed against the official Model Studio voice list
 * (help.aliyun.com / alibabacloud.com are unreachable from the environment
 * this was written in), so they are best-effort defaults. Check the voice list
 * in your console and correct them here, or override per-entry with env vars
 * without touching the code.
 */

export type Nationality = 'British' | 'American' | 'Australian' | 'Indian';
export type Gender = 'Male' | 'Female';

function key(nationality: string, gender: string): string {
  return `${nationality}:${gender}`;
}

/**
 * (nationality, gender) → DashScope voice id.
 *
 * Only combinations present here are offered to students. Entries are
 * env-overridable so a wrong voice id can be corrected without a redeploy of
 * changed code: TTS_VOICE_AMERICAN_MALE, TTS_VOICE_BRITISH_FEMALE, etc.
 *
 * Currently only American English is listed, because that is the only accent
 * the stock voices were found to cover. If your console shows a British,
 * Australian or Indian English voice, add it here and those examiners become
 * selectable again automatically.
 */
const VOICE_MAP: Record<string, string | undefined> = {
  // Fill these in from the official Model Studio voice list. Deliberately left
  // empty rather than guessed: a wrong voice id fails at request time, and a
  // plausible-but-wrong one is worse than an obviously missing one.
  [key('American', 'Male')]: process.env.TTS_VOICE_AMERICAN_MALE,
  [key('American', 'Female')]: process.env.TTS_VOICE_AMERICAN_FEMALE,

  [key('British', 'Male')]: process.env.TTS_VOICE_BRITISH_MALE,
  [key('British', 'Female')]: process.env.TTS_VOICE_BRITISH_FEMALE,
  [key('Australian', 'Male')]: process.env.TTS_VOICE_AUSTRALIAN_MALE,
  [key('Australian', 'Female')]: process.env.TTS_VOICE_AUSTRALIAN_FEMALE,
  [key('Indian', 'Male')]: process.env.TTS_VOICE_INDIAN_MALE,
  [key('Indian', 'Female')]: process.env.TTS_VOICE_INDIAN_FEMALE,
};

/** The voice id for an examiner, or undefined when that accent has no voice. */
export function voiceForExaminer(nationality: string, gender: string): string | undefined {
  return VOICE_MAP[key(nationality, gender)] || undefined;
}

/** An examiner can only be offered if their accent and gender have a voice. */
export function isExaminerSupported(examiner: { nationality: string; gender: string }): boolean {
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
