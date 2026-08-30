import crypto from 'crypto';

// iFlytek (讯飞开放平台) "语音转写" (LFASR — long-form ASR) REST API client.
//
// Chosen over Groq/OpenAI Whisper specifically because it's reachable from
// mainland-China-hosted servers (Groq returned a bare 403 "Forbidden" from
// Coze's hosting network — most likely a region/IP-level block on Groq's
// side, unrelated to the API key). iFlytek's servers are the ones Coze
// itself already talks to, so this avoids that class of problem entirely.
//
// IMPORTANT CAVEAT: unlike the Groq/OpenAI integration, this could not be
// verified end-to-end before shipping — this sandbox's network egress is
// blocked from every iFlytek domain (both the docs site and the API host
// itself, raasr.xfyun.cn), the same way it was blocked from Groq's docs
// earlier in this project. The signature algorithm and endpoint shapes
// below are written from well-established, long-stable documentation
// patterns, but the getResult response parsing in particular has a
// notoriously fiddly triple-nested-JSON shape that has shifted across
// iFlytek doc revisions. If transcription fails with stage starting in
// "xfyun-", check `raw` in the response — it dumps the actual payload
// iFlytek sent back, which is what's needed to correct any field-name
// mismatch quickly rather than guessing again.

const LFASR_HOST = 'https://raasr.xfyun.cn/api';

export type XfyunResult =
  | { transcript: string }
  | { error: string; stage: string; detail?: string; raw?: string };

function buildSigna(appId: string, apiSecret: string, ts: string): string {
  const baseString = appId + ts;
  const md5Hash = crypto.createHash('md5').update(baseString).digest('hex');
  return crypto.createHmac('sha1', apiSecret).update(md5Hash).digest('base64');
}

