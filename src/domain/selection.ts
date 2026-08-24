import { Effect } from 'effect';

import { CommentNotFoundError, CommentReferenceError, ThreadNotFoundError } from './errors';
import type { CommentSelection, PullRequestSnapshot, ReviewComment, ReviewThread } from './model';
import { parseCommentReference, parseThreadReference } from './references';

const reviewComments = (snapshot: PullRequestSnapshot): readonly ReviewComment[] => [
  ...snapshot.threads.flatMap((thread) => thread.comments),
  ...snapshot.unthreadedReviewComments,
];

const threadForComment = (snapshot: PullRequestSnapshot, commentId: number): ReviewThread | null =>
  snapshot.threads.find((thread) => thread.comments.some((comment) => comment.id === commentId)) ??
  null;

export const selectComment = Effect.fn('Selection.comment')(function* selectComment(
  snapshot: PullRequestSnapshot,
  reference: string,
) {
  const parsed = yield* parseCommentReference(reference);
  const matches: CommentSelection[] = [];
  if (parsed.kind === 'unqualified' || parsed.kind === 'review-comment') {
    const comment = reviewComments(snapshot).find((candidate) => candidate.id === parsed.id);
    if (comment !== undefined) {
      matches.push({
        comment,
        kind: 'review-comment',
        thread: threadForComment(snapshot, comment.id),
      });
    }
  }
  if (parsed.kind === 'unqualified' || parsed.kind === 'issue-comment') {
    const comment = snapshot.issueComments.find((candidate) => candidate.id === parsed.id);
    if (comment !== undefined) {
      matches.push({ comment, kind: 'issue-comment', thread: null });
    }
  }
  if (parsed.kind === 'unqualified' || parsed.kind === 'review') {
    const comment = snapshot.reviews.find((candidate) => candidate.id === parsed.id);
    if (comment !== undefined) {
      matches.push({ comment, kind: 'review', thread: null });
    }
  }
  if (matches.length === 0) {
    return yield* new CommentNotFoundError({ reference });
  }
  if (matches.length > 1) {
    return yield* new CommentReferenceError({
      detail: 'The numeric ID matches more than one object. Use a qualified KIND:ID reference.',
      reference,
    });
  }
  const [match] = matches;
  if (match === undefined) {
    return yield* new CommentNotFoundError({ reference });
  }
  return match;
});

export const selectThread = Effect.fn('Selection.thread')(function* selectThread(
  snapshot: PullRequestSnapshot,
  reference: string,
) {
  if (reference.startsWith('thread:')) {
    const id = yield* parseThreadReference(reference);
    const thread = snapshot.threads.find((candidate) => candidate.id === id);
    if (thread === undefined) {
      return yield* new ThreadNotFoundError({ reference });
    }
    return thread;
  }
  const selection = yield* selectComment(snapshot, reference);
  if (selection.thread === null) {
    return yield* new ThreadNotFoundError({ reference });
  }
  return selection.thread;
});
