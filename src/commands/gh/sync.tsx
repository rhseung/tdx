import { option } from "pastel";
import { z } from "zod";
import { recordRun } from "../../core/features.ts";
import { syncGithub } from "../../github/feature.tsx";
import { GRACE_DAYS } from "../../github/reconcile.ts";
import { t } from "../../i18n/index.ts";
import { dryRun, outputOptions } from "../../ui/options.ts";
import { outputOf, printJson } from "../../ui/output.tsx";
import { printOps, Result, Run } from "../../ui/run.tsx";

export const description = t.help.commands.ghSync;

export const options = outputOptions.extend({
  dryRun,
  force: z
    .boolean()
    .default(false)
    .describe(option({ description: t.help.force })),
  grace: z
    .number()
    .int()
    .nonnegative()
    .default(GRACE_DAYS)
    .describe(
      option({
        description: t.help.grace,
        valueDescription: "days",
      }),
    ),
});

type Props = { options: z.infer<typeof options> };

export default function Sync({ options }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure={t.failed("gh sync")}
      task={async (progress) => {
        try {
          const result = await syncGithub(progress, options);
          if (!options.dryRun) recordRun("gh", true, result.summary, result.counts);
          if (output.mode === "json") printJson({ items: result.items, ops: result.raw });
          if (output.mode === "plain") printOps(result.ops);
          return <Result ops={result.ops} dryRun={options.dryRun} summary={t.results.ghUpToDate} />;
        } catch (error) {
          if (!options.dryRun) {
            recordRun("gh", false, error instanceof Error ? error.message : String(error));
          }
          throw error;
        }
      }}
    />
  );
}
