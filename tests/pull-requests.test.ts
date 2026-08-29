import { describe, expect, it } from 'bun:test';

import { Effect, Layer } from 'effect';

import { type PullRequestListRecord, summarizePullRequest } from '../src/domain/pull-requests';
import { GhClient, type GhRequest, type GhResult } from '../src/github/client';
import { listPullRequests } from '../src/github/pull-request';

const jsonResult = (value: unknown): GhResult => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(value),
});

const record = (changes: Partial<PullRequestListRecord> = {}): PullRequestListRecord => ({
  author: 'reviewer',
  baseRefName: 'main',
  body: '## Summary\n\n- Fix the pagination boundary without loading every pull request.',
  checkStatus: 'SUCCESS',
  commentCount: 2,
  createdAt: '2026-08-20T10:00:00Z',
  headRefName: 'fix/pagination',
  headRefOid: '0123456789abcdef0123456789abcdef01234567',
  headRepositoryOwner: 'example',
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  number: 42,
  reviewDecision: 'APPROVED',
  reviewThreadCount: 3,
  state: 'OPEN',
  title: 'Fix pull request pagination',
  updatedAt: '2026-08-24T10:00:00Z',
  url: 'https://github.com/example/prdr/pull/42',
  ...changes,
});

const rawPullRequest = (changes: Partial<PullRequestListRecord> = {}) => {
  const value = record(changes);
  return {
    author: value.author === '[deleted]' ? null : { login: value.author },
    baseRefName: value.baseRefName,
    body: value.body,
    comments: { totalCount: value.commentCount },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: value.checkStatus === null ? null : { state: value.checkStatus },
          },
        },
      ],
    },
    createdAt: value.createdAt,
    headRefName: value.headRefName,
    headRefOid: value.headRefOid,
    headRepositoryOwner:
      value.headRepositoryOwner === null ? null : { login: value.headRepositoryOwner },
    isDraft: value.isDraft,
    mergeStateStatus: value.mergeStateStatus,
    number: value.number,
    reviewDecision: value.reviewDecision,
    reviewThreads: { totalCount: value.reviewThreadCount },
    state: value.state,
    title: value.title,
    updatedAt: value.updatedAt,
    url: value.url,
  };
};

const page = (
  nodes: readonly ReturnType<typeof rawPullRequest>[],
  hasNextPage: boolean,
  endCursor: string | null,
  totalCount = nodes.length,
): GhResult =>
  jsonResult({
    data: {
      repository: { pullRequests: { nodes, pageInfo: { endCursor, hasNextPage }, totalCount } },
    },
  });

const runWithHandler = <A, E>(
  effect: Effect.Effect<A, E, GhClient>,
  handler: (request: GhRequest) => GhResult,
): { readonly captured: GhRequest[]; readonly result: Promise<A> } => {
  const captured: GhRequest[] = [];
  const run = Effect.fn('TestPullRequests.run')((request: GhRequest) => {
    captured.push(request);
    return Effect.succeed(handler(request));
  });
  return {
    captured,
    result: Effect.runPromise(effect.pipe(Effect.provide(Layer.succeed(GhClient, { run })))),
  };
};

describe('pull request listing', () => {
  it('creates a compact body summary and stable age', () => {
    const summary = summarizePullRequest(record(), Date.parse('2026-08-24T10:00:00Z'));

    expect(summary.ageDays).toBe(4);
    expect(summary.summary).toBe('Fix the pagination boundary without loading every pull request.');
    expect(summary).not.toHaveProperty('body');
  });

  it('removes badge HTML and Markdown decoration from a body summary', () => {
    const summary = summarizePullRequest(
      record({ body: '<img alt="P1" src="badge.svg">\n\n- **Fix** the pagination boundary.' }),
      Date.parse('2026-08-24T10:00:00Z'),
    );

    expect(summary.summary).toBe('Fix the pagination boundary.');
  });

  it('pages through pull requests with a cursor bound to the repository and filters', async () => {
    const filters = { base: 'main', branch: 'fix/pagination', state: 'open' } as const;
    const { captured, result } = runWithHandler(
      Effect.gen(function* listTwoPages() {
        const first = yield* listPullRequests('example/prdr', filters, { cursor: '', limit: 1 });
        if (first.nextCursor === null) {
          throw new Error('The first pull request page did not have a cursor.');
        }
        const second = yield* listPullRequests('example/prdr', filters, {
          cursor: first.nextCursor,
          limit: 1,
        });
        return { first, second };
      }),
      (request) =>
        request.arguments.includes('cursor=CURSOR_ONE')
          ? page([rawPullRequest({ number: 41, title: 'Second page' })], false, null, 2)
          : page([rawPullRequest()], true, 'CURSOR_ONE', 2),
    );

    const resultPages = await result;

    expect(resultPages.first).toMatchObject({ hasMore: true, limit: 1, total: 2 });
    expect(resultPages.first.items[0]).toMatchObject({
      checkStatus: 'SUCCESS',
      number: 42,
      summary: 'Fix the pagination boundary without loading every pull request.',
    });
    expect(resultPages.second).toMatchObject({ hasMore: false, nextCursor: null, total: 2 });
    expect(resultPages.second.items[0]?.number).toBe(41);
    expect(captured).toHaveLength(2);
    expect(captured[0]?.arguments).toContain('states[]=OPEN');
    expect(captured[0]?.arguments).toContain('base=main');
    expect(captured[0]?.arguments).toContain('head=fix/pagination');
    expect(captured[1]?.arguments).toContain('cursor=CURSOR_ONE');
  });

  it('rejects a cursor reused with different filters', async () => {
    const filters = { base: '', branch: '', state: 'open' } as const;
    const { captured, result } = runWithHandler(
      Effect.gen(function* changeFilters() {
        const first = yield* listPullRequests('example/prdr', filters, { cursor: '', limit: 1 });
        if (first.nextCursor === null) {
          throw new Error('The first pull request page did not have a cursor.');
        }
        return yield* Effect.flip(
          listPullRequests(
            'example/prdr',
            { ...filters, state: 'closed' },
            { cursor: first.nextCursor, limit: 1 },
          ),
        );
      }),
      () => page([rawPullRequest()], true, 'CURSOR_ONE', 2),
    );

    const error = await result;

    expect(error._tag).toBe('PullRequestPaginationError');
    expect(error.message).toContain('filter set');
    expect(captured).toHaveLength(1);
  });

  it('rejects an unsafe page size before it calls gh', async () => {
    const { captured, result } = runWithHandler(
      Effect.flip(
        listPullRequests(
          'example/prdr',
          { base: '', branch: '', state: 'open' },
          { cursor: '', limit: 101 },
        ),
      ),
      () => page([], false, null),
    );

    const error = await result;

    expect(error._tag).toBe('PullRequestPaginationError');
    expect(error.message).toContain('100');
    expect(captured).toEqual([]);
  });
});
