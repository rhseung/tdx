import { mkdir, writeFile } from "node:fs/promises";
import { Box, Text } from "ink";
import { COMMANDS, COMPLETION_FILE, SITE_FUNCTIONS } from "../../completion/paths.ts";
import { readTree } from "../../completion/tree.ts";
import { zshScript } from "../../completion/zsh.ts";
import { outputOf } from "../../ui/output.tsx";
import { Fields } from "../../ui/parts.tsx";
import { Run } from "../../ui/run.tsx";
import { color, symbol } from "../../ui/theme.ts";

export const description = "Write the zsh completion script where zsh looks for it";

export default function Install() {
  const output = outputOf();
  return (
    <Run
      output={output}
      failure="completion install failed"
      task={async () => {
        await mkdir(SITE_FUNCTIONS, { recursive: true });
        await writeFile(COMPLETION_FILE, zshScript(await readTree(COMMANDS)));
        if (output.mode !== "ink") process.stdout.write(`${COMPLETION_FILE}\n`);
        return (
          <Box flexDirection="column">
            <Text color={color.ok}>{symbol.ok} completion installed</Text>
            <Fields
              rows={[
                ["file", COMPLETION_FILE],
                ["next", "open a new shell, or: exec zsh"],
              ]}
            />
          </Box>
        );
      }}
    />
  );
}
