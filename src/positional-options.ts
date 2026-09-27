// Options belong to the command they are written after.
//
// commander lets a parent take its own options from anywhere on the line, and
// `recur` and `nudge` list things, so they have --json of their own. Without
// this, `tdx recur run --json` hands --json to `recur` and `run` never sees
// it. Pastel builds the program out of reach, so the setting is made on every
// command just before parsing -- on the commander copy Pastel uses.

import { createRequire } from "node:module";

interface Command {
  commands: Command[];
  enablePositionalOptions(): Command;
  parse(...args: unknown[]): unknown;
}

const { Command } = createRequire(import.meta.resolve("pastel"))("commander") as {
  Command: { prototype: Command };
};

const everywhere = (command: Command) => {
  command.enablePositionalOptions();
  for (const sub of command.commands) everywhere(sub);
};

const parse = Command.prototype.parse;
Command.prototype.parse = function (...args) {
  everywhere(this);
  return parse.apply(this, args);
};
