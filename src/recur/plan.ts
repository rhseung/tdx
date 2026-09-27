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
  // template id -> where its tasks were last put. Only a change against this
  // moves anything, and only tasks still sitting there: a task moved by hand
  // was placed on purpose.
  placed: Record<string, Place>;
}

export const emptyRecurState = (): RecurState => ({ created: {}, reported: {}, placed: {} });

// Where a task goes. Always a real project id, the Inbox included, so two
// places compare by value: "no project" and "the Inbox" are the same place.
interface Place {
  projectId: string;
  sectionId: string | null;
}

const samePlace = (a: Place, b: Place) =>
  a.projectId === b.projectId && a.sectionId === b.sectionId;

// Names to ids, as the planner needs them. Names match without case, the way
// a person types them into a description.
export interface Directory {
  inboxId: string;
  projects: Map<string, string>; // lower-cased name -> id
  sections: Map<string, Map<string, string>>; // project id -> lower-cased name -> id
}

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
      task: NewTask & { place: Place; deadline: Day; due: Day | null };
      subtasks: NewTask[];
    }
  | { kind: "MoveInstance"; templateId: string; taskId: string; content: string; to: Place }
  // Bookkeeping only: where the template's tasks now go.
  | { kind: "SetPlace"; templateId: string; place: Place }
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
  place: Place | null;
}

function resolve(rule: Rule, directory: Directory, errors: string[]): Place | null {
  let projectId = directory.inboxId;
  if (rule.project) {
    const found = directory.projects.get(rule.project.toLowerCase());
    if (!found) {
      errors.push(`project: no project named \`${rule.project}\``);
      return null;
    }
    projectId = found;
  }
  if (!rule.section) return { projectId, sectionId: null };
  const sectionId = directory.sections.get(projectId)?.get(rule.section.toLowerCase());
  if (!sectionId) {
    errors.push(`section: no section named \`${rule.section}\` in ${rule.project ?? "the Inbox"}`);
    return null;
  }
  return { projectId, sectionId };
}

// Parse every template and resolve where its tasks go, so a bad one is
// reported once and every other template still runs.
export function check(templates: TemplateTask[], directory: Directory): Checked[] {
  return templates.map((template) => {
    const { rule, notes, errors } = parse(template.description);
    const place = rule ? resolve(rule, directory, errors) : null;
    return { template, rule: errors.length ? null : rule, notes, errors, place };
  });
}

// Before this was tracked every task went where `project:` said, and with no
// project that was the Inbox; a template without a record is assumed to have
// used that, which is right for every template written before sections.
const previousPlace = (state: RecurState, templateId: string, inboxId: string): Place =>
  state.placed[templateId] ?? { projectId: inboxId, sectionId: null };

// Templates whose tasks are to go somewhere new: only these need their
// existing tasks looked up, so a run where nothing moved costs no extra call.
export function relocated(checked: Checked[], state: RecurState, inboxId: string): Checked[] {
  return checked.filter(
    ({ template, place }) => place && !samePlace(place, previousPlace(state, template.id, inboxId)),
  );
}

// A task this tool made and nobody finished yet, and where it stands; a
// finished task stays where it was finished.
export interface OpenTask extends Place {
  content: string;
}

export function plan(
  checked: Checked[],
  state: RecurState,
  today: Day,
  inboxId: string,
  open: Map<string, OpenTask> = new Map(),
): RecurOp[] {
  const ops: RecurOp[] = [];
  for (const { template, rule, notes, errors, place } of checked) {
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
    if (!rule || !place) {
      report(errors.join("\n"));
      continue;
    }

    const made = state.created[template.id] ?? {};
    const previous = previousPlace(state, template.id, inboxId);
    const moves: RecurOp[] = [];
    if (!samePlace(place, previous)) {
      for (const taskId of Object.values(made)) {
        const at = open.get(taskId);
        if (at && samePlace(at, previous)) {
          moves.push({
            kind: "MoveInstance",
            templateId: template.id,
            taskId,
            content: at.content,
            to: place,
          });
        }
      }
    }
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
          place,
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
    ops.push(...moves, ...due);
    const recorded = state.placed[template.id];
    if (!recorded || !samePlace(recorded, place)) {
      ops.push({ kind: "SetPlace", templateId: template.id, place });
    }
  }
  return ops;
}
