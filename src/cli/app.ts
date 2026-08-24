import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Cause, Effect, Layer } from 'effect';
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
import { color, failPayload } from './output';
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

const program = Command.run(app, { version: pkg.version });
const runtimeLayer = Layer.mergeAll(BunServices.layer, GhClient.layer);

const showHelpHasErrors = (cause: Cause.Cause<unknown>): boolean | undefined => {
  for (const reason of cause.reasons) {
    if (
      Cause.isFailReason(reason) &&
      CliError.isCliError(reason.error) &&
      reason.error instanceof CliError.ShowHelp
    ) {
      return reason.error.errors.length > 0;
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
  if (
    typeof error === 'object' &&
    error !== null &&
    'detail' in error &&
    typeof error.detail === 'string'
  ) {
    return error.detail;
  }
  return error instanceof Error ? error.message : (taggedErrorCode(error) ?? String(error));
};

const writeBoundaryError = (error: unknown): void => {
  const message = errorMessage(error);
  const code = taggedErrorCode(error) ?? 'error';
  if (process.argv.includes('--agent')) {
    console.log(JSON.stringify({ ...failPayload(message, code), error }));
  } else if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...failPayload(message, code), error }, null, 2));
  } else {
    console.error(color.red(message));
  }
  process.exitCode = 1;
};

const handled = program.pipe(
  Effect.provide(runtimeLayer),
  Effect.catchCause((cause) =>
    Effect.sync(() => {
      const helpHasErrors = showHelpHasErrors(cause);
      if (helpHasErrors !== undefined) {
        if (helpHasErrors) {
          process.exitCode = 1;
        }
        return;
      }
      writeBoundaryError(boundaryErrorFromCause(cause));
    }),
  ),
);

export const runCli = (): void => {
  BunRuntime.runMain(handled);
};
