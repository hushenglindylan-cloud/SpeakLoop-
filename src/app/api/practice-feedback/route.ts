import { NextRequest, NextResponse } from 'next/server';
import { llmChat } from '@/lib/ai/provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PracticeFeedbackRequestBody {
  question: string;
  answer: string;
  weakness?: string;
  improvementFocus?: string;
  criteriaScores?: Record<string, number>;
  previousFeedback?: string; // For retry attempts
}

// ---------------------------------------------------------------------------
// System prompt — Practice Feedback
// ---------------------------------------------------------------------------

function buildFeedbackSystemPrompt(): string {
  return `You are a supportive IELTS Speaking coach providing immediate feedback on a practice answer.

Your feedback must be:
- CONCISE: 3 short sections, each 1-2 sentences maximum
- SPECIFIC: Reference actual words/phrases from the student's answer
- FOCUSED: Address ONLY the student's identified weakness area
- ENCOURAGING: Acknowledge what they did well before suggesting improvements
- ACTIONABLE: Give one clear thing to try next time

## Feedback Structure

Return a JSON object with exactly these fields:

{
  "positive": "<What they did well — acknowledge effort or a specific strength>",
  "improve": "<ONE specific thing to fix, related to their weakness area>",
  "tryNext": "<A concrete suggestion for their next attempt — something they can immediately apply>"
}

## Rules by Weakness Area

If weakness is "Lexical Resource" or contains "lexical":
- Focus on word choice, repetition, paraphrasing
- Suggest 1-2 specific word replacements if appropriate
- Do NOT suggest advanced/academic vocabulary unless the student already uses basic forms correctly

If weakness is "Fluency and Coherence" or contains "fluency":
- Focus on flow, connecting ideas, extending answers
- Suggest using simple connectors (because, so, also, but)
- Do NOT require complex discourse markers

If weakness is "Grammatical Range" or contains "grammatical":
- Focus on ONE grammar issue (tense, agreement, articles, etc.)
- Do NOT list multiple grammar problems
- Keep suggestions simple and achievable

If weakness is "Pronunciation" or contains "pronunciation":
- Note: You only have transcript text, not audio
- Focus on word stress patterns or sentence rhythm based on text structure
- Suggest practicing specific phrases for clarity

## "Slightly Better" Principle

CRITICAL: Your suggestions must be achievable for this student's current level.

- If the student uses simple vocabulary, suggest slightly more precise words — NOT academic terms
- If the student uses short sentences, suggest adding ONE connector — NOT complex clauses
- If the student's answer is already clear and accurate, say so — do not force unnecessary changes
- The goal is gradual improvement, not perfection

## What NOT to Do

- Do NOT generate a "model answer" or "Band 7+ version"
- Do NOT use technical linguistic terminology
- Do NOT overwhelm with multiple suggestions
- Do NOT criticize harshly — be encouraging
- Do NOT add information the student didn't provide
- Do NOT reference band scores or technical criteria`;
}

// ---------------------------------------------------------------------------
// Mock fallback (no API key)
// ---------------------------------------------------------------------------

