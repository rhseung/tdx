// The switches every printing command shares, as a zod schema Pastel turns
// into flags. One definition, so a script or an fzf binding can rely on them
// without reading each command's help.

import { option } from "pastel";
import { z } from "zod";

export const outputOptions = z.object({
  json: z
    .boolean()
    .default(false)
    .describe(option({ description: "Print JSON instead of a table" })),
  color: z
    .enum(["auto", "always", "never"])
    .default("auto")
    .describe(option({ description: "Colour in plain output", valueDescription: "when" })),
  header: z
    .boolean()
    .default(false)
    .describe(option({ description: "Put a header line on plain output (fzf --header-lines=1)" })),
  // A true default is how Pastel spells a `--no-pager` flag.
  pager: z
    .boolean()
    .default(true)
    .describe(option({ description: "Print long tables instead of opening a scrolling view" })),
});

export const dryRun = z
  .boolean()
  .default(false)
  .describe(option({ description: "Show what would change, change nothing", alias: "n" }));
