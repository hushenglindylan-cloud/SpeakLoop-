export interface Examiner {
  id: string;
  name: string;
  gender: 'Male' | 'Female';
  ethnicity: 'White' | 'Asian' | 'Black';
  personality: 'Strict' | 'Friendly' | 'Encouraging' | 'Challenging';
  difficulty: 'Easy' | 'Standard' | 'Challenging';
  bio: string;
}

export interface EvaluationScore {
  fluencyCoherence: number;
  lexicalResource: number;
  grammaticalRange: number;
  pronunciation: number;
  overallBand: number;
}

export interface EvaluationDetail {
  scores: EvaluationScore;
  evidence: string[];
  mainWeakness: string;
  improvementFocus: string;
  improvedSampleAnswer: string;
}

export interface PracticeQuestion {
  id: string;
  topic: string;
  question: string;
  aiFollowUp: string;
  contextHint: string;
}

// Only American examiners are offered: the TTS catalogue has no native
// British, Australian or Indian English voice (see lib/tts-voices.ts), and an
// examiner whose accent contradicts their persona is worse than one fewer
// choice. Nationality is therefore no longer a field — every examiner here is
// American, so storing it would say nothing.
//
// What still varies is what actually drives the interview: personality shapes
// the examiner's tone and how they probe, difficulty shapes question
// complexity. All four personalities and all three difficulty levels are
// covered across the twelve.
export const examiners: Examiner[] = [
  // ===== Male (6) =====
  { id: 'A-M-1', name: 'Dr. Michael Torres', gender: 'Male', ethnicity: 'White', personality: 'Friendly', difficulty: 'Easy', bio: 'California-based. Relaxed style, helps candidates feel comfortable.' },
  { id: 'A-M-2', name: 'Mr. David Washington', gender: 'Male', ethnicity: 'Black', personality: 'Challenging', difficulty: 'Challenging', bio: 'Chicago educator. Dynamic style, tests depth of argumentation.' },
  { id: 'A-M-3', name: 'Dr. Kevin Chen', gender: 'Male', ethnicity: 'Asian', personality: 'Encouraging', difficulty: 'Standard', bio: 'MIT graduate. Combines technical precision with motivational coaching.' },
  { id: 'A-M-4', name: 'Mr. Robert Hayes', gender: 'Male', ethnicity: 'White', personality: 'Strict', difficulty: 'Standard', bio: 'DC examiner. Clear expectations, focuses on grammatical accuracy.' },
  { id: 'A-M-5', name: 'Dr. Jamal Williams', gender: 'Male', ethnicity: 'Black', personality: 'Encouraging', difficulty: 'Easy', bio: 'Atlanta-based. Warm personality, builds candidate confidence naturally.' },
  { id: 'A-M-6', name: 'Mr. Jason Park', gender: 'Male', ethnicity: 'Asian', personality: 'Strict', difficulty: 'Challenging', bio: 'NYC examiner. Demands high-level vocabulary and complex grammar.' },

  // ===== Female (6) =====
  { id: 'A-F-1', name: 'Dr. Jennifer Adams', gender: 'Female', ethnicity: 'White', personality: 'Friendly', difficulty: 'Standard', bio: 'Texas-based. Warm personality, natural conversational flow.' },
  { id: 'A-F-2', name: 'Ms. Keisha Brown', gender: 'Female', ethnicity: 'Black', personality: 'Challenging', difficulty: 'Challenging', bio: 'LA examiner. Challenges assumptions while maintaining supportive tone.' },
  { id: 'A-F-3', name: 'Dr. Lisa Wang', gender: 'Female', ethnicity: 'Asian', personality: 'Strict', difficulty: 'Standard', bio: 'Seattle-based. Focuses on coherence and logical argumentation.' },
  { id: 'A-F-4', name: 'Ms. Olivia Martin', gender: 'Female', ethnicity: 'White', personality: 'Encouraging', difficulty: 'Easy', bio: 'Boston examiner. Motivational approach, builds candidate confidence.' },
  { id: 'A-F-5', name: 'Dr. Aisha Johnson', gender: 'Female', ethnicity: 'Black', personality: 'Friendly', difficulty: 'Easy', bio: 'Miami-based. Creates comfortable environment, helps candidates relax.' },
  { id: 'A-F-6', name: 'Ms. Susan Kim', gender: 'Female', ethnicity: 'Asian', personality: 'Challenging', difficulty: 'Challenging', bio: 'San Francisco examiner. Tests limits with abstract and societal topics.' },
];

