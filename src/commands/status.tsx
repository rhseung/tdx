import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { z } from "zod";
import * as agent from "../core/agent.ts";
import { disabled, type LastRun, lastRuns } from "../core/features.ts";
import { FEATURES } from "../features.ts";
import { outputOptions } from "../ui/options.ts";
import { outputOf, printJson, tableOutcome } from "../ui/output.tsx";
import { Fields } from "../ui/parts.tsx";
import { Run } from "../ui/run.tsx";
import type { Column } from "../ui/table.tsx";
import { color } from "../ui/theme.ts";
import { ago } from "../ui/time.ts";

export const description = "Show the agent and each feature's last run";

export const options = outputOptions;

type Props = { options: z.infer<typeof options> };

interface Row {
  name: string;
  enabled: boolean;
  description: string;
  last: LastRun | null;
}

const columns: Column<Row>[] = [
  { header: "feature", value: (r) => r.name, min: 4 },
  {
    header: "on",
    value: (r) => (r.enabled ? "on" : "off"),
    color: (r) => (r.enabled ? color.ok : color.muted),
  },
  {
    header: "last run",
    value: (r) => (r.last ? ago(r.last.at) : "never"),
    color: () => color.muted,
  },
  {
    header: "result",
    value: (r) => (r.last ? (r.last.ok ? "ok" : "failed") : ""),
    color: (r) => (r.last?.ok ? color.ok : color.error),
  },
  { header: "summary", value: (r) => r.last?.summary ?? r.description, shrink: 4 },
];

function agentLine(status: agent.AgentStatus): [string, string] {
  if (!status.installed) return ["not installed", color.warn];
  if (!status.loaded) return [`installed but not loaded (every ${status.interval}s)`, color.warn];
  return [`running every ${status.interval}s, last exit ${status.lastExit ?? "?"}`, color.ok];
}

export default function Status({ options }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure="status failed"
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
            "agent",
            <Text key="agent" color={shade}>
              {text}
            </Text>,
          ],
          ["log", agent.LOG],
        ];
        if (status.legacyLoaded) {
          fields.push([
            "legacy",
            <Text key="legacy" color={color.error}>
              {agent.LEGACY_LABEL} still loaded
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
