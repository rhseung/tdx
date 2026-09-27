import { argument } from "pastel";
import { z } from "zod";
import { recordRun } from "../../core/features.ts";
import { runRecur } from "../../recur/feature.tsx";
import { dryRun, outputOptions } from "../../ui/options.ts";
import { outputOf, printJson } from "../../ui/output.tsx";
import { printOps, Result, Run, readIds } from "../../ui/run.tsx";

export const description = "Make every task that is due to appear by now";

export const options = outputOptions.extend({ dryRun });

export const args = z
  .array(z.string())
  .default([])
  .describe(argument({ name: "ids", description: "Only these templates, or - for stdin" }));

type Props = { options: z.infer<typeof options>; args: z.infer<typeof args> };

export default function RecurRun({ options, args }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure="recur run failed"
      task={async (progress) => {
        const ids = await readIds(args);
        const result = await runRecur(progress, { dryRun: options.dryRun, ids });
        // Only a run over every template stands for the feature's last run.
        if (!options.dryRun && !ids.length) recordRun("recur", true, result.summary);
        if (output.mode === "json") printJson(result.raw);
        if (output.mode === "plain") printOps(result.ops);
        return <Result ops={result.ops} dryRun={options.dryRun} summary="nothing is due yet" />;
      }}
    />
  );
}
