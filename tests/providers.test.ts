import { describe, expect, it } from 'bun:test';

import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';

import type { GreptileSnapshot, IssueComment, PullRequestContext } from '../src/domain/model';
import { matchesReviewedCommit, waitForGreptile } from '../src/domain/wait';

const head = '0123456789abcdef0123456789abcdef01234567';
const initialContext: PullRequestContext = {
  pullRequest: {
    author: { is_bot: false, login: 'reviewer' },
    baseRefName: 'main',
    headRefName: 'feature',
    headRefOid: head,
    isDraft: false,
    mergeStateStatus: 'CLEAN',
    number: 42,
    reviewDecision: '',
    state: 'OPEN',
    title: 'Test pull request',
    updatedAt: '2026-08-24T10:00:00Z',
    url: 'https://github.com/example/prdr/pull/42',
  },
  target: {
    host: 'github.com',
    name: 'prdr',
    nameWithOwner: 'example/prdr',
    number: 42,
    owner: 'example',
  },
};

const summary = (reviewedHead: string): IssueComment => ({
  body:
    `<!-- greptile-status -->\nConfidence Score: 4/5\nReviews (2): Last reviewed commit: ` +
    `[head](https://github.com/example/prdr/commit/${reviewedHead})`,
  created_at: '2026-08-24T10:00:00Z',
  html_url: 'https://github.com/example/prdr/pull/42#issuecomment-2',
  id: 2,
  metadata: { provider: 'greptile', severity: 'unknown', title: null },
  node_id: 'IC_2',
  ref: 'issue-comment:2',
  updated_at: '2026-08-24T10:00:00Z',
  user: { login: 'greptile-apps[bot]', type: 'Bot' },
});

const snapshot = (reviewedHead: string | null, currentHead = head): GreptileSnapshot => ({
  issueComments: reviewedHead === null ? [] : [summary(reviewedHead)],
  pullRequest: { ...initialContext.pullRequest, headRefOid: currentHead },
  target: initialContext.target,
  threads: [],
  unthreadedReviewComments: [],
});

describe('Greptile wait', () => {
  it('matches full and unambiguous abbreviated commit SHAs', () => {
    expect(matchesReviewedCommit(head, head)).toBe(true);
    expect(matchesReviewedCommit(head, head.slice(0, 7))).toBe(true);
    expect(matchesReviewedCommit(head, head.slice(0, 6))).toBe(false);
    expect(matchesReviewedCommit(head, 'not-a-sha')).toBe(false);
  });

  it('returns immediately when the current head is already reviewed', async () => {
    let calls = 0;
    const result = await Effect.runPromise(
      waitForGreptile(
        { intervalSeconds: 1, timeoutSeconds: 10 },
        () => Effect.succeed(initialContext.target),
        () =>
          Effect.sync(() => {
            calls += 1;
            return snapshot(head);
          }),
      ),
    );

    expect(result.attempts).toBe(1);
    expect(result.head).toBe(head);
    expect(calls).toBe(1);
  });

  it('polls with the test clock until a completed review arrives', async () => {
    let calls = 0;
    const program = Effect.gen(function* testProgram() {
      const fiber = yield* waitForGreptile(
        { intervalSeconds: 1, timeoutSeconds: 10 },
        () => Effect.succeed(initialContext.target),
        () =>
          Effect.sync(() => {
            calls += 1;
            return calls === 1 ? snapshot(null) : snapshot(head);
          }),
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust('1 second');
      return yield* Fiber.join(fiber);
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));

    expect(result.attempts).toBe(2);
    expect(result.elapsedMilliseconds).toBe(1000);
  });

  it('fails with a distinct timeout after the bounded duration', async () => {
    const program = Effect.gen(function* testProgram() {
      const fiber = yield* waitForGreptile(
        { intervalSeconds: 1, timeoutSeconds: 2 },
        () => Effect.succeed(initialContext.target),
        () => Effect.succeed(snapshot(null)),
      ).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust('2 seconds');
      return yield* Fiber.join(fiber);
    });

    const error = await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));

    expect(error._tag).toBe('ProviderWaitTimeoutError');
  });

  it('bounds a provider load that never returns', async () => {
    const program = Effect.gen(function* testProgram() {
      const fiber = yield* waitForGreptile(
        { intervalSeconds: 1, timeoutSeconds: 2 },
        () => Effect.succeed(initialContext.target),
        () => Effect.never,
      ).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust('2 seconds');
      return yield* Fiber.join(fiber);
    });

    const error = await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));

    expect(error._tag).toBe('ProviderWaitTimeoutError');
  });

  it('bounds initial pull request resolution', async () => {
    const program = Effect.gen(function* testProgram() {
      const fiber = yield* waitForGreptile(
        { intervalSeconds: 1, timeoutSeconds: 2 },
        () => Effect.never,
        () => Effect.never,
      ).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust('2 seconds');
      return yield* Fiber.join(fiber);
    });

    const error = await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));

    expect(error._tag).toBe('ProviderWaitTimeoutError');
    if (error._tag !== 'ProviderWaitTimeoutError') {
      throw new Error(`Expected a provider timeout, received ${error._tag}.`);
    }
    expect(error.head).toBeNull();
  });

  it('stops if the pull request head changes', async () => {
    const changedHead = 'ffffffffffffffffffffffffffffffffffffffff';
    let calls = 0;
    const program = Effect.gen(function* testProgram() {
      const fiber = yield* waitForGreptile(
        { intervalSeconds: 1, timeoutSeconds: 10 },
        () => Effect.succeed(initialContext.target),
        () =>
          Effect.sync(() => {
            calls += 1;
            return snapshot(null, calls === 1 ? head : changedHead);
          }),
      ).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust('1 second');
      return yield* Fiber.join(fiber);
    });

    const error = await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));

    expect(error._tag).toBe('ProviderWaitHeadChangedError');
  });

  it('rejects invalid bounds before loading provider data', async () => {
    let calls = 0;
    const error = await Effect.runPromise(
      Effect.flip(
        waitForGreptile(
          { intervalSeconds: 11, timeoutSeconds: 10 },
          () => Effect.succeed(initialContext.target),
          () =>
            Effect.sync(() => {
              calls += 1;
              return snapshot(null);
            }),
        ),
      ),
    );

    expect(error._tag).toBe('ProviderWaitInputError');
    expect(calls).toBe(0);
  });
});
