import { Effect } from 'effect';

import {
  loadAikidoSnapshot,
  loadConversationSnapshot,
  loadGreptileSnapshot,
  loadSnapshot,
  loadThreadSnapshot,
} from '../github/loaders';
import { resolvePullRequestContext } from '../github/target';
import { type OutputMode, writeStructured } from './output';

export interface TargetInput {
  readonly branch: string;
  readonly pr: number;
  readonly repo: string;
}

export const loadContext = Effect.fn('Cli.loadContext')(function* loadContext(input: TargetInput) {
  const context = yield* resolvePullRequestContext(input.repo, input.pr, input.branch);
  const snapshot = yield* loadSnapshot(context);
  return { snapshot, target: context.target };
});

export const loadConversationContext = Effect.fn('Cli.loadConversationContext')(
  function* loadConversationContext(input: TargetInput) {
    const context = yield* resolvePullRequestContext(input.repo, input.pr, input.branch);
    const snapshot = yield* loadConversationSnapshot(context);
    return { snapshot, target: context.target };
  },
);

export const loadThreadContext = Effect.fn('Cli.loadThreadContext')(function* loadThreadContext(
  input: TargetInput,
) {
  const context = yield* resolvePullRequestContext(input.repo, input.pr, input.branch);
  const snapshot = yield* loadThreadSnapshot(context);
  return { snapshot, target: context.target };
});

export const loadGreptileContext = Effect.fn('Cli.loadGreptileContext')(
  function* loadGreptileContext(input: TargetInput) {
    const context = yield* resolvePullRequestContext(input.repo, input.pr, input.branch);
    const snapshot = yield* loadGreptileSnapshot(context);
    return { snapshot, target: context.target };
  },
);

export const loadAikidoContext = Effect.fn('Cli.loadAikidoContext')(function* loadAikidoContext(
  input: TargetInput,
) {
  const context = yield* resolvePullRequestContext(input.repo, input.pr, input.branch);
  const snapshot = yield* loadAikidoSnapshot(context);
  return { snapshot, target: context.target };
});

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
