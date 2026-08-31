/**
 * Examiner voice mapping — which voice each examiner speaks with.
 *
 * WHY ONLY AMERICAN
 * -----------------
 * The roster used to span four nationalities, but DashScope's English voices
 * do not cover four English accents, and an IELTS candidate hearing an
 * American voice from a British examiner is worse than not being offered that
 * examiner at all — candidates train against examiner accents specifically.
 * The roster is now American-only (see mock/data.ts) and nationality is no
 * longer a field, so a voice is chosen by gender alone.
 *
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
 * If accents matter enough to revisit later, the Qwen-Audio-TTS family has
 * `loongmary` ("温暖英音", British female) alongside `loongeva_v3.6` and
 * `loongjohn` (American female/male). Adopting it means a different endpoint,
 * a WorkspaceId and Beijing-only availability — and it still has no British
 * male, Australian or Indian voice, so bringing those examiners back would
 * mean restoring a nationality field as well.
 *
 * This module is imported by client components, so it must not depend on
 * server-only configuration — the overrides use the NEXT_PUBLIC_ prefix, which
 * Next.js inlines into the browser bundle. Voice ids are not secrets.
 */

export type Gender = 'Male' | 'Female';

/**
 * gender → DashScope voice id. The two native-English voices in the
 * qwen3-tts-flash catalogue, overridable without a code change.
 */
const VOICE_MAP: Record<string, string | undefined> = {
  Male: process.env.NEXT_PUBLIC_TTS_VOICE_MALE || 'Aiden',
  Female: process.env.NEXT_PUBLIC_TTS_VOICE_FEMALE || 'Jennifer',
};

/**
 * The voice id for an examiner, or undefined if that gender has no voice.
 *
 * The lookup is case-insensitive on purpose. The keys above are spelled the
 * way the roster spells them ('Male' / 'Female'), and a caller that passed a
 * normalised 'female' used to get no voice at all — which reaches the student
 * as an examiner who silently stops speaking, the hardest failure to diagnose
 * from the outside.
 */
export function voiceForExaminer(gender: string): string | undefined {
  const normalized = gender.trim().toLowerCase();
  if (normalized === 'male') return VOICE_MAP.Male;
  if (normalized === 'female') return VOICE_MAP.Female;
  return undefined;
}

/** Whether this examiner can be offered to a student. */
export function isExaminerSupported(examiner: { gender: string }): boolean {
  return Boolean(voiceForExaminer(examiner.gender));
}
