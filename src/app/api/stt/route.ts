import { NextRequest, NextResponse } from 'next/server';
import { transcribeWithXfyunRtasr } from '@/lib/stt/xfyun-rtasr';

const xfyunKey = () => process.env.XFYUN_API_KEY || process.env.XFYUN_API_SECRET;

// Lets the deployed environment be checked from a browser/curl without
// exposing the key values themselves — mainly to confirm whether an env var
// change on the hosting platform actually took effect after a redeploy,
// which otherwise requires reading server logs. `xfyunKeyVar` reports which
// variable name the key was actually found under, since RTASR wants the
// account's APIKey and an earlier iteration of this integration asked for
// APISecret instead.
export async function GET() {
  return NextResponse.json({
    xfyunConfigured: Boolean(process.env.XFYUN_APP_ID && xfyunKey()),
    xfyunKeyVar: process.env.XFYUN_API_KEY ? 'XFYUN_API_KEY' : process.env.XFYUN_API_SECRET ? 'XFYUN_API_SECRET' : null,
  });
}

// Hosting platforms commonly put a reverse proxy/gateway in front of the app
// that sanitizes any 5xx response — replacing the body (observed in practice
// as an empty `{}`) before it reaches the browser, to avoid leaking upstream
// error details. That silently destroyed every diagnostic this route adds.
// A 2xx body is essentially never rewritten this way, so every response
// here — success or failure — uses status 200 and signals failure with an
// `error` field in the JSON body instead of the HTTP status code.
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioBlob = formData.get('audio') as Blob;

    if (!audioBlob) {
      return NextResponse.json({ error: 'No audio provided', stage: 'no-audio' });
    }

    // Check if audio is empty or too small (less than 1KB = likely no voice).
    // Tagged with `stage: 'local-size-check'` so this is distinguishable from
    // a provider-side "empty transcript" response further down — this one
    // never even reaches iFlytek, so a configured API key is irrelevant here.
    if (audioBlob.size < 1024) {
      return NextResponse.json({
        error: 'We couldn\'t detect your voice. Please try again.',
        stage: 'local-size-check',
        audioBytes: audioBlob.size,
      });
    }

    // iFlytek (讯飞) RTASR is the only real provider here. Groq and OpenAI
    // Whisper were tried first but are unreachable from this app's hosting
    // network — Groq returned a bare 403 "Forbidden" with no detail, which
    // is what an IP/region-level block looks like, and it reproduced with a
    // valid key, a fresh key, and every request shape tried. That code path
    // is gone rather than left as dead weight; git history has it if a
    // future deployment lives somewhere those services are reachable.
    //
    // RTASR needs raw 16 kHz mono PCM, which the client converts to before
    // uploading (src/lib/audio/pcm.ts) since the server has no ffmpeg.
    if (process.env.XFYUN_APP_ID && xfyunKey()) {
      const pcm = Buffer.from(await audioBlob.arrayBuffer());
      const rtasrResult = await transcribeWithXfyunRtasr(pcm);
      if ('transcript' in rtasrResult) {
        return NextResponse.json({ transcript: rtasrResult.transcript });
      }
      return NextResponse.json({
        error: rtasrResult.error,
        stage: rtasrResult.stage,
        provider: 'xfyun-rtasr',
        providerDetail: rtasrResult.detail,
        raw: rtasrResult.raw,
      });
    }

    // No credentials configured — return mock data so the rest of the app
    // (evaluation, practice, final comparison) stays developable locally
    // without any account. Flagged `mock: true` so it can never be mistaken
    // for a real transcription.
    const mockTranscripts = [
      "I think technology has definitely made our lives more complex in some ways, but also simpler in others. For example, smartphones allow us to access information instantly, which is convenient, but they also create expectations of constant connectivity.",
      "I believe the government should balance both priorities. Space exploration drives innovation and inspires future generations, but we can't ignore pressing problems like climate change and poverty that need immediate attention.",
      "Communication has changed dramatically over the past few decades. The internet and social media have made it possible to connect with anyone anywhere, but I think we've lost some of the depth that comes from face-to-face interaction.",
    ];

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    const randomIndex = Math.floor(Math.random() * mockTranscripts.length);
    return NextResponse.json({
      transcript: mockTranscripts[randomIndex],
      mock: true,
    });
  } catch (error) {
    console.error('STT error:', error);
    return NextResponse.json({
      error: 'We couldn\'t process your answer. Please try again.',
      stage: 'unhandled-exception',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
