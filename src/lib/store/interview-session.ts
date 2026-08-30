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
  transcripts: TranscriptEntry[];
  practiceTranscripts: TranscriptEntry[];
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

export function initSession(examinerId: string, examinerName: string) {
  session = {
    examinerId,
    examinerName,
    transcripts: [],
    practiceTranscripts: [],
  };
  saveSession(session);
}

export function getSession(): InterviewSession | null {
  return session;
}

export function addTranscript(entry: TranscriptEntry) {
  if (session) {
    session.transcripts.push(entry);
    saveSession(session);
  }
}

export function addPracticeTranscript(entry: TranscriptEntry) {
  if (session) {
    session.practiceTranscripts.push(entry);
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
