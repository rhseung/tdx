import { argument, option } from "pastel";
import { z } from "zod";
import { today } from "../../core/day.ts";
import { t } from "../../i18n/index.ts";
import { occurrenceColumns } from "../../recur/columns.ts";
import { loadChecked, occurrenceRows } from "../../recur/feature.tsx";
import { outputOptions } from "../../ui/options.ts";
import { outputOf, tableOutcome } from "../../ui/output.tsx";
import { Run, readIds } from "../../ui/run.tsx";

export const description = t.help.commands.recurPreview;

export const options = outputOptions.extend({
  upcoming: z
    .number()
    .int()
    .positive()
    .default(12)
    .describe(option({ description: t.help.upcoming, valueDescription: "count" })),
});

export const args = z
  .array(z.string())
  .default([])
  .describe(argument({ name: "ids", description: t.help.templateIds }));

type Props = { options: z.infer<typeof options>; args: z.infer<typeof args> };

export default function Preview({ options, args }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure={t.failed("recur preview")}
      task={async (progress) => {
        const ids = await readIds(args);
        const { checked, state } = await progress.step(t.steps.readTemplates, () =>
          loadChecked(ids),
        );
        return tableOutcome(
          {
            columns: occurrenceColumns,
            rows: occurrenceRows(checked, state, today(), options.upcoming),
            id: (r) => `${r.templateId}:${r.deadline}`,
            json: (r) => r,
            empty: t.recur.noValidRule,
          },
          output,
        );
      }}
    />
  );
}
