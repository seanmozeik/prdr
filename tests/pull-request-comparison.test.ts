import { describe, expect, it } from 'bun:test';

import { Effect, Layer } from 'effect';

import { GhClient, type GhRequest, type GhResult } from '../src/github/client';
import { loadPullRequestComparison } from '../src/github/pull-request/comparison';

const baseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const headSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const jsonResult = (value: unknown): GhResult => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(value),
});

const commit = (sha: string, message: string) => ({
  author: { login: 'author' },
  commit: { author: { date: '2026-08-29T10:00:00Z', name: 'Author' }, message },
  sha,
});

const file = (index: number) => ({
  additions: 1,
  changes: 1,
  deletions: 0,
  filename: `src/file-${index}.ts`,
  patch: '@@ -0,0 +1 @@\n+line',
  status: 'added',
});

const runWithResponses = <A, E>(
  effect: Effect.Effect<A, E, GhClient>,
  responses: readonly GhResult[],
): { readonly captured: GhRequest[]; readonly result: Promise<A> } => {
  const captured: GhRequest[] = [];
  const remaining = Array.from(responses);
  const run = Effect.fn('TestPullRequestComparison.run')((request: GhRequest) =>
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

const input = {
  base: 'main',
  baseSha,
  cursor: '',
  head: 'feature',
  headRepo: 'example/prdr',
  headSha,
  limit: 1,
  repo: 'example/prdr',
};

const referenceResponses = (): readonly GhResult[] => [
  jsonResult({ object: { sha: baseSha }, ref: 'refs/heads/main' }),
  jsonResult({ object: { sha: headSha }, ref: 'refs/heads/feature' }),
];

describe('pre-creation comparison context', () => {
  it('pages commits and states the GitHub changed-file cap', async () => {
    const firstRun = runWithResponses(loadPullRequestComparison(input), [
      ...referenceResponses(),
      jsonResult({
        ahead_by: 2,
        base_commit: { sha: baseSha },
        behind_by: 0,
        commits: [commit('1111111111111111111111111111111111111111', 'First')],
        files: Array.from({ length: 300 }, (_value, index) => file(index)),
        merge_base_commit: { sha: baseSha },
        status: 'ahead',
        total_commits: 2,
      }),
    ]);

    const first = await firstRun.result;

    expect(first.commits).toMatchObject({ total: 2, truncated: true });
    expect(first.files).toMatchObject({ returned: 300, truncated: true });
    expect(first.diff.totalsTruncated).toBe(true);
    expect(first.limits.files).toContain('maximum 300 files');
    expect(first.nextCursor).not.toBeNull();
    expect(firstRun.captured[2]?.arguments.at(-1)).toContain('per_page=1&page=1');

    const secondRun = runWithResponses(
      loadPullRequestComparison({ ...input, cursor: first.nextCursor ?? '' }),
      [
        ...referenceResponses(),
        jsonResult({
          ahead_by: 2,
          base_commit: { sha: baseSha },
          behind_by: 0,
          commits: [commit('2222222222222222222222222222222222222222', 'Second')],
          merge_base_commit: { sha: baseSha },
          status: 'ahead',
          total_commits: 2,
        }),
      ],
    );

    const second = await secondRun.result;

    expect(second.commits.items[0]?.title).toBe('Second');
    expect(second.diff.additions).toBeNull();
    expect(second.diff.deletions).toBeNull();
    expect(second.diff.totalsTruncated).toBe(true);
    expect(second.files.included).toBe(false);
    expect(second.files.items).toEqual([]);
    expect(second.files.truncated).toBe(true);
    expect(second.limits.files).toContain('only on the first comparison page');
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(secondRun.captured[2]?.arguments.at(-1)).toContain('per_page=1&page=2');
  });
});
