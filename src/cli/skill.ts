import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';

import { printSkill } from './skill-content';

export const skillCommand = Command.make('skill').pipe(
  Command.withDescription('Print the bundled prdr agent skill'),
  Command.withHandler(() => Effect.sync(printSkill)),
);
