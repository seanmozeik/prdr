import { describe, expect, it } from 'bun:test';

import { Effect, Layer } from 'effect';

import type { PullRequestContext, PullRequestTarget } from '../src/domain/model';
import type { GraphqlThread, PullRequestView, RawReviewComment } from '../src/domain/raw';
import { GhClient, type GhRequest, type GhResult } from '../src/github/client';
import { GhCommandError } from '../src/github/errors';
import {
  loadAikidoSnapshot,
  loadConversationSnapshot,
  loadGreptileSnapshot,
  loadSnapshot,
  loadThreadSnapshot,
} from '../src/github/loaders';
import { reviewThreadsQuery } from '../src/github/queries';
import { resolvePullRequestContext } from '../src/github/target';

const head = '0123456789abcdef0123456789abcdef01234567';
const target: PullRequestTarget = {
  host: 'github.com',
  name: 'prdr',
  nameWithOwner: 'example/prdr',
  number: 42,
  owner: 'example',
};

const pullRequest = (changes: Partial<PullRequestView> = {}): PullRequestView => ({
  author: { is_bot: false, login: 'reviewer' },
  baseRefName: 'main',
  headRefName: 'feature',
  headRefOid: head,
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  number: 42,
  reviewDecision: '',
  state: 'OPEN',
  title: 'Test pull request',
  updatedAt: '2026-08-24T10:00:00Z',
  url: 'https://github.com/example/prdr/pull/42',
  ...changes,
});

const context: PullRequestContext = { pullRequest: pullRequest(), target };

const reviewComment: RawReviewComment = {
  body: '<img alt="P1"> **Finding**',
  created_at: '2026-08-24T10:00:00Z',
  diff_hunk: '@@ -1 +1 @@',
  html_url: 'https://github.com/example/prdr/pull/42#discussion_r1',
  id: 1,
  in_reply_to_id: null,
  line: 10,
  node_id: 'PRRC_1',
  original_line: 10,
  path: 'src/example.ts',
  pull_request_review_id: 100,
  side: 'RIGHT',
  subject_type: 'line',
  updated_at: '2026-08-24T10:00:00Z',
  user: { login: 'greptile-apps[bot]', type: 'Bot' },
};

const graphqlThread = (changes: Partial<GraphqlThread> = {}): GraphqlThread => ({
  comments: { nodes: [{ id: reviewComment.node_id, replyTo: null }], totalCount: 1 },
  id: 'PRRT_1',
  isOutdated: false,
  isResolved: false,
  line: 10,
  originalLine: 10,
  path: reviewComment.path,
  resolvedBy: null,
  subjectType: 'LINE',
  viewerCanReply: true,
  viewerCanResolve: true,
  viewerCanUnresolve: false,
  ...changes,
});

const jsonResult = (value: unknown): GhResult => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(value),
});

const threadPage = (
  nodes: readonly GraphqlThread[],
  hasNextPage = false,
  endCursor: string | null = null,
): GhResult =>
  jsonResult({
    data: {
      repository: {
        pullRequest: { reviewThreads: { nodes, pageInfo: { endCursor, hasNextPage } } },
      },
    },
  });

type FakeResponse = GhCommandError | GhResult;
type RequestHandler = (request: GhRequest) => FakeResponse;

const runWithHandler = <A, E>(
  effect: Effect.Effect<A, E, GhClient>,
  handler: RequestHandler,
): { readonly captured: GhRequest[]; readonly result: Promise<A> } => {
  const captured: GhRequest[] = [];
  const run = Effect.fn('TestGh.run')(function* testGhRun(request: GhRequest) {
    captured.push(request);
    const response = handler(request);
    if ('arguments' in response) {
      return yield* response;
    }
    return response;
  });
  return {
    captured,
    result: Effect.runPromise(effect.pipe(Effect.provide(Layer.succeed(GhClient, { run })))),
  };
};

const isGraphqlThreads = (request: GhRequest): boolean =>
  request.arguments.includes(`query=${reviewThreadsQuery}`);

const endpoint = (request: GhRequest): string => request.arguments.at(-1) ?? '';

