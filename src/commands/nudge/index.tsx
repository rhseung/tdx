import type { z } from "zod";
import { today } from "../../core/day.ts";
import { client } from "../../core/todoist.ts";
import { candidates, loadState, upcoming } from "../../nudge/nudge.ts";
import { days } from "../../nudge/options.ts";
import { outputOptions } from "../../ui/options.ts";
import { outputOf, tableOutcome } from "../../ui/output.tsx";
import { Run } from "../../ui/run.tsx";
import type { Column } from "../../ui/table.tsx";
import { color } from "../../ui/theme.ts";

export const description = "Tasks with a deadline and no due date, and when each goes into Today";

export const options = outputOptions.extend({ days });

type Props = { options: z.infer<typeof options> };
type Row = ReturnType<typeof upcoming>[number];

const columns: Column<Row>[] = [
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
];

export default function Nudge({ options }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure="nudge failed"
      task={async (progress) => {
        const tasks = await progress.step("Read deadlines", () => candidates(client()));
        return tableOutcome(
          {
            columns,
            rows: upcoming(tasks, loadState(), today(), options.days),
            id: (r) => r.id,
            json: (r) => r,
            empty: "every task with a deadline already has a due date",
          },
          output,
        );
      }}
    />
  );
}
