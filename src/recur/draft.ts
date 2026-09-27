// What the form edits: a template as a person thinks of it, not as text.
//
// The form never writes a description of its own. It builds a Rule and hands
// it to format(), so a template saved from the TUI is byte for byte what the
// parser reads back -- and what the phone app shows.

import { addDays, type Day, today as localToday, weekday } from "../core/day.ts";
import type { Api } from "../core/http.ts";
import { t } from "../i18n/index.ts";
import { createdId } from "./io.ts";
import type { Checked } from "./plan.ts";
import { DEFAULT_LEAD, type Every, format, parse, type Rule } from "./rule.ts";

export interface Draft {
  title: string;
  mode: "weekly" | "monthly";
  interval: number;
  weekdays: number[];
  monthDay: number;
  from: Day;
  until: Day | null;
  skip: Day[];
  lead: number;
  due: number | null;
  project: string | null;
  section: string | null;
  labels: string[];
  priority: number; // as the API counts: 4 is p1, 1 is p4
  subtasks: string[];
  notes: string;
}

export function blankDraft(today: Day = localToday()): Draft {
  // A week from today is the likeliest first deadline for something new.
  const from = addDays(today, 7);
  return {
    title: "",
    mode: "weekly",
    interval: 1,
    weekdays: [weekday(from)],
    monthDay: Number(from.slice(8)),
    from,
    until: null,
    skip: [],
    lead: DEFAULT_LEAD,
    due: null,
    project: null,
    section: null,
    labels: [],
    priority: 1,
    subtasks: [],
    notes: "",
  };
}

export function draftOf(checked: Checked): Draft {
  const { template, rule, notes } = checked;
  const base = blankDraft();
  const every: Every | undefined = rule?.every;
  return {
    ...base,
    title: template.content,
    ...(rule
      ? {
          from: rule.from,
          until: rule.until,
          skip: rule.skip,
          lead: rule.lead,
          due: rule.due,
          project: rule.project,
          section: rule.section,
        }
      : {}),
    ...(every?.kind === "weekly"
      ? { mode: "weekly" as const, interval: every.interval, weekdays: every.weekdays }
      : {}),
    ...(every?.kind === "monthly"
      ? { mode: "monthly" as const, interval: every.interval, monthDay: every.day }
      : {}),
    labels: template.labels,
    priority: template.priority,
    subtasks: template.children.map((c) => c.content),
    notes,
  };
}

export function ruleOf(draft: Draft): Rule {
  return {
    every:
      draft.mode === "weekly"
        ? { kind: "weekly", interval: draft.interval, weekdays: [...draft.weekdays].sort() }
        : { kind: "monthly", interval: draft.interval, day: draft.monthDay },
    from: draft.from,
    until: draft.until,
    skip: [...new Set(draft.skip)].sort(),
    lead: draft.lead,
    due: draft.due,
    project: draft.project,
    section: draft.section,
  };
}

export const TITLE_EMPTY = t.form.titleEmpty;

// Run through the same parser the scheduler uses, so the form can only save
// what the scheduler will accept.
export function validate(draft: Draft): string[] {
  const errors: string[] = [];
  if (!draft.title.trim()) errors.push(TITLE_EMPTY);
  if (draft.mode === "weekly" && !draft.weekdays.length) errors.push(t.form.noWeekday);
  const parsed = parse(format(ruleOf(draft)));
  return [...errors, ...parsed.errors];
}

export interface Saved {
  id: string;
  created: boolean;
}

// Creates the template, or updates it in place. Subtasks are matched by
// title: kept ones stay (with their own labels and history), missing ones go,
// new ones are added at the end.
export async function saveDraft(
  api: Api,
  draft: Draft,
  target: {
    templatesProjectId: string;
    existing?: Checked | undefined;
    // Personal labels already there; a new name becomes one, as typing it in
    // the Todoist app would -- the API alone leaves it a bare shared label.
    personalLabels?: string[];
  },
): Promise<Saved> {
  const known = new Set(target.personalLabels ?? []);
  for (const name of draft.labels) {
    if (!known.has(name)) await api.post("/labels", { name });
  }
  const description = format(ruleOf(draft), draft.notes);
  const content = draft.title.trim();
  const existing = target.existing?.template;
  let id: string;
  if (existing) {
    id = existing.id;
    await api.post(`/tasks/${id}`, {
      content,
      description,
      labels: draft.labels,
      priority: draft.priority,
    });
  } else {
    id = createdId(
      await api.post("/tasks", {
        content,
        description,
        labels: draft.labels,
        priority: draft.priority,
        project_id: target.templatesProjectId,
      }),
    );
  }

  const wanted = draft.subtasks.map((s) => s.trim()).filter(Boolean);
  const have = existing?.children ?? [];
  for (const child of have) {
    if (!wanted.includes(child.content)) await api.delete(`/tasks/${child.id}`);
  }
  const kept = new Set(have.map((c) => c.content));
  for (const subtask of wanted) {
    if (!kept.has(subtask)) await api.post("/tasks", { content: subtask, parent_id: id });
  }
  return { id, created: !existing };
}
