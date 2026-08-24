import { Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';

import { outputMode, targetOptions } from '../cli/flags';
import { printComment, printList, printSnapshot } from '../cli/presentation';
import { emit, loadContext, toMode } from '../cli/shared';
import { listReviewItems } from '../domain/listing';
import { selectComment } from '../domain/selection';

const providerFlag = Flag.choice('provider', [
  'all',
  'human',
  'greptile',
  'aikido',
  'other-bot',
]).pipe(Flag.withDefault('all'), Flag.withDescription('Filter by review provider'));
const stateFlag = Flag.choice('state', ['all', 'open', 'resolved', 'unthreaded']).pipe(
  Flag.withDefault('all'),
  Flag.withDescription('Filter by GitHub thread state'),
);
const authorFlag = Flag.string('author').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Filter by exact GitHub login'),
);
const referenceArgument = Argument.string('reference').pipe(
  Argument.withDescription('A qualified KIND:ID reference from prdr list'),
);

export const inspectCommand = Command.make(
  'inspect',
  { ...outputMode, ...targetOptions },
  ({ agent, json, pr, repo }) =>
    Effect.gen(function* inspectCommandGen() {
      const { snapshot } = yield* loadContext({ pr, repo });
      const mode = toMode(agent, json);
      yield* Effect.sync(() => {
        emit(mode, snapshot, () => {
          printSnapshot(snapshot);
        });
      });
    }),
).pipe(Command.withDescription('Read a consistent pull request review snapshot'));

export const listCommand = Command.make(
  'list',
  { ...outputMode, ...targetOptions, author: authorFlag, provider: providerFlag, state: stateFlag },
  ({ agent, author, json, pr, provider, repo, state }) =>
    Effect.gen(function* listCommandGen() {
      const { snapshot } = yield* loadContext({ pr, repo });
      const items = listReviewItems(snapshot, { author, provider, state });
      const mode = toMode(agent, json);
      yield* Effect.sync(() => {
        emit(mode, items, () => {
          printList(items);
        });
      });
    }),
).pipe(Command.withDescription('List review findings with stable qualified references'));

export const showCommand = Command.make(
  'show',
  { ...outputMode, ...targetOptions, reference: referenceArgument },
  ({ agent, json, pr, reference, repo }) =>
    Effect.gen(function* showCommandGen() {
      const { snapshot } = yield* loadContext({ pr, repo });
      const selection = yield* selectComment(snapshot, reference);
      const mode = toMode(agent, json);
      yield* Effect.sync(() => {
        emit(mode, selection, () => {
          printComment(selection);
        });
      });
    }),
).pipe(Command.withDescription('Show one comment and its exact raw Markdown body'));
