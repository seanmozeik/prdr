import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Effect } from 'effect';

import { readMarkdown } from '../src/domain/markdown';

const withTemporaryFile = async <T>(bytes: Uint8Array, use: (file: string) => Promise<T>) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'prdr-markdown-'));
  const file = path.join(directory, 'body.md');
  try {
    writeFileSync(file, bytes);
    return await use(file);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

const readFile = (file: string) => readMarkdown({ bodyFile: file, stdin: false });

describe('Markdown byte input', () => {
  it('preserves valid UTF-8 and newlines exactly', async () => {
    const body = 'First line\n\nEmoji: 🩺\n';

    const actual = await withTemporaryFile(new TextEncoder().encode(body), (file) =>
      Effect.runPromise(readFile(file)),
    );

    expect(actual).toBe(body);
  });

  it('rejects invalid UTF-8', async () => {
    const error = await withTemporaryFile(new Uint8Array([0x66, 0x6f, 0x80]), (file) =>
      Effect.runPromise(Effect.flip(readFile(file))),
    );

    expect(error.message).toBe('The Markdown input is not valid UTF-8.');
  });

  it('rejects a UTF-8 byte-order mark', async () => {
    const error = await withTemporaryFile(
      new Uint8Array([0xef, 0xbb, 0xbf, 0x62, 0x6f, 0x64, 0x79]),
      (file) => Effect.runPromise(Effect.flip(readFile(file))),
    );

    expect(error.message).toBe('The Markdown input must be UTF-8 without a byte-order mark.');
  });

  it('rejects empty input and an absent input source', async () => {
    const empty = await withTemporaryFile(new Uint8Array(), (file) =>
      Effect.runPromise(Effect.flip(readFile(file))),
    );
    const absent = await Effect.runPromise(
      Effect.flip(readMarkdown({ bodyFile: '', stdin: false })),
    );

    expect(empty.message).toBe('The Markdown body must not be empty.');
    expect(absent.message).toBe('Pass exactly one of --body-file PATH or --stdin.');
  });
});
