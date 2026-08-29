import { Effect } from 'effect';

import type { PullRequestTarget } from '../../domain/model';
import {
  PullRequestInputError,
  PullRequestVerificationError,
  StateConflictError,
} from '../../domain/pull-request-errors';
import type { WorkflowPullRequest } from '../../domain/pull-request-raw';
import {
  compactWorkflowState,
  ensureExpectedHead,
  loadWorkflowPullRequest,
  requirePullRequestPermission,
  runWorkflowMutation,
  workflowFields,
} from './state';

export type TransitionAction = 'close' | 'convert-draft' | 'mark-ready' | 'reopen';
export type MergeStrategy = 'merge' | 'rebase' | 'squash';

const transitionMutations: Readonly<Record<TransitionAction, string>> = {
  close: `mutation PrdrClose($input: ClosePullRequestInput!) {
    closePullRequest(input: $input) { pullRequest { ${workflowFields} } }
  }`,
  'convert-draft': `mutation PrdrConvertDraft($input: ConvertPullRequestToDraftInput!) {
    convertPullRequestToDraft(input: $input) { pullRequest { ${workflowFields} } }
  }`,
  'mark-ready': `mutation PrdrMarkReady($input: MarkPullRequestReadyForReviewInput!) {
    markPullRequestReadyForReview(input: $input) { pullRequest { ${workflowFields} } }
  }`,
  reopen: `mutation PrdrReopen($input: ReopenPullRequestInput!) {
    reopenPullRequest(input: $input) { pullRequest { ${workflowFields} } }
  }`,
};

const transitionPreflight = Effect.fn('PullRequestLifecycle.transitionPreflight')(
  function* transitionPreflight(pullRequest: WorkflowPullRequest, action: TransitionAction) {
    const operation = `transition ${action}`;
    if (action === 'close') {
      yield* requirePullRequestPermission(pullRequest, operation, 'close');
      if (pullRequest.state !== 'OPEN' || pullRequest.merged) {
        return yield* StateConflictError.make({
          actual: pullRequest.state,
          expected: 'OPEN',
          operation,
        });
      }
    } else if (action === 'reopen') {
      yield* requirePullRequestPermission(pullRequest, operation, 'reopen');
      if (pullRequest.state !== 'CLOSED' || pullRequest.merged) {
        return yield* StateConflictError.make({
          actual: pullRequest.state,
          expected: 'CLOSED',
          operation,
        });
      }
    } else {
      yield* requirePullRequestPermission(pullRequest, operation, 'update');
      if (pullRequest.state !== 'OPEN') {
        return yield* StateConflictError.make({
          actual: pullRequest.state,
          expected: 'OPEN',
          operation,
        });
      }
      const expectedDraft = action === 'mark-ready';
      if (pullRequest.isDraft !== expectedDraft) {
        return yield* StateConflictError.make({
          actual: pullRequest.isDraft ? 'draft' : 'ready',
          expected: expectedDraft ? 'draft' : 'ready',
          operation,
        });
      }
    }
    return yield* Effect.void;
  },
);

const transitionVerified = (
  pullRequest: WorkflowPullRequest,
  action: TransitionAction,
): boolean => {
  switch (action) {
    case 'close': {
      return pullRequest.state === 'CLOSED';
    }
    case 'reopen': {
      return pullRequest.state === 'OPEN';
    }
    case 'mark-ready': {
      return !pullRequest.isDraft;
    }
    case 'convert-draft': {
      return pullRequest.isDraft;
    }
    default: {
      return false;
    }
  }
};

export const transitionPullRequest = Effect.fn('PullRequestLifecycle.transition')(
  function* transitionPullRequest(
    target: PullRequestTarget,
    action: TransitionAction,
    expectedHead: string,
  ) {
    const operation = `transition ${action}`;
    const before = yield* loadWorkflowPullRequest(target);
    yield* ensureExpectedHead(before, expectedHead, operation);
    yield* transitionPreflight(before, action);
    yield* runWorkflowMutation(target, operation, transitionMutations[action], {
      input: { pullRequestId: before.id },
    });
    const after = yield* loadWorkflowPullRequest(target);
    if (!transitionVerified(after, action) || after.headRefOid !== expectedHead) {
      return yield* PullRequestVerificationError.make({
        detail: 'The final lifecycle or head state is different.',
        operation,
      });
    }
    return { action, after: compactWorkflowState(after), before: compactWorkflowState(before) };
  },
);

