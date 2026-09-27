#!/usr/bin/env bun
import Pastel from "pastel";
import pkg from "../package.json" with { type: "json" };

// Outside a terminal stdout is data -- fzf input, a pipe, the launchd log --
// and two things Ink does there would corrupt it or crash on it:
//
// - On exit it prints its last frame and a newline. Commands render nothing
//   when piped, so all that arrives is a blank line, which fzf would list as
//   an empty entry. Every write of ours carries its own text, so a bare
//   newline can only be Ink's, and is dropped.
// - When the reader has already gone (`| head`, fzf after a pick), Bun throws
//   EPIPE from the write itself. Nobody is left to read, so that is the end
//   of the run, not an error.
if (!process.stdout.isTTY) {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (chunk === "\n") {
      const done = rest.find((r) => typeof r === "function") as (() => void) | undefined;
      done?.();
      return true;
    }
    try {
      return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
    } catch (error) {
      if ((error as { code?: string }).code === "EPIPE") process.exit(0);
      throw error;
    }
  }) as typeof process.stdout.write;
}

// Name, version and description are given, not found: Pastel would otherwise
// read package.json upward from the working directory, and tdx is run from
// anywhere -- inside another project it would print that project's version.
await new Pastel({
  importMeta: import.meta,
  name: "tdx",
  version: pkg.version,
  description: "A personal Todoist toolkit that fills the gaps td leaves.",
}).run();
