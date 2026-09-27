import { mkdir, writeFile } from "node:fs/promises";
import { Box, Text } from "ink";
import { COMMANDS, COMPLETION_FILE, SITE_FUNCTIONS } from "../../completion/paths.ts";
import { readTree } from "../../completion/tree.ts";
import { zshScript } from "../../completion/zsh.ts";
import { t } from "../../i18n/index.ts";
import { outputOf } from "../../ui/output.tsx";
import { Fields } from "../../ui/parts.tsx";
import { Run } from "../../ui/run.tsx";
import { color, symbol } from "../../ui/theme.ts";

export const description = t.help.commands.completionInstall;

export default function Install() {
  const output = outputOf();
  return (
    <Run
      output={output}
      failure={t.failed("completion install")}
      task={async () => {
        await mkdir(SITE_FUNCTIONS, { recursive: true });
        await writeFile(COMPLETION_FILE, zshScript(await readTree(COMMANDS)));
        if (output.mode !== "ink") process.stdout.write(`${COMPLETION_FILE}\n`);
        return (
          <Box flexDirection="column">
            <Text color={color.ok}>
              {symbol.ok} {t.completion.installed}
            </Text>
            <Fields
              rows={[
                [t.completion.file, COMPLETION_FILE],
                [t.completion.next, t.completion.reload],
              ]}
            />
          </Box>
        );
      }}
    />
  );
}
