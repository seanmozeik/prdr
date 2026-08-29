---
name: prdr
description: >-
  Find, author, review, and deliver GitHub pull requests through typed prdr operations. Use for
  target discovery, exact PR context, pinned creation, lifecycle changes, reviews, reviewers,
  merge delivery, exact Markdown writes, Greptile, or Aikido Security.
---

# prdr

Use `prdr` as the typed review layer over `gh`. It keeps GitHub object kinds separate and reads
real GraphQL review thread state.

## Safety boundary

Reading a pull request does not permit a GitHub write. Get authority from the current user request
before you run any of these commands:

- `comment`, `reply`, `edit`, or `review`
- `resolve` or `unresolve`
- `create`, `transition`, `update`, `update-branch`, or `reviewers`
- `auto-merge`, `queue`, `merge`, `revert`, `archive`, or `unarchive`
- `greptile trigger` or `greptile ask`
- `aikido ignore`

An Aikido ignore changes security-gate state. Use it only for a confirmed false positive and only
when the user permits that exact action. Do not resolve a human or agent finding only because code
changed. First verify the fix against the selected pull request head.

Greptile and Aikido normally start through repository automation. A missing result does not permit
a manual trigger. Keep `greptile trigger` as a recovery command for an explicit user request or a
verified integration failure with authority to post the trigger.

## Select the pull request

Prefer an explicit target when the request, issue, or prior tool result identifies one. If the pull
request number is unknown, list a bounded page for the repository:

```nu
prdr prs --repo OWNER/REPOSITORY --state open --limit 30 --agent
```

Do not guess a repository owner. Use the account that is logged in through `gh` to resolve it.

From the repository worktree, resolve its exact remote:

```nu
prdr target --mode worktree --agent
prdr target --mode worktree --directory /absolute/path/to/project --agent
```

If only a repository name or a failed owner/repository guess is known, search all repositories that
the logged-in account can see:

```nu
prdr target --mode repository --query repository-name --limit 10 --agent
prdr target --mode repository --query WRONG_OWNER/repository-name --limit 10 --agent
```

This search includes private repositories where the account is an organization member or a
collaborator. Each item states its exact `repo`, visibility, permission, archive state, and default
branch.

If only a head branch is known, search bounded pull request candidates:

```nu
prdr target --mode branch --branch feature/name --state open --limit 10 --agent
```

For Shim, use one of these strict inputs before another `prdr` tool:

```ts
tools.prdr.target({ mode: 'worktree', directory: '/absolute/path/to/project' });
tools.prdr.target({ mode: 'repository', query: 'repository-name' });
tools.prdr.target({ mode: 'branch', branch: 'feature/name' });
```

Every other Shim `prdr` tool requires `repo`. Copy it from the target result. Each PR-scoped read
also requires exactly one `pr` or `branch`; each mutation requires `pr`. Shim does not infer the
agent's worktree, branch, or pull request. Continue with `nextCursor` while `hasMore` is true. A
branch result gives exact `base.repo` and `head.repo` values. If there are several candidates,
continue the search or ask the user to select one. Do not stop after one failed owner.

Each item includes its number, title, compact body summary, age, author, branches, draft and
lifecycle state, review decision, merge state, check state, and comment and thread counts. Filter
with `--state`, `--base`, or `--branch`. Continue with `nextCursor` while `hasMore` is true, using
the same repository and filters.

Select one pull request by number or exact head branch:

```nu
prdr inspect --repo OWNER/REPOSITORY --pr 123 --agent
prdr list --repo OWNER/REPOSITORY --pr 123 --state open --agent
prdr inspect --repo OWNER/REPOSITORY --branch feature/name --agent
```

`--pr` and `--branch` are mutually exclusive. `--repo` accepts `OWNER/REPOSITORY` or
`HOST/OWNER/REPOSITORY`. In the CLI, omit the target flags only when the current worktree is the
intended pull request. Shim always requires `repo`. If `prdr` reports that the head changed while it
read, discard the result and run the
command again. Keep the same explicit selector on later reads and writes.

Use qualified references from `prdr list`, such as `review-comment:123`, `issue-comment:456`, or
`thread:PRRT_...`. Do not use a bare numeric ID when a qualified reference is available.

## Read without losing Markdown

Every structured result has `protocolVersion`, `ok`, `command`, and either `data` or `error`.
Protocol version 2 uses a task-focused `--agent` form and a complete formatted `--json` form. Reject
an unknown protocol version before parsing `data`.

`inspect --agent` returns PR state, review counts, every open finding summary, and checks that need
attention. It omits Markdown bodies and passing check names. `openItems` is complete and is not
truncated. Use `inspect --json` only when raw snapshot fields are required.

Use `context` when the task needs the exact authoring or review state:

```nu
prdr context --repo OWNER/REPOSITORY --pr 123 --purpose review --limit 25 --agent
```

