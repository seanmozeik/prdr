import type {
  AgentFinding,
  AgentInspection,
  AgentListPage,
  AgentPullRequestListPage,
  AgentShownComment,
  AgentShownThread,
  AgentTarget,
  AgentThreadComment,
} from './agent-output-schema';
import { listReviewItems, type ReviewListItem } from './listing';
import type {
  CommentSelection,
  FindingMetadata,
  PullRequestTarget,
  ReviewComment,
  ReviewThread,
} from './model';
import type { ReviewListPage } from './pagination';
import type { PullRequestListPage } from './pull-requests';
import type {
  IndexedCommentSelection,
  IndexedReviewComment,
  IndexedReviewThread,
  ReviewIndex,
} from './review-index';

const repositoryName = (target: Omit<PullRequestTarget, 'number'>): string =>
  target.host === 'github.com' ? target.nameWithOwner : `${target.host}/${target.nameWithOwner}`;

const agentTarget = (target: PullRequestTarget, head: string): AgentTarget => ({
  head,
  pr: target.number,
  repo: repositoryName(target),
});

const optionalMetadata = (metadata: FindingMetadata) => ({
  ...(metadata.severity !== 'unknown' && { severity: metadata.severity }),
  ...(metadata.title !== null && { title: metadata.title }),
});

const compactFinding = (item: ReviewListItem): AgentFinding => ({
  author: item.author,
  ...(item.path !== null && {
    location: { ...(item.line !== null && { line: item.line }), path: item.path },
  }),
  provider: item.provider,
  ref: item.ref,
  ...(item.replyCount !== 0 && { replies: item.replyCount }),
  ...(item.severity !== 'unknown' && { severity: item.severity }),
  state: item.state,
  ...((item.title === null || item.preview !== item.title) && { summary: item.preview }),
  ...(item.threadRef !== null && { thread: item.threadRef }),
  ...(item.title !== null && { title: item.title }),
});

export const toAgentListPage = (page: ReviewListPage): AgentListPage => ({
  hasMore: page.hasMore,
  items: page.items.map((item) => compactFinding(item)),
  nextCursor: page.nextCursor,
  target: agentTarget(page.target, page.headRefOid),
  total: page.total,
});

type ShowReviewCommentSource = ReviewComment | IndexedReviewComment;
type ShowThreadSource = ReviewThread | IndexedReviewThread;

const threadComment = (comment: ShowReviewCommentSource): AgentThreadComment => ({
  author: comment.user.login,
  body: comment.body,
  createdAt: comment.created_at,
  ...optionalMetadata(comment.metadata),
  provider: comment.metadata.provider,
  ref: comment.ref,
});

const threadActions = (
  thread: ShowThreadSource,
): readonly ('reply' | 'resolve' | 'unresolve')[] => {
  const actions: ('reply' | 'resolve' | 'unresolve')[] = [];
  if (thread.viewerCanReply) {
    actions.push('reply');
  }
  if (thread.viewerCanResolve) {
    actions.push('resolve');
  }
  if (thread.viewerCanUnresolve) {
    actions.push('unresolve');
  }
  return actions;
};

const shownThread = (thread: ShowThreadSource, selectedRef: string): AgentShownThread => {
  const otherComments = thread.comments
    .filter((comment) => comment.ref !== selectedRef)
    .map((comment) => threadComment(comment));
  return {
    actions: threadActions(thread),
    ...(otherComments.length > 0 && { otherComments }),
    ...(thread.isOutdated && { outdated: true }),
    ref: thread.ref,
    ...(thread.resolvedBy !== null && { resolvedBy: thread.resolvedBy }),
    ...(thread.root.ref !== selectedRef && { rootRef: thread.root.ref }),
    state: thread.isResolved ? 'resolved' : 'open',
  };
};

