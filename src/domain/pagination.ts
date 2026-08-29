import { Buffer } from 'node:buffer';

import { Effect, Schema } from 'effect';

import { ListPaginationError } from './errors';
import { type ListFilters, listReviewItems, type ReviewListItem } from './listing';
import { providerValues, type PullRequestTarget } from './model';
import type { ReviewListingSource } from './review-index';

const CURSOR_VERSION = 2 as const;
const MAXIMUM_CURSOR_LENGTH = 4096;
const MAXIMUM_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

const CursorFingerprint = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
const CursorReference = Schema.String.check(
  Schema.isPattern(/^(?:issue-comment|review|review-comment):[1-9][0-9]*$/u),
);
const ListCursor = Schema.Struct({
  author: Schema.String,
  createdAt: Schema.String,
  fingerprint: CursorFingerprint,
  headRefOid: Schema.NonEmptyString,
  host: Schema.NonEmptyString,
  nameWithOwner: Schema.NonEmptyString,
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  provider: Schema.Literals(['all', ...providerValues]),
  ref: CursorReference,
  state: Schema.Literals(['all', 'open', 'resolved', 'unthreaded']),
  version: Schema.Literal(CURSOR_VERSION),
});
type ListCursor = typeof ListCursor.Type;
const decodeListCursorJson = Schema.decodeEffect(Schema.fromJsonString(ListCursor));

export interface ListPageOptions {
  readonly cursor: string;
  readonly limit: number;
}

export interface PreparedListPageOptions {
  readonly cursor: ListCursor | null;
  readonly limit: number;
}

export interface ReviewListPage {
  readonly hasMore: boolean;
  readonly headRefOid: string;
  readonly items: readonly ReviewListItem[];
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly target: PullRequestTarget;
  readonly total: number;
}

const paginationError = (detail: string): ListPaginationError =>
  ListPaginationError.make({ detail });

const decodeCursor = Effect.fn('List.decodeCursor')(function* decodeCursor(raw: string) {
  if (raw.length === 0) {
    return null;
  }
  if (raw.length > MAXIMUM_CURSOR_LENGTH) {
    return yield* paginationError('The list cursor is too long. Start again without --cursor.');
  }
  const json = yield* Effect.try({
    catch: () => paginationError('The list cursor is invalid. Start again without --cursor.'),
    try: () => Buffer.from(raw, 'base64url').toString('utf8'),
  });
  const cursor = yield* decodeListCursorJson(json).pipe(
    Effect.mapError(() =>
      paginationError('The list cursor is invalid. Start again without --cursor.'),
    ),
  );
  return cursor;
});

export const prepareListPage = Effect.fn('List.preparePage')(function* prepareListPage(
  options: ListPageOptions,
) {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
    return yield* paginationError('--limit must be a positive safe integer.');
  }
  if (options.limit > MAXIMUM_PAGE_SIZE) {
    return yield* paginationError(`--limit must not exceed ${MAXIMUM_PAGE_SIZE}.`);
  }
  const cursor = yield* decodeCursor(options.cursor);
  return { cursor, limit: options.limit } satisfies PreparedListPageOptions;
});

const normalizedFilters = (filters: ListFilters) => ({
  author: filters.author.toLowerCase(),
  provider: filters.provider,
  state: filters.state,
});

const fingerprint = (items: readonly ReviewListItem[]): string =>
  new Bun.CryptoHasher('sha256').update(JSON.stringify(items)).digest('hex');

const encodeCursor = (cursor: ListCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const cursorMatchesRequest = (
  cursor: ListCursor,
  snapshot: ReviewListingSource,
  filters: ListFilters,
): boolean => {
  const normalized = normalizedFilters(filters);
  return (
    cursor.author === normalized.author &&
    cursor.headRefOid === snapshot.pullRequest.headRefOid &&
    cursor.host === snapshot.target.host &&
    cursor.nameWithOwner === snapshot.target.nameWithOwner &&
    cursor.number === snapshot.target.number &&
    cursor.provider === normalized.provider &&
    cursor.state === normalized.state
  );
};

export const paginateReviewItems = Effect.fn('List.paginateItems')(function* paginateReviewItems(
  snapshot: ReviewListingSource,
  filters: ListFilters,
  options: PreparedListPageOptions,
) {
  const items = listReviewItems(snapshot, filters);
  const currentFingerprint = fingerprint(items);
  const { cursor } = options;
  let start = 0;
  if (cursor !== null) {
    if (!cursorMatchesRequest(cursor, snapshot, filters)) {
      return yield* paginationError(
        'The list cursor does not match this pull request, head commit, or filter set. Start again without --cursor.',
      );
    }
    if (cursor.fingerprint !== currentFingerprint) {
      return yield* paginationError(
        'The review list changed between pages. Start again without --cursor.',
      );
    }
    const cursorIndex = items.findIndex(
      (item) => item.createdAt === cursor.createdAt && item.ref === cursor.ref,
    );
    if (cursorIndex === -1) {
      return yield* paginationError(
        'The list cursor position does not exist. Start again without --cursor.',
      );
    }
    start = cursorIndex + 1;
  }
  const pageItems = items.slice(start, start + options.limit);
  const hasMore = start + pageItems.length < items.length;
  const lastItem = pageItems.at(-1);
  const normalized = normalizedFilters(filters);
  const nextCursor =
    hasMore && lastItem !== undefined
      ? encodeCursor({
          ...normalized,
          createdAt: lastItem.createdAt,
          fingerprint: currentFingerprint,
          headRefOid: snapshot.pullRequest.headRefOid,
          host: snapshot.target.host,
          nameWithOwner: snapshot.target.nameWithOwner,
          number: snapshot.target.number,
          ref: lastItem.ref,
          version: CURSOR_VERSION,
        })
      : null;
  return {
    hasMore,
    headRefOid: snapshot.pullRequest.headRefOid,
    items: pageItems,
    limit: options.limit,
    nextCursor,
    target: snapshot.target,
    total: items.length,
  } satisfies ReviewListPage;
});
