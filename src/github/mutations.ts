import { createHash } from 'node:crypto';

import { Effect, Schema } from 'effect';

import { validateReviewFindings } from '../domain/diff-coordinates';
import { UnsupportedMutationError } from '../domain/errors';
import type { CommentSelection, PullRequestTarget, ReviewThread } from '../domain/model';
import {
  PullRequestInputError,
  PullRequestPermissionError,
  PullRequestValidationError,
  PullRequestVerificationError,
  StateConflictError,
  UnsupportedRepositoryPolicyError,
} from '../domain/pull-request-errors';
import {
  RawCreatedReview,
  RawCreatedReviewComment,
  RawPullRequestDetail,
  RawPullRequestFile,
} from '../domain/pull-request-raw';
import { BoundedPaginationError } from '../domain/pull-request-read-errors';
import type { ReviewFinding } from '../domain/pull-request-review';
import {
  CreatedIssueComment,
  CreatedReviewComment,
  type GraphqlThread,
  RawIssueComment,
  RawReviewComment,
  ThreadMutationResponse,
} from '../domain/raw';
import { decodeGhJson, encodeGhJson, GhClient, ghRequest, restApiHeaders } from './client';
import {
  type GhCommandError,
  PullRequestChangedError,
  SelectedObjectChangedError,
  SnapshotInvariantError,
  ThreadPermissionError,
} from './errors';
import { loadReviewThreadById } from './loaders';
import {
  ensureExpectedHead as ensureWorkflowExpectedHead,
  loadWorkflowPullRequest,
  requirePullRequestPermission,
} from './pull-request/state';
import { resolveThreadMutation, unresolveThreadMutation } from './queries';
import { loadRestPages, loadRestResource } from './rest';

