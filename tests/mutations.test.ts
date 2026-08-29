import { describe, expect, it } from 'bun:test';

import { Effect, Layer } from 'effect';

import type {
  CommentSelection,
  PullRequestTarget,
  ReviewComment,
  ReviewThread,
} from '../src/domain/model';
import type { GraphqlThread, RawIssueComment } from '../src/domain/raw';
import { GhClient, type GhRequest, type GhResult } from '../src/github/client';
import {
  createIssueComment,
  editComment,
  replyToThread,
  resolveThread,
  submitReview,
  unresolveThread,
} from '../src/github/mutations';
import {
  resolveThreadMutation,
  reviewThreadNodeQuery,
  unresolveThreadMutation,
} from '../src/github/queries';

const head = '0123456789abcdef0123456789abcdef01234567';
const target: PullRequestTarget = {
  host: 'github.com',
  name: 'prdr',
  nameWithOwner: 'example/prdr',
  number: 42,
  owner: 'example',
};

const root: ReviewComment = {
  body: 'Finding',
  created_at: '2026-08-24T10:00:00Z',
  diff_hunk: '@@ -1 +1 @@',
  html_url: 'https://github.com/example/prdr/pull/42#discussion_r1',
  id: 1,
  in_reply_to_id: null,
  line: 10,
  metadata: { provider: 'greptile', severity: 'high', title: 'Finding' },
  node_id: 'PRRC_1',
  original_line: 10,
  path: 'src/example.ts',
  pull_request_review_id: 100,
  ref: 'review-comment:1',
  side: 'RIGHT',
  subject_type: 'line',
  updated_at: '2026-08-24T10:00:00Z',
  user: { login: 'greptile-apps[bot]', type: 'Bot' },
};

const issue: RawIssueComment = {
  body: 'Old',
  created_at: '2026-08-24T09:00:00Z',
  html_url: 'https://github.com/example/prdr/pull/42#issuecomment-5',
  id: 5,
  node_id: 'IC_5',
  updated_at: '2026-08-24T10:00:00Z',
  user: { login: 'reviewer', type: 'User' },
};

const issueSelection: CommentSelection = {
  comment: {
    ...issue,
    metadata: { provider: 'human', severity: 'unknown', title: null },
    ref: 'issue-comment:5',
    user: { login: 'reviewer', type: 'User' },
  },
  kind: 'issue-comment',
  thread: null,
};

const thread: ReviewThread = {
  comments: [root],
  id: 'PRRT_1',
  isOutdated: false,
  isResolved: false,
  line: 10,
  originalLine: 10,
  path: 'src/example.ts',
  ref: 'thread:PRRT_1',
  resolvedBy: null,
  root,
  subjectType: 'LINE',
  viewerCanReply: true,
  viewerCanResolve: true,
  viewerCanUnresolve: false,
};

const graphqlThread = (changes: Partial<GraphqlThread> = {}): GraphqlThread => ({
  comments: {
    nodes: [{ body: root.body ?? '', id: root.node_id, replyTo: null, updatedAt: root.updated_at }],
    totalCount: 1,
  },
  id: thread.id,
  isOutdated: thread.isOutdated,
  isResolved: thread.isResolved,
  line: thread.line,
  originalLine: thread.originalLine,
  path: thread.path,
  resolvedBy: null,
  subjectType: thread.subjectType,
  viewerCanReply: thread.viewerCanReply,
  viewerCanResolve: thread.viewerCanResolve,
  viewerCanUnresolve: thread.viewerCanUnresolve,
  ...changes,
});

const jsonResult = (value: unknown): GhResult => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(value),
});

const runWithResponses = <A, E>(
  effect: Effect.Effect<A, E, GhClient>,
  responses: readonly GhResult[],
): { readonly captured: GhRequest[]; readonly result: Promise<A> } => {
  const captured: GhRequest[] = [];
  const remaining = Array.from(responses);
  const run = Effect.fn('TestGh.run')((request: GhRequest) =>
    Effect.sync(() => {
      captured.push(request);
      const response = remaining.shift();
      if (response === undefined) {
        throw new Error(`Unexpected gh request: ${request.arguments.join(' ')}`);
      }
      return response;
    }),
  );
  return {
    captured,
    result: Effect.runPromise(effect.pipe(Effect.provide(Layer.succeed(GhClient, { run })))),
  };
};