The result has the exact title and Markdown body, repository and PR identity, author, lifecycle
state, base and head refs with full SHAs, commit summaries, changed files, diff totals, checks that
need attention, reviews, and unresolved threads. Each section has `total` and `truncated`. Continue
with `nextCursor` while `hasMore` is true. Use `purpose=authoring` for short thread summaries. Use
`purpose=review` for exact unresolved thread bodies. GitHub does not expose the pull request archive
flag on public reads. `lifecycle.archiveState=not-exposed` states this limit and does not infer the
flag from closed or locked state.

Before creation, pass `--repo`, `--base`, `--base-sha`, `--head-repo`, `--head`, and `--head-sha`
to `context`. This gives a pinned base and head comparison with bounded commit pages and explicit
changed-file limits. GitHub returns changed files and diff totals only on the first comparison
page. Retain page one while you continue commit pages. Later pages explicitly mark the file map and
totals as omitted.

`list` defaults to open review threads. Use `--state all` when you need issue comments, submitted
review history, unthreaded comments, or resolved threads. Empty review events are omitted. It
returns `data.items`, `data.total`, `data.hasMore`, and `data.nextCursor`. It returns 50 records by
default and accepts `--limit` values from 1 to 100. Continue until `hasMore` is false:

```nu
let first = (prdr list --repo OWNER/REPOSITORY --pr 123 --state open --limit 50 --agent | from json)
prdr list --repo OWNER/REPOSITORY --pr 123 --state open --limit 50 --cursor $first.data.nextCursor --agent
```

Keep the same PR and filters for every page. The page size can change. A cursor binds to the PR,
head commit, filters, and result set. If `ListPaginationError` says that the result changed, discard
the partial traversal and start again without `--cursor`.

Each list record omits null and derivable fields. It includes a clean `title` and first prose
`summary` when available. Badge markup and Markdown decoration are removed. Use its qualified `ref`
with `show`; never treat a summary as the full finding.

```nu
prdr show review-comment:123 --repo OWNER/REPOSITORY --pr 123 --agent
```

`data.body` is the selected exact raw Markdown body. It occurs once. For an inline thread,
`data.thread.otherComments` contains each other exact body once. Do not remove HTML comments,
`<details>` sections, code fences, indentation, or repeated blank lines before analysis. Use
`show --json` only when raw transport fields such as `diff_hunk` are required.

Useful filters:

```nu
prdr list --state open --provider human --agent
prdr list --state open --provider codex --agent
prdr list --state open --provider cursor --agent
prdr list --state open --provider greptile --agent
prdr list --state open --provider aikido --agent
prdr list --author reviewer-login --agent
```

## Write exact Markdown

Do not pass a multi-line body as a shell argument. Pipe exact Markdown through standard input.
`prdr` JSON-encodes the body and sends it to `gh api` through standard input.

```nu
$body | prdr reply review-comment:123 --repo OWNER/REPOSITORY --pr 123 --stdin --agent
$body | prdr comment --repo OWNER/REPOSITORY --pr 123 --stdin --agent
$body | prdr edit issue-comment:456 --repo OWNER/REPOSITORY --pr 123 --stdin --agent
$body | prdr review --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --event approve --stdin --agent
```

The CLI also accepts `--body-file`. Pass exactly one of `--stdin` or `--body-file`. The Shim tools
accept a direct `body` string and always use standard input. They do not create a temporary file.

## Author and manage a pull request

Create requires exact remote base and head SHAs, readiness, title, and body. Resolve uncertain
repositories with `target` first. `create` checks both remote refs again just before the write. It
stops on a missing branch, stale SHA, or matching open pull request.

Use these typed operations after creation:

- `transition --action close|reopen|mark-ready|convert-draft`
- `update` for title, exact body, or base
- `update-branch --method merge|rebase`
- `reviewers --action request|remove --user LOGIN --team SLUG`

Every write needs `--expected-head` where the command supports it. Copy the full SHA from a current
`context` result. Do not abbreviate it.

One `review` can include several inline findings. For each finding, give `path`, `line`, `side`, and
`body`. A range also needs `startLine` and `startSide`. `prdr` verifies the current diff coordinates
before it creates the atomic review.

## Deliver a pull request

Use the separate delivery operations because their effects and permissions differ:

- `auto-merge --action enable|disable`; enable also needs `--strategy`
- `queue --action enqueue|dequeue`
- `merge --strategy merge|rebase|squash`
- `revert` with exact title, body, and readiness for the new pull request
- `archive` or `unarchive`

Merge requires a pinned head and stops when checks need attention, review changes are requested, a
thread is unresolved, or repository policy blocks delivery. Revert operates only on a merged pull
request and returns the new revert pull request. Archive and unarchive require administration
permission. They verify the named mutation payload, repository and PR identity, head, and a second
read. Archive also verifies the visible closed and locked consequences. Get authority for the exact
operation before you call it.

## Review-thread workflow

