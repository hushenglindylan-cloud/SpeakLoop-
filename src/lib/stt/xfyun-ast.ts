import crypto from 'crypto';

// iFlytek (讯飞) 实时语音转写大模型 — WebSocket streaming transcription.
//
// Written against the official API doc for this exact product. Getting here
// took three wrong turns, all the same mistake: iFlytek ships several
// speech-recognition products with incompatible protocols, and guessing
// which one an account has provisioned does not work. For the record:
//   - 语音转写 (LFASR)          — HTTP upload/poll, raasr.xfyun.cn
//   - 实时语音转写 标准版 (RTASR) — WS, rtasr.xfyun.cn/v1/ws, appid/ts/signa
//   - 实时语音转写 大模型 (this)  — WS, office-api-ast-dx.iflyaisol.com,
//                                  accessKeyId/utc/signature
// An APPID provisioned for one is rejected by the others ("no appid info").
//
// Credentials map to the console's three values as:
//   appId           = APPID
//   accessKeyId     = APIKey
//   accessKeySecret = APISecret   (signing key)

const AST_HOST = 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1';

// The docs specify 1280 bytes every 40 ms and warn that sending faster can
// break the engine — error code 100001 is literally "上传音频速度超出限制".
// So this streams at real time rather than racing, which is fine because
// transcription runs in the background while the student answers the next
// question (see stopRecordingAndSave in the interview page).
const CHUNK_BYTES = 1280;
const CHUNK_INTERVAL_MS = 40;

// Generous enough for a long answer streamed at real time, while still
// guaranteeing we answer before a hosting gateway times out and replaces
// our response with its own opaque error.
const OVERALL_TIMEOUT_MS = 180_000;

export type AstResult =
  | { transcript: string }
  | { error: string; stage: string; detail?: string; raw?: string };

// baseString per the docs: every request param except `signature`, sorted by
// name ascending, url-encoded key and value, joined with '&'.
function buildSignature(params: Record<string, string>, accessKeySecret: string): string {
  const baseString = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  return crypto.createHmac('sha1', accessKeySecret).update(baseString).digest('base64');
}

