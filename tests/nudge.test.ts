import { expect, test } from "bun:test";
import type { Task } from "../src/core/todoist.ts";
import { NUDGE_CAP, NudgeError, plan, prune, upcoming } from "../src/nudge/nudge.ts";

const TODAY = "2026-10-05";

function task(id: string, deadline: string | null, due: string | null = null): Task {
  return {
    id,
    content: `task ${id}`,
    description: "",
    projectId: "P",
    sectionId: null,
    parentId: null,
    priority: 1,
    labels: [],
    deadline,
    due,
    isRecurring: false,
    childOrder: 0,
    noteCount: 0,
  };
}

const empty = () => ({ nudged: {} });

test("a deadline within two days gets a due date of today", () => {
  const nudges = plan([task("a", "2026-10-07"), task("b", "2026-10-08")], empty(), TODAY);
  expect(nudges).toEqual([{ id: "a", content: "task a", deadline: "2026-10-07", due: TODAY }]);
});

test("a deadline already passed is pulled in too, earliest first", () => {
  const nudges = plan([task("late", "2026-10-06"), task("gone", "2026-10-01")], empty(), TODAY);
  expect(nudges.map((n) => n.id)).toEqual(["gone", "late"]);
});

test("a task that already has a due date is left alone", () => {
  expect(plan([task("a", "2026-10-06", "2026-10-06")], empty(), TODAY)).toEqual([]);
});

test("a due date taken off by hand is not put back", () => {
  expect(plan([task("a", "2026-10-06")], { nudged: { a: "2026-10-04" } }, TODAY)).toEqual([]);
});

test("the window can be widened", () => {
  expect(plan([task("a", "2026-10-10")], empty(), TODAY, 5)).toHaveLength(1);
});

test("too many at once is refused", () => {
  const many = Array.from({ length: NUDGE_CAP + 1 }, (_, i) => task(`t${i}`, TODAY));
  expect(() => plan(many, empty(), TODAY)).toThrow(NudgeError);
  expect(plan(many, empty(), TODAY, 2, Number.POSITIVE_INFINITY)).toHaveLength(NUDGE_CAP + 1);
});

test("old records are pruned, recent ones kept", () => {
  const state = { nudged: { old: "2026-07-01", recent: "2026-10-01" } };
  prune(state, TODAY);
  expect(Object.keys(state.nudged)).toEqual(["recent"]);
});

test("the listing says when each task will be pulled in", () => {
  const rows = upcoming(
    [task("far", "2026-10-20"), task("near", "2026-10-06"), task("off", "2026-10-06")],
    { nudged: { off: "2026-10-04" } },
    TODAY,
  );
  expect(rows.map((r) => [r.id, r.on])).toEqual([
    ["near", "now"],
    ["off", "kept off"],
    ["far", "2026-10-18"],
  ]);
});
