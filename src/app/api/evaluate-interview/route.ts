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
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are an expert IELTS Speaking examiner. You will evaluate a candidate's Part 3 performance based on the official IELTS Speaking Band Descriptors.

${IELTS_RUBRIC}

## Your Task

Given the candidate's question-answer pairs from a Part 3 mock interview, provide a structured evaluation.

## Output Format

Respond with ONLY a valid JSON object (no markdown, no code fences) matching this exact schema:

{
  "scores": {
    "fluencyCoherence": <integer 1-9>,
    "lexicalResource": <integer 1-9>,
    "grammaticalRange": <integer 1-9>,
    "pronunciation": <integer 1-9>
  },
  "overallBand": <number, rounded down to nearest 0.5>,
  "criteriaAnalysis": {
    "fluencyCoherence": {
      "band": <integer>,
      "evidence": "<one specific observation from the transcript>",
      "rationale": "<why this band, referencing the descriptor>"
    },
    "lexicalResource": {
      "band": <integer>,
      "evidence": "<...>",
      "rationale": "<...>"
    },
    "grammaticalRange": {
      "band": <integer>,
      "evidence": "<...>",
      "rationale": "<...>"
    },
    "pronunciation": {
      "band": <integer>,
      "evidence": "<...>",
      "rationale": "<...>",
      "audioEvidenceAvailable": false
    }
  },
  "mainWeakness": "<criterion name> — <one-sentence description of the key area for improvement>",
  "improvementFocus": "<one actionable suggestion for the candidate>",
  "improvedAnswers": [
    {
      "questionIndex": <0-based index into the input transcripts array>,
      "question": "<the original question>",
      "originalSummary": "<brief paraphrase of what the candidate said>",
      "improvedVersion": "<a Band 7+ version that preserves the candidate's ideas but uses better vocabulary, grammar, and coherence>"
    }
  ]
}

## Rules

1. Score ONLY based on what is visible in the transcript text. Do not invent information.
2. Each criterion score must be an integer (1-9). Overall band is the average of 4 criteria, rounded DOWN to the nearest 0.5.
3. Evidence must quote or reference specific phrases/structures from the candidate's actual answers.
4. improvedAnswers must include at least the main questions (questionType: "main"), not follow-ups.
5. The improved version should preserve the candidate's original ideas/opinions but elevate them to Band 7+ level.
6. If the transcript is very short or empty, score conservatively (4-5 range) and note insufficient evidence.
7. For pronunciation: set audioEvidenceAvailable to false and base the score on available textual evidence only. Since you only have transcript text (not audio), pronunciation assessment is inherently limited. Look for textual clues like self-corrections, filler words, or hesitations that may indicate pronunciation difficulties, but do not fabricate audio-level observations.`;
}

// ---------------------------------------------------------------------------
// Mock fallback (no API key)
// ---------------------------------------------------------------------------

function buildMockEvaluation(transcripts: TranscriptEntry[]) {
  const hasContent = transcripts.some((t) => t.answer.trim().length > 0);

  if (!hasContent) {
    return {
      scores: { fluencyCoherence: 4, lexicalResource: 4, grammaticalRange: 4, pronunciation: 4 },
      overallBand: 4.0,
      criteriaAnalysis: {
        fluencyCoherence: { band: 4, evidence: 'No speech detected in any response.', rationale: 'Insufficient data to assess fluency.' },
        lexicalResource: { band: 4, evidence: 'No speech detected in any response.', rationale: 'Insufficient data to assess vocabulary.' },
        grammaticalRange: { band: 4, evidence: 'No speech detected in any response.', rationale: 'Insufficient data to assess grammar.' },
        pronunciation: { band: 4, evidence: 'No speech detected in any response.', rationale: 'Insufficient data to assess pronunciation.', audioEvidenceAvailable: false },
      },
      mainWeakness: 'No response data available — please complete the interview with audio.',
      improvementFocus: 'Ensure microphone is working and speak clearly for each question.',
      improvedAnswers: [],
    };
  }

  return {
    scores: { fluencyCoherence: 6, lexicalResource: 5, grammaticalRange: 6, pronunciation: 6 },
    overallBand: 5.5,
    criteriaAnalysis: {
      fluencyCoherence: { band: 6, evidence: 'Candidate spoke at length but with some hesitation.', rationale: 'Willing to speak at length; coherence may break down at points.' },
      lexicalResource: { band: 5, evidence: 'Limited vocabulary range observed in transcript.', rationale: 'Limited flexibility; attempts paraphrase but not always successful.' },
      grammaticalRange: { band: 6, evidence: 'Mix of simple and complex sentence forms.', rationale: 'Some errors present but rarely impede communication.' },
      pronunciation: { band: 6, evidence: 'Assessment based on transcript only.', rationale: 'Limited textual evidence available for pronunciation assessment.', audioEvidenceAvailable: false },
    },
    mainWeakness: 'Lexical Resource — Limited range of topic-specific vocabulary.',
    improvementFocus: 'Build topic-specific vocabulary banks for common Part 3 themes.',
    improvedAnswers: transcripts
      .map((t, i) => ({ questionIndex: i, question: t.question, originalSummary: t.answer.slice(0, 80), improvedVersion: '[Configure DASHSCOPE_API_KEY for real AI-generated improvements]' }))
      .filter((_, i) => transcripts[i].questionType === 'main'),
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
// POST handler
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
      const mock = buildMockEvaluation(transcripts);
      return NextResponse.json(mock);
    }

    // Build the user prompt with examiner context
    let userPrompt = '';
    if (examiner) {
      userPrompt += `Examiner: ${examiner.name} (${examiner.personality}, ${examiner.difficulty} difficulty)\n\n`;
    }
    userPrompt += `CANDIDATE'S PART 3 INTERVIEW TRANSCRIPT:\n\n${formatTranscriptsForLLM(transcripts)}`;

    const systemPrompt = buildSystemPrompt();

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
      console.error(`qwen3.5-flash evaluation ${isTimeout ? 'timed out' : 'error'}:`, llmError);

      // Return mock on LLM failure rather than crashing the page
      const mock = buildMockEvaluation(transcripts);
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
      console.error('Failed to parse evaluation response:', content.slice(0, 500));
      const mock = buildMockEvaluation(transcripts);
      return NextResponse.json({
        ...mock,
        fallback: true,
        fallbackStage: 'parse-error',
      });
    }

    // Validate the response has the required structure
    const scores = evaluation.scores as Record<string, number> | undefined;
    if (!scores || typeof scores.fluencyCoherence !== 'number') {
      console.error('Evaluation response missing scores:', JSON.stringify(evaluation).slice(0, 300));
      const mock = buildMockEvaluation(transcripts);
      return NextResponse.json({
        ...mock,
        fallback: true,
        fallbackStage: 'invalid-response',
      });
    }

    return NextResponse.json(evaluation);
  } catch (error) {
    console.error('Evaluate interview error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      scores: { fluencyCoherence: 0, lexicalResource: 0, grammaticalRange: 0, pronunciation: 0 },
      overallBand: 0,
    });
  }
}