// The docs' `utc` example is Beijing time with an explicit +0800 offset
// (2025-09-04T15:38:07+0800). Error 35014/100012 reject a skewed timestamp,
// so this formats the current instant in that exact shape.
function beijingUtcString(now: Date): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}+0800`
  );
}

const CJK = /[㐀-鿿豈-﫿　-〿＀-￯]/;

// Joins recognized word tokens. Chinese runs together; English needs spaces.
// Punctuation (wp 'p') always attaches to the preceding word, and 'g'
// (分段标识 — a segment marker, not real text) is dropped.
function appendWord(acc: string, word: string, wp: string | undefined): string {
  if (!word || wp === 'g') return acc;
  if (acc.length === 0) return word;
  if (wp === 'p') return acc + word;
  const prevChar = acc[acc.length - 1];
  if (CJK.test(prevChar) || CJK.test(word[0])) return acc + word;
  return `${acc} ${word}`;
}

interface AstFrame {
  action?: string;
  code?: string;
  desc?: string;
  sid?: string;
  msg_type?: string;
  res_type?: string;
  data?: unknown;
}

// Extracts finalized text from one frame. `data` is documented as a string
// but the doc's own example returns it as an object, so both are handled.
// Only st.type === '0' (确定性结果) is kept — type '1' is an interim guess
// that a later frame supersedes.
function extractFinalText(frame: AstFrame): string | null {
  try {
    const data = typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data;
    const st = (data as { cn?: { st?: {
      type?: string;
      rt?: Array<{ ws?: Array<{ cw?: Array<{ w?: string; wp?: string }> }> }>;
    } } })?.cn?.st;
    if (!st || String(st.type) !== '0') return null;

    let text = '';
    for (const rt of st.rt ?? []) {
      for (const ws of rt.ws ?? []) {
        for (const cw of ws.cw ?? []) {
          text = appendWord(text, cw.w ?? '', cw.wp);
        }
      }
    }
    return text.trim().length > 0 ? text.trim() : null;
  } catch {
    return null;
  }
}

export async function transcribeWithXfyunAst(pcm: Buffer): Promise<AstResult> {
  const appId = process.env.XFYUN_APP_ID;
  const accessKeyId = process.env.XFYUN_API_KEY;
  const accessKeySecret = process.env.XFYUN_API_SECRET;

  if (!appId || !accessKeyId || !accessKeySecret) {
    const missing = [
      !appId && 'XFYUN_APP_ID',
      !accessKeyId && 'XFYUN_API_KEY',
      !accessKeySecret && 'XFYUN_API_SECRET',
    ].filter(Boolean);
    return {
      error: 'iFlytek transcription is not fully configured.',
      stage: 'ast-not-configured',
      detail: `missing: ${missing.join(', ')}`,
    };
  }
  if (pcm.length === 0) {
    return { error: "We couldn't detect your voice. Please try again.", stage: 'ast-empty-audio' };
  }

  // A fresh uuid per request is required, not optional: error 35030 fires on
  // a repeated signature, which is exactly what a missing or reused uuid
  // produces when two requests land in the same second.
  const uuid = crypto.randomUUID();

  const params: Record<string, string> = {
    appId,
    accessKeyId,
    uuid,
    utc: beijingUtcString(new Date()),
    // autodialect covers Chinese + English without needing the separate
    // permission ticket autominor requires. Overridable for accounts that
    // have autominor enabled, where `en` gives better English accuracy.
    lang: process.env.XFYUN_AST_LANG || 'autodialect',
    audio_encode: 'pcm_s16le',
    samplerate: '16000',
  };
  const recognizedLanguage = process.env.XFYUN_AST_RECOGNIZED_LANGUAGE;
  if (recognizedLanguage && params.lang === 'autominor') {
    params.recognized_language = recognizedLanguage;
  }

  const signature = buildSignature(params, accessKeySecret);
  const query = Object.entries({ ...params, signature })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  return new Promise<AstResult>((resolve) => {
    let settled = false;
    let finalText = '';
    let sessionId: string = uuid;
    let ws: WebSocket;

    const finish = (result: AstResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      try {
        ws?.close();
      } catch {
        // already closing/closed
      }
      resolve(result);
    };

    const overallTimer = setTimeout(() => {
      console.error('xfyun ast overall timeout; text so far:', finalText.length, 'chars');
      finish({ error: 'Transcription took too long. Please try again.', stage: 'ast-timeout' });
    }, OVERALL_TIMEOUT_MS);

    try {
      ws = new WebSocket(`${AST_HOST}?${query}`);
    } catch (err) {
      finish({
        error: "We couldn't reach the transcription service.",
        stage: 'ast-connect-error',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
      try {
        for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
          if (settled || ws.readyState !== ws.OPEN) return;
          ws.send(new Uint8Array(pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length))));
          await new Promise((r) => setTimeout(r, CHUNK_INTERVAL_MS));
        }
        if (!settled && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ end: true, sessionId }));
        }
      } catch (err) {
        console.error('xfyun ast send error:', err);
        finish({
          error: 'Uploading your answer failed.',
          stage: 'ast-send-error',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    };

    ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;
      let frame: AstFrame;
      try {
        frame = JSON.parse(raw);
      } catch {
        console.error('xfyun ast non-JSON frame:', raw.slice(0, 300));
        return;
      }

      if (frame.sid) sessionId = frame.sid;

      // Error frames come in two documented shapes: an `action: "error"`
      // envelope, and a result envelope carrying `data.normal === false`.
      const dataObj = (typeof frame.data === 'object' && frame.data !== null
        ? frame.data
        : {}) as { normal?: boolean; desc?: string; ls?: boolean };
      if (frame.action === 'error' || dataObj.normal === false) {
        console.error('xfyun ast error frame:', raw.slice(0, 500));
        finish({
          error: "We couldn't process your answer.",
          stage: 'ast-service-error',
          detail: frame.desc || dataObj.desc || frame.code,
          raw: raw.slice(0, 500),
        });
        return;
      }

      const segment = extractFinalText(frame);
      if (segment) {
        finalText = finalText.length > 0 ? `${finalText} ${segment}` : segment;
      }

      // `ls: true` marks the last frame — resolve immediately rather than
      // waiting for the socket to close on its own.
      if (dataObj.ls === true) {
        const transcript = finalText.replace(/\s+/g, ' ').trim();
        if (transcript.length > 0) {
          finish({ transcript });
        }
      }
    };

    ws.onerror = () => {
      // The runtime's error event carries no detail; onclose right after it
      // reports the code, so let that settle the promise.
      console.error('xfyun ast websocket error event');
    };

    ws.onclose = (event) => {
      const transcript = finalText.replace(/\s+/g, ' ').trim();
      if (transcript.length > 0) {
        finish({ transcript });
        return;
      }
      console.error('xfyun ast closed with no transcript. code:', event.code, 'reason:', event.reason);
      finish({
        error: "We couldn't detect your voice. Please try again.",
        stage: 'ast-no-transcript',
        detail: `close ${event.code}${event.reason ? `: ${event.reason}` : ''}`,
      });
    };
  });
}
