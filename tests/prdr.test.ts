import { describe, expect, it } from 'bun:test';

import { Effect, Layer } from 'effect';

import { aikidoIgnoreBody, withGreptileMention } from '../src/domain/markdown';
import type { PullRequestSnapshot, PullRequestTarget } from '../src/domain/model';
import {
  aikidoStatus,
  findingMetadata,
  greptileStatus,
  providerFor,
} from '../src/domain/providers';
import type {
  GraphqlThread,
  PullRequestView,
  RawIssueComment,
  RawReview,
  RawReviewComment,
} from '../src/domain/raw';
import { selectComment, selectThread } from '../src/domain/selection';
import { GhClient, type GhRequest } from '../src/github/client';
import { createIssueComment } from '../src/github/mutations';
import { composeSnapshot } from '../src/github/snapshot';

const target: PullRequestTarget = {
  host: 'github.com',
  name: 'prdr',
  nameWithOwner: 'seanmozeik/prdr',
  number: 42,
  owner: 'seanmozeik',
};

const pullRequest: PullRequestView = {
  author: { is_bot: false, login: 'seanmozeik' },
  baseRefName: 'main',
  headRefName: 'feature',
  headRefOid: '0123456789abcdef0123456789abcdef01234567',
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  number: 42,
  reviewDecision: '',
  state: 'OPEN',
  title: 'Test pull request',
  updatedAt: '2026-08-24T10:00:00Z',
  url: 'https://github.com/seanmozeik/prdr/pull/42',
};

const reviewComment = (
  id: number,
  login: string,
  body: string,
  replyTo: number | null = null,
): RawReviewComment => ({
  body,
  created_at: `2026-08-24T10:00:0${id}Z`,
  diff_hunk: '@@ -1 +1 @@',
  html_url: `https://github.com/seanmozeik/prdr/pull/42#discussion_r${id}`,
  id,
  in_reply_to_id: replyTo,
  line: 10,
  node_id: `PRRC_${id}`,
  original_line: 10,
  path: 'src/example.ts',
  pull_request_review_id: 100,
  side: 'RIGHT',
  subject_type: 'line',
  updated_at: `2026-08-24T10:00:0${id}Z`,
  user: { login, type: login.endsWith('[bot]') ? 'Bot' : 'User' },
});

const issueComment = (body: string): RawIssueComment => ({
  body,
  created_at: '2026-08-24T10:05:00Z',
  html_url: 'https://github.com/seanmozeik/prdr/pull/42#issuecomment-9',
  id: 9,
  node_id: 'IC_9',
  updated_at: '2026-08-24T10:05:00Z',
  user: { login: 'greptile-apps[bot]', type: 'Bot' },
});

const graphqlThread = (
  rootId: number,
  replyId: number | null,
  resolved: boolean,
): GraphqlThread => ({
  comments: {
    nodes: [
      { id: `PRRC_${rootId}`, replyTo: null },
      ...(replyId === null ? [] : [{ id: `PRRC_${replyId}`, replyTo: { id: `PRRC_${rootId}` } }]),
    ],
    totalCount: replyId === null ? 1 : 2,
  },
  id: `PRRT_${rootId}`,
  isOutdated: false,
  isResolved: resolved,
  line: 10,
  originalLine: 10,
  path: 'src/example.ts',
  resolvedBy: resolved ? { login: 'seanmozeik' } : null,
  subjectType: 'LINE',
  viewerCanReply: true,
  viewerCanResolve: !resolved,
  viewerCanUnresolve: resolved,
});

const makeSnapshot = (): Promise<PullRequestSnapshot> => {
  const greptileBody =
    '<img alt="P1"> **Keep Markdown exact**\n\n<details>\n```ts\nconst x = 1;\n```\n</details>\n';
  const root = reviewComment(1, 'greptile-apps[bot]', greptileBody);
  const reply = reviewComment(2, 'reviewer', 'Verified on the current head.\n', 1);
  const summary = issueComment(
    '<!-- greptile-status -->\nConfidence Score: 4/5\n' +
      '[Unrelated commit](https://github.com/seanmozeik/prdr/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)\n' +
      'Reviews (3): Last reviewed commit: ' +
      '[head](https://github.com/seanmozeik/prdr/commit/0123456789abcdef0123456789abcdef01234567)',
  );
  return Effect.runPromise(
    composeSnapshot(target, pullRequest, {
      checks: [
        {
          bucket: 'pass',
          completedAt: '2026-08-24T10:06:00Z',
          event: '',
          link: 'https://app.aikido.dev/check',
          name: 'Aikido Security: check code',
          startedAt: '2026-08-24T10:05:00Z',
          state: 'SUCCESS',
          workflow: '',
        },
      ],
      graphqlThreads: [graphqlThread(1, 2, false)],
      issueComments: [summary],
      reviewComments: [root, reply],
      reviews: [],
    }),
  );
};

