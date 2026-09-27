import { t } from "../i18n/index.ts";
import type { Column } from "../ui/table.tsx";
import { color } from "../ui/theme.ts";
import type { OccurrenceRow, TemplateRow } from "./feature.tsx";

const statusColor: Record<string, string> = {
  created: color.ok,
  planned: color.accent,
  skipped: color.muted,
  past: color.muted,
};

export const templateColumns: Column<TemplateRow>[] = [
  { header: t.recur.templateColumns.template, value: (r) => r.name, shrink: 3 },
  { header: t.recur.templateColumns.every, value: (r) => r.every, color: () => color.muted },
  { header: t.recur.templateColumns.next, value: (r) => r.next ?? "", min: 10 },
  { header: t.recur.templateColumns.made, value: (r) => String(r.made), align: "right" },
  {
    header: t.recur.templateColumns.status,
    // A broken template's status is its error, already a sentence.
    value: (r) => (r.ok ? (t.recur.status[r.status] ?? r.status) : r.status),
    color: (r) => (r.ok ? (r.status === "ok" ? color.ok : color.muted) : color.error),
    shrink: 4,
  },
];

export const occurrenceColumns: Column<OccurrenceRow>[] = [
  {
    header: t.recur.occurrenceColumns.n,
    value: (r) => (r.n === null ? "-" : String(r.n)),
    align: "right",
  },
  { header: t.recur.occurrenceColumns.title, value: (r) => r.title, shrink: 4 },
  { header: t.recur.occurrenceColumns.deadline, value: (r) => r.deadline, min: 10 },
  { header: t.recur.occurrenceColumns.due, value: (r) => r.due ?? "", color: () => color.muted },
  { header: t.recur.occurrenceColumns.appears, value: (r) => r.appears, color: () => color.muted },
  {
    header: t.recur.occurrenceColumns.status,
    value: (r) => t.recur.status[r.status] ?? r.status,
    color: (r) => statusColor[r.status],
  },
];
