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

export function recordRun(name: string, ok: boolean, summary: string): void {
  writeJson(RUNS(), { ...lastRuns(), [name]: { at: new Date().toISOString(), ok, summary } });
}
