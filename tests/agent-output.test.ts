import { describe, expect, it } from 'bun:test';

import { Schema } from 'effect';

import {
  toAgentInspection,
  toAgentListPage,
  toAgentShownComment,
} from '../src/domain/agent-output';
import {
  AgentInspection,
  AgentListPage,
  AgentShownComment,
} from '../src/domain/agent-output-schema';
import type {
  CommentSelection,
  PullRequestTarget,
  ReviewComment,
  ReviewThread,
} from '../src/domain/model';
import type { ReviewListPage } from '../src/domain/pagination';
import type { PullRequestView } from '../src/domain/raw';
import type { ReviewIndex } from '../src/domain/review-index';

const head = '0123456789abcdef0123456789abcdef01234567';
const target: PullRequestTarget = {
  host: 'github.com',
  name: 'prdr',
  nameWithOwner: 'example/prdr',
  number: 42,
  owner: 'example',
};
const pullRequest: PullRequestView = {
  author: { is_bot: false, login: 'author' },
  baseRefName: 'main',
  headRefName: 'feature',
  headRefOid: head,
  isDraft: false,
  mergeStateStatus: 'BLOCKED',
  number: 42,
  reviewDecision: 'CHANGES_REQUESTED',
  state: 'OPEN',
  title: 'Agent output test',
  updatedAt: '2026-08-24T10:00:00Z',
  url: 'https://github.com/example/prdr/pull/42',
};

const comment = (id: number, body: string, replyTo: number | null): ReviewComment => ({
  body,
  created_at: `2026-08-24T10:00:0${id}Z`,
  diff_hunk: '@@ -1,4 +1,8 @@\n large repeated diff',
  html_url: `https://github.com/example/prdr/pull/42#discussion_r${id}`,
  id,
  in_reply_to_id: replyTo,
  line: 18,
  metadata: {
    provider: id === 1 ? 'codex' : 'human',
    severity: id === 1 ? 'medium' : 'unknown',
    title: id === 1 ? 'Delay dismissal until ready' : null,
  },
  node_id: `PRRC_${id}`,
  original_line: 18,
  path: 'src/report.ts',
  pull_request_review_id: 100,
  ref: `review-comment:${id}`,
  side: 'RIGHT',
  subject_type: 'line',
  updated_at: `2026-08-24T10:00:0${id}Z`,
  user: { login: id === 1 ? 'chatgpt-codex-connector[bot]' : 'reviewer', type: 'Bot' },
});

const rootBody = '**Delay dismissal until ready**\n\nThe write happens too early.';
const replyBody = 'Fixed in the current head.';
const root = comment(1, rootBody, null);
const reply = comment(2, replyBody, 1);
const thread: ReviewThread = {
  comments: [root, reply],
  id: 'PRRT_1',
  isOutdated: false,
  isResolved: false,
  line: 18,
  originalLine: 18,
  path: 'src/report.ts',
  ref: 'thread:PRRT_1',
  resolvedBy: null,
  root,
  subjectType: 'LINE',
  viewerCanReply: true,
  viewerCanResolve: true,
  viewerCanUnresolve: false,
};

describe('agent output', () => {
  it('returns one exact copy of a selected body and compact thread context', () => {
    const selection: CommentSelection = { comment: root, kind: 'review-comment', thread };
    const projected = toAgentShownComment(target, head, selection);
    const bodies = [
      projected.body,
      ...(projected.thread?.otherComments?.map(({ body }) => body) ?? []),
    ];

    expect(Schema.is(AgentShownComment)(projected)).toBe(true);
    expect(projected).toMatchObject({
      author: 'chatgpt-codex-connector[bot]',
      body: rootBody,
      location: { line: 18, path: 'src/report.ts' },
      provider: 'codex',
      ref: 'review-comment:1',
      severity: 'medium',
      target: { head, pr: 42, repo: 'example/prdr' },
      thread: {
        actions: ['reply', 'resolve'],
        otherComments: [{ body: replyBody, ref: 'review-comment:2' }],
        state: 'open',
      },
      title: 'Delay dismissal until ready',
    });
    expect(projected.thread).not.toHaveProperty('replyCount');
    expect(projected.thread).not.toHaveProperty('rootRef');
    expect(bodies.filter((body) => body === rootBody)).toHaveLength(1);
    expect(JSON.stringify(projected)).not.toContain('diff_hunk');
    expect(JSON.stringify(projected)).not.toContain('node_id');
  });

  it('identifies the root only when the selected comment is a reply', () => {
    const selection: CommentSelection = { comment: reply, kind: 'review-comment', thread };
    const projected = toAgentShownComment(target, head, selection);

    expect(projected.thread).toMatchObject({ rootRef: root.ref });
    expect(projected.thread).not.toHaveProperty('replyCount');
  });

  it('keeps list pagination but removes null and derivable fields', () => {
    const page: ReviewListPage = {
      hasMore: true,
      headRefOid: head,
      items: [
        {
          author: 'chatgpt-codex-connector[bot]',
          createdAt: '2026-08-24T10:00:01Z',
          kind: 'review-comment',
          line: 18,
          path: 'src/report.ts',
          preview: 'The write happens too early.',
          provider: 'codex',
          ref: 'review-comment:1',
          replyCount: 1,
          severity: 'medium',
          state: 'open',
          threadRef: 'thread:PRRT_1',
          title: 'Delay dismissal until ready',
          url: 'https://github.com/example/prdr/pull/42#discussion_r1',
        },
      ],
      limit: 1,
      nextCursor: 'opaque',
      target,
      total: 2,
    };
    const projected = toAgentListPage(page);

    expect(Schema.is(AgentListPage)(projected)).toBe(true);
    expect(projected).toEqual({
      hasMore: true,
      items: [
        {
          author: 'chatgpt-codex-connector[bot]',
          location: { line: 18, path: 'src/report.ts' },
          provider: 'codex',
          ref: 'review-comment:1',
          replies: 1,
          severity: 'medium',
          state: 'open',
          summary: 'The write happens too early.',
          thread: 'thread:PRRT_1',
          title: 'Delay dismissal until ready',
        },
      ],
      nextCursor: 'opaque',
      target: { head, pr: 42, repo: 'example/prdr' },
      total: 2,
    });
  });

  it('summarizes inspection data without returning Markdown bodies or passing checks', () => {
    const snapshot: ReviewIndex = {
      checks: [
        {
          bucket: 'pass',
          completedAt: '',
          event: '',
          link: '',
          name: 'unit',
          startedAt: '',
          state: 'SUCCESS',
          workflow: '',
        },
        {
          bucket: 'fail',
          completedAt: '',
          event: '',
          link: '',
          name: 'security',
          startedAt: '',
          state: 'FAILURE',
          workflow: '',
        },
      ],
      issueComments: [],
      pullRequest,
      reviews: [],
      target,
      threads: [thread],
      unthreadedReviewComments: [],
    };
    const projected = toAgentInspection(snapshot);

    expect(Schema.is(AgentInspection)(projected)).toBe(true);
    expect(projected).toMatchObject({
      checks: {
        attention: [{ bucket: 'fail', name: 'security', state: 'failure' }],
        fail: 1,
        pass: 1,
      },
      reviews: { open: 1, resolved: 0, unthreaded: 0 },
      target: { head, pr: 42, repo: 'example/prdr' },
    });
    expect(projected.reviews.openItems).toHaveLength(1);
    expect(JSON.stringify(projected)).not.toContain(rootBody);
    expect(JSON.stringify(projected)).not.toContain('unit');
  });
});
