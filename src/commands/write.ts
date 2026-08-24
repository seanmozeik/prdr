import { Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';

import { markdownOptions, outputMode, targetOptions } from '../cli/flags';
import { printMutation } from '../cli/presentation';
import { emit, loadConversationContext, loadThreadContext, toMode } from '../cli/shared';
import { readMarkdown } from '../domain/markdown';
import { selectComment, selectThread } from '../domain/selection';
import {
  createIssueComment,
  editComment,
  replyToThread,
  resolveThread,
  submitReview,
  unresolveThread,
  type ReviewEvent,
} from '../github/mutations';
import { resolvePullRequest, resolvePullRequestContext } from '../github/target';

const replyReferenceArgument = Argument.string('reference').pipe(
  Argument.withDescription('A review-comment:ID or thread:ID reference'),
);
const editReferenceArgument = Argument.string('reference').pipe(
  Argument.withDescription('An issue-comment:ID or review-comment:ID reference'),
);
const threadReferenceArgument = Argument.string('reference').pipe(
  Argument.withDescription('A review-comment:ID or thread:ID reference'),
);
const reviewEventFlag = Flag.choice('event', ['comment', 'approve', 'request-changes']).pipe(
  Flag.withDefault('comment'),
  Flag.withDescription('GitHub review event'),
);

const emitMutation = (agent: boolean, json: boolean, command: string, value: object): void => {
  emit(toMode(agent, json), command, value, () => {
    printMutation(value);
  });
};

const reviewEvents = {
  approve: 'APPROVE',
  comment: 'COMMENT',
  'request-changes': 'REQUEST_CHANGES',
} as const satisfies Readonly<Record<'approve' | 'comment' | 'request-changes', ReviewEvent>>;

const toReviewEvent = (event: keyof typeof reviewEvents): ReviewEvent => reviewEvents[event];

export const commentCommand = Command.make(
  'comment',
  { ...markdownOptions, ...outputMode, ...targetOptions },
  ({ agent, bodyFile, json, pr, repo, stdin }) =>
    Effect.gen(function* commentCommandGen() {
      const body = yield* readMarkdown({ bodyFile, stdin });
      const target = yield* resolvePullRequest(repo, pr);
      const created = yield* createIssueComment(target, body);
      yield* Effect.sync(() => {
        emitMutation(agent, json, 'comment', created);
      });
    }),
).pipe(Command.withDescription('Create a pull request issue comment from exact Markdown input'));

export const replyCommand = Command.make(
  'reply',
  { ...markdownOptions, ...outputMode, ...targetOptions, reference: replyReferenceArgument },
  ({ agent, bodyFile, json, pr, reference, repo, stdin }) =>
    Effect.gen(function* replyCommandGen() {
      const body = yield* readMarkdown({ bodyFile, stdin });
      const { snapshot, target } = yield* loadThreadContext({ pr, repo });
      const thread = yield* selectThread(snapshot, reference);
      const created = yield* replyToThread(target, thread, body, snapshot.pullRequest.headRefOid);
      yield* Effect.sync(() => {
        emitMutation(agent, json, 'reply', created);
      });
    }),
).pipe(Command.withDescription('Reply to an inline review thread from exact Markdown input'));

export const editCommand = Command.make(
  'edit',
  { ...markdownOptions, ...outputMode, ...targetOptions, reference: editReferenceArgument },
  ({ agent, bodyFile, json, pr, reference, repo, stdin }) =>
    Effect.gen(function* editCommandGen() {
      const body = yield* readMarkdown({ bodyFile, stdin });
      const { snapshot, target } = yield* loadConversationContext({ pr, repo });
      const selection = yield* selectComment(snapshot, reference);
      const updated = yield* editComment(target, selection, body, snapshot.pullRequest.headRefOid);
      yield* Effect.sync(() => {
        emitMutation(agent, json, 'edit', updated);
      });
    }),
).pipe(Command.withDescription('Edit an issue or inline review comment with exact Markdown input'));

export const reviewCommand = Command.make(
  'review',
  { ...markdownOptions, ...outputMode, ...targetOptions, event: reviewEventFlag },
  ({ agent, bodyFile, event, json, pr, repo, stdin }) =>
    Effect.gen(function* reviewCommandGen() {
      const body = yield* readMarkdown({ bodyFile, stdin });
      const context = yield* resolvePullRequestContext(repo, pr);
      const githubEvent = toReviewEvent(event);
      const review = yield* submitReview(
        context.target,
        githubEvent,
        body,
        context.pullRequest.headRefOid,
      );
      yield* Effect.sync(() => {
        emitMutation(agent, json, 'review', review);
      });
    }),
).pipe(Command.withDescription('Submit a GitHub pull request review from exact Markdown input'));

const threadMutationCommand = (name: 'resolve' | 'unresolve') =>
  Command.make(
    name,
    { ...outputMode, ...targetOptions, reference: threadReferenceArgument },
    ({ agent, json, pr, reference, repo }) =>
      Effect.gen(function* threadMutationCommandGen() {
        const { snapshot, target } = yield* loadThreadContext({ pr, repo });
        const thread = yield* selectThread(snapshot, reference);
        const result =
          name === 'resolve'
            ? yield* resolveThread(target, thread, snapshot.pullRequest.headRefOid)
            : yield* unresolveThread(target, thread, snapshot.pullRequest.headRefOid);
        yield* Effect.sync(() => {
          emitMutation(agent, json, name, result);
        });
      }),
  ).pipe(
    Command.withDescription(`${name === 'resolve' ? 'Resolve' : 'Unresolve'} a review thread`),
  );

export const resolveCommand = threadMutationCommand('resolve');
export const unresolveCommand = threadMutationCommand('unresolve');
