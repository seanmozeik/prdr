import { Clock, Duration, Effect } from 'effect';

import {
  ProviderWaitHeadChangedError,
  ProviderWaitInputError,
  ProviderWaitTimeoutError,
} from './errors';
import type { GreptileWaitResult, PullRequestTarget } from './model';
import { greptileStatus } from './providers';
import type { GreptileStatusSource, ReviewIndex } from './review-index';

const MINIMUM_SHA_LENGTH = 7;
const MAXIMUM_INTERVAL_SECONDS = 300;
const MAXIMUM_TIMEOUT_SECONDS = 3600;
const MILLISECONDS_PER_SECOND = 1000;

export interface GreptileWaitOptions {
  readonly intervalSeconds: number;
  readonly timeoutSeconds: number;
}

type GreptileWaitSnapshot = GreptileStatusSource & Pick<ReviewIndex, 'target'>;

export type GreptileSnapshotLoader<E, R> = (
  target: PullRequestTarget,
) => Effect.Effect<GreptileWaitSnapshot, E, R>;

export type PullRequestTargetLoader<E, R> = () => Effect.Effect<PullRequestTarget, E, R>;

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

export const waitForGreptile = <ET, RT, ES, RS>(
  options: GreptileWaitOptions,
  loadTarget: PullRequestTargetLoader<ET, RT>,
  loadSnapshot: GreptileSnapshotLoader<ES, RS>,
): Effect.Effect<
  GreptileWaitResult,
  ES | ET | ProviderWaitHeadChangedError | ProviderWaitInputError | ProviderWaitTimeoutError,
  RS | RT
> =>
  Effect.gen(function* waitForGreptileGen() {
    yield* validateOptions(options);
    const start = yield* Clock.currentTimeMillis;
    const intervalMilliseconds = options.intervalSeconds * MILLISECONDS_PER_SECOND;
    let timedHead: string | null = null;
    let attempts = 0;

    const poll = Effect.gen(function* greptilePollGen() {
      const target = yield* loadTarget();
      let expectedHead: string | null = null;
      for (;;) {
        const snapshot = yield* loadSnapshot(target);
        attempts += 1;
        const currentHead = snapshot.pullRequest.headRefOid;
        if (expectedHead === null) {
          expectedHead = currentHead;
          timedHead = currentHead;
        } else if (currentHead !== expectedHead) {
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
