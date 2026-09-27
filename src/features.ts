// Every feature `tdx run` knows about, in the order it runs them.
//
// GitHub goes first: it is the one that can refuse a whole run (the bulk
// completion guard), and nothing after it depends on it.

import { syncGithub } from "./github/feature.tsx";
import { runNudge } from "./nudge/nudge.ts";
import { runRecur } from "./recur/feature.tsx";
import type { OpRow } from "./ui/parts.tsx";
import type { Progress } from "./ui/progress.tsx";

export interface FeatureResult {
  ops: OpRow[];
  summary: string;
}

export interface Feature {
  name: string;
  description: string;
  run: (progress: Progress, options: { dryRun: boolean }) => Promise<FeatureResult>;
}

export const FEATURES: Feature[] = [
  {
    name: "gh",
    description: "mirror GitHub issues and PRs assigned to me",
    run: (progress, { dryRun }) => syncGithub(progress, { dryRun }),
  },
  {
    name: "recur",
    description: "make recurring assignments from the Templates project",
    run: (progress, { dryRun }) => runRecur(progress, { dryRun }),
  },
  // Last, so a task recur made this run is already there to be looked at.
  {
    name: "nudge",
    description: "pull tasks with a near deadline and no due date into Today",
    run: (progress, { dryRun }) => runNudge(progress, { dryRun }),
  },
];
