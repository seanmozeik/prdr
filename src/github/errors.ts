import { Schema } from 'effect';

/** The gh process failed before GitHub returned a usable response. */
export class GhCommandError extends Schema.TaggedError<GhCommandError>()('GhCommandError', {
  arguments: Schema.Array(Schema.String),
  exitCode: Schema.NullOr(Schema.Int),
  stderr: Schema.String,
  stdout: Schema.String,
}) {
  override get message(): string {
    const processOutput = this.stderr.trim() || this.stdout.trim();
    if (processOutput !== '') {
      return processOutput;
    }
    const command = this.arguments.length === 0 ? 'gh' : `gh ${this.arguments.join(' ')}`;
    return this.exitCode === null
      ? `Could not start ${command}.`
      : `${command} exited with status ${this.exitCode}.`;
  }
}

/** GitHub returned JSON that does not match the declared API boundary. */
export class GhDecodeError extends Schema.TaggedError<GhDecodeError>()('GhDecodeError', {
  arguments: Schema.Array(Schema.String),
  causeMessage: Schema.String,
}) {
  override get message(): string {
    return `GitHub returned invalid JSON for gh ${this.arguments.join(' ')}.`;
  }
}

/** A typed GitHub request could not be encoded as JSON. */
export class GhEncodeError extends Schema.TaggedError<GhEncodeError>()('GhEncodeError', {
  arguments: Schema.Array(Schema.String),
  causeMessage: Schema.String,
}) {
  override get message(): string {
    return `Could not encode the JSON input for gh ${this.arguments.join(' ')}.`;
  }
}

/** GitHub GraphQL returned one or more application errors. */
export class GhGraphqlError extends Schema.TaggedError<GhGraphqlError>()('GhGraphqlError', {
  messages: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return this.messages.length === 0
      ? 'GitHub GraphQL returned an unspecified error.'
      : this.messages.join('; ');
  }
}

/** The repository or pull request could not be inferred safely. */
export class TargetResolutionError extends Schema.TaggedError<TargetResolutionError>()(
  'TargetResolutionError',
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** The pull request changed head commits during a multi-request snapshot. */
export class PullRequestChangedError extends Schema.TaggedError<PullRequestChangedError>()(
  'PullRequestChangedError',
  { after: Schema.String, before: Schema.String },
) {
  override get message(): string {
    return `The pull request head changed from ${this.before} to ${this.after} during the read.`;
  }
}

/** Pull request review data did not settle across repeated complete reads. */
export class SnapshotChangedError extends Schema.TaggedError<SnapshotChangedError>()(
  'SnapshotChangedError',
  { attempts: Schema.Int },
) {
  override get message(): string {
    return `The pull request review state did not settle across ${this.attempts} complete reads.`;
  }
}

/** A selected GitHub object changed after it was read and before its mutation. */
export class SelectedObjectChangedError extends Schema.TaggedError<SelectedObjectChangedError>()(
  'SelectedObjectChangedError',
  { detail: Schema.String, reference: Schema.String },
) {
  override get message(): string {
    return `${this.reference} changed before the mutation: ${this.detail}`;
  }
}

/** GitHub returned a partial graph that cannot form a safe pull request snapshot. */
export class SnapshotInvariantError extends Schema.TaggedError<SnapshotInvariantError>()(
  'SnapshotInvariantError',
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** A GitHub permission prevents the requested thread mutation. */
export class ThreadPermissionError extends Schema.TaggedError<ThreadPermissionError>()(
  'ThreadPermissionError',
  { action: Schema.Literals(['reply', 'resolve', 'unresolve']), threadId: Schema.String },
) {
  override get message(): string {
    return `GitHub does not permit ${this.action} for review thread ${this.threadId}.`;
  }
}
