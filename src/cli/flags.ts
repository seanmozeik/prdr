import { Flag } from 'effect/unstable/cli';

export const jsonFlag = Flag.boolean('json').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Print complete formatted JSON output'),
);
export const agentFlag = Flag.boolean('agent').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Print task-focused single-line JSON for agents'),
);
export const outputMode = { agent: agentFlag, json: jsonFlag };

export const repositoryFlag = Flag.string('repo').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Target repository as OWNER/NAME or HOST/OWNER/NAME'),
);
export const branchFlag = Flag.string('branch').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Target pull request head branch; mutually exclusive with --pr'),
);
export const pullRequestFlag = Flag.integer('pr').pipe(
  Flag.withDefault(0),
  Flag.withDescription('Target pull request number; mutually exclusive with --branch'),
);
export const targetOptions = { branch: branchFlag, pr: pullRequestFlag, repo: repositoryFlag };

export const bodyFileFlag = Flag.string('body-file').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Read the exact Markdown body from this file'),
);
export const stdinFlag = Flag.boolean('stdin').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Read the exact Markdown body from standard input'),
);
export const markdownOptions = { bodyFile: bodyFileFlag, stdin: stdinFlag };
