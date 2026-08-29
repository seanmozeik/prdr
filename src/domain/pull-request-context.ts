import { Buffer } from 'node:buffer';

import { Effect, Schema } from 'effect';

import type {
  RawPullRequestCommit,
  RawPullRequestDetail,
  RawPullRequestFile,
  WorkflowPullRequest,
} from './pull-request-raw';
import { ContextPaginationError } from './pull-request-read-errors';
import type { GhCheck } from './raw';
import type { ReviewIndex } from './review-index';
import { findingPreview } from './text';

export const contextPurposes = ['authoring', 'review'] as const;
export type ContextPurpose = (typeof contextPurposes)[number];

export interface ContextPageOptions {
  readonly cursor: string;
  readonly limit: number;
  readonly purpose: ContextPurpose;
}

export interface PullRequestContextSource {
  readonly commits: readonly RawPullRequestCommit[];
  readonly detail: RawPullRequestDetail;
  readonly files: readonly RawPullRequestFile[];
  readonly reviewIndex: ReviewIndex;
  readonly workflow: WorkflowPullRequest;
}

const CURSOR_VERSION = 1 as const;
const MAXIMUM_CURSOR_LENGTH = 4096;
export const DEFAULT_CONTEXT_PAGE_SIZE = 25;

const ContextCursor = Schema.Struct({
  fingerprint: Schema.String,
  head: Schema.String,
  offset: Schema.Int,
  pr: Schema.Int,
  purpose: Schema.Literals(contextPurposes),
  repo: Schema.String,
  version: Schema.Literal(CURSOR_VERSION),
});
type ContextCursor = typeof ContextCursor.Type;
const decodeContextCursorJson = Schema.decodeEffect(Schema.fromJsonString(ContextCursor));

const paginationError = (detail: string): ContextPaginationError =>
  ContextPaginationError.make({ detail });

const decodeCursor = Effect.fn('PullRequestContext.decodeCursor')(function* decodeCursor(
  raw: string,
) {
  if (raw.length === 0) {
    return null;
  }
  if (raw.length > MAXIMUM_CURSOR_LENGTH) {
    return yield* paginationError('The context cursor is too long. Start again without --cursor.');
  }
  const json = yield* Effect.try({
    catch: () => paginationError('The context cursor is invalid. Start again without --cursor.'),
    try: () => Buffer.from(raw, 'base64url').toString('utf8'),
  });
  return yield* decodeContextCursorJson(json).pipe(
    Effect.mapError(() =>
      paginationError('The context cursor is invalid. Start again without --cursor.'),
    ),
  );
});

const commitSummary = (commit: RawPullRequestCommit) => ({
  author: commit.author?.login ?? commit.commit.author?.name ?? '[unknown]',
  committedAt: commit.commit.author?.date ?? '',
  sha: commit.sha,
  title: commit.commit.message.split(/\r?\n/u, 1)[0] ?? '',
});

const fileSummary = (file: RawPullRequestFile) => ({
  additions: file.additions,
  deletions: file.deletions,
  path: file.filename,
  ...(file.previous_filename !== undefined && { previousPath: file.previous_filename }),
  status: file.status,
});

const fileSummaries = (files: readonly RawPullRequestFile[]) => {
  const byPath = new Map<string, ReturnType<typeof fileSummary>>();
  for (const file of files) {
    const summary = fileSummary(file);
    const current = byPath.get(summary.path);
    byPath.set(
      summary.path,
      current === undefined
        ? summary
        : {
            additions: current.additions + summary.additions,
            deletions: current.deletions + summary.deletions,
            path: summary.path,
            ...(current.previousPath !== undefined && { previousPath: current.previousPath }),
            status: current.status === summary.status ? current.status : 'changed',
          },
    );
  }
  return Array.from(byPath.values());
};

const attentionCheck = (check: GhCheck): boolean =>
  check.bucket === 'cancel' || check.bucket === 'fail' || check.bucket === 'pending';

const reviewSummary = (review: ReviewIndex['reviews'][number]) => ({
  author: review.user.login,
  ref: review.ref,
  state: review.state.toLowerCase(),
  summary: findingPreview(review.body, review.metadata.title),
});

const threadSummary = (thread: ReviewIndex['threads'][number], purpose: ContextPurpose) => ({
  author: thread.root.user.login,
  ...(purpose === 'review'
    ? { body: thread.root.body }
    : { summary: findingPreview(thread.root.body, thread.root.metadata.title) }),
  isOutdated: thread.isOutdated,
  line: thread.line ?? thread.originalLine,
  path: thread.path,
  ref: thread.ref,
  replies: Math.max(0, thread.comments.length - 1),
  viewerCanReply: thread.viewerCanReply,
  viewerCanResolve: thread.viewerCanResolve,
});

