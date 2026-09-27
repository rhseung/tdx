import { Box, Text, useApp } from "ink";
import { argument } from "pastel";
import { type ReactNode, useEffect, useState } from "react";
import { z } from "zod";
import type { Api } from "../../core/http.ts";
import { t } from "../../i18n/index.ts";
import { requireTerminal } from "../../recur/app.tsx";
import { loadChecked } from "../../recur/feature.tsx";
import { deleteTemplate } from "../../recur/io.ts";
import type { RecurState } from "../../recur/plan.ts";
import { type Output, outputOf } from "../../ui/output.tsx";
import { Confirm, PickThen } from "../../ui/pick.tsx";
import { Run, readIds } from "../../ui/run.tsx";
import { color } from "../../ui/theme.ts";

export const description = t.help.commands.recurRm;

export const args = z
  .array(z.string())
  .default([])
  .describe(argument({ name: "ids", description: t.help.templateIds }));

type Props = { args: z.infer<typeof args> };

async function remove(
  api: Api,
  state: RecurState,
  known: Map<string, string>,
  ids: string[],
  output: Output,
) {
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
}

export default function Remove({ args }: Props) {
  const output = outputOf();
  return (
    <Run
      output={output}
      failure={t.failed("recur rm")}
      task={async (progress) => {
        const ids = await readIds(args);
        const { api, state, workspace } = await progress.step(t.steps.readTemplates, () =>
          loadChecked(),
        );
        const known = new Map(workspace.templates.map((t) => [t.id, t.content]));
        if (ids.length) {
          // All checked before any is deleted, so a typo in the list deletes nothing.
          const unknown = ids.filter((id) => !known.has(id));
          if (unknown.length) throw new Error(t.recur.noTemplate(unknown.join(", ")));
          return remove(api, state, known, ids, output);
        }
        // No ids: pick by name, several at once, and confirm -- a pick is
        // quicker to get wrong than a typed id.
        requireTerminal("rm");
        if (!known.size) throw new Error(t.recur.noTemplates);
        return (done) => (
          <PickThen
            choices={[...known].map(([id, label]) => ({ id, label }))}
            prompt={t.recur.pickRm}
            multiple
            done={done}
            then={(picked) => (end) => (
              <ConfirmThen
                question={t.recur.confirmDeleteMany(picked.map((id) => known.get(id) ?? id))}
                onYes={() => remove(api, state, known, picked, output)}
                done={end}
              />
            )}
          />
        );
      }}
    />
  );
}

function ConfirmThen({
  question,
  onYes,
  done,
}: {
  question: string;
  onYes: () => Promise<ReactNode>;
  done: () => void;
}) {
  const [result, setResult] = useState<ReactNode>(null);
  const { waitUntilRenderFlush } = useApp();
  // The result is the command's last frame; end once it is on screen.
  useEffect(() => {
    if (result) void waitUntilRenderFlush().then(done);
  }, [result, done, waitUntilRenderFlush]);
  if (result) return <>{result}</>;
  return (
    <Confirm
      question={question}
      onAnswer={(yes) => {
        if (!yes) return done();
        void onYes().then(setResult, (error: unknown) => {
          process.exitCode = 1;
          setResult(
            <Text color={color.error}>
              {error instanceof Error ? error.message : String(error)}
            </Text>,
          );
        });
      }}
    />
  );
}
