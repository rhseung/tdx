import { Text } from "ink";
import * as agent from "../core/agent.ts";
import { outputOf } from "../ui/output.tsx";
import { Run } from "../ui/run.tsx";
import { color, symbol } from "../ui/theme.ts";

export const description = "Unload and remove the launchd agent";

export default function Uninstall() {
  const output = outputOf();
  return (
    <Run
      output={output}
      failure="uninstall failed"
      task={async () => {
        agent.uninstall();
        if (output.mode !== "ink") process.stdout.write("removed\n");
        return <Text color={color.ok}>{symbol.ok} agent removed</Text>;
      }}
    />
  );
}
