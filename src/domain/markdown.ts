import { Effect } from 'effect';

import { MarkdownInputError } from './errors';

export interface MarkdownSource {
  readonly bodyFile: string;
  readonly stdin: boolean;
}

export const readMarkdown = Effect.fn('Markdown.read')(function* readMarkdown(
  source: MarkdownSource,
) {
  if (source.bodyFile.length > 0 === source.stdin) {
    return yield* new MarkdownInputError({
      detail: 'Pass exactly one of --body-file PATH or --stdin.',
    });
  }
  const body = yield* Effect.tryPromise({
    catch: (cause) =>
      new MarkdownInputError({
        cause,
        detail: source.stdin
          ? 'Could not read Markdown from standard input.'
          : `Could not read Markdown from ${source.bodyFile}.`,
      }),
    try: () => (source.stdin ? Bun.stdin.text() : Bun.file(source.bodyFile).text()),
  });
  if (body.length === 0) {
    return yield* new MarkdownInputError({ detail: 'The Markdown body must not be empty.' });
  }
  return body;
});

export const withGreptileMention = (body: string): string =>
  /@greptileai\b/iu.test(body) ? body : `@greptileai ${body}`;

export const aikidoIgnoreBody = Effect.fn('Markdown.aikidoIgnore')(function* aikidoIgnoreBody(
  reason: string,
) {
  const compact = reason.trim();
  if (compact.length === 0) {
    return yield* new MarkdownInputError({ detail: 'The Aikido ignore reason must not be empty.' });
  }
  if (/\r|\n/u.test(compact)) {
    return yield* new MarkdownInputError({ detail: 'The Aikido ignore reason must be one line.' });
  }
  return `@AikidoSec ignore: ${compact}`;
});
