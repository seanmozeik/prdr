import { createHash } from 'node:crypto';

import { Effect, Schema } from 'effect';

import type { RepositoryTarget } from '../domain/model';
import {
  type CreatedPullRequest,
  PullRequestCreationVerificationError,
} from '../domain/pull-request-creation';
import {
  ExistingPullRequestError,
  PullRequestIdentityError,
  PullRequestInputError,
  PullRequestPermissionError,
  PullRequestValidationError,
  StaleHeadError,
} from '../domain/pull-request-errors';
import { RawPullRequestDetail } from '../domain/pull-request-raw';
import { BranchUnavailableError } from '../domain/pull-request-read-errors';
import { decodeGhJson, encodeGhJson, GhClient, ghRequest, restApiHeaders } from './client';
import type { GhCommandError } from './errors';
import { loadRestPages, loadRestResource } from './rest';
import { resolveRepository } from './target';

export interface CreatePullRequestInput {
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly body: string;
  readonly headBranch: string;
  readonly headRepo: string;
  readonly headSha: string;
  readonly readiness: 'draft' | 'ready';
  readonly title: string;
}

const GitReference = Schema.Struct({
  object: Schema.Struct({ sha: Schema.String }),
  ref: Schema.String,
});
const CreateRequest = Schema.Struct({
  base: Schema.String,
  body: Schema.String,
  draft: Schema.Boolean,
  head: Schema.String,
  title: Schema.String,
});
const ExistingPullRequest = Schema.Struct({ html_url: Schema.String, number: Schema.Int });
const RepositoryAccess = Schema.Struct({
  nameWithOwner: Schema.String,
  viewerPermission: Schema.NullOr(Schema.String),
});

const inputError = (detail: string): PullRequestInputError =>
  PullRequestInputError.make({ detail, operation: 'create' });

const validateSingleLine = Effect.fn('PullRequestCreation.validateSingleLine')(
  function* validateSingleLine(name: string, value: string) {
    if (value.length === 0 || value.trim() !== value) {
      return yield* inputError(`${name} must be non-empty and must not have outer whitespace.`);
    }
    if (/\p{Cc}|\p{Zl}|\p{Zp}/u.test(value)) {
      return yield* inputError(`${name} must be one line and must not contain control characters.`);
    }
    return value;
  },
);

const validateSha = Effect.fn('PullRequestCreation.validateSha')(function* validateSha(
  name: string,
  value: string,
) {
  if (!/^[0-9a-f]{40}$/iu.test(value)) {
    return yield* inputError(`${name} must be one complete 40-character commit SHA.`);
  }
  return value.toLowerCase();
});

const verifyRepositoryAccess = Effect.fn('PullRequestCreation.verifyRepositoryAccess')(
  function* verifyRepositoryAccess(repository: RepositoryTarget) {
    const gh = yield* GhClient;
    const arguments_ = [
      'repo',
      'view',
      repository.nameWithOwner,
      '--json',
      'nameWithOwner,viewerPermission',
    ];
    const result = yield* gh.run(ghRequest(arguments_));
    const access = yield* decodeGhJson(RepositoryAccess, result, arguments_);
    if (access.nameWithOwner.toLowerCase() !== repository.nameWithOwner.toLowerCase()) {
      return yield* PullRequestIdentityError.make({
        detail: 'GitHub returned access data for a different repository.',
      });
    }
    if (access.viewerPermission === null) {
      return yield* PullRequestPermissionError.make({
        operation: 'create',
        required: 'authenticated access to the base repository',
      });
    }
    return access.viewerPermission.toLowerCase();
  },
);

export const loadRemoteBranch = Effect.fn('PullRequestCreation.loadRemoteBranch')(
  function* loadRemoteBranch(repository: RepositoryTarget, branch: string) {
    const gh = yield* GhClient;
    const expectedRef = `refs/heads/${branch}`;
    const endpoint = `repos/${repository.nameWithOwner}/git/ref/heads/${encodeURIComponent(branch)}`;
    const arguments_ = [
      'api',
      '--hostname',
      repository.host,
      ...restApiHeaders(repository.host),
      endpoint,
    ];
    const result = yield* gh
      .run(ghRequest(arguments_))
      .pipe(
        Effect.catchTag('GhCommandError', () =>
          BranchUnavailableError.make({ branch, repo: repository.nameWithOwner }),
        ),
      );
    const reference = yield* decodeGhJson(GitReference, result, arguments_);
    if (reference.ref !== expectedRef) {
      return yield* BranchUnavailableError.make({ branch, repo: repository.nameWithOwner });
    }
    return { branch, repo: repository.nameWithOwner, sha: reference.object.sha.toLowerCase() };
  },
);

const ensureNoOpenPullRequest = Effect.fn('PullRequestCreation.ensureNoOpen')(
  function* ensureNoOpenPullRequest(
    target: RepositoryTarget,
    baseBranch: string,
    head: RepositoryTarget,
    headBranch: string,
  ) {
    const query = new URLSearchParams({
      base: baseBranch,
      head: `${head.owner}:${headBranch}`,
      per_page: '100',
      state: 'open',
    });
    const existing = yield* loadRestPages(
      { ...target, number: 1 },
      `repos/${target.nameWithOwner}/pulls?${query.toString()}`,
      ExistingPullRequest,
    );
    const [match] = existing;
    if (match !== undefined) {
      return yield* ExistingPullRequestError.make({ number: match.number, url: match.html_url });
    }
    return yield* Effect.void;
  },
);

