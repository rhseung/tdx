import { useApp } from "ink";
import { argument } from "pastel";
import { useEffect } from "react";
import { z } from "zod";
import { FEATURES } from "../features.ts";
import { initScript, SHELLS } from "../init.ts";

export const description = 'Print shell setup: eval "$(tdx init zsh)"';

export const args = z.tuple([
  z.enum(SHELLS).describe(argument({ name: "shell", description: SHELLS.join(", ") })),
]);

// Plain text for eval, never a screen: nothing here is for a person to read.
export default function Init() {
  const { exit } = useApp();
  useEffect(() => {
    process.stdout.write(initScript([...FEATURES.map((f) => f.name), "status"]));
    exit();
  }, [exit]);
  return null;
}
