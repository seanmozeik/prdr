import { Schema } from 'effect';

/** A comment reference is malformed or ambiguous. */
export class CommentReferenceError extends Schema.TaggedError<CommentReferenceError>()(
  'CommentReferenceError',
  { detail: Schema.String, reference: Schema.String },
) {}

/** A requested comment does not exist in the current pull request snapshot. */
export class CommentNotFoundError extends Schema.TaggedError<CommentNotFoundError>()(
  'CommentNotFoundError',
  { reference: Schema.String },
) {}

/** A review comment cannot be mapped to a GitHub review thread. */
export class ThreadNotFoundError extends Schema.TaggedError<ThreadNotFoundError>()(
  'ThreadNotFoundError',
  { reference: Schema.String },
) {}

/** Markdown input was missing, duplicated, or unreadable. */
export class MarkdownInputError extends Schema.TaggedError<MarkdownInputError>()(
  'MarkdownInputError',
  { cause: Schema.optionalKey(Schema.Defect()), detail: Schema.String },
) {}

/** A requested mutation is not valid for the selected GitHub object. */
export class UnsupportedMutationError extends Schema.TaggedError<UnsupportedMutationError>()(
  'UnsupportedMutationError',
  { detail: Schema.String, reference: Schema.String },
) {}
