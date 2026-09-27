// The command tree as Pastel builds it, read the same way, so completion can
// never list a command the CLI does not have or miss one it does.
//
// Pastel's own reader is not exported, so this repeats its rules: one file is
// one command, a directory is a group, `index` in a directory is the group's
// own command, and `_app` is not a command.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { z } from "zod";

export interface CommandNode {
  name: string;
  description: string;
  options: z.ZodType | undefined;
  args: z.ZodType | undefined;
  commands: CommandNode[];
}

interface CommandModule {
  description?: string;
  options?: z.ZodType;
  args?: z.ZodType;
}

async function load(file: string): Promise<CommandModule> {
  return (await import(pathToFileURL(file).href)) as CommandModule;
}

export async function readTree(directory: string, name = "tdx"): Promise<CommandNode> {
  const node: CommandNode = {
    name,
    description: "",
    options: undefined,
    args: undefined,
    commands: [],
  };
  for (const entry of (await readdir(directory)).sort()) {
    if (entry.startsWith("_app")) continue;
    const path = join(directory, entry);
    if ((await stat(path)).isDirectory()) {
      node.commands.push(await readTree(path, entry));
      continue;
    }
    if (!/\.(js|ts)x?$/.test(entry) || entry.endsWith(".d.ts")) continue;
    const command = await load(path);
    const base = entry.replace(/\.(js|ts)x?$/, "");
    if (base === "index") {
      node.description = command.description ?? "";
      node.options = command.options;
      node.args = command.args;
      continue;
    }
    node.commands.push({
      name: base,
      description: command.description ?? "",
      options: command.options,
      args: command.args,
      commands: [],
    });
  }
  return node;
}
