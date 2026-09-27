// Pure diff between GitHub's state and Todoist's state.
//
// No network: reconcile() takes two plain values and returns an ordered list of
// operations. That is what makes the interesting logic testable.

import { type Day, daysBetween, today as localToday } from "../core/day.ts";
import { type Key, sortBy } from "../core/order.ts";
import {
  content,
  description,
  type Item,
  LABEL_COLORS,
  labels,
  type ProjectInfo,
  priority,
  projectDescription,
  type SectionInfo,
  type Snapshot,
  sectionDescription,
  sectionKey,
} from "./models.ts";

// A run that wants to complete more than this is almost certainly reacting to a
// degraded GitHub response (revoked org access, a truncated page) rather than to
// me actually having finished that much work.
export const COMPLETE_CAP = 20;

// A section or sub-project that has gone empty is usually about to be refilled:
// the last issue in a repo closes today, the next one opens tomorrow. So an empty
// container is stamped with the date rather than deleted, and only goes once it
// has stayed empty this many days.
export const GRACE_DAYS = 7;

export class SyncError extends Error {}

// --- references -------------------------------------------------------------
// A project or section created during this run has no Todoist id yet, so ops
// refer to it symbolically and apply() resolves the reference as it goes.

export type ProjectRef =
  | { kind: "existing"; id: string }
  | { kind: "newRoot" }
  | { kind: "newOrg"; ownerId: string };
export type SectionRef = { kind: "existing"; id: string } | { kind: "newSection"; repoId: string };

const existing = (id: string) => ({ kind: "existing", id }) as const;

// --- operations -------------------------------------------------------------

export type Op =
  | { kind: "CreateRoot" }
  | { kind: "CreateOrgProject"; ownerId: string; name: string; description: string }
  | { kind: "RenameProject"; id: string; name: string }
  | {
      kind: "CreateSection";
      repoId: string;
      name: string;
      description: string;
      project: ProjectRef;
    }
  | { kind: "RenameSection"; id: string; name: string }
  | {
      kind: "CreateTask";
      ghId: string;
      content: string;
      description: string;
      priority: number;
      deadline: Day | null;
      labels: string[];
      project: ProjectRef;
      section: SectionRef;
    }
  | {
      kind: "UpdateTask";
      id: string;
      content: string;
      description: string;
      priority: number;
      deadline: Day | null;
      labels: string[];
    }
  | { kind: "MoveTask"; id: string; project: ProjectRef; section: SectionRef }
  // The order a section's tasks should sit in, as GitHub ids.
  | { kind: "ReorderTasks"; ghIds: string[] }
  | { kind: "CompleteTask"; id: string; ghId: string; content: string }
  // For work that never happened: a completion would claim it did.
  | { kind: "DeleteTask"; id: string; ghId: string; content: string }
  // Stamps or clears the empty marker. `collection` is the REST collection.
  | { kind: "SetDescription"; id: string; collection: Collection; description: string }
  | { kind: "Delete"; id: string; collection: Collection; name: string }
  // Bookkeeping only -- the grace clock lives in the state file, not Todoist.
  | { kind: "MarkEmpty"; id: string; since: Day | null }
  // Creates the label, or repaints one Todoist made by hand when first used.
  | { kind: "SetLabel"; id: string | null; name: string; color: string };

export type Collection = "projects" | "sections";

// Resolves an item to the project and section it belongs in.
//
// Sections are keyed by (project, repo) rather than repo alone: a repo moved
// between owners simply gets a fresh section in its new home. The stale one is
// left alone -- deleting a section takes its tasks with it.
class Refs {
  readonly #snap: Snapshot;
  readonly #root: ProjectRef;

  constructor(snap: Snapshot) {
    this.#snap = snap;
    this.#root = snap.root ? existing(snap.root.id) : { kind: "newRoot" };
  }

  project(item: Item): ProjectRef {
    if (!item.ownerIsOrg) return this.#root;
    const have = this.#snap.orgs[item.ownerId];
    return have ? existing(have.id) : { kind: "newOrg", ownerId: item.ownerId };
  }

  existingSection(item: Item): SectionInfo | undefined {
    const project = this.project(item);
    if (project.kind !== "existing") return undefined; // the project is being created this run
    return this.#snap.sections.get(sectionKey(project.id, item.repoId));
  }

  section(item: Item): SectionRef {
    const have = this.existingSection(item);
    return have ? existing(have.id) : { kind: "newSection", repoId: item.repoId };
  }
}