export const toAgentShownComment = (
  target: PullRequestTarget,
  head: string,
  selection: CommentSelection | IndexedCommentSelection,
): AgentShownComment => {
  const source = selection;
  const createdAt =
    source.kind === 'review'
      ? (source.comment.submitted_at ?? undefined)
      : source.comment.created_at;
  const line =
    source.kind === 'review-comment' ? (source.comment.line ?? source.comment.original_line) : null;
  const location =
    source.kind === 'review-comment'
      ? { ...(line !== null && { line }), path: source.comment.path }
      : undefined;
  return {
    author: source.comment.user.login,
    body: source.comment.body,
    ...(createdAt !== undefined && createdAt !== '' && { createdAt }),
    ...(location !== undefined && { location }),
    ...optionalMetadata(source.comment.metadata),
    provider: source.comment.metadata.provider,
    ref: source.comment.ref,
    ...(source.kind === 'review' && { reviewState: source.comment.state.toLowerCase() }),
    target: agentTarget(target, head),
    ...(source.thread !== null && { thread: shownThread(source.thread, source.comment.ref) }),
  };
};

const countBucket = (snapshot: ReviewIndex, bucket: string): number =>
  snapshot.checks.filter((check) => check.bucket === bucket).length;

type AttentionCheck = ReviewIndex['checks'][number] & {
  readonly bucket: 'cancel' | 'fail' | 'pending';
};

const isAttentionCheck = (check: ReviewIndex['checks'][number]): check is AttentionCheck =>
  check.bucket === 'cancel' || check.bucket === 'fail' || check.bucket === 'pending';

export const toAgentInspection = (snapshot: ReviewIndex): AgentInspection => {
  const allItems = listReviewItems(snapshot, { author: '', provider: 'all', state: 'all' });
  const openItems = allItems.filter((item) => item.state === 'open');
  return {
    ...(snapshot.pullRequest.author !== null && { author: snapshot.pullRequest.author.login }),
    base: snapshot.pullRequest.baseRefName,
    branch: snapshot.pullRequest.headRefName,
    checks: {
      attention: snapshot.checks
        .filter(isAttentionCheck)
        .map((check) => ({
          bucket: check.bucket,
          name: check.name,
          state: check.state.toLowerCase(),
        })),
      cancel: countBucket(snapshot, 'cancel'),
      fail: countBucket(snapshot, 'fail'),
      pass: countBucket(snapshot, 'pass'),
      pending: countBucket(snapshot, 'pending'),
      skipping: countBucket(snapshot, 'skipping'),
    },
    draft: snapshot.pullRequest.isDraft,
    mergeState: snapshot.pullRequest.mergeStateStatus.toLowerCase(),
    ...(snapshot.pullRequest.reviewDecision !== '' && {
      reviewDecision: snapshot.pullRequest.reviewDecision.toLowerCase(),
    }),
    reviews: {
      open: snapshot.threads.filter((thread) => !thread.isResolved).length,
      openItems: openItems.map((item) => compactFinding(item)),
      resolved: snapshot.threads.filter((thread) => thread.isResolved).length,
      unthreaded: allItems.filter((item) => item.state === 'unthreaded').length,
    },
    state: snapshot.pullRequest.state.toLowerCase(),
    target: agentTarget(snapshot.target, snapshot.pullRequest.headRefOid),
    title: snapshot.pullRequest.title,
  };
};

export const toAgentPullRequestListPage = (
  page: PullRequestListPage,
): AgentPullRequestListPage => ({
  hasMore: page.hasMore,
  items: page.items.map((item) => ({
    ageDays: item.ageDays,
    author: item.author,
    base: item.baseRefName,
    ...(item.checkStatus !== null && { checks: item.checkStatus.toLowerCase() }),
    comments: item.commentCount,
    head:
      item.headRepositoryOwner === null || item.headRepositoryOwner === page.target.owner
        ? item.headRefName
        : `${item.headRepositoryOwner}:${item.headRefName}`,
    mergeState: item.mergeStateStatus.toLowerCase(),
    number: item.number,
    ...(item.reviewDecision !== null &&
      item.reviewDecision !== '' && { reviewDecision: item.reviewDecision.toLowerCase() }),
    status: item.isDraft ? 'draft' : item.state.toLowerCase(),
    ...(item.summary !== '(no description)' && { summary: item.summary }),
    threads: item.reviewThreadCount,
    title: item.title,
  })),
  nextCursor: page.nextCursor,
  repo: repositoryName(page.target),
  total: page.total,
});
