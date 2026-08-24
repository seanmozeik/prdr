import type { GhCheck, PullRequestView, RawIssueComment, RawReview, RawReviewComment } from './raw';

export type Provider = 'aikido' | 'greptile' | 'human' | 'other-bot';
export type FindingSeverity = 'critical' | 'high' | 'info' | 'low' | 'medium' | 'unknown';
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

export interface FindingMetadata {
  readonly provider: Provider;
  readonly severity: FindingSeverity;
  readonly title: string | null;
}

export interface ReviewComment extends RawReviewComment {
  readonly metadata: FindingMetadata;
  readonly ref: string;
}

export interface IssueComment extends RawIssueComment {
  readonly metadata: FindingMetadata;
  readonly ref: string;
}

export interface ReviewSubmission extends RawReview {
  readonly metadata: FindingMetadata;
  readonly ref: string;
}

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

export interface PullRequestSnapshot {
  readonly checks: readonly GhCheck[];
  readonly issueComments: readonly IssueComment[];
  readonly pullRequest: PullRequestView;
  readonly reviews: readonly ReviewSubmission[];
  readonly schemaVersion: 1;
  readonly target: PullRequestTarget;
  readonly threads: readonly ReviewThread[];
  readonly unthreadedReviewComments: readonly ReviewComment[];
}

export interface CommentSelection {
  readonly comment: IssueComment | ReviewComment | ReviewSubmission;
  readonly kind: CommentKind;
  readonly thread: ReviewThread | null;
}

export interface GreptileStatus {
  readonly confidence: number | null;
  readonly lastReviewedCommit: string | null;
  readonly latestSummary: IssueComment | null;
  readonly openThreads: readonly ReviewThread[];
  readonly reviewCount: number | null;
}

export interface AikidoStatus {
  readonly checks: readonly GhCheck[];
  readonly openThreads: readonly ReviewThread[];
}
