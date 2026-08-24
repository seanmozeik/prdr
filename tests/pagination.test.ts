import { describe, expect, it } from 'bun:test';

import { Effect } from 'effect';

import { listReviewItems, type ListFilters } from '../src/domain/listing';
import type {
  ConversationSnapshot,
  IssueComment,
  PullRequestTarget,
  ReviewSubmission,
} from '../src/domain/model';
import { paginateReviewItems, prepareListPage } from '../src/domain/pagination';
import type { PullRequestView } from '../src/domain/raw';

const target: PullRequestTarget = {
  host: 'github.com',
  name: 'prdr',
  nameWithOwner: 'seanmozeik/prdr',
  number: 42,
  owner: 'seanmozeik',
};

const pullRequest: PullRequestView = {
  author: { is_bot: false, login: 'seanmozeik' },
  baseRefName: 'main',
  headRefName: 'feature',
  headRefOid: '0123456789abcdef0123456789abcdef01234567',
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  number: 42,
  reviewDecision: '',
  state: 'OPEN',
  title: 'Test pull request',
  updatedAt: '2026-08-24T10:00:00Z',
  url: 'https://github.com/seanmozeik/prdr/pull/42',
};

const issueComment = (id: number, body: string, createdAt: string): IssueComment => ({
  body,
  created_at: createdAt,
  html_url: `https://github.com/seanmozeik/prdr/pull/42#issuecomment-${id}`,
  id,
  metadata: { provider: 'human', severity: 'unknown', title: null },
  node_id: `IC_${id}`,
  ref: `issue-comment:${id}`,
  updated_at: createdAt,
  user: { login: 'reviewer', type: 'User' },
});

const comments = [
  issueComment(1, 'First finding', '2026-08-24T10:00:01Z'),
  issueComment(3, 'Third finding', '2026-08-24T10:00:02Z'),
  issueComment(2, 'Second finding', '2026-08-24T10:00:02Z'),
] as const;

const makeSnapshot = (issueComments: readonly IssueComment[] = comments): ConversationSnapshot => ({
  issueComments,
  pullRequest,
  reviews: [],
  target,
  threads: [],
  unthreadedReviewComments: [],
});

const pendingReview: ReviewSubmission = {
  body: 'Pending review',
  commit_id: pullRequest.headRefOid,
  html_url: 'https://github.com/seanmozeik/prdr/pull/42#pullrequestreview-9',
  id: 9,
  metadata: { provider: 'human', severity: 'unknown', title: null },
  node_id: 'PRR_9',
  ref: 'review:9',
  state: 'PENDING',
  submitted_at: null,
  user: { login: 'reviewer', type: 'User' },
};

const filters: ListFilters = { author: '', provider: 'all', state: 'all' };

