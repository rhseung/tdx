// How a command's result reaches the reader: an Ink screen for a person at a
// terminal, JSON for a script, and tab-separated lines for a pipe into fzf or
// a launchd log -- where a spinner's control codes would only pile up as junk.

import chalk from "chalk";
import { Box, Text } from "ink";
import { t } from "../i18n/index.ts";
import { AlternateScreen } from "./alternate-screen.tsx";
import type { Outcome } from "./run.tsx";
import { type Column, StickyTable, Table } from "./table.tsx";

type Mode = "ink" | "json" | "plain";

export interface Output {
  mode: Mode;
  color: boolean;
  header: boolean;
  pager: boolean;
}

export interface OutputFlags {
  json?: boolean | undefined;
  color?: string | undefined;
  header?: boolean | undefined;
  pager?: boolean | undefined;
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

// JSON and plain lines are written straight away; at a terminal the table is
// what the command leaves on screen. One that fits is printed and stays in the
// scrollback, as gh does; one taller than the screen opens a pager, where the
// header stays pinned.
export function tableOutcome<R>(table: TableOutput<R>, output: Output): Outcome {
  if (output.mode === "json") {
    printJson(table.rows.map(table.json));
    return null;
  }
  if (output.mode === "plain") {
    for (const line of plainLines(table, output)) process.stdout.write(`${line}\n`);
    return null;
  }
  if (!table.rows.length) return <Text color="gray">{table.empty ?? t.nothingToShow}</Text>;
  const fits = table.rows.length + 2 + (table.title ? 1 : 0) <= (process.stdout.rows || 24);
  if (fits || !output.pager) {
    return (
      <Box flexDirection="column">
        {table.title ? <Text bold>{table.title}</Text> : null}
        <Table columns={table.columns} rows={table.rows} width={process.stdout.columns || 100} />
      </Box>
    );
  }
  // The screen ends the command itself, once the terminal is back as it was.
  return () => (
    <AlternateScreen>
      {(close) => (
        <StickyTable
          columns={table.columns}
          rows={table.rows}
          title={table.title}
          onQuit={() => close()}
        />
      )}
    </AlternateScreen>
  );
}
