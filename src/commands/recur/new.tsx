import { t } from "../../i18n/index.ts";
import { appOutcome, requireTerminal } from "../../recur/app.tsx";
import { loadChecked } from "../../recur/feature.tsx";
import { outputOf } from "../../ui/output.tsx";
import { Run } from "../../ui/run.tsx";

export const description = t.help.commands.recurNew;

export default function New() {
  return (
    <Run
      output={outputOf()}
      failure={t.failed("recur new")}
      task={async (progress) => {
        requireTerminal("new");
        const data = await progress.step(t.steps.readTemplates, () => loadChecked());
        return appOutcome(data, { kind: "form", id: null }, true);
      }}
    />
  );
}
