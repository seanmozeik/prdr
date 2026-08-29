import { Schema } from 'effect';

const NullableString = Schema.NullOr(Schema.String);
const NullableInt = Schema.NullOr(Schema.Int);
const Actor = Schema.Struct({ login: Schema.String });
const RepositoryIdentity = Schema.Struct({ full_name: Schema.String });
const RefIdentity = Schema.Struct({
  ref: Schema.String,
  repo: Schema.NullOr(RepositoryIdentity),
  sha: Schema.String,
});

export const RawPullRequestDetail = Schema.Struct({
  additions: Schema.Int,
  base: RefIdentity,
  body: NullableString,
  changed_files: Schema.Int,
  commits: Schema.Int,
  deletions: Schema.Int,
  draft: Schema.Boolean,
  head: RefIdentity,
  html_url: Schema.String,
  locked: Schema.Boolean,
  merge_commit_sha: Schema.optionalKey(NullableString),
  mergeable: Schema.NullOr(Schema.Boolean),
  merged: Schema.Boolean,
  node_id: Schema.String,
  number: Schema.Int,
  state: Schema.String,
  title: Schema.String,
  user: Schema.NullOr(Actor),
});
export type RawPullRequestDetail = typeof RawPullRequestDetail.Type;

export const RawPullRequestCommit = Schema.Struct({
  author: Schema.NullOr(Actor),
  commit: Schema.Struct({
    author: Schema.NullOr(Schema.Struct({ date: Schema.String, name: Schema.String })),
    message: Schema.String,
  }),
  sha: Schema.String,
});
export type RawPullRequestCommit = typeof RawPullRequestCommit.Type;

export const RawPullRequestFile = Schema.Struct({
  additions: Schema.Int,
  changes: Schema.Int,
  deletions: Schema.Int,
  filename: Schema.String,
  patch: Schema.optionalKey(NullableString),
  previous_filename: Schema.optionalKey(Schema.String),
  status: Schema.String,
});
export type RawPullRequestFile = typeof RawPullRequestFile.Type;

const WorkflowRepository = Schema.Struct({
  id: Schema.String,
  nameWithOwner: Schema.String,
  viewerPermission: Schema.NullOr(Schema.String),
});

export const WorkflowPullRequest = Schema.Struct({
  autoMergeRequest: Schema.NullOr(Schema.Struct({ mergeMethod: Schema.String })),
  baseRefName: Schema.String,
  baseRefOid: Schema.String,
  body: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  id: Schema.String,
  isDraft: Schema.Boolean,
  locked: Schema.Boolean,
  mergeQueueEntry: Schema.NullOr(
    Schema.Struct({ position: Schema.optionalKey(NullableInt), state: Schema.String }),
  ),
  mergeStateStatus: Schema.String,
  mergeable: Schema.String,
  merged: Schema.Boolean,
  number: Schema.Int,
  repository: WorkflowRepository,
  reviewDecision: Schema.NullOr(Schema.String),
  state: Schema.String,
  title: Schema.String,
  url: Schema.String,
  viewerCanClose: Schema.Boolean,
  viewerCanDisableAutoMerge: Schema.Boolean,
  viewerCanEnableAutoMerge: Schema.Boolean,
  viewerCanMergeAsAdmin: Schema.Boolean,
  viewerCanReopen: Schema.Boolean,
  viewerCanUpdate: Schema.Boolean,
  viewerCanUpdateBranch: Schema.Boolean,
});
export type WorkflowPullRequest = typeof WorkflowPullRequest.Type;

const GraphqlError = Schema.Struct({ message: Schema.String });
export const WorkflowStateResponse = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({ pullRequest: Schema.NullOr(WorkflowPullRequest) }),
        ),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(GraphqlError)),
});

const WorkflowMutationPayload = Schema.NullOr(
  Schema.Struct({ pullRequest: Schema.NullOr(WorkflowPullRequest) }),
);
const QueueMutationPayload = Schema.NullOr(
  Schema.Struct({
    mergeQueueEntry: Schema.NullOr(
      Schema.Struct({ position: Schema.optionalKey(NullableInt), state: Schema.String }),
    ),
  }),
);

export const WorkflowMutationResponse = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        archivePullRequest: Schema.optionalKey(WorkflowMutationPayload),
        closePullRequest: Schema.optionalKey(WorkflowMutationPayload),
        convertPullRequestToDraft: Schema.optionalKey(WorkflowMutationPayload),
        dequeuePullRequest: Schema.optionalKey(QueueMutationPayload),
        disablePullRequestAutoMerge: Schema.optionalKey(WorkflowMutationPayload),
        enablePullRequestAutoMerge: Schema.optionalKey(WorkflowMutationPayload),
        enqueuePullRequest: Schema.optionalKey(QueueMutationPayload),
        markPullRequestReadyForReview: Schema.optionalKey(WorkflowMutationPayload),
        reopenPullRequest: Schema.optionalKey(WorkflowMutationPayload),
        unarchivePullRequest: Schema.optionalKey(WorkflowMutationPayload),
        updatePullRequest: Schema.optionalKey(WorkflowMutationPayload),
        updatePullRequestBranch: Schema.optionalKey(WorkflowMutationPayload),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(GraphqlError)),
});

export const RevertMutationResponse = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        revertPullRequest: Schema.NullOr(
          Schema.Struct({
            pullRequest: Schema.NullOr(WorkflowPullRequest),
            revertPullRequest: Schema.NullOr(WorkflowPullRequest),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(GraphqlError)),
});

export const ReviewerSetResponse = Schema.Struct({
  teams: Schema.Array(Schema.Struct({ slug: Schema.String })),
  users: Schema.Array(Actor),
});
export type ReviewerSetResponse = typeof ReviewerSetResponse.Type;

export const MergeResponse = Schema.Struct({
  merged: Schema.Boolean,
  message: Schema.String,
  sha: NullableString,
});

export const RawCreatedReview = Schema.Struct({
  body: Schema.String,
  commit_id: Schema.String,
  html_url: Schema.String,
  id: Schema.Int,
  node_id: Schema.String,
  state: Schema.String,
});
export type RawCreatedReview = typeof RawCreatedReview.Type;

export const RawCreatedReviewComment = Schema.Struct({
  body: Schema.String,
  line: NullableInt,
  path: Schema.String,
  side: Schema.optionalKey(NullableString),
  start_line: Schema.optionalKey(NullableInt),
  start_side: Schema.optionalKey(NullableString),
});
export type RawCreatedReviewComment = typeof RawCreatedReviewComment.Type;
