import { Effect } from 'effect';

import type { PullRequestTarget } from '../domain/model';
import { findingMetadata } from '../domain/providers';
import type { RawReviewComment } from '../domain/raw';
import { issueCommentRef, reviewCommentRef, reviewRef, threadRef } from '../domain/references';
import type {
  IndexedIssueComment,
  IndexedReview,
  IndexedReviewComment,
  IndexedReviewThread,
  ReviewIndex,
} from '../domain/review-index';
import { SnapshotInvariantError } from './errors';
import {
  normalizeRestActor,
  normalizeReviewIndexActor,
  normalizeReviewIndexCheck,
  normalizeReviewIndexIssueComment,
  normalizeReviewIndexPullRequest,
  normalizeReviewIndexReview,
  requireReviewIndexDatabaseId,
} from './review-index-normalize';
import type {
  RawReviewIndexCheck,
  RawReviewIndexIssueComment,
  RawReviewIndexPullRequest,
  RawReviewIndexReview,
  RawReviewIndexReviewComment,
  RawReviewIndexThread,
} from './review-index-schema';

export interface RawReviewIndexParts {
  readonly checks: readonly RawReviewIndexCheck[];
  readonly issueComments: readonly RawReviewIndexIssueComment[];
  readonly pullRequest: RawReviewIndexPullRequest;
  readonly restReviewComments: readonly RawReviewComment[] | null;
  readonly reviews: readonly RawReviewIndexReview[];
  readonly target: PullRequestTarget;
  readonly threads: readonly RawReviewIndexThread[];
}

interface IndexedCommentRecord {
  readonly comment: IndexedReviewComment;
  readonly nodeId: string;
  readonly replyToNodeId: string | null;
}

const mapIssueComment = Effect.fn('ReviewIndex.mapIssueComment')(function* mapIssueComment(
  raw: RawReviewIndexIssueComment,
) {
  const normalized = yield* normalizeReviewIndexIssueComment(raw);
  const user = normalizeRestActor(normalized.user);
  return {
    body: normalized.body,
    created_at: normalized.created_at,
    html_url: normalized.html_url,
    id: normalized.id,
    metadata: findingMetadata(user.login, normalized.body, user.type),
    ref: issueCommentRef(normalized.id),
    updated_at: normalized.updated_at,
    user,
  };
});

const mapGraphqlReviewComment = Effect.fn('ReviewIndex.mapGraphqlReviewComment')(
  function* mapGraphqlReviewComment(raw: RawReviewIndexReviewComment) {
    const id = yield* requireReviewIndexDatabaseId(raw.databaseId, raw.id);
    const user = normalizeReviewIndexActor(raw.author);
    return {
      comment: {
        body: raw.body,
        created_at: raw.createdAt,
        html_url: raw.url,
        id,
        line: raw.line,
        metadata: findingMetadata(user.login, raw.body, user.type),
        original_line: raw.originalLine,
        path: raw.path,
        ref: reviewCommentRef(id),
        updated_at: raw.updatedAt,
        user,
      },
      nodeId: raw.id,
      replyToNodeId: raw.replyTo?.id ?? null,
    };
  },
);

const mapRestReviewComments = Effect.fn('ReviewIndex.mapRestReviewComments')(
  function* mapRestReviewComments(rawComments: readonly RawReviewComment[]) {
    const nodeIdByDatabaseId = new Map(rawComments.map((comment) => [comment.id, comment.node_id]));
    const records: IndexedCommentRecord[] = [];
    for (const raw of rawComments) {
      const user = normalizeRestActor(raw.user);
      const parentId = raw.in_reply_to_id ?? null;
      const replyToNodeId = parentId === null ? null : nodeIdByDatabaseId.get(parentId);
      if (parentId !== null && replyToNodeId === undefined) {
        return yield* SnapshotInvariantError.make({
          detail: `GitHub did not return parent review comment ${parentId}.`,
        });
      }
      records.push({
        comment: {
          body: raw.body,
          created_at: raw.created_at,
          html_url: raw.html_url,
          id: raw.id,
          line: raw.line,
          metadata: findingMetadata(user.login, raw.body, user.type),
          original_line: raw.original_line,
          path: raw.path,
          ref: reviewCommentRef(raw.id),
          updated_at: raw.updated_at,
          user,
        },
        nodeId: raw.node_id,
        replyToNodeId: replyToNodeId ?? null,
      });
    }
    return records;
  },
);

interface MappedReviews {
  readonly commentRecords: readonly IndexedCommentRecord[];
  readonly reviews: readonly IndexedReview[];
}

const mapReviews = Effect.fn('ReviewIndex.mapReviews')(function* mapReviews(
  rawReviews: readonly RawReviewIndexReview[],
  includeGraphqlComments: boolean,
) {
  const reviews: IndexedReview[] = [];
  const commentRecords: IndexedCommentRecord[] = [];
  for (const raw of rawReviews) {
    const normalized = yield* normalizeReviewIndexReview(raw);
    const user = normalizeRestActor(normalized.user);
    reviews.push({
      body: normalized.body,
      html_url: normalized.html_url,
      id: normalized.id,
      metadata: findingMetadata(user.login, normalized.body, user.type),
      ref: reviewRef(normalized.id),
      state: normalized.state,
      submitted_at: normalized.submitted_at,
      user,
    });
    if (includeGraphqlComments) {
      for (const comment of raw.comments.nodes) {
        commentRecords.push(yield* mapGraphqlReviewComment(comment));
      }
    }
  }
  return { commentRecords, reviews } satisfies MappedReviews;
});

