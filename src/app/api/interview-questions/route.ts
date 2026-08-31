import { NextRequest, NextResponse } from 'next/server';
import { retrieveQuestions, type Question } from '@/lib/rag/retrieval';
import {
  convertPromptToQuestion,
  parseDifficulty,
  pickDiverseQuestions,
} from '@/lib/rag/question-text';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InterviewQuestion {
  questionId: string;
  topic: string;
  question: string;        // Natural language question (converted from prompt)
  originalPrompt: string;  // Raw prompt from question bank
  questionType: string;    // Verb tag from bank
  difficulty: string;
}

interface RequestBody {
  examiner?: {
    personality: string;
    difficulty: string;
  };
  excludeQuestionIds?: string[];
}

// ---------------------------------------------------------------------------
// Fast question selection — no LLM blocking
// ---------------------------------------------------------------------------

/**
 * Build the three interview questions from RAG candidates.
 * Fast path — no LLM call, uses rule-based conversion.
 */
function buildQuestions(candidates: Question[]): InterviewQuestion[] {
  const picked = pickDiverseQuestions(candidates, 3);

  return picked.map((q) => ({
    questionId: q.id,
    topic: q.topic,
    question: convertPromptToQuestion(q),
    originalPrompt: q.question,
    questionType: q.questionType,
    difficulty: q.difficulty,
  }));
}

// ---------------------------------------------------------------------------
// POST handler — fast question selection
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    // The examiner the student picked sets the level of the whole interview.
    // An unrecognised label is refused rather than quietly levelled down to
    // Standard — a candidate who chose Challenging must not be handed a
    // Standard paper without anyone noticing.
    const difficulty = parseDifficulty(body.examiner?.difficulty);
    if (!difficulty) {
      return NextResponse.json({
        error: `Unknown difficulty "${body.examiner?.difficulty}". Expected Easy, Standard or Challenging.`,
        questions: [],
      });
    }

    const excludeIds = body.excludeQuestionIds || [];

    // Step 1: Retrieve candidates from RAG — every candidate is labelled with
    // this difficulty in the question bank, so the three that come out of
    // buildQuestions are at the level the student chose.
    const { questions: candidates } = retrieveQuestions({
      count: 9,
      difficulty,
      excludeIds,
    });

    if (candidates.length < 3) {
      return NextResponse.json({
        error: 'Not enough questions available in the question bank for this difficulty level.',
        questions: [],
      });
    }

    // Step 2: Fast question selection — no LLM blocking
    // Questions are finalized immediately and will not be replaced.
    const questions = buildQuestions(candidates);

    return NextResponse.json({ questions });
  } catch (error) {
    console.error('Interview questions error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      questions: [],
    });
  }
}
