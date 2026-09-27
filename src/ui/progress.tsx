// Steps of a run, drawn as they happen: a spinner that settles into a tick or
// a cross. In plain mode each step becomes one log line when it settles, which
// is what the launchd log wants -- no frames, just outcomes.

import { Spinner } from "@inkjs/ui";
import { Box, render, Text } from "ink";
import { type ReactNode, useSyncExternalStore } from "react";
import type { Output } from "./output.tsx";
import { color, symbol } from "./theme.ts";

type State = "running" | "done" | "failed";

interface Step {
  id: number;
  scope: string;
  label: string;
  state: State;
  detail: string;
}

export class Progress {
  #steps: Step[] = [];
  #tail: ReactNode = null;
  #listeners = new Set<() => void>();
  #version = 0;
  readonly #output: Output;
  // Which feature the next steps belong to, when `tdx run` drives several:
  // three features each have a "Plan" step, and they must read apart.
  scope = "";

  constructor(output: Output) {
    this.#output = output;
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  version = () => this.#version;

  get steps(): readonly Step[] {
    return this.#steps;
  }

  get tail(): ReactNode {
    return this.#tail;
  }

  #changed() {
    this.#version++;
    for (const listener of this.#listeners) listener();
  }

  async step<T>(label: string, run: () => Promise<T>, detail?: (value: T) => string): Promise<T> {
    const step: Step = {
      id: this.#steps.length,
      scope: this.scope,
      label,
      state: "running",
      detail: "",
    };
    this.#steps.push(step);
    this.#changed();
    try {
      const value = await run();
      step.state = "done";
      step.detail = detail?.(value) ?? "";
      return value;
    } catch (error) {
      step.state = "failed";
      step.detail = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.#log(step);
      this.#changed();
    }
  }

  // Live counter inside a running step, e.g. "12/40".
  note(detail: string) {
    const step = this.#steps.at(-1);
    if (step?.state !== "running") return;
    step.detail = detail;
    this.#changed();
  }

  show(tail: ReactNode) {
    this.#tail = tail;
    this.#changed();
  }

  #log(step: Step) {
    if (this.#output.mode !== "plain") return;
    const mark = step.state === "done" ? "ok" : "fail";
    const line = [new Date().toISOString(), mark, step.scope, step.label, step.detail];
    process.stdout.write(`${line.join("\t")}\n`);
  }
}

function StepLine({ step }: { step: Step }) {
  const mark =
    step.state === "running" ? (
      <Spinner />
    ) : (
      <Text color={step.state === "done" ? color.ok : color.error}>
        {step.state === "done" ? symbol.ok : symbol.fail}
      </Text>
    );
  return (
    <Box gap={1}>
      {mark}
      {step.scope ? <Text color={color.muted}>{step.scope}</Text> : null}
      <Text>{step.label}</Text>
      {step.detail ? (
        <Text color={step.state === "failed" ? color.error : color.muted}>{step.detail}</Text>
      ) : null}
    </Box>
  );
}

function ProgressView({ progress }: { progress: Progress }) {
  useSyncExternalStore(progress.subscribe, progress.version);
  return (
    <Box flexDirection="column">
      {progress.steps.map((step) => (
        <StepLine key={step.id} step={step} />
      ))}
      {progress.tail ? <Box marginTop={1}>{progress.tail}</Box> : null}
    </Box>
  );
}

// Runs `body` with a live step list; whatever it passes to `show` is drawn
// under the steps and left on screen when the run ends.
export async function withProgress<T>(
  output: Output,
  body: (progress: Progress) => Promise<T>,
): Promise<T> {
  const progress = new Progress(output);
  if (output.mode !== "ink") return body(progress);
  const app = render(<ProgressView progress={progress} />, { exitOnCtrlC: true });
  try {
    return await body(progress);
  } finally {
    // One more frame so the last state is what stays in the scrollback.
    await new Promise((resolve) => setTimeout(resolve, 20));
    app.unmount();
    await app.waitUntilExit();
  }
}
