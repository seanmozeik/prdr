import { Effect } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';

import { markdownOptions, outputMode } from '../cli/flags';
import { printMutation } from '../cli/presentation';
import { emit, toMode } from '../cli/shared';
import { readMarkdown } from '../domain/markdown';
import { createPullRequest } from '../github/create-pull-request';

const baseFlag = Flag.string('base').pipe(
  Flag.withDescription('Exact target repository base branch'),
);
const baseShaFlag = Flag.string('base-sha').pipe(
  Flag.withDescription('Expected complete SHA of the remote base branch'),
);
const headBranchFlag = Flag.string('head-branch').pipe(
  Flag.withDescription('Exact remote head branch'),
);
const headRepoFlag = Flag.string('head-repo').pipe(
  Flag.withDescription('Exact head repository as OWNER/REPOSITORY or HOST/OWNER/REPOSITORY'),
);
const headShaFlag = Flag.string('head-sha').pipe(
  Flag.withDescription('Expected complete SHA of the remote head branch'),
);
const readinessFlag = Flag.choice('readiness', ['draft', 'ready']).pipe(
  Flag.withDescription('Explicit initial pull request readiness'),
);
const repoFlag = Flag.string('repo').pipe(
  Flag.withDescription('Exact base repository as OWNER/REPOSITORY or HOST/OWNER/REPOSITORY'),
);
const titleFlag = Flag.string('title').pipe(Flag.withDescription('Exact pull request title'));

export const createPullRequestCommand = Command.make(
  'create',
  {
    ...markdownOptions,
    ...outputMode,
    baseBranch: baseFlag,
    baseSha: baseShaFlag,
    headBranch: headBranchFlag,
    headRepo: headRepoFlag,
    headSha: headShaFlag,
    readiness: readinessFlag,
    repo: repoFlag,
    title: titleFlag,
  },
  ({
    agent,
    baseBranch,
    baseSha,
    bodyFile,
    headBranch,
    headRepo,
    headSha,
    json,
    readiness,
    repo,
    stdin,
    title,
  }) =>
    Effect.gen(function* createPullRequestCommandGen() {
      const body = yield* readMarkdown({ bodyFile, stdin });
      const created = yield* createPullRequest(repo, {
        baseBranch,
        baseSha,
        body,
        headBranch,
        headRepo,
        headSha,
        readiness,
        title,
      });
      yield* Effect.sync(() => {
        emit(toMode(agent, json), 'create', created, () => {
          printMutation(created);
        });
      });
    }),
).pipe(
  Command.withDescription('Create a pull request from exact Markdown and verified remote refs'),
);
