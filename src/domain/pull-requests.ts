import type { RepositoryTarget } from './model';
import { plainMarkdownLine, textPreview } from './text';

export type PullRequestListState = 'all' | 'closed' | 'merged' | 'open';

export interface PullRequestListFilters {
  readonly base: string;
  readonly branch: string;
  readonly state: PullRequestListState;
}

export interface PullRequestListOptions {
  readonly cursor: string;
  readonly limit: number;
}

export interface PullRequestListRecord {
  readonly author: string;
  readonly baseRefName: string;
  readonly body: string;
  readonly checkStatus: string | null;
  readonly commentCount: number;
  readonly createdAt: string;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly headRepositoryOwner: string | null;
  readonly isDraft: boolean;
  readonly mergeStateStatus: string;
  readonly number: number;
  readonly reviewDecision: string | null;
  readonly reviewThreadCount: number;
  readonly state: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly url: string;
}

export interface PullRequestSummary extends Omit<PullRequestListRecord, 'body'> {
  readonly ageDays: number;
  readonly summary: string;
}

export interface PullRequestListPage {
  readonly hasMore: boolean;
  readonly items: readonly PullRequestSummary[];
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly target: RepositoryTarget;
  readonly total: number;
}

const markdownDescription = (body: string): string => {
  const lines = body.split(/\r\n|[\r\n\u0085\u2028\u2029]/u);
  let inHtmlComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inHtmlComment) {
      inHtmlComment = !trimmed.includes('-->');
    } else if (trimmed.startsWith('<!--')) {
      inHtmlComment = !trimmed.includes('-->');
    } else {
      const isStructuralLine =
        trimmed === '' ||
        /^#{1,6}(?:\s|$)/u.test(trimmed) ||
        /^(?:```|~~~)/u.test(trimmed) ||
        /^(?<marker>[-*_])(?:\s*\k<marker>){2,}$/u.test(trimmed);
      if (!isStructuralLine) {
        const withoutListMarker = trimmed
          .replace(/^(?:[-+*]|\d+[.)])\s+/u, '')
          .replace(/^\[[ xX]\]\s+/u, '');
        const plain = plainMarkdownLine(withoutListMarker);
        if (plain.length > 0) {
          return textPreview(plain);
        }
      }
    }
  }
  return '(no description)';
};

const pullRequestAgeDays = (createdAt: string, nowMilliseconds: number): number => {
  const elapsed = nowMilliseconds - Date.parse(createdAt);
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 86_400_000)) : 0;
};

export const summarizePullRequest = (
  record: PullRequestListRecord,
  nowMilliseconds: number,
): PullRequestSummary => {
  const { body, ...summary } = record;
  return {
    ...summary,
    ageDays: pullRequestAgeDays(record.createdAt, nowMilliseconds),
    summary: markdownDescription(body),
  };
};
