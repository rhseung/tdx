// What reaches stdout outside a terminal: the launchd log and pipes.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { type Output, outputOf, printJson, tableOutcome } from "../src/ui/output.tsx";
import { Progress } from "../src/ui/progress.tsx";
import { Run } from "../src/ui/run.tsx";

let written: string[] = [];
let logged: string[] = [];
const original = process.stdout.write.bind(process.stdout);
const originalErr = process.stderr.write.bind(process.stderr);
beforeEach(() => {
  written = [];
  logged = [];
  process.stderr.write = ((chunk: string) => {
    logged.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
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
  process.stderr.write = originalErr;
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
// Run unmounts when it is done, and the testing library then records an empty
// frame; what stayed on screen is the last frame that had anything in it.
const settled = (view: { frames: string[] }) => strip(view.frames.findLast((f) => f.trim()) ?? "");
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");

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

test("each settled step is one log line on stderr, with a fixed column count", async () => {
  const progress = new Progress(plain);
  progress.scope = "recur";
  await progress.step(
    "Plan",
    async () => 3,
    (n) => `${n} changes`,
  );
  progress.scope = "";
  await progress.step("Read", async () => 0);
  // No trim: an empty last field is a trailing tab, and it is part of the format.
  const lines = logged.join("").split("\n").filter(Boolean);
  expect(lines.map((l) => l.split("\t").slice(1))).toEqual([
    ["ok", "recur", "Plan", "3 changes"],
    ["ok", "", "Read", ""],
  ]);
  // Data goes to stdout; nothing of the steps may land there.
  expect(written).toEqual([]);
});

test("a failed step logs its error and rethrows", async () => {
  const progress = new Progress(plain);
  await expect(
    progress.step("Apply", async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(logged.join("")).toContain("fail\t\tApply\tboom");
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

test("a table in plain mode is one id-first line per row", () => {
  expect(tableOutcome(table, plain)).toBeNull();
  expect(written.join("")).toBe("a\t화학\nb\t퀴즈\n");
});

test("a table in json mode is the rows as JSON", () => {
  expect(tableOutcome(table, { ...plain, mode: "json" })).toBeNull();
  expect(JSON.parse(written.join(""))).toEqual(table.rows);
  written = [];
  printJson({ x: 1 });
  expect(JSON.parse(written.join(""))).toEqual({ x: 1 });
});

const ink: Output = { ...plain, mode: "ink" };

test("at a terminal a table that fits is the command's last frame, header first", () => {
  const view = render(<>{tableOutcome({ ...table, title: "Templates" }, ink)}</>);
  const lines = strip(view.lastFrame() ?? "").split("\n");
  expect(lines[0]).toBe("Templates");
  expect(lines[1]).toContain("NAME");
  expect(lines.slice(2).map((l) => l.trim())).toEqual(["화학", "퀴즈"]);
});

test("an empty table says so instead of printing a bare header", () => {
  const view = render(<>{tableOutcome({ ...table, rows: [], empty: "no templates yet" }, ink)}</>);
  expect(strip(view.lastFrame() ?? "")).toBe("no templates yet");
});

test("a table taller than the screen becomes a pager instead of a frame", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, name: `row ${i}` }));
  expect(typeof tableOutcome({ ...table, rows }, { ...ink, pager: true })).toBe("function");
  expect(typeof tableOutcome({ ...table, rows }, { ...ink, pager: false })).toBe("object");
});

test("Run draws the steps, then leaves the outcome under them", async () => {
  const view = render(
    <Run
      output={ink}
      failure="failed"
      task={async (progress) => {
        await progress.step(
          "Plan",
          async () => 2,
          (n) => `${n} changes`,
        );
        return <Text>all done</Text>;
      }}
    />,
  );
  await tick();
  const screen = settled(view);
  expect(screen).toContain("✓ Plan 2 changes");
  expect(screen).toContain("all done");
});

test("Run turns a thrown error into an error box and a failing exit code", async () => {
  const before = process.exitCode;
  const view = render(
    <Run
      output={ink}
      failure="sync failed"
      task={async () => {
        throw new Error("no network");
      }}
    />,
  );
  await tick();
  expect(settled(view)).toContain("sync failed");
  expect(settled(view)).toContain("no network");
  expect(process.exitCode).toBe(1);
  // Bun keeps a 1 when given undefined, so an unset code goes back to 0.
  process.exitCode = before ?? 0;
});

test("piped, Run shows nothing and reports a failure on stderr", async () => {
  const before = process.exitCode;
  const view = render(
    <Run
      output={plain}
      failure="sync failed"
      task={async () => {
        throw new Error("no network");
      }}
    />,
  );
  await tick();
  expect(settled(view)).toBe("");
  expect(logged.join("")).toContain("sync failed: no network");
  // Bun keeps a 1 when given undefined, so an unset code goes back to 0.
  process.exitCode = before ?? 0;
});
