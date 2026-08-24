import { Effect } from 'effect';

import { checkBucket } from '../domain/checks';
import type { PullRequestContext, PullRequestTarget } from '../domain/model';
import {
  CheckRollupView,
  type CheckRollup,
  type GhCheck,
  type GraphqlThread,
  RawIssueComment,
  RawReview,
  RawReviewComment,
  ReviewThreadNodeResponse,
  ReviewThreadsResponse,
} from '../domain/raw';
import { decodeGhJson, GhClient, ghRequest } from './client';
import {
  GhGraphqlError,
  PullRequestChangedError,
  SnapshotChangedError,
  SnapshotInvariantError,
} from './errors';
import { reviewThreadNodeQuery, reviewThreadsQuery } from './queries';
import { loadRestPages } from './rest';
import {
  composeAikidoSnapshot,
  composeConversationSnapshot,
  composeGreptileSnapshot,
  composeSnapshot,
  composeThreadSnapshot,
  type ConversationParts,
  type SnapshotParts,
} from './snapshot';
import { reloadPullRequest, repositorySelector } from './target';

const graphqlErrors = (response: ReviewThreadsResponse): readonly string[] =>
  response.errors?.map(({ message }) => message) ?? [];

const loadReviewThreadPage = Effect.fn('Loader.loadReviewThreadPage')(
  function* loadReviewThreadPage(target: PullRequestTarget, cursor: string | null) {
    const gh = yield* GhClient;
    const arguments_ = [
      'api',
      'graphql',
      '--hostname',
      target.host,
      '-f',
      `query=${reviewThreadsQuery}`,
      '-f',
      `owner=${target.owner}`,
      '-f',
      `name=${target.name}`,
      '-F',
      `number=${target.number}`,
    ];
    if (cursor !== null) {
      arguments_.push('-f', `cursor=${cursor}`);
    }
    const result = yield* gh.run(ghRequest(arguments_));
    const response = yield* decodeGhJson(ReviewThreadsResponse, result, arguments_);
    const errors = graphqlErrors(response);
    if (errors.length > 0) {
      return yield* GhGraphqlError.make({ messages: Array.from(errors) });
    }
    const connection = response.data?.repository?.pullRequest?.reviewThreads;
    if (connection === undefined) {
      return yield* SnapshotInvariantError.make({
        detail: 'GitHub did not return the requested pull request review thread connection.',
      });
    }
    return connection;
  },
);

const loadReviewThreads = Effect.fn('Loader.loadReviewThreads')(function* loadReviewThreads(
  target: PullRequestTarget,
) {
  const threads: GraphqlThread[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const connection: {
      readonly nodes: readonly GraphqlThread[];
      readonly pageInfo: { readonly endCursor: string | null; readonly hasNextPage: boolean };
    } = yield* loadReviewThreadPage(target, cursor);
    threads.push(...connection.nodes);
    const { endCursor, hasNextPage: nextPage } = connection.pageInfo;
    hasNextPage = nextPage;
    cursor = endCursor;
    if (hasNextPage && cursor === null) {
      return yield* SnapshotInvariantError.make({
        detail: 'GitHub marked the review thread page as incomplete but did not return a cursor.',
      });
    }
    if (hasNextPage && cursor !== null) {
      if (seenCursors.has(cursor)) {
        return yield* SnapshotInvariantError.make({
          detail: 'GitHub repeated a review thread page cursor.',
        });
      }
      seenCursors.add(cursor);
    }
  }
  return threads;
});

export const loadReviewThreadById = Effect.fn('Loader.loadReviewThreadById')(
  function* loadReviewThreadById(target: PullRequestTarget, threadId: string) {
    const gh = yield* GhClient;
    const arguments_ = [
      'api',
      'graphql',
      '--hostname',
      target.host,
      '-f',
      `query=${reviewThreadNodeQuery}`,
      '-f',
      `threadId=${threadId}`,
    ];
    const result = yield* gh.run(ghRequest(arguments_));
    const response = yield* decodeGhJson(ReviewThreadNodeResponse, result, arguments_);
    const errors = response.errors?.map(({ message }) => message) ?? [];
    if (errors.length > 0) {
      return yield* GhGraphqlError.make({ messages: Array.from(errors) });
    }
    if (response.data?.node === undefined || response.data.node === null) {
      return yield* SnapshotInvariantError.make({
        detail: `GitHub did not return review thread ${threadId}.`,
      });
    }
    return response.data.node;
  },
);

const normalizeCheck = (check: CheckRollup): GhCheck => {
  if (check.__typename === 'StatusContext') {
    return {
      bucket: checkBucket(check.state),
      completedAt: '',
      event: '',
      link: check.targetUrl ?? '',
      name: check.context,
      startedAt: check.startedAt ?? '',
      state: check.state,
      workflow: '',
    };
  }
  const state = check.conclusion === '' ? check.status : check.conclusion;
  return {
    bucket: checkBucket(state),
    completedAt: check.completedAt ?? '',
    event: '',
    link: check.detailsUrl ?? '',
    name: check.name,
    startedAt: check.startedAt ?? '',
    state,
    workflow: check.workflowName,
  };
};

const loadChecks = Effect.fn('Loader.loadChecks')(function* loadChecks(target: PullRequestTarget) {
  const gh = yield* GhClient;
  const arguments_ = [
    'pr',
    'view',
    String(target.number),
    '--repo',
    repositorySelector(target),
    '--json',
    'statusCheckRollup',
  ];
  const result = yield* gh.run(ghRequest(arguments_));
  const view = yield* decodeGhJson(CheckRollupView, result, arguments_);
  return view.statusCheckRollup.map(normalizeCheck);
});