const threadResult = (value = graphqlThread()): GhResult => jsonResult({ data: { node: value } });

const workflowPullRequest = (headRefOid = head) => ({
  autoMergeRequest: null,
  baseRefName: 'main',
  baseRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  body: 'Body',
  headRefName: 'feature',
  headRefOid,
  id: 'PR_42',
  isDraft: false,
  locked: false,
  mergeQueueEntry: null,
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  merged: false,
  number: 42,
  repository: { id: 'R_1', nameWithOwner: 'example/prdr', viewerPermission: 'WRITE' },
  reviewDecision: null,
  state: 'OPEN',
  title: 'Test pull request',
  url: 'https://github.com/example/prdr/pull/42',
  viewerCanClose: true,
  viewerCanDisableAutoMerge: false,
  viewerCanEnableAutoMerge: true,
  viewerCanMergeAsAdmin: false,
  viewerCanReopen: false,
  viewerCanUpdate: true,
  viewerCanUpdateBranch: true,
});

const workflowResult = (headRefOid = head): GhResult =>
  jsonResult({ data: { repository: { pullRequest: workflowPullRequest(headRefOid) } } });

const createdReview = (body: string, state: string) => ({
  body,
  commit_id: head,
  html_url: 'https://github.com/example/prdr/pull/42#pullrequestreview-9',
  id: 9,
  node_id: 'PRR_9',
  state,
});

const reviewCommentCreated = (body: string): GhResult =>
  jsonResult({
    body,
    html_url: 'https://github.com/example/prdr/pull/42#discussion_r2',
    id: 2,
    node_id: 'PRRC_2',
  });

