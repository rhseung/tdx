// The GitHub sync from end to end, and the small records around every run.

import { expect, test } from "bun:test";
import { disabled, lastRuns, recordRun, setEnabled } from "../src/core/features.ts";
import type { Api, Json } from "../src/core/http.ts";
import { syncGithub } from "../src/github/feature.tsx";
import { load } from "../src/github/state.ts";
import { Progress } from "../src/ui/progress.tsx";
import { ago } from "../src/ui/time.ts";
import { FakeTodoist } from "./fake.ts";

const quiet = () => new Progress({ mode: "json", color: false, header: false, pager: false });

const REPO = {
  id: 1,
  name: "rds",
  full_name: "rhseung/rds",
  archived: false,
  owner: { id: 9, login: "rhseung", type: "User" },
};

function issue(number: number, title: string): Json {
  return {
    node_id: `I_${number}`,
    number,
    title,
    html_url: `https://github.com/rhseung/rds/issues/${number}`,
    milestone: { due_on: "2026-10-01T00:00:00Z" },
    repository: REPO,
  };
}

// GitHub as the sync sees it: an assigned list, searches, and GraphQL.
function github(assigned: Json[], closedAs: Record<string, string> = {}): Api {
  const unused = async () => {
    throw new Error("not a GitHub call the sync makes");
  };
  return {
    get: async (path) => (path === "/issues" ? assigned : { items: [] }),
    post: async (_path, body = {}) => {
      const ids = (body["variables"] as { ids: string[] }).ids;
      const relations = String(body["query"]).includes("blockedBy");
      const nodes = ids.map((id) =>
        relations
          ? { id, blockedBy: { nodes: [] }, blocking: { nodes: [] } }
          : { id, stateReason: closedAs[id] ?? "COMPLETED" },
      );
      return { data: { nodes } };
    },
    delete: unused,
  };
}

test("a first sync builds the tree, and a second changes nothing", async () => {
  const todoist = new FakeTodoist();
  const hub = github([issue(42, "fix thing")]);

  const first = await syncGithub(quiet(), { github: hub, todoist });
  expect(first.ops.map((op) => op.change)).toContain("create");
  const task = todoist.tasks.find((t) => String(t["content"]).includes("fix thing"));
  expect(task).toMatchObject({ deadline: { date: "2026-10-01" }, labels: ["gh-issue"] });
  expect(load().tasks["I_42"]).toBe(task?.["id"]);

  const second = await syncGithub(quiet(), { github: hub, todoist });
  expect(second.ops).toEqual([]);
});

test("a dry run plans without writing anything, state included", async () => {
  const todoist = new FakeTodoist();
  const result = await syncGithub(quiet(), {
    github: github([issue(1, "a")]),
    todoist,
    dryRun: true,
  });
  expect(result.ops.length).toBeGreaterThan(0);
  expect(todoist.writes()).toEqual([]);
  expect(load().tasks).toEqual({});
});

test("an issue closed as not planned is deleted, not completed", async () => {
  const todoist = new FakeTodoist();
  await syncGithub(quiet(), { github: github([issue(7, "maybe")]), todoist });
  const result = await syncGithub(quiet(), {
    github: github([], { I_7: "NOT_PLANNED" }),
    todoist,
  });
  expect(result.ops.map((op) => op.change)).toContain("remove");
  expect(todoist.calls.some((c) => c.method === "DELETE" && c.path.startsWith("/tasks/"))).toBe(
    true,
  );
});

test("features can be switched off and back on", () => {
  setEnabled("recur", false);
  expect(disabled()).toEqual(new Set(["recur"]));
  setEnabled("recur", true);
  expect(disabled()).toEqual(new Set());
});

test("each feature's last run is kept, the newest winning", () => {
  recordRun("gh", false, "no network");
  recordRun("gh", true, "92 github items, 0 ops");
  recordRun("nudge", true, "0 pulled into Today");
  const runs = lastRuns();
  expect(runs["gh"]).toMatchObject({ ok: true, summary: "92 github items, 0 ops" });
  expect(Object.keys(runs).sort()).toEqual(["gh", "nudge"]);
});

test("ago reads in the largest whole unit", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  expect(ago("2026-09-27T11:59:30Z", now)).toBe("30s ago");
  expect(ago("2026-09-27T11:45:00Z", now)).toBe("15m ago");
  expect(ago("2026-09-27T09:00:00Z", now)).toBe("3h ago");
  expect(ago("2026-09-25T12:00:00Z", now)).toBe("2d ago");
});
