import { Schema } from 'effect';

/** A comment reference is malformed or ambiguous. */
export class CommentReferenceError extends Schema.TaggedError<CommentReferenceError>()(
  'CommentReferenceError',
  { detail: Schema.String, reference: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** A requested comment does not exist in the current pull request snapshot. */
export class CommentNotFoundError extends Schema.TaggedError<CommentNotFoundError>()(
  'CommentNotFoundError',
  { reference: Schema.String },
) {
  override get message(): string {
    return `No pull request comment matches ${this.reference}.`;
  }
}

/** A review comment cannot be mapped to a GitHub review thread. */
export class ThreadNotFoundError extends Schema.TaggedError<ThreadNotFoundError>()(
  'ThreadNotFoundError',
  { reference: Schema.String },
) {
  override get message(): string {
    return `No review thread matches ${this.reference}.`;
  }
}

/** Markdown input was missing, duplicated, or unreadable. */
export class MarkdownInputError extends Schema.TaggedError<MarkdownInputError>()(
  'MarkdownInputError',
  { causeMessage: Schema.optionalKey(Schema.String), detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** A requested mutation is not valid for the selected GitHub object. */
export class UnsupportedMutationError extends Schema.TaggedError<UnsupportedMutationError>()(
  'UnsupportedMutationError',
  { detail: Schema.String, reference: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** A list cursor or page size cannot produce a safe, consistent page. */
export class ListPaginationError extends Schema.TaggedError<ListPaginationError>()(
  'ListPaginationError',
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ProviderWaitInputError extends Schema.TaggedError<ProviderWaitInputError>()(
  'ProviderWaitInputError',
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ProviderWaitHeadChangedError extends Schema.TaggedError<ProviderWaitHeadChangedError>()(
  'ProviderWaitHeadChangedError',
  { after: Schema.String, before: Schema.String, provider: Schema.String },
) {
  override get message(): string {
    return `${this.provider} wait stopped because the pull request head changed from ${this.before} to ${this.after}.`;
  }
}

export class ProviderWaitTimeoutError extends Schema.TaggedError<ProviderWaitTimeoutError>()(
  'ProviderWaitTimeoutError',
  { head: Schema.NullOr(Schema.String), provider: Schema.String, timeoutSeconds: Schema.Int },
) {
  override get message(): string {
    const target = this.head === null ? '' : ` for ${this.head}`;
    return `${this.provider} did not complete a review${target} within ${this.timeoutSeconds} seconds.`;
  }
}
