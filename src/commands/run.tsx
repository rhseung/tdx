import { option } from "pastel";
import { z } from "zod";
import { disabled, recordRun } from "../core/features.ts";
import { FEATURES } from "../features.ts";
import { t } from "../i18n/index.ts";
import { dryRun, outputOptions } from "../ui/options.ts";
import { outputOf, printJson } from "../ui/output.tsx";
import type { OpRow } from "../ui/parts.tsx";
import { printOps, Result, Run } from "../ui/run.tsx";

export const description = t.help.commands.run;

export const options = outputOptions.extend({
  dryRun,
  only: z
    .string()
    .optional()
    .describe(option({ description: t.help.only, valueDescription: "names" })),
});

type Props = { options: z.infer<typeof options> };

export default function RunAll({ options }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure={t.failed("run")}
      task={async (progress) => {
        const only = options.only ? new Set(options.only.split(",")) : null;
        const off = disabled();
        const chosen = FEATURES.filter((f) => (only ? only.has(f.name) : !off.has(f.name)));
        const results: Record<
          string,
          { ok: boolean; summary: string; counts?: number[]; ops: OpRow[] }
        > = {};
        // One feature failing must not starve the rest: they touch different
        // parts of Todoist, and a GitHub outage is no reason to skip a deadline.
        for (const feature of chosen) {
          progress.scope = feature.name;
          try {
            const result = await feature.run(progress, { dryRun: options.dryRun });
            results[feature.name] = { ok: true, ...result };
          } catch (error) {
            const summary = error instanceof Error ? error.message : String(error);
            results[feature.name] = { ok: false, summary, ops: [] };
          }
          const r = results[feature.name];
          if (r && !options.dryRun) recordRun(feature.name, r.ok, r.summary, r.counts);
        }
        const ops = Object.values(results).flatMap((r) => r.ops);
        if (Object.values(results).some((r) => !r.ok)) process.exitCode = 1;
        if (output.mode === "json") printJson(results);
        if (output.mode === "plain") printOps(ops);
        return <Result ops={ops} dryRun={options.dryRun} />;
      }}
    />
  );
}
