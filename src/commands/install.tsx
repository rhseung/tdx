import { Box, Text } from "ink";
import { option } from "pastel";
import { z } from "zod";
import * as agent from "../core/agent.ts";
import { outputOf } from "../ui/output.tsx";
import { Fields } from "../ui/parts.tsx";
import { Run } from "../ui/run.tsx";
import { color, symbol } from "../ui/theme.ts";

export const description = "Install and load the launchd agent";

export const options = z.object({
  interval: z
    .number()
    .int()
    .positive()
    .default(agent.DEFAULT_INTERVAL)
    .describe(option({ description: "Seconds between runs", valueDescription: "seconds" })),
});

type Props = { options: z.infer<typeof options> };

export default function Install({ options }: Props) {
  const output = outputOf();
  return (
    <Run
      output={output}
      failure="install failed"
      task={async () => {
        const { path, legacy } = agent.install(options.interval);
        const lines: [string, string][] = [
          ["plist", path],
          ["every", `${options.interval}s`],
          ["log", agent.LOG],
        ];
        if (legacy) lines.push(["replaced", agent.LEGACY_LABEL]);
        if (output.mode !== "ink") {
          for (const [k, v] of lines) process.stdout.write(`${k}\t${v}\n`);
        }
        return (
          <Box flexDirection="column">
            <Text color={color.ok}>{symbol.ok} agent loaded</Text>
            <Fields rows={lines} />
          </Box>
        );
      }}
    />
  );
}