// One sub-project per organization, named after the org as GitHub has it.
function orgOps(items: Item[], snap: Snapshot): Op[] {
  const orgs = new Map<string, Item>();
  for (const item of items) if (item.ownerIsOrg) orgs.set(item.ownerId, item);
  const ops: Op[] = [];
  for (const [ownerId, one] of sortBy(orgs, ([id]) => [id])) {
    const have = snap.orgs[ownerId];
    if (!have) {
      ops.push({
        kind: "CreateOrgProject",
        ownerId,
        name: one.ownerLogin,
        description: projectDescription(one),
      });
    } else if (have.name !== one.ownerLogin) {
      ops.push({ kind: "RenameProject", id: have.id, name: one.ownerLogin });
    }
  }
  return ops;
}

// One section per repo, inside that repo's project.
function sectionOps(items: Item[], refs: Refs): Op[] {
  const seen = new Set<string>();
  const ops: Op[] = [];
  for (const item of sortBy(items, (i) => [i.ownerLogin, i.repoName])) {
    if (seen.has(item.repoId)) continue;
    seen.add(item.repoId);
    const have = refs.existingSection(item);
    if (!have) {
      ops.push({
        kind: "CreateSection",
        repoId: item.repoId,
        name: item.repoName,
        description: sectionDescription(item),
        project: refs.project(item),
      });
    } else if (have.name !== item.repoName) {
      ops.push({ kind: "RenameSection", id: have.id, name: item.repoName });
    }
  }
  return ops;
}

// How many items lie behind each one along `blockedBy` or `blocking`.
//
// Counting blockers transitively is itself a topological order: if B blocks A,
// then A waits on everything B waits on and on B besides, so A's count is
// strictly the larger. That makes a separate depth measure unnecessary.
//
// A dependency outside this list -- someone else's issue, a repo I hold no
// assignment in -- still counts, because it still has to close. A cycle would
// never settle, so a revisited id contributes nothing and the walk terminates.
function closure(items: Item[], follow: "blockedBy" | "blocking"): Map<string, number> {
  const byId = new Map(items.map((item) => [item.ghId, item]));
  const behind = new Map<string, Set<string>>();

  const walk = (ghId: string, seen: Set<string>): Set<string> => {
    const known = behind.get(ghId);
    if (known) return known;
    const item = byId.get(ghId);
    if (!item || seen.has(ghId)) return new Set();
    const found = new Set<string>();
    const next = new Set([...seen, ghId]);
    for (const ref of item[follow]) {
      found.add(ref.ghId);
      for (const id of walk(ref.ghId, next)) found.add(id);
    }
    behind.set(ghId, found);
    return found;
  };

  for (const item of items) walk(item.ghId, new Set());
  return new Map([...behind].map(([id, found]) => [id, found.size]));
}

// Least blocked first, then what frees the most, then issue number.
function orderKey(waits: Map<string, number>, frees: Map<string, number>) {
  return (i: Item): Key => [
    i.ownerLogin,
    i.repoName,
    waits.get(i.ghId) ?? 0,
    -(frees.get(i.ghId) ?? 0),
    i.number,
  ];
}