function buildMockFeedback(weakness?: string): {
  positive: string;
  improve: string;
  tryNext: string;
  mock: boolean;
} {
  const weaknessLower = (weakness || '').toLowerCase();

  if (weaknessLower.includes('lexical')) {
    return {
      positive: 'Good effort expressing your ideas clearly!',
      improve: 'Try replacing one repeated word with a more specific alternative.',
      tryNext: 'For example, instead of saying "good" twice, try "useful" or "helpful" for variety.',
      mock: true,
    };
  }

  if (weaknessLower.includes('fluency')) {
    return {
      positive: 'You answered the question directly — great start!',
      improve: 'Try connecting your ideas with a simple word like "because" or "also".',
      tryNext: 'Next time, add one reason or example after your main point.',
      mock: true,
    };
  }

  if (weaknessLower.includes('grammatical')) {
    return {
      positive: 'Your meaning came through clearly!',
      improve: 'Check your verb tenses — make sure past events use past tense.',
      tryNext: 'Before answering, quickly think: "Is this happening now or did it happen before?"',
      mock: true,
    };
  }

  if (weaknessLower.includes('pronunciation')) {
    return {
      positive: 'Good job expressing your thoughts!',
      improve: 'Try emphasizing the important words in your sentence.',
      tryNext: 'Pick one key word in your answer and say it slightly louder and slower.',
      mock: true,
    };
  }

  // Default feedback
  return {
    positive: 'Good effort on your practice answer!',
    improve: 'Try adding one more detail or example to support your point.',
    tryNext: 'Think of a specific example from your own experience to include.',
    mock: true,
  };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PracticeFeedbackRequestBody;
    const { question, answer, weakness, improvementFocus, previousFeedback } = body;

    if (!question || !answer) {
      return NextResponse.json({
        error: 'Question and answer are required',
      });
    }

    // Check for empty or very short answers
    if (answer.trim().length < 3 || answer.startsWith('[No speech') || answer.startsWith('[Transcription')) {
      return NextResponse.json({
        positive: 'Thanks for trying!',
        improve: "We couldn't capture your answer clearly. Make sure your microphone is working.",
        tryNext: 'Try speaking a bit louder and closer to the microphone.',
      });
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      // No API key — return mock feedback for development
      return NextResponse.json(buildMockFeedback(weakness));
    }

    // Build the user prompt
    let userPrompt = `PRACTICE QUESTION: ${question}\n\n`;
    userPrompt += `STUDENT'S ANSWER: ${answer}\n\n`;

    if (weakness) {
      userPrompt += `STUDENT'S WEAKNESS AREA: ${weakness}\n`;
    }
    if (improvementFocus) {
      userPrompt += `IMPROVEMENT GOAL: ${improvementFocus}\n`;
    }
    if (previousFeedback) {
      userPrompt += `\nNOTE: This is a retry attempt. Previous feedback was: "${previousFeedback}"\n`;
      userPrompt += `Acknowledge any improvement from the previous attempt, then suggest the next step.\n`;
    }

    userPrompt += `\nProvide concise, encouraging feedback following the JSON structure.`;

    const systemPrompt = buildFeedbackSystemPrompt();

    let content: string;
    try {
      content = await llmChat({
        systemPrompt,
        userPrompt,
        temperature: 0.5,
        jsonMode: true,
        timeoutMs: 20_000, // Shorter timeout for quick feedback
      });
    } catch (llmError) {
      const isTimeout = llmError instanceof Error && llmError.name === 'AbortError';
      console.error(`qwen3.5-flash practice feedback ${isTimeout ? 'timed out' : 'error'}:`, llmError);

      // Fall back to mock feedback
      return NextResponse.json({
        ...buildMockFeedback(weakness),
        fallback: true,
        fallbackStage: isTimeout ? 'llm-timeout' : 'llm-error',
      });
    }

    // Parse the JSON response
    let feedback: { positive?: string; improve?: string; tryNext?: string };
    try {
      const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
      const objectMatch = stripped.match(/\{[\s\S]*\}/);
      const jsonStr = objectMatch ? objectMatch[0] : stripped;
      feedback = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse practice feedback response:', content.slice(0, 500));
      return NextResponse.json({
        ...buildMockFeedback(weakness),
        fallback: true,
        fallbackStage: 'parse-error',
      });
    }

    // Validate required fields
    if (!feedback.positive || !feedback.improve || !feedback.tryNext) {
      console.error('Practice feedback missing required fields:', JSON.stringify(feedback));
      return NextResponse.json({
        ...buildMockFeedback(weakness),
        fallback: true,
        fallbackStage: 'invalid-response',
      });
    }

    return NextResponse.json(feedback);
  } catch (error) {
    console.error('Practice feedback error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      positive: 'Thanks for practicing!',
      improve: 'Something went wrong. Please try again.',
      tryNext: 'Click retry to submit your answer again.',
    });
  }
}
