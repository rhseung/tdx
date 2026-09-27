// How a command's result reaches the reader: an Ink screen for a person at a
// terminal, JSON for a script, and tab-separated lines for a pipe into fzf or
// a launchd log -- where a spinner's control codes would only pile up as junk.

import chalk from "chalk";
import { render, renderToString, Text } from "ink";
import type { ReactElement } from "react";
import { type Column, StickyTable, Table } from "./Table.tsx";

export type Mode = "ink" | "json" | "plain";

export interface Output {
  mode: Mode;
  color: boolean;
  header: boolean;
  pager: boolean;
}

export interface OutputFlags {
  json?: boolean;
  color?: string;
  header?: boolean;
  pager?: boolean;
}

export function outputOf(flags: OutputFlags = {}): Output {
  const tty = Boolean(process.stdout.isTTY);
  const mode: Mode = flags.json ? "json" : tty ? "ink" : "plain";
  const colorFlag = flags.color ?? "auto";
  const color = colorFlag === "always" || (colorFlag === "auto" && tty);
  // chalk decides on its own from the stream; the flag has to win over that,
  // or `--color always | fzf --ansi` would arrive colourless.
  chalk.level = color ? (Math.max(chalk.level, 1) as 1 | 2 | 3) : 0;
  // Interaction needs both ends of the terminal: a pager reading keys from a
  // pipe would hang, and Bun's raw mode on non-TTY stdin throws.
  const pager = flags.pager !== false && tty && Boolean(process.stdin.isTTY);
  return { mode, color, header: Boolean(flags.header), pager };
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printStatic(element: ReactElement): void {
  process.stdout.write(`${renderToString(element, { columns: process.stdout.columns || 100 })}\n`);
}

// Rendered in the alternate screen, so leaving it gives the terminal back as
// it was -- the same contract as less.
export async function runScreen(element: ReactElement): Promise<void> {
  const app = render(element, { alternateScreen: true, exitOnCtrlC: true });
  await app.waitUntilExit();
}

const hex = (value: string | undefined) =>
  value?.startsWith("#") ? chalk.hex(value) : value ? (chalk[value as "red"] ?? chalk) : chalk;

export interface TableOutput<R> {
  columns: Column<R>[];
  rows: R[];
  id: (row: R) => string;
  json: (row: R) => unknown;
  title?: string | undefined;
  empty?: string;
}

// The first field is always the id, so `cut -f1` or fzf's {1} gets something
// the next command accepts.
export function plainLines<R>(table: TableOutput<R>, output: Output): string[] {
  const lines = table.rows.map((row) =>
    [
      table.id(row),
      ...table.columns.map((c) => {
        const text = c.value(row).replace(/[\t\n]/g, " ");
        return output.color ? hex(c.color?.(row))(text) : text;
      }),
    ].join("\t"),
  );
  if (!output.header) return lines;
  return [["ID", ...table.columns.map((c) => c.header.toUpperCase())].join("\t"), ...lines];
}

export async function showTable<R>(table: TableOutput<R>, output: Output): Promise<void> {
  if (output.mode === "json") return printJson(table.rows.map(table.json));
  if (output.mode === "plain") {
    for (const line of plainLines(table, output)) process.stdout.write(`${line}\n`);
    return;
  }
  if (!table.rows.length) {
    printStatic(<Empty text={table.empty ?? "nothing to show"} />);
    return;
  }
  // A table that fits is printed and left in the scrollback, as gh does; only
  // one taller than the screen opens a pager, where the header stays pinned.
  const fits = table.rows.length + 2 + (table.title ? 1 : 0) <= (process.stdout.rows || 24);
  if (fits || !output.pager) {
    printStatic(
      <>
        {table.title ? <Title text={table.title} /> : null}
        <Table columns={table.columns} rows={table.rows} width={process.stdout.columns || 100} />
      </>,
    );
    return;
  }
  await runScreen(<StickyTable columns={table.columns} rows={table.rows} title={table.title} />);
}

function Title({ text }: { text: string }) {
  return <Text bold>{text}</Text>;
}

function Empty({ text }: { text: string }) {
  return <Text color="gray">{text}</Text>;
}
