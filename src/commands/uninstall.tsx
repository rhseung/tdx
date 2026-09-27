import { Text } from "ink";
import * as agent from "../core/agent.ts";
import { t } from "../i18n/index.ts";
import { outputOf } from "../ui/output.tsx";
import { Run } from "../ui/run.tsx";
import { color, symbol } from "../ui/theme.ts";

export const description = t.help.commands.uninstall;

export default function Uninstall() {
  const output = outputOf();
  return (
    <Run
      output={output}
      failure={t.failed("uninstall")}
      task={async () => {
        agent.uninstall();
        if (output.mode !== "ink") process.stdout.write("removed\n");
        return (
          <Text color={color.ok}>
            {symbol.ok} {t.agent.removed}
          </Text>
        );
      }}
    />
  );
}
