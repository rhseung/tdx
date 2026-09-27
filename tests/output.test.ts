// What reaches stdout outside a terminal: the launchd log and pipes.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Output, outputOf, printJson, showTable } from "../src/ui/output.tsx";
import { Progress, withProgress } from "../src/ui/progress.tsx";

let written: string[] = [];
const original = process.stdout.write.bind(process.stdout);
beforeEach(() => {
  written = [];
  // Ink waits for each write's callback before it lets the app exit, so the
  // stand-in has to call it or withProgress never returns.
  process.stdout.write = ((chunk: string, ...rest: unknown[]) => {
    written.push(String(chunk));
    const done = rest.find((r) => typeof r === "function") as (() => void) | undefined;
    done?.();
    return true;
  }) as typeof process.stdout.write;
});
afterEach(() => {
  process.stdout.write = original;
});

const plain: Output = { mode: "plain", color: false, header: false, pager: false };

test("--json wins over everything else", () => {
  expect(outputOf({ json: true }).mode).toBe("json");
});

test("a pipe gets plain lines and no pager", () => {
  // Under `bun test` stdout is not a terminal, which is the case being tested.
  const output = outputOf({});
  expect(output.mode).toBe(process.stdout.isTTY ? "ink" : "plain");
  expect(outputOf({ pager: false }).pager).toBe(false);
});

test("each settled step is one tab-separated log line with a fixed column count", async () => {
  await withProgress(plain, async (progress) => {
    progress.scope = "recur";
    await progress.step(
      "Plan",
      async () => 3,
      (n) => `${n} changes`,
    );
    progress.scope = "";
    await progress.step("Read", async () => 0);
  });
  // No trim: an empty last field is a trailing tab, and it is part of the format.
  const lines = written.join("").split("\n").filter(Boolean);
  expect(lines.map((l) => l.split("\t").slice(1))).toEqual([
    ["ok", "recur", "Plan", "3 changes"],
    ["ok", "", "Read", ""],
  ]);
});

test("a failed step logs its error and rethrows", async () => {
  const progress = new Progress(plain);
  await expect(
    progress.step("Apply", async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(written.join("")).toContain("fail\t\tApply\tboom");
  expect(progress.steps[0]?.state).toBe("failed");
});

test("a live counter only touches the running step", async () => {
  const progress = new Progress(plain);
  let seen = "";
  await progress.step("Apply", async () => {
    progress.note("1/2");
    seen = progress.steps[0]?.detail ?? "";
  });
  progress.note("ignored");
  expect(seen).toBe("1/2");
  expect(progress.steps[0]?.detail).toBe("");
});

const table = {
  columns: [{ header: "name", value: (r: { id: string; name: string }) => r.name }],
  rows: [
    { id: "a", name: "화학" },
    { id: "b", name: "퀴즈" },
  ],
  id: (r: { id: string }) => r.id,
  json: (r: { id: string; name: string }) => r,
};

test("a table in plain mode is one id-first line per row", async () => {
  await showTable(table, plain);
  expect(written.join("")).toBe("a\t화학\nb\t퀴즈\n");
});

test("a table in json mode is the rows as JSON", async () => {
  await showTable(table, { ...plain, mode: "json" });
  expect(JSON.parse(written.join(""))).toEqual(table.rows);
  written = [];
  printJson({ x: 1 });
  expect(JSON.parse(written.join(""))).toEqual({ x: 1 });
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");

test("at a terminal a table that fits is printed once, header first", async () => {
  await showTable({ ...table, title: "Templates" }, { ...plain, mode: "ink" });
  const lines = strip(written.join("")).split("\n").filter(Boolean);
  expect(lines[0]).toBe("Templates");
  expect(lines[1]).toContain("NAME");
  expect(lines.slice(2).map((l) => l.trim())).toEqual(["화학", "퀴즈"]);
});

test("an empty table says so instead of printing a bare header", async () => {
  await showTable({ ...table, rows: [], empty: "no templates yet" }, { ...plain, mode: "ink" });
  expect(strip(written.join(""))).toContain("no templates yet");
});

test("at a terminal the steps and the result stay on screen when the run ends", async () => {
  await withProgress({ ...plain, mode: "ink" }, async (progress) => {
    await progress.step(
      "Plan",
      async () => 2,
      (n) => `${n} changes`,
    );
    progress.show("all done");
  });
  const screen = strip(written.join(""));
  expect(screen).toContain("✓ Plan 2 changes");
  expect(screen).toContain("all done");
});
