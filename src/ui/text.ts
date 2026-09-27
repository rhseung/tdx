// Width-aware text: a Korean syllable takes two terminal cells, and every
// column, pad and cut in the UI has to count it that way or the table tears.

import cliTruncate from "cli-truncate";
import stringWidth from "string-width";

export const width = (text: string): number => stringWidth(text);

export type Align = "left" | "right";

// One line, exactly `cells` wide: cut with an ellipsis when too long, padded
// when too short. Newlines would break the one-row-per-line promise the table
// relies on, so they are flattened first.
export function fit(text: string, cells: number, align: Align = "left"): string {
  if (cells <= 0) return "";
  const flat = text.replace(/\s*\n\s*/g, " ");
  const cut = width(flat) > cells ? cliTruncate(flat, cells, { position: "end" }) : flat;
  const pad = " ".repeat(Math.max(0, cells - width(cut)));
  return align === "right" ? pad + cut : cut + pad;
}

export interface ColumnSpec {
  header: string;
  min?: number;
  max?: number;
  // How readily this column gives up width when the terminal is too narrow.
  // Titles take the cut; short ids and dates barely should.
  shrink?: number;
  align?: Align;
}

export const GAP = 2;

// Each column gets what its widest cell needs; if that overflows, width is
// taken one cell at a time from whichever column can best afford it.
export function fitColumns(columns: ColumnSpec[], rows: string[][], total: number): number[] {
  const widths = columns.map((column, i) => {
    const natural = Math.max(width(column.header), ...rows.map((row) => width(row[i] ?? "")));
    return Math.min(natural, column.max ?? Number.POSITIVE_INFINITY);
  });
  let excess = widths.reduce((a, b) => a + b, 0) + GAP * (columns.length - 1) - total;
  while (excess > 0) {
    let pick = -1;
    let best = 0;
    for (const [i, column] of columns.entries()) {
      const room = (widths[i] ?? 0) - (column.min ?? Math.min(3, width(column.header)));
      const score = room * (column.shrink ?? 1);
      if (room > 0 && score > best) {
        best = score;
        pick = i;
      }
    }
    if (pick < 0) break;
    widths[pick] = (widths[pick] ?? 0) - 1;
    excess--;
  }
  return widths;
}
