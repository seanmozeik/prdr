import { describe, expect, it } from 'bun:test';

import { Effect, Layer, Schema } from 'effect';

import { GhClient, type GhRequest, type GhResult } from '../src/github/client';
import { GhCommandError } from '../src/github/errors';
import { discoverTarget } from '../src/github/target-discovery';

const jsonResult = (value: unknown): GhResult => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(value),
});

const repository = {
  defaultBranchRef: { name: 'main' },
  isArchived: false,
  name: 'chronic-care-chat',
  nameWithOwner: 'SharedGenes/chronic-care-chat',
  url: 'https://github.com/SharedGenes/chronic-care-chat',
  viewerPermission: 'WRITE',
  visibility: 'PRIVATE',
};

const commandError = GhCommandError.make({
  arguments: ['repo', 'view', 'wrong/chronic-care-chat'],
  exitCode: 1,
  stderr: 'repository not found',
  stdout: '',
});

const runWithResponses = <A, E>(
  effect: Effect.Effect<A, E, GhClient>,
  responses: readonly (GhCommandError | GhResult)[],
): { readonly captured: GhRequest[]; readonly result: Promise<A> } => {
  const captured: GhRequest[] = [];
  const remaining = Array.from(responses);
  const run = Effect.fn('TestTargetDiscovery.run')(function* testTargetDiscoveryRun(
    request: GhRequest,
  ) {
    captured.push(request);
    const response = remaining.shift();
    if (response === undefined) {
      return yield* Effect.die(new Error(`Unexpected gh request: ${request.arguments.join(' ')}`));
    }
    if ('arguments' in response) {
      return yield* response;
    }
    return response;
  });
  return {
    captured,
    result: Effect.runPromise(effect.pipe(Effect.provide(Layer.succeed(GhClient, { run })))),
  };
};

const repositorySearchResponse = (hasNextPage = false) =>
  jsonResult({
    data: {
      search: {
        nodes: [repository],
        pageInfo: { endCursor: hasNextPage ? 'repository-cursor' : null, hasNextPage },
        repositoryCount: 1,
      },
    },
  });

describe('repository target discovery', () => {
  it('resolves a private repository from the selected worktree', async () => {
    const directory = '/worktrees/chronic-care-chat';
    const { captured, result } = runWithResponses(discoverTarget({ directory, mode: 'worktree' }), [
      jsonResult(repository),
    ]);

    const target = await result;
    expect(target).toMatchObject({
      kind: 'repository',
      repository: {
        permission: 'write',
        repo: 'SharedGenes/chronic-care-chat',
        visibility: 'private',
      },
      source: 'worktree',
    });
    expect(captured[0]?.cwd).toBe(directory);
    expect(captured[0]?.arguments.slice(0, 2)).toEqual(['repo', 'view']);
  });

  it('searches repositories visible to the logged-in account by name', async () => {
    const { captured, result } = runWithResponses(
      discoverTarget({ cursor: '', limit: 10, mode: 'repository', query: 'chronic-care-chat' }),
      [repositorySearchResponse()],
    );

    const target = await result;
    expect(target).toMatchObject({
      items: [{ repo: 'SharedGenes/chronic-care-chat', visibility: 'private' }],
      kind: 'repository-candidates',
      total: 1,
    });
    const input = Schema.decodeUnknownSync(
      Schema.Struct({ variables: Schema.Struct({ query: Schema.String }) }),
    )(JSON.parse(captured[0]?.input ?? '{}'));
    expect(input.variables.query).toBe('chronic-care-chat in:name');
  });

  it('recovers from a wrong owner by searching the repository-name part', async () => {
    const { captured, result } = runWithResponses(
      discoverTarget({
        cursor: '',
        limit: 10,
        mode: 'repository',
        query: 'wrong/chronic-care-chat',
      }),
      [commandError, repositorySearchResponse()],
    );

    const target = await result;
    expect(target).toMatchObject({
      items: [{ repo: 'SharedGenes/chronic-care-chat' }],
      kind: 'repository-candidates',
    });
    expect(captured).toHaveLength(2);
    expect(captured[0]?.arguments.slice(0, 3)).toEqual(['repo', 'view', 'wrong/chronic-care-chat']);
  });

  it('rejects repository pagination without a usable next cursor', async () => {
    const { result } = runWithResponses(
      Effect.flip(
        discoverTarget({ cursor: '', limit: 10, mode: 'repository', query: 'chronic-care-chat' }),
      ),
      [
        jsonResult({
          data: {
            search: {
              nodes: [repository],
              pageInfo: { endCursor: null, hasNextPage: true },
              repositoryCount: 2,
            },
          },
        }),
      ],
    );

    const error = await result;

    expect(error._tag).toBe('TargetResolutionError');
    expect(error.message).toContain('usable next cursor');
  });
});

describe('pull request target discovery', () => {
  it('returns exact base and head repository identities for a branch', async () => {
    const { captured, result } = runWithResponses(
      discoverTarget({
        branch: 'feature/name',
        cursor: '',
        limit: 10,
        mode: 'branch',
        state: 'open',
      }),
      [
        jsonResult({
          data: {
            search: {
              issueCount: 1,
              nodes: [
                {
                  baseRefName: 'main',
                  headRefName: 'feature/name',
                  headRefOid: '0123456789abcdef0123456789abcdef01234567',
                  headRepository: {
                    nameWithOwner: 'contributor/chronic-care-chat',
                    url: 'https://github.com/contributor/chronic-care-chat',
                  },
                  headRepositoryOwner: { login: 'contributor' },
                  isDraft: true,
                  number: 42,
                  repository: {
                    nameWithOwner: 'SharedGenes/chronic-care-chat',
                    url: 'https://github.com/SharedGenes/chronic-care-chat',
                  },
                  state: 'OPEN',
                  title: 'Feature',
                  url: 'https://github.com/SharedGenes/chronic-care-chat/pull/42',
                },
              ],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        }),
      ],
    );

    const target = await result;
    expect(target).toMatchObject({
      items: [
        {
          base: { branch: 'main', repo: 'SharedGenes/chronic-care-chat' },
          head: { branch: 'feature/name', repo: 'contributor/chronic-care-chat' },
        },
      ],
      kind: 'pull-request-candidates',
    });
    expect(captured[0]?.arguments).toEqual(['api', 'graphql', '--input', '-']);
  });

  it('rejects pull request pagination without a usable next cursor', async () => {
    const { result } = runWithResponses(
      Effect.flip(
        discoverTarget({
          branch: 'feature/name',
          cursor: '',
          limit: 10,
          mode: 'branch',
          state: 'open',
        }),
      ),
      [
        jsonResult({
          data: {
            search: { issueCount: 1, nodes: [], pageInfo: { endCursor: null, hasNextPage: true } },
          },
        }),
      ],
    );

    const error = await result;

    expect(error._tag).toBe('TargetResolutionError');
    expect(error.message).toContain('usable next cursor');
  });
});
