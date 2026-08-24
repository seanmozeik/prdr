import { Effect } from 'effect';

import { SnapshotInvariantError } from './errors';
import type { RawReviewIndexPullRequest } from './review-index-schema';

interface ConnectionState {
  cursor: string | null;
  include: boolean;
  readonly seen: Set<string>;
}

interface PageInfo {
  readonly endCursor: string | null;
  readonly hasNextPage: boolean;
}

type RawCheck = NonNullable<
  NonNullable<RawReviewIndexPullRequest['statusCheckRollup']>['contexts']
>['nodes'][number];
type RawIssueComment = NonNullable<RawReviewIndexPullRequest['comments']>['nodes'][number];
type RawReview = NonNullable<RawReviewIndexPullRequest['reviews']>['nodes'][number];
type RawThread = NonNullable<RawReviewIndexPullRequest['reviewThreads']>['nodes'][number];

export interface ReviewIndexConnections {
  readonly checks: ConnectionState;
  readonly issueComments: ConnectionState;
  readonly reviews: ConnectionState;
  readonly threads: ConnectionState;
}

export interface ReviewIndexAccumulator {
  readonly checks: RawCheck[];
  readonly issueComments: RawIssueComment[];
  needsRestReviewComments: boolean;
  readonly reviews: RawReview[];
  readonly threads: RawThread[];
}

const connectionState = (include: boolean): ConnectionState => ({
  cursor: null,
  include,
  seen: new Set<string>(),
});

export const makeReviewIndexConnections = (includeChecks: boolean): ReviewIndexConnections => ({
  checks: connectionState(includeChecks),
  issueComments: connectionState(true),
  reviews: connectionState(true),
  threads: connectionState(true),
});

export const makeReviewIndexAccumulator = (): ReviewIndexAccumulator => ({
  checks: [],
  issueComments: [],
  needsRestReviewComments: false,
  reviews: [],
  threads: [],
});

const advanceConnection = Effect.fn('ReviewIndex.advanceConnection')(function* advanceConnection(
  state: ConnectionState,
  pageInfo: PageInfo | undefined,
  name: string,
) {
  if (!state.include) {
    return null;
  }
  if (pageInfo === undefined) {
    return yield* SnapshotInvariantError.make({
      detail: `GitHub omitted the requested ${name} connection.`,
    });
  }
  if (!pageInfo.hasNextPage) {
    state.include = false;
    state.cursor = null;
    return null;
  }
  const { endCursor } = pageInfo;
  if (endCursor === null) {
    return yield* SnapshotInvariantError.make({
      detail: `GitHub marked the ${name} page as incomplete but did not return a cursor.`,
    });
  }
  if (state.seen.has(endCursor)) {
    return yield* SnapshotInvariantError.make({
      detail: `GitHub repeated the ${name} page cursor.`,
    });
  }
  state.seen.add(endCursor);
  state.cursor = endCursor;
  return null;
});

const collectConnection = Effect.fn('ReviewIndex.collectConnection')(function* collectConnection<A>(
  state: ConnectionState,
  connection: { readonly nodes: readonly A[]; readonly pageInfo: PageInfo } | undefined,
  name: string,
  destination: A[],
) {
  if (!state.include) {
    return;
  }
  destination.push(...(connection?.nodes ?? []));
  yield* advanceConnection(state, connection?.pageInfo, name);
});

const collectChecks = Effect.fn('ReviewIndex.collectChecks')(function* collectChecks(
  state: ConnectionState,
  page: RawReviewIndexPullRequest,
  destination: RawCheck[],
) {
  if (!state.include) {
    return;
  }
  const connection = page.statusCheckRollup?.contexts;
  if (connection === undefined) {
    state.include = false;
    state.cursor = null;
    return;
  }
  yield* collectConnection(state, connection, 'status check', destination);
});

const collectReviews = Effect.fn('ReviewIndex.collectReviews')(function* collectReviews(
  state: ConnectionState,
  page: RawReviewIndexPullRequest,
  accumulator: ReviewIndexAccumulator,
) {
  if (!state.include) {
    return;
  }
  const connection = page.reviews;
  const nodes = connection?.nodes ?? [];
  accumulator.reviews.push(...nodes);
  accumulator.needsRestReviewComments ||= nodes.some(
    (review) => review.comments.nodes.length !== review.comments.totalCount,
  );
  yield* advanceConnection(state, connection?.pageInfo, 'review');
});

export const connectionsOpen = (connections: ReviewIndexConnections): boolean =>
  connections.checks.include ||
  connections.issueComments.include ||
  connections.reviews.include ||
  connections.threads.include;

export const cursorArgument = (
  name: string,
  state: ReviewIndexConnections[keyof ReviewIndexConnections],
): readonly string[] => (state.cursor === null ? [] : ['-f', `${name}=${state.cursor}`]);

export const collectReviewIndexPage = Effect.fn('ReviewIndex.collectPage')(
  function* collectReviewIndexPage(
    connections: ReviewIndexConnections,
    page: RawReviewIndexPullRequest,
    accumulator: ReviewIndexAccumulator,
  ) {
    yield* collectChecks(connections.checks, page, accumulator.checks);
    yield* collectConnection(
      connections.issueComments,
      page.comments,
      'issue comment',
      accumulator.issueComments,
    );
    yield* collectReviews(connections.reviews, page, accumulator);
    yield* collectConnection(
      connections.threads,
      page.reviewThreads,
      'review thread',
      accumulator.threads,
    );
  },
);
