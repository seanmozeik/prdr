import { Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';

import { markdownOptions, outputMode, targetOptions } from '../cli/flags';
import { printMutation } from '../cli/presentation';
import {
  emit,
  loadAikidoContext,
  loadGreptileContext,
  loadThreadContext,
  toMode,
} from '../cli/shared';
import { UnsupportedMutationError } from '../domain/errors';
import { aikidoIgnoreBody, readMarkdown, withGreptileMention } from '../domain/markdown';
import { aikidoStatus, greptileStatus } from '../domain/providers';
import { selectThread } from '../domain/selection';
import { waitForGreptile } from '../domain/wait';
import { loadGreptileSnapshot } from '../github/loaders';
import { createIssueComment, replyToThread } from '../github/mutations';
import { resolvePullRequest, resolvePullRequestContext } from '../github/target';
import { sanitizeTerminalLine } from '../lib/tty';

const referenceArgument = Argument.string('reference').pipe(
  Argument.withDescription('An Aikido review-comment:ID or thread:ID reference'),
);

const waitIntervalFlag = Flag.integer('interval-seconds').pipe(
  Flag.withDefault(15),
  Flag.withDescription('Polling interval in seconds (1-300)'),
);

const waitTimeoutFlag = Flag.integer('timeout-seconds').pipe(
  Flag.withDefault(600),
  Flag.withDescription('Maximum wait in seconds (1-3600)'),
);

const emitValue = (
  agent: boolean,
  json: boolean,
  command: string,
  value: object,
  human: () => void,
): void => {
  emit(toMode(agent, json), command, value, human);
};

const greptileStatusCommand = Command.make(
  'status',
  { ...outputMode, ...targetOptions },
  ({ agent, branch, json, pr, repo }) =>
    Effect.gen(function* greptileStatusCommandGen() {
      const { snapshot } = yield* loadGreptileContext({ branch, pr, repo });
      const status = greptileStatus(snapshot);
      yield* Effect.sync(() => {
        emitValue(agent, json, 'greptile.status', status, () => {
          console.log(`${status.openThreads.length} open Greptile thread(s)`);
          console.log(`Current head: ${sanitizeTerminalLine(status.currentHead)}`);
          console.log(
            `Confidence: ${status.confidence === null ? 'unknown' : `${status.confidence}/5`}`,
          );
          console.log(
            `Last reviewed commit: ${sanitizeTerminalLine(status.lastReviewedCommit ?? 'unknown')}`,
          );
        });
      });
    }),
).pipe(Command.withDescription('Read Greptile activity, completed review data, and open threads'));

const greptileTriggerCommand = Command.make(
  'trigger',
  { ...outputMode, ...targetOptions },
  ({ agent, branch, json, pr, repo }) =>
    Effect.gen(function* greptileTriggerCommandGen() {
      const target = yield* resolvePullRequest(repo, pr, branch);
      const created = yield* createIssueComment(target, '@greptileai review this pull request');
      yield* Effect.sync(() => {
        emitValue(agent, json, 'greptile.trigger', created, () => {
          printMutation(created);
        });
      });
    }),
).pipe(Command.withDescription('Manually ask Greptile to review the selected pull request head'));

const greptileAskCommand = Command.make(
  'ask',
  { ...markdownOptions, ...outputMode, ...targetOptions },
  ({ agent, bodyFile, branch, json, pr, repo, stdin }) =>
    Effect.gen(function* greptileAskCommandGen() {
      const body = withGreptileMention(yield* readMarkdown({ bodyFile, stdin }));
      const target = yield* resolvePullRequest(repo, pr, branch);
      const created = yield* createIssueComment(target, body);
      yield* Effect.sync(() => {
        emitValue(agent, json, 'greptile.ask', created, () => {
          printMutation(created);
        });
      });
    }),
).pipe(Command.withDescription('Ask Greptile a pull request question from exact Markdown input'));

const greptileWaitCommand = Command.make(
  'wait',
  {
    ...outputMode,
    ...targetOptions,
    intervalSeconds: waitIntervalFlag,
    timeoutSeconds: waitTimeoutFlag,
  },
  ({ agent, branch, intervalSeconds, json, pr, repo, timeoutSeconds }) =>
    Effect.gen(function* greptileWaitCommandGen() {
      const result = yield* waitForGreptile(
        { intervalSeconds, timeoutSeconds },
        () => resolvePullRequestContext(repo, pr, branch),
        loadGreptileSnapshot,
      );
      yield* Effect.sync(() => {
        emitValue(agent, json, 'greptile.wait', result, () => {
          console.log(
            `Greptile reviewed ${sanitizeTerminalLine(result.head)} after ${result.attempts} attempt(s).`,
          );
        });
      });
    }),
).pipe(Command.withDescription('Wait for Greptile to complete a review of the selected head'));

export const greptileCommand = Command.make('greptile').pipe(
  Command.withDescription('Inspect Greptile review activity and manual recovery actions'),
  Command.withSubcommands([
    greptileStatusCommand,
    greptileTriggerCommand,
    greptileAskCommand,
    greptileWaitCommand,
  ]),
);

const aikidoStatusCommand = Command.make(
  'status',
  { ...outputMode, ...targetOptions },
  ({ agent, branch, json, pr, repo }) =>
    Effect.gen(function* aikidoStatusCommandGen() {
      const { snapshot } = yield* loadAikidoContext({ branch, pr, repo });
      const status = aikidoStatus(snapshot);
      yield* Effect.sync(() => {
        emitValue(agent, json, 'aikido.status', status, () => {
          console.log(`${status.openThreads.length} open Aikido thread(s)`);
          console.log(`Current head: ${sanitizeTerminalLine(status.currentHead)}`);
          for (const check of status.checks) {
            console.log(`${sanitizeTerminalLine(check.state)} ${sanitizeTerminalLine(check.name)}`);
          }
        });
      });
    }),
).pipe(Command.withDescription('Read Aikido checks and open security review threads'));

const aikidoIgnoreCommand = Command.make(
  'ignore',
  { ...markdownOptions, ...outputMode, ...targetOptions, reference: referenceArgument },
  ({ agent, bodyFile, branch, json, pr, reference, repo, stdin }) =>
    Effect.gen(function* aikidoIgnoreCommandGen() {
      const reason = yield* readMarkdown({ bodyFile, stdin });
      const body = yield* aikidoIgnoreBody(reason);
      const { snapshot, target } = yield* loadThreadContext({ branch, pr, repo });
      const thread = yield* selectThread(snapshot, reference);
      if (thread.root.metadata.provider !== 'aikido') {
        return yield* UnsupportedMutationError.make({
          detail: 'The selected thread was not created by Aikido Security.',
          reference,
        });
      }
      const created = yield* replyToThread(target, thread, body, snapshot.pullRequest.headRefOid);
      return yield* Effect.sync(() => {
        emitValue(agent, json, 'aikido.ignore', created, () => {
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
  Command.withDescription(
    'Inspect Aikido Security review activity and confirmed false-positive actions',
  ),
  Command.withSubcommands([aikidoStatusCommand, aikidoIgnoreCommand]),
);
