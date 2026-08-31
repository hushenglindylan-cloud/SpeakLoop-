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

interface CoreScores {
  fluencyCoherence: number;
  lexicalResource: number;
  grammaticalRange: number;
  pronunciation: number;
}

interface DetailedEvaluationRequestBody {
  transcripts: TranscriptEntry[];
  examiner?: ExaminerContext;
  coreEvaluation?: {
    scores: CoreScores;
    overallBand: number;
    mainWeakness?: string;
    improvementFocus?: string;
  };
}

// ---------------------------------------------------------------------------
// IELTS Speaking Band Descriptors — loaded from official data
// ---------------------------------------------------------------------------

const IELTS_RUBRIC = formatRubricForPrompt();

// ---------------------------------------------------------------------------
// System prompt — Detailed Evaluation (criteria analysis + improved answers)
// ---------------------------------------------------------------------------

function buildDetailedSystemPrompt(): string {
  return `You are an expert IELTS Speaking examiner and language coach. You will provide detailed analysis of a candidate's Part 3 performance and create slightly improved versions of every answer.

${IELTS_RUBRIC}

## Your Task

Given the candidate's question-answer pairs and the already-calculated core scores, provide:
1. Detailed criteria analysis for each of the 4 IELTS criteria
2. Slightly improved versions for EVERY answer (both main questions AND follow-up questions)

## Improved Version Philosophy

The goal is NOT to produce a Band 7+ model answer.
The goal is to produce a slightly improved version of the student's own answer.

The improved version should be:
- A slightly better, more natural, more accurate version of the student's own answer
- Something the student can understand, remember, and realistically reuse in future speaking
- Natural spoken English, not academic essay style

Priority order for improvements:
1. Accuracy (fix grammar mistakes)
2. Preserve meaning (keep the student's original ideas and opinions)
3. Natural spoken English (sound like a real student, not a textbook)
4. Slight improvement (small vocabulary/phrasing upgrades)
5. Reusability (the student should be able to learn from and reuse this language)
6. Vocabulary upgrade (only if natural and useful)
7. Grammar sophistication (lowest priority — simple but accurate is fine)

## Vocabulary Rules

- Keep vocabulary close to the student's current level
- Only upgrade vocabulary when the replacement is natural, useful, and realistically reusable
- Do NOT replace simple but correct vocabulary with unnecessarily advanced vocabulary
- Do NOT use rare or sophisticated words just to sound impressive
- Do NOT force idioms, advanced collocations, or complex phrases
- Do NOT significantly increase the vocabulary difficulty
- Preserve the student's original word choices when they are correct and natural

## Grammar Rules

- Grammar can be simple, but must be accurate
- Do NOT force complex relative clauses, inversion, conditionals, or participle clauses
- If a simple sentence is already natural and accurate, keep it simple
- Fix actual grammar mistakes (tense, agreement, articles, prepositions)

## Meaning Preservation Rules

- Do NOT change the student's original meaning or opinions
- Do NOT add facts, details, or examples that the student did not provide
- Do NOT invent specific numbers, names, places, or timeframes
- Keep the same perspective and stance as the original answer

## Self-Check Before Returning

Before returning each improved version, verify internally:
1. Is the vocabulary only slightly more advanced than the student's original?
2. Did I preserve the student's meaning exactly?
3. Did I avoid adding any information the student did not provide?
4. Is the grammar accurate?
5. Is the sentence structure realistic for this student to produce?
6. Could the student realistically understand and reuse this answer?
7. Did I accidentally turn this into a Band 7+ model answer?

If the improved version is too advanced, simplify it before returning.

## When the Original is Already Good

If the student's original answer is already grammatically accurate, natural, clear, and uses appropriate vocabulary — do NOT force changes. The improved version can be very close to or even identical to the original, with only minimal polishing.

## Output Format

Respond with ONLY a valid JSON object (no markdown, no code fences) matching this exact schema:

{
  "criteriaAnalysis": {
    "fluencyCoherence": {
      "band": <integer — must match the provided score>,
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
  "improvedAnswers": [
    {
      "questionIndex": <0-based index into the input transcripts array>,
      "question": "<the original question>",
      "originalSummary": "<brief paraphrase of what the candidate said>",
      "improvedVersion": "<a slightly improved version — see rules above>"
    }
  ]
}

## Rules

1. The band scores in criteriaAnalysis MUST match the provided core scores exactly. Do not recalculate.
2. Evidence must quote or reference specific phrases/structures from the candidate's actual answers.
3. Rationale should explain why this band was assigned, referencing the official descriptor.
4. improvedAnswers MUST include EVERY answer — both main questions (questionType: "main") AND follow-up questions (questionType: "followup"). Each transcript entry must have a corresponding improved answer.
5. For pronunciation: set audioEvidenceAvailable to false and base the analysis on available textual evidence only.

## Explicit Prohibitions

Do NOT optimize the answer for Band 7+ vocabulary.
Do NOT make the answer sound like a model essay.
Do NOT use unnecessarily advanced vocabulary.
Do NOT use rare or sophisticated words just to make the answer sound impressive.
Do NOT significantly increase the vocabulary difficulty.
Do NOT rewrite every simple word into an advanced synonym.
Do NOT add information that was not present in the student's answer.
Do NOT change the student's original meaning.
Do NOT force complex grammar.
Do NOT use complicated sentence structures when simple accurate grammar is sufficient.
Do NOT produce an answer that a lower-level student would struggle to understand or imitate.`;
}

