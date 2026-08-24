import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

import { ProtocolEnvelope } from '../src/domain/protocol';

interface CliResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = path.join(root, 'src', 'cli', 'index.ts');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const makeFakeGh = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'prdr-cli-'));
  temporaryDirectories.push(directory);
  const executable = path.join(directory, 'gh');
  const script = `#!${process.execPath}
const args = process.argv.slice(2);
if (process.env.PRDR_FAKE_GH_HANG === '1') {
  await Bun.sleep(10_000);
}
const input = await Bun.stdin.text();
const endpoint = args.find((argument) => argument.startsWith('repos/')) ?? '';
if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify(args.includes('statusCheckRollup')
    ? { statusCheckRollup: [] }
    : {
        author: { is_bot: false, login: 'reviewer' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: '0123456789abcdef0123456789abcdef01234567',
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        number: 42,
        reviewDecision: '',
        state: 'OPEN',
        title: 'Test pull request',
        updatedAt: '2026-08-24T10:00:00Z',
        url: 'https://github.com/example/prdr/pull/42'
      }));
} else if (args[0] === 'api' && args[1] === 'graphql' && args.some((argument) => argument.includes('query PrdrPullRequests'))) {
  process.stdout.write(JSON.stringify({
    data: {
      repository: {
        pullRequests: {
          nodes: [{
            author: { login: 'reviewer' },
            baseRefName: 'main',
            body: '## Summary\\n\\nCompact pull request description.',
            comments: { totalCount: 1 },
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
            createdAt: '2026-08-20T10:00:00Z',
            headRefName: 'feature',
            headRefOid: '0123456789abcdef0123456789abcdef01234567',
            headRepositoryOwner: { login: 'example' },
            isDraft: false,
            mergeStateStatus: 'CLEAN',
            number: 42,
            reviewDecision: 'APPROVED',
            reviewThreads: { totalCount: 2 },
            state: 'OPEN',
            title: 'Test pull request',
            updatedAt: '2026-08-24T10:00:00Z',
            url: 'https://github.com/example/prdr/pull/42'
          }],
          pageInfo: { endCursor: null, hasNextPage: false },
          totalCount: 1
        }
      }
    }
  }));
} else if (args[0] === 'api' && args[1] === 'graphql' && input === '') {
  process.stdout.write(JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      }
    }
  }));
} else if (args[0] === 'api' && input !== '') {
  const body = input === '' ? '' : JSON.parse(input).body;
  process.stdout.write(JSON.stringify({
    body,
    html_url: 'https://github.com/example/prdr/comment/1\\u001b]52;c;YWJj\\u0007\\nforged',
    id: 1,
    node_id: 'IC_1'
  }));
} else if (endpoint.includes('/pulls/42/comments?')) {
  process.stdout.write('[[]]');
} else if (endpoint.includes('/issues/42/comments?')) {
  process.stdout.write(JSON.stringify([[
    {
      body: '<!-- greptile-status -->\\nConfidence Score: 4/5\\nReviews (1): Last reviewed commit: [head](https://github.com/example/prdr/commit/0123456789abcdef0123456789abcdef01234567)',
      created_at: '2026-08-24T10:00:00Z',
      html_url: 'https://github.com/example/prdr/pull/42#issuecomment-2',
      id: 2,
      node_id: 'IC_2',
      updated_at: '2026-08-24T10:00:00Z',
      user: { login: 'greptile-apps[bot]', type: 'Bot' }
    }
  ]]));
} else if (endpoint.includes('/pulls/42/reviews?')) {
  process.stdout.write('[[]]');
} else {
  process.stderr.write('unexpected fake gh request: ' + args.join(' '));
  process.exitCode = 1;
}
`;
  writeFileSync(executable, script);
  chmodSync(executable, 0o755);
  return directory;
};