function authQuery(appId: string, apiSecret: string): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const signa = buildSigna(appId, apiSecret, ts);
  return `appId=${encodeURIComponent(appId)}&signa=${encodeURIComponent(signa)}&ts=${encodeURIComponent(ts)}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: number; data?: unknown; failed?: string; raw: string }> {
  const res = await fetch(url, init);
  const rawText = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: -1, failed: `Non-JSON response (HTTP ${res.status})`, raw: rawText.slice(0, 500) };
  }
  const obj = parsed as { ok?: number; data?: unknown; failed?: string };
  return { ok: obj.ok ?? -1, data: obj.data, failed: obj.failed, raw: rawText.slice(0, 500) };
}

// Extracts the recognized text out of iFlytek's getResult payload. The
// shape is: data -> JSON string -> { lattice: [ { json_1best: JSON string
// -> { st: { rt: [ { ws: [ { cw: [ { w: "word" } ] } ] } ] } } } ] }.
// Deliberately defensive (try/catch at every parse level) since this is
// the one part of the integration this session could not verify against a
// real response.
function extractTranscript(resultData: unknown): string | null {
  try {
    const parsed = typeof resultData === 'string' ? JSON.parse(resultData) : resultData;
    const lattice = (parsed as { lattice?: Array<{ json_1best?: string }> })?.lattice;
    if (!Array.isArray(lattice)) return null;

    const words: string[] = [];
    for (const entry of lattice) {
      if (!entry?.json_1best) continue;
      const best = JSON.parse(entry.json_1best) as {
        st?: { rt?: Array<{ ws?: Array<{ cw?: Array<{ w?: string }> }> }> };
      };
      const rt = best?.st?.rt ?? [];
      for (const r of rt) {
        for (const ws of r.ws ?? []) {
          const w = ws.cw?.[0]?.w;
          if (w) words.push(w);
        }
      }
    }
    const text = words.join('').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function transcribeWithXfyun(audioBlob: Blob, filename: string): Promise<XfyunResult> {
  const appId = process.env.XFYUN_APP_ID;
  const apiSecret = process.env.XFYUN_API_SECRET;
  if (!appId || !apiSecret) {
    return { error: 'iFlytek transcription is not configured.', stage: 'xfyun-not-configured' };
  }

  const audioBuffer = Buffer.from(await audioBlob.arrayBuffer());

  // 1. prepare — registers the job and returns a task_id.
  const prepareBody = new URLSearchParams({
    file_len: String(audioBuffer.length),
    file_name: filename,
    slice_num: '1',
    language: 'en',
  });
  const prepare = await fetchJson(`${LFASR_HOST}/prepare?${authQuery(appId, apiSecret)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: prepareBody,
  });
  if (prepare.ok !== 0 || typeof prepare.data !== 'string') {
    console.error('xfyun prepare failed:', prepare.failed, prepare.raw);
    return { error: 'Transcription setup failed.', stage: 'xfyun-prepare-error', detail: prepare.failed, raw: prepare.raw };
  }
  const taskId = prepare.data;

  // 2. upload — single slice (our answers are short enough not to need
  // chunking); slice_id must be a 32-char lowercase string per iFlytek's
  // convention for a single-slice upload.
  const sliceId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const upload = await fetchJson(
    `${LFASR_HOST}/upload?${authQuery(appId, apiSecret)}&task_id=${encodeURIComponent(taskId)}&slice_id=${sliceId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: audioBuffer,
    }
  );
  if (upload.ok !== 0) {
    console.error('xfyun upload failed:', upload.failed, upload.raw);
    return { error: 'Uploading your answer failed.', stage: 'xfyun-upload-error', detail: upload.failed, raw: upload.raw };
  }

  // 3. merge — tells iFlytek all slices are in and processing can start.
  const merge = await fetchJson(`${LFASR_HOST}/merge?${authQuery(appId, apiSecret)}&task_id=${encodeURIComponent(taskId)}`, {
    method: 'POST',
  });
  if (merge.ok !== 0) {
    console.error('xfyun merge failed:', merge.failed, merge.raw);
    return { error: 'Finalizing your answer failed.', stage: 'xfyun-merge-error', detail: merge.failed, raw: merge.raw };
  }

  // 4. getProgress — poll until status 9 (done) or a failure/timeout.
  // IELTS Part 3 answers are short (seconds to ~2 minutes), so this polls
  // fairly aggressively rather than the multi-minute interval iFlytek's
  // docs suggest for much longer recordings.
  const maxAttempts = 40;
  const pollIntervalMs = 3000;
  let lastProgressRaw = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const progress = await fetchJson(
      `${LFASR_HOST}/getProgress?${authQuery(appId, apiSecret)}&task_id=${encodeURIComponent(taskId)}`,
      { method: 'POST' }
    );
    lastProgressRaw = progress.raw;
    if (progress.ok !== 0) {
      console.error('xfyun getProgress failed:', progress.failed, progress.raw);
      return { error: 'Checking transcription progress failed.', stage: 'xfyun-progress-error', detail: progress.failed, raw: progress.raw };
    }
    let statusInfo: { status?: number; desc?: string } = {};
    try {
      statusInfo = typeof progress.data === 'string' ? JSON.parse(progress.data) : (progress.data as typeof statusInfo) ?? {};
    } catch {
      // keep statusInfo empty — treated as "still processing" below
    }
    if (statusInfo.status === 9) {
      break;
    }
    if (attempt === maxAttempts - 1) {
      return { error: 'Transcription took too long. Please try again.', stage: 'xfyun-progress-timeout', raw: lastProgressRaw };
    }
  }

  // 5. getResult — fetch and parse the actual transcript.
  const result = await fetchJson(`${LFASR_HOST}/getResult?${authQuery(appId, apiSecret)}&task_id=${encodeURIComponent(taskId)}`, {
    method: 'POST',
  });
  if (result.ok !== 0) {
    console.error('xfyun getResult failed:', result.failed, result.raw);
    return { error: "We couldn't retrieve your transcription.", stage: 'xfyun-result-error', detail: result.failed, raw: result.raw };
  }

  const transcript = extractTranscript(result.data);
  if (!transcript) {
    console.error('xfyun getResult parsed but no transcript extracted. Raw:', result.raw);
    return {
      error: "We couldn't detect your voice. Please try again.",
      stage: 'xfyun-parse-error',
      raw: result.raw,
    };
  }

  return { transcript };
}
