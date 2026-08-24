import { Schema } from 'effect';

import { attentionCheckBucketValues } from './checks';
import { knownFindingSeverityValues, providerValues } from './model';

const AgentProvider = Schema.Literals(providerValues);
const AgentSeverity = Schema.Literals(knownFindingSeverityValues);
const AgentLocation = Schema.Struct({ line: Schema.optionalKey(Schema.Int), path: Schema.String });
export const AgentTarget = Schema.Struct({
  head: Schema.String,
  pr: Schema.Int,
  repo: Schema.String,
});
export type AgentTarget = typeof AgentTarget.Type;

export const AgentFinding = Schema.Struct({
  author: Schema.String,
  location: Schema.optionalKey(AgentLocation),
  provider: AgentProvider,
  ref: Schema.String,
  replies: Schema.optionalKey(Schema.Int),
  severity: Schema.optionalKey(AgentSeverity),
  state: Schema.Literals(['open', 'resolved', 'unthreaded']),
  summary: Schema.optionalKey(Schema.String),
  thread: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
});
export type AgentFinding = typeof AgentFinding.Type;

export const AgentListPage = Schema.Struct({
  hasMore: Schema.Boolean,
  items: Schema.Array(AgentFinding),
  nextCursor: Schema.NullOr(Schema.String),
  target: AgentTarget,
  total: Schema.Int,
});
export type AgentListPage = typeof AgentListPage.Type;

export const AgentThreadComment = Schema.Struct({
  author: Schema.String,
  body: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  provider: AgentProvider,
  ref: Schema.String,
  severity: Schema.optionalKey(AgentSeverity),
  title: Schema.optionalKey(Schema.String),
});
export type AgentThreadComment = typeof AgentThreadComment.Type;

export const AgentShownThread = Schema.Struct({
  actions: Schema.Array(Schema.Literals(['reply', 'resolve', 'unresolve'])),
  otherComments: Schema.optionalKey(Schema.Array(AgentThreadComment)),
  outdated: Schema.optionalKey(Schema.Literal(true)),
  resolvedBy: Schema.optionalKey(Schema.String),
  rootRef: Schema.optionalKey(Schema.String),
  state: Schema.Literals(['open', 'resolved']),
  ref: Schema.String,
});
export type AgentShownThread = typeof AgentShownThread.Type;

export const AgentShownComment = Schema.Struct({
  author: Schema.String,
  body: Schema.NullOr(Schema.String),
  createdAt: Schema.optionalKey(Schema.String),
  location: Schema.optionalKey(AgentLocation),
  provider: AgentProvider,
  ref: Schema.String,
  reviewState: Schema.optionalKey(Schema.String),
  severity: Schema.optionalKey(AgentSeverity),
  target: AgentTarget,
  thread: Schema.optionalKey(AgentShownThread),
  title: Schema.optionalKey(Schema.String),
});
export type AgentShownComment = typeof AgentShownComment.Type;

const AgentCheck = Schema.Struct({
  bucket: Schema.Literals(attentionCheckBucketValues),
  name: Schema.String,
  state: Schema.String,
});
const AgentChecks = Schema.Struct({
  attention: Schema.Array(AgentCheck),
  cancel: Schema.Int,
  fail: Schema.Int,
  pass: Schema.Int,
  pending: Schema.Int,
  skipping: Schema.Int,
});
const AgentReviewSummary = Schema.Struct({
  open: Schema.Int,
  openItems: Schema.Array(AgentFinding),
  resolved: Schema.Int,
  unthreaded: Schema.Int,
});

export const AgentInspection = Schema.Struct({
  author: Schema.optionalKey(Schema.String),
  base: Schema.String,
  branch: Schema.String,
  checks: AgentChecks,
  draft: Schema.Boolean,
  mergeState: Schema.String,
  reviewDecision: Schema.optionalKey(Schema.String),
  reviews: AgentReviewSummary,
  state: Schema.String,
  target: AgentTarget,
  title: Schema.String,
});
export type AgentInspection = typeof AgentInspection.Type;

const AgentPullRequest = Schema.Struct({
  ageDays: Schema.Int,
  author: Schema.String,
  base: Schema.String,
  checks: Schema.optionalKey(Schema.String),
  comments: Schema.Int,
  head: Schema.String,
  mergeState: Schema.String,
  number: Schema.Int,
  reviewDecision: Schema.optionalKey(Schema.String),
  status: Schema.String,
  summary: Schema.optionalKey(Schema.String),
  threads: Schema.Int,
  title: Schema.String,
});

export const AgentPullRequestListPage = Schema.Struct({
  hasMore: Schema.Boolean,
  items: Schema.Array(AgentPullRequest),
  nextCursor: Schema.NullOr(Schema.String),
  repo: Schema.String,
  total: Schema.Int,
});
export type AgentPullRequestListPage = typeof AgentPullRequestListPage.Type;
