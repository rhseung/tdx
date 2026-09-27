import { Text } from "ink";
import { argument } from "pastel";
import { z } from "zod";
import { setEnabled } from "../core/features.ts";
import { FEATURES } from "../features.ts";
import { t } from "../i18n/index.ts";
import { outputOf } from "../ui/output.tsx";
import { Run } from "../ui/run.tsx";
import { color, symbol } from "../ui/theme.ts";

export const description = t.help.commands.disable;

export const args = z.tuple([
  z
    .enum(FEATURES.map((f) => f.name) as [string, ...string[]])
    .describe(argument({ name: "feature", description: FEATURES.map((f) => f.name).join(", ") })),
]);

type Props = { args: z.infer<typeof args> };

export default function Disable({ args: [feature] }: Props) {
  const output = outputOf();
  return (
    <Run
      output={output}
      failure={t.failed("disable")}
      task={async () => {
        setEnabled(feature, false);
        if (output.mode !== "ink") process.stdout.write(`${feature} disabled\n`);
        return (
          <Text color={color.ok}>
            {symbol.ok} {t.features.disabled(feature)}
          </Text>
        );
      }}
    />
  );
}
