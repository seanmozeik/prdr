#!/usr/bin/env bun
import pkg from '../../package.json' with { type: 'json' };

const help = `DESCRIPTION
  Read and update GitHub pull request review conversations safely

USAGE
  prdr <subcommand> [flags]

SUBCOMMANDS
  inspect      Read a consistent pull request review snapshot
  list         List cursor-paged review findings with qualified references
  show         Render one comment safely; --agent and --json keep exact raw Markdown
  comment      Create a pull request issue comment from exact Markdown input
  reply        Reply to an inline review thread from exact Markdown input
  edit         Edit an issue or inline review comment with exact Markdown input
  review       Submit a GitHub pull request review from exact Markdown input
  resolve      Resolve a review thread
  unresolve    Unresolve a review thread
  greptile     Inspect, trigger, and wait for Greptile review activity
  aikido       Inspect and respond to Aikido Security review activity
  skill        Print the bundled prdr agent skill

Run prdr <subcommand> --help for command flags.`;

const arguments_ = process.argv.slice(2);
const [first] = arguments_;

if (first === '--version' || first === '-v') {
  process.stdout.write(`prdr v${pkg.version}\n`);
} else if (first === undefined || first === '--help' || first === '-h') {
  process.stdout.write(`${help}\n`);
} else {
  const { runCli } = await import('./app');
  runCli();
}
