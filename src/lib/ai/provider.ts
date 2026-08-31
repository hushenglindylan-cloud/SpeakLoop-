// Unified AI provider for SpeakLoop — single DASHSCOPE_API_KEY, three models.
//
// STT:  qwen3-asr-flash  — audio → transcript
// LLM:  qwen3.5-flash    — text → structured AI decisions
// TTS:  qwen3-tts-flash  — examiner question text → spoken audio
//
// STT and LLM use the DashScope OpenAI-compatible endpoint; TTS uses
// DashScope's native multimodal-generation endpoint, which is a different base
// URL and request shape (see synthesizeSpeech).
// This module is server-only; the API key must never reach the client bundle.

import { randomUUID } from 'crypto';

const DASHSCOPE_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';

// Qwen-TTS is not served from the OpenAI-compatible surface — it has its own
// native endpoint. Overridable because the Singapore region uses a different
// host (and its API keys are not interchangeable with Beijing's).
const DASHSCOPE_TTS_URL =
  process.env.DASHSCOPE_TTS_URL ||
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

const TTS_MODEL = process.env.DASHSCOPE_TTS_MODEL || 'qwen3-tts-flash';

// Generate a short request ID for tracing
function requestId(): string {
  return randomUUID().slice(0, 8);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) {
    throw new Error(
      'DASHSCOPE_API_KEY is not set. Please configure it in the environment.'
    );
  }
  return key;
}

/**
 * Generic OpenAI-compatible chat completion call.
 * Used by both STT and LLM paths — they differ only in model and message shape.
 */