const defaultHandler = (request: GhRequest): GhResult => {
  if (isGraphqlThreads(request)) {
    return threadPage([graphqlThread()]);
  }
  const requestEndpoint = endpoint(request);
  if (requestEndpoint.includes('/pulls/42/comments?')) {
    return jsonResult([[reviewComment]]);
  }
  if (requestEndpoint.includes('/issues/42/comments?')) {
    return jsonResult([
      [
        {
          body: '<!-- greptile-status --> Confidence Score: 4/5',
          created_at: '2026-08-24T10:00:00Z',
          html_url: 'https://github.com/example/prdr/pull/42#issuecomment-2',
          id: 2,
          node_id: 'IC_2',
          updated_at: '2026-08-24T10:00:00Z',
          user: { login: 'greptile-apps[bot]', type: 'Bot' },
        },
      ],
    ]);
  }
  if (requestEndpoint.includes('/pulls/42/reviews?')) {
    return jsonResult([[]]);
  }
  if (request.arguments.includes('statusCheckRollup')) {
    return jsonResult({
      statusCheckRollup: [
        {
          __typename: 'CheckRun',
          completedAt: '2026-08-24T10:00:00Z',
          conclusion: 'SUCCESS',
          detailsUrl: 'https://example.com/check',
          name: 'Aikido Security',
          startedAt: '2026-08-24T09:59:00Z',
          status: 'COMPLETED',
          workflowName: '',
        },
      ],
    });
  }
  if (request.arguments[0] === 'pr' && request.arguments[1] === 'view') {
    return jsonResult(pullRequest());
  }
  throw new Error(`Unexpected gh request: ${request.arguments.join(' ')}`);
};

const countRequests = (requests: readonly GhRequest[], fragment: string): number =>
  requests.filter((request) => request.arguments.some((argument) => argument.includes(fragment)))
    .length;

