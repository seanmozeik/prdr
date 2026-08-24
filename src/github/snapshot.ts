import { Effect, Schema } from 'effect';

import type {
  IssueComment,
  PullRequestSnapshot,
  PullRequestTarget,
  ReviewComment,
  ReviewSubmission,
  ReviewThread,
} from '../domain/model';
import { findingMetadata } from '../domain/providers';
import {
  GhCheck,
  type GraphqlThread,
  RawIssueComment,
  RawReview,
  RawReviewComment,
  ReviewThreadsResponse,
} from '../domain/raw';
import { issueCommentRef, reviewCommentRef, reviewRef, threadRef } from '../domain/references';
import { decodeGhJson, GhClient, ghRequest } from './client';
import { GhGraphqlError, PullRequestChangedError, SnapshotInvariantError } from './errors';
import { reviewThreadsQuery } from './queries';
import { reloadPullRequest, repositorySelector } from './target';

const rawHeaders = [
  '-H',
  'Accept: application/vnd.github.raw+json',
  '-H',
  'X-GitHub-Api-Version: 2022-11-28',
];

const restArguments = (target: PullRequestTarget, endpoint: string): readonly string[] => [
  'api',
  '--hostname',
  target.host,
  '--paginate',
  '--slurp',
  ...rawHeaders,
  endpoint,
];

const loadRestPages = <T, E>(
  target: PullRequestTarget,
  endpoint: string,
  schema: Schema.ConstraintCodec<T, E>,
) =>
  Effect.gen(function* loadRestPagesGen() {
    const gh = yield* GhClient;
    const arguments_ = restArguments(target, endpoint);
    const result = yield* gh.run(ghRequest(arguments_));
    const pages = yield* decodeGhJson(Schema.Array(Schema.Array(schema)), result, arguments_);
    return pages.flat();
  });

const graphqlErrors = (response: ReviewThreadsResponse): readonly string[] =>
  response.errors?.map(({ message }) => message) ?? [];

const loadReviewThreadPage = Effect.fn('Snapshot.loadReviewThreadPage')(
  function* loadReviewThreadPage(target: PullRequestTarget, cursor: string | null) {
    const gh = yield* GhClient;
    const arguments_ = [
      'api',
      'graphql',
      '--hostname',
      target.host,
      '-f',
      `query=${reviewThreadsQuery}`,
      '-F',
      `owner=${target.owner}`,
      '-F',
      `name=${target.name}`,
      '-F',
      `number=${target.number}`,
    ];
    if (cursor !== null) {
      arguments_.push('-F', `cursor=${cursor}`);
    }
    const result = yield* gh.run(ghRequest(arguments_));
    const response = yield* decodeGhJson(ReviewThreadsResponse, result, arguments_);
    const errors = graphqlErrors(response);
    if (errors.length > 0) {
      return yield* new GhGraphqlError({ messages: Array.from(errors) });
    }
    const connection = response.data?.repository?.pullRequest?.reviewThreads;
    if (connection === undefined) {
      return yield* new SnapshotInvariantError({
        detail: 'GitHub did not return the requested pull request review thread connection.',
      });
    }
    return connection;
  },
);

const loadReviewThreads = Effect.fn('Snapshot.loadReviewThreads')(function* loadReviewThreads(
  target: PullRequestTarget,
) {
  const threads: GraphqlThread[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const connection: {
      readonly nodes: readonly GraphqlThread[];
      readonly pageInfo: { readonly endCursor: string | null; readonly hasNextPage: boolean };
    } = yield* loadReviewThreadPage(target, cursor);
    const { nodes, pageInfo } = connection;
    const { endCursor, hasNextPage: nextPage } = pageInfo;
    threads.push(...nodes);
    hasNextPage = nextPage;
    cursor = endCursor;
    if (hasNextPage && cursor === null) {
      return yield* new SnapshotInvariantError({
        detail: 'GitHub marked the review thread page as incomplete but did not return a cursor.',
      });
    }
  }
  return threads;
});

const loadChecks = Effect.fn('Snapshot.loadChecks')(function* loadChecks(
  target: PullRequestTarget,
) {
  const gh = yield* GhClient;
  const arguments_ = [
    'pr',
    'checks',
    String(target.number),
    '--repo',
    repositorySelector(target),
    '--json',
    'bucket,completedAt,event,link,name,startedAt,state,workflow',
  ];
  const result = yield* gh.run(ghRequest(arguments_, null, [0, 1, 8]));
  if (result.stdout.trim().length === 0) {
    return [];
  }
  return yield* decodeGhJson(Schema.Array(GhCheck), result, arguments_);
});

const decorateReviewComment = (comment: RawReviewComment): ReviewComment => ({
  ...comment,
  metadata: findingMetadata(comment.user.login, comment.body, comment.user.type),
  ref: reviewCommentRef(comment.id),
});

