#!/usr/bin/env bun
import { version } from '../../package.json' with { type: 'json' };

const help = `DESCRIPTION
  Author, review, and deliver GitHub pull requests through typed operations

USAGE
  prdr <subcommand> [flags]

SUBCOMMANDS
  prs          List cursor-paged pull requests with compact status summaries
  target       Normalize a repository or find bounded branch candidates
  context      Read exact, bounded authoring or review context
  create       Create a pull request from pinned remote refs and exact Markdown
  transition   Close, reopen, mark ready, or convert a pull request to draft
  update       Update the exact title, Markdown body, or base branch
  update-branch Update a branch with an explicit merge or rebase method
  inspect      Inspect pull request state, review findings, and checks
  list         List cursor-paged review findings; defaults to open threads
  show         Render one comment safely; --agent and --json keep exact raw Markdown
  comment      Create a pull request issue comment from exact Markdown input
  reply        Reply to an inline review thread from exact Markdown input
  edit         Edit an issue or inline review comment with exact Markdown input
  review       Submit a GitHub pull request review from exact Markdown input
  reviewers    Request or remove users and teams
  resolve      Resolve a review thread
  unresolve    Unresolve a review thread
  auto-merge   Enable or disable auto-merge
  queue        Enqueue or dequeue a pull request
  merge        Merge after pinned checks and review preconditions
  revert       Create and verify a revert pull request
  archive      Archive a pull request
  unarchive    Unarchive a pull request
  greptile     Inspect Greptile review activity and manual recovery actions
  aikido       Inspect Aikido Security review activity and confirmed false-positive actions
  skill        Print the bundled prdr agent skill

Run prdr <subcommand> --help for command flags.`;

const arguments_ = process.argv.slice(2);
const [first] = arguments_;

if (first === '--version' || first === '-v') {
  process.stdout.write(`prdr v${version}\n`);
} else if (first === undefined || first === '--help' || first === '-h') {
  process.stdout.write(`${help}\n`);
} else if (first === 'skill' && arguments_.length === 1) {
  const { printSkill } = await import('./skill-content');
  printSkill();
} else {
  const { runCli } = await import('./app');
  runCli(version);
}
