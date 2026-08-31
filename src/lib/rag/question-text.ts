// Turning question-bank rows into the questions a student actually hears.
//
// Interview and Practice both draw from the same bank and must ask at the
// level the student chose when they picked their examiner, so they share one
// converter rather than keeping a copy each. The wording a student hears is
// the bank's own prompt wrapped in a question frame — nothing rewrites it on
// the way out, because a rewrite is exactly where the difficulty a row is
// labelled with and the difficulty the student experiences drift apart.

import type { Question } from './retrieval';

/** The difficulty labels used by both the examiner roster and the question bank. */
export const DIFFICULTIES = ['Easy', 'Standard', 'Challenging'] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Read a difficulty coming in over the wire.
 *
 * Returns `null` for a value that is not one of the three labels, so the
 * caller can refuse the request. Falling back to 'Standard' instead would
 * hand an Easy or Challenging candidate a Standard paper without anyone —
 * student or developer — being able to see that it happened.
 */
export function parseDifficulty(value: string | undefined | null, fallback: Difficulty = 'Standard'): Difficulty | null {
  if (value === undefined || value === null || value === '') return fallback;
  return (DIFFICULTIES as readonly string[]).includes(value) ? (value as Difficulty) : null;
}

/**
 * Pick `count` questions covering different topics.
 * Falls back to repeating topics only if the candidate pool is too narrow.
 */
export function pickDiverseQuestions<T extends { topic: string }>(candidates: T[], count: number): T[] {
  const seen = new Set<string>();
  const picked: T[] = [];

  for (const q of candidates) {
    if (!seen.has(q.topic) && picked.length < count) {
      seen.add(q.topic);
      picked.push(q);
    }
  }

  // Fill remaining if needed (topics may repeat)
  while (picked.length < count && picked.length < candidates.length) {
    picked.push(candidates[picked.length]);
  }

  return picked;
}

/**
 * Convert a raw question bank prompt into a natural spoken English question.
 * Uses the verb tag (questionType) to determine the question format.
 */
export function convertPromptToQuestion(q: Question): string {
  const text = q.question;
  const verb = q.questionType.toLowerCase();

  // If it already looks like a question, return as-is
  if (text.endsWith('?')) return text;

  switch (verb) {
    case 'agree/disagree':
      return `To what extent do you agree or disagree: ${text}?`;
    case 'compare':
      return `What are the differences between the aspects mentioned: ${text}?`;
    case 'consider':
      return `Consider the following: ${text}. What are your thoughts?`;
    case 'evaluate':
      return `How would you evaluate: ${text}?`;
    case 'assess':
      return `How would you assess: ${text}?`;
    case 'identify':
      return `Can you identify: ${text}?`;
    case 'suggest':
      return `Can you suggest: ${text}?`;
    case 'describe':
      return `Can you describe: ${text}?`;
    case 'discuss':
      return `Let's discuss: ${text}. What do you think?`;
    case 'comment on':
      return `What is your comment on: ${text}?`;
    case 'explain':
      return `Can you explain: ${text}?`;
    case 'justify':
      return `How would you justify: ${text}?`;
    case 'outline':
      return `Can you outline: ${text}?`;
    case 'give reasons':
      return `What are the reasons for: ${text}?`;
    default:
      return `What are your thoughts on: ${text}?`;
  }
}