1. Read all open findings on one consistent head.
2. Classify each finding as valid, obsolete, duplicate, or false positive.
3. Inspect the code and tests before you propose a response.
4. Make code changes only when the user request permits them.
5. Run the repository checks.
6. Reply with evidence when a reply is useful.
7. Resolve the thread only when the user permits it and the finding is settled.
8. Read the pull request again after each GitHub write.

```nu
prdr reply review-comment:123 --repo OWNER/REPOSITORY --pr 123 --body-file /tmp/prdr-reply.md --agent
prdr resolve review-comment:123 --repo OWNER/REPOSITORY --pr 123 --agent
prdr unresolve thread:PRRT_example --repo OWNER/REPOSITORY --pr 123 --agent
```

`reply` always replies to the root of the selected inline thread. GitHub issue comments are not
threads. Use `comment` to add a new pull request conversation comment.

## Greptile

Assume repository automation starts Greptile. Read its state for the selected pull request:

```nu
prdr greptile status --repo OWNER/REPOSITORY --pr 123 --agent
```

The result includes `currentHead` and separates lightweight summaries for the latest activity and
latest completed review. It also includes the confidence score when present, last reviewed commit
when present, and summaries for all open Greptile threads. Use each qualified activity `ref` or
thread `rootRef` with `show` to read exact Markdown. A later failure or progress comment does not
erase the last completed review data. Compare `lastReviewedCommit` with `currentHead` before you
trust a clean result.

When the automatic review is running, use the bounded wait command:

```nu
prdr greptile wait --repo OWNER/REPOSITORY --pr 123 --interval-seconds 15 --timeout-seconds 600 --agent
```

The command stops when the reviewed commit matches the captured head. It fails on timeout or when
the head changes. After it succeeds, read open Greptile threads and address each actionable finding.

The CLI also supports these manual Greptile actions:

```nu
prdr greptile trigger --repo OWNER/REPOSITORY --pr 123 --agent
prdr greptile ask --repo OWNER/REPOSITORY --pr 123 --body-file /tmp/prdr-greptile-question.md --agent
```

`trigger` posts a Greptile review request for the selected head. It is supported for an explicit
user request or recovery from a verified automatic-integration failure, but it is not the normal
workflow. Check `status` first and use `wait` when an automatic review is already running. `ask` is
a separate GitHub write for a user-requested question. It preserves the supplied Markdown and adds
`@greptileai` only when the body does not already contain that mention. Both commands require
authority for that exact GitHub write.

## Aikido Security

Assume repository automation starts Aikido Security. Read both its checks and open inline findings:

```nu
prdr aikido status --repo OWNER/REPOSITORY --pr 123 --agent
```

The command returns `currentHead` and all open Aikido thread summaries. Use a summary's `rootRef`
with `show` to read the exact finding.

For a valid finding, fix and verify the code, then use the normal `reply` command if a response is
needed. For a confirmed false positive, put a short, one-line reason in a file. With explicit user
authority, run:

```nu
prdr aikido ignore review-comment:123 --repo OWNER/REPOSITORY --pr 123 --body-file /tmp/prdr-aikido-reason.txt --agent
```

This command replies with the provider syntax `@AikidoSec ignore: REASON`. Read the thread and
check again. Do not claim success until Aikido confirms the ignore or the check state changes.

## Failure handling

- Read failures from `error.code`, `error.message`, and `error.details`.
- A `GhCommandError` detail contains the exact `gh` argument array, exit code, standard output, and
  standard error. Do not print credentials or add a token flag.
- A `SnapshotInvariantError` means GitHub returned a partial or unsafe graph. Do not mutate from
  that snapshot.
- A `PullRequestChangedError` means the head changed during the read. Run the read again.
- A `SnapshotChangedError` means review data changed across all three bounded complete reads. Run
  the read again after activity settles.
- A `ListPaginationError` means a page size or cursor is unsafe, or the result changed during page
  traversal. Restart without `--cursor` when the error asks for a fresh traversal.
- A `PullRequestPaginationError` means the PR index page size or cursor is invalid, or the cursor
  belongs to different repository filters. Restart `prs` without `--cursor`.
- A `StaleHeadError` means the full expected SHA is not current. Read `context` again. Do not retry
  the write with a different SHA until the intended change is still valid.
- An `ExistingPullRequestError` gives the matching open pull request. Use that pull request instead
  of creating a duplicate.
- A `BranchUnavailableError` means the remote branch cannot be used. Call `target` to recover the
  correct repository and owner before you stop.
- A `PullRequestVerificationError` means GitHub accepted a write but the read-back state differs.
  Stop and inspect the current pull request. Do not report success.
- An `UnsupportedRepositoryPolicyError` means repository rules do not support or permit the action.
- A `ProviderWaitTimeoutError` or `ProviderWaitHeadChangedError` stops a Greptile wait. Read the
  selected head and provider status before the next action.
- A `ThreadPermissionError` means the current GitHub account cannot do the requested thread action.
- Keep `--agent` or `--json` on commands when another agent must parse the result.