const updateBranchMutation = `mutation PrdrUpdateBranch($input: UpdatePullRequestBranchInput!) {
  updatePullRequestBranch(input: $input) { pullRequest { ${workflowFields} } }
}`;

export const updatePullRequestBranch = Effect.fn('PullRequestLifecycle.updateBranch')(
  function* updatePullRequestBranch(
    target: PullRequestTarget,
    method: 'merge' | 'rebase',
    expectedHead: string,
  ) {
    const operation = 'update-branch';
    const before = yield* loadWorkflowPullRequest(target);
    yield* ensureExpectedHead(before, expectedHead, operation);
    yield* requirePullRequestPermission(before, operation, 'update-branch');
    if (before.state !== 'OPEN') {
      return yield* StateConflictError.make({ actual: before.state, expected: 'OPEN', operation });
    }
    yield* runWorkflowMutation(target, operation, updateBranchMutation, {
      input: {
        expectedHeadOid: expectedHead,
        pullRequestId: before.id,
        updateMethod: method.toUpperCase(),
      },
    });
    const after = yield* loadWorkflowPullRequest(target);
    if (after.headRefOid === expectedHead) {
      return yield* PullRequestVerificationError.make({
        detail: 'The head SHA did not change after GitHub accepted the branch update.',
        operation,
      });
    }
    return {
      action: method,
      after: compactWorkflowState(after),
      before: compactWorkflowState(before),
    };
  },
);

const autoMergeMutation = (action: 'disable' | 'enable'): string =>
  action === 'enable'
    ? `mutation PrdrEnableAutoMerge($input: EnablePullRequestAutoMergeInput!) {
        enablePullRequestAutoMerge(input: $input) { pullRequest { ${workflowFields} } }
      }`
    : `mutation PrdrDisableAutoMerge($input: DisablePullRequestAutoMergeInput!) {
        disablePullRequestAutoMerge(input: $input) { pullRequest { ${workflowFields} } }
      }`;

export const setPullRequestAutoMerge = Effect.fn('PullRequestLifecycle.autoMerge')(
  function* setPullRequestAutoMerge(
    target: PullRequestTarget,
    action: 'disable' | 'enable',
    expectedHead: string,
    strategy: MergeStrategy | null,
  ) {
    const operation = `auto-merge ${action}`;
    if (action === 'enable' && strategy === null) {
      return yield* PullRequestInputError.make({
        detail: '--strategy is required when auto-merge is enabled.',
        operation,
      });
    }
    if (action === 'disable' && strategy !== null) {
      return yield* PullRequestInputError.make({
        detail: '--strategy is not accepted when auto-merge is disabled.',
        operation,
      });
    }
    const before = yield* loadWorkflowPullRequest(target);
    yield* ensureExpectedHead(before, expectedHead, operation);
    yield* requirePullRequestPermission(before, operation, `auto-${action}`);
    if (before.state !== 'OPEN' || before.isDraft) {
      return yield* StateConflictError.make({
        actual: before.state,
        expected: 'open and ready',
        operation,
      });
    }
    const enabledBefore = before.autoMergeRequest !== null;
    if (enabledBefore === (action === 'enable')) {
      return yield* StateConflictError.make({
        actual: enabledBefore ? 'enabled' : 'disabled',
        expected: enabledBefore ? 'disabled' : 'enabled',
        operation,
      });
    }
    const input =
      action === 'enable'
        ? {
            expectedHeadOid: expectedHead,
            mergeMethod: strategy === null ? '' : strategy.toUpperCase(),
            pullRequestId: before.id,
          }
        : { pullRequestId: before.id };
    yield* runWorkflowMutation(target, operation, autoMergeMutation(action), { input });
    const after = yield* loadWorkflowPullRequest(target);
    const verified =
      action === 'enable'
        ? after.autoMergeRequest?.mergeMethod.toLowerCase() === strategy
        : after.autoMergeRequest === null;
    if (!verified || after.headRefOid !== expectedHead) {
      return yield* PullRequestVerificationError.make({
        detail: 'Auto-merge state differs.',
        operation,
      });
    }
    return { action, after: compactWorkflowState(after), before: compactWorkflowState(before) };
  },
);

const queueMutation = (action: 'dequeue' | 'enqueue'): string =>
  action === 'enqueue'
    ? 'mutation PrdrEnqueue($input: EnqueuePullRequestInput!) { enqueuePullRequest(input: $input) { mergeQueueEntry { state position } } }'
    : 'mutation PrdrDequeue($input: DequeuePullRequestInput!) { dequeuePullRequest(input: $input) { mergeQueueEntry { state position } } }';

