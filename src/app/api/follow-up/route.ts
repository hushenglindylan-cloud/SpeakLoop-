import { NextRequest, NextResponse } from 'next/server';
import { llmChat } from '@/lib/ai/provider';

/**
 * POST /api/follow-up
 *
 * Generates a contextual follow-up question based on the user's answer
 * to the main question. The follow-up should feel like a natural IELTS
 * examiner probing deeper.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mainQuestion, answer, topic, examinerPersonality } = body as {
      mainQuestion: string;
      answer: string;
      topic: string;
      examinerPersonality?: string;
    };

    if (!mainQuestion || !answer) {
      return NextResponse.json(
        { error: 'mainQuestion and answer are required' },
        { status: 400 }
      );
    }

    // If no API key, return a rule-based fallback
    if (!process.env.DASHSCOPE_API_KEY) {
      return NextResponse.json({
        followUp: generateFallbackFollowUp(mainQuestion),
      });
    }

    const personalityHint = examinerPersonality
      ? `\nExaminer personality: ${examinerPersonality}. Adapt your tone accordingly.`
      : '';

    const systemPrompt = `You are an IELTS Speaking examiner conducting Part 3 of the test. You ask natural, contextual follow-up questions that probe deeper into the candidate's answer.${personalityHint}`;

    const userPrompt = `Main question you asked: "${mainQuestion}"
Topic: ${topic}
Candidate's answer: "${answer}"

Generate ONE natural follow-up question. Rules:
1. It must be a REAL question (ending with ?), not a statement
2. Reference something specific the candidate said
3. Ask them to elaborate, give an example, consider a different angle, or explain reasoning
4. Keep it concise (1-2 sentences), natural spoken English
5. Do NOT repeat the main question
6. Sound like a real examiner — professional but conversational

Return ONLY the follow-up question text, nothing else.`;

    const followUpRaw = await llmChat({
      systemPrompt,
      userPrompt,
      temperature: 0.8,
    });

    const followUp = followUpRaw.trim().replace(/^["']|["']$/g, '');

    return NextResponse.json({ followUp });
  } catch (error) {
    console.error('Follow-up generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate follow-up question' },
      { status: 500 }
    );
  }
}

function generateFallbackFollowUp(mainQuestion: string): string {
  const fallbacks = [
    'Can you give a specific example to support your point?',
    'What about the opposite perspective — do you see any merit in it?',
    'How do you think this might change in the future?',
    'Do you think this applies equally to people of all ages?',
    'What role do you think technology plays in this?',
  ];
  // Pick based on question hash for variety
  const hash = mainQuestion.length % fallbacks.length;
  return fallbacks[hash];
}
