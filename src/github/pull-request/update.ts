import { createHash } from 'node:crypto';

import { Effect, Schema } from 'effect';

import type { PullRequestTarget } from '../../domain/model';
import {
  PullRequestInputError,
  PullRequestVerificationError,
  StateConflictError,
} from '../../domain/pull-request-errors';
import { ReviewerSetResponse } from '../../domain/pull-request-raw';
import { loadRemoteBranch } from '../create-pull-request';
import { apiWrite } from '../mutations';
import { loadRestResource } from '../rest';
import {
  compactWorkflowState,
  ensureExpectedHead,
  loadWorkflowPullRequest,
  requirePullRequestPermission,
  runWorkflowMutation,
  workflowFields,
} from './state';

export interface UpdatePullRequestInput {
  readonly base: string | null;
  readonly body: string | null;
  readonly expectedHead: string;
  readonly title: string | null;
}

const updateMutation = `mutation PrdrUpdate($input: UpdatePullRequestInput!) {
  updatePullRequest(input: $input) { pullRequest { ${workflowFields} } }
}`;

const singleLine = Effect.fn('PullRequestUpdate.singleLine')(function* singleLine(
  name: string,
  value: string,
) {
  if (value === '' || value.trim() !== value || /\p{Cc}|\p{Zl}|\p{Zp}/u.test(value)) {
    return yield* PullRequestInputError.make({
      detail: `${name} must be one non-empty line without outer whitespace or control characters.`,
      operation: 'update',
    });
  }
  return value;
});

const updateMatches = (
  pullRequest: {
    readonly baseRefName: string;
    readonly body: string;
    readonly headRefOid: string;
    readonly title: string;
  },
  input: UpdatePullRequestInput,
  base: string | null,
  title: string | null,
): boolean =>
  pullRequest.headRefOid === input.expectedHead &&
  (base === null || pullRequest.baseRefName === base) &&
  (input.body === null || pullRequest.body === input.body) &&
  (title === null || pullRequest.title === title);

export const updatePullRequest = Effect.fn('PullRequestUpdate.update')(function* updatePullRequest(
  target: PullRequestTarget,
  input: UpdatePullRequestInput,
) {
  if (input.base === null && input.body === null && input.title === null) {
    return yield* PullRequestInputError.make({
      detail: 'Specify at least one of base, body, or title.',
      operation: 'update',
    });
  }
  const base = input.base === null ? null : yield* singleLine('--base', input.base);
  const title = input.title === null ? null : yield* singleLine('--title', input.title);
  const before = yield* loadWorkflowPullRequest(target);
  yield* ensureExpectedHead(before, input.expectedHead, 'update');
  yield* requirePullRequestPermission(before, 'update', 'update');
  if (before.merged) {
    return yield* StateConflictError.make({
      actual: 'merged',
      expected: 'active',
      operation: 'update',
    });
  }
  if (base !== null) {
    yield* loadRemoteBranch(target, base);
  }
  const mutationInput = {
    ...(base !== null && { baseRefName: base }),
    ...(input.body !== null && { body: input.body }),
    pullRequestId: before.id,
    ...(title !== null && { title }),
  };
  yield* runWorkflowMutation(target, 'update', updateMutation, { input: mutationInput });
  const after = yield* loadWorkflowPullRequest(target);
  if (!updateMatches(after, input, base, title)) {
    return yield* PullRequestVerificationError.make({
      detail: 'The final title, body, base, or head differs.',
      operation: 'update',
    });
  }
  return {
    after: compactWorkflowState(after),
    before: compactWorkflowState(before),
    changes: {
      ...(base !== null && { base }),
      ...(input.body !== null && {
        bodyBytes: Buffer.byteLength(input.body, 'utf8'),
        bodySha256: createHash('sha256').update(input.body, 'utf8').digest('hex'),
      }),
      ...(title !== null && { title }),
    },
    number: after.number,
    repo: after.repository.nameWithOwner,
    url: after.url,
  };
});

const ReviewerRequest = Schema.Struct({
  reviewers: Schema.Array(Schema.String),
  team_reviewers: Schema.Array(Schema.String),
});

const normalized = (values: readonly string[]): readonly string[] =>
  Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value !== '')),
  ).toSorted();

const reviewerSet = (response: ReviewerSetResponse) => ({
  teams: response.teams.map(({ slug }) => slug).toSorted(),
  users: response.users.map(({ login }) => login).toSorted(),
});

export const managePullRequestReviewers = Effect.fn('PullRequestUpdate.reviewers')(
  function* managePullRequestReviewers(
    target: PullRequestTarget,
    action: 'remove' | 'request',
    expectedHead: string,
    usersInput: readonly string[],
    teamsInput: readonly string[],
  ) {
    const operation = `reviewers ${action}`;
    const users = normalized(usersInput);
    const teams = normalized(teamsInput);
    if (users.length === 0 && teams.length === 0) {
      return yield* PullRequestInputError.make({
        detail: 'Specify at least one user or team.',
        operation,
      });
    }
    const before = yield* loadWorkflowPullRequest(target);
    yield* ensureExpectedHead(before, expectedHead, operation);
    yield* requirePullRequestPermission(before, operation, 'update');
    if (before.state !== 'OPEN') {
      return yield* StateConflictError.make({ actual: before.state, expected: 'OPEN', operation });
    }
    const endpoint = `repos/${target.nameWithOwner}/pulls/${target.number}/requested_reviewers`;
    yield* apiWrite(target, {
      endpoint,
      method: action === 'request' ? 'POST' : 'DELETE',
      operation,
      request: { reviewers: users, team_reviewers: teams },
      requestSchema: ReviewerRequest,
      responseSchema: Schema.Unknown,
    });
    const current = yield* loadRestResource(target, endpoint, ReviewerSetResponse);
    const result = reviewerSet(current);
    const currentUsers = new Set(result.users);
    const currentTeams = new Set(result.teams);
    const verified =
      action === 'request'
        ? users.every((user) => currentUsers.has(user)) &&
          teams.every((team) => currentTeams.has(team))
        : users.every((user) => !currentUsers.has(user)) &&
          teams.every((team) => !currentTeams.has(team));
    const after = yield* loadWorkflowPullRequest(target);
    if (!verified || after.headRefOid !== expectedHead) {
      return yield* PullRequestVerificationError.make({
        detail: 'The requested-reviewer set or head differs.',
        operation,
      });
    }
    return {
      action,
      after: compactWorkflowState(after),
      before: compactWorkflowState(before),
      reviewers: result,
    };
  },
);
