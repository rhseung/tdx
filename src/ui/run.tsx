// The body of every command: run the work, draw its steps while it runs, and
// leave the outcome on screen when it ends.
//
// Pastel mounts one Ink tree per command and never renders again, so the work
// cannot call render() itself -- a second render on the same stdout replaces
// the tree rather than adding one. Instead the work returns what should be
// shown, and this component shows it.

import { Box, Text, useApp } from "ink";
import { type ReactNode, useEffect, useState } from "react";
import { t } from "../i18n/index.ts";
import type { Output } from "./output.tsx";
import { countChanges, ErrorBox, OpList, type OpRow, Summary } from "./parts.tsx";
import { Progress, ProgressView } from "./progress.tsx";
import { color, symbol } from "./theme.ts";

// A view that stays until the reader leaves it -- a pager, a form -- gets the
// function that ends the command. Anything else is shown and the command ends.
export type Outcome = ReactNode | ((done: () => void) => ReactNode);

export interface RunProps {
  output: Output;
  failure: string;
  task: (progress: Progress) => Promise<Outcome>;
}

export function Run({ output, failure, task }: RunProps) {
  const { exit, waitUntilRenderFlush } = useApp();
  const [progress] = useState(() => new Progress(output));
  const [held, setHeld] = useState<((done: () => void) => ReactNode) | null>(null);

  // Runs once: the task is the command, and a command runs one time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    void (async () => {
      try {
        const outcome = await task(progress);
        if (typeof outcome === "function") {
          setHeld(() => outcome);
          return;
        }
        if (outcome != null && output.mode === "ink") progress.show(outcome);
      } catch (error) {
        process.exitCode = 1;
        const message = error instanceof Error ? error.message : String(error);
        if (output.mode === "ink") progress.show(<ErrorBox title={failure} message={message} />);
        else process.stderr.write(`${failure}: ${message}\n`);
      }
      // Let the last frame land before unmounting, so it is what stays.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await waitUntilRenderFlush();
      exit();
    })();
  }, []);

  if (held) return held(() => exit());
  return output.mode === "ink" ? <ProgressView progress={progress} /> : null;
}

export function Result({
  ops,
  summary,
  dryRun,
}: {
  ops: OpRow[];
  summary?: string | undefined;
  dryRun?: boolean | undefined;
}) {
  if (!ops.length) {
    return (
      <Text color={color.ok}>
        {symbol.ok} {summary ?? t.nothingToChange}
      </Text>
    );
  }
  return (
    <Box flexDirection="column" gap={1}>
      <OpList ops={ops} />
      <Summary
        parts={[
          ...(dryRun ? [[t.dryRun, color.warn] as [string, string]] : []),
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
