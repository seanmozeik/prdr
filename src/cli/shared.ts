import { Effect } from 'effect';

import { loadSnapshot } from '../github/snapshot';
import { resolvePullRequest } from '../github/target';
import { type OutputMode, writeStructured } from './output';

export interface TargetInput {
  readonly pr: number;
  readonly repo: string;
}

export const loadContext = Effect.fn('Cli.loadContext')(function* loadContext(input: TargetInput) {
  const target = yield* resolvePullRequest(input.repo, input.pr);
  const snapshot = yield* loadSnapshot(target);
  return { snapshot, target };
});

export const toMode = (agent: boolean, json: boolean): OutputMode => {
  if (agent) {
    return 'agent';
  }
  return json ? 'json' : 'human';
};

export const emit = (mode: OutputMode, value: unknown, human: () => void): void => {
  if (mode === 'human') {
    human();
  } else {
    writeStructured(mode, value);
  }
};

export const emitWithAgent = (
  mode: OutputMode,
  value: unknown,
  agentValue: unknown,
  human: () => void,
): void => {
  emit(mode, mode === 'agent' ? agentValue : value, human);
};
