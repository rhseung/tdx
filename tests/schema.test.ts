// A reply in the wrong shape has to stop the run, not read as "empty".

import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Json } from "../src/core/http.ts";
import { SchemaError } from "../src/core/schema.ts";
import { tasks } from "../src/core/todoist.ts";
import { desired } from "../src/github/gh.ts";
import { load } from "../src/github/state.ts";
import { createdId, loadState } from "../src/recur/io.ts";

const TASK = {
  id: "T1",
  content: "Quiz 2 준비",
  description: "",
  project_id: "P",
  section_id: null,
  parent_id: null,
  priority: 1,
  labels: [],
  deadline: { date: "2026-10-07", lang: "en" },
  due: null,
  child_order: 3,
};

function todoist(results: Json[]): Api {
  const fail = async () => {
    throw new Error("unexpected");
  };
  return { get: async () => ({ results, next_cursor: null }), post: fail, delete: fail };
}

test("a well-formed task reads, and a timed due date keeps only its day", async () => {
  const [task] = await tasks(
    todoist([{ ...TASK, due: { date: "2026-10-05T09:00:00", is_recurring: true } }]),
    {},
  );
  expect(task).toMatchObject({ deadline: "2026-10-07", due: "2026-10-05", isRecurring: true });
});

test("a task whose deadline key is missing stops the read instead of reading as no deadline", async () => {
  // This is the misread that would make the GitHub sync clear every deadline.
  const { deadline: _, ...withoutDeadline } = TASK;
  await expect(tasks(todoist([withoutDeadline]), {})).rejects.toThrow(SchemaError);
});

test("a deadline in another shape stops the read", async () => {
  await expect(tasks(todoist([{ ...TASK, deadline: "2026-10-07" }]), {})).rejects.toThrow(
    "deadline",
  );
});

test("the error names the endpoint and the field", async () => {
  await expect(tasks(todoist([{ ...TASK, priority: 9 }]), {})).rejects.toThrow(
    /GET \/tasks .*0\.priority/,
  );
});

test("a GitHub issue without its milestone key stops the sync", async () => {
  const repo = {
    id: 1,
    name: "r",
    full_name: "o/r",
    archived: false,
    owner: { id: 9, login: "o", type: "User" },
  };
  const issue = { node_id: "I_a", number: 1, title: "t", html_url: "u", repository: repo };
  const api: Api = {
    get: async (path) => (path === "/issues" ? [issue] : { items: [] }),
    post: async () => ({}),
    delete: async () => ({}),
  };
  await expect(desired(api)).rejects.toThrow("milestone");
});

test("a create that comes back without an id is refused, not recorded as undefined", () => {
  expect(createdId({ id: "X" })).toBe("X");
  expect(() => createdId({})).toThrow(SchemaError);
});

test("state files: missing reads as empty, older ones gain defaults, broken ones stop", () => {
  const dir = mkdtempSync(join(tmpdir(), "tdx-schema-"));
  expect(loadState(join(dir, "absent.json"))).toEqual({ created: {}, reported: {} });

  const older = join(dir, "github.json");
  writeFileSync(older, JSON.stringify({ root: "R", orgs: {}, sections: {}, tasks: {} }));
  expect(load(older).emptySince).toEqual({});

  const broken = join(dir, "broken.json");
  writeFileSync(broken, JSON.stringify({ root: "R", empty_since: { S: "yesterday" } }));
  expect(() => load(broken)).toThrow(/broken\.json.*empty_since\.S/);
});
