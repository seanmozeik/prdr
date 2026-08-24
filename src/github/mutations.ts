import { Effect, Schema } from 'effect';

import { UnsupportedMutationError } from '../domain/errors';
import type { CommentSelection, PullRequestTarget, ReviewThread } from '../domain/model';
import {
  CreatedIssueComment,
  CreatedReview,
  CreatedReviewComment,
  ThreadMutationResponse,
} from '../domain/raw';
import { decodeGhJson, encodeGhJson, GhClient, ghRequest } from './client';
import { GhGraphqlError, SnapshotInvariantError, ThreadPermissionError } from './errors';
import { resolveThreadMutation, unresolveThreadMutation } from './queries';

const BodyRequest = Schema.Struct({ body: Schema.String });
const ReviewRequest = Schema.Struct({
  body: Schema.String,
  event: Schema.Literals(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']),
});
const ThreadMutationRequest = Schema.Struct({
  query: Schema.String,
  variables: Schema.Struct({ threadId: Schema.String }),
});

export type ReviewEvent = (typeof ReviewRequest.Type)['event'];

const rawHeaders = [
  '-H',
  'Accept: application/vnd.github.raw+json',
  '-H',
  'X-GitHub-Api-Version: 2022-11-28',
];

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
      ...rawHeaders,
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
) {
  if (!thread.viewerCanReply) {
    return yield* new ThreadPermissionError({ action: 'reply', threadId: thread.id });
  }
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
) {
  if (selection.kind === 'review') {
    return yield* new UnsupportedMutationError({
      detail: 'prdr does not edit submitted pull request reviews.',
      reference: selection.comment.ref,
    });
  }
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
) {
  return yield* apiWrite(
    target,
    'POST',
    `repos/${target.owner}/${target.name}/pulls/${target.number}/reviews`,
    ReviewRequest,
    { body, event },
    CreatedReview,
  );
});

const applyThreadMutation = Effect.fn('Mutation.applyThreadMutation')(function* applyThreadMutation(
  target: PullRequestTarget,
  thread: ReviewThread,
  action: 'resolve' | 'unresolve',
) {
  const allowed = action === 'resolve' ? thread.viewerCanResolve : thread.viewerCanUnresolve;
  if (!allowed) {
    return yield* new ThreadPermissionError({ action, threadId: thread.id });
  }
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
    return yield* new GhGraphqlError({ messages: Array.from(errors) });
  }
  const changed =
    action === 'resolve'
      ? response.data?.resolveReviewThread?.thread
      : response.data?.unresolveReviewThread?.thread;
  if (changed === undefined) {
    return yield* new SnapshotInvariantError({
      detail: `GitHub did not return the ${action} review thread mutation result.`,
    });
  }
  return { action, ...changed };
});

export const resolveThread = Effect.fn('Mutation.resolveThread')(function* resolveThread(
  target: PullRequestTarget,
  thread: ReviewThread,
) {
  return yield* applyThreadMutation(target, thread, 'resolve');
});

export const unresolveThread = Effect.fn('Mutation.unresolveThread')(function* unresolveThread(
  target: PullRequestTarget,
  thread: ReviewThread,
) {
  return yield* applyThreadMutation(target, thread, 'unresolve');
});
