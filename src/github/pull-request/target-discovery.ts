import { Buffer } from 'node:buffer';

import { Effect, Schema } from 'effect';

import { PullRequestInputError } from '../../domain/pull-request-errors';
import { decodeGhJson, encodeGhJson, GhClient, ghRequest } from '../client';
import { GhGraphqlError, TargetResolutionError } from '../errors';

const PullRequestCandidate = Schema.Struct({
  baseRefName: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  headRepository: Schema.NullOr(
    Schema.Struct({ nameWithOwner: Schema.String, url: Schema.String }),
  ),
  headRepositoryOwner: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  isDraft: Schema.Boolean,
  number: Schema.Int,
  repository: Schema.Struct({ nameWithOwner: Schema.String, url: Schema.String }),
  state: Schema.String,
  title: Schema.String,
  url: Schema.String,
});

const PullRequestSearchResponse = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        search: Schema.Struct({
          issueCount: Schema.Int,
          nodes: Schema.Array(PullRequestCandidate),
          pageInfo: Schema.Struct({
            endCursor: Schema.NullOr(Schema.String),
            hasNextPage: Schema.Boolean,
          }),
        }),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

const PullRequestCursor = Schema.Struct({
  after: Schema.String,
  branch: Schema.String,
  state: Schema.Literals(['all', 'open']),
  version: Schema.Literal(1),
});

const GraphqlRequest = Schema.Struct({ query: Schema.String, variables: Schema.JsonObject });
const decodePullRequestCursorJson = Schema.decodeEffect(Schema.fromJsonString(PullRequestCursor));

export const pullRequestTargetSearchQuery = `
query PrdrPullRequestTargetSearch($query: String!, $first: Int!, $after: String) {
  search(query: $query, type: ISSUE, first: $first, after: $after) {
    issueCount
    pageInfo { endCursor hasNextPage }
    nodes {
      ... on PullRequest {
        number url title state isDraft baseRefName headRefName headRefOid
        headRepository { nameWithOwner url }
        headRepositoryOwner { login }
        repository { nameWithOwner url }
      }
    }
  }
}`;

const validateInput = Effect.fn('PullRequestTarget.validateInput')(function* validateInput(
  branch: string,
  limit: number,
) {
  if (!/^[^\s"']+$/u.test(branch)) {
    return yield* PullRequestInputError.make({
      detail: '--branch must be one Git branch name without spaces or quotes.',
      operation: 'target',
    });
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    return yield* PullRequestInputError.make({
      detail: '--limit must be a safe integer from 1 through 20.',
      operation: 'target',
    });
  }
  return yield* Effect.void;
});

const decodeCursor = Effect.fn('PullRequestTarget.decodeCursor')(function* decodeCursor(
  raw: string,
  branch: string,
  state: 'all' | 'open',
) {
  if (raw === '') {
    return null;
  }
  const json = yield* Effect.try({
    catch: () =>
      PullRequestInputError.make({ detail: 'The target cursor is invalid.', operation: 'target' }),
    try: () => Buffer.from(raw, 'base64url').toString('utf8'),
  });
  const cursor = yield* decodePullRequestCursorJson(json).pipe(
    Effect.mapError(() =>
      PullRequestInputError.make({ detail: 'The target cursor is invalid.', operation: 'target' }),
    ),
  );
  if (cursor.branch !== branch || cursor.state !== state) {
    return yield* PullRequestInputError.make({
      detail: 'The target cursor belongs to a different branch or state search.',
      operation: 'target',
    });
  }
  return cursor.after;
});

export const searchPullRequestTargets = Effect.fn('PullRequestTarget.search')(
  function* searchPullRequestTargets(
    branch: string,
    state: 'all' | 'open',
    cursor: string,
    limit: number,
  ) {
    yield* validateInput(branch, limit);
    const after = yield* decodeCursor(cursor, branch, state);
    const filter = `is:pr head:${branch}${state === 'open' ? ' state:open' : ''}`;
    const gh = yield* GhClient;
    const arguments_ = ['api', 'graphql', '--input', '-'];
    const input = yield* encodeGhJson(
      GraphqlRequest,
      { query: pullRequestTargetSearchQuery, variables: { after, first: limit, query: filter } },
      arguments_,
    );
    const result = yield* gh.run(ghRequest(arguments_, input));
    const response = yield* decodeGhJson(PullRequestSearchResponse, result, arguments_);
    const errors = response.errors?.map(({ message }) => message) ?? [];
    if (errors.length > 0) {
      return yield* GhGraphqlError.make({ messages: Array.from(errors) });
    }
    const search = response.data?.search;
    if (search === undefined) {
      return yield* TargetResolutionError.make({
        detail: 'GitHub did not return pull request candidates.',
      });
    }
    if (
      search.pageInfo.hasNextPage &&
      (search.pageInfo.endCursor === null || search.pageInfo.endCursor === after)
    ) {
      return yield* TargetResolutionError.make({
        detail:
          'GitHub reported more pull request candidates without a usable next cursor. Restart the target search.',
      });
    }
    const nextCursor =
      search.pageInfo.hasNextPage && search.pageInfo.endCursor !== null
        ? Buffer.from(
            JSON.stringify({ after: search.pageInfo.endCursor, branch, state, version: 1 }),
            'utf8',
          ).toString('base64url')
        : null;
    return {
      branch,
      guidance:
        'These pull requests are visible to the account logged in through gh. Copy base.repo and head.repo exactly. Do not infer either owner from a branch author.',
      hasMore: search.pageInfo.hasNextPage,
      items: search.nodes.map((item) => ({
        base: { branch: item.baseRefName, repo: item.repository.nameWithOwner },
        head: {
          branch: item.headRefName,
          owner: item.headRepositoryOwner?.login ?? null,
          repo: item.headRepository?.nameWithOwner ?? null,
          sha: item.headRefOid,
        },
        number: item.number,
        readiness: item.isDraft ? ('draft' as const) : ('ready' as const),
        state: item.state.toLowerCase(),
        title: item.title,
        url: item.url,
      })),
      kind: 'pull-request-candidates' as const,
      nextCursor,
      state,
      total: search.issueCount,
    };
  },
);
