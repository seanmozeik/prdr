import { Effect, Schema } from 'effect';

import type { PullRequestTarget } from '../../domain/model';
import {
  PullRequestIdentityError,
  PullRequestInputError,
  PullRequestPermissionError,
  PullRequestValidationError,
  StaleHeadError,
  UnsupportedRepositoryPolicyError,
} from '../../domain/pull-request-errors';
import {
  RevertMutationResponse,
  type WorkflowPullRequest,
  WorkflowMutationResponse,
  WorkflowStateResponse,
} from '../../domain/pull-request-raw';
import { decodeGhJson, encodeGhJson, GhClient, ghRequest } from '../client';

export const workflowFields = `
  id number url title body state isDraft locked merged mergeable mergeStateStatus
  reviewDecision headRefName headRefOid baseRefName baseRefOid
  autoMergeRequest { mergeMethod }
  mergeQueueEntry { state position }
  viewerCanClose viewerCanReopen viewerCanUpdate viewerCanUpdateBranch
  viewerCanEnableAutoMerge viewerCanDisableAutoMerge viewerCanMergeAsAdmin
  repository { id nameWithOwner viewerPermission }
`;

export const workflowStateQuery = `
query PrdrWorkflowState($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { ${workflowFields} }
  }
}`;

const GraphqlRequest = Schema.Struct({ query: Schema.String, variables: Schema.JsonObject });

const graphqlArguments = (host: string): readonly string[] => [
  'api',
  'graphql',
  '--hostname',
  host,
  '--input',
  '-',
];

export interface CompactWorkflowState {
  readonly archiveState: 'not-exposed';
  readonly autoMerge: { readonly method: string } | null;
  readonly base: { readonly ref: string; readonly sha: string };
  readonly head: { readonly ref: string; readonly sha: string };
  readonly locked: boolean;
  readonly mergeQueue: { readonly position?: number; readonly state: string } | null;
  readonly readiness: 'draft' | 'ready';
  readonly state: string;
}

export const compactWorkflowState = (pullRequest: WorkflowPullRequest): CompactWorkflowState => ({
  archiveState: 'not-exposed',
  autoMerge:
    pullRequest.autoMergeRequest === null
      ? null
      : { method: pullRequest.autoMergeRequest.mergeMethod.toLowerCase() },
  base: { ref: pullRequest.baseRefName, sha: pullRequest.baseRefOid },
  head: { ref: pullRequest.headRefName, sha: pullRequest.headRefOid },
  locked: pullRequest.locked,
  mergeQueue:
    pullRequest.mergeQueueEntry === null
      ? null
      : {
          ...(pullRequest.mergeQueueEntry.position !== undefined &&
            pullRequest.mergeQueueEntry.position !== null && {
              position: pullRequest.mergeQueueEntry.position,
            }),
          state: pullRequest.mergeQueueEntry.state.toLowerCase(),
        },
  readiness: pullRequest.isDraft ? ('draft' as const) : ('ready' as const),
  state: pullRequest.merged ? ('merged' as const) : pullRequest.state.toLowerCase(),
});

const graphqlError = (
  operation: string,
  messages: readonly string[],
): PullRequestPermissionError | PullRequestValidationError | UnsupportedRepositoryPolicyError => {
  const detail = messages.join('; ');
  if (/forbidden|permission|not authorized|resource not accessible/iu.test(detail)) {
    return PullRequestPermissionError.make({ operation, required: 'permission for this action' });
  }
  if (/not enabled|not supported|merge queue|auto.?merge|repository rule/iu.test(detail)) {
    return UnsupportedRepositoryPolicyError.make({ detail, operation });
  }
  return PullRequestValidationError.make({ detail, operation });
};

export const loadWorkflowPullRequest = Effect.fn('PullRequestState.load')(
  function* loadWorkflowPullRequest(target: PullRequestTarget) {
    const gh = yield* GhClient;
    const arguments_ = graphqlArguments(target.host);
    const input = yield* encodeGhJson(
      GraphqlRequest,
      {
        query: workflowStateQuery,
        variables: { name: target.name, number: target.number, owner: target.owner },
      },
      arguments_,
    );
    const result = yield* gh.run(ghRequest(arguments_, input));
    const response = yield* decodeGhJson(WorkflowStateResponse, result, arguments_);
    const messages = response.errors?.map(({ message }) => message) ?? [];
    if (messages.length > 0) {
      return yield* graphqlError('read pull request state', messages);
    }
    const pullRequest = response.data?.repository?.pullRequest;
    if (pullRequest === undefined || pullRequest === null) {
      return yield* PullRequestIdentityError.make({
        detail: `GitHub did not return ${target.nameWithOwner}#${target.number}.`,
      });
    }
    if (
      pullRequest.number !== target.number ||
      pullRequest.repository.nameWithOwner.toLowerCase() !== target.nameWithOwner.toLowerCase()
    ) {
      return yield* PullRequestIdentityError.make({
        detail: 'GitHub returned a pull request with a different repository or number.',
      });
    }
    return pullRequest;
  },
);

