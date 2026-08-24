---
name: prdr
description: >-
  Inspect, triage, reply to, edit, and resolve GitHub pull request review conversations with
  prdr. Use for PR comments and review threads, exact Markdown-safe GitHub writes, Greptile
  review loops, or Aikido Security findings and checks.
---

# prdr

Use `prdr` as the typed review layer over `gh`. It keeps GitHub object kinds separate and reads
real GraphQL review thread state.

## Safety boundary

Reading a pull request does not permit a GitHub write. Get authority from the current user request
before you run any of these commands:

- `comment`, `reply`, `edit`, or `review`
- `resolve` or `unresolve`
- `greptile trigger` or `greptile ask`
- `aikido ignore`

An Aikido ignore changes security-gate state. Use it only for a confirmed false positive and only
when the user permits that exact action. Do not resolve a human or agent finding only because code
changed. First verify the fix against the current pull request head.

## Start with a consistent snapshot

Run this in the pull request worktree:

```nu
prdr inspect --agent
prdr list --state open --limit 50 --agent
```

Outside the worktree, identify the target explicitly:

```nu
prdr list --repo OWNER/REPOSITORY --pr 123 --state open --agent
```

For GitHub Enterprise, use `HOST/OWNER/REPOSITORY`. If `prdr` reports that the head changed while
it read the pull request, discard the result and run the command again.

Use qualified references from `prdr list`, such as `review-comment:123`, `issue-comment:456`, or
`thread:PRRT_...`. Do not use a bare numeric ID when a qualified reference is available.

## Read without losing Markdown

Every structured result has `protocolVersion`, `ok`, `command`, and either `data` or `error`.
`--agent` returns the envelope as one JSON line. `--json` returns the same envelope with indentation.
Reject an unknown protocol version before parsing `data`.

`inspect --agent` returns the complete snapshot under `data`. `show` returns one object and its
thread link under `data`. `data.comment.body` is the raw GitHub Markdown body.

`list` returns its target and `headRefOid` with `data.items`, `data.total`, `data.hasMore`, and
`data.nextCursor`. It returns 50 records by default and accepts `--limit` values from 1 to 100.
Continue until `hasMore` is false:

```nu
let first = (prdr list --state open --limit 50 --agent | from json)
prdr list --state open --limit 50 --cursor $first.data.nextCursor --agent
```

Keep the same PR and filters for every page. The page size can change. A cursor binds to the PR,
head commit, filters, and result set. If `ListPaginationError` says that the result changed, discard
the partial traversal and start again without `--cursor`.

Each list record has a first-line `preview` of up to 160 grapheme clusters. A trailing `...` means
that more content exists. Use its qualified `ref` with `show` to read the exact Markdown. Do not
treat a preview as the full finding.

```nu
prdr show review-comment:123 --agent
```

Do not remove HTML comments, `<details>` sections, code fences, indentation, or repeated blank
lines before analysis.

Useful filters:

```nu
prdr list --state open --provider human --agent
prdr list --state open --provider greptile --agent
prdr list --state open --provider aikido --agent
prdr list --author reviewer-login --agent
```

## Write exact Markdown

Write the proposed body to a file, inspect that file, then give it to `prdr`. Do not pass a
multi-line body as a shell argument. `prdr` JSON-encodes the body and sends it to `gh api` through
standard input.

```nu
prdr reply review-comment:123 --body-file /tmp/prdr-reply.md --agent
prdr comment --body-file /tmp/prdr-comment.md --agent
prdr edit issue-comment:456 --body-file /tmp/prdr-edit.md --agent
prdr review --event approve --body-file /tmp/prdr-review.md --agent
```

Use `--stdin` instead of `--body-file` only when the input source already preserves exact bytes.
Pass exactly one of these two options.

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
prdr reply review-comment:123 --body-file /tmp/prdr-reply.md --agent
prdr resolve review-comment:123 --agent
prdr unresolve thread:PRRT_example --agent
```

`reply` always replies to the root of the selected inline thread. GitHub issue comments are not
threads. Use `comment` to add a new pull request conversation comment.

## Greptile

Read Greptile state before you act:

```nu
prdr greptile status --agent
```

The result includes `currentHead` and separates lightweight summaries for the latest activity and
latest completed review. It also includes the confidence score when present, last reviewed commit
when present, and summaries for all open Greptile threads. Use each qualified activity `ref` or
thread `rootRef` with `show` to read exact Markdown. A later failure or progress comment does not
erase the last completed review data. Compare `lastReviewedCommit` with `currentHead` before you
trust a clean result.

With user authority, request a new review or ask a question:

```nu
prdr greptile trigger --agent
prdr greptile ask --body-file /tmp/prdr-greptile-question.md --agent
```

`greptile ask` adds `@greptileai` only when the body does not already contain that mention. After a
trigger, use the bounded wait command:

```nu
prdr greptile wait --interval-seconds 15 --timeout-seconds 600 --agent
```

The command stops when the reviewed commit matches the captured head. It fails on timeout or when
the head changes. After it succeeds, read open Greptile threads and address each actionable finding.

## Aikido Security

Read both Aikido checks and open inline findings:

```nu
prdr aikido status --agent
```

The command returns `currentHead` and all open Aikido thread summaries. Use a summary's `rootRef`
with `show` to read the exact finding.

For a valid finding, fix and verify the code, then use the normal `reply` command if a response is
needed. For a confirmed false positive, put a short, one-line reason in a file. With explicit user
authority, run:

```nu
prdr aikido ignore review-comment:123 --body-file /tmp/prdr-aikido-reason.txt --agent
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
- A `ProviderWaitTimeoutError` or `ProviderWaitHeadChangedError` stops a Greptile wait. Read the
  current head and provider status before the next action.
- A `ThreadPermissionError` means the current GitHub account cannot do the requested thread action.
- Keep `--agent` or `--json` on commands when another agent must parse the result.
