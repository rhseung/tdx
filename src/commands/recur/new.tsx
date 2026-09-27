import { appOutcome, requireTerminal } from "../../recur/app.tsx";
import { loadChecked } from "../../recur/feature.tsx";
import { outputOf } from "../../ui/output.tsx";
import { Run } from "../../ui/run.tsx";

export const description = "Make a template in a form, with its deadlines previewed as you type";

export default function New() {
  return (
    <Run
      output={outputOf()}
      failure="recur new failed"
      task={async (progress) => {
        requireTerminal("new");
        const data = await progress.step("Read templates", () => loadChecked());
        return appOutcome(data, { kind: "form", id: null }, true);
      }}
    />
  );
}
