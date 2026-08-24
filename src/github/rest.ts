import { Effect, Schema } from 'effect';

import type { PullRequestTarget } from '../domain/model';
import { decodeGhJson, GhClient, ghRequest, restApiHeaders } from './client';
import type { GhCommandError, GhDecodeError } from './errors';

const restArguments = (
  target: PullRequestTarget,
  endpoint: string,
  pagination: boolean,
): readonly string[] => [
  'api',
  '--hostname',
  target.host,
  ...(pagination ? ['--paginate', '--slurp'] : []),
  ...restApiHeaders(target.host),
  endpoint,
];

export const loadRestPages = <T, E>(
  target: PullRequestTarget,
  endpoint: string,
  schema: Schema.ConstraintCodec<T, E>,
): Effect.Effect<readonly T[], GhCommandError | GhDecodeError, GhClient> =>
  Effect.gen(function* loadRestPagesGen() {
    const gh = yield* GhClient;
    const arguments_ = restArguments(target, endpoint, true);
    const result = yield* gh.run(ghRequest(arguments_));
    const pages = yield* decodeGhJson(Schema.Array(Schema.Array(schema)), result, arguments_);
    return pages.flat();
  });

export const loadRestResource = <T, E>(
  target: PullRequestTarget,
  endpoint: string,
  schema: Schema.ConstraintCodec<T, E>,
): Effect.Effect<T, GhCommandError | GhDecodeError, GhClient> =>
  Effect.gen(function* loadRestResourceGen() {
    const gh = yield* GhClient;
    const arguments_ = restArguments(target, endpoint, false);
    const result = yield* gh.run(ghRequest(arguments_));
    return yield* decodeGhJson(schema, result, arguments_);
  });
