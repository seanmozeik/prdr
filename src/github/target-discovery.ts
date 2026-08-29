import { Effect } from 'effect';

import { searchPullRequestTargets } from './pull-request/target-discovery';
import { resolveRepositoryTarget, resolveWorktreeTarget } from './repository-target-discovery';

export type TargetDiscoveryInput =
  | { readonly directory: string; readonly mode: 'worktree' }
  | {
      readonly cursor: string;
      readonly limit: number;
      readonly mode: 'repository';
      readonly query: string;
    }
  | {
      readonly branch: string;
      readonly cursor: string;
      readonly limit: number;
      readonly mode: 'branch';
      readonly state: 'all' | 'open';
    };

export const discoverTarget = Effect.fn('TargetDiscovery.discover')(function* discoverTarget(
  input: TargetDiscoveryInput,
) {
  switch (input.mode) {
    case 'branch': {
      return yield* searchPullRequestTargets(input.branch, input.state, input.cursor, input.limit);
    }
    case 'repository': {
      return yield* resolveRepositoryTarget(input.query, input.cursor, input.limit);
    }
    case 'worktree': {
      return yield* resolveWorktreeTarget(input.directory);
    }
    default: {
      return yield* Effect.die(new Error('Unsupported target discovery mode.'));
    }
  }
});
