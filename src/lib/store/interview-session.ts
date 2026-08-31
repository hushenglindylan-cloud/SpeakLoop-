// Global state for interview session with localStorage persistence
// Stores transcripts and audio data across pages

export interface TranscriptEntry {
  question: string;
  questionType: 'main' | 'followup';
  answer: string;
}

export interface InterviewSession {
  examinerId: string;
  examinerName: string;
  personality: string;
  difficulty: string;
  transcripts: TranscriptEntry[];
  practiceTranscripts: TranscriptEntry[];
  /** Question bank IDs already asked in this interview — used so Practice can avoid repeats */
  usedQuestionIds: string[];
}

const STORAGE_KEY = 'speakloop_interview_session';

function loadSession(): InterviewSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Ensure practiceTranscripts exists for backward compatibility
      if (!parsed.practiceTranscripts) {
        parsed.practiceTranscripts = [];
      }
      if (!parsed.personality) {
        parsed.personality = 'Friendly';
      }
      if (!parsed.difficulty) {
        parsed.difficulty = 'Standard';
      }
      if (!parsed.usedQuestionIds) {
        parsed.usedQuestionIds = [];
      }
      return parsed;
    }
  } catch (err) {
    console.error('Failed to load session:', err);
  }
  return null;
}

function saveSession(session: InterviewSession | null) {
  if (typeof window === 'undefined') return;
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

let session: InterviewSession | null = loadSession();

export function initSession(examinerId: string, examinerName: string, personality: string = 'Friendly', difficulty: string = 'Standard') {
  session = {
    examinerId,
    examinerName,
    personality,
    difficulty,
    transcripts: [],
    practiceTranscripts: [],
    usedQuestionIds: [],
  };
  saveSession(session);
}

export function getSession(): InterviewSession | null {
  return session;
}

// Records the RAG question bank IDs asked during the interview so Practice
// can exclude them and avoid handing the student the exact same questions.
export function addUsedQuestionIds(ids: string[]) {
  if (session) {
    session.usedQuestionIds.push(...ids);
    saveSession(session);
  }
}

export function getUsedQuestionIds(): string[] {
  return session?.usedQuestionIds ?? [];
}

// Returns the index the entry was stored at, so a caller that doesn't have
// the transcript text yet (STT still running in the background) can reserve
// its place in question order now and patch in the real answer later via
// updateTranscriptAnswer — without that, a background transcription that
// resolves out of order could land against the wrong question.
export function addTranscript(entry: TranscriptEntry): number {
  if (session) {
    const index = session.transcripts.push(entry) - 1;
    saveSession(session);
    return index;
  }
  return -1;
}

export function updateTranscriptAnswer(index: number, answer: string) {
  if (session && session.transcripts[index]) {
    session.transcripts[index].answer = answer;
    saveSession(session);
  }
}

export function addPracticeTranscript(entry: TranscriptEntry): number {
  if (session) {
    const index = session.practiceTranscripts.push(entry) - 1;
    saveSession(session);
    return index;
  }
  return -1;
}

export function updatePracticeTranscriptAnswer(index: number, answer: string) {
  if (session && session.practiceTranscripts[index]) {
    session.practiceTranscripts[index].answer = answer;
    saveSession(session);
  }
}

export function getAllTranscripts(): TranscriptEntry[] {
  return session?.transcripts ?? [];
}

export function getAllPracticeTranscripts(): TranscriptEntry[] {
  return session?.practiceTranscripts ?? [];
}

export function clearSession() {
  session = null;
  saveSession(null);
}
