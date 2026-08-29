import { Buffer } from 'node:buffer';

import { Effect, Schema } from 'effect';

import { PullRequestInputError, StaleHeadError } from '../../domain/pull-request-errors';
import { RawPullRequestCommit, RawPullRequestFile } from '../../domain/pull-request-raw';
import { ContextPaginationError } from '../../domain/pull-request-read-errors';
import { decodeGhJson, GhClient, ghRequest, restApiHeaders } from '../client';
import { loadRemoteBranch } from '../create-pull-request';
import { resolveRepository } from '../target';

const CompareResponse = Schema.Struct({
  ahead_by: Schema.Int,
  base_commit: Schema.Struct({ sha: Schema.String }),
  behind_by: Schema.Int,
  commits: Schema.Array(RawPullRequestCommit),
  files: Schema.optionalKey(Schema.Array(RawPullRequestFile)),
  merge_base_commit: Schema.Struct({ sha: Schema.String }),
  status: Schema.String,
  total_commits: Schema.Int,
});
const ComparisonCursor = Schema.Struct({
  base: Schema.String,
  baseSha: Schema.String,
  head: Schema.String,
  headRepo: Schema.String,
  headSha: Schema.String,
  page: Schema.Int,
  repo: Schema.String,
  version: Schema.Literal(1),
});
type ComparisonCursor = typeof ComparisonCursor.Type;
const decodeComparisonCursorJson = Schema.decodeEffect(Schema.fromJsonString(ComparisonCursor));

export interface ComparisonContextInput {
  readonly base: string;
  readonly baseSha: string;
  readonly cursor: string;
  readonly head: string;
  readonly headRepo: string;
  readonly headSha: string;
  readonly limit: number;
  readonly repo: string;
}

const invalidInput = (detail: string): PullRequestInputError =>
  PullRequestInputError.make({ detail, operation: 'context comparison' });

const decodeCursor = Effect.fn('PullRequestComparison.decodeCursor')(function* decodeCursor(
  raw: string,
) {
  if (raw === '') {
    return null;
  }
  const json = yield* Effect.try({
    catch: () => ContextPaginationError.make({ detail: 'The comparison cursor is invalid.' }),
    try: () => Buffer.from(raw, 'base64url').toString('utf8'),
  });
  return yield* decodeComparisonCursorJson(json).pipe(
    Effect.mapError(() =>
      ContextPaginationError.make({ detail: 'The comparison cursor is invalid.' }),
    ),
  );
});

const cursorMatches = (cursor: ComparisonCursor, input: ComparisonContextInput): boolean =>
  cursor.base === input.base &&
  cursor.baseSha.toLowerCase() === input.baseSha.toLowerCase() &&
  cursor.head === input.head &&
  cursor.headRepo.toLowerCase() === input.headRepo.toLowerCase() &&
  cursor.headSha.toLowerCase() === input.headSha.toLowerCase() &&
  cursor.repo.toLowerCase() === input.repo.toLowerCase();

