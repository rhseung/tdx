// The whole point of keeping reconcile pure: these run without a network.

import { describe, expect, test } from "bun:test";
import { addDays } from "../src/core/day.ts";
import {
  content,
  description,
  type Item,
  LABEL_BLOCKED,
  LABEL_ISSUE,
  LABEL_PR,
  type LabelInfo,
  labels,
  PRIORITY_ISSUE,
  PRIORITY_PR,
  type ProjectInfo,
  type Ref,
  type SectionInfo,
  type Snapshot,
  sectionDescription,
  sectionKey,
  type TaskInfo,
} from "../src/github/models.ts";
import { GRACE_DAYS, type Op, reconcile, SyncError } from "../src/github/reconcile.ts";

const ROOT: ProjectInfo = { id: "R", name: "GitHub", description: "" };
const TODAY = "2026-09-08";
// Painted already, so the label ops stay quiet and the other tests read clean.
const PAINTED: Record<string, LabelInfo> = {
  [LABEL_PR]: { id: "LP", color: "grape" },
  [LABEL_ISSUE]: { id: "LI", color: "green" },
  [LABEL_BLOCKED]: { id: "LB", color: "red" },
};

function item(overrides: Partial<Item> = {}): Item {
  return {
    ghId: "I_a",
    isPr: false,
    repoId: "1",
    repoName: "rds",
    ownerId: "9",
    ownerLogin: "rhseung",
    ownerIsOrg: false,
    number: 42,
    title: "fix thing",
    url: "https://gh/1",
    deadline: null,
    blockedBy: [],
    blocking: [],
    ...overrides,
  };
}

function ref(ghId: string, number: number, repo = "rhseung/rds"): Ref {
  return { ghId, number, repo };
}

function task(overrides: Partial<TaskInfo> & Pick<TaskInfo, "id">): TaskInfo {
  return {
    content: "c",
    projectId: "R",
    sectionId: "S",
    priority: PRIORITY_ISSUE,
    deadline: null,
    labels: [],
    description: "",
    childOrder: 0,
    ...overrides,
  };
}

function section(overrides: Partial<SectionInfo> & Pick<SectionInfo, "id" | "name">): SectionInfo {
  return { projectId: "R", description: "", ...overrides };
}

function snap(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    root: ROOT,
    orgs: {},
    sections: new Map(),
    tasks: {},
    occupied: new Set(),
    emptySince: {},
    labels: PAINTED,
    ...overrides,
  };
}

// A snapshot that already matches `one` exactly.
function settled(one: Item): Snapshot {
  return snap({
    sections: new Map([
      [
        sectionKey("R", one.repoId),
        section({ id: "S", name: one.repoName, description: sectionDescription(one) }),
      ],
    ]),
    tasks: {
      [one.ghId]: task({
        id: "T",
        content: content(one),
        priority: one.isPr ? PRIORITY_PR : PRIORITY_ISSUE,
        deadline: one.deadline,
        labels: labels(one),
        description: description(one),
      }),
    },
    occupied: new Set(["R", "S"]),
  });
}

const kinds = (ops: Op[]) => ops.map((op) => op.kind);

function only<K extends Op["kind"]>(ops: Op[], kind: K): Extract<Op, { kind: K }>[] {
  return ops.filter((op): op is Extract<Op, { kind: K }> => op.kind === kind);
}

function at<K extends Op["kind"]>(ops: Op[], index: number, kind: K): Extract<Op, { kind: K }> {
  const op = ops[index];
  if (op?.kind !== kind) throw new Error(`op ${index} is ${op?.kind}, not ${kind}`);
  return op as Extract<Op, { kind: K }>;
}

test("steady state is a no-op", () => {
  const one = item();
  expect(reconcile([one], settled(one))).toEqual([]);
});

test("empty todoist builds the tree", () => {
  const ops = reconcile([item()], snap({ root: null }));
  expect(kinds(ops)).toEqual(["CreateRoot", "CreateSection", "CreateTask", "ReorderTasks"]);
});

test("new issue in a known repo", () => {
  const one = item();
  const ops = reconcile([one, item({ ghId: "I_b", number: 43 })], settled(one));
  expect(kinds(ops)).toEqual(["CreateTask", "ReorderTasks"]);
});

test("repo rename touches only the section", () => {
  // Task content carries no repo name, so no task op follows a repo rename --
  // only the section's own name and the repo link in its description.
  const ops = reconcile([item({ repoName: "rds2" })], settled(item()), { today: TODAY });
  expect(kinds(ops)).toEqual(["RenameSection", "SetDescription"]);
  expect(at(ops, 1, "SetDescription").description).toBe("[rds2](https://github.com/rhseung/rds2)");
});

