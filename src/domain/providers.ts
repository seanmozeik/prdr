import type {
  AikidoStatus,
  FindingMetadata,
  FindingSeverity,
  GreptileStatus,
  Provider,
  ProviderActivity,
  ReviewThreadSummary,
} from './model';
import type {
  AikidoStatusSource,
  GreptileStatusSource,
  IndexedIssueComment,
  IndexedReviewThread,
} from './review-index';
import { compareText, extractMarkdownTitle } from './text';

const greptileLogins = new Set([
  'greptile-apps',
  'greptile-apps[bot]',
  'greptileai',
  'greptileai[bot]',
  'greptile',
  'greptile[bot]',
]);
const aikidoLogins = new Set([
  'aikido-pr-checks',
  'aikido-pr-checks[bot]',
  'aikidosec',
  'aikidosec[bot]',
]);
const codexLogins = new Set(['chatgpt-codex-connector', 'chatgpt-codex-connector[bot]']);
const cursorLogins = new Set(['cursor', 'cursor[bot]']);

const priorityPattern = /(?:alt=["'][^"']*|!\[[^\]]*)\bP(?<priority>[0-2])\b/iu;
const aikidoSeverityPattern = /\b(?<severity>critical|high|medium|low) severity\b/iu;
const confidencePattern = /Confidence Score:\s*(?<score>[0-9]+(?:\.\d+)?)\/5/iu;
const reviewMetadataPattern =
  /Reviews \((?<count>[0-9]+)\):\s*Last reviewed commit:[^\r\n]{0,500}?github\.com\/[^/\s)]+\/[^/\s)]+\/commit\/(?<sha>[0-9a-f]{7,64})/iu;

export const providerFor = (login: string, actorType?: string): Provider => {
  const normalized = login.toLowerCase();
  if (greptileLogins.has(normalized)) {
    return 'greptile';
  }
  if (aikidoLogins.has(normalized)) {
    return 'aikido';
  }
  if (codexLogins.has(normalized)) {
    return 'codex';
  }
  if (cursorLogins.has(normalized)) {
    return 'cursor';
  }
  if (normalized.endsWith('[bot]') || actorType?.toLowerCase() === 'bot') {
    return 'other-bot';
  }
  return 'human';
};

const prioritySeverity = (body: string): FindingSeverity => {
  const priority = priorityPattern.exec(body)?.groups?.['priority'];
  if (priority === '0') {
    return 'critical';
  }
  if (priority === '1') {
    return 'high';
  }
  return priority === '2' ? 'medium' : 'unknown';
};

const aikidoSeverity = (body: string): FindingSeverity => {
  const severity = aikidoSeverityPattern.exec(body)?.groups?.['severity']?.toLowerCase();
  if (
    severity === 'critical' ||
    severity === 'high' ||
    severity === 'medium' ||
    severity === 'low'
  ) {
    return severity;
  }
  return 'unknown';
};

export const findingMetadata = (
  login: string,
  body: string | null,
  actorType?: string,
): FindingMetadata => {
  const provider = providerFor(login, actorType);
  const text = body ?? '';
  const title = extractMarkdownTitle(text);
  let severity: FindingSeverity = 'unknown';
  if (provider === 'greptile' || provider === 'codex') {
    severity = prioritySeverity(text);
  } else if (provider === 'aikido') {
    severity = aikidoSeverity(text);
  }
  return { provider, severity, title };
};

const confidenceValue = (value: string | undefined): number | null => {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
};

const countValue = (value: string | undefined): number | null => {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const providerActivity = (comment: IndexedIssueComment | null): ProviderActivity | null =>
  comment === null
    ? null
    : {
        author: comment.user.login,
        createdAt: comment.created_at,
        ref: comment.ref,
        title: comment.metadata.title,
        updatedAt: comment.updated_at,
        url: comment.html_url,
      };

const threadSummary = (thread: IndexedReviewThread): ReviewThreadSummary => ({
  author: thread.root.user.login,
  isOutdated: thread.isOutdated,
  line: thread.line ?? thread.originalLine,
  path: thread.path,
  replyCount: Math.max(0, thread.comments.length - 1),
  rootRef: thread.root.ref,
  severity: thread.root.metadata.severity,
  threadRef: thread.ref,
  title: thread.root.metadata.title,
  url: thread.root.html_url,
  viewerCanReply: thread.viewerCanReply,
  viewerCanResolve: thread.viewerCanResolve,
});

const isCompletedGreptileReview = (
  comment: GreptileStatusSource['issueComments'][number],
): boolean => {
  const body = comment.body ?? '';
  return confidencePattern.test(body) || reviewMetadataPattern.test(body);
};

export const greptileStatus = (snapshot: GreptileStatusSource): GreptileStatus => {
  const activity = snapshot.issueComments
    .filter((comment) => comment.metadata.provider === 'greptile')
    .toSorted((left, right) => compareText(right.updated_at, left.updated_at));
  const latestActivity = activity[0] ?? null;
  const latestCompletedReview =
    activity.find((comment) => isCompletedGreptileReview(comment)) ?? null;
  const body = latestCompletedReview?.body ?? '';
  const reviewMetadata = reviewMetadataPattern.exec(body);
  return {
    confidence: confidenceValue(confidencePattern.exec(body)?.groups?.['score']),
    currentHead: snapshot.pullRequest.headRefOid,
    lastReviewedCommit: reviewMetadata?.groups?.['sha'] ?? null,
    latestActivity: providerActivity(latestActivity),
    latestCompletedReview: providerActivity(latestCompletedReview),
    openThreads: snapshot.threads
      .filter((thread) => !thread.isResolved && thread.root.metadata.provider === 'greptile')
      .map((thread) => threadSummary(thread)),
    reviewCount: countValue(reviewMetadata?.groups?.['count']),
  };
};

export const aikidoStatus = (snapshot: AikidoStatusSource): AikidoStatus => ({
  checks: snapshot.checks.filter((check) => check.name.toLowerCase().includes('aikido')),
  currentHead: snapshot.pullRequest.headRefOid,
  openThreads: snapshot.threads
    .filter((thread) => !thread.isResolved && thread.root.metadata.provider === 'aikido')
    .map((thread) => threadSummary(thread)),
});
