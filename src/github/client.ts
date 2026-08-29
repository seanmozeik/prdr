import { Context, Effect, Layer, Schema } from 'effect';

import { GhCommandError, GhDecodeError, GhEncodeError } from './errors';

export interface GhRequest {
  readonly acceptedExitCodes: readonly number[];
  readonly arguments: readonly string[];
  readonly cwd?: string;
  readonly input: string | null;
}

export interface GhResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface ProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const execute = async (request: GhRequest, signal: AbortSignal): Promise<ProcessResult> => {
  const subprocess = Bun.spawn(['gh', ...request.arguments], {
    ...(request.cwd !== undefined && { cwd: request.cwd }),
    signal,
    stderr: 'pipe',
    stdin: request.input === null ? 'ignore' : 'pipe',
    stdout: 'pipe',
  });
  if (request.input !== null) {
    const { stdin } = subprocess;
    if (stdin === undefined) {
      throw new Error('gh standard input pipe was not created');
    }
    await stdin.write(request.input);
    await stdin.end();
  }
  const [exitCode, stderr, stdout] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

const makeRun = Effect.fn('GhClient.run')(function* makeRun(request: GhRequest) {
  const result = yield* Effect.tryPromise({
    catch: (cause) =>
      GhCommandError.make({
        arguments: Array.from(request.arguments),
        exitCode: null,
        stderr: cause instanceof Error ? cause.message : String(cause),
        stdout: '',
      }),
    try: (signal) => execute(request, signal),
  });
  if (!request.acceptedExitCodes.includes(result.exitCode)) {
    return yield* GhCommandError.make({
      arguments: Array.from(request.arguments),
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }
  return result;
});

export class GhClient extends Context.Service<GhClient, { readonly run: typeof makeRun }>()(
  '@seanmozeik/prdr/github/client/GhClient',
) {
  static readonly layer = Layer.succeed(GhClient, { run: makeRun });
}

export const ghRequest = (
  arguments_: readonly string[],
  input: string | null = null,
  acceptedExitCodes: readonly number[] = [0],
): GhRequest => ({ acceptedExitCodes, arguments: arguments_, input });

export const ghRequestInDirectory = (
  arguments_: readonly string[],
  cwd: string,
  input: string | null = null,
  acceptedExitCodes: readonly number[] = [0],
): GhRequest => ({ acceptedExitCodes, arguments: arguments_, cwd, input });

export const restApiHeaders = (host: string): readonly string[] => [
  '-H',
  'Accept: application/vnd.github.raw+json',
  '-H',
  `X-GitHub-Api-Version: ${host === 'github.com' ? '2026-03-10' : '2022-11-28'}`,
];

export const decodeGhJson = <T, E, RD>(
  schema: Schema.ConstraintCodec<T, E, RD>,
  result: GhResult,
  arguments_: readonly string[],
): Effect.Effect<T, GhDecodeError, RD> =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(result.stdout).pipe(
    Effect.mapError((cause) =>
      GhDecodeError.make({
        arguments: Array.from(arguments_),
        causeMessage: cause instanceof Error ? cause.message : String(cause),
      }),
    ),
  );

export const encodeGhJson = <T, E, RE>(
  schema: Schema.ConstraintCodec<T, E, never, RE>,
  value: T,
  arguments_: readonly string[],
): Effect.Effect<string, GhEncodeError, RE> =>
  Schema.encodeEffect(Schema.fromJsonString(schema))(value).pipe(
    Effect.mapError((cause) =>
      GhEncodeError.make({
        arguments: Array.from(arguments_),
        causeMessage: cause instanceof Error ? cause.message : String(cause),
      }),
    ),
  );
