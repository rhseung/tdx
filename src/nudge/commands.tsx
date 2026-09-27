import type { Command } from "commander";
import { today } from "../core/day.ts";
import { recordRun } from "../core/features.ts";
import { client } from "../core/todoist.ts";
import { fail, printOps, Result, withOutput } from "../ui/command.tsx";
import { type OutputFlags, outputOf, printJson, showTable } from "../ui/output.tsx";
import { withProgress } from "../ui/progress.tsx";
import { color } from "../ui/theme.ts";
import { candidates, loadState, NUDGE_DAYS, runNudge, upcoming } from "./nudge.ts";

type Row = ReturnType<typeof upcoming>[number];

export function registerNudge(program: Command): Command {
  const nudge = program
    .command("nudge")
    .description("put a task in Today once its deadline is near and it has no due date");

  withOutput(
    nudge
      .command("list", { isDefault: true })
      .description("tasks with a deadline and no due date, and when each is pulled in")
      .option("--days <n>", "how near is near", String(NUDGE_DAYS)),
  ).action(async (flags: OutputFlags & { days: string }) => {
    const output = outputOf(flags);
    const rows = upcoming(await candidates(client()), loadState(), today(), Number(flags.days));
    await showTable<Row>(
      {
        columns: [
          { header: "task", value: (r) => r.content, shrink: 4 },
          { header: "deadline", value: (r) => r.deadline, min: 10 },
          {
            header: "left",
            value: (r) => (r.left < 0 ? `${-r.left}d late` : `${r.left}d`),
            align: "right",
            color: (r) => (r.left < 0 ? color.error : r.left <= 2 ? color.warn : undefined),
          },
          {
            header: "into today",
            value: (r) => r.on,
            color: (r) => (r.on === "now" ? color.accent : color.muted),
          },
        ],
        rows,
        id: (r) => r.id,
        json: (r) => r,
        empty: "every task with a deadline already has a due date",
      },
      output,
    );
  });

  withOutput(
    nudge
      .command("run")
      .description("give near-deadline tasks a due date of today")
      .option("-n, --dry-run", "show what would move, move nothing")
      .option("--days <n>", "how near is near", String(NUDGE_DAYS))
      .option("--force", "lift the cap on how many move at once"),
  ).action(async (flags: OutputFlags & { dryRun?: boolean; days: string; force?: boolean }) => {
    const output = outputOf(flags);
    try {
      const result = await withProgress(output, async (progress) => {
        const result = await runNudge(progress, {
          dryRun: flags.dryRun,
          days: Number(flags.days),
          force: flags.force,
        });
        if (output.mode === "ink") {
          progress.show(
            <Result ops={result.ops} dryRun={flags.dryRun} summary="no deadline is close yet" />,
          );
        }
        return result;
      });
      if (!flags.dryRun) recordRun("nudge", true, result.summary);
      if (output.mode === "json") printJson(result.raw);
      if (output.mode === "plain") printOps(result.ops);
    } catch (error) {
      fail(output, "nudge failed", error);
    }
  });

  return nudge;
}
