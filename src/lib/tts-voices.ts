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
 * WHY ONLY AMERICAN
 * -----------------
 * Every voice in the qwen3-tts-flash catalogue lists English among its
 * supported languages, but that only means it can pronounce English words —
 * the voice's own character still comes through. `Ethan`, for instance, is
 * "标准普通话，带部分北方口音": his English carries a Chinese accent, which is
 * the last thing an IELTS candidate should be practising against. Only two
 * voices in that catalogue are described as native English:
 *   Jennifer — "品牌级、电影质感般美语女声"  (American English, female)
 *   Aiden    — "精通厨艺的美语大男孩"        (American English, male)
 * There is no British, Australian or Indian English voice, so those examiners
 * are not offered rather than being given an American voice.
 *
 * ⚠️ VOICES ARE NOT PORTABLE BETWEEN MODEL FAMILIES. Model Studio rejects a
 * voice from another family with InvalidParameter, and the families are served
 * from different endpoints with different request shapes. Anything added below
 * must belong to the family `synthesizeSpeech()` calls (Qwen-TTS).
 *
 * If British examiners matter enough later, the Qwen-Audio-TTS family has
 * `loongmary` ("温暖英音", British female) alongside `loongeva_v3.6` and
 * `loongjohn` (American female/male). Switching to it means a different
 * endpoint, a WorkspaceId, and Beijing-only availability — and it still has no
 * British male, Australian or Indian voice.
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
  // The only two native-English voices in the qwen3-tts-flash catalogue.
  [key('American', 'Male')]: process.env.NEXT_PUBLIC_TTS_VOICE_AMERICAN_MALE || 'Aiden',
  [key('American', 'Female')]: process.env.NEXT_PUBLIC_TTS_VOICE_AMERICAN_FEMALE || 'Jennifer',

  // No native voice exists for these accents, so their examiners are not
  // offered. Setting one of these variables brings them straight back.
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
