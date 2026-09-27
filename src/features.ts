// Every feature `tdx run` knows about, in the order it runs them.
//
// GitHub goes first: it is the one that can refuse a whole run (the bulk
// completion guard), and nothing after it depends on it.

import { syncGithub } from "./github/feature.tsx";
import { t } from "./i18n/index.ts";
import { runNudge } from "./nudge/nudge.ts";
import { runRecur } from "./recur/feature.tsx";
import type { OpRow } from "./ui/parts.tsx";
import type { Progress } from "./ui/progress.tsx";

interface FeatureResult {
  ops: OpRow[];
  summary: string;
  counts: number[];
}

export interface Feature {
  name: string;
  description: string;
  run: (progress: Progress, options: { dryRun: boolean }) => Promise<FeatureResult>;
}

export const FEATURES: Feature[] = [
  {
    name: "gh",
    description: t.help.features["gh"] ?? "",
    run: syncGithub,
  },
  {
    name: "recur",
    description: t.help.features["recur"] ?? "",
    run: runRecur,
  },
  // Last, so a task recur made this run is already there to be looked at.
  {
    name: "nudge",
    description: t.help.features["nudge"] ?? "",
    run: runNudge,
  },
];
