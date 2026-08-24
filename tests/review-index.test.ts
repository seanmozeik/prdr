import { describe, expect, it } from 'bun:test';

import { Effect, Layer } from 'effect';

import { loadBatchedSnapshot } from '../src/github/batched-snapshot';
import { GhClient, type GhRequest, type GhResult } from '../src/github/client';
import { reviewIndexQuery } from '../src/github/queries';
import { loadReviewIndex } from '../src/github/review-index';

const head = '0123456789abcdef0123456789abcdef01234567';
const updatedAt = '2026-08-24T10:00:00Z';

const jsonResult = (value: unknown): GhResult => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(value),
});

const pageInfo = (hasNextPage = false, endCursor: string | null = null) => ({
  endCursor,
  hasNextPage,
});

const graphqlComment = {
  author: { __typename: 'Bot', login: 'greptile-apps' },
  body: '<details>\n\n**Finding**\n\n</details>',
  createdAt: updatedAt,
  databaseId: 1,
  id: 'PRRC_1',
  line: 10,
  originalLine: 10,
  path: 'src/example.ts',
  replyTo: null,
  updatedAt,
  url: 'https://github.com/example/prdr/pull/42#discussion_r1',
};

const graphqlReview = {
  author: { __typename: 'User', login: 'reviewer' },
  body: 'Review body',
  comments: { nodes: [graphqlComment], totalCount: 1 },
  commit: { oid: head },
  fullDatabaseId: '100',
  id: 'PRR_100',
  state: 'COMMENTED',
  submittedAt: updatedAt,
  url: 'https://github.com/example/prdr/pull/42#pullrequestreview-100',
};

const issueComment = {
  author: { __typename: 'Bot', login: 'greptile-apps' },
  body: '<!-- greptile-status --> Confidence Score: 5/5',
  createdAt: updatedAt,
  databaseId: 2,
  id: 'IC_2',
  updatedAt,
  url: 'https://github.com/example/prdr/pull/42#issuecomment-2',
};

const graphqlThread = {
  comments: { nodes: [{ id: graphqlComment.id, replyTo: null }], totalCount: 1 },
  id: 'PRRT_1',
  isOutdated: false,
  isResolved: false,
  line: 10,
  originalLine: 10,
  path: graphqlComment.path,
  resolvedBy: null,
  subjectType: 'LINE',
  viewerCanReply: true,
  viewerCanResolve: true,
  viewerCanUnresolve: false,
};

const checkRun = {
  __typename: 'CheckRun',
  checkSuite: { workflowRun: { event: 'pull_request', workflow: { name: 'security' } } },
  completedAt: updatedAt,
  conclusion: 'SUCCESS',
  detailsUrl: 'https://example.com/check',
  name: 'Aikido Security',
  startedAt: updatedAt,
  status: 'COMPLETED',
};

const pullRequestFields = {
  author: { __typename: 'User', login: 'author' },
  baseRefName: 'main',
  headRefName: 'feature',
  headRefOid: head,
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  number: 42,
  reviewDecision: null,
  state: 'OPEN',
  title: 'Test pull request',
  updatedAt,
  url: 'https://github.com/example/prdr/pull/42',
};

const completePage = (
  issuePage = pageInfo(),
  issueNodes: readonly (typeof issueComment)[] = [issueComment],
  pageUpdatedAt = updatedAt,
): GhResult =>
  jsonResult({
    data: {
      repository: {
        pullRequest: {
          ...pullRequestFields,
          updatedAt: pageUpdatedAt,
          comments: { nodes: issueNodes, pageInfo: issuePage },
          reviews: { nodes: [graphqlReview], pageInfo: pageInfo() },
          reviewThreads: { nodes: [graphqlThread], pageInfo: pageInfo() },
          statusCheckRollup: { contexts: { nodes: [checkRun], pageInfo: pageInfo() } },
        },
      },
    },
  });

const issueOnlyPage = (pageUpdatedAt = updatedAt): GhResult =>
  jsonResult({
    data: {
      repository: {
        pullRequest: {
          ...pullRequestFields,
          updatedAt: pageUpdatedAt,
          comments: {
            nodes: [{ ...issueComment, databaseId: 3, id: 'IC_3' }],
            pageInfo: pageInfo(),
          },
        },
      },
    },
  });

const restComment = {
  body: graphqlComment.body,
  created_at: graphqlComment.createdAt,
  diff_hunk: '@@ -1 +1 @@',
  html_url: graphqlComment.url,
  id: graphqlComment.databaseId,
  in_reply_to_id: null,
  line: graphqlComment.line,
  node_id: graphqlComment.id,
  original_line: graphqlComment.originalLine,
  path: graphqlComment.path,
  pull_request_review_id: 100,
  side: 'RIGHT',
  subject_type: 'line',
  updated_at: graphqlComment.updatedAt,
  user: { login: 'greptile-apps[bot]', type: 'Bot' },
};

const pullRequestView = {
  author: { is_bot: false, login: 'author' },
  baseRefName: pullRequestFields.baseRefName,
  headRefName: pullRequestFields.headRefName,
  headRefOid: head,
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  number: 42,
  reviewDecision: '',
  state: 'OPEN',
  title: pullRequestFields.title,
  updatedAt,
  url: pullRequestFields.url,
};

