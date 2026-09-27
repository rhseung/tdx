// Where each feature keeps what it has to remember between runs.
//
// One file per feature, so a bug in one can never corrupt another's record.
// The files are load bearing -- lose GitHub's and the next run builds a second
// tree beside the first -- so writes are atomic and the location is stable.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const CHECKOUT = resolve(import.meta.dir, "../..");

// Beside the checkout when run from one, else under the home dir. The launchd
// agent runs the checkout itself, so it lands in the project. A copy installed
// elsewhere has no checkout to sit in, and falling back beats quietly starting
// a second record inside node_modules.
export function stateDir(): string {
  if (process.env.TDX_STATE_DIR) return process.env.TDX_STATE_DIR;
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

// Written beside the target and renamed over it: a crash partway through
// leaves the previous file intact rather than a truncated one.
export function writeJson(path: string, body: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(tmp, path);
}
