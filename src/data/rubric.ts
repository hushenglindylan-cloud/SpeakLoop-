// Official IELTS Speaking Band Descriptors (Public Version)
// Source: IELTS.org / chinaielts.org
// Used for evaluation prompt injection in /api/evaluate-interview

export interface BandDescriptor {
  band: number;
  fluencyCoherence: string;
  lexicalResource: string;
  grammaticalRangeAccuracy: string;
  pronunciation: string;
}

export const ieltsSpeakingRubric: BandDescriptor[] = [
  {
    band: 9,
    fluencyCoherence:
      'Speaks fluently with only rare repetition or self-correction; any hesitation is content-related rather than to find words or grammar. Speaks coherently with fully appropriate cohesive features. Develops topics fully and appropriately.',
    lexicalResource:
      'Uses vocabulary with full flexibility and precision in all topics. Uses idiomatic language naturally and accurately.',
    grammaticalRangeAccuracy:
      'Uses a full range of structures naturally and appropriately. Produces consistently accurate structures apart from \'slips\' characteristic of native speaker speech.',
    pronunciation:
      'Uses a full range of pronunciation features with precision and subtlety. Sustains flexible use of features throughout. Is effortless to understand.',
  },
  {
    band: 8,
    fluencyCoherence:
      'Speaks fluently with only occasional repetition or self-correction; hesitation is usually content-related and only rarely to search for language. Develops topics coherently and appropriately.',
    lexicalResource:
      'Uses a wide vocabulary resource readily and flexibly to convey precise meaning. Uses less common and idiomatic vocabulary skilfully, with occasional inaccuracies. Uses paraphrase effectively as required.',
    grammaticalRangeAccuracy:
      'Uses a wide range of structures flexibly. Produces a majority of error-free sentences with only very occasional inappropriacies or basic/non-systematic errors.',
    pronunciation:
      'Uses a wide range of pronunciation features. Sustains flexible use of features, with only occasional lapses. Is easy to understand throughout. L1 accent has minimal effect on intelligibility.',
  },
  {
    band: 7,
    fluencyCoherence:
      'Speaks at length without noticeable effort or loss of coherence. May demonstrate language-related hesitation at times, or some repetition and/or self-correction. Uses a range of connectives and discourse markers with some flexibility.',
    lexicalResource:
      'Uses vocabulary resource flexibly to discuss a variety of topics. Uses some less common and idiomatic vocabulary and shows some awareness of style and collocation, with some inappropriate choices. Uses paraphrase effectively.',
    grammaticalRangeAccuracy:
      'Uses a range of complex structures with some flexibility. Frequently produces error-free sentences, though some grammatical mistakes persist.',
    pronunciation:
      'Shows all the positive features of band 6 and some, but not all, the positive features of band 8.',
    },
  {
    band: 6,
    fluencyCoherence:
      'Is willing to speak at length, though may lose coherence at times due to occasional repetition, self-correction or hesitation. Uses a range of connectives and discourse markers but not always appropriately.',
    lexicalResource:
      'Has a wide enough vocabulary to discuss topics at length and make meaning clear in spite of inappropriacies. Generally paraphrases successfully.',
    grammaticalRangeAccuracy:
      'Uses a mix of simple and complex structures, but with limited flexibility. May make frequent mistakes with complex structures, though these rarely cause comprehension problems. Can generally be understood throughout.',
    pronunciation:
      'Uses a range of pronunciation features with mixed control. Shows some effective use of features but this is not sustained. Can generally be understood throughout, though mispronunciation of individual words or sounds reduces clarity at times.',
  },
  {
    band: 5,
    fluencyCoherence:
      'Usually maintains flow of speech but uses repetition, self-correction and/or slow speech to keep going. May over-use certain connectives and discourse markers. Produces simple speech fluently, but more complex communication causes fluency problems.',
    lexicalResource:
      'Manages to talk about familiar and unfamiliar topics but uses vocabulary with limited flexibility. Attempts to use paraphrase but with mixed success.',
    grammaticalRangeAccuracy:
      'Produces basic sentence forms with reasonable accuracy. Uses a limited range of more complex structures, but these usually contain errors and may cause some comprehension problems.',
    pronunciation:
      'Shows all the positive features of band 4 and some, but not all, the positive features of band 6.',
  },
  {
    band: 4,
    fluencyCoherence:
      'Cannot respond without noticeable pauses and may speak slowly, with frequent repetition and self-correction. Links basic sentences but with repetitious use of simple connectives and some breakdowns in coherence.',
    lexicalResource:
      'Is able to talk about familiar topics but can only convey basic meaning on unfamiliar topics and makes frequent errors in word choice. Rarely attempts paraphrase.',
    grammaticalRangeAccuracy:
      'Produces basic sentence forms and some correct simple sentences but subordinate structures are rare. Errors are frequent and may lead to misunderstanding.',
    pronunciation:
      'Uses a limited range of pronunciation features. Attempts to control features but lapses are frequent. Mispronunciations are frequent and cause some difficulty for the listener.',
  },
  {
    band: 3,
    fluencyCoherence:
      'Speaks with long pauses. Has limited ability to link simple sentences. Gives only simple responses and is frequently unable to convey basic message.',
    lexicalResource:
      'Uses simple vocabulary to convey personal information. Has insufficient vocabulary for less familiar topics.',
    grammaticalRangeAccuracy:
      'Attempts basic sentence forms but with limited success, or relies on apparently memorised utterances. Makes numerous errors except in memorised expressions.',
    pronunciation:
      'Shows some of the features of band 2 and some, but not all, the positive features of band 4.',
  },
  {
    band: 2,
    fluencyCoherence:
      'Pauses lengthily before most words. Little communication possible.',
    lexicalResource:
      'Only produces isolated words or memorised utterances.',
    grammaticalRangeAccuracy:
      'Cannot produce basic sentence forms.',
    pronunciation:
      'Speech is often unintelligible.',
  },
  {
    band: 1,
    fluencyCoherence: 'No communication possible. No rateable language.',
    lexicalResource: 'No communication possible. No rateable language.',
    grammaticalRangeAccuracy: 'No communication possible. No rateable language.',
    pronunciation: 'No communication possible. No rateable language.',
  },
];

// Prompt-ready formatted rubric text for injection into LLM system prompts
export function formatRubricForPrompt(): string {
  const lines: string[] = [
    'IELTS Speaking Band Descriptors (Public Version) — Part 3 Academic Discussion:',
    '',
  ];

  for (const d of ieltsSpeakingRubric) {
    if (d.band < 2) continue; // Skip band 1 (no communication)
    lines.push(`## Band ${d.band}`);
    lines.push(`**Fluency & Coherence:** ${d.fluencyCoherence}`);
    lines.push(`**Lexical Resource:** ${d.lexicalResource}`);
    lines.push(`**Grammatical Range & Accuracy:** ${d.grammaticalRangeAccuracy}`);
    lines.push(`**Pronunciation:** ${d.pronunciation}`);
    lines.push('');
  }

  return lines.join('\n');
}
