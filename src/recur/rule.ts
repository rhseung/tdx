// A template's schedule, written as `key: value` lines in its description.
//
// Todoist has no field for "every Friday until December, except exam week",
// so the rule lives in plain text where the phone app can still edit it. The
// TUI writes the same text through format(), and parse(format(rule)) has to
// give the rule back unchanged -- otherwise an edit in one place would quietly
// rewrite the other.

import { addDays, type Day, daysInMonth, isDay, makeDay, parts, weekday } from "../core/day.ts";
import { t } from "../i18n/index.ts";

export type Every =
  | { kind: "weekly"; interval: number; weekdays: number[] } // 0 = Monday
  | { kind: "monthly"; interval: number; day: number };

export interface Rule {
  every: Every;
  from: Day;
  until: Day | null;
  skip: Day[];
  lead: number; // days before the deadline the task appears
  due: number | null; // days from the deadline; -2 means two days before
  project: string | null; // by name; null is the Inbox
  section: string | null; // by name, inside the project
}

export const DEFAULT_LEAD = 7;

// Rule lines come first; anything after this line is a note copied into each
// task. Without a separator a typo such as `evrey:` would pass as a note and
// the template would silently fall back to defaults.
const NOTES = "---";

// Korean day names too: the syllable is how a timetable writes it.
// biome-ignore format: one weekday per line reads as a table
const WEEKDAYS: Record<string, number> = {
  mon: 0, monday: 0, 월: 0,
  tue: 1, tuesday: 1, 화: 1,
  wed: 2, wednesday: 2, 수: 2,
  thu: 3, thursday: 3, 목: 3,
  fri: 4, friday: 4, 금: 4,
  sat: 5, saturday: 5, 토: 5,
  sun: 6, sunday: 6, 일: 6,
};
const WEEKDAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const KEYS = ["every", "from", "until", "skip", "lead", "due", "project", "section"] as const;

export interface Parsed {
  rule: Rule | null;
  notes: string;
  errors: string[];
}

function parseEvery(text: string): Every | string {
  const words = text.toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
  let interval = 1;
  if (/^\d+$/.test(words[0] ?? "")) interval = Number(words.shift());
  if (interval < 1) return "the interval has to be at least 1";
  if (words[0] === "month" || words[0] === "months") {
    const day = Number(words[1]);
    if (words.length !== 2 || !Number.isInteger(day) || day < 1 || day > 31) {
      return `\`${text}\`: write a monthly rule as \`month 15\` or \`2 months 15\``;
    }
    return { kind: "monthly", interval, day };
  }
  if (words[0] === "week" || words[0] === "weeks") words.shift();
  if (!words.length) return `\`${text}\`: name the weekday, as in \`fri\` or \`2 weeks mon, thu\``;
  const weekdays = new Set<number>();
  for (const word of words) {
    const day = WEEKDAYS[word];
    if (day === undefined) return `\`${word}\` is not a weekday`;
    weekdays.add(day);
  }
  return { kind: "weekly", interval, weekdays: [...weekdays].sort() };
}

function parseDays(text: string, key: string): number | string {
  const match = /^([+-]?\d+)\s*d?$/.exec(text.trim());
  return match ? Number(match[1]) : `${key}: \`${text}\` is not a number of days, as in 5d`;
}

export function parse(description: string): Parsed {
  const lines = description.split("\n");
  const split = lines.findIndex((line) => line.trim() === NOTES);
  const ruleLines = split < 0 ? lines : lines.slice(0, split);
  const notes =
    split < 0
      ? ""
      : lines
          .slice(split + 1)
          .join("\n")
          .trim();

  const errors: string[] = [];
  const values = new Map<string, string>();
  for (const line of ruleLines) {
    if (!line.trim()) continue;
    const match = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
    const key = match?.[1]?.toLowerCase();
    if (!match || !key || !(KEYS as readonly string[]).includes(key)) {
      errors.push(`\`${line.trim()}\` is not one of ${KEYS.join(", ")} (notes go below ${NOTES})`);
      continue;
    }
    values.set(key, match[2] ?? "");
  }

  const everyText = values.get("every");
  const every = everyText ? parseEvery(everyText) : "every: is required, as in `every: fri`";
  if (typeof every === "string") errors.push(every);

  const day = (key: string): Day | null => {
    const text = values.get(key);
    if (!text) return null;
    if (isDay(text)) return text;
    errors.push(`${key}: \`${text}\` is not a date, as in 2026-09-04`);
    return null;
  };
  const from = day("from");
  if (!values.get("from")) errors.push("from: is required, the first deadline, as in 2026-09-04");
  const until = day("until");
  if (from && until && until < from) errors.push("until: comes before from:");

  const skip: Day[] = [];
  for (const text of (values.get("skip") ?? "").split(",").map((s) => s.trim())) {
    if (!text) continue;
    if (isDay(text)) skip.push(text);
    else errors.push(`skip: \`${text}\` is not a date`);
  }

  const leadText = values.get("lead");
  const lead = leadText ? parseDays(leadText, "lead") : DEFAULT_LEAD;
  if (typeof lead === "string") errors.push(lead);
  else if (lead < 0) errors.push("lead: can not be negative");

  const dueText = values.get("due");
  const due = dueText ? parseDays(dueText, "due") : null;
  if (typeof due === "string") errors.push(due);

  if (errors.length || typeof every === "string" || !from || typeof lead === "string") {
    return { rule: null, notes, errors };
  }
  return {
    rule: {
      every,
      from,
      until,
      skip: [...new Set(skip)].sort(),
      lead,
      due: typeof due === "number" ? due : null,
      project: values.get("project") || null,
      section: values.get("section") || null,
    },
    notes,
    errors: [],
  };
}

