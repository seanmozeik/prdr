import { Effect } from 'effect';

import type { PullRequestTarget } from '../../domain/model';
import {
  type ContextPageOptions,
  paginatePullRequestContext,
} from '../../domain/pull-request-context';
import { PullRequestIdentityError } from '../../domain/pull-request-errors';
import {
  RawPullRequestCommit,
  RawPullRequestDetail,
  RawPullRequestFile,
} from '../../domain/pull-request-raw';
import { BoundedPaginationError } from '../../domain/pull-request-read-errors';
import { loadRestPages, loadRestResource } from '../rest';
import { loadReviewIndexForTarget } from '../review-index';
import { resolvePullRequestTarget } from '../target';
import { loadWorkflowPullRequest } from './state';

const pullRequestEndpoint = (target: PullRequestTarget): string =>
  `repos/${target.owner}/${target.name}/pulls/${target.number}`;

const assertComplete = Effect.fn('PullRequestContext.assertComplete')(function* assertComplete(
  resource: string,
  actual: number,
  expected: number,
) {
  if (actual !== expected) {
    return yield* BoundedPaginationError.make({ actual, expected, resource });
  }
  return yield* Effect.void;
});

export const loadPullRequestContextSource = Effect.fn('PullRequestContext.loadSource')(
  function* loadPullRequestContextSource(target: PullRequestTarget) {
    const endpoint = pullRequestEndpoint(target);
    const loaded = yield* Effect.all(
      {
        commits: loadRestPages(target, `${endpoint}/commits?per_page=100`, RawPullRequestCommit),
        detail: loadRestResource(target, endpoint, RawPullRequestDetail),
        files: loadRestPages(target, `${endpoint}/files?per_page=100`, RawPullRequestFile),
        reviewIndex: loadReviewIndexForTarget(target, true),
        workflow: loadWorkflowPullRequest(target),
      },
      { concurrency: 'unbounded' },
    );
    yield* assertComplete('pull request commits', loaded.commits.length, loaded.detail.commits);
    yield* assertComplete(
      'pull request files',
      new Set(loaded.files.map(({ filename }) => filename)).size,
      Math.min(loaded.detail.changed_files, 300),
    );
    const identitiesMatch =
      loaded.detail.number === target.number &&
      loaded.workflow.number === target.number &&
      loaded.reviewIndex.target.number === target.number &&
      loaded.workflow.repository.nameWithOwner.toLowerCase() === target.nameWithOwner.toLowerCase();
    const revisionsMatch =
      loaded.detail.head.sha === loaded.workflow.headRefOid &&
      loaded.detail.base.sha === loaded.workflow.baseRefOid &&
      loaded.reviewIndex.pullRequest.headRefOid === loaded.workflow.headRefOid;
    const contentMatches =
      loaded.detail.title === loaded.workflow.title &&
      (loaded.detail.body ?? '') === loaded.workflow.body;
    if (!identitiesMatch || !revisionsMatch || !contentMatches) {
      return yield* PullRequestIdentityError.make({
        detail:
          'GitHub returned inconsistent pull request identity, revision, or Markdown data. Retry the context read.',
      });
    }
    return loaded;
  },
);

export const loadPullRequestContext = Effect.fn('PullRequestContext.load')(
  function* loadPullRequestContext(
    repository: string,
    pullRequest: number,
    branch: string,
    options: ContextPageOptions,
  ) {
    const target = yield* resolvePullRequestTarget(repository, pullRequest, branch);
    const source = yield* loadPullRequestContextSource(target);
    return yield* paginatePullRequestContext(source, options);
  },
);
