import type { z } from "zod";
import { today } from "../../core/day.ts";
import { appOutcome } from "../../recur/app.tsx";
import { templateColumns } from "../../recur/columns.ts";
import { loadChecked, templateRows } from "../../recur/feature.tsx";
import { TEMPLATES_PROJECT } from "../../recur/io.ts";
import { outputOptions } from "../../ui/options.ts";
import { outputOf, tableOutcome } from "../../ui/output.tsx";
import { Run } from "../../ui/run.tsx";

export const description = "Assignments that come out on a schedule, with a deadline each time";

export const options = outputOptions;

type Props = { options: z.infer<typeof options> };

// At a terminal the list is the app: new, edit, delete and preview are a key
// away. Piped, it is the template table, id first.
export default function Recur({ options }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure="recur failed"
      task={async (progress) => {
        const data = await progress.step("Read templates", () => loadChecked());
        if (output.mode === "ink" && output.pager) return appOutcome(data, { kind: "list" }, false);
        return tableOutcome(
          {
            columns: templateColumns,
            rows: templateRows(data.checked, data.state, today()),
            id: (r) => r.id,
            json: (r) => r,
            empty: data.workspace.templatesProject
              ? "No templates yet. Add one with `tdx recur new`."
              : `No ${TEMPLATES_PROJECT} project yet. \`tdx recur new\` makes it.`,
          },
          output,
        );
      }}
    />
  );
}
