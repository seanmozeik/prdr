import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Cause, Console as EffectConsole, Effect, Layer, Schema } from 'effect';
import { CliError, Command } from 'effect/unstable/cli';

import pkg from '../../package.json' with { type: 'json' };
import { aikidoCommand, greptileCommand } from '../commands/providers';
import { inspectCommand, listCommand, showCommand } from '../commands/read';
import {
  commentCommand,
  editCommand,
  replyCommand,
  resolveCommand,
  reviewCommand,
  unresolveCommand,
} from '../commands/write';
import { GhClient } from '../github/client';
import { sanitizeTerminalLine, tone } from '../lib/tty';
import { type StructuredOutputMode, writeStructuredFailure } from './output';
import { skillCommand } from './skill';

const app = Command.make('prdr', {}, () => Effect.void).pipe(
  Command.withDescription('Read and update GitHub pull request review conversations safely'),
  Command.withSubcommands([
    inspectCommand,
    listCommand,
    showCommand,
    commentCommand,
    replyCommand,
    editCommand,
    reviewCommand,
    resolveCommand,
    unresolveCommand,
    greptileCommand,
    aikidoCommand,
    skillCommand,
  ]),
);

const requestedStructuredMode = (): StructuredOutputMode | null => {
  if (process.argv.includes('--agent')) {
    return 'agent';
  }
  return process.argv.includes('--json') ? 'json' : null;
};

const structuredMode = requestedStructuredMode();
const actionFlagWasRequested = process.argv
  .slice(2)
  .some(
    (argument) =>
      argument === '--help' ||
      argument === '-h' ||
      argument === '--version' ||
      argument === '-v' ||
      argument === '--wizard' ||
      argument === '--completions' ||
      argument.startsWith('--completions='),
  );
const ownsCliErrorRendering = structuredMode !== null && !actionFlagWasRequested;
const discardCliOutput = (): undefined => undefined;
const silentConsole = {
  ...globalThis.console,
  error: discardCliOutput,
  log: discardCliOutput,
} satisfies EffectConsole.Console;
const commandProgram = Command.run(app, {
  renderErrors: !ownsCliErrorRendering,
  version: pkg.version,
});
const program = ownsCliErrorRendering
  ? commandProgram.pipe(Effect.provideService(EffectConsole.Console, silentConsole))
  : commandProgram;
const runtimeLayer = Layer.mergeAll(BunServices.layer, GhClient.layer);

const showHelpFromCause = (cause: Cause.Cause<unknown>): CliError.ShowHelp | undefined => {
  for (const reason of cause.reasons) {
    if (
      Cause.isFailReason(reason) &&
      CliError.isCliError(reason.error) &&
      Schema.is(CliError.ShowHelp)(reason.error)
    ) {
      return reason.error;
    }
  }
  return undefined;
};

const boundaryErrorFromCause = (cause: Cause.Cause<unknown>): unknown => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      return reason.error;
    }
  }
  return Cause.pretty(cause);
};

const taggedErrorCode = (error: unknown): string | null => {
  if (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    typeof error._tag === 'string'
  ) {
    return error._tag;
  }
  return null;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return taggedErrorCode(error) ?? String(error);
};

const commandName = (): string => {
  const [first = 'prdr', second] = process.argv.slice(2);
  if (first === 'greptile' || first === 'aikido') {
    return second === undefined || second.startsWith('-') ? first : `${first}.${second}`;
  }
  return first;
};

const writeBoundaryError = (error: unknown): void => {
  const message = errorMessage(error);
  const code = taggedErrorCode(error) ?? 'error';
  if (structuredMode === null) {
    console.error(tone.danger(sanitizeTerminalLine(message)));
  } else {
    writeStructuredFailure(structuredMode, commandName(), message, code, { value: error });
  }
  process.exitCode = 1;
};

const handled = program.pipe(
  Effect.provide(runtimeLayer),
  Effect.catchCause((cause) =>
    Effect.sync(() => {
      const help = showHelpFromCause(cause);
      if (help !== undefined) {
        if (help.errors.length > 0) {
          process.exitCode = 1;
          if (structuredMode !== null) {
            const errors = help.errors.map((error) => ({
              code: taggedErrorCode(error) ?? 'CliError',
              message: errorMessage(error),
            }));
            writeStructuredFailure(
              structuredMode,
              commandName(),
              errors.map(({ message }) => message).join('; '),
              'CliUsageError',
              { value: { commandPath: Array.from(help.commandPath), errors } },
            );
          }
        }
        return;
      }
      cause.pipe(boundaryErrorFromCause, writeBoundaryError);
    }),
  ),
);

export const runCli = (): void => {
  BunRuntime.runMain(handled);
};
