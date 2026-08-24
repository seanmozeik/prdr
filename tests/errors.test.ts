import { describe, expect, it } from 'bun:test';

import {
  CommentNotFoundError,
  CommentReferenceError,
  ListPaginationError,
  MarkdownInputError,
  ProviderWaitHeadChangedError,
  ProviderWaitInputError,
  ProviderWaitTimeoutError,
  PullRequestPaginationError,
  ThreadNotFoundError,
  UnsupportedMutationError,
} from '../src/domain/errors';
import {
  GhCommandError,
  GhDecodeError,
  GhEncodeError,
  GhGraphqlError,
  PullRequestChangedError,
  SnapshotChangedError,
  SnapshotInvariantError,
  TargetResolutionError,
  ThreadPermissionError,
} from '../src/github/errors';

describe('CLI error messages', () => {
  it('uses gh process output before the exit status', () => {
    const stderr = GhCommandError.make({
      arguments: ['api', 'repos/example/missing'],
      exitCode: 1,
      stderr: 'repository not found',
      stdout: '',
    });
    const stdout = GhCommandError.make({
      arguments: ['api'],
      exitCode: 1,
      stderr: '',
      stdout: 'request failed',
    });
    const status = GhCommandError.make({ arguments: ['api'], exitCode: 7, stderr: '', stdout: '' });

    expect(stderr.message).toBe('repository not found');
    expect(stdout.message).toBe('request failed');
    expect(status.message).toBe('gh api exited with status 7.');
  });

  it('gives every typed boundary error a non-empty message', () => {
    const errors = [
      CommentNotFoundError.make({ reference: 'issue-comment:1' }),
      CommentReferenceError.make({ detail: 'Bad reference.', reference: '1' }),
      ListPaginationError.make({ detail: 'Bad review cursor.' }),
      MarkdownInputError.make({ detail: 'No Markdown input was supplied.' }),
      ProviderWaitInputError.make({ detail: 'Bad wait input.' }),
      ProviderWaitHeadChangedError.make({ after: 'def', before: 'abc', provider: 'Greptile' }),
      ProviderWaitTimeoutError.make({ head: 'abc', provider: 'Greptile', timeoutSeconds: 10 }),
      PullRequestPaginationError.make({ detail: 'Bad pull request cursor.' }),
      ThreadNotFoundError.make({ reference: 'thread:missing' }),
      UnsupportedMutationError.make({ detail: 'Unsupported.', reference: 'review:1' }),
      GhDecodeError.make({ arguments: ['api'], causeMessage: 'bad JSON' }),
      GhEncodeError.make({ arguments: ['api'], causeMessage: 'bad input' }),
      GhGraphqlError.make({ messages: ['GraphQL failed.'] }),
      PullRequestChangedError.make({ after: 'def', before: 'abc' }),
      SnapshotChangedError.make({ attempts: 3 }),
      SnapshotInvariantError.make({ detail: 'Partial snapshot.' }),
      TargetResolutionError.make({ detail: 'No pull request target.' }),
      ThreadPermissionError.make({ action: 'resolve', threadId: 'PRRT_1' }),
    ];

    for (const error of errors) {
      expect(error.message.trim().length).toBeGreaterThan(0);
    }
  });
});
