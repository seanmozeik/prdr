import { Effect } from 'effect';
import { Argument, Command } from 'effect/unstable/cli';

import { markdownOptions, outputMode, targetOptions } from '../cli/flags';
import { printMutation } from '../cli/presentation';
import { emit, loadContext, toMode } from '../cli/shared';
import { UnsupportedMutationError } from '../domain/errors';
import { aikidoIgnoreBody, readMarkdown, withGreptileMention } from '../domain/markdown';
import { aikidoStatus, greptileStatus } from '../domain/providers';
import { selectThread } from '../domain/selection';
import { createIssueComment, replyToThread } from '../github/mutations';
import { resolvePullRequest } from '../github/target';

const referenceArgument = Argument.string('reference').pipe(
  Argument.withDescription('An Aikido review-comment:ID or thread:ID reference'),
);

const emitValue = (agent: boolean, json: boolean, value: unknown, human: () => void): void => {
  emit(toMode(agent, json), value, human);
};

const greptileStatusCommand = Command.make(
  'status',
  { ...outputMode, ...targetOptions },
  ({ agent, json, pr, repo }) =>
    Effect.gen(function* greptileStatusCommandGen() {
      const { snapshot } = yield* loadContext({ pr, repo });
      const status = greptileStatus(snapshot);
      yield* Effect.sync(() => {
        emitValue(agent, json, status, () => {
          console.log(`${status.openThreads.length} open Greptile thread(s)`);
          console.log(`Confidence: ${status.confidence ?? 'unknown'}/5`);
          console.log(`Last reviewed commit: ${status.lastReviewedCommit ?? 'unknown'}`);
        });
      });
    }),
).pipe(Command.withDescription('Read Greptile summary data and open review threads'));

const greptileTriggerCommand = Command.make(
  'trigger',
  { ...outputMode, ...targetOptions },
  ({ agent, json, pr, repo }) =>
    Effect.gen(function* greptileTriggerCommandGen() {
      const target = yield* resolvePullRequest(repo, pr);
      const created = yield* createIssueComment(target, '@greptileai review this pull request');
      yield* Effect.sync(() => {
        emitValue(agent, json, created, () => {
          printMutation(created);
        });
      });
    }),
).pipe(Command.withDescription('Ask Greptile to review the current pull request head'));

const greptileAskCommand = Command.make(
  'ask',
  { ...markdownOptions, ...outputMode, ...targetOptions },
  ({ agent, bodyFile, json, pr, repo, stdin }) =>
    Effect.gen(function* greptileAskCommandGen() {
      const target = yield* resolvePullRequest(repo, pr);
      const body = withGreptileMention(yield* readMarkdown({ bodyFile, stdin }));
      const created = yield* createIssueComment(target, body);
      yield* Effect.sync(() => {
        emitValue(agent, json, created, () => {
          printMutation(created);
        });
      });
    }),
).pipe(Command.withDescription('Ask Greptile a pull request question from exact Markdown input'));

export const greptileCommand = Command.make('greptile').pipe(
  Command.withDescription('Inspect and trigger Greptile review activity'),
  Command.withSubcommands([greptileStatusCommand, greptileTriggerCommand, greptileAskCommand]),
);

const aikidoStatusCommand = Command.make(
  'status',
  { ...outputMode, ...targetOptions },
  ({ agent, json, pr, repo }) =>
    Effect.gen(function* aikidoStatusCommandGen() {
      const { snapshot } = yield* loadContext({ pr, repo });
      const status = aikidoStatus(snapshot);
      yield* Effect.sync(() => {
        emitValue(agent, json, status, () => {
          console.log(`${status.openThreads.length} open Aikido thread(s)`);
          for (const check of status.checks) {
            console.log(`${check.state} ${check.name}`);
          }
        });
      });
    }),
).pipe(Command.withDescription('Read Aikido checks and open security review threads'));

const aikidoIgnoreCommand = Command.make(
  'ignore',
  { ...markdownOptions, ...outputMode, ...targetOptions, reference: referenceArgument },
  ({ agent, bodyFile, json, pr, reference, repo, stdin }) =>
    Effect.gen(function* aikidoIgnoreCommandGen() {
      const { snapshot, target } = yield* loadContext({ pr, repo });
      const thread = yield* selectThread(snapshot, reference);
      if (thread.root.metadata.provider !== 'aikido') {
        return yield* new UnsupportedMutationError({
          detail: 'The selected thread was not created by Aikido Security.',
          reference,
        });
      }
      const reason = yield* readMarkdown({ bodyFile, stdin });
      const body = yield* aikidoIgnoreBody(reason);
      const created = yield* replyToThread(target, thread, body);
      return yield* Effect.sync(() => {
        emitValue(agent, json, created, () => {
          printMutation(created);
        });
      });
    }),
).pipe(
  Command.withDescription(
    'Reply with the exact Aikido ignore syntax after a false-positive decision',
  ),
);

export const aikidoCommand = Command.make('aikido').pipe(
  Command.withDescription('Inspect and respond to Aikido Security review activity'),
  Command.withSubcommands([aikidoStatusCommand, aikidoIgnoreCommand]),
);
