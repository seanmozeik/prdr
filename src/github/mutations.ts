import { Effect, Schema } from 'effect';

import { UnsupportedMutationError } from '../domain/errors';
import type { CommentSelection, PullRequestTarget, ReviewThread } from '../domain/model';
import {
  CreatedIssueComment,
  CreatedReview,
  CreatedReviewComment,
  type GraphqlThread,
  RawIssueComment,
  RawReviewComment,
  ThreadMutationResponse,
} from '../domain/raw';
import { decodeGhJson, encodeGhJson, GhClient, ghRequest, restApiHeaders } from './client';
import {
  GhGraphqlError,
  PullRequestChangedError,
  SelectedObjectChangedError,
  SnapshotInvariantError,
  ThreadPermissionError,
} from './errors';
import { loadReviewThreadById } from './loaders';
import { resolveThreadMutation, unresolveThreadMutation } from './queries';
import { loadRestResource } from './rest';
import { reloadPullRequest } from './target';

const BodyRequest = Schema.Struct({ body: Schema.String });
const ReviewRequest = Schema.Struct({
  body: Schema.String,
  commit_id: Schema.String,
  event: Schema.Literals(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']),
});
const ThreadMutationRequest = Schema.Struct({
  query: Schema.String,
  variables: Schema.Struct({ threadId: Schema.String }),
});

export type ReviewEvent = (typeof ReviewRequest.Type)['event'];
type EditableCommentSelection = Exclude<CommentSelection, { readonly kind: 'review' }>;

const ensureExpectedHead = Effect.fn('Mutation.ensureExpectedHead')(function* ensureExpectedHead(
  target: PullRequestTarget,
  expectedHead: string,
) {
  const current = yield* reloadPullRequest(target);
  if (current.headRefOid !== expectedHead) {
    return yield* PullRequestChangedError.make({ after: current.headRefOid, before: expectedHead });
  }
  return yield* Effect.void;
});

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

const apiWrite = <T, E, RT, RE>(
  target: PullRequestTarget,
  method: 'PATCH' | 'POST',
  endpoint: string,
  requestSchema: Schema.ConstraintCodec<T, E>,
  request: T,
  responseSchema: Schema.ConstraintCodec<RT, RE>,
) =>
  Effect.gen(function* apiWriteGen() {
    const gh = yield* GhClient;
    const arguments_ = [
      'api',
      '--hostname',
      target.host,
      '-X',
      method,
      ...restApiHeaders(target.host),
      endpoint,
      '--input',
      '-',
    ];
    const input = yield* encodeGhJson(requestSchema, request, arguments_);
    const result = yield* gh.run(ghRequest(arguments_, input));
    return yield* decodeGhJson(responseSchema, result, arguments_);
  });

export const createIssueComment = Effect.fn('Mutation.createIssueComment')(
  function* createIssueComment(target: PullRequestTarget, body: string) {
    return yield* apiWrite(
      target,
      'POST',
      `repos/${target.owner}/${target.name}/issues/${target.number}/comments`,
      BodyRequest,
      { body },
      CreatedIssueComment,
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
  yield* ensureExpectedHead(target, expectedHead);
  return yield* apiWrite(
    target,
    'POST',
    `repos/${target.owner}/${target.name}/pulls/${target.number}/comments/${thread.root.id}/replies`,
    BodyRequest,
    { body },
    CreatedReviewComment,
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
  yield* ensureExpectedHead(target, expectedHead);
  const endpoint =
    selection.kind === 'issue-comment'
      ? `repos/${target.owner}/${target.name}/issues/comments/${selection.comment.id}`
      : `repos/${target.owner}/${target.name}/pulls/comments/${selection.comment.id}`;
  if (selection.kind === 'issue-comment') {
    return yield* apiWrite(target, 'PATCH', endpoint, BodyRequest, { body }, CreatedIssueComment);
  }
  return yield* apiWrite(target, 'PATCH', endpoint, BodyRequest, { body }, CreatedReviewComment);
});

export const submitReview = Effect.fn('Mutation.submitReview')(function* submitReview(
  target: PullRequestTarget,
  event: ReviewEvent,
  body: string,
  commitId: string,
) {
  yield* ensureExpectedHead(target, commitId);
  return yield* apiWrite(
    target,
    'POST',
    `repos/${target.owner}/${target.name}/pulls/${target.number}/reviews`,
    ReviewRequest,
    { body, commit_id: commitId, event },
    CreatedReview,
  );
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
  yield* ensureExpectedHead(target, expectedHead);
  const query = action === 'resolve' ? resolveThreadMutation : unresolveThreadMutation;
  const gh = yield* GhClient;
  const arguments_ = ['api', 'graphql', '--hostname', target.host, '--input', '-'];
  const input = yield* encodeGhJson(
    ThreadMutationRequest,
    { query, variables: { threadId: thread.id } },
    arguments_,
  );
  const result = yield* gh.run(ghRequest(arguments_, input));
  const response = yield* decodeGhJson(ThreadMutationResponse, result, arguments_);
  const errors = response.errors?.map(({ message }) => message) ?? [];
  if (errors.length > 0) {
    return yield* GhGraphqlError.make({ messages: Array.from(errors) });
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
  return { action, ...changed };
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
