import { type Command, Option } from "commander";
import { Box, Text } from "ink";
import { type Output, printStatic } from "./output.tsx";
import { countChanges, ErrorBox, OpList, type OpRow, Summary } from "./parts.tsx";
import { color, symbol } from "./theme.ts";

// Every command that prints takes the same four switches, so a script or an
// fzf binding can rely on them without reading each command's help.
export function withOutput(command: Command): Command {
  return command
    .option("--json", "print JSON instead of a table")
    .addOption(
      new Option("--color <when>", "colour in plain output").choices(["auto", "always", "never"]),
    )
    .option("--header", "put a header line on plain output (fzf --header-lines=1)")
    .option("--no-pager", "print long tables instead of opening a scrolling view");
}

export function fail(output: Output, title: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (output.mode === "ink") printStatic(<ErrorBox title={title} message={message} />);
  else process.stderr.write(`${title}: ${message}\n`);
  process.exit(1);
}

export function Result({
  ops,
  summary,
  dryRun,
}: {
  ops: OpRow[];
  summary?: string;
  dryRun?: boolean;
}) {
  if (!ops.length) {
    return (
      <Text color={color.ok}>
        {symbol.ok} {summary ?? "nothing to change"}
      </Text>
    );
  }
  return (
    <Box flexDirection="column" gap={1}>
      <OpList ops={ops} />
      <Summary
        parts={[
          ...(dryRun ? [["dry run", color.warn] as [string, string]] : []),
          ...countChanges(ops),
        ]}
      />
    </Box>
  );
}

export function printOps(ops: OpRow[]) {
  for (const op of ops) process.stdout.write(`${op.change}\t${op.verb}\t${op.text}\n`);
}

// `-` in place of ids reads them from stdin, one per line, taking the first
// tab-separated field -- so a line picked in fzf from any tdx list works as is.
export async function readIds(args: string[]): Promise<string[]> {
  if (args.length !== 1 || args[0] !== "-") return args;
  const text = await Bun.stdin.text();
  return text
    .split("\n")
    .map((line) => line.split("\t")[0]?.trim() ?? "")
    .filter(Boolean);
}
