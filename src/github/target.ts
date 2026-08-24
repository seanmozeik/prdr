import { Effect } from 'effect';

import type { PullRequestTarget, RepositoryTarget } from '../domain/model';
import { PullRequestView, RepositoryView } from '../domain/raw';
import { decodeGhJson, GhClient, ghRequest } from './client';
import { TargetResolutionError } from './errors';

const pullRequestFields = [
  'author',
  'baseRefName',
  'headRefName',
  'headRefOid',
  'isDraft',
  'mergeStateStatus',
  'number',
  'reviewDecision',
  'state',
  'title',
  'url',
].join(',');

const makeRepositoryTarget = Effect.fn('Target.makeRepositoryTarget')(
  function* makeRepositoryTarget(
    host: string | undefined,
    owner: string | undefined,
    name: string | undefined,
  ) {
    if (
      host === undefined ||
      owner === undefined ||
      name === undefined ||
      host.length === 0 ||
      owner.length === 0 ||
      name.length === 0
    ) {
      return yield* new TargetResolutionError({
        detail: 'The repository host, owner, and name must not be empty.',
      });
    }
    return { host, name, nameWithOwner: `${owner}/${name}`, owner } satisfies RepositoryTarget;
  },
);

const parseRepository = Effect.fn('Target.parseRepository')(function* parseRepository(
  specification: string,
  url: string | null,
) {
  const parts = specification.split('/');
  if (parts.length === 2) {
    const [owner, name] = parts;
    const host = url === null ? 'github.com' : yield* hostFromUrl(url);
    return yield* makeRepositoryTarget(host, owner, name);
  }
  if (parts.length === 3) {
    const [host, owner, name] = parts;
    return yield* makeRepositoryTarget(host, owner, name);
  }
  return yield* new TargetResolutionError({
    detail: 'Use OWNER/REPOSITORY or HOST/OWNER/REPOSITORY for --repo.',
  });
});

const hostFromUrl = Effect.fn('Target.hostFromUrl')(function* hostFromUrl(url: string) {
  const parsed = yield* Effect.try({
    catch: () =>
      new TargetResolutionError({ detail: `GitHub returned an invalid repository URL: ${url}` }),
    try: () => new URL(url),
  });
  return parsed.host;
});

export const repositorySelector = (target: RepositoryTarget): string =>
  target.host === 'github.com' ? target.nameWithOwner : `${target.host}/${target.nameWithOwner}`;

export const resolveRepository = Effect.fn('Target.resolveRepository')(function* resolveRepository(
  repository: string,
) {
  if (repository.length > 0) {
    return yield* parseRepository(repository, null);
  }
  const gh = yield* GhClient;
  const arguments_ = ['repo', 'view', '--json', 'nameWithOwner,url'];
  const result = yield* gh.run(ghRequest(arguments_));
  const view = yield* decodeGhJson(RepositoryView, result, arguments_);
  return yield* parseRepository(view.nameWithOwner, view.url);
});

export const loadPullRequestView = Effect.fn('Target.loadPullRequestView')(
  function* loadPullRequestView(
    repository: RepositoryTarget,
    pullRequest: number,
    repositoryWasExplicit: boolean,
  ) {
    const gh = yield* GhClient;
    const arguments_ = ['pr', 'view'];
    if (pullRequest > 0) {
      arguments_.push(String(pullRequest));
    }
    if (repositoryWasExplicit || pullRequest > 0) {
      arguments_.push('--repo', repositorySelector(repository));
    }
    arguments_.push('--json', pullRequestFields);
    const result = yield* gh.run(ghRequest(arguments_));
    return yield* decodeGhJson(PullRequestView, result, arguments_);
  },
);

export const resolvePullRequest = Effect.fn('Target.resolvePullRequest')(
  function* resolvePullRequest(repository: string, pullRequest: number) {
    if (pullRequest < 0) {
      return yield* new TargetResolutionError({ detail: '--pr must be a positive integer.' });
    }
    const resolvedRepository = yield* resolveRepository(repository);
    const view = yield* loadPullRequestView(resolvedRepository, pullRequest, repository.length > 0);
    return { ...resolvedRepository, number: view.number } satisfies PullRequestTarget;
  },
);

export const reloadPullRequest = Effect.fn('Target.reloadPullRequest')(function* reloadPullRequest(
  target: PullRequestTarget,
) {
  return yield* loadPullRequestView(target, target.number, true);
});