describe('snapshot loaders', () => {
  it('loads one stable full snapshot through typed boundaries', async () => {
    const { captured, result } = runWithHandler(loadSnapshot(context), defaultHandler);

    const snapshot = await result;

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.issueComments).toHaveLength(1);
    expect(snapshot.checks[0]?.name).toBe('Aikido Security');
    expect(countRequests(captured, 'pulls/42/comments?')).toBe(2);
    expect(captured.some((request) => request.arguments.includes('checks'))).toBe(false);
  });

  it('loads only the capability each command needs', async () => {
    const threadRun = runWithHandler(loadThreadSnapshot(context), defaultHandler);
    await threadRun.result;
    expect(threadRun.captured).toHaveLength(6);
    expect(countRequests(threadRun.captured, '/issues/')).toBe(0);
    expect(countRequests(threadRun.captured, 'statusCheckRollup')).toBe(0);
    expect(countRequests(threadRun.captured, '/pulls/42/comments?')).toBe(2);
    expect(countRequests(threadRun.captured, `query=${reviewThreadsQuery}`)).toBe(2);

    const greptileRun = runWithHandler(loadGreptileSnapshot(context), defaultHandler);
    await greptileRun.result;
    expect(greptileRun.captured).toHaveLength(8);
    expect(countRequests(greptileRun.captured, '/reviews?')).toBe(0);
    expect(countRequests(greptileRun.captured, 'statusCheckRollup')).toBe(0);

    const aikidoRun = runWithHandler(loadAikidoSnapshot(context), defaultHandler);
    await aikidoRun.result;
    expect(aikidoRun.captured).toHaveLength(8);
    expect(countRequests(aikidoRun.captured, '/issues/')).toBe(0);

    const conversationRun = runWithHandler(loadConversationSnapshot(context), defaultHandler);
    await conversationRun.result;
    expect(conversationRun.captured).toHaveLength(10);
    expect(countRequests(conversationRun.captured, 'statusCheckRollup')).toBe(0);
  });

  it('paginates GraphQL review threads with the returned cursor', async () => {
    let page = 0;
    const handler: RequestHandler = (request) => {
      if (isGraphqlThreads(request)) {
        page += 1;
        return page === 1
          ? threadPage([], true, 'CURSOR_1')
          : threadPage([graphqlThread()], false, 'CURSOR_2');
      }
      return defaultHandler(request);
    };
    const { captured, result } = runWithHandler(loadThreadSnapshot(context), handler);

    const snapshot = await result;

    expect(snapshot.threads).toHaveLength(1);
    expect(captured.some((request) => request.arguments.includes('cursor=CURSOR_1'))).toBe(true);
    const cursorRequest = captured.find((request) => request.arguments.includes('cursor=CURSOR_1'));
    expect(cursorRequest?.arguments.at(-2)).toBe('-f');
  });

  it('retries once when loaded review data changes and returns the stable attempt', async () => {
    let commentLoad = 0;
    const handler: RequestHandler = (request) => {
      if (endpoint(request).includes('/pulls/42/comments?')) {
        commentLoad += 1;
        const body = commentLoad === 1 ? '**Finding one**' : '**Finding two**';
        return jsonResult([[{ ...reviewComment, body }]]);
      }
      return defaultHandler(request);
    };
    const { captured, result } = runWithHandler(loadThreadSnapshot(context), handler);

    const snapshot = await result;

    expect(snapshot.threads[0]?.root.body).toBe('**Finding two**');
    expect(countRequests(captured, 'pulls/42/comments?')).toBe(3);
    expect(countRequests(captured, `query=${reviewThreadsQuery}`)).toBe(3);
  });

  it('accepts stable review data when unrelated pull request metadata changes', async () => {
    let reload = 0;
    const handler: RequestHandler = (request) => {
      if (
        request.arguments[0] === 'pr' &&
        request.arguments[1] === 'view' &&
        !request.arguments.includes('statusCheckRollup')
      ) {
        reload += 1;
        return jsonResult(pullRequest({ updatedAt: `2026-08-24T10:0${reload}:00Z` }));
      }
      return defaultHandler(request);
    };
    const { result } = runWithHandler(loadThreadSnapshot(context), handler);

    const snapshot = await result;

    expect(snapshot.pullRequest.updatedAt).toBe('2026-08-24T10:02:00Z');
  });

  it('fails when the head changes during every bounded read', async () => {
    let reload = 0;
    const handler: RequestHandler = (request) => {
      if (
        request.arguments[0] === 'pr' &&
        request.arguments[1] === 'view' &&
        !request.arguments.includes('statusCheckRollup')
      ) {
        reload += 1;
        return jsonResult(pullRequest({ headRefOid: `${reload}`.repeat(40) }));
      }
      return defaultHandler(request);
    };
    const { result } = runWithHandler(Effect.flip(loadThreadSnapshot(context)), handler);

    const error = await result;

    expect(error._tag).toBe('PullRequestChangedError');
  });

  it('fails when review data changes during every complete read', async () => {
    let commentLoad = 0;
    const handler: RequestHandler = (request) => {
      if (endpoint(request).includes('/pulls/42/comments?')) {
        commentLoad += 1;
        return jsonResult([[{ ...reviewComment, body: `**Finding ${commentLoad}**` }]]);
      }
      return defaultHandler(request);
    };
    const { result } = runWithHandler(Effect.flip(loadThreadSnapshot(context)), handler);

    const error = await result;

    expect(error._tag).toBe('SnapshotChangedError');
    if (error._tag === 'SnapshotChangedError') {
      expect(error.attempts).toBe(3);
    }
  });

  it('returns a real empty check list without accepting an operational failure', async () => {
    const emptyRun = runWithHandler(loadAikidoSnapshot(context), (request) =>
      request.arguments.includes('statusCheckRollup')
        ? jsonResult({ statusCheckRollup: [] })
        : defaultHandler(request),
    );
    const emptySnapshot = await emptyRun.result;
    expect(emptySnapshot.checks).toEqual([]);

    const failedRun = runWithHandler(Effect.flip(loadAikidoSnapshot(context)), (request) =>
      request.arguments.includes('statusCheckRollup')
        ? GhCommandError.make({
            arguments: Array.from(request.arguments),
            exitCode: 1,
            stderr: 'GraphQL: repository not found',
            stdout: '',
          })
        : defaultHandler(request),
    );
    const failedError = await failedRun.result;
    expect(failedError._tag).toBe('GhCommandError');
  });

  it('normalizes commit status contexts as pending checks', async () => {
    const { result } = runWithHandler(loadAikidoSnapshot(context), (request) =>
      request.arguments.includes('statusCheckRollup')
        ? jsonResult({
            statusCheckRollup: [
              {
                __typename: 'StatusContext',
                context: 'Aikido Security',
                startedAt: null,
                state: 'PENDING',
                targetUrl: null,
              },
            ],
          })
        : defaultHandler(request),
    );

    const snapshot = await result;

    expect(snapshot.checks).toEqual([
      {
        bucket: 'pending',
        completedAt: '',
        event: '',
        link: '',
        name: 'Aikido Security',
        startedAt: '',
        state: 'PENDING',
        workflow: '',
      },
    ]);
  });

  it('rejects a missing pagination cursor', async () => {
    const { result } = runWithHandler(Effect.flip(loadThreadSnapshot(context)), (request) =>
      isGraphqlThreads(request) ? threadPage([], true, null) : defaultHandler(request),
    );

    const error = await result;

    expect(error._tag).toBe('SnapshotInvariantError');
    expect(error.message).toContain('did not return a cursor');
  });

  it('rejects a repeated pagination cursor', async () => {
    const { result } = runWithHandler(Effect.flip(loadThreadSnapshot(context)), (request) =>
      isGraphqlThreads(request) ? threadPage([], true, 'CURSOR_REPEAT') : defaultHandler(request),
    );

    const error = await result;

    expect(error._tag).toBe('SnapshotInvariantError');
    expect(error.message).toContain('repeated');
  });

  it('rejects GraphQL application errors and missing connections', async () => {
    const applicationError = runWithHandler(Effect.flip(loadThreadSnapshot(context)), (request) =>
      isGraphqlThreads(request)
        ? jsonResult({ errors: [{ message: 'denied' }] })
        : defaultHandler(request),
    );
    const graphqlError = await applicationError.result;
    expect(graphqlError._tag).toBe('GhGraphqlError');

    const missingConnection = runWithHandler(Effect.flip(loadThreadSnapshot(context)), (request) =>
      isGraphqlThreads(request)
        ? jsonResult({ data: { repository: { pullRequest: null } } })
        : defaultHandler(request),
    );
    const connectionError = await missingConnection.result;
    expect(connectionError._tag).toBe('SnapshotInvariantError');
  });

  it('rejects truncated threads and REST/GraphQL identity mismatches', async () => {
    const truncated = runWithHandler(Effect.flip(loadThreadSnapshot(context)), (request) =>
      isGraphqlThreads(request)
        ? threadPage([
            graphqlThread({
              comments: { nodes: [{ id: reviewComment.node_id, replyTo: null }], totalCount: 101 },
            }),
          ])
        : defaultHandler(request),
    );
    const truncatedError = await truncated.result;
    expect(truncatedError._tag).toBe('SnapshotInvariantError');

    const missingIdentity = runWithHandler(Effect.flip(loadThreadSnapshot(context)), (request) =>
      isGraphqlThreads(request)
        ? threadPage([
            graphqlThread({
              comments: { nodes: [{ id: 'PRRC_MISSING', replyTo: null }], totalCount: 1 },
            }),
          ])
        : defaultHandler(request),
    );
    const identityError = await missingIdentity.result;
    expect(identityError._tag).toBe('SnapshotInvariantError');

    const missingRoot = runWithHandler(Effect.flip(loadThreadSnapshot(context)), (request) =>
      isGraphqlThreads(request)
        ? threadPage([
            graphqlThread({
              comments: {
                nodes: [{ id: reviewComment.node_id, replyTo: { id: 'PRRC_PARENT' } }],
                totalCount: 1,
              },
            }),
          ])
        : defaultHandler(request),
    );
    const rootError = await missingRoot.result;
    expect(rootError._tag).toBe('SnapshotInvariantError');

    const reply = { ...reviewComment, id: 2, node_id: 'PRRC_2' };
    const mismatchedParent = runWithHandler(Effect.flip(loadThreadSnapshot(context)), (request) => {
      if (isGraphqlThreads(request)) {
        return threadPage([
          graphqlThread({
            comments: {
              nodes: [
                { id: reviewComment.node_id, replyTo: null },
                { id: reply.node_id, replyTo: { id: reviewComment.node_id } },
              ],
              totalCount: 2,
            },
          }),
        ]);
      }
      return endpoint(request).includes('/pulls/42/comments?')
        ? jsonResult([[reviewComment, reply]])
        : defaultHandler(request);
    });
    const parentError = await mismatchedParent.result;
    expect(parentError._tag).toBe('SnapshotInvariantError');
    expect(parentError.message).toContain('disagree about the parent');
  });

  it('accepts a pull request whose author was deleted', async () => {
    const deletedAuthor = pullRequest({ author: null });
    const { result } = runWithHandler(resolvePullRequestContext('example/prdr', 42, ''), () =>
      jsonResult(deletedAuthor),
    );

    const resolved = await result;

    expect(resolved.pullRequest.author).toBeNull();
    expect(resolved.target.number).toBe(42);
  });

  it('selects a pull request by an explicit repository and head branch', async () => {
    const { captured, result } = runWithHandler(
      resolvePullRequestContext('example/prdr', 0, 'feature'),
      () => jsonResult(pullRequest()),
    );

    const resolved = await result;

    expect(resolved.target.number).toBe(42);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.arguments).toContain('feature');
    expect(captured[0]?.arguments).toContain('--repo');
    expect(captured[0]?.arguments).toContain('example/prdr');
  });

  it('rejects simultaneous pull request and branch selectors before it calls gh', async () => {
    const { captured, result } = runWithHandler(
      Effect.flip(resolvePullRequestContext('example/prdr', 42, 'feature')),
      defaultHandler,
    );

    const error = await result;

    expect(error._tag).toBe('TargetResolutionError');
    expect(error.message).toContain('exactly one');
    expect(captured).toEqual([]);
  });

  it('rejects an unsafe pull request number before it calls gh', async () => {
    const { captured, result } = runWithHandler(
      Effect.flip(resolvePullRequestContext('example/prdr', Number.MAX_SAFE_INTEGER + 1, '')),
      defaultHandler,
    );

    const error = await result;

    expect(error._tag).toBe('TargetResolutionError');
    expect(captured).toEqual([]);
  });
});
