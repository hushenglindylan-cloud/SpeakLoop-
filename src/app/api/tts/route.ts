import { NextRequest, NextResponse } from 'next/server';
import { synthesizeSpeech } from '@/lib/ai/provider';
import { voiceForExaminer } from '@/lib/tts-voices';

/**
 * POST /api/tts
 *
 * Speaks an examiner question. The caller passes the examiner's nationality
 * and gender rather than a voice id, so the voice mapping stays server-side
 * and there is exactly one place that decides which voice an examiner uses.
 *
 * Answers with { audioUrl } on success, or { error, stage } on failure — never
 * a silent partial success, because the interview page needs to know it should
 * fall back to showing the question as text.
 *
 * Like /api/stt, failures come back as HTTP 200 with an `error` field: hosting
 * gateways in front of the app have been observed replacing 5xx bodies before
 * they reach the browser.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, nationality, gender } = body as {
      text?: string;
      nationality?: string;
      gender?: string;
    };

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'No text provided', stage: 'no-text' });
    }

    if (!nationality || !gender) {
      return NextResponse.json({
        error: 'Examiner nationality and gender are required to pick a voice.',
        stage: 'no-examiner',
      });
    }

    const voice = voiceForExaminer(nationality, gender);
    if (!voice) {
      // No voice is configured for this accent/gender. Saying so plainly beats
      // silently substituting a mismatched accent — an IELTS candidate hearing
      // an American voice from a British examiner is a product defect.
      return NextResponse.json({
        error: `No voice is configured for a ${nationality} ${gender} examiner.`,
        stage: 'no-voice-for-examiner',
      });
    }

    const result = await synthesizeSpeech({ text, voice, languageType: 'English' });

    if ('audioUrl' in result) {
      return NextResponse.json({ audioUrl: result.audioUrl });
    }

    return NextResponse.json({
      error: result.error,
      stage: result.stage,
      detail: result.detail,
    });
  } catch (error) {
    console.error('TTS route error:', error);
    return NextResponse.json({
      error: 'Could not generate the examiner audio.',
      stage: 'unhandled-exception',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
