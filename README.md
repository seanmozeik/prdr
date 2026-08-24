# prdr

`prdr` is a typed command-line tool for GitHub pull request review conversations. It gives coding
agents one consistent view of issue comments, submitted reviews, inline review comments, review
threads, and checks. It also has direct support for Greptile and Aikido Security.

The project is a full Bun and Effect rewrite of
[`pbakaus/agent-reviews`](https://github.com/pbakaus/agent-reviews). The fork keeps the useful idea
and replaces the original JavaScript implementation, inferred thread state, and shell-sensitive
comment writes.

## What it fixes

- Review thread state comes from GitHub GraphQL. `prdr` reads `isResolved`, `isOutdated`, line data,
  and viewer permissions from `PullRequestReviewThread`.
- Each GitHub object has a qualified reference. Examples are `review-comment:123`,
  `issue-comment:456`, `review:789`, and `thread:PRRT_...`.
- Raw Markdown bodies stay unchanged. `prdr` does not strip HTML comments, `<details>` blocks, code
  fences, indentation, or blank lines.
- Every write takes a file or standard input, encodes a typed JSON request, and passes it to
  `gh api --input -`. A Markdown body is never placed in a shell command string.
- A snapshot checks the pull request head before and after its parallel API reads. It fails if the
  head changes during the read.
- Bot detection uses known provider identities and GitHub actor type. A human login that contains
  the text `bot` is still a human.

GitHub documents the thread fields and resolve mutations in its
[`PullRequestReviewThread` GraphQL reference](https://docs.github.com/en/graphql/reference/objects#pullrequestreviewthread).
The write path follows the [`gh api` standard-input contract](https://cli.github.com/manual/gh_api)
and GitHub's [raw review comment API](https://docs.github.com/en/rest/pulls/comments).

## Toolchain

- Bun 1.4.0 or later
- Effect and `@effect/platform-bun` 4.0.0-rc.111
- TypeScript 7.0.2 with `@effect/tsgo`
- `@seanmozeik/de-clank` 0.1.4
- Oxlint 1.79 and Oxfmt 0.64

The small CLI launcher answers root `--help` and `--version` without loading Effect. The full
Effect runtime loads only for real commands.

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
bun run dev -- list --repo OWNER/REPOSITORY --pr 123 --state open
```

Build `dist/prdr.js`:

```nu
bun run build -- --no-formula
```

## Read commands

`--repo` accepts `OWNER/REPOSITORY` or `HOST/OWNER/REPOSITORY`. When possible, `prdr` infers the
repository and pull request from the current worktree.

```nu
prdr inspect --agent
prdr list --state open --agent
prdr list --state open --provider greptile --agent
prdr list --state open --provider aikido --agent
prdr show review-comment:123 --agent
```

Use `--agent` for compact one-line JSON, `--json` for formatted JSON, or no output flag for terminal
output. `inspect --agent` returns the complete snapshot. `list` returns smaller normalized records.

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

```nu
prdr greptile status --agent
prdr greptile trigger --agent
prdr greptile ask --body-file /tmp/prdr-greptile-question.md --agent
```

`status` reports open Greptile threads, the latest summary, confidence when present, review count,
and last reviewed commit. `ask` keeps the supplied Markdown and adds `@greptileai` only when the
body does not contain the mention.

## Aikido Security

`status` combines the named Aikido check with open Aikido review threads.

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

The skill treats comments, review submissions, provider triggers, security ignores, and thread
state changes as external mutations. A read request does not permit those actions.

## Development checks

```nu
bun run format
bun run lint
bun run typecheck
bun run test
bun run build -- --no-formula
bun run verify
```

The tests cover provider identity and severity parsing, GraphQL thread composition, qualified
selection, Greptile and Aikido status, and exact Markdown transport through the typed `gh` client.

## Releases

`bun run build` creates `dist/prdr.js`, packages `artifacts/prdr-VERSION.tar.gz`, calculates its
SHA-256 checksum, and updates [`Formula/prdr.rb`](Formula/prdr.rb). Use `--no-formula` for normal
development builds.

## License and origin

MIT. The retained [`LICENSE`](LICENSE) contains the original copyright notice from Paul Bakaus.
See the upstream repository for its history and the current fork for this rewrite.