describe('provider parsing', () => {
  it('uses exact known bot identities', () => {
    expect(providerFor('greptile-apps[bot]', 'Bot')).toBe('greptile');
    expect(providerFor('aikido-pr-checks[bot]', 'Bot')).toBe('aikido');
    expect(providerFor('robotics-reviewer', 'User')).toBe('human');
    expect(providerFor('another-reviewer[bot]', 'Bot')).toBe('other-bot');
  });

  it('extracts Greptile priorities and Aikido severity', () => {
    expect(
      findingMetadata('greptile-apps[bot]', '<img alt="P1"> **Unsafe state change**').severity,
    ).toBe('high');
    expect(
      findingMetadata(
        'aikido-pr-checks[bot]',
        '**Potential file inclusion attack** - high severity',
      ),
    ).toEqual({ provider: 'aikido', severity: 'high', title: 'Potential file inclusion attack' });
  });

  it('bounds extracted titles without changing the raw body', () => {
    const body = `<img alt="P1"> **${'x'.repeat(200)}**\n\nExact body`;
    const metadata = findingMetadata('greptile-apps[bot]', body);

    expect(metadata.title?.endsWith('...')).toBe(true);
    expect(metadata.title).toHaveLength(160);
    expect(body).toEndWith('Exact body');
  });
});

describe('Markdown-safe provider commands', () => {
  it('does not change a body that already mentions Greptile', () => {
    const body = '@greptileai inspect this:\n\n```ts\nconst value = `x`;\n```\n';
    expect(withGreptileMention(body)).toBe(body);
  });

  it('adds a Greptile mention as a separate paragraph', () => {
    const body = '# Inspect this\n\n```ts\nconst value = 1;\n```\n';

    expect(withGreptileMention(body)).toBe(`@greptileai\n\n${body}`);
  });

  it('builds the documented Aikido ignore reply', async () => {
    expect(await Effect.runPromise(aikidoIgnoreBody('frontend-only false positive\n'))).toBe(
      '@AikidoSec ignore: frontend-only false positive',
    );
  });

  it('rejects Unicode line separators in an Aikido ignore reason', async () => {
    const error = await Effect.runPromise(
      Effect.flip(aikidoIgnoreBody('first line\u0085second line')),
    );

    expect(error._tag).toBe('MarkdownInputError');
    expect(error.message).toContain('one line');
  });
});

