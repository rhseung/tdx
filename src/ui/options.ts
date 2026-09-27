// The switches every printing command shares, as a zod schema Pastel turns
// into flags. One definition, so a script or an fzf binding can rely on them
// without reading each command's help.

import { option } from "pastel";
import { z } from "zod";
import { t } from "../i18n/index.ts";

export const outputOptions = z.object({
  json: z
    .boolean()
    .default(false)
    .describe(option({ description: t.help.json })),
  color: z
    .enum(["auto", "always", "never"])
    .default("auto")
    .describe(option({ description: t.help.color, valueDescription: "when" })),
  header: z
    .boolean()
    .default(false)
    .describe(option({ description: t.help.header })),
  // A true default is how Pastel spells a `--no-pager` flag.
  pager: z
    .boolean()
    .default(true)
    .describe(option({ description: t.help.pager })),
});

export const dryRun = z
  .boolean()
  .default(false)
  .describe(option({ description: t.help.dryRun, alias: "n" }));
