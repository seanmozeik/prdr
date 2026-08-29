import { describe, expect, it } from 'bun:test';

import { Effect, Layer, Schema } from 'effect';

import type { PullRequestTarget } from '../src/domain/model';
import { GhClient, type GhRequest, type GhResult } from '../src/github/client';
import { createPullRequest } from '../src/github/create-pull-request';
import { mergePullRequest, revertPullRequest } from '../src/github/pull-request/delivery';
import {
  archivePullRequest,
  setPullRequestAutoMerge,
  setPullRequestQueue,
  transitionPullRequest,
  unarchivePullRequest,
  updatePullRequestBranch,
} from '../src/github/pull-request/lifecycle';
import { managePullRequestReviewers, updatePullRequest } from '../src/github/pull-request/update';

const head = '0123456789abcdef0123456789abcdef01234567';
const stale = 'ffffffffffffffffffffffffffffffffffffffff';
const baseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const target: PullRequestTarget = {
  host: 'github.com',
  name: 'prdr',
  nameWithOwner: 'example/prdr',
  number: 42,
  owner: 'example',
};

const jsonResult = (value: unknown): GhResult => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(value),
});

const workflow = (changes: Readonly<Record<string, unknown>> = {}) => ({
  autoMergeRequest: null,
  baseRefName: 'main',
  baseRefOid: baseSha,
  body: 'Body',
  headRefName: 'feature',
  headRefOid: head,
  id: 'PR_42',
  isDraft: false,
  locked: false,
  mergeQueueEntry: null,
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  merged: false,
  number: 42,
  repository: { id: 'R_1', nameWithOwner: 'example/prdr', viewerPermission: 'ADMIN' },
  reviewDecision: null,
  state: 'OPEN',
  title: 'Title',
  url: 'https://github.com/example/prdr/pull/42',
  viewerCanClose: true,
  viewerCanDisableAutoMerge: true,
  viewerCanEnableAutoMerge: true,
  viewerCanMergeAsAdmin: true,
  viewerCanReopen: true,
  viewerCanUpdate: true,
  viewerCanUpdateBranch: true,
  ...changes,
});

const workflowResult = (value = workflow()): GhResult =>
  jsonResult({ data: { repository: { pullRequest: value } } });
const mutationResult = (): GhResult => jsonResult({ data: {} });

const runWithResponses = <A, E>(
  effect: Effect.Effect<A, E, GhClient>,
  responses: readonly GhResult[],
): { readonly captured: GhRequest[]; readonly result: Promise<A> } => {
  const captured: GhRequest[] = [];
  const remaining = Array.from(responses);
  const run = Effect.fn('TestPullRequestWorkflow.run')((request: GhRequest) =>
    Effect.sync(() => {
      captured.push(request);
      const response = remaining.shift();
      if (response === undefined) {
        throw new Error(`Unexpected gh request: ${request.arguments.join(' ')}`);
      }
      return response;
    }),
  );
  return {
    captured,
    result: Effect.runPromise(effect.pipe(Effect.provide(Layer.succeed(GhClient, { run })))),
  };
};

interface ObservedError {
  readonly tag: string;
}

const errorTag = (error: unknown): string =>
  typeof error === 'object' && error !== null && '_tag' in error && typeof error._tag === 'string'
    ? error._tag
    : 'unknown';

const observe = <A, E>(
  effect: Effect.Effect<A, E, GhClient>,
): Effect.Effect<void, ObservedError, GhClient> =>
  effect.pipe(
    Effect.asVoid,
    Effect.mapError((error): ObservedError => ({ tag: errorTag(error) })),
  );

const staleCases = [
  ['transition', () => observe(transitionPullRequest(target, 'close', stale))],
  [
    'update',
    () =>
      observe(
        updatePullRequest(target, { base: null, body: null, expectedHead: stale, title: 'New' }),
      ),
  ],
  ['update-branch', () => observe(updatePullRequestBranch(target, 'merge', stale))],
  [
    'reviewers',
    () => observe(managePullRequestReviewers(target, 'request', stale, ['octocat'], [])),
  ],
  ['auto-merge', () => observe(setPullRequestAutoMerge(target, 'enable', stale, 'squash'))],
  ['queue', () => observe(setPullRequestQueue(target, 'enqueue', stale))],
  ['merge', () => observe(mergePullRequest(target, 'squash', stale))],
  [
    'revert',
    () =>
      observe(
        revertPullRequest(target, {
          body: 'Body',
          expectedHead: stale,
          readiness: 'draft',
          title: 'Revert',
        }),
      ),
  ],
  ['archive', () => observe(archivePullRequest(target, stale))],
  ['unarchive', () => observe(unarchivePullRequest(target, stale))],
] as const;

