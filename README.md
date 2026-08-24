# prdr

`prdr` is a typed command-line tool for GitHub pull requests and their review conversations. It
lists compact pull request summaries, then gives coding agents one consistent view of issue
comments, submitted reviews, inline review comments, review threads, and checks. It also normalizes
Greptile and Aikido Security state.

The project is a full Bun and Effect rewrite of
[`pbakaus/agent-reviews`](https://github.com/pbakaus/agent-reviews). The fork keeps the useful idea
and replaces the original JavaScript implementation, inferred thread state, and shell-sensitive
comment writes.

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

GitHub documents the thread fields and resolve mutations in its
[`PullRequestReviewThread` GraphQL reference](https://docs.github.com/en/graphql/reference/objects#pullrequestreviewthread).
The write path follows the [`gh api` standard-input contract](https://cli.github.com/manual/gh_api)
and GitHub's [raw review comment API](https://docs.github.com/en/rest/pulls/comments).

## Toolchain

- Bun 1.4.0 or later
- Effect and `@effect/platform-bun` 4.0.0-rc.111
- TypeScript 7.0.2 with `@effect/tsgo`
- `@seanmozeik/de-clank` 0.1.5
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

```nu
prdr prs --repo OWNER/REPOSITORY --state open --limit 30 --agent
prdr inspect --repo OWNER/REPOSITORY --pr 123 --agent
prdr inspect --repo OWNER/REPOSITORY --branch feature/name --agent
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

## Markdown-safe writes

Write the body to a file first. This makes the content easy to inspect and avoids shell expansion.

```nu
prdr comment --body-file /tmp/prdr-comment.md --agent
prdr reply review-comment:123 --body-file /tmp/prdr-reply.md --agent
prdr edit issue-comment:456 --body-file /tmp/prdr-edit.md --agent
prdr review --event approve --body-file /tmp/prdr-review.md --agent
prdr resolve review-comment:123 --agent
prdr unresolve thread:PRRT_example --agent
```

Pass exactly one of `--body-file PATH` or `--stdin`. `reply` targets the root of an inline review
thread. GitHub issue comments are not threads, so `comment` creates a new pull request conversation
comment.

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
