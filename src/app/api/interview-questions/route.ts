import { NextRequest, NextResponse } from 'next/server';
import { retrieveQuestions, type Question } from '@/lib/rag/retrieval';

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
 * Pick diverse questions from candidates (different topics).
 * Returns up to `count` questions with unique topics.
 */
function pickDiverseQuestions(candidates: Question[], count: number): Question[] {
  const seen = new Set<string>();
  const picked: Question[] = [];

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

/**
 * Build finalized interview questions from RAG candidates.
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
    const difficulty = (body.examiner?.difficulty || 'Standard') as 'Easy' | 'Standard' | 'Challenging';
    const excludeIds = body.excludeQuestionIds || [];

    // Step 1: Retrieve candidates from RAG
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
