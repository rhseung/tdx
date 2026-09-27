// A listing command's own --json must not swallow its subcommand's.

import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import "../src/positional-options.ts";

interface Command {
  command(name: string): Command;
  option(flag: string): Command;
  action(fn: (opts: Record<string, unknown>) => void): Command;
  exitOverride(): Command;
  parse(argv: string[], options: { from: "user" }): Command;
}

const { Command } = createRequire(import.meta.resolve("pastel"))("commander") as {
  Command: new () => Command;
};

test("an option after a subcommand goes to that subcommand, not its parent", () => {
  const seen: Record<string, unknown>[] = [];
  const program = new Command().exitOverride();
  const recur = program
    .command("recur")
    .option("--json")
    .action((o) => seen.push({ recur: o }));
  recur
    .command("run")
    .option("--json")
    .action((o) => seen.push({ run: o }));
  program.parse(["recur", "run", "--json"], { from: "user" });
  expect(seen).toEqual([{ run: { json: true } }]);
});

test("an option before the subcommand still belongs to the parent", () => {
  const seen: Record<string, unknown>[] = [];
  const program = new Command().exitOverride();
  program
    .command("recur")
    .option("--json")
    .action((o) => seen.push({ recur: o }));
  program.parse(["recur", "--json"], { from: "user" });
  expect(seen).toEqual([{ recur: { json: true } }]);
});
