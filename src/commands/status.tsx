import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { z } from "zod";
import * as agent from "../core/agent.ts";
import { disabled, type LastRun, lastRuns } from "../core/features.ts";
import { FEATURES } from "../features.ts";
import { t } from "../i18n/index.ts";
import { outputOptions } from "../ui/options.ts";
import { outputOf, printJson, tableOutcome } from "../ui/output.tsx";
import { Fields } from "../ui/parts.tsx";
import { Run } from "../ui/run.tsx";
import type { Column } from "../ui/table.tsx";
import { color } from "../ui/theme.ts";
import { ago } from "../ui/time.ts";

export const description = t.help.commands.status;

export const options = outputOptions;

type Props = { options: z.infer<typeof options> };

interface Row {
  name: string;
  enabled: boolean;
  description: string;
  last: LastRun | null;
}

const columns: Column<Row>[] = [
  { header: t.features.columns.feature, value: (r) => r.name, min: 4 },
  {
    header: t.features.columns.on,
    value: (r) => (r.enabled ? t.features.on : t.features.off),
    color: (r) => (r.enabled ? color.ok : color.muted),
  },
  {
    header: t.features.columns.lastRun,
    value: (r) => (r.last ? ago(r.last.at) : t.features.never),
    color: () => color.muted,
  },
  {
    header: t.features.columns.result,
    value: (r) => (r.last ? (r.last.ok ? t.features.ok : t.features.failedRun) : ""),
    color: (r) => (r.last?.ok ? color.ok : color.error),
  },
  {
    header: t.features.columns.summary,
    value: (r) => (r.last ? summaryOf(r.name, r.last) : r.description),
    shrink: 4,
  },
];

// A failure's summary is its error message and stands as written; a success
// is rebuilt from its counts in the reader's language.
function summaryOf(name: string, last: LastRun): string {
  const [a = 0, b = 0] = last.counts ?? [];
  if (!last.ok || !last.counts) return last.summary;
  if (name === "gh") return t.summary.gh(a, b);
  if (name === "recur") return t.summary.recur(a, b);
  if (name === "nudge") return t.summary.nudge(a);
  return last.summary;
}

function agentLine(status: agent.AgentStatus): [string, string] {
  if (!status.installed) return [t.agent.notInstalled, color.warn];
  if (!status.loaded) return [t.agent.notLoaded(status.interval), color.warn];
  return [t.agent.running(status.interval, status.lastExit ?? "?"), color.ok];
}

export default function Status({ options }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure={t.failed("status")}
      task={async () => {
        const status = agent.describe();
        const runs = lastRuns();
        const off = disabled();
        const rows: Row[] = FEATURES.map((f) => ({
          name: f.name,
          enabled: !off.has(f.name),
          description: f.description,
          last: runs[f.name] ?? null,
        }));
        if (output.mode === "json") {
          printJson({ agent: status, features: rows });
          return null;
        }
        const table = tableOutcome({ columns, rows, id: (r) => r.name, json: (r) => r }, output);
        if (output.mode === "plain" || typeof table === "function") return table;
        const [text, shade] = agentLine(status);
        const fields: [string, ReactNode][] = [
          [
            t.agent.fields.agent,
            <Text key="agent" color={shade}>
              {text}
            </Text>,
          ],
          [t.agent.fields.log, agent.LOG],
        ];
        if (status.legacyLoaded) {
          fields.push([
            t.agent.fields.legacy,
            <Text key="legacy" color={color.error}>
              {t.agent.legacyLoaded(agent.LEGACY_LABEL)}
            </Text>,
          ]);
        }
        return (
          <Box flexDirection="column" gap={1}>
            <Fields rows={fields} />
            {table}
          </Box>
        );
      }}
    />
  );
}
