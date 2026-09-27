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
  { header: "template", value: (r) => r.name, shrink: 3 },
  { header: "every", value: (r) => r.every, color: () => color.muted },
  { header: "next", value: (r) => r.next ?? "", min: 10 },
  { header: "made", value: (r) => String(r.made), align: "right" },
  {
    header: "status",
    value: (r) => r.status,
    color: (r) => (r.ok ? (r.status === "ok" ? color.ok : color.muted) : color.error),
    shrink: 4,
  },
];

export const occurrenceColumns: Column<OccurrenceRow>[] = [
  { header: "n", value: (r) => (r.n === null ? "-" : String(r.n)), align: "right" },
  { header: "title", value: (r) => r.title, shrink: 4 },
  { header: "deadline", value: (r) => r.deadline, min: 10 },
  { header: "due", value: (r) => r.due ?? "", color: () => color.muted },
  { header: "appears", value: (r) => r.appears, color: () => color.muted },
  { header: "status", value: (r) => r.status, color: (r) => statusColor[r.status] },
];
