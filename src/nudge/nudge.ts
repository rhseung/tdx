// `tdx nudge`: pull a task whose deadline is close into Today.
//
// A deadline alone never puts a task in Today -- Todoist shows it in
// Upcoming and nowhere else -- so a task with a deadline and no due date can
// sit unseen until the day has passed. This gives such a task a due date of
// today once the deadline is near, and only once: a due date taken off again
// by hand is a decision, and it stays taken off.

import { addDays, type Day, daysBetween, today as localToday } from "../core/day.ts";
import type { Api } from "../core/http.ts";
import { NudgeStateFile, TodoistTask } from "../core/schema.ts";
import { readState, statePath, writeJson } from "../core/state.ts";
import { allPages, client, type Task, toTask } from "../core/todoist.ts";
import type { OpRow } from "../ui/parts.tsx";
import type { Progress } from "../ui/progress.tsx";

export const NUDGE_DAYS = 2;
// More than this at once means something unusual -- a deadline import, a
// wrong clock -- and flooding Today would bury what it is meant to surface.
export const NUDGE_CAP = 20;
// Old entries only guard tasks whose deadline is long gone.
const FORGET_AFTER = 60;

// Tasks with a deadline and without a due date; the window is applied here,
// where "today" is the local calendar day rather than the server's.
export const QUERY = "no date & !no deadline";

export interface NudgeState {
  nudged: Record<string, Day>; // task id -> the day it was given a due date
}

export interface Nudge {
  id: string;
  content: string;
  deadline: Day;
  due: Day;
}

export class NudgeError extends Error {}

export function plan(
  tasks: Task[],
  state: NudgeState,
  today: Day,
  days = NUDGE_DAYS,
  cap = NUDGE_CAP,
): Nudge[] {
  const nudges = tasks
    .filter((t) => t.deadline && !t.due && !state.nudged[t.id])
    .filter((t) => daysBetween(today, t.deadline as Day) <= days)
    .sort((a, b) => ((a.deadline as Day) < (b.deadline as Day) ? -1 : 1))
    .map((t) => ({ id: t.id, content: t.content, deadline: t.deadline as Day, due: today }));
  if (nudges.length > cap) {
    throw new NudgeError(
      `${nudges.length} tasks would move into Today at once (cap ${cap}); run \`tdx nudge run --force\` if that is right`,
    );
  }
  return nudges;
}

export function prune(state: NudgeState, today: Day): void {
  for (const [id, day] of Object.entries(state.nudged)) {
    if (daysBetween(day, today) > FORGET_AFTER) delete state.nudged[id];
  }
}

export function loadState(path = statePath("nudge")): NudgeState {
  return readState(path, NudgeStateFile);
}

export async function candidates(api: Api): Promise<Task[]> {
  return (await allPages(api, "/tasks/filter", TodoistTask, { query: QUERY })).map(toTask);
}

export function describeNudge(n: Nudge): OpRow {
  return { change: "update", verb: "today", text: `${n.content}  deadline ${n.deadline}` };
}

export async function runNudge(
  progress: Progress,
  options: { dryRun?: boolean; days?: number; force?: boolean; today?: Day } = {},
) {
  const today = options.today ?? localToday();
  const api = client();
  const state = loadState();
  const tasks = await progress.step(
    "Read deadlines",
    () => candidates(api),
    (t) => `${t.length} without a due date`,
  );
  const nudges = await progress.step(
    "Plan",
    async () =>
      plan(tasks, state, today, options.days, options.force ? Number.POSITIVE_INFINITY : NUDGE_CAP),
    (n) =>
      n.length
        ? `${n.length} to pull into Today`
        : `nothing due within ${options.days ?? NUDGE_DAYS} days`,
  );
  if (!options.dryRun) {
    await progress.step(
      "Apply",
      async () => {
        try {
          for (const [i, n] of nudges.entries()) {
            await api.post(`/tasks/${n.id}`, { due_date: n.due });
            state.nudged[n.id] = today;
            progress.note(`${i + 1}/${nudges.length}`);
          }
        } finally {
          prune(state, today);
          writeJson(statePath("nudge"), state);
        }
      },
      () => `${nudges.length} applied`,
    );
  }
  const summary = `${nudges.length} pulled into Today${options.dryRun ? " (dry run)" : ""}`;
  return { ops: nudges.map(describeNudge), summary, raw: nudges, tasks, state, today };
}

// For the listing: every task with a deadline and no due date, and when it
// would be pulled in.
export function upcoming(tasks: Task[], state: NudgeState, today: Day, days = NUDGE_DAYS) {
  return tasks
    .filter((t) => t.deadline)
    .sort((a, b) => ((a.deadline as Day) < (b.deadline as Day) ? -1 : 1))
    .map((t) => {
      const deadline = t.deadline as Day;
      const left = daysBetween(today, deadline);
      return {
        id: t.id,
        content: t.content,
        deadline,
        left,
        on: state.nudged[t.id] ? "kept off" : left <= days ? "now" : addDays(deadline, -days),
      };
    });
}
