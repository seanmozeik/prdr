import { Buffer } from 'node:buffer';

import { Clock, Effect, Schema } from 'effect';

import { PullRequestPaginationError } from '../domain/errors';
import type { RepositoryTarget } from '../domain/model';
import {
  type PullRequestListFilters,
  type PullRequestListOptions,
  type PullRequestListPage,
  type PullRequestListRecord,
  summarizePullRequest,
} from '../domain/pull-requests';
import { decodeGhJson, GhClient, ghRequest } from './client';
import { GhGraphqlError, TargetResolutionError } from './errors';
import { pullRequestsQuery } from './queries';
import { resolveRepository } from './target';

const CURSOR_VERSION = 1 as const;
const MAXIMUM_CURSOR_LENGTH = 8192;
const MAXIMUM_PAGE_SIZE = 100;
export const DEFAULT_PULL_REQUEST_PAGE_SIZE = 30;

const NullableString = Schema.NullOr(Schema.String);
const Count = Schema.Struct({ totalCount: Schema.Int });
const RawPullRequest = Schema.Struct({
  author: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  baseRefName: Schema.String,
  body: Schema.String,
  comments: Count,
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: Schema.NullOr(Schema.Struct({ state: Schema.String })),
        }),
      }),
    ),
  }),
  createdAt: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  headRepositoryOwner: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  isDraft: Schema.Boolean,
  mergeStateStatus: Schema.String,
  number: Schema.Int,
  reviewDecision: NullableString,
  reviewThreads: Count,
  state: Schema.String,
  title: Schema.String,
  updatedAt: Schema.String,
  url: Schema.String,
});
type RawPullRequest = typeof RawPullRequest.Type;