describe('snapshot composition', () => {
  it('keeps raw Markdown and uses GraphQL thread state', async () => {
    const snapshot = await makeSnapshot();
    const [thread] = snapshot.threads;
    expect(thread?.isResolved).toBe(false);
    expect(thread?.comments).toHaveLength(2);
    expect(thread?.root.body).toContain('<details>\n```ts\nconst x = 1;\n```\n</details>\n');

    const selection = await Effect.runPromise(selectComment(snapshot, 'review-comment:2'));
    expect(selection.thread?.ref).toBe('thread:PRRT_1');
    const threadSelection = await Effect.runPromise(selectThread(snapshot, 'review-comment:2'));
    expect(threadSelection.root.id).toBe(1);
  });

  it('requires qualified references at the selection boundary', async () => {
    const snapshot = await makeSnapshot();
    const error = await Effect.runPromise(Effect.flip(selectComment(snapshot, '2')));

    expect(error._tag).toBe('CommentReferenceError');
    expect(error.message).toContain('review-comment:ID');
  });

  it('extracts current provider status', async () => {
    const snapshot = await makeSnapshot();
    const greptile = greptileStatus(snapshot);
    expect(greptile.confidence).toBe(4);
    expect(greptile.currentHead).toBe(pullRequest.headRefOid);
    expect(greptile.reviewCount).toBe(3);
    expect(greptile.lastReviewedCommit).toBe(pullRequest.headRefOid);
    expect(greptile.latestActivity?.ref).toBe('issue-comment:9');
    expect(greptile.latestCompletedReview?.ref).toBe('issue-comment:9');
    expect(greptile.openThreads).toHaveLength(1);
    expect(Object.hasOwn(greptile.latestActivity ?? {}, 'body')).toBe(false);
    expect(Object.hasOwn(greptile.openThreads[0] ?? {}, 'comments')).toBe(false);
    expect(greptile.openThreads[0]?.rootRef).toBe('review-comment:1');
    expect(aikidoStatus(snapshot)).toMatchObject({
      checks: [{ state: 'SUCCESS' }],
      currentHead: pullRequest.headRefOid,
    });
  });

  it('keeps the latest completed Greptile review when later activity reports a failure', async () => {
    const snapshot = await makeSnapshot();
    const [summary] = snapshot.issueComments;
    if (summary === undefined) {
      throw new Error('The snapshot did not contain the Greptile summary.');
    }
    const blocked = {
      ...summary,
      body: 'Too many files changed. Greptile could not complete this review.',
      id: 10,
      node_id: 'IC_10',
      ref: 'issue-comment:10',
      updated_at: '2026-08-24T10:10:00Z',
    };
    const status = greptileStatus({ ...snapshot, issueComments: [summary, blocked] });

    expect(status.latestActivity?.ref).toBe('issue-comment:10');
    expect(status.latestCompletedReview?.ref).toBe('issue-comment:9');
    expect(status.confidence).toBe(4);
    expect(status.lastReviewedCommit).toBe(pullRequest.headRefOid);
  });

  it('rejects Greptile numbers outside their safe ranges', async () => {
    const snapshot = await makeSnapshot();
    const [summary] = snapshot.issueComments;
    if (summary === undefined) {
      throw new Error('The snapshot did not contain the Greptile summary.');
    }
    const status = greptileStatus({
      ...snapshot,
      issueComments: [
        {
          ...summary,
          body: (summary.body ?? '')
            .replace('4/5', '5.5/5')
            .replace('Reviews (3)', 'Reviews (999999999999999999999)'),
        },
      ],
    });

    expect(status.confidence).toBeNull();
    expect(status.reviewCount).toBeNull();
  });

  it('normalizes deleted actors at the snapshot boundary', async () => {
    const deletedComment = { ...reviewComment(3, 'unused', 'Deleted author'), user: null };
    const deletedIssue = { ...issueComment('Deleted issue author'), user: null };
    const deletedReview: RawReview = {
      body: 'Deleted review author',
      commit_id: pullRequest.headRefOid,
      html_url: 'https://github.com/seanmozeik/prdr/pull/42#pullrequestreview-11',
      id: 11,
      node_id: 'PRR_11',
      state: 'COMMENTED',
      submitted_at: '2026-08-24T10:05:00Z',
      user: null,
    };
    const snapshot = await Effect.runPromise(
      composeSnapshot(target, pullRequest, {
        checks: [],
        graphqlThreads: [graphqlThread(3, null, false)],
        issueComments: [deletedIssue],
        reviewComments: [deletedComment],
        reviews: [deletedReview],
      }),
    );

    expect(snapshot.threads[0]?.root.user).toEqual({ login: '[deleted]', type: 'Deleted' });
    expect(snapshot.issueComments[0]?.user).toEqual({ login: '[deleted]', type: 'Deleted' });
    expect(snapshot.reviews[0]?.user).toEqual({ login: '[deleted]', type: 'Deleted' });
  });
});

describe('GitHub writes', () => {
  it('sends an exact Markdown body as JSON on standard input', async () => {
    const body = 'Line one\n\n<details>\n```ts\nconst value = "$HOME";\n```\n</details>\n';
    const captured: GhRequest[] = [];
    const run = Effect.fn('TestGh.run')((request: GhRequest) =>
      Effect.sync(() => {
        captured.push(request);
        return {
          exitCode: 0,
          stderr: '',
          stdout: JSON.stringify({
            body,
            html_url: 'https://github.com/seanmozeik/prdr/pull/42#issuecomment-10',
            id: 10,
            node_id: 'IC_10',
          }),
        };
      }),
    );
    const layer = Layer.succeed(GhClient, { run });

    const created = await Effect.runPromise(
      createIssueComment(target, body).pipe(Effect.provide(layer)),
    );
    const [request] = captured;
    if (request === undefined) {
      throw new Error('The fake gh client did not receive a request.');
    }
    expect(created.body).toBe(body);
    expect(request.arguments).not.toContain(body);
    expect(request.arguments.slice(-2)).toEqual(['--input', '-']);
    expect(request.input).toBe(JSON.stringify({ body }));
  });
});
