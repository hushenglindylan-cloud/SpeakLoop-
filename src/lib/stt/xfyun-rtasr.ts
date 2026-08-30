import crypto from 'crypto';

// iFlytek (讯飞) 实时语音转写 (RTASR) WebSocket client.
//
// This replaces an earlier attempt against iFlytek's 语音转写 (LFASR) REST
// API, which failed with "no appId info" for a simple reason: the account
// has RTASR enabled, not LFASR. They are separate products with entirely
// different protocols — LFASR is HTTP upload-and-poll, RTASR is a streaming
// WebSocket — and an APPID provisioned for one is not recognized by the
// other.
//
// Protocol details here were taken from a real, working reference client
// (github.com/yijianguanzhu/iflytek-rtasr-websocket-client) rather than
// prose documentation, after prose-derived guesses caused several rounds of
// wrong field names and request shapes on the LFASR attempt.
//
// Two things worth knowing:
//  - The handshake signature is keyed with the account's **APIKey**, not
//    APISecret (unlike some other iFlytek products).
//  - Audio must be raw 16 kHz / 16-bit / mono PCM. The browser does that
//    conversion (src/lib/audio/pcm.ts) because the server has no ffmpeg.

const RTASR_URL = 'wss://rtasr.xfyun.cn/v1/ws';

// 1280 bytes of 16 kHz 16-bit mono PCM is exactly 40 ms of audio. Streaming
// a pre-recorded answer back at strict real-time would mean a 2-minute
// answer takes 2 minutes to transcribe, which risks tripping the hosting
// platform's request timeout, so this sends the same chunk size on a
// shorter interval (4x real-time) — fast enough to stay well inside the
// timeout, paced enough not to flood a service built for live audio.
const CHUNK_BYTES = 1280;
const CHUNK_INTERVAL_MS = 10;

// Overall ceiling so a stalled connection can never hang the request until
// the platform gateway kills it (which strips our diagnostics — a failure
// mode this project has already been bitten by).
const OVERALL_TIMEOUT_MS = 90_000;

export type RtasrResult =
  | { transcript: string }
  | { error: string; stage: string; detail?: string; raw?: string };

function buildHandshakeUrl(appId: string, apiKey: string): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const md5 = crypto.createHash('md5').update(appId + ts).digest('hex');
  const signa = crypto.createHmac('sha1', apiKey).update(md5).digest('base64');
  return `${RTASR_URL}?appid=${encodeURIComponent(appId)}&ts=${ts}&signa=${encodeURIComponent(signa)}`;
}

// A "result" frame's `data` is a JSON string shaped:
//   { seg_id, cn: { st: { bg, ed, type, rt: [ { ws: [ { cw: [ { w, wp } ] } ] } ] } } }
// where st.type is "0" for a finalized segment and "1" for an interim one.
// Only finalized segments are kept, otherwise interim guesses would be
// concatenated alongside the corrected text that replaces them.
function extractFinalSegment(dataField: string): string | null {
  try {
    const parsed = JSON.parse(dataField) as {
      cn?: { st?: { type?: string; rt?: Array<{ ws?: Array<{ cw?: Array<{ w?: string }> }> }> } };
    };
    const st = parsed?.cn?.st;
    if (!st || String(st.type) !== '0') return null;

    let text = '';
    for (const rt of st.rt ?? []) {
      for (const ws of rt.ws ?? []) {
        for (const cw of ws.cw ?? []) {
          text += cw.w ?? '';
        }
      }
    }
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function transcribeWithXfyunRtasr(pcm: Buffer): Promise<RtasrResult> {
  const appId = process.env.XFYUN_APP_ID;
  // RTASR signs with the APIKey. XFYUN_API_SECRET is accepted as a fallback
  // only because an earlier iteration of this integration asked for that
  // name; XFYUN_API_KEY is the correct one to configure.
  const apiKey = process.env.XFYUN_API_KEY || process.env.XFYUN_API_SECRET;
  if (!appId || !apiKey) {
    return { error: 'iFlytek transcription is not configured.', stage: 'rtasr-not-configured' };
  }
  if (pcm.length === 0) {
    return { error: "We couldn't detect your voice. Please try again.", stage: 'rtasr-empty-audio' };
  }

  return new Promise<RtasrResult>((resolve) => {
    let settled = false;
    const segments: string[] = [];
    let ws: WebSocket;

    const finish = (result: RtasrResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      try {
        ws?.close();
      } catch {
        // already closing/closed — nothing to do
      }
      resolve(result);
    };

    const overallTimer = setTimeout(() => {
      console.error('xfyun rtasr overall timeout; segments so far:', segments.length);
      finish({ error: 'Transcription took too long. Please try again.', stage: 'rtasr-timeout' });
    }, OVERALL_TIMEOUT_MS);

    try {
      ws = new WebSocket(buildHandshakeUrl(appId, apiKey));
    } catch (err) {
      finish({
        error: "We couldn't reach the transcription service.",
        stage: 'rtasr-connect-error',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
      // Stream the recording through, then tell iFlytek no more audio is
      // coming so it flushes the final segment.
      try {
        for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
          if (settled || ws.readyState !== ws.OPEN) return;
          const chunk = pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length));
          ws.send(new Uint8Array(chunk));
          await new Promise((r) => setTimeout(r, CHUNK_INTERVAL_MS));
        }
        if (!settled && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ end: true }));
        }
      } catch (err) {
        console.error('xfyun rtasr send error:', err);
        finish({
          error: 'Uploading your answer failed.',
          stage: 'rtasr-send-error',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    };

    ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;
      let frame: { action?: string; code?: string; data?: string; desc?: string };
      try {
        frame = JSON.parse(raw);
      } catch {
        console.error('xfyun rtasr non-JSON frame:', raw.slice(0, 300));
        return;
      }

      if (frame.action === 'error') {
        console.error('xfyun rtasr error frame:', raw.slice(0, 500));
        finish({
          error: "We couldn't process your answer.",
          stage: 'rtasr-service-error',
          detail: frame.desc,
          raw: raw.slice(0, 500),
        });
        return;
      }

      if (frame.action === 'result' && frame.data) {
        const segment = extractFinalSegment(frame.data);
        if (segment) segments.push(segment);
      }
      // action === 'started' is the handshake ack; nothing to do.
    };

    ws.onerror = () => {
      // The browser/undici WebSocket error event carries no useful detail;
      // onclose right after it reports the code, so let that one settle.
      console.error('xfyun rtasr websocket error event');
    };

    ws.onclose = (event) => {
      const transcript = segments.join(' ').replace(/\s+/g, ' ').trim();
      if (transcript.length > 0) {
        finish({ transcript });
        return;
      }
      console.error('xfyun rtasr closed with no transcript. code:', event.code, 'reason:', event.reason);
      finish({
        error: "We couldn't detect your voice. Please try again.",
        stage: 'rtasr-no-transcript',
        detail: `close ${event.code}${event.reason ? `: ${event.reason}` : ''}`,
      });
    };
  });
}
