// Choosing one thing when a command was given no id.
//
// fzf, for those who live in it (TDX_PICKER=fzf), else an Ink list. Either
// way the choice is made before any Ink screen renders, so the two never
// fight over the terminal.

import { Select } from "@inkjs/ui";
import { Box, render, Text, useApp, useInput } from "ink";
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

function Picker({
  choices,
  prompt,
  onPick,
}: {
  choices: Choice[];
  prompt: string;
  onPick: (id: string | null) => void;
}) {
  const { exit } = useApp();
  useInput((_, key) => {
    if (key.escape) {
      onPick(null);
      exit();
    }
  });
  return (
    <Box flexDirection="column">
      <Text bold>{prompt}</Text>
      <Select
        visibleOptionCount={12}
        options={choices.map((c) => ({ label: c.label, value: c.id }))}
        onChange={(id) => {
          onPick(id);
          exit();
        }}
      />
      <Text color={color.muted}>{"↑↓ move · enter pick · esc cancel"}</Text>
    </Box>
  );
}

export async function pick(
  choices: Choice[],
  prompt: string,
  preview?: string,
): Promise<string | null> {
  if (!choices.length) return null;
  if (process.env.TDX_PICKER === "fzf" && Bun.which("fzf")) {
    return withFzf(choices, prompt, preview);
  }
  let picked: string | null = null;
  const app = render(
    <Picker
      choices={choices}
      prompt={prompt}
      onPick={(id) => {
        picked = id;
      }}
    />,
  );
  await app.waitUntilExit();
  app.clear();
  return picked;
}
