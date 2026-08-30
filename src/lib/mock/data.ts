export interface Examiner {
  id: string;
  name: string;
  nationality: 'British' | 'American' | 'Australian' | 'Indian';
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

// Helper: each (nationality, gender) combo has 6 examiners covering all 4 personalities + 3 difficulties
export const examiners: Examiner[] = [
  // ===== British - Male (6) =====
  { id: 'B-M-1', name: 'Dr. James Whitfield', nationality: 'British', gender: 'Male', ethnicity: 'White', personality: 'Strict', difficulty: 'Easy', bio: 'Retired Oxford don. Patient with beginners but expects clear structure.' },
  { id: 'B-M-2', name: 'Mr. Oliver Clarke', nationality: 'British', gender: 'Male', ethnicity: 'White', personality: 'Friendly', difficulty: 'Standard', bio: 'London-based examiner. Warm conversational style, 10 years experience.' },
  { id: 'B-M-3', name: 'Dr. Wei Huang', nationality: 'British', gender: 'Male', ethnicity: 'Asian', personality: 'Encouraging', difficulty: 'Challenging', bio: 'Cambridge-educated. Understands ESL challenges firsthand, pushes for excellence.' },
  { id: 'B-M-4', name: 'Mr. Marcus Bennett', nationality: 'British', gender: 'Male', ethnicity: 'Black', personality: 'Challenging', difficulty: 'Standard', bio: 'Birmingham examiner. Loves intellectual debate and abstract topics.' },
  { id: 'B-M-5', name: 'Dr. Raj Kapoor', nationality: 'British', gender: 'Male', ethnicity: 'Asian', personality: 'Friendly', difficulty: 'Easy', bio: 'Manchester-based. Creates relaxed atmosphere, helps nervous candidates.' },
  { id: 'B-M-6', name: 'Mr. Thomas Greene', nationality: 'British', gender: 'Male', ethnicity: 'White', personality: 'Strict', difficulty: 'Challenging', bio: 'Cambridge examiner. Demands academic precision and complex structures.' },

  // ===== British - Female (6) =====
  { id: 'B-F-1', name: 'Dr. Elizabeth Hart', nationality: 'British', gender: 'Female', ethnicity: 'White', personality: 'Encouraging', difficulty: 'Standard', bio: '15 years IELTS experience. Creates safe space for candidates to excel.' },
  { id: 'B-F-2', name: 'Ms. Sarah Mitchell', nationality: 'British', gender: 'Female', ethnicity: 'White', personality: 'Strict', difficulty: 'Challenging', bio: 'Oxford examiner. Rigorous standards with detailed constructive feedback.' },
  { id: 'B-F-3', name: 'Dr. Mei Lin', nationality: 'British', gender: 'Female', ethnicity: 'Asian', personality: 'Friendly', difficulty: 'Easy', bio: 'Born in London to Chinese parents. Understands cultural nuances in communication.' },
  { id: 'B-F-4', name: 'Ms. Amara Osei', nationality: 'British', gender: 'Female', ethnicity: 'Black', personality: 'Challenging', difficulty: 'Standard', bio: 'Edinburgh examiner. Pushes candidates to think critically and deeply.' },
  { id: 'B-F-5', name: 'Dr. Priya Sharma', nationality: 'British', gender: 'Female', ethnicity: 'Asian', personality: 'Encouraging', difficulty: 'Challenging', bio: 'Bristol-based. Supportive yet demanding, focuses on extended responses.' },
  { id: 'B-F-6', name: 'Ms. Charlotte Webb', nationality: 'British', gender: 'Female', ethnicity: 'White', personality: 'Friendly', difficulty: 'Standard', bio: 'Leeds examiner. Natural conversational flow, genuine interest in views.' },

  // ===== American - Male (6) =====
  { id: 'A-M-1', name: 'Dr. Michael Torres', nationality: 'American', gender: 'Male', ethnicity: 'White', personality: 'Friendly', difficulty: 'Easy', bio: 'California-based. Relaxed style, helps candidates feel comfortable.' },
  { id: 'A-M-2', name: 'Mr. David Washington', nationality: 'American', gender: 'Male', ethnicity: 'Black', personality: 'Challenging', difficulty: 'Challenging', bio: 'Chicago educator. Dynamic style, tests depth of argumentation.' },
  { id: 'A-M-3', name: 'Dr. Kevin Chen', nationality: 'American', gender: 'Male', ethnicity: 'Asian', personality: 'Encouraging', difficulty: 'Standard', bio: 'MIT graduate. Combines technical precision with motivational coaching.' },
  { id: 'A-M-4', name: 'Mr. Robert Hayes', nationality: 'American', gender: 'Male', ethnicity: 'White', personality: 'Strict', difficulty: 'Standard', bio: 'DC examiner. Clear expectations, focuses on grammatical accuracy.' },
  { id: 'A-M-5', name: 'Dr. Jamal Williams', nationality: 'American', gender: 'Male', ethnicity: 'Black', personality: 'Encouraging', difficulty: 'Easy', bio: 'Atlanta-based. Warm personality, builds candidate confidence naturally.' },
  { id: 'A-M-6', name: 'Mr. Jason Park', nationality: 'American', gender: 'Male', ethnicity: 'Asian', personality: 'Strict', difficulty: 'Challenging', bio: 'NYC examiner. Demands high-level vocabulary and complex grammar.' },

  // ===== American - Female (6) =====
  { id: 'A-F-1', name: 'Dr. Jennifer Adams', nationality: 'American', gender: 'Female', ethnicity: 'White', personality: 'Friendly', difficulty: 'Standard', bio: 'Texas-based. Warm personality, natural conversational flow.' },
  { id: 'A-F-2', name: 'Ms. Keisha Brown', nationality: 'American', gender: 'Female', ethnicity: 'Black', personality: 'Challenging', difficulty: 'Challenging', bio: 'LA examiner. Challenges assumptions while maintaining supportive tone.' },
  { id: 'A-F-3', name: 'Dr. Lisa Wang', nationality: 'American', gender: 'Female', ethnicity: 'Asian', personality: 'Strict', difficulty: 'Standard', bio: 'Seattle-based. Focuses on coherence and logical argumentation.' },
  { id: 'A-F-4', name: 'Ms. Olivia Martin', nationality: 'American', gender: 'Female', ethnicity: 'White', personality: 'Encouraging', difficulty: 'Easy', bio: 'Boston examiner. Motivational approach, builds candidate confidence.' },
  { id: 'A-F-5', name: 'Dr. Aisha Johnson', nationality: 'American', gender: 'Female', ethnicity: 'Black', personality: 'Friendly', difficulty: 'Easy', bio: 'Miami-based. Creates comfortable environment, helps candidates relax.' },
  { id: 'A-F-6', name: 'Ms. Susan Kim', nationality: 'American', gender: 'Female', ethnicity: 'Asian', personality: 'Challenging', difficulty: 'Challenging', bio: 'San Francisco examiner. Tests limits with abstract and societal topics.' },

  // ===== Australian - Male (6) =====
  { id: 'AU-M-1', name: 'Dr. William O\'Brien', nationality: 'Australian', gender: 'Male', ethnicity: 'White', personality: 'Encouraging', difficulty: 'Standard', bio: 'Melbourne examiner. Known for patience and constructive guidance.' },
  { id: 'AU-M-2', name: 'Mr. Daniel Wilson', nationality: 'Australian', gender: 'Male', ethnicity: 'White', personality: 'Strict', difficulty: 'Challenging', bio: 'Brisbane-based. Clear expectations, focuses on fluency and coherence.' },
  { id: 'AU-M-3', name: 'Dr. Minh Nguyen', nationality: 'Australian', gender: 'Male', ethnicity: 'Asian', personality: 'Challenging', difficulty: 'Standard', bio: 'Sydney-based. Loves intellectual debate and complex topic exploration.' },
  { id: 'AU-M-4', name: 'Mr. Jack Thompson', nationality: 'Australian', gender: 'Male', ethnicity: 'White', personality: 'Friendly', difficulty: 'Easy', bio: 'Perth examiner. Approachable style, helps candidates feel at ease.' },
  { id: 'AU-M-5', name: 'Dr. Arjun Patel', nationality: 'Australian', gender: 'Male', ethnicity: 'Asian', personality: 'Friendly', difficulty: 'Standard', bio: 'Adelaide-based. Warm manner, specializes in building candidate confidence.' },
  { id: 'AU-M-6', name: 'Mr. Ryan Cooper', nationality: 'Australian', gender: 'Male', ethnicity: 'White', personality: 'Encouraging', difficulty: 'Challenging', bio: 'Hobart examiner. Encourages extended responses with detailed feedback.' },

  // ===== Australian - Female (6) =====
  { id: 'AU-F-1', name: 'Ms. Emma Thompson', nationality: 'Australian', gender: 'Female', ethnicity: 'White', personality: 'Friendly', difficulty: 'Standard', bio: 'Sydney examiner. Approachable style, helps candidates relax and perform.' },
  { id: 'AU-F-2', name: 'Dr. Charlotte Brown', nationality: 'Australian', gender: 'Female', ethnicity: 'White', personality: 'Strict', difficulty: 'Challenging', bio: 'Melbourne-based. High standards with focus on lexical precision.' },
  { id: 'AU-F-3', name: 'Dr. Lan Hoang', nationality: 'Australian', gender: 'Female', ethnicity: 'Asian', personality: 'Encouraging', difficulty: 'Easy', bio: 'Perth-based. Patient approach, focuses on building confidence step by step.' },
  { id: 'AU-F-4', name: 'Ms. Sophie Davis', nationality: 'Australian', gender: 'Female', ethnicity: 'White', personality: 'Challenging', difficulty: 'Standard', bio: 'Brisbane examiner. Tests critical thinking with thoughtful follow-ups.' },
  { id: 'AU-F-5', name: 'Ms. Priya Nair', nationality: 'Australian', gender: 'Female', ethnicity: 'Asian', personality: 'Strict', difficulty: 'Easy', bio: 'Canberra-based. Clear structure expectations, supportive feedback style.' },
  { id: 'AU-F-6', name: 'Dr. Olivia Kelly', nationality: 'Australian', gender: 'Female', ethnicity: 'White', personality: 'Encouraging', difficulty: 'Challenging', bio: 'Adelaide examiner. Encourages risk-taking with language while maintaining standards.' },

  // ===== Indian - Male (6) =====
  { id: 'I-M-1', name: 'Dr. Rajesh Kumar', nationality: 'Indian', gender: 'Male', ethnicity: 'Asian', personality: 'Strict', difficulty: 'Challenging', bio: 'Former Delhi University professor. Rigorous standards, pushes candidates to excel.' },
  { id: 'I-M-2', name: 'Mr. Arjun Singh', nationality: 'Indian', gender: 'Male', ethnicity: 'Asian', personality: 'Friendly', difficulty: 'Standard', bio: 'Mumbai-based examiner. Warm personality, creates comfortable test environment.' },
  { id: 'I-M-3', name: 'Dr. Vikram Patel', nationality: 'Indian', gender: 'Male', ethnicity: 'Asian', personality: 'Encouraging', difficulty: 'Easy', bio: 'Bangalore examiner. Patient and supportive, helps candidates express ideas clearly.' },
  { id: 'I-M-4', name: 'Mr. Sanjay Gupta', nationality: 'Indian', gender: 'Male', ethnicity: 'Asian', personality: 'Challenging', difficulty: 'Standard', bio: 'Chennai-based. Challenges candidates with complex societal and philosophical topics.' },
  { id: 'I-M-5', name: 'Dr. Amit Sharma', nationality: 'Indian', gender: 'Male', ethnicity: 'Asian', personality: 'Friendly', difficulty: 'Easy', bio: 'Pune examiner. Known for putting nervous candidates at ease quickly.' },
  { id: 'I-M-6', name: 'Mr. Rohan Desai', nationality: 'Indian', gender: 'Male', ethnicity: 'Asian', personality: 'Strict', difficulty: 'Standard', bio: 'Kolkata-based. Focuses on precision in grammar and lexical resource.' },

  // ===== Indian - Female (6) =====
  { id: 'I-F-1', name: 'Dr. Fatima Ali', nationality: 'Indian', gender: 'Female', ethnicity: 'Asian', personality: 'Strict', difficulty: 'Challenging', bio: 'Delhi examiner. Strict but fair, demands high standards with detailed feedback.' },
  { id: 'I-F-2', name: 'Ms. Sunita Sharma', nationality: 'Indian', gender: 'Female', ethnicity: 'Asian', personality: 'Encouraging', difficulty: 'Standard', bio: 'Mumbai-based. Supportive examiner, focuses on helping candidates shine.' },
  { id: 'I-F-3', name: 'Dr. Priya Nair', nationality: 'Indian', gender: 'Female', ethnicity: 'Asian', personality: 'Friendly', difficulty: 'Easy', bio: 'Bangalore examiner. Approachable manner, helps candidates relax naturally.' },
  { id: 'I-F-4', name: 'Ms. Ananya Das', nationality: 'Indian', gender: 'Female', ethnicity: 'Asian', personality: 'Challenging', difficulty: 'Challenging', bio: 'Hyderabad-based. Pushes candidates beyond comfort zones for real growth.' },
  { id: 'I-F-5', name: 'Dr. Kavita Reddy', nationality: 'Indian', gender: 'Female', ethnicity: 'Asian', personality: 'Encouraging', difficulty: 'Easy', bio: 'Chennai examiner. Motivational style, builds confidence through positive reinforcement.' },
  { id: 'I-F-6', name: 'Ms. Meera Joshi', nationality: 'Indian', gender: 'Female', ethnicity: 'Asian', personality: 'Friendly', difficulty: 'Standard', bio: 'Pune-based. Natural conversationalist, genuinely interested in candidate perspectives.' },
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
