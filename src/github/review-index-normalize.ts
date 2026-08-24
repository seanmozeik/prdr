import { Effect } from 'effect';

import { checkBucket } from '../domain/checks';
import type { GhCheck, RawIssueComment, RawReview, RestActor } from '../domain/raw';
import type { ReviewIndex } from '../domain/review-index';
import { SnapshotInvariantError } from './errors';
import type {
  RawReviewIndexActor,
  RawReviewIndexCheck,
  RawReviewIndexIssueComment,
  RawReviewIndexPullRequest,
  RawReviewIndexReview,
} from './review-index-schema';

const deletedActor: RestActor = { login: '[deleted]', type: 'Deleted' };

export const normalizeReviewIndexActor = (actor: RawReviewIndexActor | null): RestActor => {
  if (actor === null) {
    return deletedActor;
  }
  const login =
    actor.__typename === 'Bot' && !actor.login.endsWith('[bot]')
      ? `${actor.login}[bot]`
      : actor.login;
  return { login, type: actor.__typename };
};

export const normalizeRestActor = (actor: RestActor | null): RestActor => actor ?? deletedActor;

export const requireReviewIndexDatabaseId = Effect.fn('ReviewIndex.requireDatabaseId')(
  function* requireReviewIndexDatabaseId(value: number | null, nodeId: string) {
    if (value === null || !Number.isSafeInteger(value) || value < 1) {
      return yield* SnapshotInvariantError.make({
        detail: `GitHub did not return a safe database ID for ${nodeId}.`,
      });
    }
    return value;
  },
);

export const parseReviewIndexDatabaseId = Effect.fn('ReviewIndex.parseDatabaseId')(
  function* parseReviewIndexDatabaseId(value: string, nodeId: string) {
    if (!/^[1-9][0-9]*$/u.test(value)) {
      return yield* SnapshotInvariantError.make({
        detail: `GitHub returned an invalid database ID for ${nodeId}.`,
      });
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      return yield* SnapshotInvariantError.make({
        detail: `GitHub returned an unsafe database ID for ${nodeId}.`,
      });
    }
    return parsed;
  },
);

export const normalizeReviewIndexIssueComment = Effect.fn('ReviewIndex.normalizeIssueComment')(
  function* normalizeReviewIndexIssueComment(raw: RawReviewIndexIssueComment) {
    return {
      body: raw.body,
      created_at: raw.createdAt,
      html_url: raw.url,
      id: yield* requireReviewIndexDatabaseId(raw.databaseId, raw.id),
      node_id: raw.id,
      updated_at: raw.updatedAt,
      user: normalizeReviewIndexActor(raw.author),
    } satisfies RawIssueComment;
  },
);

export const normalizeReviewIndexReview = Effect.fn('ReviewIndex.normalizeReview')(
  function* normalizeReviewIndexReview(raw: RawReviewIndexReview) {
    return {
      body: raw.body,
      commit_id: raw.commit?.oid ?? null,
      html_url: raw.url,
      id: yield* parseReviewIndexDatabaseId(raw.fullDatabaseId, raw.id),
      node_id: raw.id,
      state: raw.state,
      submitted_at: raw.submittedAt,
      user: normalizeReviewIndexActor(raw.author),
    } satisfies RawReview;
  },
);

export const normalizeReviewIndexCheck = (check: RawReviewIndexCheck): GhCheck => {
  if (check.__typename === 'StatusContext') {
    return {
      bucket: checkBucket(check.state),
      completedAt: '',
      event: '',
      link: check.targetUrl ?? '',
      name: check.context,
      startedAt: check.createdAt,
      state: check.state,
      workflow: '',
    };
  }
  const state = check.conclusion ?? check.status;
  return {
    bucket: checkBucket(state),
    completedAt: check.completedAt ?? '',
    event: check.checkSuite?.workflowRun?.event ?? '',
    link: check.detailsUrl ?? '',
    name: check.name,
    startedAt: check.startedAt ?? '',
    state,
    workflow: check.checkSuite?.workflowRun?.workflow?.name ?? '',
  };
};

export const normalizeReviewIndexPullRequest = (
  raw: RawReviewIndexPullRequest,
): ReviewIndex['pullRequest'] => ({
  author:
    raw.author === null
      ? null
      : { is_bot: raw.author.__typename === 'Bot', login: raw.author.login },
  baseRefName: raw.baseRefName,
  headRefName: raw.headRefName,
  headRefOid: raw.headRefOid,
  isDraft: raw.isDraft,
  mergeStateStatus: raw.mergeStateStatus,
  number: raw.number,
  reviewDecision: raw.reviewDecision ?? '',
  state: raw.state,
  title: raw.title,
  updatedAt: raw.updatedAt,
  url: raw.url,
});