describe('GitHub mutation contracts', () => {
  it('uses the current cloud API version and exact Markdown stdin for issue comments', async () => {
    const body = '# Exact\n\n```ts\nconst value = "$HOME";\n```\n';
    const comment = {
      body,
      html_url: 'https://github.com/example/prdr/pull/42#issuecomment-3',
      id: 3,
      node_id: 'IC_3',
    };
    const { captured, result } = runWithResponses(createIssueComment(target, body), [
      workflowResult(),
      jsonResult(comment),
      jsonResult(comment),
      workflowResult(),
    ]);

    await result;

    expect(captured[1]).toEqual({
      acceptedExitCodes: [0],
      arguments: [
        'api',
        '--hostname',
        'github.com',
        '-X',
        'POST',
        '-H',
        'Accept: application/vnd.github.raw+json',
        '-H',
        'X-GitHub-Api-Version: 2026-03-10',
        'repos/example/prdr/issues/42/comments',
        '--input',
        '-',
      ],
      input: JSON.stringify({ body }),
    });
  });

  it('keeps the compatible API version for enterprise hosts', async () => {
    const enterprise = { ...target, host: 'github.example.com' };
    const comment = {
      body: 'Body',
      html_url: 'https://github.example.com/comment/3',
      id: 3,
      node_id: 'IC_3',
    };
    const { captured, result } = runWithResponses(createIssueComment(enterprise, 'Body'), [
      workflowResult(),
      jsonResult(comment),
      jsonResult(comment),
      workflowResult(),
    ]);

    await result;

    expect(captured[1]?.arguments).toContain('X-GitHub-Api-Version: 2022-11-28');
  });

  it('revalidates a thread and replies to its root comment', async () => {
    const body = 'Reply\n';
    const { captured, result } = runWithResponses(replyToThread(target, thread, body, head), [
      threadResult(),
      workflowResult(),
      reviewCommentCreated(body),
      reviewCommentCreated(body),
      workflowResult(),
    ]);

    await result;

    expect(captured[0]?.arguments).toEqual([
      'api',
      'graphql',
      '--hostname',
      'github.com',
      '-f',
      `query=${reviewThreadNodeQuery}`,
      '-f',
      'threadId=PRRT_1',
    ]);
    expect(captured[2]?.arguments).toContain('repos/example/prdr/pulls/42/comments/1/replies');
    expect(captured[2]?.input).toBe(JSON.stringify({ body }));
  });

  it('stops a reply when the pull request head changed', async () => {
    const { captured, result } = runWithResponses(
      Effect.flip(replyToThread(target, thread, 'Reply', head)),
      [threadResult(), workflowResult('ffffffffffffffffffffffffffffffffffffffff')],
    );

    const error = await result;

    expect(error._tag).toBe('StaleHeadError');
    expect(captured).toHaveLength(2);
  });

  it('stops a reply when thread state changed', async () => {
    const { captured, result } = runWithResponses(
      Effect.flip(replyToThread(target, thread, 'Reply', head)),
      [threadResult(graphqlThread({ isResolved: true }))],
    );

    const error = await result;

    expect(error._tag).toBe('SelectedObjectChangedError');
    expect(captured).toHaveLength(1);
  });

  it('stops a reply when a thread comment body changed', async () => {
    const changed = graphqlThread({
      comments: {
        nodes: [
          { body: 'Changed finding', id: root.node_id, replyTo: null, updatedAt: root.updated_at },
        ],
        totalCount: 1,
      },
    });
    const { captured, result } = runWithResponses(
      Effect.flip(replyToThread(target, thread, 'Reply', head)),
      [threadResult(changed)],
    );

    const error = await result;

    expect(error._tag).toBe('SelectedObjectChangedError');
    expect(captured).toHaveLength(1);
  });

  it('stops a reply when the thread has an unread extra comment', async () => {
    const changed = graphqlThread({
      comments: { nodes: [{ id: root.node_id, replyTo: null }], totalCount: 2 },
    });
    const { captured, result } = runWithResponses(
      Effect.flip(replyToThread(target, thread, 'Reply', head)),
      [threadResult(changed)],
    );

    const error = await result;

    expect(error._tag).toBe('SelectedObjectChangedError');
    expect(captured).toHaveLength(1);
  });

  it('stops a reply when current permissions changed', async () => {
    const { captured, result } = runWithResponses(
      Effect.flip(replyToThread(target, thread, 'Reply', head)),
      [threadResult(graphqlThread({ viewerCanReply: false }))],
    );

    const error = await result;

    expect(error._tag).toBe('SelectedObjectChangedError');
    expect(captured).toHaveLength(1);
  });

  it('edits an issue comment only when its timestamp is current', async () => {
    const { captured, result } = runWithResponses(
      editComment(target, issueSelection, 'New', head),
      [
        jsonResult(issue),
        workflowResult(),
        jsonResult({ body: 'New', html_url: issue.html_url, id: 5, node_id: 'IC_5' }),
        jsonResult({ body: 'New', html_url: issue.html_url, id: 5, node_id: 'IC_5' }),
        workflowResult(),
      ],
    );

    await result;

    expect(captured[0]?.arguments).toContain('repos/example/prdr/issues/comments/5');
    expect(captured[2]?.arguments).toContain('PATCH');
    expect(captured[2]?.input).toBe(JSON.stringify({ body: 'New' }));
  });

  it('edits a review comment through the review-comment endpoint', async () => {
    const selection: CommentSelection = { comment: root, kind: 'review-comment', thread };
    const { captured, result } = runWithResponses(editComment(target, selection, 'New', head), [
      jsonResult(root),
      workflowResult(),
      reviewCommentCreated('New'),
      reviewCommentCreated('New'),
      workflowResult(),
    ]);

    await result;

    expect(captured[0]?.arguments).toContain('repos/example/prdr/pulls/comments/1');
    expect(captured[2]?.arguments).toContain('PATCH');
    expect(captured[2]?.input).toBe(JSON.stringify({ body: 'New' }));
  });

  it('stops an edit when the comment timestamp changed', async () => {
    const selection: CommentSelection = { comment: root, kind: 'review-comment', thread };
    const changed = { ...root, updated_at: '2026-08-24T11:00:00Z' };
    const { captured, result } = runWithResponses(
      Effect.flip(editComment(target, selection, 'New', head)),
      [jsonResult(changed)],
    );

    const error = await result;

    expect(error._tag).toBe('SelectedObjectChangedError');
    expect(captured).toHaveLength(1);
  });

  it('stops an edit when the body changed without a new timestamp', async () => {
    const selection: CommentSelection = { comment: root, kind: 'review-comment', thread };
    const changed = { ...root, body: 'Changed elsewhere' };
    const { captured, result } = runWithResponses(
      Effect.flip(editComment(target, selection, 'New', head)),
      [jsonResult(changed)],
    );

    const error = await result;

    expect(error._tag).toBe('SelectedObjectChangedError');
    expect(captured).toHaveLength(1);
  });

  it('binds submitted reviews to the inspected commit', async () => {
    const { captured, result } = runWithResponses(
      submitReview(target, 'APPROVE', 'Looks good.', head),
      [
        workflowResult(),
        jsonResult(createdReview('Looks good.', 'APPROVED')),
        jsonResult([]),
        jsonResult(createdReview('Looks good.', 'APPROVED')),
        workflowResult(),
      ],
    );

    await result;

    expect(captured[1]?.input).toBe(
      JSON.stringify({ body: 'Looks good.', comments: [], commit_id: head, event: 'APPROVE' }),
    );
  });

  it('submits several validated inline findings as one review', async () => {
    const finding = {
      body: 'Keep this check on both lines.',
      line: 3,
      path: 'src/example.ts',
      side: 'RIGHT' as const,
      startLine: 2,
      startSide: 'RIGHT' as const,
    };
    const review = createdReview('Review body', 'COMMENTED');
    const { captured, result } = runWithResponses(
      submitReview(target, 'COMMENT', 'Review body', head, [finding]),
      [
        workflowResult(),
        jsonResult({
          additions: 2,
          base: {
            ref: 'main',
            repo: { full_name: 'example/prdr' },
            sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
          body: 'Body',
          changed_files: 1,
          commits: 1,
          deletions: 0,
          draft: false,
          head: { ref: 'feature', repo: { full_name: 'example/prdr' }, sha: head },
          html_url: 'https://github.com/example/prdr/pull/42',
          locked: false,
          merge_commit_sha: null,
          mergeable: true,
          merged: false,
          node_id: 'PR_42',
          number: 42,
          state: 'open',
          title: 'Title',
          user: { login: 'author' },
        }),
        jsonResult([
          [
            {
              additions: 2,
              changes: 2,
              deletions: 0,
              filename: 'src/example.ts',
              patch: '@@ -1,2 +1,3 @@\n line one\n+line two\n+line three',
              status: 'modified',
            },
          ],
        ]),
        jsonResult(review),
        jsonResult([
          [
            {
              body: finding.body,
              line: finding.line,
              path: finding.path,
              side: finding.side,
              start_line: finding.startLine,
              start_side: finding.startSide,
            },
          ],
        ]),
        jsonResult(review),
        workflowResult(),
      ],
    );

    const value = await result;

    expect(value.findings).toBe(1);
    expect(captured[3]?.input).toBe(
      JSON.stringify({
        body: 'Review body',
        comments: [
          {
            body: finding.body,
            line: finding.line,
            path: finding.path,
            side: finding.side,
            start_line: finding.startLine,
            start_side: finding.startSide,
          },
        ],
        commit_id: head,
        event: 'COMMENT',
      }),
    );
  });

  it('reports a review verification failure when the read-back body differs', async () => {
    const { result } = runWithResponses(
      Effect.flip(submitReview(target, 'APPROVE', 'Looks good.', head)),
      [
        workflowResult(),
        jsonResult(createdReview('Looks good.', 'APPROVED')),
        jsonResult([]),
        jsonResult(createdReview('Different', 'APPROVED')),
        workflowResult(),
      ],
    );

    const error = await result;
    expect(error._tag).toBe('PullRequestVerificationError');
  });

  it('stops a review when the pull request head changed', async () => {
    const { captured, result } = runWithResponses(
      Effect.flip(submitReview(target, 'APPROVE', 'Looks good.', head)),
      [workflowResult('ffffffffffffffffffffffffffffffffffffffff')],
    );

    const error = await result;

    expect(error._tag).toBe('StaleHeadError');
    expect(captured).toHaveLength(1);
  });

  it('fails a create or review when GitHub returns an invalid response', async () => {
    const commentRun = runWithResponses(Effect.flip(createIssueComment(target, 'Body')), [
      workflowResult(),
      jsonResult({}),
    ]);
    const reviewRun = runWithResponses(Effect.flip(submitReview(target, 'COMMENT', 'Body', head)), [
      workflowResult(),
      jsonResult({}),
    ]);

    const [commentError, reviewError] = await Promise.all([commentRun.result, reviewRun.result]);

    expect(commentError._tag).toBe('GhDecodeError');
    expect(reviewError._tag).toBe('GhDecodeError');
  });

  it.each([
    ['resolve', resolveThread, resolveThreadMutation, true],
    ['unresolve', unresolveThread, unresolveThreadMutation, false],
  ] as const)('uses the typed %s GraphQL mutation', async (_name, mutate, query, isResolved) => {
    const selected = isResolved
      ? thread
      : { ...thread, isResolved: true, viewerCanResolve: false, viewerCanUnresolve: true };
    const current = graphqlThread({
      isResolved: selected.isResolved,
      viewerCanResolve: selected.viewerCanResolve,
      viewerCanUnresolve: selected.viewerCanUnresolve,
    });
    const payload = isResolved
      ? { data: { resolveReviewThread: { thread: { id: thread.id, isResolved } } } }
      : { data: { unresolveReviewThread: { thread: { id: thread.id, isResolved } } } };
    const { captured, result } = runWithResponses(mutate(target, selected, head), [
      threadResult(current),
      workflowResult(),
      jsonResult(payload),
      workflowResult(),
      threadResult(graphqlThread({ isResolved })),
    ]);

    await result;

    expect(captured[2]?.arguments).toEqual([
      'api',
      'graphql',
      '--hostname',
      'github.com',
      '--input',
      '-',
    ]);
    expect(captured[2]?.input).toBe(JSON.stringify({ query, variables: { threadId: thread.id } }));
  });

  it('returns GraphQL application errors without reporting success', async () => {
    const { result } = runWithResponses(Effect.flip(resolveThread(target, thread, head)), [
      threadResult(),
      workflowResult(),
      jsonResult({ errors: [{ message: 'denied' }] }),
    ]);

    const error = await result;

    expect(error._tag).toBe('PullRequestPermissionError');
  });

  it('rejects a missing or contradictory thread mutation result', async () => {
    const missing = runWithResponses(Effect.flip(resolveThread(target, thread, head)), [
      threadResult(),
      workflowResult(),
      jsonResult({ data: {} }),
    ]);
    const contradictory = runWithResponses(Effect.flip(resolveThread(target, thread, head)), [
      threadResult(),
      workflowResult(),
      jsonResult({
        data: { resolveReviewThread: { thread: { id: thread.id, isResolved: false } } },
      }),
    ]);

    const [missingError, contradictoryError] = await Promise.all([
      missing.result,
      contradictory.result,
    ]);

    expect(missingError._tag).toBe('SnapshotInvariantError');
    expect(contradictoryError._tag).toBe('SnapshotInvariantError');
  });

  it('reports a verification failure when a thread mutation does not read back', async () => {
    const { result } = runWithResponses(Effect.flip(resolveThread(target, thread, head)), [
      threadResult(),
      workflowResult(),
      jsonResult({
        data: { resolveReviewThread: { thread: { id: thread.id, isResolved: true } } },
      }),
      workflowResult(),
      threadResult(),
    ]);

    const error = await result;

    expect(error._tag).toBe('PullRequestVerificationError');
  });

  it('does not call GitHub when cached permissions forbid thread actions', async () => {
    const reply = runWithResponses(
      Effect.flip(replyToThread(target, { ...thread, viewerCanReply: false }, 'Reply', head)),
      [],
    );
    const resolve = runWithResponses(
      Effect.flip(resolveThread(target, { ...thread, viewerCanResolve: false }, head)),
      [],
    );
    const unresolve = runWithResponses(
      Effect.flip(
        unresolveThread(
          target,
          { ...thread, isResolved: true, viewerCanResolve: false, viewerCanUnresolve: false },
          head,
        ),
      ),
      [],
    );

    const errors = await Promise.all([reply.result, resolve.result, unresolve.result]);

    expect(errors.map(({ _tag }) => _tag)).toEqual([
      'ThreadPermissionError',
      'ThreadPermissionError',
      'ThreadPermissionError',
    ]);
    expect(reply.captured).toHaveLength(0);
    expect(resolve.captured).toHaveLength(0);
    expect(unresolve.captured).toHaveLength(0);
  });
});
