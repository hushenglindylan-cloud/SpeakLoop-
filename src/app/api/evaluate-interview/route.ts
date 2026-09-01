import { NextRequest, NextResponse } from 'next/server';
import { llmChat } from '@/lib/ai/provider';
import { formatRubricForPrompt } from '@/data/rubric';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranscriptEntry {
  question: string;
  questionType: 'main' | 'followup';
  answer: string;
}

interface ExaminerContext {
  name: string;
  personality: string;
  difficulty: string;
}

interface EvaluationRequestBody {
  transcripts: TranscriptEntry[];
  examiner?: ExaminerContext;
}

// ---------------------------------------------------------------------------
// IELTS Speaking Band Descriptors — loaded from official data
// ---------------------------------------------------------------------------

const IELTS_RUBRIC = formatRubricForPrompt();

// ---------------------------------------------------------------------------
// Overall band — computed here, never asked of the model
// ---------------------------------------------------------------------------

/**
 * IELTS Speaking's overall band is the average of the four criteria, rounded
 * DOWN to the nearest 0.5 — unlike the Overall Test Band Score (which
 * combines Listening/Reading/Writing/Speaking and rounds .25 up to .5, .75 up
 * to a whole band). That up-rounding rule does not apply within a single
 * skill, so this stays a floor.
 *
 * This used to be a field the model filled in itself alongside `scores`, on
 * the same request. Nothing re-checked it against the scores it was
 * generated next to, so the two could silently disagree — e.g. scores
 * averaging to exactly 4.0 coming back with an overallBand of 3.5. Computing
 * it here instead makes that class of mismatch impossible: the number shown
 * is always the real average of the scores shown next to it.
 */
function computeOverallBand(scores: {
  fluencyCoherence: number;
  lexicalResource: number;
  grammaticalRange: number;
  pronunciation: number;
}): number {
  const average =
    (scores.fluencyCoherence + scores.lexicalResource + scores.grammaticalRange + scores.pronunciation) / 4;
  return Math.floor(average / 0.5) * 0.5;
}

// ---------------------------------------------------------------------------
// System prompt — Fast Evaluation (core scoring only)
// ---------------------------------------------------------------------------

function buildFastSystemPrompt(): string {
  return `You are an expert IELTS Speaking examiner. You will evaluate a candidate's Part 3 performance based on the official IELTS Speaking Band Descriptors.

${IELTS_RUBRIC}

## Your Task

Given the candidate's question-answer pairs from a Part 3 mock interview, provide ONLY the core evaluation scores needed for the first evaluation screen.

## Output Format

Respond with ONLY a valid JSON object (no markdown, no code fences) matching this exact schema:

{
  "scores": {
    "fluencyCoherence": <integer 1-9>,
    "lexicalResource": <integer 1-9>,
    "grammaticalRange": <integer 1-9>,
    "pronunciation": <integer 1-9>
  },
  "mainWeakness": "<criterion name> — <one-sentence description of the key area for improvement>",
  "improvementFocus": "<one actionable suggestion for the candidate>"
}

Do not include an overall band score — it is calculated from your four criterion scores after you respond.

## Rules

1. Score ONLY based on what is visible in the transcript text. Do not invent information.
2. Each criterion score must be an integer (1-9).
3. mainWeakness should identify the lowest-scoring criterion and describe the key issue.
4. improvementFocus should be one specific, actionable suggestion.
5. If the transcript is very short or empty, score conservatively (4-5 range) and note insufficient evidence.
6. For pronunciation: base the score on available textual evidence only (self-corrections, filler words, hesitations). Do not fabricate audio-level observations.

Do NOT generate:
- detailed criteria analysis
- improved answers
- long explanations
- examples
- teaching advice beyond improvementFocus`;
}

// ---------------------------------------------------------------------------
// Mock fallback (no API key)
// ---------------------------------------------------------------------------

function buildMockCoreEvaluation(transcripts: TranscriptEntry[]) {
  const hasContent = transcripts.some((t) => t.answer.trim().length > 0);

  if (!hasContent) {
    const scores = { fluencyCoherence: 4, lexicalResource: 4, grammaticalRange: 4, pronunciation: 4 };
    return {
      scores,
      overallBand: computeOverallBand(scores),
      mainWeakness: 'No response data available — please complete the interview with audio.',
      improvementFocus: 'Ensure microphone is working and speak clearly for each question.',
    };
  }

  const scores = { fluencyCoherence: 6, lexicalResource: 5, grammaticalRange: 6, pronunciation: 6 };
  return {
    scores,
    overallBand: computeOverallBand(scores),
    mainWeakness: 'Lexical Resource — Limited range of topic-specific vocabulary.',
    improvementFocus: 'Build topic-specific vocabulary banks for common Part 3 themes.',
    mock: true,
  };
}