const PullRequestListResponse = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({
            pullRequests: Schema.Struct({
              nodes: Schema.Array(RawPullRequest),
              pageInfo: Schema.Struct({ endCursor: NullableString, hasNextPage: Schema.Boolean }),
              totalCount: Schema.Int,
            }),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

const PullRequestCursor = Schema.Struct({
  base: Schema.String,
  branch: Schema.String,
  endCursor: Schema.NonEmptyString,
  host: Schema.NonEmptyString,
  nameWithOwner: Schema.NonEmptyString,
  state: Schema.Literals(['all', 'closed', 'merged', 'open']),
  version: Schema.Literal(CURSOR_VERSION),
});
type PullRequestCursor = typeof PullRequestCursor.Type;

const paginationError = (detail: string): PullRequestPaginationError =>
  PullRequestPaginationError.make({ detail });

const decodeCursor = Effect.fn('PullRequests.decodeCursor')(function* decodeCursor(raw: string) {
  if (raw.length === 0) {
    return null;
  }
  if (raw.length > MAXIMUM_CURSOR_LENGTH) {
    return yield* paginationError('The pull request cursor is too long. Start again without it.');
  }
  const json = yield* Effect.try({
    catch: () => paginationError('The pull request cursor is invalid. Start again without it.'),
    try: () => Buffer.from(raw, 'base64url').toString('utf8'),
  });
  return yield* Schema.decodeEffect(Schema.fromJsonString(PullRequestCursor))(json).pipe(
    Effect.mapError(() =>
      paginationError('The pull request cursor is invalid. Start again without it.'),
    ),
  );
});

const encodeCursor = (cursor: PullRequestCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const cursorMatches = (
  cursor: PullRequestCursor,
  target: RepositoryTarget,
  filters: PullRequestListFilters,
): boolean =>
  cursor.base === filters.base &&
  cursor.branch === filters.branch &&
  cursor.host === target.host &&
  cursor.nameWithOwner === target.nameWithOwner &&
  cursor.state === filters.state;

const toRecord = (pullRequest: RawPullRequest): PullRequestListRecord => ({
  author: pullRequest.author?.login ?? '[deleted]',
  baseRefName: pullRequest.baseRefName,
  body: pullRequest.body,
  checkStatus: pullRequest.commits.nodes.at(-1)?.commit.statusCheckRollup?.state ?? null,
  commentCount: pullRequest.comments.totalCount,
  createdAt: pullRequest.createdAt,
  headRefName: pullRequest.headRefName,
  headRefOid: pullRequest.headRefOid,
  headRepositoryOwner: pullRequest.headRepositoryOwner?.login ?? null,
  isDraft: pullRequest.isDraft,
  mergeStateStatus: pullRequest.mergeStateStatus,
  number: pullRequest.number,
  reviewDecision: pullRequest.reviewDecision,
  reviewThreadCount: pullRequest.reviewThreads.totalCount,
  state: pullRequest.state,
  title: pullRequest.title,
  updatedAt: pullRequest.updatedAt,
  url: pullRequest.url,
});

const graphqlStates = { closed: 'CLOSED', merged: 'MERGED', open: 'OPEN' } as const;

export const listPullRequests = Effect.fn('PullRequests.list')(function* listPullRequests(
  repository: string,
  filters: PullRequestListFilters,
  options: PullRequestListOptions,
) {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
    return yield* paginationError('--limit must be a positive safe integer.');
  }
  if (options.limit > MAXIMUM_PAGE_SIZE) {
    return yield* paginationError(`--limit must not exceed ${MAXIMUM_PAGE_SIZE}.`);
  }
  const cursor = yield* decodeCursor(options.cursor);
  const target = yield* resolveRepository(repository);
  if (cursor !== null && !cursorMatches(cursor, target, filters)) {
    return yield* paginationError(
      'The pull request cursor does not match this repository or filter set. Start again without it.',
    );
  }

  const gh = yield* GhClient;
  const arguments_ = [
    'api',
    'graphql',
    '--hostname',
    target.host,
    '-f',
    `query=${pullRequestsQuery}`,
    '-f',
    `owner=${target.owner}`,
    '-f',
    `name=${target.name}`,
    '-F',
    `first=${options.limit}`,
  ];
  if (cursor !== null) {
    arguments_.push('-f', `cursor=${cursor.endCursor}`);
  }
  if (filters.state !== 'all') {
    arguments_.push('-f', `states[]=${graphqlStates[filters.state]}`);
  }
  if (filters.base.length > 0) {
    arguments_.push('-f', `base=${filters.base}`);
  }
  if (filters.branch.length > 0) {
    arguments_.push('-f', `head=${filters.branch}`);
  }

  const result = yield* gh.run(ghRequest(arguments_));
  const response = yield* decodeGhJson(PullRequestListResponse, result, arguments_);
  const errors = response.errors?.map(({ message }) => message) ?? [];
  if (errors.length > 0) {
    return yield* GhGraphqlError.make({ messages: Array.from(errors) });
  }
  const connection = response.data?.repository?.pullRequests;
  if (connection === undefined) {
    return yield* TargetResolutionError.make({
      detail: `GitHub did not return repository ${target.nameWithOwner}.`,
    });
  }
  if (connection.pageInfo.hasNextPage && connection.pageInfo.endCursor === null) {
    return yield* paginationError(
      'GitHub marked the pull request page as incomplete but did not return a cursor.',
    );
  }

  const nextCursor =
    connection.pageInfo.hasNextPage && connection.pageInfo.endCursor !== null
      ? encodeCursor({
          ...filters,
          endCursor: connection.pageInfo.endCursor,
          host: target.host,
          nameWithOwner: target.nameWithOwner,
          version: CURSOR_VERSION,
        })
      : null;
  const nowMilliseconds = yield* Clock.currentTimeMillis;
  return {
    hasMore: connection.pageInfo.hasNextPage,
    items: connection.nodes.map((item) => summarizePullRequest(toRecord(item), nowMilliseconds)),
    limit: options.limit,
    nextCursor,
    target,
    total: connection.totalCount,
  } satisfies PullRequestListPage;
});
