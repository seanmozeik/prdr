import type { FindingMetadata, PullRequestTarget } from './model';
import type { GhCheck, PullRequestView, RestActor } from './raw';

export interface IndexedIssueComment {
  readonly body: string | null;
  readonly created_at: string;
  readonly html_url: string;
  readonly id: number;
  readonly metadata: FindingMetadata;
  readonly ref: string;
  readonly updated_at: string;
  readonly user: RestActor;
}

export interface IndexedReviewComment extends IndexedIssueComment {
  readonly line: number | null;
  readonly original_line: number | null;
  readonly path: string;
}

export interface IndexedReview {
  readonly body: string;
  readonly html_url: string;
  readonly id: number;
  readonly metadata: FindingMetadata;
  readonly ref: string;
  readonly state: string;
  readonly submitted_at: string | null;
  readonly user: RestActor;
}

export interface IndexedReviewThread {
  readonly comments: readonly IndexedReviewComment[];
  readonly id: string;
  readonly isOutdated: boolean;
  readonly isResolved: boolean;
  readonly line: number | null;
  readonly originalLine: number | null;
  readonly path: string;
  readonly ref: string;
  readonly resolvedBy: string | null;
  readonly root: IndexedReviewComment;
  readonly subjectType: string;
  readonly viewerCanReply: boolean;
  readonly viewerCanResolve: boolean;
  readonly viewerCanUnresolve: boolean;
}

export interface ReviewIndex {
  readonly checks: readonly GhCheck[];
  readonly issueComments: readonly IndexedIssueComment[];
  readonly pullRequest: PullRequestView;
  readonly reviews: readonly IndexedReview[];
  readonly target: PullRequestTarget;
  readonly threads: readonly IndexedReviewThread[];
  readonly unthreadedReviewComments: readonly IndexedReviewComment[];
}

export type IndexedCommentSelection =
  | { readonly comment: IndexedIssueComment; readonly kind: 'issue-comment'; readonly thread: null }
  | {
      readonly comment: IndexedReviewComment;
      readonly kind: 'review-comment';
      readonly thread: IndexedReviewThread | null;
    }
  | { readonly comment: IndexedReview; readonly kind: 'review'; readonly thread: null };

export type ReviewListingSource = Pick<
  ReviewIndex,
  'issueComments' | 'pullRequest' | 'reviews' | 'target' | 'threads' | 'unthreadedReviewComments'
>;

export type GreptileStatusSource = Pick<ReviewIndex, 'issueComments' | 'pullRequest' | 'threads'>;

export type AikidoStatusSource = Pick<ReviewIndex, 'checks' | 'pullRequest' | 'threads'>;
