import { NextRequest, NextResponse } from 'next/server';
import { llmChat } from '@/lib/ai/provider';
import { formatRubricForPrompt } from '@/data/rubric';

/**
 * POST /api/final-evaluation
 *
 * Evaluates both interview and practice transcripts, then compares them
 * to show progress. Returns before/after scores for each criterion.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      interviewTranscripts,
      practiceTranscripts,
      examiner,
    } = body as {
      interviewTranscripts: Array<{ question: string; questionType: string; answer: string }>;
      practiceTranscripts: Array<{ question: string; questionType: string; answer: string }>;
      examiner?: { name: string; personality: string; difficulty: string };
    };

    if (!interviewTranscripts?.length || !practiceTranscripts?.length) {
      return NextResponse.json(
        { error: 'Both interview and practice transcripts are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      // Mock mode: return realistic-looking scores with slight improvement
      return NextResponse.json({
        before: {
          fluencyCoherence: 5.5,
          lexicalResource: 5.0,
          grammaticalRangeAccuracy: 5.5,
          pronunciation: 6.0,
          overallBand: 5.5,
        },
        after: {
          fluencyCoherence: 6.0,
          lexicalResource: 5.5,
          grammaticalRangeAccuracy: 6.0,
          pronunciation: 6.0,
          overallBand: 6.0,
        },
        summary: 'Mock evaluation — API key not configured. Connect DASHSCOPE_API_KEY for real assessment.',
        mock: true,
      });
    }

    const rubric = formatRubricForPrompt();

    // Evaluate interview (before)
    const beforeScores = await evaluateTranscripts(interviewTranscripts, rubric, examiner);

    // Evaluate practice (after)
    const afterScores = await evaluateTranscripts(practiceTranscripts, rubric, examiner);

    // Generate summary
    const summary = await generateSummary(beforeScores, afterScores, interviewTranscripts, practiceTranscripts);

    return NextResponse.json({
      before: beforeScores,
      after: afterScores,
      summary,
    });
  } catch (error) {
    console.error('Final evaluation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate final evaluation' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CriterionScores {
  fluencyCoherence: number;
  lexicalResource: number;
  grammaticalRangeAccuracy: number;
  pronunciation: number;
  overallBand: number;
}

async function evaluateTranscripts(
  transcripts: Array<{ question: string; questionType: string; answer: string }>,
  rubric: string,
  examiner?: { name: string; personality: string; difficulty: string }
): Promise<CriterionScores> {
  const examinerContext = examiner
    ? `\nExaminer: ${examiner.name} (${examiner.personality}, ${examiner.difficulty} difficulty)`
    : '';

  const systemPrompt = `You are an expert IELTS Speaking examiner. Evaluate the candidate's Part 3 responses using the official IELTS Speaking Band Descriptors.

${rubric}
${examinerContext}

IMPORTANT: You only have a text transcript, not audio, so score pronunciation based on textual evidence only (self-corrections, filler words, hesitations that may indicate pronunciation difficulty) — do not fabricate audio-level observations such as accent or intonation.

Return ONLY a valid JSON object with this structure:
{
  "fluencyCoherence": <number 1-9, can be .5>,
  "lexicalResource": <number 1-9, can be .5>,
  "grammaticalRangeAccuracy": <number 1-9, can be .5>,
  "pronunciation": <number 1-9, can be .5, based on textual evidence only>,
  "overallBand": <number 1-9, can be .5>
}`;

  const formattedTranscripts = transcripts
    .map((t, i) => `Q${i + 1} (${t.questionType}): ${t.question}\nA: ${t.answer}`)
    .join('\n\n');

  const userPrompt = `Evaluate this IELTS Speaking Part 3 transcript:\n\n${formattedTranscripts}`;

  const result = await llmChat({
    systemPrompt,
    userPrompt,
    temperature: 0.3,
    jsonMode: true,
  });

  try {
    const parsed = JSON.parse(result);
    return {
      fluencyCoherence: clampBand(parsed.fluencyCoherence),
      lexicalResource: clampBand(parsed.lexicalResource),
      grammaticalRangeAccuracy: clampBand(parsed.grammaticalRangeAccuracy),
      pronunciation: clampBand(parsed.pronunciation),
      overallBand: clampBand(parsed.overallBand),
    };
  } catch {
    // Try to extract JSON
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        fluencyCoherence: clampBand(parsed.fluencyCoherence),
        lexicalResource: clampBand(parsed.lexicalResource),
        grammaticalRangeAccuracy: clampBand(parsed.grammaticalRangeAccuracy),
        pronunciation: clampBand(parsed.pronunciation),
        overallBand: clampBand(parsed.overallBand),
      };
    }
    throw new Error('Failed to parse evaluation response');
  }
}

async function generateSummary(
  before: CriterionScores,
  after: CriterionScores,
  interviewTranscripts: Array<{ question: string; answer: string }>,
  practiceTranscripts: Array<{ question: string; answer: string }>
): Promise<string> {
  const systemPrompt = `You are an IELTS Speaking examiner providing a brief progress summary for a student.
Compare their initial interview performance with their practice session performance.
Highlight:
1. The most improved area
2. Any areas that stayed the same or declined
3. A brief encouraging message about their overall progress
Keep it to 3-4 sentences. Be specific and reference actual improvements.`;

  const userPrompt = `INITIAL INTERVIEW SCORES:
- Fluency & Coherence: ${before.fluencyCoherence}
- Lexical Resource: ${before.lexicalResource}
- Grammatical Range & Accuracy: ${before.grammaticalRangeAccuracy}
- Overall: ${before.overallBand}

PRACTICE SESSION SCORES:
- Fluency & Coherence: ${after.fluencyCoherence}
- Lexical Resource: ${after.lexicalResource}
- Grammatical Range & Accuracy: ${after.grammaticalRangeAccuracy}
- Overall: ${after.overallBand}

INTERVIEW SAMPLE: "${interviewTranscripts[0]?.answer?.slice(0, 200) || 'N/A'}..."
PRACTICE SAMPLE: "${practiceTranscripts[0]?.answer?.slice(0, 200) || 'N/A'}..."

Write a brief progress summary (3-4 sentences).`;

  const result = await llmChat({
    systemPrompt,
    userPrompt,
    temperature: 0.5,
  });

  return result.trim();
}

function clampBand(value: number): number {
  if (typeof value !== 'number' || isNaN(value)) return 5.0;
  // Round to nearest 0.5
  const rounded = Math.round(value * 2) / 2;
  return Math.max(1, Math.min(9, rounded));
}
