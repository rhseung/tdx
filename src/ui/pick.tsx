// Choosing one thing when a command was given no id: fzf for those who live
// in it (TDX_PICKER=fzf), else an Ink list.

import { Select } from "@inkjs/ui";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect } from "react";
import { color } from "./theme.ts";

export interface Choice {
  id: string;
  label: string;
}

async function withFzf(
  choices: Choice[],
  prompt: string,
  preview?: string,
): Promise<string | null> {
  const args = ["fzf", "--delimiter", "\t", "--with-nth", "2..", "--prompt", `${prompt} `];
  if (preview) args.push("--preview", preview);
  const fzf = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  fzf.stdin.write(choices.map((c) => `${c.id}\t${c.label}`).join("\n"));
  await fzf.stdin.end();
  const out = await new Response(fzf.stdout).text();
  await fzf.exited;
  return out.split("\t")[0]?.trim() || null;
}

function SelectPicker({ choices, prompt, onPick }: PickProps) {
  useInput((_, key) => {
    if (key.escape) onPick(null);
  });
  return (
    <Box flexDirection="column">
      <Text bold>{prompt}</Text>
      <Select
        visibleOptionCount={12}
        options={choices.map((c) => ({ label: c.label, value: c.id }))}
        onChange={onPick}
      />
      <Text color={color.muted}>{"↑↓ move · enter pick · esc cancel"}</Text>
    </Box>
  );
}

// fzf needs the terminal to itself; Ink lends it and redraws after.
function FzfPicker({ choices, prompt, preview, onPick }: PickProps) {
  const { suspendTerminal } = useApp();
  // Runs once: one pick per mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    void (async () => {
      let picked: string | null = null;
      await suspendTerminal(async () => {
        picked = await withFzf(choices, prompt, preview);
      });
      onPick(picked);
    })();
  }, []);
  return null;
}

interface PickProps {
  choices: Choice[];
  prompt: string;
  preview?: string | undefined;
  onPick: (id: string | null) => void;
}

export function Pick(props: PickProps) {
  const fzf = process.env["TDX_PICKER"] === "fzf" && Bun.which("fzf");
  return fzf ? <FzfPicker {...props} /> : <SelectPicker {...props} />;
}
