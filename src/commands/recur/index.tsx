import type { z } from "zod";
import { today } from "../../core/day.ts";
import { t } from "../../i18n/index.ts";
import { appOutcome } from "../../recur/app.tsx";
import { templateColumns } from "../../recur/columns.ts";
import { loadChecked, templateRows } from "../../recur/feature.tsx";
import { TEMPLATES_PROJECT } from "../../recur/io.ts";
import { outputOptions } from "../../ui/options.ts";
import { outputOf, tableOutcome } from "../../ui/output.tsx";
import { Run } from "../../ui/run.tsx";

export const description = t.help.commands.recur;

export const options = outputOptions;

type Props = { options: z.infer<typeof options> };

// At a terminal the list is the app: new, edit, delete and preview are a key
// away. Piped, it is the template table, id first.
export default function Recur({ options }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure={t.failed("recur")}
      task={async (progress) => {
        const data = await progress.step(t.steps.readTemplates, () => loadChecked());
        if (output.mode === "ink" && output.pager) return appOutcome(data, { kind: "list" }, false);
        return tableOutcome(
          {
            columns: templateColumns,
            rows: templateRows(data.checked, data.state, today()),
            id: (r) => r.id,
            json: (r) => r,
            empty: data.workspace.templatesProject
              ? t.recur.emptyList
              : t.recur.noProject(TEMPLATES_PROJECT),
          },
          output,
        );
      }}
    />
  );
}
