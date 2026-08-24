import { Effect } from 'effect';

import { MarkdownInputError } from './errors';

export interface MarkdownSource {
  readonly bodyFile: string;
  readonly stdin: boolean;
}

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

const hasUtf8Bom = (bytes: Uint8Array): boolean =>
  bytes.length >= UTF8_BOM.length && UTF8_BOM.every((byte, index) => bytes[index] === byte);

const decodeMarkdown = Effect.fn('Markdown.decode')(function* decodeMarkdown(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (hasUtf8Bom(bytes)) {
    return yield* MarkdownInputError.make({
      detail: 'The Markdown input must be UTF-8 without a byte-order mark.',
    });
  }
  return yield* Effect.try({
    catch: (cause) =>
      MarkdownInputError.make({
        causeMessage: cause instanceof Error ? cause.message : String(cause),
        detail: 'The Markdown input is not valid UTF-8.',
      }),
    try: () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
  });
});

export const readMarkdown = Effect.fn('Markdown.read')(function* readMarkdown(
  source: MarkdownSource,
) {
  if (source.bodyFile.length > 0 === source.stdin) {
    return yield* MarkdownInputError.make({
      detail: 'Pass exactly one of --body-file PATH or --stdin.',
    });
  }
  const buffer = yield* Effect.tryPromise({
    catch: (cause) =>
      MarkdownInputError.make({
        causeMessage: cause instanceof Error ? cause.message : String(cause),
        detail: source.stdin
          ? 'Could not read Markdown from standard input.'
          : `Could not read Markdown from ${source.bodyFile}.`,
      }),
    try: () => (source.stdin ? Bun.stdin.arrayBuffer() : Bun.file(source.bodyFile).arrayBuffer()),
  });
  const body = yield* decodeMarkdown(buffer);
  if (body.length === 0) {
    return yield* MarkdownInputError.make({ detail: 'The Markdown body must not be empty.' });
  }
  return body;
});

export const withGreptileMention = (body: string): string =>
  /@greptileai\b/iu.test(body) ? body : `@greptileai\n\n${body}`;

export const aikidoIgnoreBody = Effect.fn('Markdown.aikidoIgnore')(function* aikidoIgnoreBody(
  reason: string,
) {
  const compact = reason.trim();
  if (compact.length === 0) {
    return yield* MarkdownInputError.make({
      detail: 'The Aikido ignore reason must not be empty.',
    });
  }
  if (/[\r\n\u0085\u2028\u2029]/u.test(compact)) {
    return yield* MarkdownInputError.make({ detail: 'The Aikido ignore reason must be one line.' });
  }
  return `@AikidoSec ignore: ${compact}`;
});