test("issue retitle rewrites the task", () => {
  const ops = reconcile([item({ title: "fix other thing" })], settled(item()));
  expect(kinds(ops)).toEqual(["UpdateTask"]);
  expect(at(ops, 0, "UpdateTask").content).toBe("[#42](https://gh/1) fix other thing");
});

test("org repo gets a sub-project", () => {
  const org = item({
    ghId: "I_b",
    repoId: "2",
    repoName: "ziggle",
    ownerId: "8",
    ownerLogin: "gsainfoteam",
    ownerIsOrg: true,
    isPr: true,
    deadline: "2026-10-01",
  });
  const ops = reconcile([org], snap());
  expect(kinds(ops)).toEqual(["CreateOrgProject", "CreateSection", "CreateTask", "ReorderTasks"]);
  expect(at(ops, 2, "CreateTask").deadline).toBe("2026-10-01");
  expect(at(ops, 2, "CreateTask").priority).toBe(PRIORITY_PR);
});

test("org rename follows github", () => {
  const org = item({ ownerId: "8", ownerLogin: "gsa-new", ownerIsOrg: true });
  const ops = reconcile(
    [org],
    snap({ orgs: { "8": { id: "P", name: "gsainfoteam", description: "" } } }),
  );
  expect(kinds(ops)[0]).toBe("RenameProject");
});

test("vanished issue is completed", () => {
  const ops = reconcile([], settled(item()));
  expect(kinds(ops)).toEqual(["CompleteTask"]);
  expect(at(ops, 0, "CompleteTask").id).toBe("T");
});

test("issue closed as not planned is deleted", () => {
  const one = item();
  const ops = reconcile([], settled(one), { discarded: new Set([one.ghId]) });
  expect(kinds(ops)).toEqual(["DeleteTask"]);
  expect(at(ops, 0, "DeleteTask").id).toBe("T");
});

test("bulk completion is refused", () => {
  const tasks: Record<string, TaskInfo> = {};
  for (let n = 0; n < 21; n++) tasks[`I_${n}`] = task({ id: `T${n}` });
  const s = snap({ tasks });
  expect(() => reconcile([], s)).toThrow(SyncError);
  expect(() => reconcile([], s)).toThrow("21 tasks");
  expect(reconcile([], s, { cap: 99 })).toHaveLength(21);
});

test("task in the wrong section is moved", () => {
  const one = item();
  const s = settled(one);
  s.tasks[one.ghId] = task({
    id: "T",
    content: content(one),
    sectionId: "ELSEWHERE",
    labels: labels(one),
  });
  expect(kinds(reconcile([one], s))).toEqual(["MoveTask"]);
});

describe("empty containers", () => {
  // A section Todoist still has but GitHub has nothing for.
  function emptySection(since: string | null): Snapshot {
    return snap({
      sections: new Map([
        [
          sectionKey("R", "1"),
          section({ id: "S", name: "rds", description: "[rds](https://github.com/rhseung/rds)" }),
        ],
      ]),
      emptySince: since ? { S: since } : {},
    });
  }

  test("newly empty section is stamped, not deleted", () => {
    expect(reconcile([], emptySection(null), { today: TODAY })).toEqual([
      { kind: "MarkEmpty", id: "S", since: TODAY },
    ]);
  });

  test("section inside the grace period is left alone", () => {
    const s = emptySection(addDays(TODAY, -(GRACE_DAYS - 1)));
    expect(reconcile([], s, { today: TODAY })).toEqual([]);
  });

  test("section empty past the grace period is deleted", () => {
    const ops = reconcile([], emptySection(addDays(TODAY, -GRACE_DAYS)), { today: TODAY });
    expect(kinds(ops)).toEqual(["Delete"]);
    const op = at(ops, 0, "Delete");
    expect([op.id, op.collection]).toEqual(["S", "sections"]);
  });

  test("refilled section loses its stamp", () => {
    const ops = reconcile([item()], emptySection(addDays(TODAY, -99)), { today: TODAY });
    expect(kinds(ops)).toEqual(["CreateTask", "ReorderTasks", "MarkEmpty"]);
    expect(ops[2]).toEqual({ kind: "MarkEmpty", id: "S", since: null });
  });

  test("an unmarked task keeps the section alive", () => {
    // occupied counts every task, so a hand written note is never deleted with
    // the section around it.
    const s = { ...emptySection(addDays(TODAY, -99)), occupied: new Set(["S"]) };
    expect(reconcile([], s, { today: TODAY })).toEqual([
      { kind: "MarkEmpty", id: "S", since: null },
    ]);
  });

  test("deleting an org project takes its section", () => {
    const since = addDays(TODAY, -GRACE_DAYS);
    const s = snap({
      orgs: { "8": { id: "P", name: "gsainfoteam", description: "" } },
      sections: new Map([
        [sectionKey("P", "2"), section({ id: "S2", name: "ziggle", projectId: "P" })],
      ]),
      emptySince: { P: since, S2: since },
    });
    const ops = reconcile([], s, { today: TODAY });
    expect(kinds(ops)).toEqual(["Delete"]);
    expect(at(ops, 0, "Delete").id).toBe("P");
  });
});