const encodeCursor = (cursor: ComparisonCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

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

const validateInput = Effect.fn('PullRequestComparison.validateInput')(function* validateInput(
  input: ComparisonContextInput,
) {
  if (input.repo === '' || input.headRepo === '' || input.base === '' || input.head === '') {
    return yield* invalidInput('repo, head-repo, base, and head must all be explicit.');
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    return yield* invalidInput('limit must be a safe integer from 1 through 100.');
  }
  if (!/^[0-9a-f]{40}$/iu.test(input.baseSha) || !/^[0-9a-f]{40}$/iu.test(input.headSha)) {
    return yield* invalidInput('base-sha and head-sha must be complete 40-character SHAs.');
  }
  return yield* Effect.void;
});

const verifyRevisions = Effect.fn('PullRequestComparison.verifyRevisions')(
  function* verifyRevisions(
    revisions: { readonly base: { readonly sha: string }; readonly head: { readonly sha: string } },
    input: ComparisonContextInput,
  ) {
    if (revisions.base.sha !== input.baseSha.toLowerCase()) {
      return yield* StaleHeadError.make({
        actual: revisions.base.sha,
        expected: input.baseSha,
        operation: 'context comparison base',
      });
    }
    if (revisions.head.sha !== input.headSha.toLowerCase()) {
      return yield* StaleHeadError.make({
        actual: revisions.head.sha,
        expected: input.headSha,
        operation: 'context comparison head',
      });
    }
    return yield* Effect.void;
  },
);

export const loadPullRequestComparison = Effect.fn('PullRequestComparison.load')(
  function* loadPullRequestComparison(input: ComparisonContextInput) {
    yield* validateInput(input);
    const cursor = yield* decodeCursor(input.cursor);
    if (cursor !== null && !cursorMatches(cursor, input)) {
      return yield* ContextPaginationError.make({
        detail: 'The comparison cursor belongs to different refs. Start again without it.',
      });
    }
    const [baseRepo, headRepo] = yield* Effect.all(
      [resolveRepository(input.repo), resolveRepository(input.headRepo)],
      { concurrency: 'unbounded' },
    );
    const revisions = yield* Effect.all(
      {
        base: loadRemoteBranch(baseRepo, input.base),
        head: loadRemoteBranch(headRepo, input.head),
      },
      { concurrency: 'unbounded' },
    );
    yield* verifyRevisions(revisions, input);
    const page = cursor?.page ?? 1;
    const headRef =
      headRepo.nameWithOwner.toLowerCase() === baseRepo.nameWithOwner.toLowerCase()
        ? input.head
        : `${headRepo.owner}:${input.head}`;
    const endpoint = `repos/${baseRepo.nameWithOwner}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(headRef)}?per_page=${input.limit}&page=${page}`;
    const arguments_ = [
      'api',
      '--hostname',
      baseRepo.host,
      ...restApiHeaders(baseRepo.host),
      endpoint,
    ];
    const gh = yield* GhClient;
    const result = yield* gh.run(ghRequest(arguments_));
    const comparison = yield* decodeGhJson(CompareResponse, result, arguments_);
    if (comparison.base_commit.sha.toLowerCase() !== input.baseSha.toLowerCase()) {
      return yield* ContextPaginationError.make({
        detail: 'GitHub returned a comparison for a different base revision.',
      });
    }
    const consumed = (page - 1) * input.limit + comparison.commits.length;
    const hasMore = consumed < comparison.total_commits;
    const filesIncluded = page === 1;
    const files = filesIncluded ? (comparison.files ?? []) : [];
    const filesTruncated = !filesIncluded || files.length === 300;
    let fileLimit: string | null = null;
    if (filesIncluded) {
      if (files.length === 300) {
        fileLimit = 'GitHub compare returned its maximum 300 files.';
      }
    } else {
      fileLimit =
        'GitHub returns changed files and diff totals only on the first comparison page. Retain page one while you continue commit pages.';
    }
    return {
      base: revisions.base,
      commits: {
        items: comparison.commits.map(commitSummary),
        total: comparison.total_commits,
        truncated: hasMore,
      },
      diff: {
        additions: filesIncluded ? files.reduce((total, file) => total + file.additions, 0) : null,
        ahead: comparison.ahead_by,
        behind: comparison.behind_by,
        deletions: filesIncluded ? files.reduce((total, file) => total + file.deletions, 0) : null,
        status: comparison.status,
        totalsTruncated: filesTruncated,
      },
      files: {
        included: filesIncluded,
        items: files.map((file) => fileSummary(file)),
        returned: files.length,
        truncated: filesTruncated,
      },
      hasMore,
      head: revisions.head,
      kind: 'comparison' as const,
      limits: { files: fileLimit },
      nextCursor: hasMore
        ? encodeCursor({
            base: input.base,
            baseSha: input.baseSha,
            head: input.head,
            headRepo: input.headRepo,
            headSha: input.headSha,
            page: page + 1,
            repo: input.repo,
            version: 1,
          })
        : null,
      target: { repo: baseRepo.nameWithOwner },
    };
  },
);
