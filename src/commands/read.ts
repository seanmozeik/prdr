import { Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';

import { outputMode, targetOptions } from '../cli/flags';
import { printComment, printList, printSnapshot } from '../cli/presentation';
import { emit, loadContext, loadConversationContext, toMode } from '../cli/shared';
import { DEFAULT_PAGE_SIZE, paginateReviewItems, prepareListPage } from '../domain/pagination';
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
const cursorFlag = Flag.string('cursor').pipe(
  Flag.withDefault(''),
  Flag.withDescription('Continue a list from an opaque nextCursor value'),
);
const limitFlag = Flag.integer('limit').pipe(
  Flag.withDefault(DEFAULT_PAGE_SIZE),
  Flag.withDescription('Maximum records per page (1-100)'),
);
const referenceArgument = Argument.string('reference').pipe(
  Argument.withDescription('A qualified KIND:ID reference from prdr list'),
);

export const inspectCommand = Command.make(
  'inspect',
  { ...outputMode, ...targetOptions },
  ({ agent, branch, json, pr, repo }) =>
    Effect.gen(function* inspectCommandGen() {
      const { snapshot } = yield* loadContext({ branch, pr, repo });
      const mode = toMode(agent, json);
      yield* Effect.sync(() => {
        emit(mode, 'inspect', snapshot, () => {
          printSnapshot(snapshot);
        });
      });
    }),
).pipe(Command.withDescription('Read a consistent pull request review snapshot'));

export const listCommand = Command.make(
  'list',
  {
    ...outputMode,
    ...targetOptions,
    author: authorFlag,
    cursor: cursorFlag,
    limit: limitFlag,
    provider: providerFlag,
    state: stateFlag,
  },
  ({ agent, author, branch, cursor, json, limit, pr, provider, repo, state }) =>
    Effect.gen(function* listCommandGen() {
      const pageOptions = yield* prepareListPage({ cursor, limit });
      const { snapshot } = yield* loadConversationContext({ branch, pr, repo });
      const filters = { author, provider, state } as const;
      const page = yield* paginateReviewItems(snapshot, filters, pageOptions);
      const mode = toMode(agent, json);
      yield* Effect.sync(() => {
        emit(mode, 'list', page, () => {
          printList(page);
        });
      });
    }),
).pipe(Command.withDescription('List a cursor-paged set of findings with qualified references'));

export const showCommand = Command.make(
  'show',
  { ...outputMode, ...targetOptions, reference: referenceArgument },
  ({ agent, branch, json, pr, reference, repo }) =>
    Effect.gen(function* showCommandGen() {
      const { snapshot } = yield* loadConversationContext({ branch, pr, repo });
      const selection = yield* selectComment(snapshot, reference);
      const mode = toMode(agent, json);
      yield* Effect.sync(() => {
        emit(mode, 'show', selection, () => {
          printComment(selection);
        });
      });
    }),
).pipe(
  Command.withDescription(
    'Show a safe rendered comment; use --agent or --json for the exact raw Markdown body',
  ),
);
