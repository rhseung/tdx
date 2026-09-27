// What each column of the recur tables shows, and in which colour.

import { expect, test } from "bun:test";
import { occurrenceColumns, templateColumns } from "../src/recur/columns.ts";
import type { OccurrenceRow, TemplateRow } from "../src/recur/feature.tsx";
import { color } from "../src/ui/theme.ts";

const cells = <R>(columns: { value: (r: R) => string }[], row: R) =>
  columns.map((c) => c.value(row));
const tints = <R>(columns: { color?: (r: R) => string | undefined }[], row: R) =>
  columns.map((c) => c.color?.(row));

const template: TemplateRow = {
  id: "T1",
  name: "화학 실험 {n}주차",
  every: "every fri",
  next: "2026-10-02",
  made: 3,
  status: "ok",
  ok: true,
};

test("a template row reads name, rule, next deadline, count and status", () => {
  expect(cells(templateColumns, template)).toEqual([
    "화학 실험 {n}주차",
    "every fri",
    "2026-10-02",
    "3",
    "ok",
  ]);
  expect(tints(templateColumns, template).at(-1)).toBe(color.ok);
});

test("a finished template is muted and a broken one red", () => {
  const status = (row: TemplateRow) => tints(templateColumns, row).at(-1);
  expect(status({ ...template, status: "finished", next: null })).toBe(color.muted);
  expect(status({ ...template, ok: false, status: "`fryday` is not a weekday" })).toBe(color.error);
  expect(cells(templateColumns, { ...template, next: null })[2]).toBe("");
});

const week: OccurrenceRow = {
  templateId: "T1",
  template: "화학 실험 {n}주차",
  n: 5,
  title: "화학 실험 5주차",
  deadline: "2026-10-02",
  due: "2026-09-30",
  appears: "2026-09-27",
  status: "created",
};

test("an occurrence row reads number, title, dates and status", () => {
  expect(cells(occurrenceColumns, week)).toEqual([
    "5",
    "화학 실험 5주차",
    "2026-10-02",
    "2026-09-30",
    "2026-09-27",
    "created",
  ]);
});

test("a skipped week has no number and no due date to show", () => {
  const skipped = { ...week, n: null, due: null, status: "skipped" as const };
  const row = cells(occurrenceColumns, skipped);
  expect([row[0], row[3]]).toEqual(["-", ""]);
  expect(tints(occurrenceColumns, skipped).at(-1)).toBe(color.muted);
});
