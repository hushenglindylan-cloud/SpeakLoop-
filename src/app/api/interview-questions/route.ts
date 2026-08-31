import { NextRequest, NextResponse } from 'next/server';
import { llmChat } from '@/lib/ai/provider';
import { retrieveQuestions, type Question } from '@/lib/rag/retrieval';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InterviewQuestion {
  questionId: string;
  topic: string;
  question: string;        // Natural language question (LLM-generated from prompt)
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
// Mock fallback (no API key)
// ---------------------------------------------------------------------------

function buildMockQuestions(candidates: Question[]): InterviewQuestion[] {
  // Pick 3 candidates with different topics if possible
  const seen = new Set<string>();
  const picked: Question[] = [];
  for (const q of candidates) {
    if (!seen.has(q.topic) && picked.length < 3) {
      seen.add(q.topic);
      picked.push(q);
    }
  }
  // Fill remaining if needed
  while (picked.length < 3 && picked.length < candidates.length) {
    picked.push(candidates[picked.length]);
  }

  return picked.map((q) => ({
    questionId: q.id,
    topic: q.topic,
    question: convertPromptToQuestion(q),
    originalPrompt: q.question,
    questionType: q.questionType,
    difficulty: q.difficulty,
  }));
}

// Simple rule-based prompt → question conversion for mock mode
function convertPromptToQuestion(q: Question): string {
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

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const difficulty = (body.examiner?.difficulty || 'Standard') as 'Easy' | 'Standard' | 'Challenging';
    const personality = body.examiner?.personality || 'Friendly';
    const excludeIds = body.excludeQuestionIds || [];

    // Step 1: Retrieve candidates from RAG (more than needed for LLM selection)
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

    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      // No API key — use mock conversion
      const questions = buildMockQuestions(candidates);
      return NextResponse.json({ questions, mock: true });
    }

    // Step 2: Use LLM to select 3 diverse questions and convert to natural language
    const systemPrompt = `You are an IELTS Speaking examiner preparing Part 3 questions for a candidate.

You will receive a list of question prompts from the IELTS question bank. Each prompt has:
- A verb tag (e.g., "compare", "evaluate", "agree/disagree") that indicates how to frame the question
- A topic description
- A raw prompt text (NOT a finished question — you must convert it)

Your task:
1. Select exactly 3 prompts that cover DIFFERENT topics (diversity is important)
2. Convert each selected prompt into a natural, spoken English question that an examiner would actually ask
3. The difficulty of the question should match the specified level

Rules for converting prompts to questions:
- The result must sound like a real examiner speaking, not a robot reading a prompt
- Use the verb tag to determine the question format:
  - "agree/disagree" → "To what extent do you agree or disagree that..."
  - "compare" → "How do X and Y compare?" or "What are the differences between..."
  - "evaluate" → "How would you evaluate..." or "What's your evaluation of..."
  - "consider" → "When you consider..., what are your thoughts?"
  - "assess" → "How would you assess..." or "How important is..."
  - "identify" → "What kinds of..." or "Can you identify..."
  - "suggest" → "Why do you think..." or "What would you suggest..."
  - "describe" → "Can you describe..." or "What are..."
  - "discuss" → "What are your thoughts on..." or "How do you feel about..."
  - "comment on" → "What's your view on..." or "How do you feel about..."
- For ${difficulty} level: ${
      difficulty === 'Easy'
        ? 'Use simple, clear language. Short questions. Common vocabulary.'
        : difficulty === 'Challenging'
          ? 'Use sophisticated language. Abstract concepts. Multi-layered questions that require deep thinking.'
          : 'Use standard IELTS-level language. Mix of concrete and abstract topics.'
    }
- The examiner personality is "${personality}" — ${
      personality === 'Strict'
        ? 'be formal and precise in wording'
        : personality === 'Challenging'
          ? 'frame questions that push the candidate to think critically'
          : personality === 'Encouraging'
            ? 'use warm, supportive phrasing'
            : 'be friendly and conversational'
    }

Respond with ONLY a JSON object (no markdown, no fences):
{
  "selected": [
    {
      "index": <0-based index into the input candidates array>,
      "question": "<the natural language question>"
    }
  ]
}`;

    const candidateList = candidates
      .map((c, i) => `[${i}] (${c.questionType}) ${c.topic}: ${c.question}`)
      .join('\n');

    const userPrompt = `Select 3 questions from these candidates:\n\n${candidateList}`;

    let content: string;
    try {
      content = await llmChat({
        systemPrompt,
        userPrompt,
        temperature: 0.7,
        jsonMode: true,
        timeoutMs: 30_000,
      });
    } catch (llmError) {
      console.error('LLM question selection failed:', llmError);
      // Fallback to mock conversion
      const questions = buildMockQuestions(candidates);
      return NextResponse.json({ questions, fallback: true, fallbackStage: 'llm-error' });
    }

    // Parse LLM response
    let selected: Array<{ index: number; question: string }>;
    try {
      const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
      const objectMatch = stripped.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(objectMatch ? objectMatch[0] : stripped);
      selected = parsed.selected || [];
    } catch {
      console.error('Failed to parse LLM question selection:', content.slice(0, 300));
      const questions = buildMockQuestions(candidates);
      return NextResponse.json({ questions, fallback: true, fallbackStage: 'parse-error' });
    }

    // Build final questions
    const questions: InterviewQuestion[] = selected
      .filter((s) => s.index >= 0 && s.index < candidates.length)
      .slice(0, 3)
      .map((s) => {
        const candidate = candidates[s.index];
        return {
          questionId: candidate.id,
          topic: candidate.topic,
          question: s.question,
          originalPrompt: candidate.question,
          questionType: candidate.questionType,
          difficulty: candidate.difficulty,
        };
      });

    if (questions.length < 3) {
      // Fill remaining with mock-converted questions
      const usedIds = new Set(questions.map((q) => q.questionId));
      for (const c of candidates) {
        if (questions.length >= 3) break;
        if (!usedIds.has(c.id)) {
          questions.push({
            questionId: c.id,
            topic: c.topic,
            question: convertPromptToQuestion(c),
            originalPrompt: c.question,
            questionType: c.questionType,
            difficulty: c.difficulty,
          });
          usedIds.add(c.id);
        }
      }
    }

    return NextResponse.json({ questions });
  } catch (error) {
    console.error('Interview questions error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      questions: [],
    });
  }
}
