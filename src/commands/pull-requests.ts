import { Effect } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';

import { outputMode, repositoryFlag } from '../cli/flags';
import { printPullRequestList } from '../cli/presentation';
import { emit, toMode } from '../cli/shared';
import { toAgentPullRequestListPage } from '../domain/agent-output';
import { DEFAULT_PULL_REQUEST_PAGE_SIZE, listPullRequests } from '../github/pull-request';

const baseFlag = Flag.string('base').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Filter by exact base branch'),
);
const cursorFlag = Flag.string('cursor').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Continue from an opaque nextCursor value'),
);
const headBranchFlag = Flag.string('branch').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Filter by exact head branch'),
);
const limitFlag = Flag.integer('limit').pipe(
  Flag.withDefault(DEFAULT_PULL_REQUEST_PAGE_SIZE),
  Flag.withDescription('Maximum pull requests per page (1-100)'),
);
const stateFlag = Flag.choice('state', ['open', 'closed', 'merged', 'all']).pipe(
  Flag.withDefault('open'),
  Flag.withDescription('Filter by pull request state'),
);

export const pullRequestsCommand = Command.make(
  'prs',
  {
    ...outputMode,
    base: baseFlag,
    branch: headBranchFlag,
    cursor: cursorFlag,
    limit: limitFlag,
    repo: repositoryFlag,
    state: stateFlag,
  },
  ({ agent, base, branch, cursor, json, limit, repo, state }) =>
    Effect.gen(function* pullRequestsCommandGen() {
      const page = yield* listPullRequests(repo, { base, branch, state }, { cursor, limit });
      const mode = toMode(agent, json);
      yield* Effect.sync(() => {
        emit(mode, 'prs', mode === 'agent' ? toAgentPullRequestListPage(page) : page, () => {
          printPullRequestList(page);
        });
      });
    }),
).pipe(Command.withDescription('List cursor-paged pull requests with compact status summaries'));
