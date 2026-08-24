import { Schema } from 'effect';

const NullableString = Schema.NullOr(Schema.String);
const NullableInt = Schema.NullOr(Schema.Int);

export const RestActor = Schema.Struct({
  login: Schema.String,
  type: Schema.optionalKey(Schema.String),
});
export type RestActor = typeof RestActor.Type;

export const PullRequestView = Schema.Struct({
  author: Schema.Struct({ is_bot: Schema.Boolean, login: Schema.String }),
  baseRefName: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  isDraft: Schema.Boolean,
  mergeStateStatus: Schema.String,
  number: Schema.Int,
  reviewDecision: Schema.String,
  state: Schema.String,
  title: Schema.String,
  url: Schema.String,
});
export type PullRequestView = typeof PullRequestView.Type;

export const RepositoryView = Schema.Struct({ nameWithOwner: Schema.String, url: Schema.String });
export type RepositoryView = typeof RepositoryView.Type;

export const RawReviewComment = Schema.Struct({
  body: NullableString,
  created_at: Schema.String,
  diff_hunk: Schema.String,
  html_url: Schema.String,
  id: Schema.Int,
  in_reply_to_id: Schema.optionalKey(NullableInt),
  line: NullableInt,
  node_id: Schema.String,
  original_line: NullableInt,
  original_start_line: Schema.optionalKey(NullableInt),
  path: Schema.String,
  pull_request_review_id: Schema.optionalKey(NullableInt),
  side: Schema.optionalKey(NullableString),
  start_line: Schema.optionalKey(NullableInt),
  start_side: Schema.optionalKey(NullableString),
  subject_type: Schema.optionalKey(Schema.String),
  updated_at: Schema.String,
  user: RestActor,
});
export type RawReviewComment = typeof RawReviewComment.Type;

export const RawIssueComment = Schema.Struct({
  body: NullableString,
  created_at: Schema.String,
  html_url: Schema.String,
  id: Schema.Int,
  node_id: Schema.String,
  updated_at: Schema.String,
  user: RestActor,
});
export type RawIssueComment = typeof RawIssueComment.Type;

export const RawReview = Schema.Struct({
  body: Schema.String,
  commit_id: NullableString,
  html_url: Schema.String,
  id: Schema.Int,
  node_id: Schema.String,
  state: Schema.String,
  submitted_at: NullableString,
  user: RestActor,
});
export type RawReview = typeof RawReview.Type;

export const GhCheck = Schema.Struct({
  bucket: Schema.String,
  completedAt: Schema.String,
  event: Schema.String,
  link: Schema.String,
  name: Schema.String,
  startedAt: Schema.String,
  state: Schema.String,
  workflow: Schema.String,
});
export type GhCheck = typeof GhCheck.Type;

const GraphqlCommentIdentity = Schema.Struct({
  databaseId: Schema.Int,
  id: Schema.String,
  replyTo: Schema.NullOr(Schema.Struct({ databaseId: Schema.Int, id: Schema.String })),
});

export const GraphqlThread = Schema.Struct({
  comments: Schema.Struct({ nodes: Schema.Array(GraphqlCommentIdentity), totalCount: Schema.Int }),
  id: Schema.String,
  isOutdated: Schema.Boolean,
  isResolved: Schema.Boolean,
  line: NullableInt,
  originalLine: NullableInt,
  path: Schema.String,
  resolvedBy: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  subjectType: Schema.String,
  viewerCanReply: Schema.Boolean,
  viewerCanResolve: Schema.Boolean,
  viewerCanUnresolve: Schema.Boolean,
});
export type GraphqlThread = typeof GraphqlThread.Type;

const GraphqlPageInfo = Schema.Struct({ endCursor: NullableString, hasNextPage: Schema.Boolean });

export const ReviewThreadsResponse = Schema.Struct({
  data: Schema.NullOr(
    Schema.Struct({
      repository: Schema.NullOr(
        Schema.Struct({
          pullRequest: Schema.NullOr(
            Schema.Struct({
              reviewThreads: Schema.Struct({
                nodes: Schema.Array(GraphqlThread),
                pageInfo: GraphqlPageInfo,
              }),
            }),
          ),
        }),
      ),
    }),
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});
export type ReviewThreadsResponse = typeof ReviewThreadsResponse.Type;

export const ThreadMutationResponse = Schema.Struct({
  data: Schema.NullOr(
    Schema.Struct({
      resolveReviewThread: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            thread: Schema.Struct({ id: Schema.String, isResolved: Schema.Boolean }),
          }),
        ),
      ),
      unresolveReviewThread: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            thread: Schema.Struct({ id: Schema.String, isResolved: Schema.Boolean }),
          }),
        ),
      ),
    }),
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});
export type ThreadMutationResponse = typeof ThreadMutationResponse.Type;

export const CreatedReviewComment = Schema.Struct({
  body: Schema.String,
  html_url: Schema.String,
  id: Schema.Int,
  node_id: Schema.String,
});
export type CreatedReviewComment = typeof CreatedReviewComment.Type;

export const CreatedIssueComment = Schema.Struct({
  body: Schema.String,
  html_url: Schema.String,
  id: Schema.Int,
  node_id: Schema.String,
});
export type CreatedIssueComment = typeof CreatedIssueComment.Type;

export const CreatedReview = Schema.Struct({
  body: Schema.String,
  html_url: Schema.String,
  id: Schema.Int,
  node_id: Schema.String,
  state: Schema.String,
});
export type CreatedReview = typeof CreatedReview.Type;
