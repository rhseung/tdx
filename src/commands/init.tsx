import { useApp } from "ink";
import { argument } from "pastel";
import { useEffect } from "react";
import { z } from "zod";
import { FEATURES } from "../features.ts";
import { t } from "../i18n/index.ts";
import { initScript, SHELLS } from "../init.ts";

export const description = t.help.commands.init;

export const args = z.tuple([
  z.enum(SHELLS).describe(argument({ name: "shell", description: SHELLS.join(", ") })),
]);

// Plain text for eval, never a screen: nothing here is for a person to read.
type Props = { args: z.infer<typeof args> };

export default function Init({ args: [shell] }: Props) {
  const { exit } = useApp();
  useEffect(() => {
    process.stdout.write(
      initScript(shell, [
        ...FEATURES.map((f) => ({ name: f.name, description: f.description })),
        { name: "status", description: t.help.commands.status },
      ]),
    );
    exit();
  }, [shell, exit]);
  return null;
}
