import { NextRequest, NextResponse } from 'next/server';
import { transcribeWithXfyunRtasr } from '@/lib/stt/xfyun-rtasr';

const xfyunKey = () => process.env.XFYUN_API_KEY || process.env.XFYUN_API_SECRET;

// Lets the deployed environment be checked from a browser/curl without
// exposing the key values themselves — mainly to confirm whether an env var
// change (e.g. adding GROQ_API_KEY on the hosting platform) actually took
// effect after a redeploy, which otherwise requires reading server logs.
export async function GET() {
  return NextResponse.json({
    xfyunConfigured: Boolean(process.env.XFYUN_APP_ID && xfyunKey()),
    xfyunKeyVar: process.env.XFYUN_API_KEY ? 'XFYUN_API_KEY' : process.env.XFYUN_API_SECRET ? 'XFYUN_API_SECRET' : null,
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
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
    // never even reaches Groq/OpenAI, so a configured API key is irrelevant here.
    if (audioBlob.size < 1024) {
      return NextResponse.json({
        error: 'We couldn\'t detect your voice. Please try again.',
        stage: 'local-size-check',
        audioBytes: audioBlob.size,
      });
    }

    // Prefer iFlytek (讯飞) — reachable from mainland-China-hosted servers,
    // unlike Groq/OpenAI which returned a bare 403 from this app's actual
    // hosting environment (see src/lib/stt/xfyun-rtasr.ts for the full story).
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

    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const apiKey = groqKey || openaiKey;

    if (!apiKey) {
      // Mock STT response for development without any API key configured
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
    }

    // Real STT via an OpenAI-compatible transcription endpoint.
    // Prefer Groq (free tier: 2,000 requests/day, ~8 hours of audio/day,
    // ~9x cheaper than OpenAI beyond that) and fall back to OpenAI Whisper
    // if only OPENAI_API_KEY is configured.
    // Use the filename the client actually sent (it reflects the real
    // encoding it recorded in — e.g. Safari records mp4/aac, not webm)
    // so the API gets an accurate hint about the file format.
    const uploadedName = audioBlob instanceof File ? audioBlob.name : 'recording.webm';
    const transcriptionUrl = groqKey
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions';
    const transcriptionModel = groqKey ? 'whisper-large-v3-turbo' : 'whisper-1';

    const openaiFormData = new FormData();
    openaiFormData.append('file', audioBlob, uploadedName || 'recording.webm');
    openaiFormData.append('model', transcriptionModel);
    openaiFormData.append('language', 'en');

    // Groq/OpenAI transcription is normally done in a few seconds, but this
    // fetch previously had no timeout at all. If the network path to the
    // provider stalls (a real risk on hosting platforms that proxy/restrict
    // outbound traffic), the request would hang until the hosting platform's
    // own gateway timeout killed it — which replaces our response with its
    // own generic error (often an empty body), hiding what actually failed.
    // Racing our own timeout means we always control what the client sees.
    const providerTimeoutMs = 20_000;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), providerTimeoutMs);

    let response: Response;
    try {
      response = await fetch(transcriptionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: openaiFormData,
        signal: timeoutController.signal,
      });
    } catch (fetchError) {
      const isTimeout = fetchError instanceof Error && fetchError.name === 'AbortError';
      console.error(
        `STT ${isTimeout ? 'timed out calling' : 'network error calling'} ${groqKey ? 'Groq' : 'OpenAI'}:`,
        fetchError
      );
      return NextResponse.json({
        error: isTimeout
          ? `The transcription service took too long to respond (>${providerTimeoutMs / 1000}s). Please try again.`
          : `We couldn't reach the transcription service (${groqKey ? 'Groq' : 'OpenAI'}). Please try again.`,
        stage: isTimeout ? 'provider-timeout' : 'provider-network-error',
        provider: groqKey ? 'groq' : 'openai',
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      let error: unknown = rawText;
      try {
        error = JSON.parse(rawText);
      } catch {
        // not JSON — keep the raw text
      }
      console.error(`STT provider error (${groqKey ? 'Groq' : 'OpenAI'}, status ${response.status}):`, error);
      // Surface the provider's own error body (e.g. Groq's message explaining
      // *why* it returned 403 — invalid key vs. region-blocked vs. something
      // else) instead of just the status code, since that detail previously
      // only reached the server logs, which have been hard to get to.
      const providerErrorText =
        typeof error === 'string' ? error : JSON.stringify(error);
      return NextResponse.json({
        error: `We couldn't process your answer (${groqKey ? 'Groq' : 'OpenAI'} ${response.status}). Please try again.`,
        stage: 'provider-error',
        provider: groqKey ? 'groq' : 'openai',
        providerStatus: response.status,
        providerDetail: providerErrorText.slice(0, 500),
      });
    }

    const data = await response.json();

    if (!data.text || data.text.trim().length === 0) {
      // The provider was actually reached and responded 200 OK, it just
      // heard nothing — different from `local-size-check` above, which never
      // got this far.
      return NextResponse.json({
        error: 'We couldn\'t detect your voice. Please try again.',
        stage: 'provider-empty-transcript',
        provider: groqKey ? 'groq' : 'openai',
      });
    }

    return NextResponse.json({
      transcript: data.text,
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
