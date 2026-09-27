import { Box, Text } from "ink";
import { argument } from "pastel";
import { z } from "zod";
import { loadChecked } from "../../recur/feature.tsx";
import { deleteTemplate } from "../../recur/io.ts";
import { outputOf } from "../../ui/output.tsx";
import { Run, readIds } from "../../ui/run.tsx";
import { color } from "../../ui/theme.ts";

export const description = "Delete templates (tasks already made stay)";

export const args = z
  .array(z.string())
  .min(1)
  .describe(argument({ name: "ids", description: "Template ids, or - for stdin" }));

type Props = { args: z.infer<typeof args> };

export default function Remove({ args }: Props) {
  const output = outputOf();
  return (
    <Run
      output={output}
      failure="recur rm failed"
      task={async () => {
        const ids = await readIds(args);
        const { api, state, workspace } = await loadChecked();
        const known = new Map(workspace.templates.map((t) => [t.id, t.content]));
        // All checked before any is deleted, so a typo in the list deletes nothing.
        const unknown = ids.filter((id) => !known.has(id));
        if (unknown.length) throw new Error(`no template ${unknown.join(", ")}`);
        for (const id of ids) {
          await deleteTemplate(api, state, id);
          if (output.mode !== "ink") process.stdout.write(`removed\t${id}\t${known.get(id)}\n`);
        }
        return (
          <Box flexDirection="column">
            {ids.map((id) => (
              <Text key={id}>
                <Text color={color.remove}>- </Text>
                {known.get(id)}
              </Text>
            ))}
          </Box>
        );
      }}
    />
  );
}
