import { Box, Text, useApp, useInput, useStdout, useWindowSize } from "ink";
import { useEffect, useState } from "react";
import { enableMouse, isMouse, wheelDelta } from "./mouse.ts";
import { type ColumnSpec, fit, fitColumns, GAP } from "./text.ts";
import { color } from "./theme.ts";

export interface Column<R> extends ColumnSpec {
  value: (row: R) => string;
  color?: (row: R) => string | undefined;
  dim?: (row: R) => boolean;
}

interface TableProps<R> {
  columns: Column<R>[];
  rows: R[];
  width: number;
  // Which slice of the body to show; the header is drawn regardless, which is
  // what keeps it pinned while the body scrolls.
  offset?: number;
  height?: number;
  cursor?: number;
}

export function Table<R>({ columns, rows, width, offset = 0, height, cursor }: TableProps<R>) {
  const cells = rows.map((row) => columns.map((c) => c.value(row)));
  const widths = fitColumns(columns, cells, width);
  const visible = rows.slice(offset, height === undefined ? undefined : offset + height);
  const gap = " ".repeat(GAP);

  return (
    <Box flexDirection="column">
      <Text bold color={color.muted}>
        {columns.map((c, i) => fit(c.header.toUpperCase(), widths[i] ?? 0, c.align)).join(gap)}
      </Text>
      {visible.map((row, index) => {
        const at = offset + index;
        const selected = cursor === at;
        return (
          <Text key={at} inverse={selected} wrap="truncate-end">
            {columns.map((c, i) => (
              <Text key={c.header} color={c.color?.(row)} dimColor={c.dim?.(row)}>
                {fit(cells[at]?.[i] ?? "", widths[i] ?? 0, c.align)}
                {i < columns.length - 1 ? gap : ""}
              </Text>
            ))}
          </Text>
        );
      })}
    </Box>
  );
}

export interface StickyTableProps<R> {
  columns: Column<R>[];
  rows: R[];
  title?: string;
  // Lines the caller draws around the table, so the body knows how much of the
  // screen is left for it.
  reserved?: number;
  hint?: string;
  onKey?: (input: string, row: R | undefined) => void;
  onSelect?: (row: R) => void;
  onCursor?: (row: R | undefined) => void;
}

export interface View {
  cursor: number;
  offset: number;
}

// Put the cursor on `target` and slide the window just enough to keep it in
// sight, the way less does, rather than recentring on every step.
export function scroll(view: View, target: number, height: number, count: number): View {
  const cursor = Math.max(0, Math.min(count - 1, target));
  let offset = view.offset;
  if (cursor < offset) offset = cursor;
  if (cursor >= offset + height) offset = cursor - height + 1;
  offset = Math.max(0, Math.min(offset, count - height));
  return { cursor: Math.max(0, cursor), offset };
}

// A table that scrolls under a pinned header, like a pager for rows.
//
// Every row is exactly one line (cells are cut, never wrapped), so scrolling
// is only a slice of the row list. No scroll primitive is needed, and none of
// Ink's layout has to be measured after the fact.
export function StickyTable<R>({
  columns,
  rows,
  title,
  reserved = 0,
  hint,
  onKey,
  onSelect,
  onCursor,
}: StickyTableProps<R>) {
  const { exit } = useApp();
  const { columns: screenWidth, rows: screenHeight } = useWindowSize();
  // Title, header and status bar each take a line.
  const height = Math.max(1, screenHeight - (title ? 1 : 0) - 2 - reserved);
  const [view, setView] = useState<View>({ cursor: 0, offset: 0 });
  const { cursor, offset } = view;
  const last = Math.max(0, rows.length - 1);
  const { stdout } = useStdout();

  useEffect(() => enableMouse(stdout), [stdout]);
  useEffect(() => onCursor?.(rows[cursor]), [cursor, rows, onCursor]);

  // Clamp after a resize or a shrinking row list, so the cursor never points
  // past the end and the view never shows a half-empty last page.
  useEffect(() => setView((v) => scroll(v, v.cursor, height, rows.length)), [height, rows.length]);

  // Every move is computed from the latest view, not the one this render
  // closed over: a held-down key delivers several presses between renders,
  // and each has to build on the last.
  const move = (to: (cursor: number) => number) =>
    setView((v) => scroll(v, to(v.cursor), height, rows.length));

  useInput((input, key) => {
    if (isMouse(input)) {
      const delta = wheelDelta(input) * 3;
      if (delta) move((c) => c + delta);
      return;
    }
    if (input === "q" || key.escape) return exit();
    if (input === "j" || key.downArrow) return move((c) => c + 1);
    if (input === "k" || key.upArrow) return move((c) => c - 1);
    if (key.pageDown || input === " " || (key.ctrl && input === "d")) {
      return move((c) => c + height);
    }
    if (key.pageUp || (key.ctrl && input === "u")) return move((c) => c - height);
    if (input === "g" || key.home) return move(() => 0);
    if (input === "G" || key.end) return move(() => last);
    const row = rows[cursor];
    if (key.return && row && onSelect) return onSelect(row);
    onKey?.(input, row);
  });

  const end = Math.min(rows.length, offset + height);
  const position = rows.length ? `${offset + 1}-${end} of ${rows.length}` : "empty";
  return (
    <Box flexDirection="column">
      {title ? <Text bold>{title}</Text> : null}
      <Table
        columns={columns}
        rows={rows}
        width={screenWidth}
        offset={offset}
        height={height}
        cursor={cursor}
      />
      <Text color={color.muted} wrap="truncate-end">
        {offset > 0 ? "↑ " : "  "}
        {end < rows.length ? "↓ " : "  "}
        {position}
        {"   j/k ↑↓ wheel  PgUp/PgDn  g/G  "}
        {hint ? `${hint}  ` : ""}q quit
      </Text>
    </Box>
  );
}
