import { Buffer } from 'node:buffer';
import path from 'node:path';

import { Effect, Schema } from 'effect';

import { PullRequestInputError } from '../domain/pull-request-errors';
import { decodeGhJson, encodeGhJson, GhClient, ghRequest, ghRequestInDirectory } from './client';
import { GhGraphqlError, TargetResolutionError, type GhCommandError } from './errors';

const RepositoryIdentity = Schema.Struct({
  defaultBranchRef: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  isArchived: Schema.Boolean,
  name: Schema.String,
  nameWithOwner: Schema.String,
  url: Schema.String,
  viewerPermission: Schema.NullOr(Schema.String),
  visibility: Schema.String,
});

const RepositorySearchResponse = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        search: Schema.Struct({
          nodes: Schema.Array(RepositoryIdentity),
          pageInfo: Schema.Struct({
            endCursor: Schema.NullOr(Schema.String),
            hasNextPage: Schema.Boolean,
          }),
          repositoryCount: Schema.Int,
        }),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

const RepositoryCursor = Schema.Struct({
  after: Schema.String,
  name: Schema.String,
  version: Schema.Literal(1),
});

const GraphqlRequest = Schema.Struct({ query: Schema.String, variables: Schema.JsonObject });
const decodeRepositoryCursorJson = Schema.decodeEffect(Schema.fromJsonString(RepositoryCursor));

export const repositoryTargetSearchQuery = `
query PrdrRepositoryTargetSearch($query: String!, $first: Int!, $after: String) {
  search(query: $query, type: REPOSITORY, first: $first, after: $after) {
    repositoryCount
    pageInfo { endCursor hasNextPage }
    nodes {
      ... on Repository {
        name nameWithOwner url visibility isArchived viewerPermission
        defaultBranchRef { name }
      }
    }
  }
}`;

const repositoryResult = (view: typeof RepositoryIdentity.Type) => ({
  archived: view.isArchived,
  defaultBranch: view.defaultBranchRef?.name ?? null,
  name: view.name,
  owner: view.nameWithOwner.split('/')[0] ?? '',
  permission: view.viewerPermission?.toLowerCase() ?? null,
  repo: view.nameWithOwner,
  url: view.url,
  visibility: view.visibility.toLowerCase(),
});

const validateLimit = Effect.fn('RepositoryTarget.validateLimit')(function* validateLimit(
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    return yield* PullRequestInputError.make({
      detail: '--limit must be a safe integer from 1 through 20.',
      operation: 'target',
    });
  }
  return yield* Effect.void;
});

const discoverRepository = Effect.fn('RepositoryTarget.resolve')(function* discoverRepository(
  hint: string,
  directory: string,
) {
  const gh = yield* GhClient;
  const arguments_ = ['repo', 'view'];
  if (hint !== '') {
    arguments_.push(hint);
  }
  arguments_.push(
    '--json',
    'name,nameWithOwner,url,defaultBranchRef,isArchived,viewerPermission,visibility',
  );
  const request =
    directory === '' ? ghRequest(arguments_) : ghRequestInDirectory(arguments_, directory);
  const result = yield* gh.run(request);
  return repositoryResult(yield* decodeGhJson(RepositoryIdentity, result, arguments_));
});

const repositoryNameFromUrl = Effect.fn('RepositoryTarget.nameFromUrl')(
  function* repositoryNameFromUrl(value: string) {
    const url = yield* Effect.try({
      catch: () =>
        PullRequestInputError.make({
          detail: 'The repository query URL is invalid.',
          operation: 'target',
        }),
      try: () => new URL(value),
    });
    return url.pathname.split('/').findLast((segment) => segment !== '') ?? '';
  },
);

const repositoryNameFromQuery = Effect.fn('RepositoryTarget.nameFromQuery')(
  function* repositoryNameFromQuery(query: string) {
    const trimmed = query.trim();
    const candidate = /^https?:\/\//iu.test(trimmed)
      ? yield* repositoryNameFromUrl(trimmed)
      : (trimmed.split('/').at(-1) ?? '');
    const name = candidate.endsWith('.git') ? candidate.slice(0, -4) : candidate;
    if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
      return yield* PullRequestInputError.make({
        detail:
          '--query must contain a repository name, URL, OWNER/REPOSITORY, or HOST/OWNER/REPOSITORY.',
        operation: 'target',
      });
    }
    return name;
  },
);

