# prdr agent instructions

`AGENTS.md` is a symbolic link to this file. Keep one source of project instructions here.

## Product rules

- `prdr` is a Bun 1.4 and Effect v4 CLI over `gh` and the GitHub API.
- Keep root `--help` and `--version` paths free of the Effect runtime.
- Load only the GitHub data that a command needs.
- Read all pages from GitHub. When `prdr` bounds its own result, return an opaque cursor that binds
  to the target, head commit, filters, and result set.
- Keep raw GitHub Markdown unchanged in structured output and writes. Read write bodies only from a
  file or standard input, encode them as JSON, and pass them through `gh api --input -`.
- Keep issue comments, reviews, review comments, and review threads as separate qualified reference
  types.
- Treat every GitHub write as an external mutation. A read request does not permit a write.
- Revalidate the selected object and pull request head before a mutation. Check the mutation result
  before reporting success.

## Effect and TypeScript rules

- Use Effect v4 APIs. Do not add Effect v3 packages or imports.
- Use named `Effect.gen` generators for sequential work and `Effect.fn` for Effect operations.
- Model boundary failures with distinct `Schema.TaggedError` classes.
- Decode untrusted GitHub data with Effect Schema at the boundary.
- Preserve strict TypeScript options. Do not add type assertions to bypass a boundary.
- Keep domain logic independent from CLI presentation and GitHub process code.

## Local checks

- Use the De-clank Oxlint configuration. Do not add disable comments.
- Run `bun run format`, `bun run lint`, `bun run typecheck`, and `bun run test` before a commit.
- Run `bun run verify`, `bun run audit:production`, and `bun run publish:check` for a release-ready
  change.
- Do not add hosted CI or dependency-update automation unless the user asks for it.
