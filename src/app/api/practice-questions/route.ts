import { NextRequest, NextResponse } from 'next/server';
import { llmChat } from '@/lib/ai/provider';
import { retrieveQuestions } from '@/lib/rag/retrieval';

/**
 * POST /api/practice-questions
 *
 * Generates targeted practice questions based on the user's evaluation results.
 * Focuses on their weakest areas (criteria) with questions designed to exercise
 * those specific skills.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      weakness,           // e.g., "lexical resource" or "fluency and coherence"
      improvementFocus,   // e.g., "Use more precise vocabulary"
      criteriaScores,     // { fluencyCoherence, lexicalResource, grammaticalRange, pronunciation }
      personality,
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

    // Retrieve candidate questions from RAG, excluding anything already asked
    // in this student's interview so Practice doesn't repeat the same prompts.
    const diff = (difficulty || 'Standard') as 'Easy' | 'Standard' | 'Challenging';
    const { questions: candidates } = retrieveQuestions({
      count: 12,
      difficulty: diff,
      excludeIds: excludeQuestionIds || [],
    });

    if (candidates.length < 3) {
      return NextResponse.json({
        error: 'Not enough questions available.',
        questions: [],
      });
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      // Mock mode: pick 3 diverse questions with hints
      const picked = pickDiverse(candidates, 3);
      return NextResponse.json({
        questions: picked.map((q, i) => ({
          questionId: q.id,
          topic: q.topic,
          question: convertToQuestion(q.question, q.questionType),
          followUp: generateMockFollowUp(i),
          contextHint: generateMockHint(weakness, i),
        })),
        mock: true,
      });
    }

    // Build the weakness context for the LLM
    const weaknessContext = buildWeaknessContext(weakness, improvementFocus, criteriaScores);

    const systemPrompt = `You are an IELTS Speaking examiner creating targeted practice questions for a student who needs to improve in specific areas.

${weaknessContext}

You will receive candidate question prompts from the IELTS question bank. Your task:
1. Select exactly 3 prompts that cover DIFFERENT topics
2. Convert each into a natural spoken English question
3. For each question, generate a follow-up that specifically exercises the student's weak area
4. Provide a context hint explaining how this question helps them practice their weakness

The difficulty level is "${diff}" — ${
      diff === 'Easy'
        ? 'Use simple, clear language.'
        : diff === 'Challenging'
          ? 'Use sophisticated, abstract language.'
          : 'Use standard IELTS-level language.'
    }

The examiner personality is "${personality || 'Friendly'}" — adapt tone accordingly.`;

    const candidateList = candidates
      .map(
        (q, i) =>
          `[${i}] topic="${q.topic}" verb="${q.questionType}" prompt="${q.question}"`
      )
      .join('\n');

    const userPrompt = `Candidate questions from the bank:
${candidateList}

Return a JSON object with this exact structure:
{
  "selected": [
    {
      "index": <0-based index>,
      "question": "<natural language question>",
      "followUp": "<targeted follow-up question>",
      "contextHint": "<1-2 sentences explaining how this helps practice the weakness>"
    }
  ]
}

Select 3 questions with different topics. Return ONLY valid JSON.`;

    const result = await llmChat({
      systemPrompt,
      userPrompt,
      temperature: 0.7,
      jsonMode: true,
      timeoutMs: 60_000, // 60 seconds for practice questions generation
    });

    let parsed: { selected?: Array<{ index: number; question: string; followUp: string; contextHint: string }> };
    try {
      parsed = JSON.parse(result);
    } catch {
      // Try to extract JSON from the response
      const match = result.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { selected: undefined };
    }

    if (!parsed.selected || parsed.selected.length === 0) {
      throw new Error('No questions selected by LLM');
    }

    const questions = parsed.selected.map((s) => ({
      questionId: candidates[s.index]?.id || `practice-${s.index}`,
      topic: candidates[s.index]?.topic || 'General',
      question: s.question,
      followUp: s.followUp,
      contextHint: s.contextHint,
    }));

    return NextResponse.json({ questions });
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

function buildWeaknessContext(
  weakness?: string,
  improvementFocus?: string,
  criteriaScores?: Record<string, { band: number }>
): string {
  if (!weakness && !criteriaScores) {
    return 'The student wants general IELTS Speaking Part 3 practice.';
  }

  let context = 'STUDENT PROFILE:\n';

  if (criteriaScores) {
    context += 'Criteria scores:\n';
    const labels: Record<string, string> = {
      fluencyCoherence: 'Fluency & Coherence',
      lexicalResource: 'Lexical Resource',
      grammaticalRangeAccuracy: 'Grammatical Range & Accuracy',
      pronunciation: 'Pronunciation',
    };
    for (const [key, score] of Object.entries(criteriaScores)) {
      const label = labels[key] || key;
      context += `- ${label}: Band ${score.band}\n`;
    }
  }

  if (weakness) {
    context += `\nWeakest area: ${weakness}`;
  }
  if (improvementFocus) {
    context += `\nImprovement focus: ${improvementFocus}`;
  }

  context += '\n\nDesign questions that specifically help the student practice and improve in their weak area.';
  return context;
}

function pickDiverse<T extends { topic: string }>(items: T[], count: number): T[] {
  const seen = new Set<string>();
  const picked: T[] = [];
  for (const item of items) {
    if (!seen.has(item.topic) && picked.length < count) {
      seen.add(item.topic);
      picked.push(item);
    }
  }
  while (picked.length < count && picked.length < items.length) {
    picked.push(items[picked.length]);
  }
  return picked;
}

function convertToQuestion(text: string, verb: string): string {
  if (text.endsWith('?')) return text;
  const v = verb.toLowerCase();
  switch (v) {
    case 'agree/disagree':
      return `To what extent do you agree or disagree: ${text}?`;
    case 'compare':
      return `How do the different aspects of ${text} compare?`;
    case 'discuss':
      return `What are your thoughts on: ${text}?`;
    case 'evaluate':
      return `How would you evaluate: ${text}?`;
    default:
      return `What are your views on: ${text}?`;
  }
}

function generateMockFollowUp(index: number): string {
  const followUps = [
    'Can you give a more specific example using precise vocabulary?',
    'How would you explain this idea using more complex sentence structures?',
    'Can you elaborate on this point with greater fluency and fewer pauses?',
  ];
  return followUps[index % followUps.length];
}

function generateMockHint(weakness?: string, index?: number): string {
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
  return pool[(index || 0) % pool.length];
}
