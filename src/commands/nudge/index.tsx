import type { z } from "zod";
import { today } from "../../core/day.ts";
import { client } from "../../core/todoist.ts";
import { t } from "../../i18n/index.ts";
import { candidates, loadState, upcoming } from "../../nudge/nudge.ts";
import { days } from "../../nudge/options.ts";
import { outputOptions } from "../../ui/options.ts";
import { outputOf, tableOutcome } from "../../ui/output.tsx";
import { Run } from "../../ui/run.tsx";
import type { Column } from "../../ui/table.tsx";
import { color } from "../../ui/theme.ts";

export const description = t.help.commands.nudge;

export const options = outputOptions.extend({ days });

type Props = { options: z.infer<typeof options> };
type Row = ReturnType<typeof upcoming>[number];

const columns: Column<Row>[] = [
  { header: t.nudge.columns.task, value: (r) => r.content, shrink: 4 },
  { header: t.nudge.columns.deadline, value: (r) => r.deadline, min: 10 },
  {
    header: t.nudge.columns.left,
    value: (r) => (r.left < 0 ? t.nudge.late(-r.left) : t.nudge.left(r.left)),
    align: "right",
    color: (r) => (r.left < 0 ? color.error : r.left <= 2 ? color.warn : undefined),
  },
  {
    header: t.nudge.columns.intoToday,
    value: (r) => (r.on === "now" ? t.nudge.now : r.on === "kept off" ? t.nudge.keptOff : r.on),
    color: (r) => (r.on === "now" ? color.accent : color.muted),
  },
];

export default function Nudge({ options }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure={t.failed("nudge")}
      task={async (progress) => {
        const tasks = await progress.step(t.steps.readDeadlines, () => candidates(client()));
        return tableOutcome(
          {
            columns,
            rows: upcoming(tasks, loadState(), today(), options.days),
            id: (r) => r.id,
            json: (r) => r,
            empty: t.nudge.empty,
          },
          output,
        );
      }}
    />
  );
}
