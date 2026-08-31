import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/ai/provider';

// Lets the deployed environment be checked from a browser/curl without
// exposing the key value itself — mainly to confirm whether an env var
// change on the hosting platform actually took effect after a redeploy.
export async function GET() {
  return NextResponse.json({
    dashscopeConfigured: Boolean(process.env.DASHSCOPE_API_KEY),
    provider: 'dashscope',
    sttModel: 'qwen3-asr-flash',
  });
}

// Hosting platforms commonly put a reverse proxy/gateway in front of the app
// that sanitizes any 5xx response — replacing the body (observed in practice
// as an empty `{}`) before it reaches the browser. A 2xx body is essentially
// never rewritten this way, so every response here — success or failure —
// uses status 200 and signals failure with an `error` field in the JSON body.
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioBlob = formData.get('audio') as Blob;

    if (!audioBlob) {
      return NextResponse.json({ error: 'No audio provided', stage: 'no-audio' });
    }

    // Check if audio is empty or too small (less than 1KB = likely no voice).
    if (audioBlob.size < 1024) {
      return NextResponse.json({
        error: "We couldn't detect your voice. Please try again.",
        stage: 'local-size-check',
        audioBytes: audioBlob.size,
      });
    }

    // Max audio size: 25MB (Qwen3-ASR-Flash limit is ~20MB, leave margin)
    const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
    if (audioBlob.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({
        error: 'Audio file is too large. Please record a shorter answer.',
        stage: 'local-size-check',
        audioBytes: audioBlob.size,
        maxBytes: MAX_AUDIO_BYTES,
      });
    }

    // Qwen3-ASR-Flash accepts audio in any common format (webm, mp4, ogg, wav).
    // No PCM conversion needed — the model handles container/codec decoding.
    const audioBuffer = Buffer.from(await audioBlob.arrayBuffer());
    const mimeType = audioBlob.type || 'audio/webm';

    const result = await transcribeAudio(audioBuffer, mimeType);

    if ('transcript' in result) {
      return NextResponse.json({ transcript: result.transcript });
    }

    return NextResponse.json({
      error: result.error,
      stage: result.stage,
      provider: 'qwen3-asr-flash',
      detail: result.detail,
    });
  } catch (error) {
    console.error('STT error:', error);
    return NextResponse.json({
      error: "We couldn't process your answer. Please try again.",
      stage: 'unhandled-exception',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