describe('review list pagination', () => {
  it('traverses every item once with an opaque next cursor', async () => {
    const snapshot = makeSnapshot();
    const references: string[] = [];
    let cursor = '';
    let pageCount = 0;

    for (;;) {
      const options = await Effect.runPromise(prepareListPage({ cursor, limit: 1 }));
      const page = await Effect.runPromise(paginateReviewItems(snapshot, filters, options));
      references.push(...page.items.map((item) => item.ref));
      pageCount += 1;
      expect(page.total).toBe(3);
      expect(page.limit).toBe(1);
      expect(page.headRefOid).toBe(pullRequest.headRefOid);
      expect(page.target).toEqual(target);
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull();
        break;
      }
      if (page.nextCursor === null) {
        throw new Error('A non-final page did not have a next cursor.');
      }
      cursor = page.nextCursor;
    }

    expect(pageCount).toBe(3);
    expect(references).toEqual(['issue-comment:1', 'issue-comment:2', 'issue-comment:3']);
  });

  it('allows the page size to change during traversal', async () => {
    const snapshot = makeSnapshot();
    const firstOptions = await Effect.runPromise(prepareListPage({ cursor: '', limit: 1 }));
    const first = await Effect.runPromise(paginateReviewItems(snapshot, filters, firstOptions));
    if (first.nextCursor === null) {
      throw new Error('The first page did not have a next cursor.');
    }
    const secondOptions = await Effect.runPromise(
      prepareListPage({ cursor: first.nextCursor, limit: 2 }),
    );
    const second = await Effect.runPromise(paginateReviewItems(snapshot, filters, secondOptions));

    expect(second.items.map((item) => item.ref)).toEqual(['issue-comment:2', 'issue-comment:3']);
    expect(second.hasMore).toBe(false);
  });

  it('continues after a pending review with no submission timestamp', async () => {
    const snapshot = { ...makeSnapshot(), reviews: [pendingReview] };
    const firstOptions = await Effect.runPromise(prepareListPage({ cursor: '', limit: 1 }));
    const first = await Effect.runPromise(paginateReviewItems(snapshot, filters, firstOptions));
    if (first.nextCursor === null) {
      throw new Error('The pending review page did not have a next cursor.');
    }
    const secondOptions = await Effect.runPromise(
      prepareListPage({ cursor: first.nextCursor, limit: 1 }),
    );
    const second = await Effect.runPromise(paginateReviewItems(snapshot, filters, secondOptions));

    expect(first.items.map((item) => item.ref)).toEqual(['review:9']);
    expect(second.items.map((item) => item.ref)).toEqual(['issue-comment:1']);
  });

  it('rejects a cursor when filters or result records change', async () => {
    const snapshot = makeSnapshot();
    const firstOptions = await Effect.runPromise(prepareListPage({ cursor: '', limit: 1 }));
    const first = await Effect.runPromise(paginateReviewItems(snapshot, filters, firstOptions));
    if (first.nextCursor === null) {
      throw new Error('The first page did not have a next cursor.');
    }
    const nextOptions = await Effect.runPromise(
      prepareListPage({ cursor: first.nextCursor, limit: 1 }),
    );
    const filterError = await Effect.runPromise(
      Effect.flip(paginateReviewItems(snapshot, { ...filters, provider: 'human' }, nextOptions)),
    );
    const changedSnapshot = makeSnapshot([
      ...comments,
      issueComment(4, 'New finding', '2026-08-24T10:00:03Z'),
    ]);
    const changeError = await Effect.runPromise(
      Effect.flip(paginateReviewItems(changedSnapshot, filters, nextOptions)),
    );

    expect(filterError._tag).toBe('ListPaginationError');
    expect(filterError.message).toContain('filter set');
    expect(changeError._tag).toBe('ListPaginationError');
    expect(changeError.message).toContain('changed between pages');
  });

  it('rejects malformed cursors and unsafe page sizes before pagination', async () => {
    const cursorError = await Effect.runPromise(
      Effect.flip(prepareListPage({ cursor: 'not-a-cursor', limit: 10 })),
    );
    const limitError = await Effect.runPromise(
      Effect.flip(prepareListPage({ cursor: '', limit: 101 })),
    );

    expect(cursorError._tag).toBe('ListPaginationError');
    expect(cursorError.message).toContain('invalid');
    expect(limitError._tag).toBe('ListPaginationError');
    expect(limitError.message).toContain('100');
  });

  it('returns marked previews and keeps full bodies out of list records', () => {
    const body = `${'x'.repeat(200)}\n\nMore exact Markdown`;
    const [item] = listReviewItems(
      makeSnapshot([issueComment(1, body, '2026-08-24T10:00:01Z')]),
      filters,
    );

    expect(item).toBeDefined();
    expect(item?.preview.endsWith('...')).toBe(true);
    expect(item?.preview).toHaveLength(160);
    expect(item === undefined ? false : Object.hasOwn(item, 'body')).toBe(false);
  });

  it('treats Unicode line separators as preview boundaries', () => {
    const [item] = listReviewItems(
      makeSnapshot([issueComment(1, '\u2028First line\u0085Second line', '2026-08-24T10:00:01Z')]),
      filters,
    );

    expect(item?.preview).toBe('First line...');
  });
});
