// Parse IELTS question bank from xlsx into structured JSON
// Output: src/data/questions.json

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const workbook = XLSX.readFile(resolve(projectRoot, '/tmp/questions.xlsx'));
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

// Skip header row
const dataRows = rows.slice(1).filter(r => r[0] || r[1]);

console.log(`Total data rows: ${dataRows.length}`);

// Step 1: Group rows by Part 2 topic (column 0)
const topicGroups = new Map();
for (const row of dataRows) {
  const part2Topic = (row[0] || '').toString().trim();
  const part3Cell = (row[1] || '').toString().trim();
  if (!part2Topic || !part3Cell) continue;

  if (!topicGroups.has(part2Topic)) {
    topicGroups.set(part2Topic, []);
  }
  topicGroups.get(part2Topic).push(part3Cell);
}

console.log(`Unique Part 2 topics: ${topicGroups.size}`);

// Step 2: Parse Part 3 questions from each cell
// Each cell may contain multiple sub-topics, each with 3 questions
// Sub-topics are separated by the pattern: "SubTopicName\n(verb) question..."

function parsePart3Cell(cellText, part2Topic, difficultyMapping) {
  const questions = [];

  // Split by common separators: newlines with sub-topic headers
  // Pattern: sub-topic name followed by questions with (verb) prefixes
  // Some cells use bullet points (‐), some use <br/>, some use plain newlines

  // Normalize line breaks
  let normalized = cellText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Split into sub-topic groups
  // A sub-topic group starts with a non-parenthesized line (the sub-topic name)
  // followed by lines starting with (verb) or ‐(verb)
  const lines = normalized.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let currentSubTopic = '';
  let currentQuestions = [];
  const groups = [];

  for (const line of lines) {
    // Check if this line is a question (starts with ( or ‐( or -( after cleaning)
    const cleanedLine = line.replace(/^[‐\-•·]\s*/, '');
    const isQuestion = /^\(/.test(cleanedLine);

    if (!isQuestion) {
      // This is a sub-topic header
      if (currentSubTopic && currentQuestions.length > 0) {
        groups.push({ subTopic: currentSubTopic, questions: [...currentQuestions] });
        currentQuestions = [];
      }
      currentSubTopic = line.replace(/^[‐\-•·]\s*/, '').trim();
    } else {
      currentQuestions.push(cleanedLine);
    }
  }
  // Don't forget the last group
  if (currentSubTopic && currentQuestions.length > 0) {
    groups.push({ subTopic: currentSubTopic, questions: [...currentQuestions] });
  }

  // If no groups found (flat structure), treat each question line as its own
  if (groups.length === 0) {
    const allQuestions = lines
      .map(l => l.replace(/^[‐\-•·]\s*/, '').trim())
      .filter(l => /^\(/.test(l));
    if (allQuestions.length > 0) {
      groups.push({ subTopic: part2Topic, questions: allQuestions });
    }
  }

  // Assign difficulty based on group position
  // If 3 groups: easy, standard, challenging
  // If 1 group with 9 questions: split into 3x3
  // If 1 group with 3 questions: all same difficulty (mapped from parent)

  let questionId = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    let difficulty;

    if (groups.length === 3) {
      // 3 groups → easy/standard/challenging
      difficulty = ['Easy', 'Standard', 'Challenging'][gi];
    } else if (groups.length === 1 && group.questions.length === 9) {
      // 1 group with 9 questions → split into 3x3
      // We'll handle this below
      difficulty = null; // will be set per-question
    } else {
      // Use the difficulty mapping from parent
      difficulty = difficultyMapping || 'Standard';
    }

    if (group.questions.length === 9 && groups.length === 1) {
      // Split 9 questions into 3 groups of 3
      for (let qi = 0; qi < group.questions.length; qi++) {
        const q = parseQuestionLine(group.questions[qi]);
        if (q) {
          const qDifficulty = qi < 3 ? 'Easy' : qi < 6 ? 'Standard' : 'Challenging';
          questions.push({
            id: `q-${questionId++}`,
            part: 3,
            topic: group.subTopic,
            source: part2Topic,
            difficulty: qDifficulty,
            questionType: q.verb,
            question: q.text,
          });
        }
      }
    } else {
      for (const qLine of group.questions) {
        const q = parseQuestionLine(qLine);
        if (q) {
          questions.push({
            id: `q-${questionId++}`,
            part: 3,
            topic: group.subTopic,
            source: part2Topic,
            difficulty,
            questionType: q.verb,
            question: q.text,
          });
        }
      }
    }
  }

  return questions;
}

function parseQuestionLine(line) {
  // Pattern: (verb) question text
  // or: (verb phrase) question text
  // Also handles: (1) text, (2) text (numbered format without verb)
  const match = line.match(/^\(([^)]+)\)\s*(.+)/);
  if (!match) return null;

  const rawVerb = match[1].trim().toLowerCase();
  let text = match[2].trim();

  // Clean up the text
  text = text.replace(/^[‐\-•·]\s*/, '').trim();

  if (!text) return null;

  // If the "verb" is just a number, it's a numbered prompt without a verb tag
  // Use "discuss" as default questionType
  const verb = /^\d+$/.test(rawVerb) ? 'discuss' : rawVerb;

  return { verb, text };
}

// Step 3: Process all topics
const allQuestions = [];
let globalId = 0;

for (const [part2Topic, rows] of topicGroups.entries()) {
  let topicQuestions = [];

  if (rows.length === 3) {
    // 3 rows → each row is a difficulty level
    const difficulties = ['Easy', 'Standard', 'Challenging'];
    for (let i = 0; i < 3; i++) {
      const parsed = parsePart3Cell(rows[i], part2Topic, difficulties[i]);
      topicQuestions.push(...parsed);
    }
  } else if (rows.length === 1) {
    // 1 row → may contain 9 questions (3 groups of 3)
    const parsed = parsePart3Cell(rows[0], part2Topic, null);
    topicQuestions.push(...parsed);
  } else {
    // Unexpected count, treat each row as Standard
    for (const row of rows) {
      const parsed = parsePart3Cell(row, part2Topic, 'Standard');
      topicQuestions.push(...parsed);
    }
  }

  // Re-number IDs globally
  for (const q of topicQuestions) {
    q.id = `p3-${String(globalId++).padStart(3, '0')}`;
  }

  allQuestions.push(...topicQuestions);
}

console.log(`Total Part 3 questions parsed: ${allQuestions.length}`);

// Step 4: Show stats
const byDifficulty = {};
const byVerb = {};
for (const q of allQuestions) {
  byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
  byVerb[q.questionType] = (byVerb[q.questionType] || 0) + 1;
}
console.log('\nBy difficulty:', JSON.stringify(byDifficulty, null, 2));
console.log('\nTop verbs:', Object.entries(byVerb).sort((a, b) => b[1] - a[1]).slice(0, 10));

// Step 5: Write output
const outDir = resolve(projectRoot, 'src/data');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'questions.json');
writeFileSync(outPath, JSON.stringify(allQuestions, null, 2));
console.log(`\nWritten to: ${outPath}`);

// Print first 5 as sample
console.log('\nSample questions:');
for (const q of allQuestions.slice(0, 5)) {
  console.log(`  [${q.id}] ${q.difficulty} | (${q.questionType}) ${q.question.slice(0, 80)}...`);
}