const normalizedSections = (source: PullRequestContextSource, purpose: ContextPurpose) => ({
  checks: source.reviewIndex.checks
    .filter(attentionCheck)
    .map((check) => ({ bucket: check.bucket, name: check.name, state: check.state.toLowerCase() })),
  commits: source.commits.map(commitSummary),
  files: fileSummaries(source.files),
  reviews: source.reviewIndex.reviews.map(reviewSummary),
  threads: source.reviewIndex.threads
    .filter((thread) => !thread.isResolved)
    .map((thread) => threadSummary(thread, purpose)),
});

const fingerprint = (sections: ReturnType<typeof normalizedSections>): string =>
  new Bun.CryptoHasher('sha256').update(JSON.stringify(sections)).digest('hex');

const encodeCursor = (cursor: ContextCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const sectionPage = <A>(
  items: readonly A[],
  offset: number,
  limit: number,
  total = items.length,
) => {
  const pageItems = items.slice(offset, offset + limit);
  return {
    available: items.length,
    items: pageItems,
    total,
    truncated: offset + pageItems.length < total,
  };
};

const cursorMatchesSource = (
  cursor: ContextCursor,
  source: PullRequestContextSource,
  purpose: ContextPurpose,
  currentFingerprint: string,
): boolean =>
  cursor.fingerprint === currentFingerprint &&
  cursor.head === source.workflow.headRefOid &&
  cursor.pr === source.workflow.number &&
  cursor.purpose === purpose &&
  cursor.repo.toLowerCase() === source.workflow.repository.nameWithOwner.toLowerCase();

export const paginatePullRequestContext = Effect.fn('PullRequestContext.paginate')(
  function* paginatePullRequestContext(
    source: PullRequestContextSource,
    options: ContextPageOptions,
  ) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      return yield* paginationError('--limit must be a safe integer from 1 through 100.');
    }
    const cursor = yield* decodeCursor(options.cursor);
    const sections = normalizedSections(source, options.purpose);
    const currentFingerprint = fingerprint(sections);
    if (
      cursor !== null &&
      !cursorMatchesSource(cursor, source, options.purpose, currentFingerprint)
    ) {
      return yield* paginationError(
        'The context changed or the cursor has a different target. Start again without --cursor.',
      );
    }
    const offset = cursor?.offset ?? 0;
    const pages = {
      checks: sectionPage(sections.checks, offset, options.limit),
      commits: sectionPage(sections.commits, offset, options.limit),
      files: sectionPage(sections.files, offset, options.limit, source.detail.changed_files),
      reviews: sectionPage(sections.reviews, offset, options.limit),
      threads: sectionPage(sections.threads, offset, options.limit),
    };
    const hasMore = Object.values(pages).some(
      ({ available }) => offset + options.limit < available,
    );
    const nextCursor = hasMore
      ? encodeCursor({
          fingerprint: currentFingerprint,
          head: source.workflow.headRefOid,
          offset: offset + options.limit,
          pr: source.workflow.number,
          purpose: options.purpose,
          repo: source.workflow.repository.nameWithOwner,
          version: CURSOR_VERSION,
        })
      : null;
    return {
      author: source.detail.user?.login ?? '[deleted]',
      base: { ref: source.workflow.baseRefName, sha: source.workflow.baseRefOid },
      body: source.detail.body ?? '',
      checks: pages.checks,
      commits: pages.commits,
      diff: {
        additions: source.detail.additions,
        deletions: source.detail.deletions,
        files: source.detail.changed_files,
      },
      files: pages.files,
      hasMore,
      head: {
        ref: source.workflow.headRefName,
        repo: source.detail.head.repo?.full_name ?? '[deleted]',
        sha: source.workflow.headRefOid,
      },
      lifecycle: {
        archiveState: 'not-exposed' as const,
        draft: source.workflow.isDraft,
        locked: source.workflow.locked,
        mergeState: source.workflow.mergeStateStatus.toLowerCase(),
        reviewDecision: source.workflow.reviewDecision?.toLowerCase() ?? null,
        state: source.workflow.merged ? 'merged' : source.workflow.state.toLowerCase(),
      },
      nextCursor,
      purpose: options.purpose,
      reviews: pages.reviews,
      target: {
        pr: source.workflow.number,
        repo: source.workflow.repository.nameWithOwner,
        url: source.workflow.url,
      },
      threads: pages.threads,
      title: source.detail.title,
    };
  },
);