const indexComments = Effect.fn('ReviewIndex.indexComments')(function* indexComments(
  records: readonly IndexedCommentRecord[],
) {
  const byNodeId = new Map(records.map((record) => [record.nodeId, record]));
  const databaseIds = new Set(records.map(({ comment }) => comment.id));
  if (byNodeId.size !== records.length || databaseIds.size !== records.length) {
    return yield* SnapshotInvariantError.make({
      detail: 'GitHub returned duplicate review comment identities.',
    });
  }
  return byNodeId;
});

interface MappedThreads {
  readonly threadedNodeIds: ReadonlySet<string>;
  readonly threads: readonly IndexedReviewThread[];
}

const mapThreads = Effect.fn('ReviewIndex.mapThreads')(function* mapThreads(
  rawThreads: readonly RawReviewIndexThread[],
  commentByNodeId: ReadonlyMap<string, IndexedCommentRecord>,
) {
  const threadedNodeIds = new Set<string>();
  const threads: IndexedReviewThread[] = [];
  for (const raw of rawThreads) {
    if (raw.comments.nodes.length !== raw.comments.totalCount) {
      return yield* SnapshotInvariantError.make({
        detail: `Review thread ${raw.id} has more than 100 comments and cannot be read safely.`,
      });
    }
    const rootIdentities = raw.comments.nodes.filter((comment) => comment.replyTo === null);
    const [rootIdentity] = rootIdentities;
    if (rootIdentity === undefined || rootIdentities.length !== 1) {
      return yield* SnapshotInvariantError.make({
        detail: `Review thread ${raw.id} must have exactly one root comment.`,
      });
    }
    const threadComments: IndexedReviewComment[] = [];
    for (const identity of raw.comments.nodes) {
      const record = commentByNodeId.get(identity.id);
      if (record === undefined) {
        return yield* SnapshotInvariantError.make({
          detail: `GitHub did not return review comment ${identity.id}.`,
        });
      }
      if (threadedNodeIds.has(identity.id)) {
        return yield* SnapshotInvariantError.make({
          detail: `Review comment ${identity.id} belongs to more than one review thread.`,
        });
      }
      if (record.replyToNodeId !== (identity.replyTo?.id ?? null)) {
        return yield* SnapshotInvariantError.make({
          detail: `GitHub returned contradictory parents for review comment ${identity.id}.`,
        });
      }
      threadedNodeIds.add(identity.id);
      threadComments.push(record.comment);
    }
    const root = commentByNodeId.get(rootIdentity.id)?.comment;
    if (root === undefined) {
      return yield* SnapshotInvariantError.make({
        detail: `GitHub did not return root review comment ${rootIdentity.id}.`,
      });
    }
    threads.push({
      comments: threadComments,
      id: raw.id,
      isOutdated: raw.isOutdated,
      isResolved: raw.isResolved,
      line: raw.line,
      originalLine: raw.originalLine,
      path: raw.path,
      ref: threadRef(raw.id),
      resolvedBy: raw.resolvedBy?.login ?? null,
      root,
      subjectType: raw.subjectType,
      viewerCanReply: raw.viewerCanReply,
      viewerCanResolve: raw.viewerCanResolve,
      viewerCanUnresolve: raw.viewerCanUnresolve,
    });
  }
  return { threadedNodeIds, threads } satisfies MappedThreads;
});

export const mapReviewIndex = Effect.fn('ReviewIndex.map')(function* mapReviewIndex(
  parts: RawReviewIndexParts,
) {
  if (parts.pullRequest.number !== parts.target.number) {
    return yield* SnapshotInvariantError.make({
      detail: `GitHub returned pull request ${parts.pullRequest.number} for target ${parts.target.number}.`,
    });
  }

  const issueComments: IndexedIssueComment[] = [];
  for (const raw of parts.issueComments) {
    issueComments.push(yield* mapIssueComment(raw));
  }

  const mappedReviews = yield* mapReviews(parts.reviews, parts.restReviewComments === null);
  const commentRecords =
    parts.restReviewComments === null
      ? mappedReviews.commentRecords
      : yield* mapRestReviewComments(parts.restReviewComments);
  const commentByNodeId = yield* indexComments(commentRecords);
  const mappedThreads = yield* mapThreads(parts.threads, commentByNodeId);

  return {
    checks: parts.checks.map(normalizeReviewIndexCheck),
    issueComments,
    pullRequest: normalizeReviewIndexPullRequest(parts.pullRequest),
    reviews: mappedReviews.reviews,
    target: parts.target,
    threads: mappedThreads.threads,
    unthreadedReviewComments: commentRecords
      .filter(({ nodeId }) => !mappedThreads.threadedNodeIds.has(nodeId))
      .map(({ comment }) => comment),
  } satisfies ReviewIndex;
});