export const mockEvaluation: EvaluationDetail = {
  scores: {
    fluencyCoherence: 7,
    lexicalResource: 6,
    grammaticalRange: 7,
    pronunciation: 7,
    overallBand: 6.5, // (7+6+7+7)/4 = 6.75, rounded down to nearest 0.5 = 6.5
  },
  evidence: [
    'You maintained good fluency throughout but had some hesitation when discussing abstract concepts like "the role of government in education".',
    'Your vocabulary was adequate but lacked precision. You repeated "very important" and "good thing" instead of using more specific terms like "crucial" or "beneficial".',
    'Grammar was generally accurate with complex structures attempted. Minor errors in article usage ("the society" instead of "society") and subject-verb agreement.',
    'Pronunciation was clear with good intonation patterns. Your stress and rhythm were natural and easy to follow.',
  ],
  mainWeakness:
    'Lexical Resource — Limited range of topic-specific vocabulary. You tend to use generic adjectives ("good", "bad", "important") rather than precise, topic-specific language.',
  improvementFocus:
    'Build topic-specific vocabulary banks for common Part 3 themes. Practice replacing generic words with precise alternatives.',
  improvedSampleAnswer: `
**Question:** "Some people believe that technology has made our lives more complex, not simpler. To what extent do you agree or disagree?"

**Your original answer (paraphrased):**
"I think technology is very important in our lives. It is a good thing but sometimes it makes things complicated. For example, smartphones are good but people spend too much time on them. So it is a bad thing sometimes."

**Improved version (Band 7+ level, based on your ideas):**
"I'd argue that technology is a double-edged sword. On one hand, it has undeniably streamlined many aspects of daily life — for instance, online banking and navigation apps have replaced tedious manual processes. On the other hand, the proliferation of social media has introduced new complexities, such as information overload and diminished attention spans. So rather than making life simply 'more complex', I think technology has shifted the nature of the challenges we face."

**Key improvements:**
- Replaced "very important" → "undeniably streamlined"
- Replaced "good thing" → "double-edged sword" (idiomatic)
- Added specific examples (online banking, navigation apps, social media)
- Used cohesive devices: "On one hand... On the other hand... So rather than..."
- Showed nuanced position instead of simple agree/disagree
`.trim(),
};

export const mockPracticeQuestions: PracticeQuestion[] = [
  {
    id: '1',
    topic: 'Technology & Society',
    question:
      'How has the way people communicate changed over the past few decades, and do you think these changes have been positive overall?',
    aiFollowUp:
      'Do you think face-to-face communication will become less important in the future?',
    contextHint: 'This builds on your previous interview where you discussed technology. Focus on using more precise vocabulary this time — avoid generic words like "good" or "important".',
  },
  {
    id: '2',
    topic: 'Education',
    question:
      'Do you think universities should focus more on practical skills rather than theoretical knowledge?',
    aiFollowUp:
      'How would you balance theoretical and practical components in a university curriculum?',
    contextHint: 'In your first interview, you hesitated when discussing abstract concepts. Try to structure your answer with clear examples this time.',
  },
  {
    id: '3',
    topic: 'Environment',
    question:
      'What role should individual citizens play in addressing environmental problems, compared to governments and corporations?',
    aiFollowUp:
      'Do you think individual actions can truly make a difference, or is systemic change the only solution?',
    contextHint: 'Your previous weakness was lexical resource. Practice using topic-specific vocabulary like "carbon footprint", "sustainability", "regulatory frameworks" instead of generic terms.',
  },
];

export const mockBeforeScores: EvaluationScore = {
  fluencyCoherence: 6,
  lexicalResource: 5,
  grammaticalRange: 6,
  pronunciation: 6,
  overallBand: 5.5, // (6+5+6+6)/4 = 5.75, rounded down to 5.5
};

export const mockAfterScores: EvaluationScore = {
  fluencyCoherence: 7,
  lexicalResource: 7,
  grammaticalRange: 7,
  pronunciation: 7,
  overallBand: 7.0, // (7+7+7+7)/4 = 7.0
};
