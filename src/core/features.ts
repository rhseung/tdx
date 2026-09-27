// What `tdx run` runs, whether each is switched on, and how its last run went.
//
// The last run is kept apart from the launchd log so `status` can answer "is
// it working" without the reader digging through a log file.

import { ConfigFile, RunsFile } from "./schema.ts";
import { readState, statePath, writeJson } from "./state.ts";

export interface LastRun {
  at: string; // ISO timestamp
  ok: boolean;
  summary: string;
  // The numbers behind a successful summary, so it can be read back in
  // whatever language is asked for later rather than the one it was run in --
  // the launchd agent runs without a locale.
  counts?: number[] | undefined;
}

const CONFIG = () => statePath("config");
const RUNS = () => statePath("runs");

export function disabled(): Set<string> {
  return new Set(readState(CONFIG(), ConfigFile).disabled);
}

export function setEnabled(name: string, on: boolean): void {
  const off = disabled();
  if (on) off.delete(name);
  else off.add(name);
  writeJson(CONFIG(), { disabled: [...off].sort() });
}

export function lastRuns(): Record<string, LastRun> {
  return readState(RUNS(), RunsFile);
}

export function recordRun(name: string, ok: boolean, summary: string, counts?: number[]): void {
  const run: LastRun = { at: new Date().toISOString(), ok, summary, ...(counts ? { counts } : {}) };
  writeJson(RUNS(), { ...lastRuns(), [name]: run });
}
