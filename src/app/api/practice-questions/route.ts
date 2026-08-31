import { NextRequest, NextResponse } from 'next/server';
import { retrieveQuestions } from '@/lib/rag/retrieval';
import {
  convertPromptToQuestion,
  parseDifficulty,
  pickDiverseQuestions,
} from '@/lib/rag/question-text';

/**
 * POST /api/practice-questions
 *
 * Picks the three practice questions, at the difficulty of the examiner the
 * student chose and excluding everything their interview already asked.
 *
 * Selection is rule-based, the same path the interview takes. It used to run
 * through an LLM that rewrote each prompt around the student's weak criterion:
 * that cost several seconds before practice could start, and a rewritten
 * prompt is no longer the prompt the bank graded as Easy/Standard/Challenging,
 * so the level the student practised at drifted away from the level they
 * picked. The weakness now steers the coaching hint instead of the wording,
 * which is where the student actually reads it.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      weakness,           // e.g., "lexical resource" or "fluency and coherence"
      difficulty,
      excludeQuestionIds, // question bank IDs already asked in the interview — avoid repeats
    } = body as {
      weakness?: string;
      improvementFocus?: string;
      criteriaScores?: Record<string, { band: number }>;
      personality?: string;
      difficulty?: string;
      excludeQuestionIds?: string[];
    };

    // Same rule as the interview: an unrecognised label is refused rather than
    // quietly levelled down to Standard.
    const diff = parseDifficulty(difficulty);
    if (!diff) {
      return NextResponse.json({
        error: `Unknown difficulty "${difficulty}". Expected Easy, Standard or Challenging.`,
        questions: [],
      });
    }

    // Retrieve candidate questions from RAG, excluding anything already asked
    // in this student's interview so Practice doesn't repeat the same prompts.
    const { questions: candidates } = retrieveQuestions({
      count: 12,
      difficulty: diff,
      excludeIds: excludeQuestionIds || [],
    });

    if (candidates.length < 3) {
      return NextResponse.json({
        error: 'Not enough questions available in the question bank for this difficulty level.',
        questions: [],
      });
    }

    const picked = pickDiverseQuestions(candidates, 3);

    return NextResponse.json({
      questions: picked.map((q, i) => ({
        questionId: q.id,
        topic: q.topic,
        question: convertPromptToQuestion(q),
        difficulty: q.difficulty,
        contextHint: hintForWeakness(weakness, i),
      })),
    });
  } catch (error) {
    console.error('Practice questions error:', error);
    return NextResponse.json(
      { error: 'Failed to generate practice questions' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The one line of coaching shown above each practice question, chosen for the
 * criterion the student scored worst on. Three per criterion so the three
 * questions in a session don't all say the same thing.
 */
function hintForWeakness(weakness: string | undefined, index: number): string {
  if (!weakness) {
    return 'This question helps you practice expressing complex ideas clearly.';
  }
  const hints: Record<string, string[]> = {
    'lexical resource': [
      'Focus on using topic-specific vocabulary and avoiding repetition.',
      'Try to use collocations and less common words naturally.',
      'Practice paraphrasing when you cannot recall the exact word.',
    ],
    'fluency and coherence': [
      'Focus on speaking at length without hesitation or repetition.',
      'Use discourse markers to connect your ideas logically.',
      'Practice extending your answers with examples and reasons.',
    ],
    'grammatical range and accuracy': [
      'Try to use a mix of simple and complex sentence structures.',
      'Focus on accurate use of conditional and relative clauses.',
      'Practice using passive voice and inversion for variety.',
    ],
    pronunciation: [
      'Focus on clear word stress and sentence rhythm.',
      'Practice linking words together naturally.',
      'Pay attention to intonation patterns in longer sentences.',
    ],
  };
  const key = Object.keys(hints).find((k) => weakness.toLowerCase().includes(k)) || 'lexical resource';
  const pool = hints[key];
  return pool[index % pool.length];
}
