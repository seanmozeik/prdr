import type {
  GhCheck,
  PullRequestView,
  RawIssueComment,
  RawReview,
  RawReviewComment,
  RestActor,
} from './raw';

export const providerValues = [
  'aikido',
  'codex',
  'cursor',
  'greptile',
  'human',
  'other-bot',
] as const;
export type Provider = (typeof providerValues)[number];

export const knownFindingSeverityValues = ['critical', 'high', 'info', 'low', 'medium'] as const;
export const findingSeverityValues = [...knownFindingSeverityValues, 'unknown'] as const;
export type FindingSeverity = (typeof findingSeverityValues)[number];
export type CommentKind = 'issue-comment' | 'review' | 'review-comment';

export interface RepositoryTarget {
  readonly host: string;
  readonly name: string;
  readonly nameWithOwner: string;
  readonly owner: string;
}

export interface PullRequestTarget extends RepositoryTarget {
  readonly number: number;
}

export interface PullRequestContext {
  readonly pullRequest: PullRequestView;
  readonly target: PullRequestTarget;
}

export interface FindingMetadata {
  readonly provider: Provider;
  readonly severity: FindingSeverity;
  readonly title: string | null;
}

export type ReviewComment = Omit<RawReviewComment, 'user'> & {
  readonly metadata: FindingMetadata;
  readonly ref: string;
  readonly user: RestActor;
};

export type IssueComment = Omit<RawIssueComment, 'user'> & {
  readonly metadata: FindingMetadata;
  readonly ref: string;
  readonly user: RestActor;
};

export type ReviewSubmission = Omit<RawReview, 'user'> & {
  readonly metadata: FindingMetadata;
  readonly ref: string;
  readonly user: RestActor;
};

export interface ReviewThread {
  readonly comments: readonly ReviewComment[];
  readonly id: string;
  readonly isOutdated: boolean;
  readonly isResolved: boolean;
  readonly line: number | null;
  readonly originalLine: number | null;
  readonly path: string;
  readonly ref: string;
  readonly resolvedBy: string | null;
  readonly root: ReviewComment;
  readonly subjectType: string;
  readonly viewerCanReply: boolean;
  readonly viewerCanResolve: boolean;
  readonly viewerCanUnresolve: boolean;
}

export interface ThreadSnapshot extends PullRequestContext {
  readonly threads: readonly ReviewThread[];
  readonly unthreadedReviewComments: readonly ReviewComment[];
}

export interface ConversationSnapshot extends ThreadSnapshot {
  readonly issueComments: readonly IssueComment[];
  readonly reviews: readonly ReviewSubmission[];
}

export interface GreptileSnapshot extends ThreadSnapshot {
  readonly issueComments: readonly IssueComment[];
}

export interface AikidoSnapshot extends ThreadSnapshot {
  readonly checks: readonly GhCheck[];
}

export interface PullRequestSnapshot extends ConversationSnapshot {
  readonly checks: readonly GhCheck[];
  readonly schemaVersion: 1;
}

export type CommentSelection =
  | { readonly comment: IssueComment; readonly kind: 'issue-comment'; readonly thread: null }
  | {
      readonly comment: ReviewComment;
      readonly kind: 'review-comment';
      readonly thread: ReviewThread | null;
    }
  | { readonly comment: ReviewSubmission; readonly kind: 'review'; readonly thread: null };

export interface ProviderActivity {
  readonly author: string;
  readonly createdAt: string;
  readonly ref: string;
  readonly title: string | null;
  readonly updatedAt: string;
  readonly url: string;
}

export interface ReviewThreadSummary {
  readonly author: string;
  readonly isOutdated: boolean;
  readonly line: number | null;
  readonly path: string;
  readonly replyCount: number;
  readonly rootRef: string;
  readonly severity: FindingSeverity;
  readonly threadRef: string;
  readonly title: string | null;
  readonly url: string;
  readonly viewerCanReply: boolean;
  readonly viewerCanResolve: boolean;
}

export interface GreptileStatus {
  readonly confidence: number | null;
  readonly currentHead: string;
  readonly lastReviewedCommit: string | null;
  readonly latestActivity: ProviderActivity | null;
  readonly latestCompletedReview: ProviderActivity | null;
  readonly openThreads: readonly ReviewThreadSummary[];
  readonly reviewCount: number | null;
}

export interface GreptileWaitResult {
  readonly attempts: number;
  readonly elapsedMilliseconds: number;
  readonly head: string;
  readonly status: GreptileStatus;
}

export interface AikidoStatus {
  readonly checks: readonly GhCheck[];
  readonly currentHead: string;
  readonly openThreads: readonly ReviewThreadSummary[];
}
