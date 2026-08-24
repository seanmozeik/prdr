import { Schema } from 'effect';

import type {
  CommentNotFoundError,
  CommentReferenceError,
  MarkdownInputError,
  ThreadNotFoundError,
  UnsupportedMutationError,
} from '../domain/errors';

/** The gh process failed before GitHub returned a usable response. */
export class GhCommandError extends Schema.TaggedError<GhCommandError>()('GhCommandError', {
  arguments: Schema.Array(Schema.String),
  exitCode: Schema.NullOr(Schema.Int),
  stderr: Schema.String,
  stdout: Schema.String,
}) {}

/** GitHub returned JSON that does not match the declared API boundary. */
export class GhDecodeError extends Schema.TaggedError<GhDecodeError>()('GhDecodeError', {
  arguments: Schema.Array(Schema.String),
  cause: Schema.Defect(),
}) {}

/** A typed GitHub request could not be encoded as JSON. */
export class GhEncodeError extends Schema.TaggedError<GhEncodeError>()('GhEncodeError', {
  arguments: Schema.Array(Schema.String),
  cause: Schema.Defect(),
}) {}

/** GitHub GraphQL returned one or more application errors. */
export class GhGraphqlError extends Schema.TaggedError<GhGraphqlError>()('GhGraphqlError', {
  messages: Schema.Array(Schema.String),
}) {}

/** The repository or pull request could not be inferred safely. */
export class TargetResolutionError extends Schema.TaggedError<TargetResolutionError>()(
  'TargetResolutionError',
  { detail: Schema.String },
) {}

/** The pull request changed head commits during a multi-request snapshot. */
export class PullRequestChangedError extends Schema.TaggedError<PullRequestChangedError>()(
  'PullRequestChangedError',
  { after: Schema.String, before: Schema.String },
) {}

/** GitHub returned a partial graph that cannot form a safe pull request snapshot. */
export class SnapshotInvariantError extends Schema.TaggedError<SnapshotInvariantError>()(
  'SnapshotInvariantError',
  { detail: Schema.String },
) {}

/** A GitHub permission prevents the requested thread mutation. */
export class ThreadPermissionError extends Schema.TaggedError<ThreadPermissionError>()(
  'ThreadPermissionError',
  { action: Schema.Literals(['reply', 'resolve', 'unresolve']), threadId: Schema.String },
) {}

export type PrdrError =
  | CommentNotFoundError
  | CommentReferenceError
  | GhCommandError
  | GhDecodeError
  | GhEncodeError
  | GhGraphqlError
  | MarkdownInputError
  | PullRequestChangedError
  | SnapshotInvariantError
  | TargetResolutionError
  | ThreadNotFoundError
  | ThreadPermissionError
  | UnsupportedMutationError;
