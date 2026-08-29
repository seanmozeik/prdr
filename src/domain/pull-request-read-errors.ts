import { Schema } from 'effect';

export class BoundedPaginationError extends Schema.TaggedError<BoundedPaginationError>()(
  'BoundedPaginationError',
  { actual: Schema.Int, expected: Schema.Int, resource: Schema.String },
) {
  override get message(): string {
    return `${this.resource}: GitHub reported ${this.expected} records, but only ${this.actual} were available through the bounded API.`;
  }
}

export class ContextPaginationError extends Schema.TaggedError<ContextPaginationError>()(
  'ContextPaginationError',
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export class BranchUnavailableError extends Schema.TaggedError<BranchUnavailableError>()(
  'BranchUnavailableError',
  { branch: Schema.String, repo: Schema.String },
) {
  override get message(): string {
    return `GitHub does not expose remote branch ${this.repo}:${this.branch}. Run prdr target --mode branch --branch ${this.branch} to find exact base and head repository candidates.`;
  }
}

export class DiffCoordinateError extends Schema.TaggedError<DiffCoordinateError>()(
  'DiffCoordinateError',
  { detail: Schema.String, path: Schema.String },
) {
  override get message(): string {
    return `${this.path}: ${this.detail}`;
  }
}
