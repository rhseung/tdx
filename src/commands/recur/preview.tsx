import { argument, option } from "pastel";
import { z } from "zod";
import { today } from "../../core/day.ts";
import { occurrenceColumns } from "../../recur/columns.ts";
import { loadChecked, occurrenceRows } from "../../recur/feature.tsx";
import { outputOptions } from "../../ui/options.ts";
import { outputOf, tableOutcome } from "../../ui/output.tsx";
import { Run, readIds } from "../../ui/run.tsx";

export const description = "Every deadline a template makes, past and upcoming";

export const options = outputOptions.extend({
  upcoming: z
    .number()
    .int()
    .positive()
    .default(12)
    .describe(
      option({ description: "Upcoming deadlines per template", valueDescription: "count" }),
    ),
});

export const args = z
  .array(z.string())
  .default([])
  .describe(argument({ name: "ids", description: "Template ids, or - for stdin" }));

type Props = { options: z.infer<typeof options>; args: z.infer<typeof args> };

export default function Preview({ options, args }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure="recur preview failed"
      task={async (progress) => {
        const ids = await readIds(args);
        const { checked, state } = await progress.step("Read templates", () => loadChecked(ids));
        return tableOutcome(
          {
            columns: occurrenceColumns,
            rows: occurrenceRows(checked, state, today(), options.upcoming),
            id: (r) => `${r.templateId}:${r.deadline}`,
            json: (r) => r,
            empty: "no templates with a valid rule",
          },
          output,
        );
      }}
    />
  );
}