function formatEvery(every: Every): string {
  const unit = every.kind === "monthly" ? "month" : "week";
  const prefix =
    every.interval > 1 ? `${every.interval} ${unit}s ` : every.kind === "monthly" ? "month " : "";
  if (every.kind === "monthly") return `${prefix}${every.day}`;
  return `${prefix}${every.weekdays.map((d) => WEEKDAY_NAMES[d]).join(", ")}`;
}

const signed = (days: number) => `${days > 0 ? "+" : ""}${days}d`;

export function format(rule: Rule, notes = ""): string {
  const lines = [`every: ${formatEvery(rule.every)}`, `from: ${rule.from}`];
  if (rule.until) lines.push(`until: ${rule.until}`);
  if (rule.skip.length) lines.push(`skip: ${rule.skip.join(", ")}`);
  lines.push(`lead: ${rule.lead}d`);
  if (rule.due !== null) lines.push(`due: ${signed(rule.due)}`);
  if (rule.project) lines.push(`project: ${rule.project}`);
  if (rule.section) lines.push(`section: ${rule.section}`);
  if (notes.trim()) lines.push(NOTES, notes.trim());
  return lines.join("\n");
}

export interface Occurrence {
  deadline: Day;
  n: number | null; // null when skipped: a cancelled week does not use up a number
  skipped: boolean;
}

function* candidates(every: Every, from: Day): Generator<Day> {
  if (every.kind === "weekly") {
    // Weeks are counted from the Monday of `from`, so "2 weeks" keeps its
    // rhythm no matter which weekday the first deadline falls on.
    const monday = addDays(from, -weekday(from));
    for (let week = 0; ; week += every.interval) {
      for (const day of every.weekdays) {
        const date = addDays(monday, week * 7 + day);
        if (date >= from) yield date;
      }
    }
  }
  const start = parts(from);
  for (let step = 0; ; step += every.interval) {
    const month0 = start.month - 1 + step;
    const year = start.year + Math.floor(month0 / 12);
    const month = (month0 % 12) + 1;
    // The 31st of a 30-day month is its last day, not the 1st of the next.
    const date = makeDay(year, month, Math.min(every.day, daysInMonth(year, month)));
    if (date >= from) yield date;
  }
}

// Every deadline the rule produces, in order, skipped ones included so a
// preview can show them. Without `until` this never ends: take what you need.
export function* occurrences(rule: Rule): Generator<Occurrence> {
  const skip = new Set(rule.skip);
  let n = 0;
  for (const deadline of candidates(rule.every, rule.from)) {
    if (rule.until && deadline > rule.until) return;
    if (skip.has(deadline)) yield { deadline, n: null, skipped: true };
    else yield { deadline, n: ++n, skipped: false };
  }
}

export function take<T>(source: Iterable<T>, count: number): T[] {
  const out: T[] = [];
  if (count <= 0) return out;
  for (const item of source) {
    out.push(item);
    if (out.length >= count) break;
  }
  return out;
}

export function nextOccurrence(rule: Rule, today: Day): Occurrence | undefined {
  for (const occurrence of occurrences(rule)) {
    if (!occurrence.skipped && occurrence.deadline >= today) return occurrence;
  }
  return undefined;
}

export function appearsOn(rule: Rule, deadline: Day): Day {
  return addDays(deadline, -rule.lead);
}

export function dueFor(rule: Rule, deadline: Day): Day | null {
  return rule.due === null ? null : addDays(deadline, rule.due);
}

// For reading, in the reader's language. What is written back into a
// template is format(), which stays in the rule's own English keywords.
export function describeEvery(every: Every): string {
  const r = t.recur.every;
  if (every.kind === "monthly") {
    return every.interval > 1 ? r.months(every.interval, every.day) : r.monthly(every.day);
  }
  const days = every.weekdays.map((d) => t.recur.weekdays[d]).join(", ");
  return every.interval > 1 ? r.weeks(every.interval, days) : r.weekly(days);
}

// "{n}" is the occurrence number, "{date}" the deadline as month/day.
export function title(template: string, occurrence: Occurrence): string {
  const { month, date } = parts(occurrence.deadline);
  return template
    .replaceAll("{n}", String(occurrence.n ?? ""))
    .replaceAll("{date}", `${month}/${date}`);
}
