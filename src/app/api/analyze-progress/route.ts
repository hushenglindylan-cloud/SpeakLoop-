import { NextRequest, NextResponse } from 'next/server';
import { llmChat } from '@/lib/ai/provider';

interface TranscriptEntry {
  question: string;
  questionType: 'main' | 'followup';
  answer: string;
}

// Rule-based fallback used when no LLM API key is configured (e.g. local dev).
// Kept as a safety net so the feature still works without external calls.
function analyzeImprovementsRuleBased(interviewText: string, practiceText: string): string[] {
  const improvements: string[] = [];

  const advancedWords = ['furthermore', 'consequently', 'nevertheless', 'detrimental', 'beneficial', 'significant', 'substantial', 'comprehensive'];
  const foundAdvanced = advancedWords.filter((w) => practiceText.includes(w) && !interviewText.includes(w));
  if (foundAdvanced.length > 0) {
    improvements.push(`Used more advanced vocabulary, such as "${foundAdvanced[0]}"`);
  }

  const connectors = ['however', 'therefore', 'moreover', 'in addition', 'on the other hand', 'as a result'];
  const foundConnectors = connectors.filter((c) => practiceText.includes(c) && !interviewText.includes(c));
  if (foundConnectors.length > 0) {
    improvements.push(`More natural use of connectors, such as "${foundConnectors[0]}"`);
  }

  const interviewSentences = interviewText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const practiceSentences = practiceText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const interviewAvgLen = interviewSentences.length > 0 ? interviewText.length / interviewSentences.length : 0;
  const practiceAvgLen = practiceSentences.length > 0 ? practiceText.length / practiceSentences.length : 0;
  if (practiceAvgLen > interviewAvgLen * 1.2) {
    improvements.push('More complex sentence structures with detailed explanations');
  }

  if (practiceText.length > interviewText.length * 1.3) {
    improvements.push('More comprehensive responses with additional details and examples');
  }

  const basicWords = ['bad', 'good', 'big', 'small', 'important'];
  const advancedAlternatives: Record<string, string> = {
    bad: 'detrimental',
    good: 'beneficial',
    big: 'substantial',
    small: 'minimal',
    important: 'crucial',
  };
  for (const [basic, advanced] of Object.entries(advancedAlternatives)) {
    if (interviewText.includes(basic) && practiceText.includes(advanced)) {
      improvements.push(`Replaced "${basic}" with "${advanced}" for more precise expression`);
      break;
    }
  }

  if (improvements.length === 0 && practiceText.length > 0) {
    improvements.push('More fluent and natural responses overall');
  }

  return improvements;
}

function formatTranscripts(transcripts: TranscriptEntry[]): string {
  return transcripts
    .map((t, i) => `${i + 1}. Q: ${t.question}\n   A: ${t.answer}`)
    .join('\n\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const interviewTranscripts: TranscriptEntry[] = Array.isArray(body?.interviewTranscripts) ? body.interviewTranscripts : [];
    const practiceTranscripts: TranscriptEntry[] = Array.isArray(body?.practiceTranscripts) ? body.practiceTranscripts : [];

    if (interviewTranscripts.length === 0 || practiceTranscripts.length === 0) {
      return NextResponse.json({ improvements: [] });
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      // Rule-based fallback for development without an API key configured
      const interviewText = interviewTranscripts.map((t) => t.answer).filter(Boolean).join(' ').toLowerCase();
      const practiceText = practiceTranscripts.map((t) => t.answer).filter(Boolean).join(' ').toLowerCase();
      await new Promise((resolve) => setTimeout(resolve, 800));
      return NextResponse.json({
        improvements: analyzeImprovementsRuleBased(interviewText, practiceText),
        mock: true,
      });
    }

    const systemPrompt = `You are an IELTS speaking examiner comparing a candidate's first interview answers against their later practice-session answers, which were prompted by feedback from the first interview.

Identify concrete ways the candidate's spoken English improved between the two sessions — vocabulary, grammar, coherence, fluency, use of examples, sentence complexity, etc. Base your analysis only on the actual text provided; do not invent details.

Respond with ONLY a JSON object of this exact shape, and nothing else (no markdown, no code fences):
{"improvements": ["point 1", "point 2", "point 3"]}

Rules:
- 3 to 6 bullet points, each one short sentence (under ~20 words).
- Do NOT reference question numbers, "Q1"/"Follow-up" labels, or which session a quote came from.
- Do NOT do a side-by-side comparison; just state the improvement itself.
- If you quote a word or phrase the candidate used, keep quotes brief.
- If there is genuinely little or no improvement, say so plainly in one point rather than fabricating praise.`;

    const userPrompt = `FIRST INTERVIEW ANSWERS:\n${formatTranscripts(interviewTranscripts)}\n\nPRACTICE SESSION ANSWERS:\n${formatTranscripts(practiceTranscripts)}`;

    let content: string;
    try {
      content = await llmChat({
        systemPrompt,
        userPrompt,
        temperature: 0.4,
        jsonMode: true,
        timeoutMs: 30_000,
      });
    } catch (llmError) {
      const isTimeout =
        llmError instanceof Error && llmError.name === 'AbortError';
      console.error(
        `qwen3.5-flash progress analysis ${isTimeout ? 'timed out' : 'error'}:`,
        llmError
      );
      // Fall back to rule-based analysis rather than failing the page
      const interviewText = interviewTranscripts.map((t) => t.answer).filter(Boolean).join(' ').toLowerCase();
      const practiceText = practiceTranscripts.map((t) => t.answer).filter(Boolean).join(' ').toLowerCase();
      return NextResponse.json({
        improvements: analyzeImprovementsRuleBased(interviewText, practiceText),
        fallback: true,
        fallbackStage: isTimeout ? 'llm-timeout' : 'llm-error',
      });
    }

    // Parse the JSON response defensively — the model may wrap it in fences
    let improvements: string[] = [];
    const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const candidates = [stripped];
    const objectMatch = stripped.match(/\{[\s\S]*\}/);
    if (objectMatch) candidates.push(objectMatch[0]);
    const arrayMatch = stripped.match(/\[[\s\S]*\]/);
    if (arrayMatch) candidates.push(arrayMatch[0]);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const list = Array.isArray(parsed) ? parsed : parsed?.improvements;
        if (Array.isArray(list)) {
          improvements = list.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0);
          if (improvements.length > 0) break;
        }
      } catch {
        // try the next candidate
      }
    }

    if (improvements.length === 0) {
      console.error('Failed to parse qwen3.5-flash progress analysis response:', content.slice(0, 500));
      const interviewText = interviewTranscripts.map((t) => t.answer).filter(Boolean).join(' ').toLowerCase();
      const practiceText = practiceTranscripts.map((t) => t.answer).filter(Boolean).join(' ').toLowerCase();
      return NextResponse.json({
        improvements: analyzeImprovementsRuleBased(interviewText, practiceText),
        fallback: true,
        fallbackStage: 'parse-error',
      });
    }

    return NextResponse.json({ improvements });
  } catch (error) {
    console.error('Analyze progress error:', error);
    return NextResponse.json({
      improvements: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