test("descriptions lead with a link to github", () => {
  const org = item({ ownerId: "8", ownerLogin: "gsainfoteam", ownerIsOrg: true });
  const ops = reconcile([org], snap(), { today: TODAY });
  expect(kinds(ops)).toEqual(["CreateOrgProject", "CreateSection", "CreateTask", "ReorderTasks"]);
  // Explicit markdown link, not a bare URL -- Todoist retitles a bare URL and
  // the description would then differ from what reconcile wants on every poll.
  expect(at(ops, 0, "CreateOrgProject").description).toBe(
    "[gsainfoteam](https://github.com/gsainfoteam)",
  );
  expect(at(ops, 1, "CreateSection").description).toBe("[rds](https://github.com/gsainfoteam/rds)");
});

test("org rename rewrites the project link", () => {
  const org = item({ ownerId: "8", ownerLogin: "gsa-new", ownerIsOrg: true });
  const s = snap({
    orgs: {
      "8": {
        id: "P",
        name: "gsainfoteam",
        description: "[gsainfoteam](https://github.com/gsainfoteam)\n\ngh-org-id: 8",
      },
    },
    occupied: new Set(["P"]),
  });
  const ops = reconcile([org], s, { today: TODAY });
  expect(kinds(ops)).toEqual([
    "RenameProject",
    "CreateSection",
    "CreateTask",
    "ReorderTasks",
    "SetDescription",
  ]);
  expect(at(ops, 4, "SetDescription").description).toBe("[gsa-new](https://github.com/gsa-new)");
});

test("labels are painted so the two kinds read apart", () => {
  // Todoist invents the label in grey the first time a task names it.
  let ops = reconcile([item()], snap({ labels: {} }), { today: TODAY });
  expect(only(ops, "SetLabel").map((op) => [op.name, op.color, op.id])).toEqual([
    [LABEL_BLOCKED, "red", null],
    [LABEL_ISSUE, "green", null],
    [LABEL_PR, "grape", null],
  ]);
  const faded = { ...PAINTED, [LABEL_PR]: { id: "LP", color: "grey" } };
  ops = reconcile([item()], snap({ labels: faded }), { today: TODAY });
  expect(only(ops, "SetLabel").map((op) => [op.name, op.id])).toEqual([[LABEL_PR, "LP"]]);
});

test("kind is a label so a filter can see it", () => {
  const pair = [item(), item({ ghId: "I_b", number: 43, isPr: true })];
  const ops = reconcile(pair, snap(), { today: TODAY });
  expect(only(ops, "CreateTask").map((op) => op.labels)).toEqual([[LABEL_ISSUE], [LABEL_PR]]);
});

test("an issue turned PR swaps its label and keeps manual ones", () => {
  const one = item();
  const s = settled(one);
  s.tasks[one.ghId] = task({ id: "T", content: content(one), labels: ["waiting", LABEL_ISSUE] });
  const ops = reconcile([item({ isPr: true })], s, { today: TODAY });
  expect(kinds(ops)).toEqual(["UpdateTask"]);
  expect(at(ops, 0, "UpdateTask").labels).toEqual(["waiting", LABEL_PR]);
});

