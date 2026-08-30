/**
 * generate-portrait-prompts.js
 *
 * Reads the `examiners` array DIRECTLY from src/lib/mock/data.ts (does not
 * hand-copy the data — avoids drift if the roster changes) and outputs a
 * ready-to-use photorealistic portrait generation prompt for each examiner,
 * plus the target file path each image should be saved to.
 *
 * Usage (run from the project root, e.g. `projects/`):
 *   node scripts/generate-portrait-prompts.js
 *   node scripts/generate-portrait-prompts.js --json   (machine-readable output)
 *
 * This does NOT call any image generation API itself — it only builds the
 * prompts. Wire the output into whichever API you use (e.g. Google Gemini's
 * image generation / "Nano Banana", which has a free tier with no credit
 * card required as of writing — see aistudio.google.com).
 *
 * Each generated image should be saved as: public/examiners/{id}.jpg
 * (id matches the `id` field, e.g. "B-M-1.jpg")
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.resolve(__dirname, '..', 'src', 'lib', 'mock', 'data.ts');

function parseExaminers(sourceText) {
  const match = sourceText.match(/export const examiners:\s*Examiner\[\]\s*=\s*\[([\s\S]*?)\n\];/);
  if (!match) {
    throw new Error('Could not find `export const examiners: Examiner[] = [...]` in data.ts — has the format changed?');
  }
  const block = match[1];

  // Matches each `{ id: '...', name: '...', nationality: '...', gender: '...',
  // ethnicity: '...', personality: '...', difficulty: '...', bio: '...' }`
  // entry. Uses a tolerant field-by-field regex rather than one giant regex
  // so a stray apostrophe inside a name (e.g. "O'Brien") can't silently
  // break parsing.
  const entryRegex = /\{\s*id:\s*'([^']+)'[^}]*?\}/g;
  const entries = [];
  let m;
  while ((m = entryRegex.exec(block)) !== null) {
    const entryText = m[0];
    const field = (name) => {
      const fieldMatch = entryText.match(new RegExp(`${name}:\\s*'((?:[^'\\\\]|\\\\.)*)'`));
      return fieldMatch ? fieldMatch[1].replace(/\\'/g, "'") : null;
    };
    entries.push({
      id: field('id'),
      name: field('name'),
      nationality: field('nationality'),
      gender: field('gender'),
      ethnicity: field('ethnicity'),
      personality: field('personality'),
      difficulty: field('difficulty'),
    });
  }
  return entries;
}

const expressionByPersonality = {
  Strict: 'a composed, serious expression, direct eye contact, minimal smile',
  Friendly: 'a warm, genuine smile, relaxed and approachable expression',
  Encouraging: 'a kind, supportive expression with a gentle smile',
  Challenging: 'an intense, focused expression, confident direct gaze',
};

const ageByTitle = (name) => (name && name.startsWith('Dr.') ? 'in their mid-40s to mid-50s' : 'in their early 30s to mid-40s');

function buildPrompt(examiner) {
  const age = ageByTitle(examiner.name);
  const expression = expressionByPersonality[examiner.personality] || 'a professional, neutral expression';
  return [
    `Professional photorealistic headshot portrait of a ${examiner.ethnicity} ${String(examiner.gender).toLowerCase()},`,
    `${age}, ${expression}.`,
    `Wearing smart professional attire (blazer or button-down shirt), suitable for an academic examiner.`,
    `Neutral soft-gray studio background, even soft natural lighting, shot on an 85mm portrait lens,`,
    `shallow depth of field, sharp focus on the eyes, realistic skin texture, photographic quality —`,
    `NOT an illustration, NOT a cartoon, NOT 3D-rendered, NOT anime. Square aspect ratio, headshot framing`,
    `(head and shoulders only).`,
  ].join(' ');
}

function main() {
  const asJson = process.argv.includes('--json');

  const sourceText = fs.readFileSync(DATA_FILE, 'utf-8');
  const examiners = parseExaminers(sourceText);

  if (examiners.length === 0) {
    throw new Error('Parsed 0 examiners — check that data.ts matches the expected format.');
  }

  const rows = examiners.map((e) => ({
    id: e.id,
    outputPath: `public/examiners/${e.id}.jpg`,
    prompt: buildPrompt(e),
  }));

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  for (const row of rows) {
    console.log(`--- ${row.id} → ${row.outputPath} ---`);
    console.log(row.prompt);
    console.log('');
  }
  console.log(`Total: ${rows.length} prompts generated (parsed live from src/lib/mock/data.ts).`);
  console.log(`Run with --json for machine-readable output to pipe into a generation script.`);
}

main();
