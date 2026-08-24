const MAXIMUM_SUMMARY_LENGTH = 160;
const SUMMARY_SUFFIX = '...';
const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const lineBreakPattern = /\r\n|[\r\n\u0085\u2028\u2029]/u;

const htmlEntities: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&apos;': "'",
  '&#39;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&nbsp;': ' ',
  '&quot;': '"',
};

export const compareText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
};

const boundedPreview = (text: string, hasLaterContent: boolean): string => {
  const graphemes = Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
  if (graphemes.length <= MAXIMUM_SUMMARY_LENGTH && !hasLaterContent) {
    return text;
  }
  const prefix = graphemes
    .slice(0, MAXIMUM_SUMMARY_LENGTH - SUMMARY_SUFFIX.length)
    .join('')
    .replace(/\.+$/u, '');
  return `${prefix}${SUMMARY_SUFFIX}`;
};

export const plainMarkdownLine = (line: string): string =>
  line
    .replaceAll(/<!--.*?-->/gu, '')
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replaceAll(/!\[[^\]]*\]\[[^\]]*\]/gu, '')
    .replaceAll(/\[(?<label>[^\]]+)\]\([^)]*\)/gu, '$<label>')
    .replaceAll(/<\/?[A-Za-z][^>]*>/gu, '')
    .replaceAll(/\*\*(?<content>.+?)\*\*/gu, '$<content>')
    .replaceAll(/__(?<content>.+?)__/gu, '$<content>')
    .replaceAll(/~~(?<content>.+?)~~/gu, '$<content>')
    .replaceAll(/`(?<content>[^`]+)`/gu, '$<content>')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-+*]\s+)/u, '')
    .replaceAll(/&(?:amp|apos|gt|lt|nbsp|quot|#39);/gu, (entity) => htmlEntities[entity] ?? entity)
    .replaceAll(/\s+/gu, ' ')
    .trim();

export const extractMarkdownTitle = (text: string | null): string | null => {
  const lines = text?.split(lineBreakPattern).slice(0, 24) ?? [];
  for (const line of lines) {
    if (/^\s*<details\b/iu.test(line)) {
      break;
    }
    const heading = /^\s*#{1,6}\s+(?<title>.+)$/u.exec(line)?.groups?.['title'];
    const htmlHeading = /^\s*<h[1-6][^>]*>(?<title>.*?)<\/h[1-6]>\s*$/iu.exec(line)?.groups?.[
      'title'
    ];
    const bold = /^\s*(?:<[^>]+>\s*)*\*\*(?<title>.+?)\*\*(?:\s+[-–—:]\s+.+)?\s*$/u.exec(line)
      ?.groups?.['title'];
    const title = plainMarkdownLine(heading ?? htmlHeading ?? bold ?? '');
    if (title !== '') {
      return boundedPreview(title, false);
    }
  }
  return null;
};

const isFindingDecoration = (line: string, plain: string): boolean =>
  /<\/?(?:details|summary)\b/iu.test(line) ||
  /^useful\?\s*react\b/iu.test(plain) ||
  /^(?:artifacts|bug|cause|fix|prompt to fix with ai)$/iu.test(plain);

export const findingPreview = (text: string | null, title: string | null): string => {
  const normalizedTitle = title?.toLocaleLowerCase('en') ?? null;
  const content = (text?.split(lineBreakPattern) ?? [])
    .map((line) => ({ line, plain: plainMarkdownLine(line) }))
    .filter(
      ({ line, plain }) =>
        plain !== '' &&
        plain.toLocaleLowerCase('en') !== normalizedTitle &&
        !isFindingDecoration(line, plain),
    );
  const [first] = content;
  if (first === undefined) {
    return title ?? '(empty)';
  }
  return boundedPreview(first.plain, content.length > 1);
};

export const textPreview = (text: string | null): string => {
  const lines = text?.split(lineBreakPattern) ?? [];
  const firstContentIndex = lines.findIndex((line) => line.trim() !== '');
  if (firstContentIndex === -1) {
    return '(empty)';
  }
  const firstLine = lines[firstContentIndex] ?? '';
  const hasLaterContent = lines.slice(firstContentIndex + 1).some((line) => line.trim() !== '');
  return boundedPreview(firstLine, hasLaterContent);
};