describe("dependencies", () => {
  const order = (ops: Op[]) => only(ops, "ReorderTasks").map((op) => op.ghIds);
  const firstOrder = (ops: Op[]) => order(ops)[0] ?? [];

  test("a blocker sorts ahead of what it blocks", () => {
    // Numbers run the other way on purpose: depth has to beat the tie-break.
    const blocker = item({ ghId: "I_a", number: 90 });
    const blocked = item({ ghId: "I_b", number: 10, blockedBy: [ref("I_a", 90)] });
    const ops = reconcile([blocked, blocker], snap());
    expect(only(ops, "CreateTask").map((op) => op.ghId)).toEqual(["I_a", "I_b"]);
    expect(order(ops)).toEqual([["I_a", "I_b"]]);
  });

  test("a chain orders end to end", () => {
    const a = item({ ghId: "I_a", number: 3 });
    const b = item({ ghId: "I_b", number: 2, blockedBy: [ref("I_a", 3)] });
    const c = item({ ghId: "I_c", number: 1, blockedBy: [ref("I_b", 2)] });
    expect(order(reconcile([c, b, a], snap()))).toEqual([["I_a", "I_b", "I_c"]]);
  });

  test("a blocker outside the list still pushes the item down", () => {
    // Someone else's issue never shows up as a task, but it still has to close.
    const free = item({ ghId: "I_a", number: 90 });
    const waiting = item({ ghId: "I_b", number: 10, blockedBy: [ref("I_x", 5, "other/repo")] });
    expect(order(reconcile([waiting, free], snap()))).toEqual([["I_a", "I_b"]]);
  });

  test("a dependency cycle terminates", () => {
    const a = item({ ghId: "I_a", number: 1, blockedBy: [ref("I_b", 2)] });
    const b = item({ ghId: "I_b", number: 2, blockedBy: [ref("I_a", 1)] });
    expect(only(reconcile([a, b], snap()), "CreateTask")).toHaveLength(2);
  });

  test("a blocked item says so in its labels and description", () => {
    const one = item({
      blockedBy: [ref("I_x", 5), ref("I_y", 7, "other/repo")],
      blocking: [ref("I_z", 9)],
    });
    const created = only(reconcile([one], snap()), "CreateTask")[0];
    expect(created?.description).toBe("blocked by #5, other/repo#7\nblocks #9");
    expect(created?.labels).toContain(LABEL_BLOCKED);
  });

  test("an unblocked item carries no blocked label and no description", () => {
    const created = only(reconcile([item()], snap()), "CreateTask")[0];
    expect(created?.description).toBe("");
    expect(created?.labels).not.toContain(LABEL_BLOCKED);
  });

  test("an order that already holds is left alone", () => {
    const one = item();
    expect(order(reconcile([one], settled(one)))).toEqual([]);
  });

  test("what frees the most goes first among equals", () => {
    // Both can be started today; one clears the way for another, one for nobody.
    const lone = item({ ghId: "I_a", number: 1 });
    const opener = item({ ghId: "I_b", number: 9, blocking: [ref("I_c", 3)] });
    const waiting = item({ ghId: "I_c", number: 3, blockedBy: [ref("I_b", 9)] });
    expect(order(reconcile([lone, opener, waiting], snap()))).toEqual([["I_b", "I_a", "I_c"]]);
  });

  test("freeing two beats freeing one", () => {
    // Same depth, same chain length: the count of what waits is what separates them.
    const wide = item({ ghId: "I_a", number: 9, blocking: [ref("I_c", 1), ref("I_d", 2)] });
    const narrow = item({ ghId: "I_b", number: 3, blocking: [ref("I_e", 4)] });
    const behind = [
      item({ ghId: "I_c", number: 1, blockedBy: [ref("I_a", 9)] }),
      item({ ghId: "I_d", number: 2, blockedBy: [ref("I_a", 9)] }),
      item({ ghId: "I_e", number: 4, blockedBy: [ref("I_b", 3)] }),
    ];
    const ops = reconcile([narrow, wide, ...behind], snap());
    expect(firstOrder(ops).slice(0, 2)).toEqual(["I_a", "I_b"]);
  });

  test("a chain outweighs a single dependent", () => {
    // A -> B -> C frees two in the end, so it beats D, which frees only one.
    const a = item({ ghId: "I_a", number: 9, blocking: [ref("I_b", 1)] });
    const b = item({
      ghId: "I_b",
      number: 1,
      blockedBy: [ref("I_a", 9)],
      blocking: [ref("I_c", 2)],
    });
    const c = item({ ghId: "I_c", number: 2, blockedBy: [ref("I_b", 1)] });
    const d = item({ ghId: "I_d", number: 3, blocking: [ref("I_e", 4)] });
    const e = item({ ghId: "I_e", number: 4, blockedBy: [ref("I_d", 3)] });
    const ops = reconcile([d, a, b, c, e], snap());
    expect(firstOrder(ops).slice(0, 2)).toEqual(["I_a", "I_d"]);
  });

  test("the most blocked sinks to the bottom", () => {
    // Both wait, but one waits on two things, so it is the furthest from ready.
    const a = item({ ghId: "I_a", number: 1, blocking: [ref("I_c", 3)] });
    const b = item({ ghId: "I_b", number: 2, blocking: [ref("I_d", 4)] });
    const one = item({ ghId: "I_c", number: 3, blockedBy: [ref("I_a", 1)] });
    const two = item({ ghId: "I_d", number: 4, blockedBy: [ref("I_a", 1), ref("I_b", 2)] });
    const ops = reconcile([two, one, b, a], snap());
    expect(firstOrder(ops).at(-1)).toBe("I_d");
  });
});
