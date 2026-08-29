import { Effect, Option } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';

import { markdownOptions, outputMode, targetOptions } from '../cli/flags';
import { printMutation } from '../cli/presentation';
import { emit, toMode } from '../cli/shared';
import { readMarkdown } from '../domain/markdown';
import { PullRequestInputError } from '../domain/pull-request-errors';
import { mergePullRequest, revertPullRequest } from '../github/pull-request/delivery';
import {
  archivePullRequest,
  setPullRequestAutoMerge,
  setPullRequestQueue,
  transitionPullRequest,
  unarchivePullRequest,
  updatePullRequestBranch,
} from '../github/pull-request/lifecycle';
import { managePullRequestReviewers, updatePullRequest } from '../github/pull-request/update';
import { resolvePullRequestTarget } from '../github/target';

const expectedHeadFlag = Flag.string('expected-head').pipe(
  Flag.withDescription('Expected complete current pull request head SHA'),
);
const mergeStrategyFlag = Flag.choice('strategy', ['merge', 'rebase', 'squash']).pipe(
  Flag.withDescription('Explicit GitHub merge strategy'),
);

const emitResult = (agent: boolean, json: boolean, command: string, value: object): void => {
  emit(toMode(agent, json), command, value, () => {
    printMutation(value);
  });
};

const target = (repo: string, pr: number, branch: string) =>
  resolvePullRequestTarget(repo, pr, branch);

export const transitionCommand = Command.make(
  'transition',
  {
    ...outputMode,
    ...targetOptions,
    action: Flag.choice('action', ['close', 'reopen', 'mark-ready', 'convert-draft']).pipe(
      Flag.withDescription('Exact lifecycle transition'),
    ),
    expectedHead: expectedHeadFlag,
  },
  ({ action, agent, branch, expectedHead, json, pr, repo }) =>
    Effect.gen(function* transitionCommandGen() {
      const result = yield* transitionPullRequest(
        yield* target(repo, pr, branch),
        action,
        expectedHead,
      );
      yield* Effect.sync(() => {
        emitResult(agent, json, 'transition', result);
      });
    }),
).pipe(Command.withDescription('Close, reopen, mark ready, or convert a pull request to draft'));

export const updateCommand = Command.make(
  'update',
  {
    ...markdownOptions,
    ...outputMode,
    ...targetOptions,
    base: Flag.string('base').pipe(
      Flag.withDescription('New exact remote base branch'),
      Flag.optional,
    ),
    expectedHead: expectedHeadFlag,
    title: Flag.string('title').pipe(Flag.withDescription('New exact title'), Flag.optional),
  },
  ({ agent, base, bodyFile, branch, expectedHead, json, pr, repo, stdin, title }) =>
    Effect.gen(function* updateCommandGen() {
      const body = bodyFile !== '' || stdin ? yield* readMarkdown({ bodyFile, stdin }) : null;
      const result = yield* updatePullRequest(yield* target(repo, pr, branch), {
        base: Option.getOrNull(base),
        body,
        expectedHead,
        title: Option.getOrNull(title),
      });
      yield* Effect.sync(() => {
        emitResult(agent, json, 'update', result);
      });
    }),
).pipe(Command.withDescription('Update the exact title, Markdown body, or base branch'));

export const updateBranchCommand = Command.make(
  'update-branch',
  {
    ...outputMode,
    ...targetOptions,
    expectedHead: expectedHeadFlag,
    method: Flag.choice('method', ['merge', 'rebase']).pipe(
      Flag.withDescription('Explicit GitHub branch update method'),
    ),
  },
  ({ agent, branch, expectedHead, json, method, pr, repo }) =>
    Effect.gen(function* updateBranchCommandGen() {
      const result = yield* updatePullRequestBranch(
        yield* target(repo, pr, branch),
        method,
        expectedHead,
      );
      yield* Effect.sync(() => {
        emitResult(agent, json, 'update-branch', result);
      });
    }),
).pipe(Command.withDescription('Update a pull request branch at an expected current head'));

export const reviewersCommand = Command.make(
  'reviewers',
  {
    ...outputMode,
    ...targetOptions,
    action: Flag.choice('action', ['request', 'remove']).pipe(
      Flag.withDescription('Request or remove the named reviewers'),
    ),
    expectedHead: expectedHeadFlag,
    teams: Flag.string('team').pipe(
      Flag.withDescription('Team slug; repeat for more teams'),
      Flag.atMost(100),
    ),
    users: Flag.string('user').pipe(
      Flag.withDescription('GitHub login; repeat for more users'),
      Flag.atMost(100),
    ),
  },
  ({ action, agent, branch, expectedHead, json, pr, repo, teams, users }) =>
    Effect.gen(function* reviewersCommandGen() {
      const result = yield* managePullRequestReviewers(
        yield* target(repo, pr, branch),
        action,
        expectedHead,
        users,
        teams,
      );
      yield* Effect.sync(() => {
        emitResult(agent, json, 'reviewers', result);
      });
    }),
).pipe(Command.withDescription('Request or remove pull request users and teams'));