const baseEndpoint = (target: PullRequestTarget): string => `repos/${target.owner}/${target.name}`;

const loadThreadParts = Effect.fn('Loader.loadThreadParts')(function* loadThreadParts(
  target: PullRequestTarget,
) {
  return yield* Effect.all(
    {
      graphqlThreads: loadReviewThreads(target),
      reviewComments: loadRestPages(
        target,
        `${baseEndpoint(target)}/pulls/${target.number}/comments?per_page=100`,
        RawReviewComment,
      ),
    },
    { concurrency: 'unbounded' },
  );
});

const loadIssueComments = (target: PullRequestTarget) =>
  loadRestPages(
    target,
    `${baseEndpoint(target)}/issues/${target.number}/comments?per_page=100`,
    RawIssueComment,
  );

const loadReviews = (target: PullRequestTarget) =>
  loadRestPages(
    target,
    `${baseEndpoint(target)}/pulls/${target.number}/reviews?per_page=100`,
    RawReview,
  );

interface StableRead<T> {
  readonly pullRequest: PullRequestContext['pullRequest'];
  readonly value: T;
}

const MAXIMUM_SNAPSHOT_READS = 3;

const canonicalJson = (value: object): string => {
  const keys = new Set<string>();
  JSON.stringify(value, (key: string, nested: unknown): unknown => {
    keys.add(key);
    return nested;
  });
  return JSON.stringify(value, Array.from(keys).toSorted());
};

const loadConsistently = <A extends object, E, R>(
  context: PullRequestContext,
  load: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* loadConsistentlyGen() {
    let before = context.pullRequest;
    let previousFingerprint: string | null = null;
    let reads = 0;
    for (;;) {
      const value = yield* load;
      const after = yield* reloadPullRequest(context.target);
      reads += 1;
      const headIsStable = before.headRefOid === after.headRefOid;
      if (headIsStable) {
        const fingerprint = canonicalJson(value);
        if (fingerprint === previousFingerprint) {
          return { pullRequest: after, value };
        }
        previousFingerprint = fingerprint;
      } else {
        previousFingerprint = null;
      }
      if (reads === MAXIMUM_SNAPSHOT_READS) {
        if (!headIsStable) {
          return yield* PullRequestChangedError.make({
            after: after.headRefOid,
            before: before.headRefOid,
          });
        }
        return yield* SnapshotChangedError.make({ attempts: MAXIMUM_SNAPSHOT_READS });
      }
      before = after;
    }
  });

const stableContext = <T>(context: PullRequestContext, stable: StableRead<T>) => ({
  pullRequest: stable.pullRequest,
  target: context.target,
});

export const loadThreadSnapshot = Effect.fn('Loader.loadThreadSnapshot')(
  function* loadThreadSnapshot(context: PullRequestContext) {
    const stable = yield* loadConsistently(context, loadThreadParts(context.target));
    return yield* composeThreadSnapshot(stableContext(context, stable), stable.value);
  },
);

export const loadConversationSnapshot = Effect.fn('Loader.loadConversationSnapshot')(
  function* loadConversationSnapshot(context: PullRequestContext) {
    const loaded = Effect.all(
      {
        issueComments: loadIssueComments(context.target),
        reviews: loadReviews(context.target),
        threadParts: loadThreadParts(context.target),
      },
      { concurrency: 'unbounded' },
    );
    const stable = yield* loadConsistently(context, loaded);
    const parts: ConversationParts = { ...stable.value, ...stable.value.threadParts };
    return yield* composeConversationSnapshot(stableContext(context, stable), parts);
  },
);

export const loadGreptileSnapshot = Effect.fn('Loader.loadGreptileSnapshot')(
  function* loadGreptileSnapshot(context: PullRequestContext) {
    const loaded = Effect.all(
      {
        issueComments: loadIssueComments(context.target),
        threadParts: loadThreadParts(context.target),
      },
      { concurrency: 'unbounded' },
    );
    const stable = yield* loadConsistently(context, loaded);
    return yield* composeGreptileSnapshot(stableContext(context, stable), {
      ...stable.value,
      ...stable.value.threadParts,
    });
  },
);

export const loadAikidoSnapshot = Effect.fn('Loader.loadAikidoSnapshot')(
  function* loadAikidoSnapshot(context: PullRequestContext) {
    const loaded = Effect.all(
      { checks: loadChecks(context.target), threadParts: loadThreadParts(context.target) },
      { concurrency: 'unbounded' },
    );
    const stable = yield* loadConsistently(context, loaded);
    return yield* composeAikidoSnapshot(stableContext(context, stable), {
      ...stable.value,
      ...stable.value.threadParts,
    });
  },
);

export const loadSnapshot = Effect.fn('Loader.loadSnapshot')(function* loadSnapshot(
  context: PullRequestContext,
) {
  const loaded = Effect.all(
    {
      checks: loadChecks(context.target),
      issueComments: loadIssueComments(context.target),
      reviews: loadReviews(context.target),
      threadParts: loadThreadParts(context.target),
    },
    { concurrency: 'unbounded' },
  );
  const stable = yield* loadConsistently(context, loaded);
  const parts: SnapshotParts = { ...stable.value, ...stable.value.threadParts };
  return yield* composeSnapshot(context.target, stable.pullRequest, parts);
});
