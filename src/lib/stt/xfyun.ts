import crypto from 'crypto';

// iFlytek (讯飞开放平台) "语音转写" (LFASR — long-form ASR) REST API client.
//
// Chosen over Groq/OpenAI Whisper specifically because it's reachable from
// mainland-China-hosted servers (Groq returned a bare 403 "Forbidden" from
// Coze's hosting network — most likely a region/IP-level block on Groq's
// side, unrelated to the API key). iFlytek's servers are the ones Coze
// itself already talks to, so this avoids that class of problem entirely.
//
// This sandbox's network egress is blocked from every iFlytek domain (the
// docs site and the API host itself, raasr.xfyun.cn), so this couldn't be
// tested against the real API directly. The first version of this file was
// written from prose documentation summaries and got several things wrong
// (camelCase `appId` instead of `app_id`, auth params in the query string
// instead of the POST body, and a wrong getResult response shape) — all of
// which surfaced as a real "app_id illegal" error in production. This
// version was rewritten against a real, working open-source reference
// implementation (github.com/doem97/audio_to_SRT's webapi.py) rather than
// prose docs, which is far more trustworthy for exact field names and
// request shape. If it's still wrong, `raw` in any xfyun-* error response
// dumps the actual payload iFlytek sent back.

const LFASR_HOST = 'https://raasr.xfyun.cn/api';

export type XfyunResult =
  | { transcript: string }
  | { error: string; stage: string; detail?: string; raw?: string };

function buildSigna(appId: string, apiSecret: string, ts: string): string {
  const baseString = appId + ts;
  const md5Hash = crypto.createHash('md5').update(baseString).digest('hex');
  return crypto.createHmac('sha1', apiSecret).update(md5Hash).digest('base64');
}

// Every request (auth params included) is sent as regular POST body fields
// — NOT query-string params. This matches the reference implementation,
// where all calls go through `requests.post(url, data=param_dict, ...)`.
function authParams(appId: string, apiSecret: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  return { app_id: appId, signa: buildSigna(appId, apiSecret, ts), ts };
}

async function postForm(
  path: string,
  fields: Record<string, string>
): Promise<{ ok: number; data?: unknown; failed?: string; raw: string }> {
  const body = new URLSearchParams(fields);
  const res = await fetch(`${LFASR_HOST}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseLfasrResponse(res);
}

async function postMultipart(
  path: string,
  fields: Record<string, string>,
  fileField: { name: string; data: Buffer }
): Promise<{ ok: number; data?: unknown; failed?: string; raw: string }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  form.append(fileField.name, new Blob([new Uint8Array(fileField.data)]), fileField.name);
  const res = await fetch(`${LFASR_HOST}${path}`, { method: 'POST', body: form });
  return parseLfasrResponse(res);
}

async function parseLfasrResponse(res: Response): Promise<{ ok: number; data?: unknown; failed?: string; raw: string }> {
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

// slice_id starts at 'aaaaaaaaaa' (10 chars) per the reference
// SliceIdGenerator — only its first value is needed since our answers are
// always well under the 10MB single-slice threshold.
const FIRST_SLICE_ID = 'aaaaaaaaaa';

// getResult's `data` field is itself a JSON-array-as-string, each entry
// shaped { bg, ed, onebest } — `onebest` is that segment's recognized text.
// (Confirmed against the reference implementation; earlier version of this
// file assumed a much more deeply nested "lattice/json_1best" shape from
// a different iFlytek product's docs, which was wrong for this one.)
function extractTranscript(resultData: unknown): string | null {
  try {
    const segments = (typeof resultData === 'string' ? JSON.parse(resultData) : resultData) as Array<{ onebest?: string }>;
    if (!Array.isArray(segments)) return null;
    const text = segments
      .map((s) => s.onebest ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
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
  const prepare = await postForm('/prepare', {
    ...authParams(appId, apiSecret),
    file_len: String(audioBuffer.length),
    file_name: filename,
    slice_num: '1',
    language: 'en',
    speaker_number: '1',
    pd: 'tech',
  });
  if (prepare.ok !== 0 || typeof prepare.data !== 'string') {
    console.error('xfyun prepare failed:', prepare.failed, prepare.raw);
    return { error: 'Transcription setup failed.', stage: 'xfyun-prepare-error', detail: prepare.failed, raw: prepare.raw };
  }
  const taskId = prepare.data;

  // 2. upload — single slice (our answers are short enough not to need
  // chunking). Sent as multipart/form-data with the audio bytes in a
  // "content" file part, alongside the usual auth + task fields.
  const upload = await postMultipart(
    '/upload',
    { ...authParams(appId, apiSecret), task_id: taskId, slice_id: FIRST_SLICE_ID },
    { name: 'content', data: audioBuffer }
  );
  if (upload.ok !== 0) {
    console.error('xfyun upload failed:', upload.failed, upload.raw);
    return { error: 'Uploading your answer failed.', stage: 'xfyun-upload-error', detail: upload.failed, raw: upload.raw };
  }

  // 3. merge — tells iFlytek all slices are in and processing can start.
  const merge = await postForm('/merge', { ...authParams(appId, apiSecret), task_id: taskId, file_name: filename });
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
    const progress = await postForm('/getProgress', { ...authParams(appId, apiSecret), task_id: taskId });
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
  const result = await postForm('/getResult', { ...authParams(appId, apiSecret), task_id: taskId });
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