describe('pull request workflow safety', () => {
  it.each(staleCases)('stops %s before mutation when the head is stale', async (_name, make) => {
    const { captured, result } = runWithResponses(Effect.flip(make()), [workflowResult()]);

    const error = await result;

    expect(error.tag).toBe('StaleHeadError');
    expect(captured).toHaveLength(1);
  });

  it.each([
    ['transition', () => observe(transitionPullRequest(target, 'close', head)), workflow()],
    [
      'update',
      () =>
        observe(
          updatePullRequest(target, { base: null, body: null, expectedHead: head, title: 'New' }),
        ),
      workflow(),
    ],
    ['update-branch', () => observe(updatePullRequestBranch(target, 'merge', head)), workflow()],
    [
      'auto-merge',
      () => observe(setPullRequestAutoMerge(target, 'enable', head, 'squash')),
      workflow(),
    ],
    ['queue', () => observe(setPullRequestQueue(target, 'enqueue', head)), workflow()],
    ['archive', () => observe(archivePullRequest(target, head)), workflow()],
    [
      'unarchive',
      () => observe(unarchivePullRequest(target, head)),
      workflow({ locked: true, state: 'CLOSED' }),
    ],
  ] as const)(
    'reports %s verification failure when read-back state did not change',
    async (_name, make, before) => {
      const { captured, result } = runWithResponses(Effect.flip(make()), [
        workflowResult(before),
        mutationResult(),
        workflowResult(before),
      ]);

      const error = await result;

      expect(error.tag).toBe('PullRequestVerificationError');
      expect(captured).toHaveLength(3);
    },
  );

  it('reports reviewer verification failure when the requested set did not change', async () => {
    const { result } = runWithResponses(
      Effect.flip(managePullRequestReviewers(target, 'request', head, ['octocat'], [])),
      [workflowResult(), jsonResult({}), jsonResult({ teams: [], users: [] }), workflowResult()],
    );

    const error = await result;
    expect(error._tag).toBe('PullRequestVerificationError');
  });

  it('verifies the exact auto-merge strategy after enabling it', async () => {
    const { result } = runWithResponses(
      Effect.flip(setPullRequestAutoMerge(target, 'enable', head, 'squash')),
      [
        workflowResult(),
        mutationResult(),
        workflowResult(workflow({ autoMergeRequest: { mergeMethod: 'MERGE' } })),
      ],
    );

    const error = await result;

    expect(error._tag).toBe('PullRequestVerificationError');
  });

  it('stops delivery actions that already have the requested state', async () => {
    const autoMerge = runWithResponses(
      Effect.flip(setPullRequestAutoMerge(target, 'enable', head, 'squash')),
      [workflowResult(workflow({ autoMergeRequest: { mergeMethod: 'SQUASH' } }))],
    );
    const queue = runWithResponses(Effect.flip(setPullRequestQueue(target, 'dequeue', head)), [
      workflowResult(),
    ]);

    const [autoMergeError, queueError] = await Promise.all([autoMerge.result, queue.result]);

    expect(autoMergeError._tag).toBe('StateConflictError');
    expect(queueError._tag).toBe('StateConflictError');
    expect(autoMerge.captured).toHaveLength(1);
    expect(queue.captured).toHaveLength(1);
  });

  it('uses the current GraphQL dequeue input and verifies the final queue state', async () => {
    const { captured, result } = runWithResponses(setPullRequestQueue(target, 'dequeue', head), [
      workflowResult(workflow({ mergeQueueEntry: { position: 1, state: 'QUEUED' } })),
      jsonResult({ data: { dequeuePullRequest: { mergeQueueEntry: null } } }),
      workflowResult(),
    ]);

    const value = await result;
    const request = Schema.decodeUnknownSync(
      Schema.Struct({
        query: Schema.String,
        variables: Schema.Struct({ input: Schema.Struct({ id: Schema.String }) }),
      }),
    )(JSON.parse(captured[1]?.input ?? '{}'));

    expect(value.after.mergeQueue).toBeNull();
    expect(request.query).toContain('PrdrDequeue');
    expect(request.variables.input.id).toBe('PR_42');
  });

  it.each([
    ['archive', archivePullRequest, 'archivePullRequest', 'archived'],
    ['unarchive', unarchivePullRequest, 'unarchivePullRequest', 'unarchived'],
  ] as const)(
    'verifies %s through the mutation payload and a second read',
    async (action, mutate, payloadName, archiveState) => {
      const before =
        action === 'archive' ? workflow() : workflow({ locked: true, state: 'CLOSED' });
      const after = workflow({ locked: true, state: 'CLOSED' });
      const { result } = runWithResponses(mutate(target, head), [
        workflowResult(before),
        jsonResult({ data: { [payloadName]: { pullRequest: after } } }),
        workflowResult(after),
      ]);

      const value = await result;

      expect(value.after.archiveState).toBe(archiveState);
      expect(value.before.archiveState).toBe('not-exposed');
      expect(value.verification).toBe('mutation-payload-and-readback');
    },
  );

  it('reports merge verification failure when GitHub does not read back as merged', async () => {
    const emptyReviewIndex = jsonResult({
      data: {
        repository: {
          pullRequest: {
            author: { __typename: 'User', login: 'author' },
            baseRefName: 'main',
            comments: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
            headRefName: 'feature',
            headRefOid: head,
            isDraft: false,
            mergeStateStatus: 'CLEAN',
            number: 42,
            reviewDecision: null,
            reviews: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
            reviewThreads: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
            state: 'OPEN',
            statusCheckRollup: {
              contexts: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
            },
            title: 'Title',
            updatedAt: '2026-08-29T10:00:00Z',
            url: 'https://github.com/example/prdr/pull/42',
          },
        },
      },
    });
    const { result } = runWithResponses(Effect.flip(mergePullRequest(target, 'squash', head)), [
      workflowResult(),
      emptyReviewIndex,
      jsonResult({ merged: true, message: 'Merged', sha: baseSha }),
      workflowResult(),
    ]);

    const error = await result;
    expect(error._tag).toBe('PullRequestVerificationError');
  });

  it('reports revert verification failure when the new pull request differs', async () => {
    const original = workflow({ merged: true, state: 'CLOSED' });
    const created = workflow({
      body: 'Requested body',
      headRefName: 'revert-42',
      headRefOid: stale,
      id: 'PR_43',
      isDraft: true,
      number: 43,
      title: 'Revert',
      url: 'https://github.com/example/prdr/pull/43',
    });
    const { result } = runWithResponses(
      Effect.flip(
        revertPullRequest(target, {
          body: 'Requested body',
          expectedHead: head,
          readiness: 'draft',
          title: 'Revert',
        }),
      ),
      [
        workflowResult(original),
        jsonResult({
          data: { revertPullRequest: { pullRequest: original, revertPullRequest: created } },
        }),
        workflowResult(original),
        workflowResult({ ...created, body: 'Different body' }),
      ],
    );

    const error = await result;
    expect(error._tag).toBe('PullRequestVerificationError');
  });
});