// ---------------------------------------------------------------------------
// Format transcripts for the LLM prompt
// ---------------------------------------------------------------------------

function formatTranscriptsForLLM(transcripts: TranscriptEntry[]): string {
  return transcripts
    .map((t, i) => {
      const label = t.questionType === 'followup' ? 'Follow-up' : `Main Question ${i + 1}`;
      return `[${i}] ${label}\nQ: ${t.question}\nA: ${t.answer || '[No response]'}`;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// POST handler — Fast Evaluation
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EvaluationRequestBody;
    const transcripts: TranscriptEntry[] = Array.isArray(body?.transcripts) ? body.transcripts : [];
    const examiner = body?.examiner;

    if (transcripts.length === 0) {
      return NextResponse.json({
        error: 'No transcripts provided',
        scores: { fluencyCoherence: 0, lexicalResource: 0, grammaticalRange: 0, pronunciation: 0 },
        overallBand: 0,
      });
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      // No API key — return mock evaluation for development
      const mock = buildMockCoreEvaluation(transcripts);
      return NextResponse.json(mock);
    }

    // Build the user prompt with examiner context
    let userPrompt = '';
    if (examiner) {
      userPrompt += `Examiner: ${examiner.name} (${examiner.personality}, ${examiner.difficulty} difficulty)\n\n`;
    }
    userPrompt += `CANDIDATE'S PART 3 INTERVIEW TRANSCRIPT:\n\n${formatTranscriptsForLLM(transcripts)}`;

    const systemPrompt = buildFastSystemPrompt();

    let content: string;
    try {
      content = await llmChat({
        systemPrompt,
        userPrompt,
        temperature: 0.3,
        jsonMode: true,
        timeoutMs: 60_000,
      });
    } catch (llmError) {
      const isTimeout = llmError instanceof Error && llmError.name === 'AbortError';
      console.error(`qwen3.5-flash fast evaluation ${isTimeout ? 'timed out' : 'error'}:`, llmError);

      // Return mock on LLM failure rather than crashing the page
      const mock = buildMockCoreEvaluation(transcripts);
      return NextResponse.json({
        ...mock,
        fallback: true,
        fallbackStage: isTimeout ? 'llm-timeout' : 'llm-error',
      });
    }

    // Parse the JSON response
    let evaluation: Record<string, unknown>;
    try {
      const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
      const objectMatch = stripped.match(/\{[\s\S]*\}/);
      const jsonStr = objectMatch ? objectMatch[0] : stripped;
      evaluation = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse fast evaluation response:', content.slice(0, 500));
      const mock = buildMockCoreEvaluation(transcripts);
      return NextResponse.json({
        ...mock,
        fallback: true,
        fallbackStage: 'parse-error',
      });
    }

    // Validate the response has the required structure. All four criteria are
    // checked, not just one — computeOverallBand needs every one of them to
    // be a real number, and a model response that dropped a field would
    // otherwise turn the average (and the band shown to the student) into NaN.
    const scores = evaluation.scores as Record<string, number> | undefined;
    const hasAllScores =
      scores !== undefined &&
      typeof scores.fluencyCoherence === 'number' &&
      typeof scores.lexicalResource === 'number' &&
      typeof scores.grammaticalRange === 'number' &&
      typeof scores.pronunciation === 'number';

    if (!hasAllScores) {
      console.error('Fast evaluation response missing scores:', JSON.stringify(evaluation).slice(0, 300));
      const mock = buildMockCoreEvaluation(transcripts);
      return NextResponse.json({
        ...mock,
        fallback: true,
        fallbackStage: 'invalid-response',
      });
    }

    // overallBand is never taken from the model — see computeOverallBand.
    return NextResponse.json({
      ...evaluation,
      overallBand: computeOverallBand(scores as {
        fluencyCoherence: number;
        lexicalResource: number;
        grammaticalRange: number;
        pronunciation: number;
      }),
    });
  } catch (error) {
    console.error('Fast evaluate interview error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      scores: { fluencyCoherence: 0, lexicalResource: 0, grammaticalRange: 0, pronunciation: 0 },
      overallBand: 0,
    });
  }
}
