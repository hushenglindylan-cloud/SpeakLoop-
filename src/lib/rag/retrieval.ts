// RAG retrieval service for SpeakLoop
// Plan A: Structured metadata filtering (no vector search)
//
// Retrieves IELTS Part 3 questions from the local question bank
// based on topic, difficulty, and exclusion criteria.

import questions from '@/data/questions.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Question {
  id: string;
  part: number;
  topic: string;
  source: string;
  difficulty: 'Easy' | 'Standard' | 'Challenging';
  questionType: string; // verb tag: identify, suggest, compare, evaluate, agree/disagree, discuss, etc.
  question: string;     // raw prompt (not yet converted to natural language question)
}

export interface RetrievalParams {
  /** Number of questions to return */
  count?: number;
  /** Filter by topic (partial match, case-insensitive) */
  topic?: string;
  /** Filter by difficulty */
  difficulty?: 'Easy' | 'Standard' | 'Challenging';
  /** Question IDs to exclude (already used in this session) */
  excludeIds?: string[];
  /** Filter by question type / verb */
  questionType?: string;
  /** Random seed for reproducibility (optional) */
  seed?: number;
}

export interface RetrievalResult {
  questions: Question[];
  totalAvailable: number;
  filters: {
    topic?: string;
    difficulty?: string;
    excluded: number;
  };
}

// ---------------------------------------------------------------------------
// Seeded random for reproducible shuffling
// ---------------------------------------------------------------------------

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core retrieval
// ---------------------------------------------------------------------------

const allQuestions = questions as Question[];

/**
 * Retrieve questions from the bank based on metadata filters.
 *
 * This is Plan A (structured retrieval) — no vector search.
 * For the question bank size (~1000 questions), metadata filtering
 * is sufficient and faster than embedding-based retrieval.
 */
export function retrieveQuestions(params: RetrievalParams = {}): RetrievalResult {
  const {
    count = 3,
    topic,
    difficulty,
    excludeIds = [],
    questionType,
    seed,
  } = params;

  const excludeSet = new Set(excludeIds);

  // Start with all Part 3 questions
  let candidates = allQuestions.filter((q) => q.part === 3);

  // Apply filters
  if (topic) {
    const topicLower = topic.toLowerCase();
    candidates = candidates.filter(
      (q) =>
        q.topic.toLowerCase().includes(topicLower) ||
        q.source.toLowerCase().includes(topicLower)
    );
  }

  if (difficulty) {
    candidates = candidates.filter((q) => q.difficulty === difficulty);
  }

  if (questionType) {
    const typeLower = questionType.toLowerCase();
    candidates = candidates.filter((q) =>
      q.questionType.toLowerCase().includes(typeLower)
    );
  }

  // Exclude already-used questions
  const beforeExclusion = candidates.length;
  candidates = candidates.filter((q) => !excludeSet.has(q.id));

  // Shuffle for variety
  const rng = seed !== undefined ? seededRandom(seed) : Math.random;
  candidates = shuffle(candidates, rng);

  // Take the requested count
  const selected = candidates.slice(0, count);

  return {
    questions: selected,
    totalAvailable: candidates.length,
    filters: {
      topic,
      difficulty,
      excluded: beforeExclusion - candidates.length,
    },
  };
}

/**
 * Get all available topics in the question bank.
 */
export function getAvailableTopics(): string[] {
  const topics = new Set(allQuestions.map((q) => q.topic));
  return Array.from(topics).sort();
}

/**
 * Get question count statistics.
 */
export function getQuestionStats(): Record<string, number> {
  const stats: Record<string, number> = { total: allQuestions.length };

  for (const q of allQuestions) {
    stats[`difficulty_${q.difficulty}`] = (stats[`difficulty_${q.difficulty}`] || 0) + 1;
  }

  const topics = new Set(allQuestions.map((q) => q.topic));
  stats.topics = topics.size;

  return stats;
}

/**
 * Find a specific question by ID.
 */
export function getQuestionById(id: string): Question | undefined {
  return allQuestions.find((q) => q.id === id);
}
