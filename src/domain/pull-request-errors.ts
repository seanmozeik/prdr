import { Schema } from 'effect';

export class PullRequestInputError extends Schema.TaggedError<PullRequestInputError>()(
  'PullRequestInputError',
  { detail: Schema.String, operation: Schema.String },
) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

export class PullRequestIdentityError extends Schema.TaggedError<PullRequestIdentityError>()(
  'PullRequestIdentityError',
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export class StaleHeadError extends Schema.TaggedError<StaleHeadError>()('StaleHeadError', {
  actual: Schema.String,
  expected: Schema.String,
  operation: Schema.String,
}) {
  override get message(): string {
    return `${this.operation}: expected head ${this.expected}, but GitHub has ${this.actual}.`;
  }
}

export class StateConflictError extends Schema.TaggedError<StateConflictError>()(
  'StateConflictError',
  { actual: Schema.String, expected: Schema.String, operation: Schema.String },
) {
  override get message(): string {
    return `${this.operation}: expected ${this.expected}, but the current state is ${this.actual}.`;
  }
}

export class ExistingPullRequestError extends Schema.TaggedError<ExistingPullRequestError>()(
  'ExistingPullRequestError',
  { number: Schema.Int, url: Schema.String },
) {
  override get message(): string {
    return `An open pull request already exists: #${this.number} ${this.url}`;
  }
}

export class PullRequestPermissionError extends Schema.TaggedError<PullRequestPermissionError>()(
  'PullRequestPermissionError',
  { operation: Schema.String, required: Schema.String },
) {
  override get message(): string {
    return `${this.operation}: the current GitHub identity does not have ${this.required}.`;
  }
}

export class UnsupportedRepositoryPolicyError extends Schema.TaggedError<UnsupportedRepositoryPolicyError>()(
  'UnsupportedRepositoryPolicyError',
  { detail: Schema.String, operation: Schema.String },
) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

export class PullRequestValidationError extends Schema.TaggedError<PullRequestValidationError>()(
  'PullRequestValidationError',
  { detail: Schema.String, operation: Schema.String },
) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

export class PullRequestVerificationError extends Schema.TaggedError<PullRequestVerificationError>()(
  'PullRequestVerificationError',
  { detail: Schema.String, operation: Schema.String },
) {
  override get message(): string {
    return `${this.operation}: GitHub did not confirm the requested result. ${this.detail}`;
  }
}
