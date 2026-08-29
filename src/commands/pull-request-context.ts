import { Effect } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';

import { outputMode, targetOptions } from '../cli/flags';
import { printMutation } from '../cli/presentation';
import { emit, toMode } from '../cli/shared';
import { contextPurposes, DEFAULT_CONTEXT_PAGE_SIZE } from '../domain/pull-request-context';
import { PullRequestInputError } from '../domain/pull-request-errors';
import { loadPullRequestComparison } from '../github/pull-request/comparison';
import { loadPullRequestContext } from '../github/pull-request/context';
import { discoverTarget } from '../github/target-discovery';

const contextPurposeFlag = Flag.choice('purpose', contextPurposes).pipe(
  Flag.withDefault('review'),
  Flag.withDescription('Shape bounded context for authoring or review'),
);
const contextCursorFlag = Flag.string('cursor').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Continue from an opaque context cursor'),
);
const contextLimitFlag = Flag.integer('limit').pipe(
  Flag.withDefault(DEFAULT_CONTEXT_PAGE_SIZE),
  Flag.withDescription('Maximum records in each context section (1-100)'),
);
const compareBaseFlag = Flag.string('base').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Exact remote base branch for a pre-creation comparison'),
);
const compareBaseShaFlag = Flag.string('base-sha').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Expected complete remote base SHA for a comparison'),
);
const compareHeadFlag = Flag.string('head').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Exact remote head branch for a pre-creation comparison'),
);
const compareHeadRepoFlag = Flag.string('head-repo').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Exact head repository for a pre-creation comparison'),
);
const compareHeadShaFlag = Flag.string('head-sha').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Expected complete remote head SHA for a comparison'),
);

export const contextCommand = Command.make(
  'context',
  {
    ...outputMode,
    ...targetOptions,
    base: compareBaseFlag,
    baseSha: compareBaseShaFlag,
    cursor: contextCursorFlag,
    limit: contextLimitFlag,
    head: compareHeadFlag,
    headRepo: compareHeadRepoFlag,
    headSha: compareHeadShaFlag,
    purpose: contextPurposeFlag,
  },
  ({
    agent,
    base,
    baseSha,
    branch,
    cursor,
    head,
    headRepo,
    headSha,
    json,
    limit,
    pr,
    purpose,
    repo,
  }) =>
    Effect.gen(function* contextCommandGen() {
      const comparisonRequested = [base, baseSha, head, headRepo, headSha].some(
        (value) => value !== '',
      );
      if (comparisonRequested && (pr > 0 || branch !== '')) {
        return yield* PullRequestInputError.make({
          detail: 'A pre-creation comparison is mutually exclusive with --pr and --branch.',
          operation: 'context',
        });
      }
      const context = comparisonRequested
        ? yield* loadPullRequestComparison({
            base,
            baseSha,
            cursor,
            head,
            headRepo,
            headSha,
            limit,
            repo,
          })
        : yield* loadPullRequestContext(repo, pr, branch, { cursor, limit, purpose });
      yield* Effect.sync(() => {
        emit(toMode(agent, json), 'context', context, () => {
          printMutation(context);
        });
      });
      return yield* Effect.void;
    }),
).pipe(
  Command.withDescription(
    'Read exact pull request authoring and review context with bounded pages',
  ),
);

const targetModeFlag = Flag.choice('mode', ['branch', 'repository', 'worktree']).pipe(
  Flag.withDefault('worktree'),
  Flag.withDescription('Select worktree resolution, repository search, or branch search'),
);
const targetDirectoryFlag = Flag.string('directory').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Absolute worktree path; worktree mode defaults to the current directory'),
);
const targetQueryFlag = Flag.string('query').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Repository name, URL, or owner/repository hint'),
);
const targetBranchFlag = Flag.string('branch').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Search GitHub for pull requests with this exact head branch'),
);
const targetStateFlag = Flag.choice('state', ['all', 'open']).pipe(
  Flag.withDefault('open'),
  Flag.withDescription('Branch candidate state'),
);
const targetCursorFlag = Flag.string('cursor').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Continue a branch search from an opaque cursor'),
);
const targetLimitFlag = Flag.integer('limit').pipe(
  Flag.withDefault(10),
  Flag.withDescription('Maximum branch candidates (1-20)'),
);

export const targetCommand = Command.make(
  'target',
  {
    ...outputMode,
    branch: targetBranchFlag,
    cursor: targetCursorFlag,
    directory: targetDirectoryFlag,
    limit: targetLimitFlag,
    mode: targetModeFlag,
    query: targetQueryFlag,
    state: targetStateFlag,
  },
  ({ agent, branch, cursor, directory, json, limit, mode, query, state }) =>
    Effect.gen(function* targetCommandGen() {
      let target;
      switch (mode) {
        case 'branch': {
          if (branch === '' || directory !== '' || query !== '') {
            return yield* PullRequestInputError.make({
              detail: 'Branch mode requires --branch and does not accept --directory or --query.',
              operation: 'target',
            });
          }
          target = yield* discoverTarget({ branch, cursor, limit, mode, state });
          break;
        }
        case 'repository': {
          if (query === '' || branch !== '' || directory !== '') {
            return yield* PullRequestInputError.make({
              detail:
                'Repository mode requires --query and does not accept --branch or --directory.',
              operation: 'target',
            });
          }
          target = yield* discoverTarget({ cursor, limit, mode, query });
          break;
        }
        case 'worktree': {
          if (branch !== '' || cursor !== '' || query !== '') {
            return yield* PullRequestInputError.make({
              detail:
                'Worktree mode accepts only --directory. Omit it to use the current directory.',
              operation: 'target',
            });
          }
          target = yield* discoverTarget({ directory, mode });
          break;
        }
        default: {
          return yield* PullRequestInputError.make({
            detail: 'The target mode is not supported.',
            operation: 'target',
          });
        }
      }
      yield* Effect.sync(() => {
        emit(toMode(agent, json), 'target', target, () => {
          printMutation(target);
        });
      });
      return yield* Effect.void;
    }),
).pipe(
  Command.withDescription(
    'Resolve a worktree or search authenticated repository and pull request candidates',
  ),
);
