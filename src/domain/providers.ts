import type {
  AikidoStatus,
  FindingMetadata,
  FindingSeverity,
  GreptileStatus,
  Provider,
  PullRequestSnapshot,
} from './model';

const greptileLogins = new Set(['greptile-apps[bot]', 'greptileai[bot]', 'greptile[bot]']);
const aikidoLogins = new Set(['aikido-pr-checks[bot]', 'aikidosec[bot]']);

const titlePattern = /\*\*(?<title>[^*\n]+)\*\*/u;
const greptileSeverityPattern = /alt=["']P(?<priority>[0-2])["']/iu;
const aikidoSeverityPattern = /\b(?<severity>critical|high|medium|low) severity\b/iu;
const confidencePattern = /Confidence Score:\s*(?<score>[0-5](?:\.\d+)?)\/5/iu;
const reviewCountPattern = /Reviews \((?<count>[0-9]+)\)/u;
const commitPattern = /github\.com\/[^/]+\/[^/]+\/commit\/(?<sha>[0-9a-f]{7,40})/iu;

export const providerFor = (login: string, actorType?: string): Provider => {
  const normalized = login.toLowerCase();
  if (greptileLogins.has(normalized)) {
    return 'greptile';
  }
  if (aikidoLogins.has(normalized)) {
    return 'aikido';
  }
  if (normalized.endsWith('[bot]') || actorType?.toLowerCase() === 'bot') {
    return 'other-bot';
  }
  return 'human';
};

const greptileSeverity = (body: string): FindingSeverity => {
  const priority = greptileSeverityPattern.exec(body)?.groups?.['priority'];
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
  const title = titlePattern.exec(text)?.groups?.['title']?.trim() ?? null;
  let severity: FindingSeverity = 'unknown';
  if (provider === 'greptile') {
    severity = greptileSeverity(text);
  } else if (provider === 'aikido') {
    severity = aikidoSeverity(text);
  }
  return { provider, severity, title };
};

const nullableNumber = (value: string | undefined): number | null =>
  value === undefined ? null : Number(value);

export const greptileStatus = (snapshot: PullRequestSnapshot): GreptileStatus => {
  const summaries = snapshot.issueComments
    .filter((comment) => comment.metadata.provider === 'greptile')
    .toSorted((left, right) => right.updated_at.localeCompare(left.updated_at));
  const latestSummary = summaries[0] ?? null;
  const body = latestSummary?.body ?? '';
  return {
    confidence: nullableNumber(confidencePattern.exec(body)?.groups?.['score']),
    lastReviewedCommit: commitPattern.exec(body)?.groups?.['sha'] ?? null,
    latestSummary,
    openThreads: snapshot.threads.filter(
      (thread) => !thread.isResolved && thread.root.metadata.provider === 'greptile',
    ),
    reviewCount: nullableNumber(reviewCountPattern.exec(body)?.groups?.['count']),
  };
};

export const aikidoStatus = (snapshot: PullRequestSnapshot): AikidoStatus => ({
  checks: snapshot.checks.filter((check) => check.name.toLowerCase().includes('aikido')),
  openThreads: snapshot.threads.filter(
    (thread) => !thread.isResolved && thread.root.metadata.provider === 'aikido',
  ),
});