const runWithHandler = <A, E>(
  effect: Effect.Effect<A, E, GhClient>,
  handler: (request: GhRequest) => GhResult,
): { readonly captured: GhRequest[]; readonly result: Promise<A> } => {
  const captured: GhRequest[] = [];
  const run = Effect.fn('TestReviewIndex.run')((request: GhRequest) => {
    captured.push(request);
    return Effect.succeed(handler(request));
  });
  return {
    captured,
    result: Effect.runPromise(effect.pipe(Effect.provide(Layer.succeed(GhClient, { run })))),
  };
};

const isIndexQuery = (request: GhRequest): boolean =>
  request.arguments.includes(`query=${reviewIndexQuery}`);

const isReviewComments = (request: GhRequest): boolean =>
  request.arguments.at(-1)?.includes('/pulls/42/comments?') ?? false;

const isPullRequestView = (request: GhRequest): boolean =>
  request.arguments[0] === 'pr' && request.arguments[1] === 'view';

describe('review index fast paths', () => {
  it('loads an explicit pull request in one GraphQL request', async () => {
    const { captured, result } = runWithHandler(loadReviewIndex('example/prdr', 42, '', true), () =>
      completePage(),
    );

    const index = await result;

    expect(captured).toHaveLength(1);
    const [firstRequest] = captured;
    expect(firstRequest === undefined ? false : isIndexQuery(firstRequest)).toBe(true);
    expect(index.threads[0]?.root.user.login).toBe('greptile-apps[bot]');
    expect(index.threads[0]?.root.metadata.provider).toBe('greptile');
    expect(index.checks[0]).toMatchObject({ bucket: 'pass', name: 'Aikido Security' });
  });

  it('pages each GraphQL connection with its own cursor', async () => {
    const { captured, result } = runWithHandler(
      loadReviewIndex('example/prdr', 42, '', false),
      (request) =>
        request.arguments.includes('issueCursor=ISSUE_CURSOR')
          ? issueOnlyPage()
          : completePage(pageInfo(true, 'ISSUE_CURSOR')),
    );

    const index = await result;

    expect(index.issueComments).toHaveLength(2);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.arguments).toContain('issueCursor=ISSUE_CURSOR');
    expect(captured[1]?.arguments).toContain('includeReviews=false');
    expect(captured[1]?.arguments).toContain('includeThreads=false');
  });

  it('restarts a paged graph when the pull request changes between pages', async () => {
    const changedAt = '2026-08-24T10:01:00Z';
    let calls = 0;
    const { captured, result } = runWithHandler(
      loadReviewIndex('example/prdr', 42, '', false),
      (request) => {
        calls += 1;
        if (request.arguments.includes('issueCursor=ISSUE_CURSOR')) {
          return issueOnlyPage(changedAt);
        }
        return completePage(
          pageInfo(true, 'ISSUE_CURSOR'),
          [issueComment],
          calls === 1 ? updatedAt : changedAt,
        );
      },
    );

    const index = await result;

    expect(index.issueComments).toHaveLength(2);
    expect(captured).toHaveLength(4);
  });

  it('rejects a missing or repeated GraphQL cursor', async () => {
    const missing = runWithHandler(
      Effect.flip(loadReviewIndex('example/prdr', 42, '', false)),
      () => completePage(pageInfo(true, null), []),
    );
    const missingError = await missing.result;
    expect(missingError._tag).toBe('SnapshotInvariantError');

    const repeated = runWithHandler(
      Effect.flip(loadReviewIndex('example/prdr', 42, '', false)),
      () => completePage(pageInfo(true, 'REPEATED'), []),
    );
    const error = await repeated.result;
    expect(error._tag).toBe('SnapshotInvariantError');
    expect(error.message).toContain('repeated');
    expect(repeated.captured).toHaveLength(2);
  });

  it('batches exact REST fields and verifies the final pull request state', async () => {
    const { captured, result } = runWithHandler(
      loadBatchedSnapshot('example/prdr', 42, '', false),
      (request) => {
        if (isIndexQuery(request)) {
          return completePage();
        }
        if (isReviewComments(request)) {
          return jsonResult([[restComment]]);
        }
        if (isPullRequestView(request)) {
          return jsonResult(pullRequestView);
        }
        throw new Error(`Unexpected gh request: ${request.arguments.join(' ')}`);
      },
    );

    const snapshot = await result;

    expect(captured).toHaveLength(3);
    expect(snapshot.checks).toEqual([]);
    expect(snapshot.threads[0]?.root).toMatchObject({
      body: graphqlComment.body,
      diff_hunk: restComment.diff_hunk,
      side: 'RIGHT',
    });
  });

  it('stops after three inconsistent exact enrichments', async () => {
    const { captured, result } = runWithHandler(
      Effect.flip(loadBatchedSnapshot('example/prdr', 42, '', true)),
      (request) => {
        if (isIndexQuery(request)) {
          return completePage();
        }
        if (isReviewComments(request)) {
          return jsonResult([[{ ...restComment, body: 'Changed during the read' }]]);
        }
        if (isPullRequestView(request)) {
          return jsonResult(pullRequestView);
        }
        throw new Error(`Unexpected gh request: ${request.arguments.join(' ')}`);
      },
    );

    const error = await result;

    expect(error._tag).toBe('SnapshotChangedError');
    expect(captured).toHaveLength(9);
  });
});
