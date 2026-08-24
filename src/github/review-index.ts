import { Effect } from 'effect';

import type { PullRequestTarget } from '../domain/model';
import { RawReviewComment } from '../domain/raw';
import { decodeGhJson, GhClient, ghRequest } from './client';
import {
  GhGraphqlError,
  PullRequestChangedError,
  SnapshotChangedError,
  SnapshotInvariantError,
  TargetResolutionError,
} from './errors';
import { reviewIndexQuery } from './queries';
import { loadRestPages } from './rest';
import { mapReviewIndex } from './review-index-map';
import {
  collectReviewIndexPage,
  connectionsOpen,
  cursorArgument,
  makeReviewIndexAccumulator,
  makeReviewIndexConnections,
  type ReviewIndexConnections,
} from './review-index-pagination';
import { ReviewIndexResponse, type RawReviewIndexPullRequest } from './review-index-schema';
import { resolvePullRequestTarget } from './target';

const loadReviewIndexPage = Effect.fn('ReviewIndex.loadPage')(function* loadReviewIndexPage(
  target: PullRequestTarget,
  connections: ReviewIndexConnections,
) {
  const gh = yield* GhClient;
  const arguments_ = [
    'api',
    'graphql',
    '--hostname',
    target.host,
    '-f',
    `query=${reviewIndexQuery}`,
    '-f',
    `owner=${target.owner}`,
    '-f',
    `name=${target.name}`,
    '-F',
    `number=${target.number}`,
    '-F',
    `includeChecks=${connections.checks.include}`,
    '-F',
    `includeIssueComments=${connections.issueComments.include}`,
    '-F',
    `includeReviews=${connections.reviews.include}`,
    '-F',
    `includeThreads=${connections.threads.include}`,
    ...cursorArgument('checkCursor', connections.checks),
    ...cursorArgument('issueCursor', connections.issueComments),
    ...cursorArgument('reviewCursor', connections.reviews),
    ...cursorArgument('threadCursor', connections.threads),
  ];
  const result = yield* gh.run(ghRequest(arguments_));
  const response = yield* decodeGhJson(ReviewIndexResponse, result, arguments_);
  const errors = response.errors?.map(({ message }) => message) ?? [];
  if (errors.length > 0) {
    return yield* GhGraphqlError.make({ messages: Array.from(errors) });
  }
  const pullRequest = response.data?.repository?.pullRequest;
  if (pullRequest === undefined || pullRequest === null) {
    return yield* TargetResolutionError.make({
      detail: `GitHub did not return pull request ${target.nameWithOwner}#${target.number}.`,
    });
  }
  return pullRequest;
});

const reviewCommentsEndpoint = (target: PullRequestTarget): string =>
  `repos/${target.owner}/${target.name}/pulls/${target.number}/comments?per_page=100`;

const loadGraphqlReviewIndexAttempt = Effect.fn('ReviewIndex.loadGraphqlAttempt')(
  function* loadGraphqlReviewIndexAttempt(target: PullRequestTarget, includeChecks: boolean) {
    const connections = makeReviewIndexConnections(includeChecks);
    const accumulator = makeReviewIndexAccumulator();
    let pullRequest: RawReviewIndexPullRequest | null = null;

    while (connectionsOpen(connections)) {
      const page = yield* loadReviewIndexPage(target, connections);
      if (pullRequest !== null && pullRequest.headRefOid !== page.headRefOid) {
        return yield* PullRequestChangedError.make({
          after: page.headRefOid,
          before: pullRequest.headRefOid,
        });
      }
      if (pullRequest !== null && pullRequest.updatedAt !== page.updatedAt) {
        return yield* SnapshotChangedError.make({ attempts: 1 });
      }
      pullRequest ??= page;
      yield* collectReviewIndexPage(connections, page, accumulator);
    }

    if (pullRequest === null) {
      return yield* SnapshotInvariantError.make({
        detail: 'GitHub did not return a pull request review index page.',
      });
    }
    return {
      checks: accumulator.checks,
      issueComments: accumulator.issueComments,
      needsRestReviewComments: accumulator.needsRestReviewComments,
      pullRequest,
      reviews: accumulator.reviews,
      target,
      threads: accumulator.threads,
    };
  },
);

const MAXIMUM_GRAPH_ATTEMPTS = 3;

const loadGraphqlReviewIndex = Effect.fn('ReviewIndex.loadGraphql')(
  function* loadGraphqlReviewIndex(target: PullRequestTarget, includeChecks: boolean) {
    for (let attempt = 1; attempt <= MAXIMUM_GRAPH_ATTEMPTS; attempt += 1) {
      const loaded = yield* loadGraphqlReviewIndexAttempt(target, includeChecks).pipe(
        Effect.catchTag('SnapshotChangedError', () => Effect.succeed(null)),
      );
      if (loaded !== null) {
        return loaded;
      }
    }
    return yield* SnapshotChangedError.make({ attempts: MAXIMUM_GRAPH_ATTEMPTS });
  },
);

export const loadRawReviewIndexOnce = Effect.fn('ReviewIndex.loadRawOnce')(
  function* loadRawReviewIndexOnce(
    target: PullRequestTarget,
    includeChecks: boolean,
    exactReviewComments: boolean,
  ) {
    if (exactReviewComments) {
      const loaded = yield* Effect.all(
        {
          graphql: loadGraphqlReviewIndex(target, includeChecks),
          restReviewComments: loadRestPages(
            target,
            reviewCommentsEndpoint(target),
            RawReviewComment,
          ),
        },
        { concurrency: 'unbounded' },
      );
      return { ...loaded.graphql, restReviewComments: loaded.restReviewComments };
    }
    const graphql = yield* loadGraphqlReviewIndex(target, includeChecks);
    const restReviewComments = graphql.needsRestReviewComments
      ? yield* loadRestPages(target, reviewCommentsEndpoint(target), RawReviewComment)
      : null;
    return { ...graphql, restReviewComments };
  },
);

const loadReviewIndexOnce = Effect.fn('ReviewIndex.loadOnce')(function* loadReviewIndexOnce(
  target: PullRequestTarget,
  includeChecks: boolean,
) {
  const raw = yield* loadRawReviewIndexOnce(target, includeChecks, false);
  return yield* mapReviewIndex(raw);
});

export const loadReviewIndexForTarget = Effect.fn('ReviewIndex.loadForTarget')(
  function* loadReviewIndexForTarget(target: PullRequestTarget, includeChecks: boolean) {
    return yield* loadReviewIndexOnce(target, includeChecks);
  },
);

export const loadReviewIndex = Effect.fn('ReviewIndex.load')(function* loadReviewIndex(
  repository: string,
  pullRequest: number,
  branch: string,
  includeChecks: boolean,
) {
  const target = yield* resolvePullRequestTarget(repository, pullRequest, branch);
  return yield* loadReviewIndexForTarget(target, includeChecks);
});
