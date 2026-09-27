import { Box, Text } from "ink";
import { option } from "pastel";
import { z } from "zod";
import * as agent from "../core/agent.ts";
import { t } from "../i18n/index.ts";
import { outputOf } from "../ui/output.tsx";
import { Fields } from "../ui/parts.tsx";
import { Run } from "../ui/run.tsx";
import { color, symbol } from "../ui/theme.ts";

export const description = t.help.commands.install;

export const options = z.object({
  interval: z
    .number()
    .int()
    .positive()
    .default(agent.DEFAULT_INTERVAL)
    .describe(option({ description: t.help.interval, valueDescription: "seconds" })),
});

type Props = { options: z.infer<typeof options> };

export default function Install({ options }: Props) {
  const output = outputOf();
  return (
    <Run
      output={output}
      failure={t.failed("install")}
      task={async () => {
        const { path, legacy } = agent.install(options.interval);
        const lines: [keyof typeof t.agent.fields, string][] = [
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
            <Text color={color.ok}>
              {symbol.ok} {t.agent.loaded}
            </Text>
            <Fields rows={lines.map(([key, value]) => [t.agent.fields[key], value])} />
          </Box>
        );
      }}
    />
  );
}
