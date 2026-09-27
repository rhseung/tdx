// `tdx recur`: assignments that come out on a schedule.

import { type Day, today as localToday } from "../core/day.ts";
import * as todoist from "../core/todoist.ts";
import type { OpRow } from "../ui/parts.tsx";
import type { Progress } from "../ui/progress.tsx";
import { applyOps, byName, loadState, readWorkspace } from "./io.ts";
import { type Checked, check, plan, type RecurOp, type RecurState } from "./plan.ts";
import {
  appearsOn,
  describeEvery,
  dueFor,
  nextOccurrence,
  occurrences,
  take,
  title,
} from "./rule.ts";

function describeRecurOp(op: RecurOp): OpRow {
  switch (op.kind) {
    case "CreateInstance":
      return { change: "create", verb: "task", text: `${op.task.content}  ${op.deadline}` };
    case "ReportError":
      return {
        change: "remove",
        verb: "broken",
        text: `${op.content}: ${op.message.split("\n")[0]}`,
      };
    case "ClearError":
      return { change: "meta", verb: "fixed", text: op.templateId };
  }
}

export async function runRecur(
  progress: Progress,
  options: { dryRun?: boolean | undefined; ids?: string[]; today?: Day } = {},
) {
  const today = options.today ?? localToday();
  const api = todoist.client();
  const state = loadState();
  const workspace = await progress.step(
    "Read templates",
    () => readWorkspace(api),
    (w) => (w.templatesProject ? `${w.templates.length} templates` : "no Templates project yet"),
  );
  const only = options.ids?.length ? new Set(options.ids) : null;
  const checked = check(
    workspace.templates.filter((t) => !only || only.has(t.id)),
    byName(workspace.projects),
  );
  const ops = await progress.step(
    "Plan",
    async () => plan(checked, state, today),
    (ops) => (ops.length ? `${ops.length} changes` : "nothing due"),
  );
  if (!options.dryRun && ops.length) {
    await progress.step(
      "Create",
      () => applyOps(api, state, ops, (_, i) => progress.note(`${i + 1}/${ops.length}`)),
      () => `${ops.length} applied`,
    );
  }
  const made = ops.filter((op) => op.kind === "CreateInstance").length;
  const summary = `${workspace.templates.length} templates, ${made} tasks${options.dryRun ? " (dry run)" : ""}`;
  return { ops: ops.map(describeRecurOp), summary, raw: ops };
}

// --- read-only views ----------------------------------------------------------

export interface TemplateRow {
  id: string;
  name: string;
  every: string;
  next: Day | null;
  made: number;
  status: string;
  ok: boolean;
}

export function templateRows(checked: Checked[], state: RecurState, today: Day): TemplateRow[] {
  return checked.map(({ template, rule, errors }) => {
    const made = Object.keys(state.created[template.id] ?? {}).length;
    if (!rule) {
      return {
        id: template.id,
        name: template.content,
        every: "",
        next: null,
        made,
        status: errors[0] ?? "invalid",
        ok: false,
      };
    }
    const next = nextOccurrence(rule, today);
    return {
      id: template.id,
      name: template.content,
      every: describeEvery(rule.every),
      next: next?.deadline ?? null,
      made,
      status: next ? "ok" : "finished",
      ok: true,
    };
  });
}

type OccurrenceStatus = "created" | "planned" | "skipped" | "past";

export interface OccurrenceRow {
  templateId: string;
  template: string;
  n: number | null;
  title: string;
  deadline: Day;
  due: Day | null;
  appears: Day;
  status: OccurrenceStatus;
}

// Past weeks come along so the numbering reads from 1. One that was never made
// is only "past": it may well predate the template.
export function occurrenceRows(
  checked: Checked[],
  state: RecurState,
  today: Day,
  upcoming = 12,
): OccurrenceRow[] {
  const rows: OccurrenceRow[] = [];
  for (const { template, rule } of checked) {
    if (!rule) continue;
    const made = state.created[template.id] ?? {};
    let ahead = 0;
    for (const occurrence of take(occurrences(rule), 500)) {
      if (occurrence.deadline >= today && ++ahead > upcoming) break;
      const status: OccurrenceStatus = occurrence.skipped
        ? "skipped"
        : made[occurrence.deadline]
          ? "created"
          : occurrence.deadline < today
            ? "past"
            : "planned";
      rows.push({
        templateId: template.id,
        template: template.content,
        n: occurrence.n,
        // A skipped week has no number to fill in, so it keeps the template's name.
        title: occurrence.skipped ? template.content : title(template.content, occurrence),
        deadline: occurrence.deadline,
        due: dueFor(rule, occurrence.deadline),
        appears: appearsOn(rule, occurrence.deadline),
        status,
      });
    }
  }
  return rows;
}

export async function loadChecked(ids?: string[]) {
  const api = todoist.client();
  const workspace = await readWorkspace(api);
  const only = ids?.length ? new Set(ids) : null;
  const checked = check(
    workspace.templates.filter((t) => !only || only.has(t.id)),
    byName(workspace.projects),
  );
  return { api, workspace, checked, state: loadState() };
}