const decorateIssueComment = (comment: RawIssueComment): IssueComment => ({
  ...comment,
  metadata: findingMetadata(comment.user.login, comment.body, comment.user.type),
  ref: issueCommentRef(comment.id),
});

const decorateReview = (review: RawReview): ReviewSubmission => ({
  ...review,
  metadata: findingMetadata(review.user.login, review.body, review.user.type),
  ref: reviewRef(review.id),
});

export interface SnapshotParts {
  readonly checks: PullRequestSnapshot['checks'];
  readonly graphqlThreads: readonly GraphqlThread[];
  readonly issueComments: readonly RawIssueComment[];
  readonly reviewComments: readonly RawReviewComment[];
  readonly reviews: readonly RawReview[];
}

export const composeSnapshot = Effect.fn('Snapshot.compose')(function* composeSnapshot(
  target: PullRequestTarget,
  pullRequest: PullRequestSnapshot['pullRequest'],
  parts: SnapshotParts,
) {
  const { checks, graphqlThreads, issueComments, reviewComments, reviews } = parts;
  const comments = reviewComments.map((comment) => decorateReviewComment(comment));
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  const threadedIds = new Set<number>();
  const threads: ReviewThread[] = [];

  for (const graphqlThread of graphqlThreads) {
    if (graphqlThread.comments.nodes.length !== graphqlThread.comments.totalCount) {
      return yield* new SnapshotInvariantError({
        detail: `Review thread ${graphqlThread.id} has more than 100 comments and cannot be read safely.`,
      });
    }
    const rootIdentity = graphqlThread.comments.nodes.find((comment) => comment.replyTo === null);
    if (rootIdentity === undefined) {
      return yield* new SnapshotInvariantError({
        detail: `Review thread ${graphqlThread.id} has no root comment.`,
      });
    }
    const root = commentById.get(rootIdentity.databaseId);
    if (root === undefined) {
      return yield* new SnapshotInvariantError({
        detail: `REST did not return root review comment ${rootIdentity.databaseId}.`,
      });
    }
    const threadComments: ReviewComment[] = [];
    for (const identity of graphqlThread.comments.nodes) {
      const comment = commentById.get(identity.databaseId);
      if (comment === undefined) {
        return yield* new SnapshotInvariantError({
          detail: `REST did not return review comment ${identity.databaseId}.`,
        });
      }
      threadedIds.add(comment.id);
      threadComments.push(comment);
    }
    threads.push({
      comments: threadComments,
      id: graphqlThread.id,
      isOutdated: graphqlThread.isOutdated,
      isResolved: graphqlThread.isResolved,
      line: graphqlThread.line,
      originalLine: graphqlThread.originalLine,
      path: graphqlThread.path,
      ref: threadRef(graphqlThread.id),
      resolvedBy: graphqlThread.resolvedBy?.login ?? null,
      root,
      subjectType: graphqlThread.subjectType,
      viewerCanReply: graphqlThread.viewerCanReply,
      viewerCanResolve: graphqlThread.viewerCanResolve,
      viewerCanUnresolve: graphqlThread.viewerCanUnresolve,
    });
  }

  return {
    checks,
    issueComments: issueComments.map((comment) => decorateIssueComment(comment)),
    pullRequest,
    reviews: reviews.map((review) => decorateReview(review)),
    schemaVersion: 1,
    target,
    threads,
    unthreadedReviewComments: comments.filter((comment) => !threadedIds.has(comment.id)),
  } satisfies PullRequestSnapshot;
});

export const loadSnapshot = Effect.fn('Snapshot.load')(function* loadSnapshot(
  target: PullRequestTarget,
) {
  const before = yield* reloadPullRequest(target);
  const base = `repos/${target.owner}/${target.name}`;
  const loaded = yield* Effect.all(
    {
      checks: loadChecks(target),
      issueComments: loadRestPages(
        target,
        `${base}/issues/${target.number}/comments?per_page=100`,
        RawIssueComment,
      ),
      reviewComments: loadRestPages(
        target,
        `${base}/pulls/${target.number}/comments?per_page=100`,
        RawReviewComment,
      ),
      reviews: loadRestPages(
        target,
        `${base}/pulls/${target.number}/reviews?per_page=100`,
        RawReview,
      ),
      threads: loadReviewThreads(target),
    },
    { concurrency: 'unbounded' },
  );
  const after = yield* reloadPullRequest(target);
  if (before.headRefOid !== after.headRefOid) {
    return yield* new PullRequestChangedError({
      after: after.headRefOid,
      before: before.headRefOid,
    });
  }
  return yield* composeSnapshot(target, after, {
    checks: loaded.checks,
    graphqlThreads: loaded.threads,
    issueComments: loaded.issueComments,
    reviewComments: loaded.reviewComments,
    reviews: loaded.reviews,
  });
});