// One reorder per section whose sequence no longer matches the plan.
//
// Sorting by depth puts what can be started now at the top, which is the point:
// the section reads as a queue instead of as issue numbers. Creating tasks in
// order would only ever fix the run that created them, so the order is stated
// outright each time it drifts.
function orderOps(
  items: Item[],
  snap: Snapshot,
  waits: Map<string, number>,
  frees: Map<string, number>,
): Op[] {
  const groups = new Map<string, { key: Key; items: Item[] }>();
  for (const item of items) {
    const id = `${item.ownerLogin}\u0000${item.repoName}`;
    const group = groups.get(id) ?? { key: [item.ownerLogin, item.repoName], items: [] };
    group.items.push(item);
    groups.set(id, group);
  }
  const ops: Op[] = [];
  for (const group of sortBy(groups.values(), (g) => g.key)) {
    const want = sortBy(group.items, orderKey(waits, frees)).map((i) => i.ghId);
    const present = want.filter((id) => id in snap.tasks);
    const current = sortBy(present, (id) => [snap.tasks[id]?.childOrder ?? 0]);
    if (!sameList(current, present) || present.length !== want.length) {
      ops.push({ kind: "ReorderTasks", ghIds: want });
    }
  }
  return ops;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function taskOps(
  items: Item[],
  snap: Snapshot,
  refs: Refs,
  waits: Map<string, number>,
  frees: Map<string, number>,
): Op[] {
  const ops: Op[] = [];
  for (const item of sortBy(items, orderKey(waits, frees))) {
    const task = snap.tasks[item.ghId];
    if (!task) {
      ops.push({
        kind: "CreateTask",
        ghId: item.ghId,
        content: content(item),
        description: description(item),
        priority: priority(item),
        deadline: item.deadline,
        labels: labels(item),
        project: refs.project(item),
        section: refs.section(item),
      });
      continue;
    }
    const want = labels(item, task.labels);
    if (
      task.content !== content(item) ||
      task.description !== description(item) ||
      task.priority !== priority(item) ||
      task.deadline !== item.deadline ||
      !sameList(task.labels, want)
    ) {
      ops.push({
        kind: "UpdateTask",
        id: task.id,
        content: content(item),
        description: description(item),
        priority: priority(item),
        deadline: item.deadline,
        labels: want,
      });
    }
    const section = refs.section(item);
    if (section.kind !== "existing" || task.sectionId !== section.id) {
      ops.push({ kind: "MoveTask", id: task.id, project: refs.project(item), section });
    }
  }
  return ops;
}

// Anything GitHub no longer hands me.
function completionOps(items: Item[], snap: Snapshot, cap: number, discarded: Set<string>): Op[] {
  const goal = new Set(items.map((i) => i.ghId));
  const stale = sortBy(Object.entries(snap.tasks), ([id]) => [id]).filter(([id]) => !goal.has(id));
  if (stale.length > cap) {
    throw new SyncError(
      `${stale.length} tasks would be completed (cap ${cap}). That usually means a ` +
        "degraded GitHub response, not finished work. Re-run with --force if intended.",
    );
  }
  return stale.map(([ghId, t]) => ({
    kind: discarded.has(ghId) ? "DeleteTask" : "CompleteTask",
    id: t.id,
    ghId,
    content: t.content,
  }));
}

// Todoist invents a label the first time a task names one, in plain grey.
function labelOps(snap: Snapshot): Op[] {
  const ops: Op[] = [];
  for (const [name, color] of sortBy(Object.entries(LABEL_COLORS), ([n]) => [n])) {
    const have = snap.labels[name];
    if (!have || have.color !== color) {
      ops.push({ kind: "SetLabel", id: have?.id ?? null, name, color });
    }
  }
  return ops;
}

// Keep every description current, and delete what stays empty past the grace.
//
// A task completed by this same run still counts as occupying its section --
// the snapshot was taken before it closed -- so the clock starts one poll late.
function cleanupOps(items: Item[], snap: Snapshot, refs: Refs, today: Day, grace: number): Op[] {
  const live = new Set(snap.occupied);
  const wanted = new Map<string, string>();
  for (const item of items) {
    const project = refs.project(item);
    if (project.kind === "existing") {
      live.add(project.id);
      if (item.ownerIsOrg) wanted.set(project.id, projectDescription(item));
    }
    const section = refs.existingSection(item);
    if (section) {
      live.add(section.id);
      wanted.set(section.id, sectionDescription(item));
    }
  }

  const ops: Op[] = [];
  const gone = new Set<string>();

  const decide = (collection: Collection, info: ProjectInfo | SectionInfo) => {
    const since = snap.emptySince[info.id];
    if (live.has(info.id)) {
      if (since) ops.push({ kind: "MarkEmpty", id: info.id, since: null });
    } else if (!since) {
      ops.push({ kind: "MarkEmpty", id: info.id, since: today });
    } else if (daysBetween(since, today) >= grace) {
      ops.push({ kind: "Delete", id: info.id, collection, name: info.name });
      gone.add(info.id);
      return;
    }
    // A stale container has no item to rebuild from, so its own text stands.
    const want = wanted.get(info.id);
    if (want && want !== info.description) {
      ops.push({ kind: "SetDescription", id: info.id, collection, description: want });
    }
  };

  for (const project of sortBy(Object.values(snap.orgs), (p) => [p.id])) {
    decide("projects", project);
  }
  for (const section of sortBy(snap.sections.values(), (s) => [s.id])) {
    // Deleting the project takes the section anyway.
    if (!gone.has(section.projectId)) decide("sections", section);
  }
  return ops;
}

export interface ReconcileOptions {
  cap?: number;
  grace?: number;
  today?: Day;
  discarded?: Set<string>;
}

export function reconcile(items: Item[], snap: Snapshot, options: ReconcileOptions = {}): Op[] {
  const { cap = COMPLETE_CAP, grace = GRACE_DAYS, discarded = new Set<string>() } = options;
  const refs = new Refs(snap);
  const waits = closure(items, "blockedBy");
  const frees = closure(items, "blocking");
  return [
    ...(snap.root ? [] : [{ kind: "CreateRoot" } as const]),
    ...labelOps(snap),
    ...orgOps(items, snap),
    ...sectionOps(items, refs),
    ...taskOps(items, snap, refs, waits, frees),
    ...orderOps(items, snap, waits, frees),
    ...completionOps(items, snap, cap, discarded),
    ...cleanupOps(items, snap, refs, options.today ?? localToday(), grace),
  ];
}
