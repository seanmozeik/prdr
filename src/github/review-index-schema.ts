import { Schema } from 'effect';

const NullableString = Schema.NullOr(Schema.String);
const NullableInt = Schema.NullOr(Schema.Int);

export const ReviewIndexActor = Schema.NullOr(
  Schema.Struct({ __typename: Schema.String, login: Schema.String }),
);

export const ReviewIndexPageInfo = Schema.Struct({
  endCursor: NullableString,
  hasNextPage: Schema.Boolean,
});

const ReviewIndexIssueComment = Schema.Struct({
  author: ReviewIndexActor,
  body: Schema.String,
  createdAt: Schema.String,
  databaseId: NullableInt,
  id: Schema.String,
  updatedAt: Schema.String,
  url: Schema.String,
});

const ReviewIndexReviewComment = Schema.Struct({
  author: ReviewIndexActor,
  body: Schema.String,
  createdAt: Schema.String,
  databaseId: NullableInt,
  id: Schema.String,
  line: NullableInt,
  originalLine: NullableInt,
  path: Schema.String,
  replyTo: Schema.NullOr(Schema.Struct({ databaseId: NullableInt, id: Schema.String })),
  updatedAt: Schema.String,
  url: Schema.String,
});

const ReviewIndexReview = Schema.Struct({
  author: ReviewIndexActor,
  body: Schema.String,
  comments: Schema.Struct({
    nodes: Schema.Array(ReviewIndexReviewComment),
    totalCount: Schema.Int,
  }),
  commit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
  fullDatabaseId: Schema.String,
  id: Schema.String,
  state: Schema.String,
  submittedAt: NullableString,
  url: Schema.String,
});

const ReviewIndexThread = Schema.Struct({
  comments: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        replyTo: Schema.NullOr(Schema.Struct({ id: Schema.String })),
      }),
    ),
    totalCount: Schema.Int,
  }),
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

const CheckRun = Schema.Struct({
  __typename: Schema.Literal('CheckRun'),
  checkSuite: Schema.NullOr(
    Schema.Struct({
      workflowRun: Schema.NullOr(
        Schema.Struct({
          event: Schema.String,
          workflow: Schema.NullOr(Schema.Struct({ name: Schema.String })),
        }),
      ),
    }),
  ),
  completedAt: NullableString,
  conclusion: NullableString,
  detailsUrl: NullableString,
  name: Schema.String,
  startedAt: NullableString,
  status: Schema.String,
});

const StatusContext = Schema.Struct({
  __typename: Schema.Literal('StatusContext'),
  context: Schema.String,
  createdAt: Schema.String,
  state: Schema.String,
  targetUrl: NullableString,
});

const ReviewIndexCheck = Schema.Union([CheckRun, StatusContext]);

const connection = <A, E>(item: Schema.Codec<A, E>) =>
  Schema.Struct({ nodes: Schema.Array(item), pageInfo: ReviewIndexPageInfo });

export const ReviewIndexPullRequest = Schema.Struct({
  author: ReviewIndexActor,
  baseRefName: Schema.String,
  comments: Schema.optionalKey(connection(ReviewIndexIssueComment)),
  headRefName: Schema.String,
  headRefOid: Schema.String,
  isDraft: Schema.Boolean,
  mergeStateStatus: Schema.String,
  number: Schema.Int,
  reviewDecision: NullableString,
  reviews: Schema.optionalKey(connection(ReviewIndexReview)),
  reviewThreads: Schema.optionalKey(connection(ReviewIndexThread)),
  state: Schema.String,
  statusCheckRollup: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ contexts: connection(ReviewIndexCheck) })),
  ),
  title: Schema.String,
  updatedAt: Schema.String,
  url: Schema.String,
});

export const ReviewIndexResponse = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({ pullRequest: Schema.NullOr(ReviewIndexPullRequest) }),
        ),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

export type RawReviewIndexActor = NonNullable<typeof ReviewIndexActor.Type>;
export type RawReviewIndexCheck = typeof ReviewIndexCheck.Type;
export type RawReviewIndexIssueComment = typeof ReviewIndexIssueComment.Type;
export type RawReviewIndexPullRequest = typeof ReviewIndexPullRequest.Type;
export type RawReviewIndexReview = typeof ReviewIndexReview.Type;
export type RawReviewIndexReviewComment = typeof ReviewIndexReviewComment.Type;
export type RawReviewIndexThread = typeof ReviewIndexThread.Type;
