import { Schema } from 'effect';

const BranchRevision = Schema.Struct({
  branch: Schema.String,
  repo: Schema.String,
  sha: Schema.String,
});

export const CreatedPullRequest = Schema.Struct({
  base: BranchRevision,
  bodyBytes: Schema.Int,
  bodySha256: Schema.String,
  head: BranchRevision,
  number: Schema.Int,
  readiness: Schema.Literals(['draft', 'ready']),
  repo: Schema.String,
  state: Schema.String,
  title: Schema.String,
  url: Schema.String,
});

export type CreatedPullRequest = typeof CreatedPullRequest.Type;

/** GitHub created the pull request with values that differ from the verified request. */
export class PullRequestCreationVerificationError extends Schema.TaggedError<PullRequestCreationVerificationError>()(
  'PullRequestCreationVerificationError',
  {
    actualHead: Schema.String,
    detail: Schema.String,
    expectedHead: Schema.String,
    number: Schema.Int,
    url: Schema.String,
  },
) {
  override get message(): string {
    return `${this.detail} The pull request exists at ${this.url}.`;
  }
}