const decodeCursor = Effect.fn('RepositoryTarget.decodeCursor')(function* decodeCursor(
  raw: string,
  name: string,
) {
  if (raw === '') {
    return null;
  }
  const json = yield* Effect.try({
    catch: () =>
      PullRequestInputError.make({ detail: 'The target cursor is invalid.', operation: 'target' }),
    try: () => Buffer.from(raw, 'base64url').toString('utf8'),
  });
  const cursor = yield* decodeRepositoryCursorJson(json).pipe(
    Effect.mapError(() =>
      PullRequestInputError.make({ detail: 'The target cursor is invalid.', operation: 'target' }),
    ),
  );
  if (cursor.name !== name) {
    return yield* PullRequestInputError.make({
      detail: 'The target cursor belongs to a different repository search.',
      operation: 'target',
    });
  }
  return cursor.after;
});

const searchRepositories = Effect.fn('RepositoryTarget.search')(function* searchRepositories(
  query: string,
  cursor: string,
  limit: number,
) {
  yield* validateLimit(limit);
  const name = yield* repositoryNameFromQuery(query);
  const after = yield* decodeCursor(cursor, name);
  const gh = yield* GhClient;
  const arguments_ = ['api', 'graphql', '--input', '-'];
  const input = yield* encodeGhJson(
    GraphqlRequest,
    {
      query: repositoryTargetSearchQuery,
      variables: { after, first: limit, query: `${name} in:name` },
    },
    arguments_,
  );
  const result = yield* gh.run(ghRequest(arguments_, input));
  const response = yield* decodeGhJson(RepositorySearchResponse, result, arguments_);
  const errors = response.errors?.map(({ message }) => message) ?? [];
  if (errors.length > 0) {
    return yield* GhGraphqlError.make({ messages: Array.from(errors) });
  }
  const search = response.data?.search;
  if (search === undefined) {
    return yield* TargetResolutionError.make({
      detail: 'GitHub did not return repository candidates.',
    });
  }
  if (
    search.pageInfo.hasNextPage &&
    (search.pageInfo.endCursor === null || search.pageInfo.endCursor === after)
  ) {
    return yield* TargetResolutionError.make({
      detail:
        'GitHub reported more repository candidates without a usable next cursor. Restart the target search.',
    });
  }
  const nextCursor =
    search.pageInfo.hasNextPage && search.pageInfo.endCursor !== null
      ? Buffer.from(
          JSON.stringify({ after: search.pageInfo.endCursor, name, version: 1 }),
          'utf8',
        ).toString('base64url')
      : null;
  return {
    guidance:
      'These repositories are visible to the account logged in through gh. Copy repo exactly from the selected item. Prefer an exact name, a private or internal match, and sufficient permission. Do not replace owner with the logged-in user.',
    hasMore: search.pageInfo.hasNextPage,
    items: search.nodes.map(repositoryResult),
    kind: 'repository-candidates' as const,
    nextCursor,
    query: name,
    total: search.repositoryCount,
  };
});

const looksExact = (query: string): boolean =>
  /^https?:\/\//iu.test(query) || query.split('/').length === 2 || query.split('/').length === 3;

export const resolveRepositoryTarget = Effect.fn('RepositoryTarget.discover')(
  function* resolveRepositoryTarget(query: string, cursor: string, limit: number) {
    if (cursor === '' && looksExact(query)) {
      const exact = yield* discoverRepository(query, '').pipe(
        Effect.map((repository) => ({ repository })),
        Effect.catchTag('GhCommandError', (_error: GhCommandError) =>
          Effect.succeed({ repository: null }),
        ),
      );
      if (exact.repository !== null) {
        return {
          guidance:
            'GitHub resolved this exact repository through the account logged in to gh. Copy repo exactly. Do not substitute another owner.',
          kind: 'repository' as const,
          repository: exact.repository,
          source: 'query' as const,
        };
      }
    }
    return yield* searchRepositories(query, cursor, limit);
  },
);

export const resolveWorktreeTarget = Effect.fn('RepositoryTarget.worktree')(
  function* resolveWorktreeTarget(directory: string) {
    if (directory !== '' && !path.isAbsolute(directory)) {
      return yield* PullRequestInputError.make({
        detail: '--directory must be an absolute worktree path.',
        operation: 'target',
      });
    }
    const repository = yield* discoverRepository('', directory).pipe(
      Effect.catchTag('GhCommandError', (error: GhCommandError) =>
        TargetResolutionError.make({
          detail: `GitHub could not resolve a repository from this worktree. Use target --mode repository --query REPOSITORY_NAME, or target --mode branch --branch HEAD_BRANCH. ${error.message}`,
        }),
      ),
    );
    return {
      guidance:
        'GitHub resolved this repository from the selected worktree and the account logged in to gh. Copy repo exactly. The repository owner can differ from the logged-in user.',
      kind: 'repository' as const,
      repository,
      source: 'worktree' as const,
    };
  },
);
