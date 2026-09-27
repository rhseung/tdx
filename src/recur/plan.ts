// Which assignment tasks should exist by now, as a pure function of the
// templates, what was already made, and today's date.
//
// The trigger is the calendar, not completion. Todoist's own recurrence only
// makes the next instance when this one is ticked off, but an assignment comes
// out on schedule whether last week's was handed in or not.

import type { Day } from "../core/day.ts";
import { appearsOn, dueFor, occurrences, parse, type Rule, title } from "./rule.ts";

export interface TemplateTask {
  id: string;
  content: string;
  description: string;
  priority: number;
  labels: string[];
  children: (NewTask & { id: string })[];
}

export interface RecurState {
  // template id -> deadline -> task id. A deadline stays here after its task
  // is deleted, which is exactly what keeps a deleted week from coming back.
  created: Record<string, Record<Day, string>>;
  // template id -> hash of the description last reported as broken, so one
  // mistake gets one comment rather than one per poll.
  reported: Record<string, string>;
}

export const emptyRecurState = (): RecurState => ({ created: {}, reported: {} });

// A template asking for more than this at once is far more likely a typo in
// `lead` than a real backlog.
export const CREATE_CAP = 30;

interface NewTask {
  content: string;
  description: string;
  priority: number;
  labels: string[];
}

export type RecurOp =
  | {
      kind: "CreateInstance";
      templateId: string;
      deadline: Day;
      n: number;
      task: NewTask & { projectId: string | null; deadline: Day; due: Day | null };
      subtasks: NewTask[];
    }
  | { kind: "ReportError"; templateId: string; content: string; hash: string; message: string }
  | { kind: "ClearError"; templateId: string };

export function hash(text: string): string {
  return Bun.hash(text).toString(16);
}

export interface Checked {
  template: TemplateTask;
  rule: Rule | null;
  notes: string;
  errors: string[];
  projectId: string | null;
}

// Parse every template and resolve its project, so a bad one is reported
// once and every other template still runs.
export function check(templates: TemplateTask[], projects: Map<string, string>): Checked[] {
  return templates.map((template) => {
    const { rule, notes, errors } = parse(template.description);
    let projectId: string | null = null;
    if (rule?.project) {
      projectId = projects.get(rule.project.toLowerCase()) ?? null;
      if (!projectId) errors.push(`project: no project named \`${rule.project}\``);
    }
    return { template, rule: errors.length ? null : rule, notes, errors, projectId };
  });
}

export function plan(checked: Checked[], state: RecurState, today: Day): RecurOp[] {
  const ops: RecurOp[] = [];
  for (const { template, rule, notes, errors, projectId } of checked) {
    const reported = state.reported[template.id];
    const digest = hash(template.description);
    const report = (message: string) => {
      if (reported === digest) return;
      ops.push({
        kind: "ReportError",
        templateId: template.id,
        content: template.content,
        hash: digest,
        message,
      });
    };
    if (!rule) {
      report(errors.join("\n"));
      continue;
    }

    const made = state.created[template.id] ?? {};
    const due: RecurOp[] = [];
    for (const occurrence of occurrences(rule)) {
      if (appearsOn(rule, occurrence.deadline) > today) break;
      // A deadline already gone is not worth a task: this is what keeps a
      // template written mid-semester from filling the inbox with past weeks.
      if (occurrence.skipped || occurrence.deadline < today || made[occurrence.deadline]) continue;
      due.push({
        kind: "CreateInstance",
        templateId: template.id,
        deadline: occurrence.deadline,
        n: occurrence.n ?? 0,
        task: {
          content: title(template.content, occurrence),
          description: notes,
          priority: template.priority,
          labels: template.labels,
          projectId,
          deadline: occurrence.deadline,
          due: dueFor(rule, occurrence.deadline),
        },
        subtasks: template.children.map((child) => ({
          content: title(child.content, occurrence),
          description: child.description,
          priority: child.priority,
          labels: child.labels,
        })),
      });
    }
    if (due.length > CREATE_CAP) {
      report(`this would create ${due.length} tasks at once (cap ${CREATE_CAP}); check lead:`);
      continue;
    }
    if (reported) ops.push({ kind: "ClearError", templateId: template.id });
    ops.push(...due);
  }
  return ops;
}
