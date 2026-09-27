// Choosing when a command was given no id: fzf for those who live in it
// (TDX_PICKER=fzf), else an Ink list. Ids stay behind the scenes; a person
// picks by name.

import { MultiSelect, Select } from "@inkjs/ui";
import { Box, Text, useApp, useInput } from "ink";
import { type ReactNode, useEffect, useState } from "react";
import { t } from "../i18n/index.ts";
import { ErrorBox } from "./parts.tsx";
import type { Outcome } from "./run.tsx";
import { color } from "./theme.ts";

interface Choice {
  id: string;
  label: string;
}

interface PickProps {
  choices: Choice[];
  prompt: string;
  preview?: string | undefined;
  multiple?: boolean | undefined;
  // Empty when cancelled.
  onPick: (ids: string[]) => void;
}

async function withFzf({ choices, prompt, preview, multiple }: PickProps): Promise<string[]> {
  const args = ["fzf", "--delimiter", "\t", "--with-nth", "2..", "--prompt", `${prompt} `];
  if (multiple) args.push("--multi");
  if (preview) args.push("--preview", preview);
  const fzf = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  fzf.stdin.write(choices.map((c) => `${c.id}\t${c.label}`).join("\n"));
  await fzf.stdin.end();
  const out = await new Response(fzf.stdout).text();
  await fzf.exited;
  return out
    .split("\n")
    .map((line) => line.split("\t")[0]?.trim() ?? "")
    .filter(Boolean);
}

function InkPicker({ choices, prompt, multiple, onPick }: PickProps) {
  useInput((_, key) => {
    if (key.escape) onPick([]);
  });
  const options = choices.map((c) => ({ label: c.label, value: c.id }));
  return (
    <Box flexDirection="column">
      <Text bold>{prompt}</Text>
      {multiple ? (
        <MultiSelect visibleOptionCount={12} options={options} onSubmit={onPick} />
      ) : (
        <Select visibleOptionCount={12} options={options} onChange={(id) => onPick([id])} />
      )}
      <Text color={color.muted}>{multiple ? t.picker.multiKeys : t.picker.keys}</Text>
    </Box>
  );
}

// fzf needs the terminal to itself; Ink lends it and redraws after.
function FzfPicker(props: PickProps) {
  const { suspendTerminal } = useApp();
  // Runs once: one pick per mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    void (async () => {
      let picked: string[] = [];
      await suspendTerminal(async () => {
        picked = await withFzf(props);
      });
      props.onPick(picked);
    })();
  }, []);
  return null;
}

function Pick(props: PickProps) {
  const fzf = process.env["TDX_PICKER"] === "fzf" && Bun.which("fzf");
  return fzf ? <FzfPicker {...props} /> : <InkPicker {...props} />;
}

// Pick, then carry on with what was picked -- a form, a view, a deletion --
// as the command's own outcome. `done` ends the command.
export function PickThen({
  then,
  done,
  ...pick
}: Omit<PickProps, "onPick"> & {
  then: (ids: string[]) => Outcome | Promise<Outcome>;
  done: () => void;
}) {
  const { waitUntilRenderFlush } = useApp();
  const [next, setNext] = useState<{ outcome: Outcome } | null>(null);

  // A plain view is shown and the command ends; a view that ends itself, such
  // as a form, is handed `done` instead.
  useEffect(() => {
    if (next && typeof next.outcome !== "function") void waitUntilRenderFlush().then(done);
  }, [next, done, waitUntilRenderFlush]);

  if (next) return typeof next.outcome === "function" ? next.outcome(done) : next.outcome;
  return (
    <Pick
      {...pick}
      onPick={(ids) => {
        if (!ids.length) return done();
        void (async () => {
          try {
            setNext({ outcome: await then(ids) });
          } catch (error) {
            process.exitCode = 1;
            const message = error instanceof Error ? error.message : String(error);
            setNext({ outcome: <ErrorBox title={pick.prompt} message={message} /> });
          }
        })();
      }}
    />
  );
}

export function Confirm({
  question,
  onAnswer,
}: {
  question: ReactNode;
  onAnswer: (yes: boolean) => void;
}) {
  useInput((input, key) => {
    if (input === "y") onAnswer(true);
    if (input === "n" || key.escape) onAnswer(false);
  });
  return (
    <Text>
      {question} <Text color={color.muted}>{t.recur.yesNo}</Text>
    </Text>
  );
}