export const setPullRequestQueue = Effect.fn('PullRequestLifecycle.queue')(
  function* setPullRequestQueue(
    target: PullRequestTarget,
    action: 'dequeue' | 'enqueue',
    expectedHead: string,
  ) {
    const operation = `queue ${action}`;
    const before = yield* loadWorkflowPullRequest(target);
    yield* ensureExpectedHead(before, expectedHead, operation);
    yield* requirePullRequestPermission(before, operation, 'write');
    if (before.state !== 'OPEN' || before.isDraft) {
      return yield* StateConflictError.make({
        actual: before.state,
        expected: 'open and ready',
        operation,
      });
    }
    const queuedBefore = before.mergeQueueEntry !== null;
    if (queuedBefore === (action === 'enqueue')) {
      return yield* StateConflictError.make({
        actual: queuedBefore ? 'queued' : 'not queued',
        expected: queuedBefore ? 'not queued' : 'queued',
        operation,
      });
    }
    const input =
      action === 'enqueue'
        ? { expectedHeadOid: expectedHead, pullRequestId: before.id }
        : { id: before.id };
    yield* runWorkflowMutation(target, operation, queueMutation(action), { input });
    const after = yield* loadWorkflowPullRequest(target);
    const verified =
      action === 'enqueue' ? after.mergeQueueEntry !== null : after.mergeQueueEntry === null;
    if (!verified || after.headRefOid !== expectedHead) {
      return yield* PullRequestVerificationError.make({
        detail: 'Merge queue state differs.',
        operation,
      });
    }
    return { action, after: compactWorkflowState(after), before: compactWorkflowState(before) };
  },
);

const archiveMutation = (action: 'archive' | 'unarchive'): string =>
  action === 'archive'
    ? `mutation PrdrArchive($input: ArchivePullRequestInput!) {
        archivePullRequest(input: $input) { pullRequest { ${workflowFields} } }
      }`
    : `mutation PrdrUnarchive($input: UnarchivePullRequestInput!) {
        unarchivePullRequest(input: $input) { pullRequest { ${workflowFields} } }
      }`;

const setArchived = Effect.fn('PullRequestLifecycle.setArchived')(function* setArchived(
  target: PullRequestTarget,
  action: 'archive' | 'unarchive',
  expectedHead: string,
) {
  const operation = action;
  const before = yield* loadWorkflowPullRequest(target);
  yield* ensureExpectedHead(before, expectedHead, operation);
  yield* requirePullRequestPermission(before, operation, 'admin');
  const response = yield* runWorkflowMutation(target, operation, archiveMutation(action), {
    input: { pullRequestId: before.id },
  });
  const after = yield* loadWorkflowPullRequest(target);
  const payload =
    action === 'archive'
      ? response.data?.archivePullRequest?.pullRequest
      : response.data?.unarchivePullRequest?.pullRequest;
  const payloadMatches =
    payload !== undefined &&
    payload !== null &&
    payload.number === target.number &&
    payload.repository.nameWithOwner.toLowerCase() === target.nameWithOwner.toLowerCase() &&
    payload.headRefOid === expectedHead;
  const visibleStateMatches = action === 'unarchive' || (after.state === 'CLOSED' && after.locked);
  if (!payloadMatches || !visibleStateMatches || after.headRefOid !== expectedHead) {
    return yield* PullRequestVerificationError.make({
      detail:
        'GitHub did not confirm the archive action with matching identity, head, and visible state.',
      operation,
    });
  }
  return {
    action,
    after: {
      ...compactWorkflowState(after),
      archiveState: action === 'archive' ? ('archived' as const) : ('unarchived' as const),
    },
    before: compactWorkflowState(before),
    verification: 'mutation-payload-and-readback' as const,
  };
});

export const archivePullRequest = Effect.fn('PullRequestLifecycle.archive')(
  function* archivePullRequest(target: PullRequestTarget, expectedHead: string) {
    return yield* setArchived(target, 'archive', expectedHead);
  },
);

export const unarchivePullRequest = Effect.fn('PullRequestLifecycle.unarchive')(
  function* unarchivePullRequest(target: PullRequestTarget, expectedHead: string) {
    return yield* setArchived(target, 'unarchive', expectedHead);
  },
);
