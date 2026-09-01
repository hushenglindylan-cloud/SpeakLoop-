import { NextRequest, NextResponse } from 'next/server';
import { llmChat } from '@/lib/ai/provider';

/**
 * POST /api/final-evaluation
 *
 * Generates a qualitative progress analysis comparing initial interview
 * performance with practice session responses.
 *
 * Does NOT re-score the interview (uses existing evaluation data).
 * Does NOT generate fake band scores for practice.
 * Focuses on: What improved, What remains, Next step.
 *
 * This is the only feedback the student gets on their practice, so it never
 * falls back to canned text the way the scoring routes do — if the analysis
 * cannot be produced, the page says so and offers a retry. Failures come back
 * as HTTP 200 with `error`/`stage`/`detail` (the same shape /api/stt and
 * /api/tts use): hosting gateways in front of the app have been observed
 * replacing 5xx bodies before they reach the browser, and a reason the student
 * can read is what makes the failure diagnosable at all.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      interviewTranscripts,
      practiceTranscripts,
      coreEvaluation,
      practiceFocus,
    } = body as {
      interviewTranscripts: Array<{ question: string; questionType: string; answer: string }>;
      practiceTranscripts: Array<{ question: string; questionType: string; answer: string }>;
      coreEvaluation?: {
        scores: {
          fluencyCoherence: number;
          lexicalResource: number;
          grammaticalRange: number;
          pronunciation: number;
        };
        overallBand: number;
        mainWeakness?: string;
        improvementFocus?: string;
      };
      practiceFocus?: {
        weakness: string;
        improvementFocus: string;
      };
    };

    if (!interviewTranscripts?.length || !practiceTranscripts?.length) {
      return NextResponse.json({
        error: 'Both interview and practice transcripts are required',
        stage: 'no-transcripts',
      });
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      // Mock mode: return qualitative progress observations
      return NextResponse.json({
        progress: {
          improved: true,
          areas: [
            {
              area: practiceFocus?.weakness || 'Overall',
              observation: 'Your practice responses show more specific vocabulary choices.',
              evidence: 'You used more precise terms when explaining your ideas.',
            },
          ],
        },
        remainingFocus: {
          area: 'Fluency',
          observation: 'Continue practicing longer, more connected responses.',
        },
        nextStep: 'Try recording yourself speaking for 2 minutes on a familiar topic without stopping.',
        summary: 'You made progress in your practice session. Keep focusing on the areas identified.',
        mock: true,
      });
    }

    // Generate qualitative progress analysis
    const progressAnalysis = await analyzeProgress(
      interviewTranscripts,
      practiceTranscripts,
      coreEvaluation,
      practiceFocus
    );

    return NextResponse.json(progressAnalysis);
  } catch (error) {
    console.error('Final evaluation error:', error);
    return NextResponse.json({
      error: 'Could not analyse your progress.',
      stage: 'progress-analysis-failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Progress Analysis
// ---------------------------------------------------------------------------

interface ProgressAnalysis {
  progress: {
    improved: boolean;
    areas: Array<{
      area: string;
      observation: string;
      evidence: string;
    }>;
  };
  remainingFocus: {
    area: string;
    observation: string;
  };
  nextStep: string;
  summary: string;
}

async function analyzeProgress(
  interviewTranscripts: Array<{ question: string; questionType: string; answer: string }>,
  practiceTranscripts: Array<{ question: string; questionType: string; answer: string }>,
  coreEvaluation?: {
    scores: {
      fluencyCoherence: number;
      lexicalResource: number;
      grammaticalRange: number;
      pronunciation: number;
    };
    overallBand: number;
    mainWeakness?: string;
    improvementFocus?: string;
  },
  practiceFocus?: {
    weakness: string;
    improvementFocus: string;
  }
): Promise<ProgressAnalysis> {
  const systemPrompt = `You are an IELTS Speaking tutor analyzing a student's progress after targeted practice.

Compare the student's initial interview responses with their practice responses.

IMPORTANT PRINCIPLES:
1. Do NOT invent improvement. Only report what you can observe.
2. Do NOT generate new band scores. Practice transcripts are not formally scored.
3. Do NOT claim "significant improvement" without clear evidence.
4. Do NOT use Band 7+ language as the standard. "Slightly better" is the goal.
5. Focus on: clearer, more specific, more accurate, more natural, slightly more varied.
6. Be honest. If no clear improvement is visible, say so.

Look for observable changes:
- Did vocabulary become more specific (not necessarily more complex)?
- Did grammar become more accurate (not necessarily more complex)?
- Did answers become more relevant and focused?

Return ONLY a valid JSON object with this structure:
{
  "progress": {
    "improved": <boolean - true if any observable improvement>,
    "areas": [
      {
        "area": "<which aspect improved>",
        "observation": "<what changed, be specific>",
        "evidence": "<quote or reference to actual changes>"
      }
    ]
  },
  "remainingFocus": {
    "area": "<what still needs work>",
    "observation": "<why it still needs work>"
  },
  "nextStep": "<one clear, actionable next step>",
  "summary": "<2-3 sentence overall summary>"
}

If no clear improvement is observed, set "improved" to false and explain what stayed the same.`;

  // Format transcripts for the prompt
  const interviewFormatted = interviewTranscripts
    .map((t, i) => `Q${i + 1} (${t.questionType}): ${t.question}\nA: ${t.answer}`)
    .join('\n\n');

  const practiceFormatted = practiceTranscripts
    .map((t, i) => `Practice Q${i + 1}: ${t.question}\nA: ${t.answer}`)
    .join('\n\n');

  // Include existing evaluation context
  const evaluationContext = coreEvaluation
    ? `\nINITIAL INTERVIEW EVALUATION:
- Overall Band: ${coreEvaluation.overallBand}
- Fluency & Coherence: ${coreEvaluation.scores.fluencyCoherence}
- Lexical Resource: ${coreEvaluation.scores.lexicalResource}
- Grammatical Range & Accuracy: ${coreEvaluation.scores.grammaticalRange}
- Pronunciation: ${coreEvaluation.scores.pronunciation}
${coreEvaluation.mainWeakness ? `- Main Weakness: ${coreEvaluation.mainWeakness}` : ''}
${coreEvaluation.improvementFocus ? `- Improvement Focus: ${coreEvaluation.improvementFocus}` : ''}`
    : '';

  const practiceFocusContext = practiceFocus
    ? `\nPRACTICE FOCUS:
- Target Weakness: ${practiceFocus.weakness}
- Improvement Goal: ${practiceFocus.improvementFocus}`
    : '';

  const userPrompt = `INITIAL INTERVIEW RESPONSES:
${interviewFormatted}

PRACTICE SESSION RESPONSES:
${practiceFormatted}
${evaluationContext}
${practiceFocusContext}

Analyze the student's progress. Focus on observable changes, not invented scores.`;

  const result = await llmChat({
    systemPrompt,
    userPrompt,
    temperature: 0.3,
    jsonMode: true,
    // Two full sessions of transcript in, a structured report out — the 30s
    // default was tight enough to be its own failure mode.
    timeoutMs: 60_000,
  });

  try {
    const parsed = JSON.parse(result);
    return {
      progress: {
        improved: Boolean(parsed.progress?.improved),
        areas: Array.isArray(parsed.progress?.areas)
          ? parsed.progress.areas.map((a: { area?: string; observation?: string; evidence?: string }) => ({
              area: a.area || 'Overall',
              observation: a.observation || '',
              evidence: a.evidence || '',
            }))
          : [],
      },
      remainingFocus: {
        area: parsed.remainingFocus?.area || 'Overall',
        observation: parsed.remainingFocus?.observation || '',
      },
      nextStep: parsed.nextStep || 'Continue practicing with focus on the areas identified.',
      summary: parsed.summary || 'Practice session completed.',
    };
  } catch {
    // Try to extract JSON
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        progress: {
          improved: Boolean(parsed.progress?.improved),
          areas: Array.isArray(parsed.progress?.areas)
            ? parsed.progress.areas.map((a: { area?: string; observation?: string; evidence?: string }) => ({
                area: a.area || 'Overall',
                observation: a.observation || '',
                evidence: a.evidence || '',
              }))
            : [],
        },
        remainingFocus: {
          area: parsed.remainingFocus?.area || 'Overall',
          observation: parsed.remainingFocus?.observation || '',
        },
        nextStep: parsed.nextStep || 'Continue practicing with focus on the areas identified.',
        summary: parsed.summary || 'Practice session completed.',
      };
    }
    throw new Error('Failed to parse progress analysis response');
  }
}
