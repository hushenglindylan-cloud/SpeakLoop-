/**
 * Maps each examiner ID to their unique portrait image.
 * 48 examiners, each with a distinct video-call style portrait.
 */

const examinerPortraits: Record<string, string> = {
  // British Male
  'B-M-1': '/examiners/B-M-1.jpg',
  'B-M-2': '/examiners/B-M-2.jpg',
  'B-M-3': '/examiners/B-M-3.jpg',
  'B-M-4': '/examiners/B-M-4.jpg',
  'B-M-5': '/examiners/B-M-5.jpg',
  'B-M-6': '/examiners/B-M-6.jpg',
  // British Female
  'B-F-1': '/examiners/B-F-1.jpg',
  'B-F-2': '/examiners/B-F-2.jpg',
  'B-F-3': '/examiners/B-F-3.jpg',
  'B-F-4': '/examiners/B-F-4.jpg',
  'B-F-5': '/examiners/B-F-5.jpg',
  'B-F-6': '/examiners/B-F-6.jpg',
  // American Male
  'A-M-1': '/examiners/A-M-1.jpg',
  'A-M-2': '/examiners/A-M-2.jpg',
  'A-M-3': '/examiners/A-M-3.jpg',
  'A-M-4': '/examiners/A-M-4.jpg',
  'A-M-5': '/examiners/A-M-5.jpg',
  'A-M-6': '/examiners/A-M-6.jpg',
  // American Female
  'A-F-1': '/examiners/A-F-1.jpg',
  'A-F-2': '/examiners/A-F-2.jpg',
  'A-F-3': '/examiners/A-F-3.jpg',
  'A-F-4': '/examiners/A-F-4.jpg',
  'A-F-5': '/examiners/A-F-5.jpg',
  'A-F-6': '/examiners/A-F-6.jpg',
  // Australian Male
  'AU-M-1': '/examiners/AU-M-1.jpg',
  'AU-M-2': '/examiners/AU-M-2.jpg',
  'AU-M-3': '/examiners/AU-M-3.jpg',
  'AU-M-4': '/examiners/AU-M-4.jpg',
  'AU-M-5': '/examiners/AU-M-5.jpg',
  'AU-M-6': '/examiners/AU-M-6.jpg',
  // Australian Female
  'AU-F-1': '/examiners/AU-F-1.jpg',
  'AU-F-2': '/examiners/AU-F-2.jpg',
  'AU-F-3': '/examiners/AU-F-3.jpg',
  'AU-F-4': '/examiners/AU-F-4.jpg',
  'AU-F-5': '/examiners/AU-F-5.jpg',
  'AU-F-6': '/examiners/AU-F-6.jpg',
  // Indian Male
  'I-M-1': '/examiners/I-M-1.jpg',
  'I-M-2': '/examiners/I-M-2.jpg',
  'I-M-3': '/examiners/I-M-3.jpg',
  'I-M-4': '/examiners/I-M-4.jpg',
  'I-M-5': '/examiners/I-M-5.jpg',
  'I-M-6': '/examiners/I-M-6.jpg',
  // Indian Female
  'I-F-1': '/examiners/I-F-1.jpg',
  'I-F-2': '/examiners/I-F-2.jpg',
  'I-F-3': '/examiners/I-F-3.jpg',
  'I-F-4': '/examiners/I-F-4.jpg',
  'I-F-5': '/examiners/I-F-5.jpg',
  'I-F-6': '/examiners/I-F-6.jpg',
};

/**
 * Get the portrait URL for an examiner by their ID.
 */
export function getExaminerPortrait(examinerId: string): string {
  return examinerPortraits[examinerId] || '';
}
