import { Text } from "ink";
import { argument } from "pastel";
import { z } from "zod";
import { setEnabled } from "../core/features.ts";
import { FEATURES } from "../features.ts";
import { outputOf } from "../ui/output.tsx";
import { Run } from "../ui/run.tsx";
import { color, symbol } from "../ui/theme.ts";

export const description = "Skip a feature in `tdx run`";

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
      failure="disable failed"
      task={async () => {
        setEnabled(feature, false);
        if (output.mode !== "ink") process.stdout.write(`${feature} disabled\n`);
        return (
          <Text color={color.ok}>
            {symbol.ok} {feature} disabled
          </Text>
        );
      }}
    />
  );
}
