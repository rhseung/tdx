// desired() against a fake client: which queries run, and what they map to.

import { expect, test } from "bun:test";
import type { Api, Json, Params } from "../src/core/http.ts";
import { BASE_URL, desired, discarded } from "../src/github/gh.ts";

const REPO = {
  id: 1,
  name: "rhseung",
  full_name: "rhseung/rhseung",
  archived: false,
  owner: { id: 9, login: "rhseung", type: "User" },
};

function found(nodeId: string, number: number, isPr: boolean): Json {
  return {
    node_id: nodeId,
    number,
    title: "t",
    html_url: `https://github.com/rhseung/rhseung/issues/${number}`,
    repository_url: `${BASE_URL}/repos/rhseung/rhseung`,
    ...(isPr ? { pull_request: {} } : {}),
  };
}

const unused = async (): Promise<Json> => {
  throw new Error("not expected in this test");
};

function fake(overrides: Partial<Api>): Api {
  return { get: unused, post: unused, delete: unused, ...overrides };
}

test("unassigned issues I opened are collected", async () => {
  const results: Record<string, Json[]> = {
    "is:pr is:open author:@me": [found("PR_a", 1, true)],
    "is:issue is:open author:@me no:assignee": [found("I_b", 38, false)],
  };
  const queries: string[] = [];
  const api = fake({
    get: async (path: string, params: Params = {}) => {
      if (path === "/issues") return [];
      if (path === "/search/issues") {
        queries.push(String(params.q));
        return { items: results[String(params.q)] ?? [] };
      }
      return REPO;
    },
  });

  const items = new Map((await desired(api)).map((item) => [item.ghId, item]));

  // Assigned to someone else is left out by the query, not by a filter here.
  expect(queries).toContain("is:issue is:open author:@me no:assignee");
  expect(items.get("PR_a")?.isPr).toBe(true);
  expect(items.get("I_b")?.isPr).toBe(false);
  expect(items.get("I_b")?.number).toBe(38);
});

test("discarded picks out what was never done", async () => {
  const nodes = [
    { id: "I_planned", stateReason: "COMPLETED" },
    { id: "I_dropped", stateReason: "NOT_PLANNED" },
    { id: "I_dupe", stateReason: "DUPLICATE" },
    { id: "PR_merged", state: "MERGED" },
    { id: "PR_given_up", state: "CLOSED" },
    { id: "PR_still_open", state: "OPEN" },
    null, // gone, or no longer visible to this token
  ];
  const api = fake({
    post: async (path: string) => {
      expect(path).toBe("/graphql");
      return { data: { nodes } };
    },
  });
  const ids = [...nodes.flatMap((n) => (n ? [n.id] : [])), "I_gone"];
  expect(await discarded(api, ids)).toEqual(new Set(["I_dropped", "I_dupe", "PR_given_up"]));
});

test("discarded skips the call when nothing vanished", async () => {
  const api = fake({
    post: async () => {
      throw new Error("no ids, no call");
    },
  });
  expect(await discarded(api, [])).toEqual(new Set());
});

test("discarded survives an id GitHub no longer resolves", async () => {
  // A deleted issue answers with a null node and an error, not a dead run.
  const api = fake({
    post: async () => ({
      data: { nodes: [null, { id: "I_dropped", stateReason: "NOT_PLANNED" }] },
      errors: [{ type: "NOT_FOUND", path: ["nodes", 0] }],
    }),
  });
  expect(await discarded(api, ["I_gone", "I_dropped"])).toEqual(new Set(["I_dropped"]));
});

test("discarded stops the run when nothing came back", async () => {
  const api = fake({ post: async () => ({ errors: [{ message: "Bad credentials" }] }) });
  expect(discarded(api, ["I_a"])).rejects.toThrow("Bad credentials");
});
