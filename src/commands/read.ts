import { Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';

import { outputMode, targetOptions } from '../cli/flags';
import { printComment, printList, printSnapshot } from '../cli/presentation';
import { emit, loadExactSnapshot, loadReviewIndexSnapshot, toMode } from '../cli/shared';
import { toAgentInspection, toAgentListPage, toAgentShownComment } from '../domain/agent-output';
import { providerValues } from '../domain/model';
import { DEFAULT_PAGE_SIZE, paginateReviewItems, prepareListPage } from '../domain/pagination';
import { selectComment, selectIndexedComment } from '../domain/selection';

const providerFlag = Flag.choice('provider', ['all', ...providerValues]).pipe(
  Flag.withDefault('all'),
  Flag.withDescription('Filter by review provider'),
);
const stateFlag = Flag.choice('state', ['all', 'open', 'resolved', 'unthreaded']).pipe(
  Flag.withDefault('open'),
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
      const mode = toMode(agent, json);
      if (mode === 'json') {
        const snapshot = yield* loadExactSnapshot({ branch, pr, repo }, true);
        yield* Effect.sync(() => {
          emit(mode, 'inspect', snapshot, () => {
            printSnapshot(snapshot);
          });
        });
        return;
      }
      const snapshot = yield* loadReviewIndexSnapshot({ branch, pr, repo }, true);
      yield* Effect.sync(() => {
        emit(mode, 'inspect', mode === 'agent' ? toAgentInspection(snapshot) : snapshot, () => {
          printSnapshot(snapshot);
        });
      });
    }),
).pipe(Command.withDescription('Inspect pull request state, review findings, and checks'));

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
      const snapshot = yield* loadReviewIndexSnapshot({ branch, pr, repo }, false);
      const filters = { author, provider, state } as const;
      const page = yield* paginateReviewItems(snapshot, filters, pageOptions);
      const mode = toMode(agent, json);
      yield* Effect.sync(() => {
        emit(mode, 'list', mode === 'agent' ? toAgentListPage(page) : page, () => {
          printList(page);
        });
      });
    }),
).pipe(Command.withDescription('List cursor-paged review findings; defaults to open threads'));

export const showCommand = Command.make(
  'show',
  { ...outputMode, ...targetOptions, reference: referenceArgument },
  ({ agent, branch, json, pr, reference, repo }) =>
    Effect.gen(function* showCommandGen() {
      const mode = toMode(agent, json);
      if (mode === 'json') {
        const snapshot = yield* loadExactSnapshot({ branch, pr, repo }, false);
        const selection = yield* selectComment(snapshot, reference);
        yield* Effect.sync(() => {
          emit(mode, 'show', selection, () => {
            printComment(selection);
          });
        });
        return;
      }
      const snapshot = yield* loadReviewIndexSnapshot({ branch, pr, repo }, false);
      const selection = yield* selectIndexedComment(snapshot, reference);
      yield* Effect.sync(() => {
        emit(
          mode,
          'show',
          mode === 'agent'
            ? toAgentShownComment(snapshot.target, snapshot.pullRequest.headRefOid, selection)
            : selection,
          () => {
            printComment(selection);
          },
        );
      });
    }),
).pipe(
  Command.withDescription(
    'Show a safe rendered comment; structured output keeps exact raw Markdown',
  ),
);
