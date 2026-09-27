// The completion script, generated from the real command tree.

import { expect, test } from "bun:test";
import { COMMANDS } from "../src/completion/paths.ts";
import { readTree } from "../src/completion/tree.ts";
import { zshScript } from "../src/completion/zsh.ts";
import { initScript } from "../src/init.ts";

const tree = await readTree(COMMANDS);
const script = zshScript(tree);

const fn = (name: string) => {
  const start = script.indexOf(`${name}() {`);
  return start < 0 ? "" : script.slice(start, script.indexOf("\n}", start));
};

test("the tree has every command Pastel would build, groups included", () => {
  expect(tree.commands.map((c) => c.name)).toContain("recur");
  const recur = tree.commands.find((c) => c.name === "recur");
  expect(recur?.description).toContain("schedule");
  expect(recur?.commands.map((c) => c.name).sort()).toEqual([
    "edit",
    "new",
    "preview",
    "rm",
    "run",
    "show",
  ]);
});

test("subcommands complete with their descriptions", () => {
  expect(fn("_tdx_recur")).toContain("'show:One template, its rule and next deadlines'");
});

test("an enum argument offers its values", () => {
  expect(fn("_tdx_enable")).toContain("':feature:(gh recur nudge)'");
});

test("template ids come from Todoist, one or many", () => {
  expect(fn("_tdx_recur_show")).toContain("':id:_tdx_templates'");
  expect(fn("_tdx_recur_rm")).toContain("'*:ids:_tdx_templates'");
});

test("options carry their help, value name, choices and alias", () => {
  const sync = fn("_tdx_gh_sync");
  expect(sync).toContain("'--color[Colour in plain output]:when:(auto always never)'");
  expect(sync).toContain("'--grace[Days an empty section or sub-project may stay]:days: '");
  expect(sync).toContain(
    "'(-n --dry-run)'{-n,--dry-run}'[Show what would change, change nothing]'",
  );
  // A flag that defaults to on is offered as its negation, the way Pastel parses it.
  expect(sync).toContain("'--no-pager[");
  expect(sync).not.toContain("'--pager[");
});

test("only the top level offers --version", () => {
  expect(fn("_tdx")).toContain("--version");
  expect(fn("_tdx_recur")).not.toContain("--version");
});

test("a quote in a description cannot end the string early", () => {
  expect(fn("_tdx")).toContain("each feature'\\''s last run");
});

test.if(Boolean(Bun.which("zsh")))("the script is valid zsh", () => {
  const check = Bun.spawnSync(["zsh", "-n"], { stdin: new Blob([script]) });
  expect(check.stderr.toString()).toBe("");
  expect(check.exitCode).toBe(0);
});

test("only the zsh init wires td's completion", () => {
  const subcommands = [{ name: "recur", description: "templates" }];
  expect(initScript("zsh", subcommands)).toContain("compdef _td_with_tdx td");
  expect(initScript("bash", subcommands)).not.toContain("compdef");
  expect(initScript("bash", subcommands)).toContain("recur) tdx");
});
