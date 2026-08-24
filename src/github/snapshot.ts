import { Effect } from 'effect';

import type {
  AikidoSnapshot,
  ConversationSnapshot,
  GreptileSnapshot,
  IssueComment,
  PullRequestContext,
  PullRequestSnapshot,
  PullRequestTarget,
  ReviewComment,
  ReviewSubmission,
  ReviewThread,
  ThreadSnapshot,
} from '../domain/model';
import { findingMetadata } from '../domain/providers';
import type {
  GhCheck,
  GraphqlThread,
  PullRequestView,
  RawIssueComment,
  RawReview,
  RawReviewComment,
  RestActor,
} from '../domain/raw';
import { issueCommentRef, reviewCommentRef, reviewRef, threadRef } from '../domain/references';
import { SnapshotInvariantError } from './errors';

const deletedActor: RestActor = { login: '[deleted]', type: 'Deleted' };
const normalizeActor = (actor: RestActor | null): RestActor => actor ?? deletedActor;

const decorateReviewComment = (comment: RawReviewComment): ReviewComment => {
  const user = normalizeActor(comment.user);
  return {
    ...comment,
    metadata: findingMetadata(user.login, comment.body, user.type),
    ref: reviewCommentRef(comment.id),
    user,
  };
};

const decorateIssueComment = (comment: RawIssueComment): IssueComment => {
  const user = normalizeActor(comment.user);
  return {
    ...comment,
    metadata: findingMetadata(user.login, comment.body, user.type),
    ref: issueCommentRef(comment.id),
    user,
  };
};

const decorateReview = (review: RawReview): ReviewSubmission => {
  const user = normalizeActor(review.user);
  return {
    ...review,
    metadata: findingMetadata(user.login, review.body, user.type),
    ref: reviewRef(review.id),
    user,
  };
};

export interface ReviewThreadParts {
  readonly graphqlThreads: readonly GraphqlThread[];
  readonly reviewComments: readonly RawReviewComment[];
}

interface ComposedThreads {
  readonly threads: readonly ReviewThread[];
  readonly unthreadedReviewComments: readonly ReviewComment[];
}

const composeThreads = Effect.fn('Snapshot.composeThreads')(function* composeThreads(
  parts: ReviewThreadParts,
) {
  const comments = parts.reviewComments.map(decorateReviewComment);
  const commentByNodeId = new Map(comments.map((comment) => [comment.node_id, comment]));
  const nodeIdByDatabaseId = new Map(comments.map((comment) => [comment.id, comment.node_id]));
  if (commentByNodeId.size !== comments.length || nodeIdByDatabaseId.size !== comments.length) {
    return yield* SnapshotInvariantError.make({
      detail: 'REST returned duplicate review comment identities.',
    });
  }
  const threadedIds = new Set<number>();
  const threads: ReviewThread[] = [];

  for (const graphqlThread of parts.graphqlThreads) {
    if (graphqlThread.comments.nodes.length !== graphqlThread.comments.totalCount) {
      return yield* SnapshotInvariantError.make({
        detail: `Review thread ${graphqlThread.id} has more than 100 comments and cannot be read safely.`,
      });
    }
    const rootIdentities = graphqlThread.comments.nodes.filter(
      (comment) => comment.replyTo === null,
    );
    const [rootIdentity] = rootIdentities;
    if (rootIdentity === undefined || rootIdentities.length !== 1) {
      return yield* SnapshotInvariantError.make({
        detail: `Review thread ${graphqlThread.id} must have exactly one root comment.`,
      });
    }
    const root = commentByNodeId.get(rootIdentity.id);
    if (root === undefined) {
      return yield* SnapshotInvariantError.make({
        detail: `REST did not return root review comment ${rootIdentity.id}.`,
      });
    }
    const threadComments: ReviewComment[] = [];
    for (const identity of graphqlThread.comments.nodes) {
      const comment = commentByNodeId.get(identity.id);
      if (comment === undefined) {
        return yield* SnapshotInvariantError.make({
          detail: `REST did not return review comment ${identity.id}.`,
        });
      }
      if (threadedIds.has(comment.id)) {
        return yield* SnapshotInvariantError.make({
          detail: `Review comment ${identity.id} belongs to more than one review thread.`,
        });
      }
      const restReplyTo =
        comment.in_reply_to_id === undefined || comment.in_reply_to_id === null
          ? null
          : nodeIdByDatabaseId.get(comment.in_reply_to_id);
      if (restReplyTo === undefined) {
        return yield* SnapshotInvariantError.make({
          detail: `REST did not return parent review comment ${comment.in_reply_to_id}.`,
        });
      }
      if ((identity.replyTo?.id ?? null) !== restReplyTo) {
        return yield* SnapshotInvariantError.make({
          detail: `REST and GraphQL disagree about the parent of review comment ${identity.id}.`,
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
    threads,
    unthreadedReviewComments: comments.filter((comment) => !threadedIds.has(comment.id)),
  } satisfies ComposedThreads;
});

export const composeThreadSnapshot = Effect.fn('Snapshot.composeThread')(
  function* composeThreadSnapshot(context: PullRequestContext, parts: ReviewThreadParts) {
    const threadData = yield* composeThreads(parts);
    return { ...context, ...threadData } satisfies ThreadSnapshot;
  },
);

export interface ConversationParts extends ReviewThreadParts {
  readonly issueComments: readonly RawIssueComment[];
  readonly reviews: readonly RawReview[];
}

export const composeConversationSnapshot = Effect.fn('Snapshot.composeConversation')(
  function* composeConversationSnapshot(context: PullRequestContext, parts: ConversationParts) {
    const threadData = yield* composeThreads(parts);
    return {
      ...context,
      ...threadData,
      issueComments: parts.issueComments.map(decorateIssueComment),
      reviews: parts.reviews.map(decorateReview),
    } satisfies ConversationSnapshot;
  },
);

export const composeGreptileSnapshot = Effect.fn('Snapshot.composeGreptile')(
  function* composeGreptileSnapshot(
    context: PullRequestContext,
    parts: ReviewThreadParts & { readonly issueComments: readonly RawIssueComment[] },
  ) {
    const threadData = yield* composeThreads(parts);
    return {
      ...context,
      ...threadData,
      issueComments: parts.issueComments.map(decorateIssueComment),
    } satisfies GreptileSnapshot;
  },
);

export const composeAikidoSnapshot = Effect.fn('Snapshot.composeAikido')(
  function* composeAikidoSnapshot(
    context: PullRequestContext,
    parts: ReviewThreadParts & { readonly checks: readonly GhCheck[] },
  ) {
    const threadData = yield* composeThreads(parts);
    return { ...context, ...threadData, checks: parts.checks } satisfies AikidoSnapshot;
  },
);

export interface SnapshotParts extends ConversationParts {
  readonly checks: readonly GhCheck[];
}

export const composeSnapshot = Effect.fn('Snapshot.compose')(function* composeSnapshot(
  target: PullRequestTarget,
  pullRequest: PullRequestView,
  parts: SnapshotParts,
) {
  const conversation = yield* composeConversationSnapshot({ pullRequest, target }, parts);
  return { ...conversation, checks: parts.checks, schemaVersion: 1 } satisfies PullRequestSnapshot;
});
