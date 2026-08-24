import { Effect } from 'effect';

import { loadBatchedSnapshot } from '../github/batched-snapshot';
import { loadReviewIndex } from '../github/review-index';
import { type OutputMode, writeStructured } from './output';

export interface TargetInput {
  readonly branch: string;
  readonly pr: number;
  readonly repo: string;
}

export const loadExactSnapshot = Effect.fn('Cli.loadExactSnapshot')(function* loadExactSnapshot(
  input: TargetInput,
  includeChecks: boolean,
) {
  return yield* loadBatchedSnapshot(input.repo, input.pr, input.branch, includeChecks);
});

export const loadMutationContext = Effect.fn('Cli.loadMutationContext')(
  function* loadMutationContext(input: TargetInput) {
    const snapshot = yield* loadBatchedSnapshot(input.repo, input.pr, input.branch, false);
    return { snapshot, target: snapshot.target };
  },
);

export const loadReviewIndexSnapshot = Effect.fn('Cli.loadReviewIndexSnapshot')(
  function* loadReviewIndexSnapshot(input: TargetInput, includeChecks: boolean) {
    return yield* loadReviewIndex(input.repo, input.pr, input.branch, includeChecks);
  },
);

export const toMode = (agent: boolean, json: boolean): OutputMode => {
  if (agent) {
    return 'agent';
  }
  return json ? 'json' : 'human';
};

export const emit = (mode: OutputMode, command: string, value: object, human: () => void): void => {
  if (mode === 'human') {
    human();
  } else {
    writeStructured(mode, command, value);
  }
};