const BodyRequest = Schema.Struct({ body: Schema.String });
const ReviewRequest = Schema.Struct({
  body: Schema.String,
  comments: Schema.Array(
    Schema.Struct({
      body: Schema.String,
      line: Schema.Int,
      path: Schema.String,
      side: Schema.Literals(['LEFT', 'RIGHT']),
      start_line: Schema.optionalKey(Schema.Int),
      start_side: Schema.optionalKey(Schema.Literals(['LEFT', 'RIGHT'])),
    }),
  ),
  commit_id: Schema.String,
  event: Schema.Literals(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']),
});
const ThreadMutationRequest = Schema.Struct({
  query: Schema.String,
  variables: Schema.Struct({ threadId: Schema.String }),
});

export type ReviewEvent = (typeof ReviewRequest.Type)['event'];
type EditableCommentSelection = Exclude<CommentSelection, { readonly kind: 'review' }>;

const preflightPullRequest = Effect.fn('Mutation.preflightPullRequest')(
  function* preflightPullRequest(
    target: PullRequestTarget,
    expectedHead: string,
    operation: string,
  ) {
    const current = yield* loadWorkflowPullRequest(target);
    yield* ensureWorkflowExpectedHead(current, expectedHead, operation);
    yield* requirePullRequestPermission(current, operation, 'read');
    return current;
  },
);

const graphqlThreadFingerprint = (thread: GraphqlThread): string =>
  JSON.stringify({
    comments: {
      nodes: thread.comments.nodes.map(({ body, id, replyTo, updatedAt }) => ({
        body,
        id,
        replyTo: replyTo?.id ?? null,
        updatedAt,
      })),
      totalCount: thread.comments.totalCount,
    },
    id: thread.id,
    isOutdated: thread.isOutdated,
    isResolved: thread.isResolved,
    line: thread.line,
    originalLine: thread.originalLine,
    path: thread.path,
    resolvedBy: thread.resolvedBy?.login ?? null,
    subjectType: thread.subjectType,
    viewerCanReply: thread.viewerCanReply,
    viewerCanResolve: thread.viewerCanResolve,
    viewerCanUnresolve: thread.viewerCanUnresolve,
  });

const reviewThreadFingerprint = (thread: ReviewThread): string => {
  const nodeIdByDatabaseId = new Map(
    thread.comments.map((comment) => [comment.id, comment.node_id]),
  );
  return JSON.stringify({
    comments: {
      nodes: thread.comments.map(({ body, in_reply_to_id, node_id, updated_at }) => ({
        body,
        id: node_id,
        replyTo:
          in_reply_to_id === undefined || in_reply_to_id === null
            ? null
            : (nodeIdByDatabaseId.get(in_reply_to_id) ?? null),
        updatedAt: updated_at,
      })),
      totalCount: thread.comments.length,
    },
    id: thread.id,
    isOutdated: thread.isOutdated,
    isResolved: thread.isResolved,
    line: thread.line,
    originalLine: thread.originalLine,
    path: thread.path,
    resolvedBy: thread.resolvedBy,
    subjectType: thread.subjectType,
    viewerCanReply: thread.viewerCanReply,
    viewerCanResolve: thread.viewerCanResolve,
    viewerCanUnresolve: thread.viewerCanUnresolve,
  });
};

const ensureThreadUnchanged = Effect.fn('Mutation.ensureThreadUnchanged')(
  function* ensureThreadUnchanged(target: PullRequestTarget, thread: ReviewThread) {
    const current = yield* loadReviewThreadById(target, thread.id).pipe(
      Effect.catchTag('SnapshotInvariantError', () =>
        SelectedObjectChangedError.make({
          detail: 'GitHub no longer returns the selected review thread.',
          reference: thread.ref,
        }),
      ),
    );
    if (graphqlThreadFingerprint(current) !== reviewThreadFingerprint(thread)) {
      return yield* SelectedObjectChangedError.make({
        detail: 'Its comments, state, location, or permissions are different.',
        reference: thread.ref,
      });
    }
    return yield* Effect.void;
  },
);

const ensureCommentUnchanged = Effect.fn('Mutation.ensureCommentUnchanged')(
  function* ensureCommentUnchanged(target: PullRequestTarget, selection: EditableCommentSelection) {
    const base = `repos/${target.owner}/${target.name}`;
    const current =
      selection.kind === 'issue-comment'
        ? yield* loadRestResource(
            target,
            `${base}/issues/comments/${selection.comment.id}`,
            RawIssueComment,
          )
        : yield* loadRestResource(
            target,
            `${base}/pulls/comments/${selection.comment.id}`,
            RawReviewComment,
          );
    if (
      current.node_id !== selection.comment.node_id ||
      current.updated_at !== selection.comment.updated_at ||
      current.body !== selection.comment.body
    ) {
      return yield* SelectedObjectChangedError.make({
        detail: 'Its identity, update timestamp, or body is different.',
        reference: selection.comment.ref,
      });
    }
    return yield* Effect.void;
  },
);

export const apiWrite = Effect.fn('Mutation.apiWrite')(function* apiWrite<T, E, RT, RE>(
  target: PullRequestTarget,
  options: {
    readonly endpoint: string;
    readonly method: 'DELETE' | 'PATCH' | 'POST' | 'PUT';
    readonly operation: string;
    readonly request: T;
    readonly requestSchema: Schema.ConstraintCodec<T, E>;
    readonly responseSchema: Schema.ConstraintCodec<RT, RE>;
  },
) {
  const gh = yield* GhClient;
  const arguments_ = [
    'api',
    '--hostname',
    target.host,
    '-X',
    options.method,
    ...restApiHeaders(target.host),
    options.endpoint,
    '--input',
    '-',
  ];
  const input = yield* encodeGhJson(options.requestSchema, options.request, arguments_);
  const result = yield* gh
    .run(ghRequest(arguments_, input))
    .pipe(
      Effect.catchTag('GhCommandError', (error) =>
        Effect.fail(writeError(options.operation, error)),
      ),
    );
  return yield* decodeGhJson(options.responseSchema, result, arguments_);
});

const writeMessageError = (
  operation: string,
  detail: string,
): PullRequestPermissionError | PullRequestValidationError | UnsupportedRepositoryPolicyError => {
  if (/403|denied|forbidden|permission|not authorized|resource not accessible/iu.test(detail)) {
    return PullRequestPermissionError.make({ operation, required: 'permission for this action' });
  }
  if (
    /not enabled|not supported|merge queue|auto.?merge|repository rule|protected branch/iu.test(
      detail,
    )
  ) {
    return UnsupportedRepositoryPolicyError.make({ detail, operation });
  }
  return PullRequestValidationError.make({ detail, operation });
};

const writeError = (
  operation: string,
  error: GhCommandError,
): PullRequestPermissionError | PullRequestValidationError | UnsupportedRepositoryPolicyError =>
  writeMessageError(operation, error.message);

const expectedReviewState = (event: ReviewEvent): string => {
  switch (event) {
    case 'APPROVE': {
      return 'APPROVED';
    }
    case 'REQUEST_CHANGES': {
      return 'CHANGES_REQUESTED';
    }
    case 'COMMENT': {
      return 'COMMENTED';
    }
    default: {
      return 'COMMENTED';
    }
  }
};

const verifyCommentWrite = Effect.fn('Mutation.verifyCommentWrite')(function* verifyCommentWrite(
  target: PullRequestTarget,
  endpoint: string,
  created: CreatedIssueComment,
  body: string,
  expectedHead: string,
  operation: string,
) {
  const loaded = yield* Effect.all(
    {
      comment: loadRestResource(target, endpoint, CreatedIssueComment),
      pullRequest: loadWorkflowPullRequest(target),
    },
    { concurrency: 'unbounded' },
  );
  if (
    loaded.comment.id !== created.id ||
    loaded.comment.body !== body ||
    loaded.pullRequest.headRefOid !== expectedHead
  ) {
    return yield* PullRequestVerificationError.make({
      detail: 'The comment body, identity, or final pull request head differs.',
      operation,
    });
  }
  return loaded.comment;
});

export const createIssueComment = Effect.fn('Mutation.createIssueComment')(
  function* createIssueComment(target: PullRequestTarget, body: string) {
    const before = yield* loadWorkflowPullRequest(target);
    yield* requirePullRequestPermission(before, 'comment', 'read');
    const created = yield* apiWrite(target, {
      endpoint: `repos/${target.owner}/${target.name}/issues/${target.number}/comments`,
      method: 'POST',
      operation: 'comment',
      request: { body },
      requestSchema: BodyRequest,
      responseSchema: CreatedIssueComment,
    });
    return yield* verifyCommentWrite(
      target,
      `repos/${target.owner}/${target.name}/issues/comments/${created.id}`,
      created,
      body,
      before.headRefOid,
      'comment',
    );
  },
);

export const replyToThread = Effect.fn('Mutation.replyToThread')(function* replyToThread(
  target: PullRequestTarget,
  thread: ReviewThread,
  body: string,
  expectedHead: string,
) {
  if (!thread.viewerCanReply) {
    return yield* ThreadPermissionError.make({ action: 'reply', threadId: thread.id });
  }
  yield* ensureThreadUnchanged(target, thread);
  yield* preflightPullRequest(target, expectedHead, 'reply');
  const created = yield* apiWrite(target, {
    endpoint: `repos/${target.owner}/${target.name}/pulls/${target.number}/comments/${thread.root.id}/replies`,
    method: 'POST',
    operation: 'reply',
    request: { body },
    requestSchema: BodyRequest,
    responseSchema: CreatedReviewComment,
  });
  return yield* verifyCommentWrite(
    target,
    `repos/${target.owner}/${target.name}/pulls/comments/${created.id}`,
    created,
    body,
    expectedHead,
    'reply',
  );
});

export const editComment = Effect.fn('Mutation.editComment')(function* editComment(
  target: PullRequestTarget,
  selection: CommentSelection,
  body: string,
  expectedHead: string,
) {
  if (selection.kind === 'review') {
    return yield* UnsupportedMutationError.make({
      detail: 'prdr does not edit submitted pull request reviews.',
      reference: selection.comment.ref,
    });
  }
  yield* ensureCommentUnchanged(target, selection);
  yield* preflightPullRequest(target, expectedHead, 'edit');
  const endpoint =
    selection.kind === 'issue-comment'
      ? `repos/${target.owner}/${target.name}/issues/comments/${selection.comment.id}`
      : `repos/${target.owner}/${target.name}/pulls/comments/${selection.comment.id}`;
  const updated =
    selection.kind === 'issue-comment'
      ? yield* apiWrite(target, {
          endpoint,
          method: 'PATCH',
          operation: 'edit',
          request: { body },
          requestSchema: BodyRequest,
          responseSchema: CreatedIssueComment,
        })
      : yield* apiWrite(target, {
          endpoint,
          method: 'PATCH',
          operation: 'edit',
          request: { body },
          requestSchema: BodyRequest,
          responseSchema: CreatedReviewComment,
        });
  return yield* verifyCommentWrite(target, endpoint, updated, body, expectedHead, 'edit');
});

export const submitReview = Effect.fn('Mutation.submitReview')(function* submitReview(
  target: PullRequestTarget,
  event: ReviewEvent,
  body: string,
  commitId: string,
  findings: readonly ReviewFinding[] = [],
) {
  if (event !== 'APPROVE' && body.trim() === '') {
    return yield* PullRequestInputError.make({
      detail: 'A comment or request-changes review must have a review body.',
      operation: 'review',
    });
  }
  const before = yield* loadWorkflowPullRequest(target);
  yield* ensureWorkflowExpectedHead(before, commitId, 'review');
  yield* requirePullRequestPermission(before, 'review', event === 'COMMENT' ? 'read' : 'write');
  if (before.state !== 'OPEN') {
    return yield* StateConflictError.make({
      actual: before.state,
      expected: 'OPEN',
      operation: 'review',
    });
  }
  const baseEndpoint = `repos/${target.nameWithOwner}/pulls/${target.number}`;
  if (findings.length > 0) {
    const loaded = yield* Effect.all(
      {
        detail: loadRestResource(target, baseEndpoint, RawPullRequestDetail),
        files: loadRestPages(target, `${baseEndpoint}/files?per_page=100`, RawPullRequestFile),
      },
      { concurrency: 'unbounded' },
    );
    const uniqueFiles = new Set(loaded.files.map(({ filename }) => filename)).size;
    if (uniqueFiles !== loaded.detail.changed_files) {
      return yield* BoundedPaginationError.make({
        actual: uniqueFiles,
        expected: loaded.detail.changed_files,
        resource: 'review diff files',
      });
    }
    if (loaded.detail.head.sha !== commitId) {
      return yield* PullRequestChangedError.make({
        after: loaded.detail.head.sha,
        before: commitId,
      });
    }
    yield* validateReviewFindings(loaded.files, findings);
  }
  const comments = findings.map((finding) => ({
    body: finding.body,
    line: finding.line,
    path: finding.path,
    side: finding.side,
    ...(finding.startLine !== undefined && { start_line: finding.startLine }),
    ...(finding.startSide !== undefined && { start_side: finding.startSide }),
  }));
  const created = yield* apiWrite(target, {
    endpoint: `${baseEndpoint}/reviews`,
    method: 'POST',
    operation: 'review',
    request: { body, comments, commit_id: commitId, event },
    requestSchema: ReviewRequest,
    responseSchema: RawCreatedReview,
  });
  const loaded = yield* Effect.all(
    {
      comments: loadRestPages(
        target,
        `${baseEndpoint}/reviews/${created.id}/comments?per_page=100`,
        RawCreatedReviewComment,
      ),
      review: loadRestResource(target, `${baseEndpoint}/reviews/${created.id}`, RawCreatedReview),
      state: loadWorkflowPullRequest(target),
    },
    { concurrency: 'unbounded' },
  );
  const expectedState = expectedReviewState(event);
  const commentsMatch =
    loaded.comments.length === findings.length &&
    findings.every((finding) =>
      loaded.comments.some(
        (comment) =>
          comment.body === finding.body &&
          comment.path === finding.path &&
          comment.line === finding.line &&
          comment.side === finding.side &&
          (comment.start_line ?? undefined) === finding.startLine &&
          (comment.start_side ?? undefined) === finding.startSide,
      ),
    );
  if (
    loaded.review.body !== body ||
    loaded.review.commit_id !== commitId ||
    loaded.review.state !== expectedState ||
    loaded.state.headRefOid !== commitId ||
    !commentsMatch
  ) {
    return yield* PullRequestVerificationError.make({
      detail: 'The review body, event, commit, inline findings, or final head differs.',
      operation: 'review',
    });
  }
  return {
    bodyBytes: Buffer.byteLength(body, 'utf8'),
    bodySha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    findings: findings.length,
    head: commitId,
    id: loaded.review.id,
    state: loaded.review.state.toLowerCase(),
    url: loaded.review.html_url,
  };
});

const applyThreadMutation = Effect.fn('Mutation.applyThreadMutation')(function* applyThreadMutation(
  target: PullRequestTarget,
  thread: ReviewThread,
  action: 'resolve' | 'unresolve',
  expectedHead: string,
) {
  const allowed = action === 'resolve' ? thread.viewerCanResolve : thread.viewerCanUnresolve;
  if (!allowed) {
    return yield* ThreadPermissionError.make({ action, threadId: thread.id });
  }
  yield* ensureThreadUnchanged(target, thread);
  yield* preflightPullRequest(target, expectedHead, action);
  const query = action === 'resolve' ? resolveThreadMutation : unresolveThreadMutation;
  const gh = yield* GhClient;
  const arguments_ = ['api', 'graphql', '--hostname', target.host, '--input', '-'];
  const input = yield* encodeGhJson(
    ThreadMutationRequest,
    { query, variables: { threadId: thread.id } },
    arguments_,
  );
  const result = yield* gh
    .run(ghRequest(arguments_, input))
    .pipe(Effect.catchTag('GhCommandError', (error) => Effect.fail(writeError(action, error))));
  const response = yield* decodeGhJson(ThreadMutationResponse, result, arguments_);
  const errors = response.errors?.map(({ message }) => message) ?? [];
  if (errors.length > 0) {
    return yield* writeMessageError(action, errors.join('; '));
  }
  const changed =
    action === 'resolve'
      ? response.data?.resolveReviewThread?.thread
      : response.data?.unresolveReviewThread?.thread;
  const expectedResolved = action === 'resolve';
  if (
    changed === undefined ||
    changed.id !== thread.id ||
    changed.isResolved !== expectedResolved
  ) {
    return yield* SnapshotInvariantError.make({
      detail: `GitHub did not confirm the ${action} result for review thread ${thread.id}.`,
    });
  }
  const verified = yield* Effect.all(
    {
      pullRequest: loadWorkflowPullRequest(target),
      thread: loadReviewThreadById(target, thread.id),
    },
    { concurrency: 'unbounded' },
  );
  if (
    verified.pullRequest.headRefOid !== expectedHead ||
    verified.thread.id !== thread.id ||
    verified.thread.isResolved !== expectedResolved
  ) {
    return yield* PullRequestVerificationError.make({
      detail: 'The final review thread state or pull request head differs.',
      operation: action,
    });
  }
  return { action, id: verified.thread.id, isResolved: verified.thread.isResolved };
});

export const resolveThread = Effect.fn('Mutation.resolveThread')(function* resolveThread(
  target: PullRequestTarget,
  thread: ReviewThread,
  expectedHead: string,
) {
  return yield* applyThreadMutation(target, thread, 'resolve', expectedHead);
});

export const unresolveThread = Effect.fn('Mutation.unresolveThread')(function* unresolveThread(
  target: PullRequestTarget,
  thread: ReviewThread,
  expectedHead: string,
) {
  return yield* applyThreadMutation(target, thread, 'unresolve', expectedHead);
});