const mutationError = (
  error: GhCommandError,
): PullRequestPermissionError | PullRequestValidationError =>
  /403|forbidden|permission|resource not accessible/iu.test(error.message)
    ? PullRequestPermissionError.make({
        operation: 'create',
        required: 'pull request write access',
      })
    : PullRequestValidationError.make({ detail: error.message, operation: 'create' });

const createThroughApi = Effect.fn('PullRequestCreation.createThroughApi')(
  function* createThroughApi(target: RepositoryTarget, request: typeof CreateRequest.Type) {
    const gh = yield* GhClient;
    const endpoint = `repos/${target.nameWithOwner}/pulls`;
    const arguments_ = [
      'api',
      '--hostname',
      target.host,
      '-X',
      'POST',
      ...restApiHeaders(target.host),
      endpoint,
      '--input',
      '-',
    ];
    const input = yield* encodeGhJson(CreateRequest, request, arguments_);
    const result = yield* gh
      .run(ghRequest(arguments_, input))
      .pipe(Effect.catchTag('GhCommandError', (error) => Effect.fail(mutationError(error))));
    return yield* decodeGhJson(RawPullRequestDetail, result, arguments_);
  },
);

const verifyCreated = Effect.fn('PullRequestCreation.verifyCreated')(function* verifyCreated(
  created: RawPullRequestDetail,
  target: RepositoryTarget,
  head: RepositoryTarget,
  input: CreatePullRequestInput,
) {
  const matches =
    created.base.ref === input.baseBranch &&
    created.base.repo?.full_name.toLowerCase() === target.nameWithOwner.toLowerCase() &&
    created.base.sha.toLowerCase() === input.baseSha.toLowerCase() &&
    (created.body ?? '') === input.body &&
    created.draft === (input.readiness === 'draft') &&
    created.head.ref === input.headBranch &&
    created.head.repo?.full_name.toLowerCase() === head.nameWithOwner.toLowerCase() &&
    created.head.sha.toLowerCase() === input.headSha.toLowerCase() &&
    created.title === input.title;
  if (!matches) {
    return yield* PullRequestCreationVerificationError.make({
      actualHead: created.head.sha,
      detail: 'GitHub created the pull request with values that differ from the pinned request.',
      expectedHead: input.headSha,
      number: created.number,
      url: created.html_url,
    });
  }
  return yield* Effect.void;
});

export const createPullRequest = Effect.fn('PullRequestCreation.create')(
  function* createPullRequest(repository: string, input: CreatePullRequestInput) {
    const baseBranch = yield* validateSingleLine('--base', input.baseBranch);
    const headBranch = yield* validateSingleLine('--head-branch', input.headBranch);
    const title = yield* validateSingleLine('--title', input.title);
    const baseSha = yield* validateSha('--base-sha', input.baseSha);
    const headSha = yield* validateSha('--head-sha', input.headSha);
    if (input.body.length === 0) {
      return yield* inputError('The pull request body must not be empty.');
    }
    const [target, head] = yield* Effect.all(
      [resolveRepository(repository), resolveRepository(input.headRepo)],
      { concurrency: 'unbounded' },
    );
    yield* verifyRepositoryAccess(target);
    yield* ensureNoOpenPullRequest(target, baseBranch, head, headBranch);
    const revisions = yield* Effect.all(
      { base: loadRemoteBranch(target, baseBranch), head: loadRemoteBranch(head, headBranch) },
      { concurrency: 'unbounded' },
    );
    if (revisions.base.sha !== baseSha) {
      return yield* StaleHeadError.make({
        actual: revisions.base.sha,
        expected: baseSha,
        operation: 'create base',
      });
    }
    if (revisions.head.sha !== headSha) {
      return yield* StaleHeadError.make({
        actual: revisions.head.sha,
        expected: headSha,
        operation: 'create head',
      });
    }
    const headValue =
      head.nameWithOwner.toLowerCase() === target.nameWithOwner.toLowerCase()
        ? headBranch
        : `${head.owner}:${headBranch}`;
    const request = {
      base: baseBranch,
      body: input.body,
      draft: input.readiness === 'draft',
      head: headValue,
      title,
    } satisfies typeof CreateRequest.Type;
    const response = yield* createThroughApi(target, request);
    const created = yield* loadRestResource(
      { ...target, number: response.number },
      `repos/${target.nameWithOwner}/pulls/${response.number}`,
      RawPullRequestDetail,
    );
    yield* verifyCreated(created, target, head, {
      ...input,
      baseBranch,
      baseSha,
      headBranch,
      headSha,
      title,
    });
    return {
      base: revisions.base,
      bodyBytes: Buffer.byteLength(input.body, 'utf8'),
      bodySha256: createHash('sha256').update(input.body, 'utf8').digest('hex'),
      head: revisions.head,
      number: created.number,
      readiness: created.draft ? 'draft' : 'ready',
      repo: target.nameWithOwner,
      state: created.state,
      title: created.title,
      url: created.html_url,
    } satisfies CreatedPullRequest;
  },
);
