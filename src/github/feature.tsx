// `tdx gh sync`: bring Todoist in line with GitHub.

import * as todoist from "../core/todoist.ts";
import type { OpRow } from "../ui/parts.tsx";
import type { Progress } from "../ui/progress.tsx";
import { apply, snapshot } from "./apply.ts";
import * as gh from "./gh.ts";
import { COMPLETE_CAP, GRACE_DAYS, type Op, reconcile } from "./reconcile.ts";
import { load, migrateLegacy, save } from "./state.ts";

export interface SyncOptions {
  dryRun?: boolean;
  force?: boolean;
  grace?: number;
}

// "[#42](https://...) fix thing" reads as "#42 fix thing" in a terminal.
const plain = (content: string) => content.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

export function describeOp(op: Op): OpRow {
  switch (op.kind) {
    case "CreateRoot":
      return { change: "create", verb: "project", text: "GitHub" };
    case "CreateOrgProject":
      return { change: "create", verb: "project", text: op.name };
    case "RenameProject":
      return { change: "update", verb: "project", text: op.name };
    case "CreateSection":
      return { change: "create", verb: "section", text: op.name };
    case "RenameSection":
      return { change: "update", verb: "section", text: op.name };
    case "CreateTask":
      return { change: "create", verb: "task", text: plain(op.content) };
    case "UpdateTask":
      return { change: "update", verb: "task", text: plain(op.content) };
    case "MoveTask":
      return { change: "move", verb: "task", text: op.id };
    case "ReorderTasks":
      return { change: "meta", verb: "reorder", text: `${op.ghIds.length} tasks` };
    case "CompleteTask":
      return { change: "complete", verb: "task", text: plain(op.content) };
    case "DeleteTask":
      return { change: "remove", verb: "task", text: plain(op.content) };
    case "SetDescription":
      return { change: "meta", verb: "describe", text: op.description };
    case "Delete":
      return { change: "remove", verb: op.collection.slice(0, -1), text: op.name };
    case "MarkEmpty":
      return { change: "meta", verb: op.since ? "empty" : "refilled", text: op.id };
    case "SetLabel":
      return { change: "meta", verb: "label", text: `@${op.name} ${op.color}` };
  }
}

export async function syncGithub(progress: Progress, options: SyncOptions = {}) {
  const { dryRun = false, force = false, grace = GRACE_DAYS } = options;
  migrateLegacy();
  const state = load();

  // GitHub is read first and on its own: if it fails, nothing is written, so a
  // degraded response can never be mistaken for "all my work is done".
  const hub = gh.client();
  const { items, discarded } = await progress.step(
    "Read GitHub",
    async () => {
      const items = await gh.relations(hub, await gh.desired(hub));
      const goal = new Set(items.map((i) => i.ghId));
      const gone = Object.keys(state.tasks).filter((id) => !goal.has(id));
      return { items, discarded: await gh.discarded(hub, gone) };
    },
    ({ items }) => `${items.length} items`,
  );

  const api = todoist.client();
  const snap = await progress.step(
    "Read Todoist",
    () => snapshot(api, state),
    (s) => `${Object.keys(s.tasks).length} tasks tracked`,
  );

  const ops = await progress.step(
    "Plan",
    async () =>
      reconcile(items, snap, {
        cap: force ? Number.POSITIVE_INFINITY : COMPLETE_CAP,
        grace,
        discarded,
      }),
    (ops) => (ops.length ? `${ops.length} changes` : "up to date"),
  );

  if (!dryRun) {
    await progress.step(
      "Apply",
      () => apply(api, state, ops, save, (_, i) => progress.note(`${i + 1}/${ops.length}`)),
      () => `${ops.length} applied`,
    );
  }

  const summary = `${items.length} github items, ${ops.length} ops${dryRun ? " (dry run)" : ""}`;
  return { ops: ops.map(describeOp), summary, items: items.length, raw: ops };
}