async function chatCompletion<T = unknown>(params: {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature?: number;
  responseFormat?: { type: 'json_object' };
  signal?: AbortSignal;
}): Promise<T> {
  const apiKey = getApiKey();

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
  };

  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }

  if (params.responseFormat) {
    body.response_format = params.responseFormat;
  }

  // Retry logic for transient failures (5xx, network errors)
  const MAX_RETRIES = 2;
  let lastError: Error | null = null;
  const reqId = requestId();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[AI:${reqId}] Retry attempt ${attempt} for model=${params.model}`);
      }
      const response = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });

      if (!response.ok) {
        const rawText = await response.text().catch(() => '');
        // Don't retry 4xx errors (client errors)
        if (response.status >= 400 && response.status < 500) {
          throw new Error(
            `DashScope API error (status ${response.status}): ${rawText.slice(0, 500)}`
          );
        }
        throw new Error(
          `DashScope API error (status ${response.status}): ${rawText.slice(0, 500)}`
        );
      }

      const data = await response.json();
      return data as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Don't retry if aborted (timeout)
      if (params.signal?.aborted) throw lastError;
      // Don't retry 4xx errors
      if (lastError.message.includes('status 4')) throw lastError;
      // Wait before retry (exponential backoff)
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new Error('DashScope API request failed after retries');
}

// ---------------------------------------------------------------------------
// STT — Qwen3-ASR-Flash
// ---------------------------------------------------------------------------

export interface STTResult {
  transcript: string;
}

export interface STTError {
  error: string;
  stage: string;
  detail?: string;
}

/**
 * Transcribe an audio blob using Qwen3-ASR-Flash.
 *
 * Accepts any audio format the browser can record (webm/opus, mp4/aac, etc.).
 * The audio is sent as base64 — no PCM conversion needed on the client.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/webm'
): Promise<STTResult | STTError> {
  if (audioBuffer.length === 0) {
    return {
      error: "We couldn't detect your voice. Please try again.",
      stage: 'empty-audio',
    };
  }

  const base64Audio = audioBuffer.toString('base64');
  // Build a data URI so the API can decode the container/codec automatically
  const dataUri = `data:${mimeType};base64,${base64Audio}`;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 60_000);

  try {
    interface ASRResponse {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    }

    const data = await chatCompletion<ASRResponse>({
      model: 'qwen3-asr-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: dataUri,
              },
            },
          ],
        },
      ],
      signal: timeoutController.signal,
    });

    const transcript = data?.choices?.[0]?.message?.content;

    if (typeof transcript === 'string' && transcript.trim().length > 0) {
      return { transcript: transcript.trim() };
    }

    return {
      error: "We couldn't detect your voice. Please try again.",
      stage: 'asr-empty-result',
      detail: 'Model returned empty transcript',
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error && err.name === 'AbortError';
    console.error(
      `Qwen3-ASR-Flash ${isTimeout ? 'timed out' : 'error'}:`,
      err
    );
    return {
      error: isTimeout
        ? 'Transcription timed out. Please try again.'
        : 'Transcription failed. Please try again.',
      stage: isTimeout ? 'asr-timeout' : 'asr-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// LLM — qwen3.5-flash
// ---------------------------------------------------------------------------

export interface LLMChatOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

/**
 * Call qwen3.5-flash for text generation tasks:
 * follow-up generation, evaluation, progress analysis, etc.
 */
export async function llmChat(options: LLMChatOptions): Promise<string> {
  const {
    systemPrompt,
    userPrompt,
    temperature = 0.7,
    jsonMode = false,
    timeoutMs = 30_000,
  } = options;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    interface LLMResponse {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    }

    const data = await chatCompletion<LLMResponse>({
      model: 'qwen3.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      responseFormat: jsonMode ? { type: 'json_object' } : undefined,
      signal: timeoutController.signal,
    });

    const content = data?.choices?.[0]?.message?.content;

    if (typeof content === 'string' && content.trim().length > 0) {
      return content.trim();
    }

    throw new Error('LLM returned empty content');
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// TTS — qwen3-tts-flash
// ---------------------------------------------------------------------------

export interface TTSResult {
  /** URL of the synthesised audio. DashScope expires these after 24 hours. */
  audioUrl: string;
}

export interface TTSError {
  error: string;
  stage: string;
  detail?: string;
}

/**
 * Speak a question in the examiner's voice.
 *
 * Uses the non-streaming mode, which answers with a URL to the finished audio
 * rather than the bytes: the browser then fetches it straight from DashScope,
 * so the audio never has to be relayed through this server.
 *
 * Note this endpoint is NOT the OpenAI-compatible one used elsewhere in this
 * module — Qwen-TTS is served from DashScope's native multimodal-generation
 * API, with the payload nested under `input` and the result at
 * `output.audio.url`.
 */
export async function synthesizeSpeech(options: {
  text: string;
  voice: string;
  /** Matching the text's language gives correct pronunciation and intonation. */
  languageType?: string;
  timeoutMs?: number;
}): Promise<TTSResult | TTSError> {
  const { text, voice, languageType = 'English', timeoutMs = 30_000 } = options;

  if (!text.trim()) {
    return { error: 'Nothing to speak.', stage: 'tts-empty-text' };
  }

  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (err) {
    return {
      error: 'Speech synthesis is not configured.',
      stage: 'tts-no-api-key',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const reqId = requestId();

  try {
    const response = await fetch(DASHSCOPE_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: { text, voice, language_type: languageType },
      }),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      console.error(`[TTS:${reqId}] DashScope error ${response.status}: ${rawText.slice(0, 300)}`);
      return {
        error: 'Could not generate the examiner audio.',
        stage: 'tts-http-error',
        detail: `status ${response.status}: ${rawText.slice(0, 300)}`,
      };
    }

    interface TTSResponse {
      output?: { audio?: { url?: string } };
      message?: string;
    }
    const data = (await response.json()) as TTSResponse;
    const audioUrl = data?.output?.audio?.url;

    if (typeof audioUrl === 'string' && audioUrl.length > 0) {
      return { audioUrl };
    }

    console.error(`[TTS:${reqId}] No audio URL in response:`, JSON.stringify(data).slice(0, 300));
    return {
      error: 'Could not generate the examiner audio.',
      stage: 'tts-no-audio-url',
      detail: data?.message,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(`[TTS:${reqId}] ${isTimeout ? 'timed out' : 'failed'}:`, err);
    return {
      error: isTimeout
        ? 'The examiner audio took too long to generate.'
        : 'Could not generate the examiner audio.',
      stage: isTimeout ? 'tts-timeout' : 'tts-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
