import { Schema } from 'effect';

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const NonEmptyString = Schema.String.check(Schema.isNonEmpty());

export const ReviewSide = Schema.Literals(['LEFT', 'RIGHT']);
export type ReviewSide = typeof ReviewSide.Type;

export const ReviewFinding = Schema.Struct({
  body: NonEmptyString,
  line: PositiveInt,
  path: NonEmptyString,
  side: ReviewSide,
  startLine: Schema.optionalKey(PositiveInt),
  startSide: Schema.optionalKey(ReviewSide),
});
export type ReviewFinding = typeof ReviewFinding.Type;

export const ReviewSubmissionInput = Schema.Struct({
  body: Schema.String,
  event: Schema.Literals(['approve', 'comment', 'request-changes']),
  expectedHead: NonEmptyString,
  findings: Schema.Array(ReviewFinding),
});
export type ReviewSubmissionInput = typeof ReviewSubmissionInput.Type;
