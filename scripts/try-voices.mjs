#!/usr/bin/env node
/**
 * Probe which Qwen-TTS voices exist and what they sound like.
 *
 * The published voice list does not say which English voices carry which
 * accent, and accent is the deciding factor for an IELTS examiner. Rather than
 * guessing from documentation, this asks the API directly: every candidate
 * voice is synthesised with the same English sentence, invalid ones are
 * reported as such, and the valid ones are saved as .wav files to listen to.
 *
 * Usage:
 *   export DASHSCOPE_API_KEY=sk-...
 *   node scripts/try-voices.mjs                    # try the built-in candidates
 *   node scripts/try-voices.mjs Cherry Ethan Ryan  # try specific voices
 *
 * Options (environment):
 *   DASHSCOPE_TTS_MODEL   default qwen3-tts-flash
 *   DASHSCOPE_TTS_URL     override for the Singapore region
 *   TTS_OUT_DIR           where to write the audio (default ./tts-samples)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = process.env.DASHSCOPE_TTS_MODEL || 'qwen3-tts-flash';
const URL_ENDPOINT =
  process.env.DASHSCOPE_TTS_URL ||
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const OUT_DIR = process.env.TTS_OUT_DIR || path.resolve(process.cwd(), 'tts-samples');

// Long enough to judge accent and intonation, and representative of what an
// examiner actually says in Part 3.
const SAMPLE_TEXT =
  "Let's move on to a more general question. Do you think the way people " +
  "communicate with each other has changed for the better over the last twenty years?";

// Names seen in circulation for this model family. Anything invalid is simply
// reported as invalid — that is the point of running this.
const DEFAULT_CANDIDATES = [
  'Cherry', 'Ethan', 'Nofish', 'Jennifer', 'Ryan', 'Katerina', 'Elias', 'Jada',
  'Dylan', 'Sunny', 'Li', 'Marcus', 'Roy', 'Peter', 'Rocky', 'Kiki', 'Eric',
];

if (!API_KEY) {
  console.error('DASHSCOPE_API_KEY is not set.');
  console.error('  export DASHSCOPE_API_KEY=sk-...   then re-run.');
  process.exit(1);
}

const voices = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CANDIDATES;

async function synthesize(voice) {
  const res = await fetch(URL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: { text: SAMPLE_TEXT, voice, language_type: 'English' },
    }),
  });

  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, reason: `non-JSON response (HTTP ${res.status}): ${bodyText.slice(0, 160)}` };
  }

  if (!res.ok) {
    // An unknown voice for this model comes back as InvalidParameter.
    return { ok: false, reason: `${body.code || `HTTP ${res.status}`}: ${body.message || bodyText.slice(0, 160)}` };
  }

  const url = body?.output?.audio?.url;
  if (!url) return { ok: false, reason: `no audio url in response: ${bodyText.slice(0, 160)}` };
  return { ok: true, url };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

await mkdir(OUT_DIR, { recursive: true });

console.log(`Model:    ${MODEL}`);
console.log(`Endpoint: ${URL_ENDPOINT}`);
console.log(`Saving to ${OUT_DIR}\n`);

const valid = [];
const invalid = [];

for (const voice of voices) {
  process.stdout.write(`${voice.padEnd(12)} `);
  try {
    const result = await synthesize(voice);
    if (!result.ok) {
      console.log(`✗  ${result.reason}`);
      invalid.push(voice);
      continue;
    }
    const dest = path.join(OUT_DIR, `${voice}.wav`);
    await download(result.url, dest);
    console.log(`✓  saved ${path.basename(dest)}`);
    valid.push(voice);
  } catch (err) {
    console.log(`✗  ${err instanceof Error ? err.message : String(err)}`);
    invalid.push(voice);
  }
}

console.log(`\nValid voices (${valid.length}): ${valid.join(', ') || '(none)'}`);
if (invalid.length) console.log(`Invalid/failed (${invalid.length}): ${invalid.join(', ')}`);
console.log(`
Next: listen to the files in ${OUT_DIR} and note, for each voice, whether it
sounds British / American / Australian / Indian and whether it is male or
female. Those are the two facts src/lib/tts-voices.ts needs.`);
