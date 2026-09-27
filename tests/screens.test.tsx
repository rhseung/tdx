// The pieces a command's screen is built from.

import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect } from "react";
import { AlternateScreen, type Close } from "../src/ui/alternate-screen.tsx";
import type { OpRow } from "../src/ui/parts.tsx";
import { PickThen } from "../src/ui/pick.tsx";
import { printOps, Result, readIds } from "../src/ui/run.tsx";

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");

function ClosesItself({ close }: { close: Close }) {
  useEffect(() => {
    const timer = setTimeout(() => close(<Text>saved 1 template</Text>), 10);
    return () => clearTimeout(timer);
  }, [close]);
  return <Text>the form</Text>;
}

test("the alternate screen switches before drawing, and back before its last word", async () => {
  const view = render(
    <AlternateScreen>{(close) => <ClosesItself close={close} />}</AlternateScreen>,
  );
  await tick();
  await tick();
  const stream = view.frames.join("");
  const enter = stream.indexOf("\x1b[?1049h");
  const shown = stream.indexOf("the form");
  const leave = stream.indexOf("\x1b[?1049l");
  const after = stream.lastIndexOf("saved 1 template");
  // In order: switch, content, switch back, then what stays in the scrollback.
  expect(enter).toBeGreaterThanOrEqual(0);
  expect(shown).toBeGreaterThan(enter);
  expect(leave).toBeGreaterThan(shown);
  expect(after).toBeGreaterThan(leave);
});

const ops: OpRow[] = [
  { change: "complete", verb: "task", text: "#3 done thing" },
  { change: "create", verb: "task", text: "#1 new thing" },
  { change: "create", verb: "section", text: "rds" },
];

test("a result groups changes by kind and counts them", () => {
  const frame = strip(render(<Result ops={ops} dryRun />).lastFrame() ?? "");
  const lines = frame.split("\n").filter(Boolean);
  // Creates come before completions, whatever order the plan had.
  expect(lines[0]).toContain("#1 new thing");
  expect(lines[2]).toContain("#3 done thing");
  expect(lines.at(-1)).toBe("dry run · 2 created · 1 completed");
});

test("a result with nothing to do says so", () => {
  const frame = strip(render(<Result ops={[]} summary="nothing is due yet" />).lastFrame() ?? "");
  expect(frame).toBe("✓ nothing is due yet");
});

test("a long plan is cut with a count of what was left out", () => {
  const many: OpRow[] = Array.from({ length: 45 }, (_, i) => ({
    change: "update",
    verb: "task",
    text: `task ${i}`,
  }));
  const frame = strip(render(<Result ops={many} />).lastFrame() ?? "");
  expect(frame).toContain("… 5 more");
});

test("ops print as change, verb, text", () => {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    written.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    printOps(ops.slice(0, 1));
  } finally {
    process.stdout.write = original;
  }
  expect(written).toEqual(["complete\ttask\t#3 done thing\n"]);
});

test("ids given as arguments pass straight through", async () => {
  expect(await readIds(["a", "b"])).toEqual(["a", "b"]);
  expect(await readIds([])).toEqual([]);
});

describe("PickThen", () => {
  const choices = [
    { id: "T1", label: "화학 실험" },
    { id: "T2", label: "퀴즈" },
  ];
  const DOWN = "\x1b[B";

  test("one pick by name leads to its view, and the command ends", async () => {
    let ended = false;
    const view = render(
      <PickThen
        choices={choices}
        prompt="Show which?"
        done={() => (ended = true)}
        then={([id]) => <Text>showing {id}</Text>}
      />,
    );
    await tick();
    expect(strip(view.lastFrame() ?? "")).toContain("퀴즈");
    view.stdin.write(DOWN);
    view.stdin.write("\r");
    await tick();
    expect(strip(view.lastFrame() ?? "")).toContain("showing T2");
    expect(ended).toBe(true);
  });

  test("several can be marked and handed over together", async () => {
    let picked: string[] = [];
    const view = render(
      <PickThen
        choices={choices}
        prompt="Delete which?"
        multiple
        done={() => {}}
        then={(ids) => {
          picked = ids;
          return null;
        }}
      />,
    );
    await tick();
    view.stdin.write(" ");
    view.stdin.write(DOWN);
    view.stdin.write(" ");
    await tick();
    view.stdin.write("\r");
    await tick();
    expect(picked).toEqual(["T1", "T2"]);
  });

  test("escape ends the command without picking", async () => {
    let ended = false;
    let called = false;
    const view = render(
      <PickThen
        choices={choices}
        prompt="Show which?"
        done={() => (ended = true)}
        then={() => {
          called = true;
          return null;
        }}
      />,
    );
    await tick();
    view.stdin.write("\x1b");
    await tick();
    expect([ended, called]).toEqual([true, false]);
  });

  test("a failure after the pick shows as an error, with a failing exit code", async () => {
    const before = process.exitCode;
    const view = render(
      <PickThen
        choices={choices}
        prompt="Delete which?"
        done={() => {}}
        then={async () => {
          throw new Error("no network");
        }}
      />,
    );
    await tick();
    view.stdin.write("\r");
    await tick();
    expect(strip(view.lastFrame() ?? "")).toContain("no network");
    expect(process.exitCode).toBe(1);
    process.exitCode = before ?? 0;
  });
});
