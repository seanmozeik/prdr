import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';

import skillMarkdown from '../../skills/prdr/SKILL.md' with { type: 'text' };

export const skillCommand = Command.make('skill').pipe(
  Command.withDescription('Print the bundled prdr agent skill'),
  Command.withHandler(() =>
    Effect.sync(() => {
      console.log(skillMarkdown);
    }),
  ),
);
