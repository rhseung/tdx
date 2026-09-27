// The state file is the only record of what maps to what, so it gets tests.

import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, forget, type GithubState, load, save } from "../src/github/state.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "tdx-state-"));

test("a missing file reads as an empty state", () => {
  // First ever run: nothing to recognise, so the tree gets built from scratch.
  expect(load(join(tmp(), "absent.json"))).toEqual(emptyState());
});

test("a saved state reads back the same", () => {
  const path = join(tmp(), "github.json");
  const before: GithubState = {
    root: "R",
    orgs: { "8": "P" },
    sections: { "1": "S" },
    tasks: { I_a: "T" },
    emptySince: { S: "2026-09-08" },
  };
  save(before, path);
  expect(load(path)).toEqual(before);
});

test("the file keeps the Python layout, so an old one reads back unchanged", async () => {
  const path = join(tmp(), "github.json");
  save({ ...emptyState(), root: "R", emptySince: { S: "2026-09-08" } }, path);
  const raw = await Bun.file(path).json();
  expect(Object.keys(raw)).toEqual(["root", "orgs", "sections", "tasks", "empty_since"]);
});

test("forget drops an object whatever kind it was", () => {
  const state: GithubState = {
    root: "R",
    orgs: { "8": "P" },
    sections: { "1": "S" },
    tasks: { I_a: "T" },
    emptySince: { S: "2026-09-08" },
  };

  forget(state, "S");
  expect(state.sections).toEqual({});
  expect(state.emptySince).toEqual({});

  forget(state, "T");
  expect(state.tasks).toEqual({});

  // Losing the root is what makes the next run rebuild the whole tree.
  forget(state, "R");
  expect(state.root).toBeNull();
});

test("saving leaves the old file intact if it cannot finish", () => {
  const path = join(tmp(), "github.json");
  save({ ...emptyState(), root: "R" }, path);
  expect(() =>
    save({ ...emptyState(), root: "X", emptySince: { S: "not a date" } }, path),
  ).toThrow();
  expect(load(path).root).toBe("R");
});
