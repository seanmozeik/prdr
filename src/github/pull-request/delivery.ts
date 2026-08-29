import { createHash } from 'node:crypto';

import { Effect, Schema } from 'effect';

import type { PullRequestTarget } from '../../domain/model';
import {
  PullRequestInputError,
  StaleHeadError,
  PullRequestVerificationError,
  StateConflictError,
  UnsupportedRepositoryPolicyError,
} from '../../domain/pull-request-errors';
import { MergeResponse } from '../../domain/pull-request-raw';
import { apiWrite } from '../mutations';
import { loadReviewIndexForTarget } from '../review-index';
import type { MergeStrategy } from './lifecycle';
import {
  compactWorkflowState,
  ensureExpectedHead,
  loadWorkflowPullRequest,
  requirePullRequestPermission,
  runRevertMutation,
  workflowFields,
} from './state';

const MergeRequest = Schema.Struct({ merge_method: Schema.String, sha: Schema.String });

const attentionBuckets = new Set(['cancel', 'fail', 'pending']);

export const mergePullRequest = Effect.fn('PullRequestDelivery.merge')(function* mergePullRequest(
  target: PullRequestTarget,
  strategy: MergeStrategy,
  expectedHead: string,
) {
  const operation = 'merge';
  const before = yield* loadWorkflowPullRequest(target);
  yield* ensureExpectedHead(before, expectedHead, operation);
  yield* requirePullRequestPermission(before, operation, 'write');
  if (before.state !== 'OPEN' || before.isDraft || before.merged) {
    let actual = before.state;
    if (before.isDraft) {
      actual = 'draft';
    }
    return yield* StateConflictError.make({ actual, expected: 'open and ready', operation });
  }
  if (before.mergeable === 'CONFLICTING' || before.mergeStateStatus === 'DIRTY') {
    return yield* StateConflictError.make({
      actual: before.mergeStateStatus.toLowerCase(),
      expected: 'mergeable',
      operation,
    });
  }
  const review = yield* loadReviewIndexForTarget(target, true);
  if (review.pullRequest.headRefOid !== expectedHead) {
    return yield* StaleHeadError.make({
      actual: review.pullRequest.headRefOid,
      expected: expectedHead,
      operation,
    });
  }
  const checks = review.checks.filter(({ bucket }) => attentionBuckets.has(bucket));
  const unresolvedThreads = review.threads.filter(({ isResolved }) => !isResolved);
  if (
    checks.length > 0 ||
    unresolvedThreads.length > 0 ||
    before.reviewDecision === 'CHANGES_REQUESTED' ||
    before.mergeStateStatus === 'BLOCKED'
  ) {
    return yield* UnsupportedRepositoryPolicyError.make({
      detail: `Merge preconditions are not complete: ${checks.length} check(s) need attention, ${unresolvedThreads.length} review thread(s) are unresolved, and the review decision is ${before.reviewDecision ?? 'not set'}.`,
      operation,
    });
  }
  const response = yield* apiWrite(target, {
    endpoint: `repos/${target.nameWithOwner}/pulls/${target.number}/merge`,
    method: 'PUT',
    operation,
    request: { merge_method: strategy, sha: expectedHead },
    requestSchema: MergeRequest,
    responseSchema: MergeResponse,
  });
  const after = yield* loadWorkflowPullRequest(target);
  if (!response.merged || !after.merged || after.headRefOid !== expectedHead) {
    return yield* PullRequestVerificationError.make({
      detail: `GitHub reported ${response.message}, but the pull request did not read back as merged at the expected head.`,
      operation,
    });
  }
  return {
    after: compactWorkflowState(after),
    before: compactWorkflowState(before),
    mergeSha: response.sha,
    strategy,
    url: after.url,
  };
});

export interface RevertPullRequestInput {
  readonly body: string;
  readonly expectedHead: string;
  readonly readiness: 'draft' | 'ready';
  readonly title: string;
}

const revertMutation = `mutation PrdrRevert($input: RevertPullRequestInput!) {
  revertPullRequest(input: $input) {
    pullRequest { ${workflowFields} }
    revertPullRequest { ${workflowFields} }
  }
}`;

const exactLine = Effect.fn('PullRequestDelivery.exactLine')(function* exactLine(
  name: string,
  value: string,
) {
  if (value === '' || value.trim() !== value || /\p{Cc}|\p{Zl}|\p{Zp}/u.test(value)) {
    return yield* PullRequestInputError.make({
      detail: `${name} must be one non-empty line without outer whitespace or control characters.`,
      operation: 'revert',
    });
  }
  return value;
});

export const revertPullRequest = Effect.fn('PullRequestDelivery.revert')(
  function* revertPullRequest(target: PullRequestTarget, input: RevertPullRequestInput) {
    const title = yield* exactLine('--title', input.title);
    if (input.body === '') {
      return yield* PullRequestInputError.make({
        detail: 'The revert pull request body must not be empty.',
        operation: 'revert',
      });
    }
    const before = yield* loadWorkflowPullRequest(target);
    yield* ensureExpectedHead(before, input.expectedHead, 'revert');
    yield* requirePullRequestPermission(before, 'revert', 'write');
    if (!before.merged) {
      return yield* StateConflictError.make({
        actual: before.state.toLowerCase(),
        expected: 'merged',
        operation: 'revert',
      });
    }
    const response = yield* runRevertMutation(target, revertMutation, {
      input: {
        body: input.body,
        draft: input.readiness === 'draft',
        pullRequestId: before.id,
        title,
      },
    });
    const payload = response.data?.revertPullRequest;
    const created = payload?.revertPullRequest;
    if (created === undefined || created === null) {
      return yield* PullRequestVerificationError.make({
        detail: 'GitHub did not return the new revert pull request.',
        operation: 'revert',
      });
    }
    const [originalAfter, createdAfter] = yield* Effect.all(
      [
        loadWorkflowPullRequest(target),
        loadWorkflowPullRequest({ ...target, number: created.number }),
      ],
      { concurrency: 'unbounded' },
    );
    if (
      !originalAfter.merged ||
      originalAfter.headRefOid !== input.expectedHead ||
      createdAfter.number === originalAfter.number ||
      createdAfter.repository.nameWithOwner.toLowerCase() !== target.nameWithOwner.toLowerCase() ||
      createdAfter.state !== 'OPEN' ||
      createdAfter.merged ||
      createdAfter.title !== title ||
      createdAfter.body !== input.body ||
      createdAfter.isDraft !== (input.readiness === 'draft')
    ) {
      return yield* PullRequestVerificationError.make({
        detail:
          'The original or new revert pull request did not read back with the requested state.',
        operation: 'revert',
      });
    }
    return {
      original: { number: originalAfter.number, url: originalAfter.url },
      revert: {
        bodyBytes: Buffer.byteLength(input.body, 'utf8'),
        bodySha256: createHash('sha256').update(input.body, 'utf8').digest('hex'),
        head: { ref: createdAfter.headRefName, sha: createdAfter.headRefOid },
        number: createdAfter.number,
        readiness: createdAfter.isDraft ? ('draft' as const) : ('ready' as const),
        repo: createdAfter.repository.nameWithOwner,
        title: createdAfter.title,
        url: createdAfter.url,
      },
    };
  },
);