const rawPullRequest = (changes: Readonly<Record<string, unknown>> = {}) => ({
  additions: 1,
  base: { ref: 'main', repo: { full_name: 'example/prdr' }, sha: baseSha },
  body: 'Body',
  changed_files: 1,
  commits: 1,
  deletions: 0,
  draft: true,
  head: { ref: 'feature', repo: { full_name: 'example/prdr' }, sha: head },
  html_url: 'https://github.com/example/prdr/pull/42',
  locked: false,
  merge_commit_sha: null,
  mergeable: true,
  merged: false,
  node_id: 'PR_42',
  number: 42,
  state: 'open',
  title: 'Title',
  user: { login: 'author' },
  ...changes,
});

const createInput = {
  baseBranch: 'main',
  baseSha,
  body: 'Body',
  headBranch: 'feature',
  headRepo: 'example/prdr',
  headSha: head,
  readiness: 'draft' as const,
  title: 'Title',
};

describe('pull request creation safety', () => {
  it('stops before creation when a remote SHA is stale', async () => {
    const { captured, result } = runWithResponses(
      Effect.flip(createPullRequest('example/prdr', createInput)),
      [
        jsonResult({ nameWithOwner: 'example/prdr', viewerPermission: 'WRITE' }),
        jsonResult([]),
        jsonResult({ object: { sha: stale }, ref: 'refs/heads/main' }),
        jsonResult({ object: { sha: head }, ref: 'refs/heads/feature' }),
      ],
    );

    const error = await result;
    expect(error._tag).toBe('StaleHeadError');
    expect(captured).toHaveLength(4);
  });

  it('reports a verification failure when the created pull request differs', async () => {
    const { result } = runWithResponses(
      Effect.flip(createPullRequest('example/prdr', createInput)),
      [
        jsonResult({ nameWithOwner: 'example/prdr', viewerPermission: 'WRITE' }),
        jsonResult([]),
        jsonResult({ object: { sha: baseSha }, ref: 'refs/heads/main' }),
        jsonResult({ object: { sha: head }, ref: 'refs/heads/feature' }),
        jsonResult(rawPullRequest()),
        jsonResult(rawPullRequest({ title: 'Different title' })),
      ],
    );

    const error = await result;
    expect(error._tag).toBe('PullRequestCreationVerificationError');
  });
});
