import { useApp } from "ink";
import { useEffect } from "react";
import { COMMANDS } from "../../completion/paths.ts";
import { readTree } from "../../completion/tree.ts";
import { zshScript } from "../../completion/zsh.ts";

export const description = "Print the zsh completion script";

// Plain text for a file or a pipe, never a screen.
export default function Zsh() {
  const { exit } = useApp();
  useEffect(() => {
    void (async () => {
      process.stdout.write(zshScript(await readTree(COMMANDS)));
      exit();
    })();
  }, [exit]);
  return null;
}
