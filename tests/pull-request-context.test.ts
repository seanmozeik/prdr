import { describe, expect, it } from 'bun:test';

import { Effect } from 'effect';

import { validateReviewFindings } from '../src/domain/diff-coordinates';
import {
  paginatePullRequestContext,
  type PullRequestContextSource,
} from '../src/domain/pull-request-context';

const head = '0123456789abcdef0123456789abcdef01234567';
const target = {
  host: 'github.com',
  name: 'prdr',
  nameWithOwner: 'example/prdr',
  number: 42,
  owner: 'example',
};

const source = (headRefOid = head, changedFiles = 2): PullRequestContextSource => ({
  commits: [
    {
      author: { login: 'author' },
      commit: {
        author: { date: '2026-08-28T10:00:00Z', name: 'Author' },
        message: 'First\n\nBody',
      },
      sha: '1111111111111111111111111111111111111111',
    },
    {
      author: { login: 'author' },
      commit: { author: { date: '2026-08-29T10:00:00Z', name: 'Author' }, message: 'Second' },
      sha: '2222222222222222222222222222222222222222',
    },
  ],
  detail: {
    additions: 5,
    base: {
      ref: 'main',
      repo: { full_name: 'example/prdr' },
      sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    body: '## Exact\n\nMarkdown',
    changed_files: changedFiles,
    commits: 2,
    deletions: 3,
    draft: false,
    head: { ref: 'feature', repo: { full_name: 'example/prdr' }, sha: headRefOid },
    html_url: 'https://github.com/example/prdr/pull/42',
    locked: false,
    merge_commit_sha: null,
    mergeable: true,
    merged: false,
    node_id: 'PR_42',
    number: 42,
    state: 'open',
    title: 'Exact title',
    user: { login: 'author' },
  },
  files: [
    {
      additions: 3,
      changes: 3,
      deletions: 0,
      filename: 'src/one.ts',
      patch: '@@ -1 +1 @@',
      status: 'modified',
    },
    {
      additions: 2,
      changes: 5,
      deletions: 3,
      filename: 'src/two.ts',
      patch: '@@ -1 +1 @@',
      status: 'modified',
    },
  ],
  reviewIndex: {
    checks: [
      {
        bucket: 'pending',
        completedAt: '',
        event: 'pull_request',
        link: 'https://example.com/check',
        name: 'test',
        startedAt: '2026-08-29T10:00:00Z',
        state: 'IN_PROGRESS',
        workflow: 'ci',
      },
      {
        bucket: 'pass',
        completedAt: '2026-08-29T10:01:00Z',
        event: 'pull_request',
        link: 'https://example.com/check-2',
        name: 'lint',
        startedAt: '2026-08-29T10:00:00Z',
        state: 'SUCCESS',
        workflow: 'ci',
      },
    ],
    issueComments: [],
    pullRequest: {
      author: { is_bot: false, login: 'author' },
      baseRefName: 'main',
      headRefName: 'feature',
      headRefOid,
      isDraft: false,
      mergeStateStatus: 'CLEAN',
      number: 42,
      reviewDecision: '',
      state: 'OPEN',
      title: 'Exact title',
      updatedAt: '2026-08-29T10:00:00Z',
      url: 'https://github.com/example/prdr/pull/42',
    },
    reviews: [],
    target,
    threads: [],
    unthreadedReviewComments: [],
  },
  workflow: {
    autoMergeRequest: null,
    baseRefName: 'main',
    baseRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    body: '## Exact\n\nMarkdown',
    headRefName: 'feature',
    headRefOid,
    id: 'PR_42',
    isDraft: false,
    locked: false,
    mergeQueueEntry: null,
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    merged: false,
    number: 42,
    repository: { id: 'R_1', nameWithOwner: 'example/prdr', viewerPermission: 'WRITE' },
    reviewDecision: null,
    state: 'OPEN',
    title: 'Exact title',
    url: 'https://github.com/example/prdr/pull/42',
    viewerCanClose: true,
    viewerCanDisableAutoMerge: false,
    viewerCanEnableAutoMerge: true,
    viewerCanMergeAsAdmin: false,
    viewerCanReopen: false,
    viewerCanUpdate: true,
    viewerCanUpdateBranch: true,
  },
});

describe('pull request context pagination', () => {
  it('states section truncation and continues with an opaque cursor', async () => {
    const first = await Effect.runPromise(
      paginatePullRequestContext(source(), { cursor: '', limit: 1, purpose: 'review' }),
    );

    expect(first.body).toBe('## Exact\n\nMarkdown');
    expect(first.commits).toMatchObject({ total: 2, truncated: true });
    expect(first.files).toMatchObject({ total: 2, truncated: true });
    expect(first.checks).toMatchObject({ total: 1, truncated: false });
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await Effect.runPromise(
      paginatePullRequestContext(source(), {
        cursor: first.nextCursor ?? '',
        limit: 1,
        purpose: 'review',
      }),
    );

    expect(second.commits.items[0]?.title).toBe('Second');
    expect(second.files.items[0]?.path).toBe('src/two.ts');
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects a cursor after the pull request head changes', async () => {
    const first = await Effect.runPromise(
      paginatePullRequestContext(source(), { cursor: '', limit: 1, purpose: 'authoring' }),
    );
    const error = await Effect.runPromise(
      Effect.flip(
        paginatePullRequestContext(source('ffffffffffffffffffffffffffffffffffffffff'), {
          cursor: first.nextCursor ?? '',
          limit: 1,
          purpose: 'authoring',
        }),
      ),
    );

    expect(error._tag).toBe('ContextPaginationError');
  });

  it('states an unretrievable GitHub file cap without an unusable next cursor', async () => {
    const result = await Effect.runPromise(
      paginatePullRequestContext(source(head, 400), { cursor: '', limit: 100, purpose: 'review' }),
    );

    expect(result.files).toMatchObject({ available: 2, total: 400, truncated: true });
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('coalesces duplicate GitHub file records into one changed path', async () => {
    const current = source(head, 1);
    const result = await Effect.runPromise(
      paginatePullRequestContext(
        {
          ...current,
          files: [
            {
              additions: 0,
              changes: 3,
              deletions: 3,
              filename: 'AGENTS.md',
              patch: '@@ -1,3 +0,0 @@\n-old',
              status: 'removed',
            },
            {
              additions: 1,
              changes: 1,
              deletions: 0,
              filename: 'AGENTS.md',
              patch: '@@ -0,0 +1 @@\n+new',
              status: 'added',
            },
          ],
        },
        { cursor: '', limit: 10, purpose: 'review' },
      ),
    );

    expect(result.files).toMatchObject({
      available: 1,
      items: [{ additions: 1, deletions: 3, path: 'AGENTS.md', status: 'changed' }],
      total: 1,
    });
  });

  it('validates review coordinates across duplicate records for one path', async () => {
    await Effect.runPromise(
      validateReviewFindings(
        [
          {
            additions: 0,
            changes: 1,
            deletions: 1,
            filename: 'AGENTS.md',
            patch: '@@ -1 +0,0 @@\n-old',
            status: 'removed',
          },
          {
            additions: 1,
            changes: 1,
            deletions: 0,
            filename: 'AGENTS.md',
            patch: '@@ -0,0 +1 @@\n+new',
            status: 'added',
          },
        ],
        [
          { body: 'Old line', line: 1, path: 'AGENTS.md', side: 'LEFT' },
          { body: 'New line', line: 1, path: 'AGENTS.md', side: 'RIGHT' },
        ],
      ),
    );
  });
});
