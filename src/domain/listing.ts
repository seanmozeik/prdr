import type { ConversationSnapshot, FindingSeverity, Provider } from './model';
import { compareText, textPreview } from './text';

export type ListProvider = 'all' | Provider;
export type ListState = 'all' | 'open' | 'resolved' | 'unthreaded';

export interface ListFilters {
  readonly author: string;
  readonly provider: ListProvider;
  readonly state: ListState;
}

export interface ReviewListItem {
  readonly author: string;
  readonly createdAt: string;
  readonly kind: 'issue-comment' | 'review' | 'review-comment';
  readonly line: number | null;
  readonly path: string | null;
  readonly provider: Provider;
  readonly preview: string;
  readonly ref: string;
  readonly replyCount: number;
  readonly severity: FindingSeverity;
  readonly state: 'open' | 'resolved' | 'unthreaded';
  readonly threadRef: string | null;
  readonly title: string | null;
  readonly url: string;
}

const matches = (item: ReviewListItem, filters: ListFilters): boolean =>
  (filters.author.length === 0 || item.author.toLowerCase() === filters.author.toLowerCase()) &&
  (filters.provider === 'all' || item.provider === filters.provider) &&
  (filters.state === 'all' || item.state === filters.state);

export const listReviewItems = (
  snapshot: ConversationSnapshot,
  filters: ListFilters,
): readonly ReviewListItem[] => {
  const threadItems: readonly ReviewListItem[] = snapshot.threads.map((thread) => ({
    author: thread.root.user.login,
    createdAt: thread.root.created_at,
    kind: 'review-comment',
    line: thread.line ?? thread.originalLine,
    path: thread.path,
    provider: thread.root.metadata.provider,
    preview: textPreview(thread.root.body),
    ref: thread.root.ref,
    replyCount: Math.max(0, thread.comments.length - 1),
    severity: thread.root.metadata.severity,
    state: thread.isResolved ? 'resolved' : 'open',
    threadRef: thread.ref,
    title: thread.root.metadata.title,
    url: thread.root.html_url,
  }));
  const unthreadedReviewItems: readonly ReviewListItem[] = snapshot.unthreadedReviewComments.map(
    (comment) => ({
      author: comment.user.login,
      createdAt: comment.created_at,
      kind: 'review-comment',
      line: comment.line ?? comment.original_line,
      path: comment.path,
      provider: comment.metadata.provider,
      preview: textPreview(comment.body),
      ref: comment.ref,
      replyCount: 0,
      severity: comment.metadata.severity,
      state: 'unthreaded',
      threadRef: null,
      title: comment.metadata.title,
      url: comment.html_url,
    }),
  );
  const issueItems: readonly ReviewListItem[] = snapshot.issueComments.map((comment) => ({
    author: comment.user.login,
    createdAt: comment.created_at,
    kind: 'issue-comment',
    line: null,
    path: null,
    provider: comment.metadata.provider,
    preview: textPreview(comment.body),
    ref: comment.ref,
    replyCount: 0,
    severity: comment.metadata.severity,
    state: 'unthreaded',
    threadRef: null,
    title: comment.metadata.title,
    url: comment.html_url,
  }));
  const reviewItems: readonly ReviewListItem[] = snapshot.reviews.map((review) => ({
    author: review.user.login,
    createdAt: review.submitted_at ?? '',
    kind: 'review',
    line: null,
    path: null,
    provider: review.metadata.provider,
    preview: textPreview(review.body),
    ref: review.ref,
    replyCount: 0,
    severity: review.metadata.severity,
    state: 'unthreaded',
    threadRef: null,
    title: review.metadata.title,
    url: review.html_url,
  }));
  return [...threadItems, ...unthreadedReviewItems, ...issueItems, ...reviewItems]
    .filter((item) => matches(item, filters))
    .toSorted(
      (left, right) =>
        compareText(left.createdAt, right.createdAt) || compareText(left.ref, right.ref),
    );
};
