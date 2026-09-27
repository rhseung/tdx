import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { isMouse, wheelDelta } from "../src/ui/mouse.ts";
import { type Output, plainLines } from "../src/ui/output.tsx";
import { type Column, StickyTable, Table } from "../src/ui/table.tsx";
import { fit, fitColumns, width } from "../src/ui/text.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

interface Row {
  n: number;
  title: string;
}

const columns: Column<Row>[] = [
  { header: "n", value: (r) => String(r.n), align: "right" },
  { header: "title", value: (r) => r.title, shrink: 4 },
];
const rows: Row[] = Array.from({ length: 50 }, (_, i) => ({
  n: i + 1,
  title: `화학 실험 ${i + 1}주차`,
}));

describe("fit", () => {
  test("a Korean syllable counts as two cells", () => {
    expect(width("화학")).toBe(4);
    expect(width(fit("화학 실험 과제", 7))).toBe(7);
  });

  test("a cut line ends in an ellipsis and never spills past its width", () => {
    const cut = fit("화학 실험 과제 3주차", 9);
    expect(cut).toContain("…");
    expect(width(cut)).toBe(9);
  });

  test("newlines are flattened so a row stays one line", () => {
    expect(fit("a\nb", 5)).toBe("a b  ");
  });

  test("the widest-and-most-willing column gives up width first", () => {
    const widths = fitColumns(
      [
        { header: "id", shrink: 1 },
        { header: "title", shrink: 4 },
      ],
      [["12345", "a long title here"]],
      16,
    );
    expect(widths[0]).toBe(5);
    expect((widths[0] ?? 0) + (widths[1] ?? 0) + 2).toBe(16);
  });
});

describe("Table", () => {
  test("static render shows every row under a header", () => {
    const { lastFrame } = render(<Table columns={columns} rows={rows.slice(0, 3)} width={40} />);
    const lines = strip(lastFrame() ?? "").split("\n");
    expect(lines[0]).toContain("TITLE");
    expect(lines).toHaveLength(4);
  });
});

describe("StickyTable", () => {
  const screen = (frame: string | undefined) => strip(frame ?? "").split("\n");

  test("the header stays on the first line while the body scrolls", async () => {
    const view = render(<StickyTable columns={columns} rows={rows} />);
    await tick();
    for (let i = 0; i < 40; i++) view.stdin.write("j");
    await tick();
    const lines = screen(view.lastFrame());
    expect(lines[0]).toContain("TITLE");
    expect(lines.join("\n")).toContain("41주차");
    expect(lines.join("\n")).not.toContain(" 1주차");
    view.unmount();
  });

  test("the wheel scrolls, and its escape codes never reach other handlers", async () => {
    const typed: string[] = [];
    const view = render(
      <StickyTable columns={columns} rows={rows} onKey={(input) => typed.push(input)} />,
    );
    await tick();
    view.stdin.write("\x1b[<65;10;5M");
    view.stdin.write("\x1b[<65;10;5M");
    await tick();
    expect(typed).toEqual([]);
    expect(screen(view.lastFrame()).at(-1)).toContain("↑");
    view.unmount();
  });

  test("G jumps to the last row and the status bar says so", async () => {
    const view = render(<StickyTable columns={columns} rows={rows} />);
    await tick();
    view.stdin.write("G");
    await tick();
    const lines = screen(view.lastFrame());
    expect(lines.join("\n")).toContain("50주차");
    expect(lines.at(-1)).toContain("of 50");
    view.unmount();
  });
});

describe("mouse", () => {
  test("wheel events net out within one chunk", () => {
    expect(wheelDelta("[<65;1;1M\x1b[<65;1;1M\x1b[<64;1;1M")).toBe(1);
    expect(isMouse("[<64;10;5M")).toBe(true);
    expect(isMouse("j")).toBe(false);
  });
});

describe("plain output", () => {
  const output: Output = { mode: "plain", color: false, header: false, pager: false };
  const table = {
    columns,
    rows: rows.slice(0, 2),
    id: (r: Row) => `id${r.n}`,
    json: (r: Row) => r,
  };

  test("each line starts with the id, fields split by tabs, no escape codes", () => {
    const lines = plainLines(table, output);
    expect(lines[0]).toBe("id1\t1\t화학 실험 1주차");
    expect(lines.join("")).not.toContain("\x1b");
  });

  test("--header adds one line for fzf --header-lines=1", () => {
    expect(plainLines(table, { ...output, header: true })[0]).toBe("ID\tN\tTITLE");
  });
});
