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
  ExistingPullRequestError,
  PullRequestIdentityError,
  PullRequestInputError,
  PullRequestPermissionError,
  PullRequestValidationError,
  PullRequestVerificationError,
  StaleHeadError,
  StateConflictError,
  UnsupportedRepositoryPolicyError,
} from '../src/domain/pull-request-errors';
import {
  BoundedPaginationError,
  BranchUnavailableError,
  ContextPaginationError,
  DiffCoordinateError,
} from '../src/domain/pull-request-read-errors';
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
      PullRequestInputError.make({ detail: 'Bad input.', operation: 'update' }),
      PullRequestIdentityError.make({ detail: 'Wrong pull request.' }),
      StaleHeadError.make({ actual: 'def', expected: 'abc', operation: 'merge' }),
      StateConflictError.make({ actual: 'closed', expected: 'open', operation: 'review' }),
      ExistingPullRequestError.make({ number: 42, url: 'https://example.com/pull/42' }),
      PullRequestPermissionError.make({ operation: 'merge', required: 'write' }),
      UnsupportedRepositoryPolicyError.make({ detail: 'Queue is off.', operation: 'queue' }),
      PullRequestValidationError.make({ detail: 'Bad request.', operation: 'create' }),
      PullRequestVerificationError.make({ detail: 'State differs.', operation: 'update' }),
      BoundedPaginationError.make({ actual: 1, expected: 2, resource: 'files' }),
      ContextPaginationError.make({ detail: 'Bad context cursor.' }),
      BranchUnavailableError.make({ branch: 'feature', repo: 'example/prdr' }),
      DiffCoordinateError.make({ detail: 'Bad line.', path: 'src/example.ts' }),
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

  it('gives a missing branch an exact repository recovery path', () => {
    const error = BranchUnavailableError.make({ branch: 'feature/name', repo: 'wrong/repo' });

    expect(error.message).toContain('prdr target --mode branch --branch feature/name');
  });
});
