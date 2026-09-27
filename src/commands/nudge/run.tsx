import { option } from "pastel";
import { z } from "zod";
import { recordRun } from "../../core/features.ts";
import { runNudge } from "../../nudge/nudge.ts";
import { days } from "../../nudge/options.ts";
import { dryRun, outputOptions } from "../../ui/options.ts";
import { outputOf, printJson } from "../../ui/output.tsx";
import { printOps, Result, Run } from "../../ui/run.tsx";

export const description = "Give near-deadline tasks a due date of today";

export const options = outputOptions.extend({
  dryRun,
  days,
  force: z
    .boolean()
    .default(false)
    .describe(option({ description: "Lift the cap on how many move at once" })),
});

type Props = { options: z.infer<typeof options> };

export default function NudgeRun({ options }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure="nudge failed"
      task={async (progress) => {
        const result = await runNudge(progress, options);
        if (!options.dryRun) recordRun("nudge", true, result.summary);
        if (output.mode === "json") printJson(result.raw);
        if (output.mode === "plain") printOps(result.ops);
        return (
          <Result ops={result.ops} dryRun={options.dryRun} summary="no deadline is close yet" />
        );
      }}
    />
  );
}
