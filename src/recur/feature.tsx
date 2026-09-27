// `tdx recur`: assignments that come out on a schedule.

import { type Day, today as localToday } from "../core/day.ts";
import type { Api } from "../core/http.ts";
import * as todoist from "../core/todoist.ts";
import { t } from "../i18n/index.ts";
import type { OpRow } from "../ui/parts.tsx";
import type { Progress } from "../ui/progress.tsx";
import { applyOps, directory, loadState, openTasks, readWorkspace } from "./io.ts";
import { type Checked, check, plan, type RecurOp, type RecurState, toSync } from "./plan.ts";
import {
  appearsOn,
  describeEvery,
  dueFor,
  nextOccurrence,
  occurrences,
  take,
  title,
} from "./rule.ts";

// SetPlace is bookkeeping with nothing to show.
function describeRecurOp(op: RecurOp): OpRow | null {
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
    case "MoveInstance":
      return { change: "move", verb: "task", text: op.content };
    case "SyncInstance":
      return Object.keys(op.patch).length
        ? { change: "update", verb: "task", text: op.content }
        : null;
    case "DeleteInstance":
      return { change: "remove", verb: "task", text: op.content };
    case "KeepInstance":
      return { change: "meta", verb: "kept", text: `${op.content}  ${t.recur.kept}` };
    case "SetPlace":
    case "SetSynced":
      return null;
  }
}

export async function runRecur(
  progress: Progress,
  options: { dryRun?: boolean | undefined; ids?: string[]; today?: Day; api?: Api } = {},
) {
  const today = options.today ?? localToday();
  const api = options.api ?? todoist.client();
  const state = loadState();
  const workspace = await progress.step(
    t.steps.readTemplates,
    () => readWorkspace(api),
    (w) =>
      w.templatesProject ? t.detail.templates(w.templates.length) : t.detail.noTemplatesProject,
  );
  const only = options.ids?.length ? new Set(options.ids) : null;
  const names = directory(workspace);
  const checked = check(
    workspace.templates.filter((t) => !only || only.has(t.id)),
    names,
  );
  const moving = toSync(checked, state, names.inboxId);
  const open = moving.length
    ? await progress.step(t.steps.readMade, () =>
        openTasks(
          api,
          moving.flatMap((c) => Object.values(state.created[c.template.id] ?? {})),
        ),
      )
    : new Map();
  const ops = await progress.step(
    t.steps.plan,
    async () => plan(checked, state, today, names.inboxId, open),
    (ops) => (ops.length ? t.detail.changes(ops.length) : t.detail.nothingDue),
  );
  if (!options.dryRun && ops.length) {
    await progress.step(
      t.steps.apply,
      () => applyOps(api, state, ops, (_, i) => progress.note(`${i + 1}/${ops.length}`)),
      () => t.detail.applied(ops.length),
    );
  }
  const made = ops.filter((op) => op.kind === "CreateInstance").length;
  const summary = `${t.summary.recur(workspace.templates.length, made)}${options.dryRun ? t.dryRunSuffix : ""}`;
  const shown = ops.map(describeRecurOp).filter((op): op is OpRow => op !== null);
  return { ops: shown, summary, counts: [workspace.templates.length, made], raw: ops };
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
    directory(workspace),
  );
  return { api, workspace, checked, state: loadState() };
}
