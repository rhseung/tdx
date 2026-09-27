import { argument } from "pastel";
import { z } from "zod";
import { t } from "../../i18n/index.ts";
import { appOutcome, requireTerminal } from "../../recur/app.tsx";
import { loadChecked } from "../../recur/feature.tsx";
import { outputOf } from "../../ui/output.tsx";
import { PickThen } from "../../ui/pick.tsx";
import { Run } from "../../ui/run.tsx";

export const description = t.help.commands.recurEdit;

export const args = z.tuple([
  z
    .string()
    .optional()
    .describe(argument({ name: "id", description: t.help.templateId })),
]);

type Props = { args: z.infer<typeof args> };

export default function Edit({ args: [id] }: Props) {
  return (
    <Run
      output={outputOf()}
      failure={t.failed("recur edit")}
      task={async (progress) => {
        requireTerminal("edit");
        const data = await progress.step(t.steps.readTemplates, () => loadChecked());
        if (id) return appOutcome(data, { kind: "form", id }, true);
        const choices = data.workspace.templates.map((t) => ({ id: t.id, label: t.content }));
        if (!choices.length) throw new Error(t.recur.noTemplates);
        // Pick first, then the form: the pick is its own screen, and once it
        // has an answer it hands over to the app.
        return (done) => (
          <PickThen
            choices={choices}
            prompt={t.recur.pickEdit}
            preview="tdx recur show {1}"
            done={done}
            then={([picked]) => appOutcome(data, { kind: "form", id: picked ?? "" }, true)}
          />
        );
      }}
    />
  );
}
