const MAXIMUM_SUMMARY_LENGTH = 160;
const SUMMARY_SUFFIX = '...';
const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export const compareText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
};

export const textPreview = (text: string | null): string => {
  const lines = text?.split(/\r\n|[\r\n\u0085\u2028\u2029]/u) ?? [];
  const firstContentIndex = lines.findIndex((line) => line.trim() !== '');
  if (firstContentIndex === -1) {
    return '(empty)';
  }
  const firstLine = lines[firstContentIndex] ?? '';
  const graphemes = Array.from(graphemeSegmenter.segment(firstLine), ({ segment }) => segment);
  const hasLaterContent = lines.slice(firstContentIndex + 1).some((line) => line.trim() !== '');
  if (graphemes.length <= MAXIMUM_SUMMARY_LENGTH && !hasLaterContent) {
    return firstLine;
  }
  return `${graphemes.slice(0, MAXIMUM_SUMMARY_LENGTH - SUMMARY_SUFFIX.length).join('')}${SUMMARY_SUFFIX}`;
};
