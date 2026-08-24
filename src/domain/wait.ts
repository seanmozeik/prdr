import { Clock, Duration, Effect } from 'effect';

import {
  ProviderWaitHeadChangedError,
  ProviderWaitInputError,
  ProviderWaitTimeoutError,
} from './errors';
import type { GreptileSnapshot, GreptileWaitResult, PullRequestContext } from './model';
import { greptileStatus } from './providers';

const MINIMUM_SHA_LENGTH = 7;
const MAXIMUM_INTERVAL_SECONDS = 300;
const MAXIMUM_TIMEOUT_SECONDS = 3600;
const MILLISECONDS_PER_SECOND = 1000;

export interface GreptileWaitOptions {
  readonly intervalSeconds: number;
  readonly timeoutSeconds: number;
}

export type GreptileSnapshotLoader<E, R> = (
  context: PullRequestContext,
) => Effect.Effect<GreptileSnapshot, E, R>;

export type PullRequestContextLoader<E, R> = () => Effect.Effect<PullRequestContext, E, R>;

export const matchesReviewedCommit = (head: string, reviewed: string | null): boolean =>
  reviewed !== null &&
  reviewed.length >= MINIMUM_SHA_LENGTH &&
  /^[0-9a-f]+$/iu.test(reviewed) &&
  head.toLowerCase().startsWith(reviewed.toLowerCase());

const validateOptions = Effect.fn('Provider.validateGreptileWaitOptions')(function* validateOptions(
  options: GreptileWaitOptions,
) {
  if (!Number.isInteger(options.intervalSeconds) || options.intervalSeconds < 1) {
    return yield* ProviderWaitInputError.make({
      detail: '--interval-seconds must be a positive integer.',
    });
  }
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 1) {
    return yield* ProviderWaitInputError.make({
      detail: '--timeout-seconds must be a positive integer.',
    });
  }
  if (options.intervalSeconds > MAXIMUM_INTERVAL_SECONDS) {
    return yield* ProviderWaitInputError.make({
      detail: `--interval-seconds must not exceed ${MAXIMUM_INTERVAL_SECONDS}.`,
    });
  }
  if (options.timeoutSeconds > MAXIMUM_TIMEOUT_SECONDS) {
    return yield* ProviderWaitInputError.make({
      detail: `--timeout-seconds must not exceed ${MAXIMUM_TIMEOUT_SECONDS}.`,
    });
  }
  if (options.intervalSeconds > options.timeoutSeconds) {
    return yield* ProviderWaitInputError.make({
      detail: '--interval-seconds must not exceed --timeout-seconds.',
    });
  }
  return yield* Effect.void;
});

export const waitForGreptile = <EC, RC, ES, RS>(
  options: GreptileWaitOptions,
  loadContext: PullRequestContextLoader<EC, RC>,
  loadSnapshot: GreptileSnapshotLoader<ES, RS>,
): Effect.Effect<
  GreptileWaitResult,
  EC | ES | ProviderWaitHeadChangedError | ProviderWaitInputError | ProviderWaitTimeoutError,
  RC | RS
> =>
  Effect.gen(function* waitForGreptileGen() {
    yield* validateOptions(options);
    const start = yield* Clock.currentTimeMillis;
    const intervalMilliseconds = options.intervalSeconds * MILLISECONDS_PER_SECOND;
    let timedHead: string | null = null;
    let attempts = 0;

    const poll = Effect.gen(function* greptilePollGen() {
      let context = yield* loadContext();
      const expectedHead = context.pullRequest.headRefOid;
      timedHead = expectedHead;
      for (;;) {
        const snapshot = yield* loadSnapshot(context);
        attempts += 1;
        const currentHead = snapshot.pullRequest.headRefOid;
        if (currentHead !== expectedHead) {
          return yield* ProviderWaitHeadChangedError.make({
            after: currentHead,
            before: expectedHead,
            provider: 'Greptile',
          });
        }
        const status = greptileStatus(snapshot);
        const now = yield* Clock.currentTimeMillis;
        if (matchesReviewedCommit(expectedHead, status.lastReviewedCommit)) {
          return {
            attempts,
            elapsedMilliseconds: now - start,
            head: expectedHead,
            status,
          } satisfies GreptileWaitResult;
        }
        yield* Effect.sleep(Duration.millis(intervalMilliseconds));
        context = { pullRequest: snapshot.pullRequest, target: snapshot.target };
      }
    });

    return yield* poll.pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(options.timeoutSeconds),
        orElse: () =>
          ProviderWaitTimeoutError.make({
            head: timedHead,
            provider: 'Greptile',
            timeoutSeconds: options.timeoutSeconds,
          }),
      }),
    );
  });