export const autoMergeCommand = Command.make(
  'auto-merge',
  {
    ...outputMode,
    ...targetOptions,
    action: Flag.choice('action', ['enable', 'disable']).pipe(
      Flag.withDescription('Enable or disable auto-merge'),
    ),
    expectedHead: expectedHeadFlag,
    strategy: mergeStrategyFlag.pipe(Flag.optional),
  },
  ({ action, agent, branch, expectedHead, json, pr, repo, strategy }) =>
    Effect.gen(function* autoMergeCommandGen() {
      const result = yield* setPullRequestAutoMerge(
        yield* target(repo, pr, branch),
        action,
        expectedHead,
        Option.getOrNull(strategy),
      );
      yield* Effect.sync(() => {
        emitResult(agent, json, 'auto-merge', result);
      });
    }),
).pipe(Command.withDescription('Enable or disable auto-merge with exact delivery state'));

export const queueCommand = Command.make(
  'queue',
  {
    ...outputMode,
    ...targetOptions,
    action: Flag.choice('action', ['enqueue', 'dequeue']).pipe(
      Flag.withDescription('Add or remove the pull request from its merge queue'),
    ),
    expectedHead: expectedHeadFlag,
  },
  ({ action, agent, branch, expectedHead, json, pr, repo }) =>
    Effect.gen(function* queueCommandGen() {
      const result = yield* setPullRequestQueue(
        yield* target(repo, pr, branch),
        action,
        expectedHead,
      );
      yield* Effect.sync(() => {
        emitResult(agent, json, 'queue', result);
      });
    }),
).pipe(Command.withDescription('Enqueue or dequeue a pull request at an expected head'));

export const mergeCommand = Command.make(
  'merge',
  { ...outputMode, ...targetOptions, expectedHead: expectedHeadFlag, strategy: mergeStrategyFlag },
  ({ agent, branch, expectedHead, json, pr, repo, strategy }) =>
    Effect.gen(function* mergeCommandGen() {
      const result = yield* mergePullRequest(
        yield* target(repo, pr, branch),
        strategy,
        expectedHead,
      );
      yield* Effect.sync(() => {
        emitResult(agent, json, 'merge', result);
      });
    }),
).pipe(
  Command.withDescription('Merge a pull request after pinned checks and review preconditions'),
);

export const revertCommand = Command.make(
  'revert',
  {
    ...markdownOptions,
    ...outputMode,
    ...targetOptions,
    expectedHead: expectedHeadFlag,
    readiness: Flag.choice('readiness', ['draft', 'ready']).pipe(
      Flag.withDescription('Explicit readiness of the new revert pull request'),
    ),
    title: Flag.string('title').pipe(Flag.withDescription('Exact revert pull request title')),
  },
  ({ agent, bodyFile, branch, expectedHead, json, pr, readiness, repo, stdin, title }) =>
    Effect.gen(function* revertCommandGen() {
      const body = yield* readMarkdown({ bodyFile, stdin });
      const result = yield* revertPullRequest(yield* target(repo, pr, branch), {
        body,
        expectedHead,
        readiness,
        title,
      });
      yield* Effect.sync(() => {
        emitResult(agent, json, 'revert', result);
      });
    }),
).pipe(
  Command.withDescription('Create and verify a pull request that reverts a merged pull request'),
);

const archiveCommand = (name: 'archive' | 'unarchive') =>
  Command.make(
    name,
    { ...outputMode, ...targetOptions, expectedHead: expectedHeadFlag },
    ({ agent, branch, expectedHead, json, pr, repo }) =>
      Effect.gen(function* archiveCommandGen() {
        if (expectedHead === '') {
          return yield* PullRequestInputError.make({
            detail: '--expected-head must not be empty.',
            operation: name,
          });
        }
        const resolved = yield* target(repo, pr, branch);
        const result =
          name === 'archive'
            ? yield* archivePullRequest(resolved, expectedHead)
            : yield* unarchivePullRequest(resolved, expectedHead);
        yield* Effect.sync(() => {
          emitResult(agent, json, name, result);
        });
        return yield* Effect.void;
      }),
  ).pipe(Command.withDescription(`${name === 'archive' ? 'Archive' : 'Unarchive'} a pull request`));

export const archivePullRequestCommand = archiveCommand('archive');
export const unarchivePullRequestCommand = archiveCommand('unarchive');