// ---------------------------------------------------------------------------
// Mock fallback (no API key)
// ---------------------------------------------------------------------------

function buildMockDetailedEvaluation(
  transcripts: TranscriptEntry[],
  coreScores: CoreScores
) {
  return {
    criteriaAnalysis: {
      fluencyCoherence: {
        band: coreScores.fluencyCoherence,
        evidence: 'Candidate spoke at length but with some hesitation.',
        rationale: 'Willing to speak at length; coherence may break down at points.',
      },
      lexicalResource: {
        band: coreScores.lexicalResource,
        evidence: 'Limited vocabulary range observed in transcript.',
        rationale: 'Limited flexibility; attempts paraphrase but not always successful.',
      },
      grammaticalRange: {
        band: coreScores.grammaticalRange,
        evidence: 'Mix of simple and complex sentence forms.',
        rationale: 'Some errors present but rarely impede communication.',
      },
      pronunciation: {
        band: coreScores.pronunciation,
        evidence: 'Assessment based on transcript only.',
        rationale: 'Limited textual evidence available for pronunciation assessment.',
        audioEvidenceAvailable: false,
      },
    },
    improvedAnswers: transcripts
      .map((t, i) => ({
        questionIndex: i,
        question: t.question,
        originalSummary: t.answer.slice(0, 80),
        improvedVersion: '[Configure DASHSCOPE_API_KEY for real AI-generated improvements]',
      })),
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
// POST handler — Detailed Evaluation
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DetailedEvaluationRequestBody;
    const transcripts: TranscriptEntry[] = Array.isArray(body?.transcripts) ? body.transcripts : [];
    const examiner = body?.examiner;
    const coreEvaluation = body?.coreEvaluation;

    if (transcripts.length === 0) {
      return NextResponse.json({
        error: 'No transcripts provided',
        criteriaAnalysis: null,
        improvedAnswers: [],
      });
    }

    // Extract core scores for the prompt
    const coreScores: CoreScores = coreEvaluation?.scores ?? {
      fluencyCoherence: 5,
      lexicalResource: 5,
      grammaticalRange: 5,
      pronunciation: 5,
    };

    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      // No API key — return mock evaluation for development
      const mock = buildMockDetailedEvaluation(transcripts, coreScores);
      return NextResponse.json(mock);
    }

    // Build the user prompt with examiner context and core scores
    let userPrompt = '';
    if (examiner) {
      userPrompt += `Examiner: ${examiner.name} (${examiner.personality}, ${examiner.difficulty} difficulty)\n\n`;
    }

    // Include core scores so the model doesn't recalculate
    userPrompt += `CORE SCORES (already calculated — use these exact values in criteriaAnalysis):\n`;
    userPrompt += `- Fluency & Coherence: ${coreScores.fluencyCoherence}\n`;
    userPrompt += `- Lexical Resource: ${coreScores.lexicalResource}\n`;
    userPrompt += `- Grammatical Range: ${coreScores.grammaticalRange}\n`;
    userPrompt += `- Pronunciation: ${coreScores.pronunciation}\n\n`;

    userPrompt += `CANDIDATE'S PART 3 INTERVIEW TRANSCRIPT:\n\n${formatTranscriptsForLLM(transcripts)}`;

    const systemPrompt = buildDetailedSystemPrompt();

    let content: string;
    try {
      content = await llmChat({
        systemPrompt,
        userPrompt,
        temperature: 0.3,
        jsonMode: true,
        timeoutMs: 90_000, // Longer timeout for detailed analysis
      });
    } catch (llmError) {
      const isTimeout = llmError instanceof Error && llmError.name === 'AbortError';
      console.error(`qwen3.5-flash detailed evaluation ${isTimeout ? 'timed out' : 'error'}:`, llmError);

      // Return mock on LLM failure — this is non-blocking, so graceful degradation
      const mock = buildMockDetailedEvaluation(transcripts, coreScores);
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
      console.error('Failed to parse detailed evaluation response:', content.slice(0, 500));
      const mock = buildMockDetailedEvaluation(transcripts, coreScores);
      return NextResponse.json({
        ...mock,
        fallback: true,
        fallbackStage: 'parse-error',
      });
    }

    // Validate the response has the required structure
    const criteriaAnalysis = evaluation.criteriaAnalysis as Record<string, unknown> | undefined;
    if (!criteriaAnalysis || typeof criteriaAnalysis !== 'object') {
      console.error('Detailed evaluation response missing criteriaAnalysis:', JSON.stringify(evaluation).slice(0, 300));
      const mock = buildMockDetailedEvaluation(transcripts, coreScores);
      return NextResponse.json({
        ...mock,
        fallback: true,
        fallbackStage: 'invalid-response',
      });
    }

    return NextResponse.json(evaluation);
  } catch (error) {
    console.error('Detailed evaluate interview error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      criteriaAnalysis: null,
      improvedAnswers: [],
    });
  }
}
