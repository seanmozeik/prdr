import { Effect } from 'effect';

import type { PullRequestSnapshot, PullRequestTarget } from '../domain/model';
import type { RawReviewComment } from '../domain/raw';
import { PullRequestChangedError, SnapshotChangedError, SnapshotInvariantError } from './errors';
import { loadRawReviewIndexOnce } from './review-index';
import type { RawReviewIndexParts } from './review-index-map';
import {
  normalizeRestActor,
  normalizeReviewIndexActor,
  normalizeReviewIndexCheck,
  normalizeReviewIndexIssueComment,
  normalizeReviewIndexPullRequest,
  normalizeReviewIndexReview,
} from './review-index-normalize';
import type { RawReviewIndexReview, RawReviewIndexReviewComment } from './review-index-schema';
import { composeSnapshot } from './snapshot';
import { reloadPullRequest, resolvePullRequestTarget } from './target';

const reviewCommentMatches = (
  graphql: RawReviewIndexReviewComment,
  rest: RawReviewComment,
): boolean => {
  const graphqlActor = normalizeReviewIndexActor(graphql.author);
  const restActor = normalizeRestActor(rest.user);
  return (
    graphql.databaseId === rest.id &&
    graphql.body === rest.body &&
    graphql.createdAt === rest.created_at &&
    graphql.line === rest.line &&
    graphql.originalLine === rest.original_line &&
    graphql.path === rest.path &&
    (graphql.replyTo?.databaseId ?? null) === (rest.in_reply_to_id ?? null) &&
    graphql.updatedAt === rest.updated_at &&
    graphql.url === rest.html_url &&
    graphqlActor.login === restActor.login &&
    graphqlActor.type === restActor.type
  );
};

const reviewEnrichmentMatches = (
  review: RawReviewIndexReview,
  restByNodeId: ReadonlyMap<string, RawReviewComment>,
  graphqlNodeIds: Set<string>,
): boolean => {
  for (const graphql of review.comments.nodes) {
    if (graphqlNodeIds.has(graphql.id)) {
      return false;
    }
    graphqlNodeIds.add(graphql.id);
    const rest = restByNodeId.get(graphql.id);
    if (rest === undefined || !reviewCommentMatches(graphql, rest)) {
      return false;
    }
  }
  return true;
};

const enrichmentMatches = (parts: RawReviewIndexParts): boolean => {
  const restComments = parts.restReviewComments;
  if (restComments === null) {
    return false;
  }
  const restByNodeId = new Map(restComments.map((comment) => [comment.node_id, comment]));
  if (restByNodeId.size !== restComments.length) {
    return false;
  }
  const graphqlNodeIds = new Set<string>();
  let graphqlCommentCount = 0;
  let graphqlCommentsAreComplete = true;
  for (const review of parts.reviews) {
    graphqlCommentCount += review.comments.totalCount;
    graphqlCommentsAreComplete &&= review.comments.nodes.length === review.comments.totalCount;
    if (!reviewEnrichmentMatches(review, restByNodeId, graphqlNodeIds)) {
      return false;
    }
  }
  return (
    graphqlCommentCount === restComments.length &&
    (!graphqlCommentsAreComplete || graphqlNodeIds.size === restComments.length)
  );
};

const composeBatchedSnapshot = Effect.fn('Snapshot.composeBatched')(
  function* composeBatchedSnapshot(parts: RawReviewIndexParts) {
    if (parts.restReviewComments === null) {
      return yield* SnapshotInvariantError.make({
        detail: 'The exact snapshot did not load review comments from the REST API.',
      });
    }
    const issueComments = yield* Effect.forEach(
      parts.issueComments,
      normalizeReviewIndexIssueComment,
    );
    const reviews = yield* Effect.forEach(parts.reviews, normalizeReviewIndexReview);
    return yield* composeSnapshot(
      parts.target,
      normalizeReviewIndexPullRequest(parts.pullRequest),
      {
        checks: parts.checks.map(normalizeReviewIndexCheck),
        graphqlThreads: parts.threads,
        issueComments,
        reviewComments: parts.restReviewComments,
        reviews,
      },
    );
  },
);

interface SnapshotCandidate {
  readonly enrichmentMatches: boolean;
  readonly snapshot: PullRequestSnapshot;
}

const loadCandidate = Effect.fn('Snapshot.loadBatchedCandidate')(function* loadCandidate(
  target: PullRequestTarget,
  includeChecks: boolean,
) {
  const parts = yield* loadRawReviewIndexOnce(target, includeChecks, true);
  const snapshot = yield* composeBatchedSnapshot(parts);
  return { enrichmentMatches: enrichmentMatches(parts), snapshot } satisfies SnapshotCandidate;
});

const MAXIMUM_ATTEMPTS = 3;

export const loadBatchedSnapshotForTarget = Effect.fn('Snapshot.loadBatchedForTarget')(
  function* loadBatchedSnapshotForTarget(target: PullRequestTarget, includeChecks: boolean) {
    let lastBefore = '';
    let lastAfter = '';
    for (let attempt = 1; attempt <= MAXIMUM_ATTEMPTS; attempt += 1) {
      const candidate = yield* loadCandidate(target, includeChecks);
      const after = yield* reloadPullRequest(target);
      lastBefore = candidate.snapshot.pullRequest.headRefOid;
      lastAfter = after.headRefOid;
      if (
        candidate.enrichmentMatches &&
        lastBefore === lastAfter &&
        candidate.snapshot.pullRequest.updatedAt === after.updatedAt
      ) {
        return { ...candidate.snapshot, pullRequest: after } satisfies PullRequestSnapshot;
      }
    }
    if (lastBefore !== lastAfter) {
      return yield* PullRequestChangedError.make({ after: lastAfter, before: lastBefore });
    }
    return yield* SnapshotChangedError.make({ attempts: MAXIMUM_ATTEMPTS });
  },
);

export const loadBatchedSnapshot = Effect.fn('Snapshot.loadBatched')(function* loadBatchedSnapshot(
  repository: string,
  pullRequest: number,
  branch: string,
  includeChecks: boolean,
) {
  const target = yield* resolvePullRequestTarget(repository, pullRequest, branch);
  return yield* loadBatchedSnapshotForTarget(target, includeChecks);
});
