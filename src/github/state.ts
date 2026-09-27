// Which Todoist object stands for which piece of GitHub.
//
// This mapping used to live in Todoist's own description fields, which meant
// every task carried a line of `gh-id: ...` that the user had to look at. It
// lives in one local file instead, so the descriptions hold only what a person
// would want to read.
//
// The trade is that this file is now load bearing: lose it and the next run
// does not recognise the tree it built, so it builds a second one alongside.

import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { type Day, isDay } from "../core/day.ts";
import { GithubStateFile } from "../core/schema.ts";
import { CHECKOUT, readJson, readState, statePath, writeJson } from "../core/state.ts";

export interface GithubState {
  root: string | null;
  orgs: Record<string, string>; // owner_id -> project id
  sections: Record<string, string>; // repo_id -> section id
  tasks: Record<string, string>; // gh_id -> task id
  emptySince: Record<string, Day>; // todoist id -> first seen empty
}

export function emptyState(): GithubState {
  return { root: null, orgs: {}, sections: {}, tasks: {}, emptySince: {} };
}

// Drop every trace of one Todoist object, whatever kind it was.
export function forget(state: GithubState, todoistId: string): void {
  for (const mapping of [state.orgs, state.sections, state.tasks]) {
    for (const [key, value] of Object.entries(mapping)) {
      if (value === todoistId) delete mapping[key];
    }
  }
  delete state.emptySince[todoistId];
  if (state.root === todoistId) state.root = null;
}

// The Python version kept this file at the checkout root. Moving it is the one
// step that could lose it, so it is done only when there is no doubt: never
// over an existing file, which would mean two records of two different trees.
export function migrateLegacy(path: string = statePath("github")): void {
  const legacy = join(CHECKOUT, "state.json");
  if (!existsSync(legacy)) return;
  if (existsSync(path)) {
    throw new Error(
      `both ${legacy} and ${path} exist; keep the one that matches the Todoist tree and delete the other`,
    );
  }
  // Checked before it moves, so a broken file stays where it was found.
  readState(legacy, GithubStateFile);
  writeJson(path, readJson(legacy));
  renameSync(legacy, `${legacy}.migrated`);
}

export function load(path: string = statePath("github")): GithubState {
  // Keys stay snake_case on disk: the file predates the port and has to read
  // back unchanged, since a mismatch here means a duplicate tree.
  const raw = readState(path, GithubStateFile);
  return {
    root: raw.root,
    orgs: raw.orgs,
    sections: raw.sections,
    tasks: raw.tasks,
    emptySince: raw.empty_since,
  };
}

export function save(state: GithubState, path: string = statePath("github")): void {
  // Checked before anything is written, so a bad value leaves the old file whole.
  for (const [id, since] of Object.entries(state.emptySince)) {
    if (!isDay(since)) throw new Error(`empty_since for ${id} is not a day: ${since}`);
  }
  writeJson(path, {
    root: state.root,
    orgs: state.orgs,
    sections: state.sections,
    tasks: state.tasks,
    empty_since: state.emptySince,
  });
}
