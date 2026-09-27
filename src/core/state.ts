// Where each feature keeps what it has to remember between runs.
//
// One file per feature, so a bug in one can never corrupt another's record.
// The files are load bearing -- lose GitHub's and the next run builds a second
// tree beside the first -- so writes are atomic and the location is stable.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { z } from "zod";
import { parse } from "./schema.ts";

export const CHECKOUT = resolve(import.meta.dir, "../..");

// Beside the checkout when run from one, else under the home dir. The launchd
// agent runs the checkout itself, so it lands in the project. A copy installed
// elsewhere has no checkout to sit in, and falling back beats quietly starting
// a second record inside node_modules.
export function stateDir(): string {
  const override = process.env["TDX_STATE_DIR"];
  if (override) return override;
  if (existsSync(join(CHECKOUT, "package.json"))) return join(CHECKOUT, "state");
  return join(homedir(), ".local/state/tdx");
}

export function statePath(name: string): string {
  return join(stateDir(), `${name}.json`);
}

export function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

// A missing file reads as the schema's defaults: the first run starts empty.
// A present but malformed one is an error, never a fresh start -- for GitHub
// a fresh start would mean building a second tree.
export function readState<S extends z.ZodType>(path: string, schema: S): z.output<S> {
  return parse(schema, readJson(path) ?? {}, path);
}

// Written beside the target and renamed over it: a crash partway through
// leaves the previous file intact rather than a truncated one.
export function writeJson(path: string, body: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(tmp, path);
}
