import { argument } from "pastel";
import { useState } from "react";
import { z } from "zod";
import { appOutcome, requireTerminal } from "../../recur/app.tsx";
import { loadChecked } from "../../recur/feature.tsx";
import { outputOf } from "../../ui/output.tsx";
import { type Choice, Pick } from "../../ui/pick.tsx";
import { type Outcome, Run } from "../../ui/run.tsx";

export const description = "Edit a template in the form (no id: pick one)";

export const args = z.tuple([
  z
    .string()
    .optional()
    .describe(argument({ name: "id", description: "Template id" })),
]);

type Props = { args: z.infer<typeof args> };

export default function Edit({ args: [id] }: Props) {
  return (
    <Run
      output={outputOf()}
      failure="recur edit failed"
      task={async (progress) => {
        requireTerminal("edit");
        const data = await progress.step("Read templates", () => loadChecked());
        if (id) return appOutcome(data, { kind: "form", id }, true);
        const choices = data.workspace.templates.map((t) => ({ id: t.id, label: t.content }));
        if (!choices.length) throw new Error("no templates yet; make one with `tdx recur new`");
        // Pick first, then the form: the pick is its own screen, and once it
        // has an answer it hands over to the app.
        return (done) => (
          <Picked
            choices={choices}
            onCancel={done}
            then={(picked) => appOutcome(data, { kind: "form", id: picked }, true)}
          />
        );
      }}
    />
  );
}

function Picked({
  choices,
  onCancel,
  then,
}: {
  choices: Choice[];
  onCancel: () => void;
  then: (id: string) => Outcome;
}) {
  const [next, setNext] = useState<Outcome | null>(null);
  if (next) return typeof next === "function" ? next(onCancel) : next;
  return (
    <Pick
      choices={choices}
      prompt="Edit which template?"
      preview="tdx recur show {1}"
      onPick={(picked) => (picked ? setNext(() => then(picked)) : onCancel())}
    />
  );
}