const runCli = async (
  arguments_: readonly string[],
  input = '',
  pathValue = process.env['PATH'] ?? '',
  hangGh = false,
): Promise<CliResult> => {
  const subprocess = Bun.spawn([process.execPath, entry, ...arguments_], {
    cwd: root,
    env: { ...process.env, PATH: pathValue, PRDR_FAKE_GH_HANG: hangGh ? '1' : '0' },
    stderr: 'pipe',
    stdin: 'pipe',
    stdout: 'pipe',
  });
  await subprocess.stdin.write(input);
  await subprocess.stdin.end();
  const [exitCode, stderr, stdout] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

const commentArguments = (mode: '--agent' | '--json'): readonly string[] => [
  'comment',
  '--repo',
  'example/prdr',
  '--pr',
  '42',
  '--stdin',
  mode,
];

const decodeEnvelope = (text: string) =>
  Schema.decodeUnknownSync(ProtocolEnvelope)(JSON.parse(text));

const ListPage = Schema.Struct({
  hasMore: Schema.Boolean,
  headRefOid: Schema.String,
  items: Schema.Array(Schema.Unknown),
  limit: Schema.Int,
  nextCursor: Schema.NullOr(Schema.String),
  target: Schema.Struct({ nameWithOwner: Schema.String, number: Schema.Int }),
  total: Schema.Int,
});

describe('CLI process contract', () => {
  it('answers fast help and version without gh on PATH', async () => {
    const help = await runCli(['--help'], '', '');
    const version = await runCli(['--version'], '', '');

    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('USAGE');
    expect(help.stderr).toBe('');
    expect(version.exitCode).toBe(0);
    expect(version.stdout).toMatch(/^prdr v\d+\.\d+\.\d+\n$/u);
  });

  it('emits one versioned agent line and keeps the exact Markdown body', async () => {
    const fakeDirectory = makeFakeGh();
    const body =
      '# Review\n\n```ts\nconst value = "$HOME";\n```\nUnicode separators: \u0085 \u2028\nBidi: \u202Ehidden\n';
    const result = await runCli(
      commentArguments('--agent'),
      body,
      `${fakeDirectory}${path.delimiter}${process.env['PATH'] ?? ''}`,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(result.stdout).not.toContain('\u0085');
    expect(result.stdout).not.toContain('\u2028');
    expect(result.stdout).not.toContain('\u202E');
    const envelope = decodeEnvelope(result.stdout);
    expect(envelope).toMatchObject({ command: 'comment', ok: true, protocolVersion: 1 });
    if (!envelope.ok) {
      throw new Error('The CLI returned a failure envelope.');
    }
    const data = Schema.decodeUnknownSync(Schema.Struct({ body: Schema.String }))(envelope.data);
    expect(data.body).toBe(body);
  });

  it('uses the same envelope with formatted JSON output', async () => {
    const fakeDirectory = makeFakeGh();
    const result = await runCli(
      commentArguments('--json'),
      'Body\n',
      `${fakeDirectory}${path.delimiter}${process.env['PATH'] ?? ''}`,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n').length).toBeGreaterThan(2);
    expect(decodeEnvelope(result.stdout)).toMatchObject({
      command: 'comment',
      ok: true,
      protocolVersion: 1,
    });
  });

  it('returns a versioned one-line failure with a nonzero status', async () => {
    const result = await runCli(
      ['comment', '--repo', 'example/prdr', '--pr', '42', '--agent'],
      '',
      '',
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(decodeEnvelope(result.stdout)).toMatchObject({
      command: 'comment',
      error: { code: 'MarkdownInputError' },
      ok: false,
      protocolVersion: 1,
    });
  });

  it('returns parser failures through the structured protocol', async () => {
    const result = await runCli(['list', '--provider', 'invalid', '--agent'], '', '');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(decodeEnvelope(result.stdout)).toMatchObject({
      command: 'list',
      error: { code: 'CliUsageError' },
      ok: false,
      protocolVersion: 1,
    });
  });

  it('runs representative read and provider commands through the same protocol', async () => {
    const fakeDirectory = makeFakeGh();
    const pathValue = `${fakeDirectory}${path.delimiter}${process.env['PATH'] ?? ''}`;
    const list = await runCli(
      ['list', '--repo', 'example/prdr', '--pr', '42', '--agent'],
      '',
      pathValue,
    );
    const wait = await runCli(
      [
        'greptile',
        'wait',
        '--repo',
        'example/prdr',
        '--pr',
        '42',
        '--interval-seconds',
        '1',
        '--timeout-seconds',
        '2',
        '--agent',
      ],
      '',
      pathValue,
    );
    const aikido = await runCli(
      ['aikido', 'status', '--repo', 'example/prdr', '--pr', '42', '--agent'],
      '',
      pathValue,
    );

    const listEnvelope = decodeEnvelope(list.stdout);
    expect(listEnvelope).toMatchObject({ command: 'list', ok: true });
    if (!listEnvelope.ok) {
      throw new Error('The list command returned a failure envelope.');
    }
    expect(Schema.decodeUnknownSync(ListPage)(listEnvelope.data)).toMatchObject({
      hasMore: false,
      headRefOid: '0123456789abcdef0123456789abcdef01234567',
      limit: 50,
      nextCursor: null,
      target: { nameWithOwner: 'example/prdr', number: 42 },
      total: 1,
    });
    expect(decodeEnvelope(wait.stdout)).toMatchObject({ command: 'greptile.wait', ok: true });
    expect(decodeEnvelope(aikido.stdout)).toMatchObject({ command: 'aikido.status', ok: true });
  });

  it('lists compact pull request summaries through the structured protocol', async () => {
    const fakeDirectory = makeFakeGh();
    const result = await runCli(
      ['prs', '--repo', 'example/prdr', '--limit', '1', '--agent'],
      '',
      `${fakeDirectory}${path.delimiter}${process.env['PATH'] ?? ''}`,
    );

    const envelope = decodeEnvelope(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(envelope).toMatchObject({ command: 'prs', ok: true });
    if (!envelope.ok) {
      throw new Error('The pull request list returned a failure envelope.');
    }
    expect(envelope.data).toMatchObject({
      hasMore: false,
      items: [
        {
          checkStatus: 'SUCCESS',
          number: 42,
          summary: 'Compact pull request description.',
          title: 'Test pull request',
        },
      ],
      nextCursor: null,
      total: 1,
    });
  });

  it('shows bounded Greptile wait flags without invoking gh', async () => {
    const result = await runCli(['greptile', 'wait', '--help'], '', '');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--interval-seconds');
    expect(result.stdout).toContain('--timeout-seconds');
  });

  it('shows list page flags and rejects an unsafe limit before it invokes gh', async () => {
    const help = await runCli(['list', '--help'], '', '');
    const failure = await runCli(['list', '--limit', '101', '--agent'], '', '');

    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('--cursor');
    expect(help.stdout).toContain('--limit');
    expect(failure.exitCode).toBe(1);
    expect(decodeEnvelope(failure.stdout)).toMatchObject({
      command: 'list',
      error: { code: 'ListPaginationError' },
      ok: false,
    });
  });

  it('shows explicit pull request target flags without invoking gh', async () => {
    const help = await runCli(['inspect', '--help'], '', '');

    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('--branch');
    expect(help.stdout).toContain('--pr');
    expect(help.stdout).toContain('--repo');
  });

  it('cancels a stalled gh process at the Greptile deadline', async () => {
    const fakeDirectory = makeFakeGh();
    const result = await runCli(
      [
        'greptile',
        'wait',
        '--repo',
        'example/prdr',
        '--pr',
        '42',
        '--interval-seconds',
        '1',
        '--timeout-seconds',
        '1',
        '--agent',
      ],
      '',
      `${fakeDirectory}${path.delimiter}${process.env['PATH'] ?? ''}`,
      true,
    );

    expect(result.exitCode).toBe(1);
    expect(decodeEnvelope(result.stdout)).toMatchObject({
      command: 'greptile.wait',
      error: { code: 'ProviderWaitTimeoutError', details: { head: null } },
      ok: false,
    });
  });

  it('keeps human mutation output on one safe line', async () => {
    const fakeDirectory = makeFakeGh();
    const result = await runCli(
      ['comment', '--repo', 'example/prdr', '--pr', '42', '--stdin'],
      'Body',
      `${fakeDirectory}${path.delimiter}${process.env['PATH'] ?? ''}`,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('\u001B');
    expect(result.stdout).not.toContain('\u0007');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(result.stdout).toContain(String.raw`\nforged`);
  });
});