export const runWorkflowMutation = Effect.fn('PullRequestState.mutate')(
  function* runWorkflowMutation(
    target: PullRequestTarget,
    operation: string,
    query: string,
    variables: Schema.JsonObject,
  ) {
    const gh = yield* GhClient;
    const arguments_ = graphqlArguments(target.host);
    const input = yield* encodeGhJson(GraphqlRequest, { query, variables }, arguments_);
    const result = yield* gh.run(ghRequest(arguments_, input));
    const response = yield* decodeGhJson(WorkflowMutationResponse, result, arguments_);
    const messages = response.errors?.map(({ message }) => message) ?? [];
    if (messages.length > 0) {
      return yield* graphqlError(operation, messages);
    }
    return response;
  },
);

export const runRevertMutation = Effect.fn('PullRequestState.revert')(function* runRevertMutation(
  target: PullRequestTarget,
  query: string,
  variables: Schema.JsonObject,
) {
  const gh = yield* GhClient;
  const arguments_ = graphqlArguments(target.host);
  const input = yield* encodeGhJson(GraphqlRequest, { query, variables }, arguments_);
  const result = yield* gh.run(ghRequest(arguments_, input));
  const response = yield* decodeGhJson(RevertMutationResponse, result, arguments_);
  const messages = response.errors?.map(({ message }) => message) ?? [];
  if (messages.length > 0) {
    return yield* graphqlError('revert', messages);
  }
  return response;
});

export const ensureExpectedHead = Effect.fn('PullRequestState.ensureExpectedHead')(
  function* ensureExpectedHead(
    pullRequest: WorkflowPullRequest,
    expectedHead: string,
    operation: string,
  ) {
    if (!/^[0-9a-f]{40}$/iu.test(expectedHead)) {
      return yield* PullRequestInputError.make({
        detail: 'The expected head must be one complete 40-character commit SHA.',
        operation,
      });
    }
    if (pullRequest.headRefOid !== expectedHead) {
      return yield* StaleHeadError.make({
        actual: pullRequest.headRefOid,
        expected: expectedHead,
        operation,
      });
    }
    return yield* Effect.void;
  },
);

type PullRequestPermission =
  | 'admin'
  | 'auto-disable'
  | 'auto-enable'
  | 'close'
  | 'read'
  | 'reopen'
  | 'update'
  | 'update-branch'
  | 'write';

const permissionAllowed = (
  pullRequest: WorkflowPullRequest,
  permission: PullRequestPermission,
): boolean => {
  const viewerPermission = pullRequest.repository.viewerPermission ?? '';
  switch (permission) {
    case 'admin': {
      return viewerPermission === 'ADMIN';
    }
    case 'write': {
      return ['ADMIN', 'MAINTAIN', 'WRITE'].includes(viewerPermission);
    }
    case 'read': {
      return ['ADMIN', 'MAINTAIN', 'READ', 'TRIAGE', 'WRITE'].includes(viewerPermission);
    }
    case 'close': {
      return pullRequest.viewerCanClose;
    }
    case 'reopen': {
      return pullRequest.viewerCanReopen;
    }
    case 'update': {
      return pullRequest.viewerCanUpdate;
    }
    case 'update-branch': {
      return pullRequest.viewerCanUpdateBranch;
    }
    case 'auto-enable': {
      return pullRequest.viewerCanEnableAutoMerge;
    }
    case 'auto-disable': {
      return pullRequest.viewerCanDisableAutoMerge;
    }
    default: {
      return false;
    }
  }
};

export const requirePullRequestPermission = Effect.fn('PullRequestState.requirePermission')(
  function* requirePullRequestPermission(
    pullRequest: WorkflowPullRequest,
    operation: string,
    permission: PullRequestPermission,
  ) {
    if (!permissionAllowed(pullRequest, permission)) {
      return yield* PullRequestPermissionError.make({ operation, required: permission });
    }
    return yield* Effect.void;
  },
);
