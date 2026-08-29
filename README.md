# PR Doctor

PR Doctor, `prdr`, is a typed command-line tool for GitHub pull requests and their review conversations. It
lists compact pull request summaries, then gives coding agents one structured, token-efficient view of issue
comments, submitted reviews, inline review comments, review threads, and checks. It also normalizes
Greptile and Aikido Security state. Compared to `gh` CLI, agents make fewer mistakes and act on PRs more reliably.

The project is a full Bun and Effect rewrite of
[`pbakaus/agent-reviews`](https://github.com/pbakaus/agent-reviews). The fork keeps the useful idea
and replaces the original JavaScript implementation, inferred thread state, and shell-sensitive
comment writes.

Install:

```bash
bun i -g --linker hoisted @seanmozeik/prdr
```

## What it fixes

- Review thread state comes from GitHub GraphQL. `prdr` reads `isResolved`, `isOutdated`, line data,
  and viewer permissions from `PullRequestReviewThread`.
- Each GitHub object has a qualified reference. Examples are `review-comment:123`,
  `issue-comment:456`, `review:789`, and `thread:PRRT_...`.
- `show --agent` returns the selected raw Markdown body once. It does not strip HTML comments,
  `<details>` blocks, code fences, indentation, or blank lines. `--json` keeps the full GitHub data.
- Every write takes a file or standard input, encodes a typed JSON request, and passes it to
  `gh api --input -`. A Markdown body is never placed in a shell command string.
- Summary commands read one GraphQL review graph and page each GitHub connection independently.
  Exact snapshots batch that graph with REST-only inline comment fields, reject any overlap or
  count mismatch, and verify the pull request head and update time. A third attempt is the bound
  when concurrent review activity prevents a stable result.
- Pull request and review-item lists have opaque cursors. Agents can keep each response bounded
  without losing the rest of the result set.
- Bot detection recognizes Aikido, Codex, Cursor, and Greptile identities, then uses the GitHub actor
  type for other bots. A human login that contains the text `bot` is still a human.
- `target` normalizes a repository URL or repository name. It can also search for bounded pull
  request candidates when only a head branch is known. Agents do not have to guess the owner.
- `context` returns the exact title and Markdown body with bounded commits, files, checks, reviews,
  and unresolved threads. Each section states its total and truncation state.
- Every lifecycle write uses one explicit action. It checks the repository, pull request, full head
  SHA, lifecycle state, and permission before the write. It reads the result again after the write.

GitHub documents the thread fields and resolve mutations in its
[`PullRequestReviewThread` GraphQL reference](https://docs.github.com/en/graphql/reference/objects#pullrequestreviewthread).
The write path follows the [`gh api` standard-input contract](https://cli.github.com/manual/gh_api)
and GitHub's [raw review comment API](https://docs.github.com/en/rest/pulls/comments).

## Toolchain

- Bun 1.4.0 or later
- Effect and `@effect/platform-bun` 4.0.0-rc.111
- TypeScript 7.0.2 with `@effect/tsgo`
- `@seanmozeik/de-clank` 0.1.8
- Oxlint 1.80 and Oxfmt 0.65

The small CLI launcher answers root `--help` and `--version` without loading Effect. The build
keeps the full Effect application in a deferred chunk that loads only for real commands. A release
test keeps the launcher below 16 KiB so that a new eager import cannot silently slow the fast path.

## Install for development

You need Bun and an authenticated GitHub CLI.

```nu
gh auth status
git clone git@github.com:seanmozeik/prdr.git
cd prdr
bun install
bun run verify
```

Run from source:

```nu
bun run dev -- --help
bun run dev -- prs --repo OWNER/REPOSITORY --state open
bun run dev -- list --repo OWNER/REPOSITORY --pr 123 --state open
```

Build `dist/prdr.js`:

```nu
bun run build -- --no-formula
```

## Read commands

Use an explicit repository and pull request when the agent already knows them. `--repo` accepts
`OWNER/REPOSITORY` or `HOST/OWNER/REPOSITORY`. Select one pull request with `--pr NUMBER` or
`--branch HEAD_BRANCH`; those selectors are mutually exclusive. Omit all three flags to infer the
pull request from the current worktree. The explicit `--repo` and `--pr` pair is the fastest path
because it does not need a separate target-resolution request.

Do not guess a repository owner. `target` uses the account that is logged in through `gh`. It can
resolve a local worktree, search repositories that this account can access, or search pull requests
by head branch.

```nu
prdr target --mode worktree --agent
prdr target --mode worktree --directory /absolute/path/to/project --agent
prdr target --mode repository --query repository-name --limit 10 --agent
prdr target --mode repository --query WRONG_OWNER/repository-name --limit 10 --agent
prdr target --mode branch --branch feature/name --state open --limit 10 --agent
```

Worktree mode asks `gh repo view` to resolve the remote in that directory. The owner can be an
organization or another user. Repository mode searches all repositories that the logged-in account
can see. This includes private repositories where the account is an organization member or a
collaborator. If an exact owner/repository value does not resolve, repository mode searches its
repository-name part instead of stopping.

The result states its `kind`. A `repository` result has one verified repository. A
`repository-candidates` result includes visibility, permission, archive state, default branch, and
the exact `repo` value. A `pull-request-candidates` result includes exact `base.repo` and
`head.repo` values, branch names, and the full head SHA. Use `nextCursor` while `hasMore` is true.
Copy a returned repository value. Do not replace its owner with the logged-in user.

The Shim `prdr.target` tool requires an explicit mode. Worktree mode also requires an absolute
`directory`. Every other Shim `prdr` tool requires the exact `repo` returned by `target`. Each
PR-scoped read also requires exactly one `pr` or `branch`; each mutation requires `pr`. This stops
the Shim daemon from using its own working directory or a guessed owner, branch, or pull request.

```nu
prdr prs --repo OWNER/REPOSITORY --state open --limit 30 --agent
prdr inspect --repo OWNER/REPOSITORY --pr 123 --agent
prdr inspect --repo OWNER/REPOSITORY --branch feature/name --agent
prdr context --repo OWNER/REPOSITORY --pr 123 --purpose review --limit 25 --agent
prdr list --repo OWNER/REPOSITORY --pr 123 --state open --limit 50 --agent
prdr show review-comment:123 --repo OWNER/REPOSITORY --pr 123 --agent
```

Use `--agent` for task-focused one-line JSON. It removes raw GitHub IDs, URLs, null fields, repeated
bodies, diff hunks, and fields that a qualified reference already identifies. Use `--json` for the
complete formatted diagnostic form. Both modes use protocol version 2 at the top level:

```json
{
  "protocolVersion": 2,
  "ok": true,
  "command": "list",
  "data": {
    "hasMore": true,
    "items": [
      {
        "author": "chatgpt-codex-connector[bot]",
        "provider": "codex",
        "ref": "review-comment:123",
        "severity": "medium",
        "state": "open",
        "summary": "The write happens before the report is ready.",
        "thread": "thread:PRRT_example",
        "title": "Delay dismissal until the report is ready"
      }
    ],
    "nextCursor": "OPAQUE_CURSOR",
    "target": {
      "head": "0123456789abcdef0123456789abcdef01234567",
      "pr": 123,
      "repo": "OWNER/REPOSITORY"
    },
    "total": 81
  }
}
```

Failures use the same top-level contract and put `code`, `message`, and `details` under `error`.
Consumers must reject an unknown protocol version before they read `data`. Human `show` output is a
safe rendered view that removes terminal control bytes.

`inspect --agent` returns pull request state, review counts, every open finding summary, and only
checks that need attention. It does not return Markdown bodies or passing check names. It does not
truncate `openItems`. Use `inspect --json` when you need the complete snapshot.

`context --agent` returns the exact title and Markdown body. It also returns repository identity,
lifecycle state, base and head refs with full SHAs, commit summaries, changed files, diff totals,
checks that need attention, reviews, and unresolved review threads. Use `--purpose authoring` for
short thread summaries. Use `--purpose review` for exact unresolved thread bodies. Each section has
`total` and `truncated`. Continue with `nextCursor` while `hasMore` is true. GitHub's public
`PullRequest` type does not expose its archive flag, so normal reads state
`lifecycle.archiveState=not-exposed` instead of guessing from closed or locked state.

Before creation, use the same command for a pinned comparison:

```nu
prdr context --repo OWNER/BASE --base main --base-sha BASE_SHA --head-repo OWNER/HEAD --head feature/name --head-sha HEAD_SHA --limit 100 --agent
```

Comparison commit pages use an opaque cursor. GitHub can return at most 300 changed files from this
API. The result states that file limit when it applies. GitHub returns the changed-file map and
diff totals only on the first comparison page. Later pages set `files.included` to `false` and the
omitted totals to `null`. Retain page one while you continue commit pages.

`show --agent` returns the selected exact body once under `data.body`. For an inline thread, it puts
each other comment once under `data.thread.otherComments`. It omits repeated roots, diff hunks, node
IDs, and other transport fields. Use `show --json` when those raw fields are required.

`prs --agent` returns pull requests ordered by recent updates. Each item includes its number, title,
optional summary, age in days, author, head and base branches, status, review decision, merge state,
check state, comment count, and review-thread count.
Filter by `--state`, `--base`, or `--branch`. The default page size is 30 and the maximum is 100.
Use `data.nextCursor` in the next call while `data.hasMore` is true. The cursor binds to the
repository and filters.

`list` defaults to open review threads. Pass `--state all` for issue comments, submitted review
history, unthreaded comments, and resolved threads. Empty submitted review events are omitted.
`codex` and `cursor` are provider filter values. Each agent record has a clean title and first prose
summary when they exist. Badge HTML and Markdown decoration are removed from these summaries. The
exact source Markdown remains available through `show`.

`list` returns 50 records by default and accepts a `--limit` from 1 to 100. `list` and `prs` are the
bounded read commands. Both return `hasMore` and `nextCursor`; continue until `hasMore` is false.

Use `data.nextCursor` while `data.hasMore` is true. Keep the same PR and filters on each request:

```nu
let first = (prdr list --state open --limit 50 --agent | from json)
prdr list --state open --limit 50 --cursor $first.data.nextCursor --agent
```

The cursor binds to the PR, head commit, filters, and normalized result set. If review activity
changes between page requests, `prdr` returns `ListPaginationError`. Restart without `--cursor` so
that the traversal cannot skip or repeat records.

## Author and update pull requests

Create is separate from update. Create requires exact remote base and head SHAs and an explicit
readiness value:

```nu
$body | prdr create \
  --repo OWNER/BASE_REPOSITORY \
  --base main \
  --base-sha BASE_SHA \
  --head-repo OWNER/HEAD_REPOSITORY \
  --head-branch feature/name \
  --head-sha HEAD_SHA \
  --readiness draft \
  --title 'Exact title' \
  --stdin --agent
```

Before it creates the pull request, `prdr` resolves both remote refs again. It stops if a ref is
missing, a SHA is stale, or a matching open pull request exists. It reads the new pull request and
verifies every pinned field. The result includes the body byte count and SHA-256 hash.

Use typed commands for later changes:

```nu
$body | prdr update --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --stdin --agent
prdr update --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --title 'New title' --agent
prdr transition --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --action mark-ready --agent
prdr update-branch --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --method rebase --agent
prdr reviewers --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --action request --user octocat --team platform --agent
```

`transition` accepts only `close`, `reopen`, `mark-ready`, and `convert-draft`. `update` requires at
least one of title, body, or base. `update-branch` requires `merge` or `rebase`.

## Markdown-safe writes

Pipe exact Markdown through standard input. This avoids shell expansion and does not require a
temporary file.

```nu
$body | prdr comment --repo OWNER/REPOSITORY --pr 123 --stdin --agent
$body | prdr reply review-comment:123 --repo OWNER/REPOSITORY --pr 123 --stdin --agent
$body | prdr edit issue-comment:456 --repo OWNER/REPOSITORY --pr 123 --stdin --agent
$body | prdr review --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --event approve --stdin --agent
prdr resolve review-comment:123 --repo OWNER/REPOSITORY --pr 123 --agent
prdr unresolve thread:PRRT_example --repo OWNER/REPOSITORY --pr 123 --agent
```

The CLI also accepts `--body-file PATH`. Pass exactly one of `--body-file` or `--stdin`. The Shim
tools accept `body` as a direct string and always use standard input. `reply` targets the root of an
inline review thread. GitHub issue comments are not threads, so `comment` creates a new pull request
conversation comment.

For one atomic review with several inline findings, send the typed request as JSON on standard
input. Each finding has `path`, `line`, `side`, and `body`. A range also has `startLine` and
`startSide`. `prdr` verifies that each coordinate is in the current diff before it writes.

## Deliver pull requests

Delivery commands are separate because they have different effects and permissions:

```nu
prdr auto-merge --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --action enable --strategy squash --agent
prdr queue --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --action enqueue --agent
prdr merge --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --strategy squash --agent
$body | prdr revert --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --readiness draft --title 'Revert change' --stdin --agent
prdr archive --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --agent
prdr unarchive --repo OWNER/REPOSITORY --pr 123 --expected-head HEAD_SHA --agent
```

Merge stops when a check needs attention, review changes are requested, a review thread is open,
the repository blocks the merge, or the head is stale. Revert returns the identity of the new
revert pull request. Archive and unarchive require administration permission. Their result verifies
the named mutation payload, repository and PR identity, head, and a second read. Archive also
verifies GitHub's visible closed and locked consequences. A successful read does not permit a
write. Each command needs authority for that exact GitHub action.

## Greptile

Greptile documents PR comment and reply mentions such as `@greptileai`, its confidence score, and
re-review flow in its [developer essentials](https://www.greptile.com/docs/code-review/developer-essentials)
and [quick reference](https://www.greptile.com/docs/developer-quick-reference).

Greptile normally starts from repository automation. Read its state before you consider any manual
action:

```nu
prdr greptile status --repo OWNER/REPOSITORY --pr 123 --agent
prdr greptile wait --repo OWNER/REPOSITORY --pr 123 --interval-seconds 15 --timeout-seconds 600 --agent
```

`status` reports the current head, lightweight summaries for open Greptile threads, the latest
activity, and the latest completed review. It also reports confidence when present, review count,
and last reviewed commit. Each summary has a qualified reference for `show`. A later failure or
progress comment does not replace the completed review data. `wait` polls only Greptile data, has a
finite timeout, and fails if the pull request head changes.

The CLI keeps `greptile trigger` as a manual recovery command. Use it only when the user asks for a
manual review request or authorizes recovery after the automatic integration failed. `greptile
ask` is a separate explicit GitHub write for a user-requested question. It preserves the supplied
Markdown and adds `@greptileai` only when the body does not contain the mention.

## Aikido Security

Repository automation normally starts Aikido Security. `status` reports the current head and
combines the named Aikido check with lightweight summaries for all open Aikido review threads. Use
each summary's `rootRef` with `show` to read its exact Markdown.

```nu
prdr aikido status --agent
```

Aikido documents this false-positive reply syntax in its
[GitHub PR gating guide](https://help.aikido.dev/pr-and-release-gating/github-ci-pr-gating-via-aikido-dashboard):

```text
@AikidoSec ignore: REASON
```

For a confirmed false positive, put one short reason line in a file and run the command only after
the GitHub write is approved:

```nu
prdr aikido ignore review-comment:123 --body-file /tmp/prdr-aikido-reason.txt --agent
```

The command checks that Aikido created the selected thread. After the reply, read the thread and
check again before you treat the ignore as accepted.

## Agent skill

The bundled skill is [`skills/prdr/SKILL.md`](skills/prdr/SKILL.md). It defines the read, triage,
reply, provider, and permission workflow. Print the installed copy with:

```nu
prdr skill
```

The skill starts from an explicit pull request target when one is known and treats automatic
provider review as the normal path. Comments, reviews, manual provider actions, security ignores,
and thread state changes remain external mutations. A read request does not permit them.

## Development checks

```nu
bun run format
bun run lint
bun run typecheck
bun run test
bun run build -- --no-formula
bun run publish:check
bun run verify
```

The tests cover every GitHub mutation route, pull request and review-item pagination, explicit
number and branch selection, consistent command-specific loaders, deleted GitHub actors, provider
state and waits, terminal control sanitization, versioned subprocess output, deterministic
releases, and exact Markdown transport.

## Releases

The npm package exposes one supported surface: the bundled `prdr` executable and the bundled skill.
It does not publish raw TypeScript source.

`bun run build` creates `dist/prdr.js`, creates a deterministic
`artifacts/prdr-VERSION.tar.gz`, calculates its SHA-256 checksum, and updates
[`Formula/prdr.rb`](Formula/prdr.rb). Use `--no-formula` for normal development builds.

Use this release transaction. Start from a clean, current `main` branch and choose the release
version:

```nu
let version = "0.2.0"
git pull --ff-only
bun pm pkg set $"version=($version)"
bun install
bun run verify
bun run audit:production
bun run build
tar -tvzf $"artifacts/prdr-($version).tar.gz"
bun run publish:check
git diff --check
git status --short
git add package.json bun.lock Formula/prdr.rb
git commit -m $"chore(release): v($version)"
git push origin main
git tag -a $"v($version)" -m $"v($version)"
git push origin $"v($version)"
gh release create $"v($version)" $"artifacts/prdr-($version).tar.gz" --verify-tag --generate-notes
bun publish
```

After publication, install the npm package and the Homebrew formula in clean temporary locations.
Run `prdr --version` and `prdr --help` from both installations. The Git tag, GitHub archive, npm
version, formula version, and formula checksum must refer to the same deterministic build.

## License and origin

MIT. The retained [`LICENSE`](LICENSE) contains the original copyright notice from Paul Bakaus.
See the upstream repository for its history and the current fork for this rewrite.
