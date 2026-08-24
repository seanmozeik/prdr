import { Effect } from 'effect';

import { CommentNotFoundError, ThreadNotFoundError } from './errors';
import type {
  CommentSelection,
  ConversationSnapshot,
  ReviewComment,
  ReviewThread,
  ThreadSnapshot,
} from './model';
import { parseCommentReference, parseThreadReference } from './references';
import type {
  IndexedCommentSelection,
  IndexedReviewComment,
  IndexedReviewThread,
  ReviewIndex,
} from './review-index';

const reviewComments = (snapshot: ThreadSnapshot): readonly ReviewComment[] => [
  ...snapshot.threads.flatMap((thread) => thread.comments),
  ...snapshot.unthreadedReviewComments,
];

const threadForComment = (snapshot: ThreadSnapshot, commentId: number): ReviewThread | null =>
  snapshot.threads.find((thread) => thread.comments.some((comment) => comment.id === commentId)) ??
  null;

export const selectComment = Effect.fn('Selection.comment')(function* selectComment(
  snapshot: ConversationSnapshot,
  reference: string,
) {
  const parsed = yield* parseCommentReference(reference);
  if (parsed.kind === 'review-comment') {
    const comment = reviewComments(snapshot).find((candidate) => candidate.id === parsed.id);
    if (comment !== undefined) {
      return {
        comment,
        kind: 'review-comment',
        thread: threadForComment(snapshot, comment.id),
      } satisfies CommentSelection;
    }
  } else if (parsed.kind === 'issue-comment') {
    const comment = snapshot.issueComments.find((candidate) => candidate.id === parsed.id);
    if (comment !== undefined) {
      return { comment, kind: 'issue-comment', thread: null } satisfies CommentSelection;
    }
  } else {
    const comment = snapshot.reviews.find((candidate) => candidate.id === parsed.id);
    if (comment !== undefined) {
      return { comment, kind: 'review', thread: null } satisfies CommentSelection;
    }
  }
  return yield* CommentNotFoundError.make({ reference });
});

const indexedReviewComments = (snapshot: ReviewIndex): readonly IndexedReviewComment[] => [
  ...snapshot.threads.flatMap((thread) => thread.comments),
  ...snapshot.unthreadedReviewComments,
];

const indexedThreadForComment = (
  snapshot: ReviewIndex,
  commentId: number,
): IndexedReviewThread | null =>
  snapshot.threads.find((thread) => thread.comments.some((comment) => comment.id === commentId)) ??
  null;

export const selectIndexedComment = Effect.fn('Selection.indexedComment')(
  function* selectIndexedComment(snapshot: ReviewIndex, reference: string) {
    const parsed = yield* parseCommentReference(reference);
    if (parsed.kind === 'review-comment') {
      const comment = indexedReviewComments(snapshot).find(
        (candidate) => candidate.id === parsed.id,
      );
      if (comment !== undefined) {
        return {
          comment,
          kind: 'review-comment',
          thread: indexedThreadForComment(snapshot, comment.id),
        } satisfies IndexedCommentSelection;
      }
    } else if (parsed.kind === 'issue-comment') {
      const comment = snapshot.issueComments.find((candidate) => candidate.id === parsed.id);
      if (comment !== undefined) {
        return { comment, kind: 'issue-comment', thread: null } satisfies IndexedCommentSelection;
      }
    } else {
      const comment = snapshot.reviews.find((candidate) => candidate.id === parsed.id);
      if (comment !== undefined) {
        return { comment, kind: 'review', thread: null } satisfies IndexedCommentSelection;
      }
    }
    return yield* CommentNotFoundError.make({ reference });
  },
);

export const selectThread = Effect.fn('Selection.thread')(function* selectThread(
  snapshot: ThreadSnapshot,
  reference: string,
) {
  if (reference.startsWith('thread:')) {
    const id = yield* parseThreadReference(reference);
    const thread = snapshot.threads.find((candidate) => candidate.id === id);
    if (thread === undefined) {
      return yield* ThreadNotFoundError.make({ reference });
    }
    return thread;
  }
  const parsed = yield* parseCommentReference(reference);
  if (parsed.kind !== 'review-comment') {
    return yield* ThreadNotFoundError.make({ reference });
  }
  const thread = threadForComment(snapshot, parsed.id);
  if (thread === null) {
    return yield* ThreadNotFoundError.make({ reference });
  }
  return thread;
});
