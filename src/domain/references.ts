import { Effect } from 'effect';

import { CommentReferenceError } from './errors';

export type ParsedCommentReference =
  | { readonly id: number; readonly kind: 'issue-comment' }
  | { readonly id: number; readonly kind: 'review' }
  | { readonly id: number; readonly kind: 'review-comment' }
  | { readonly id: number; readonly kind: 'unqualified' };

const qualifiedReferencePattern =
  /^(?<kind>issue-comment|review|review-comment):(?<id>[1-9][0-9]*)$/u;
const numericReferencePattern = /^[1-9][0-9]*$/u;

export const reviewCommentRef = (id: number): string => `review-comment:${id}`;
export const issueCommentRef = (id: number): string => `issue-comment:${id}`;
export const reviewRef = (id: number): string => `review:${id}`;
export const threadRef = (id: string): string => `thread:${id}`;

export const parseCommentReference = Effect.fn('Reference.parseComment')(
  function* parseCommentReference(reference: string) {
    if (numericReferencePattern.test(reference)) {
      return { id: Number(reference), kind: 'unqualified' as const };
    }
    const match = qualifiedReferencePattern.exec(reference);
    const id = match?.groups?.['id'];
    const kind = match?.groups?.['kind'];
    if (id === undefined || kind === undefined) {
      return yield* new CommentReferenceError({
        detail:
          'Use an integer ID or KIND:ID, where KIND is review-comment, issue-comment, or review.',
        reference,
      });
    }
    if (kind === 'review-comment' || kind === 'issue-comment' || kind === 'review') {
      return { id: Number(id), kind };
    }
    return yield* new CommentReferenceError({
      detail: 'The comment reference kind is not supported.',
      reference,
    });
  },
);

export const parseThreadReference = Effect.fn('Reference.parseThread')(
  function* parseThreadReference(reference: string) {
    if (!reference.startsWith('thread:') || reference.length === 'thread:'.length) {
      return yield* new CommentReferenceError({
        detail: 'Use thread:GRAPHQL_ID or a review comment reference.',
        reference,
      });
    }
    return reference.slice('thread:'.length);
  },
);
