// Shared vocabulary between the GitHub side, the Todoist side, and reconcile.
//
// Nothing here touches the network, so the pure logic and its tests stay cheap.

import type { Day } from "../core/day.ts";

export const ROOT_NAME = "GitHub";

// Todoist's API priority runs backwards from the p1..p4 labels in the UI.
export const PRIORITY_ISSUE = 1; // p4
export const PRIORITY_PR = 3; // p2

// Priority says how urgent, not what kind, so the kind is a label -- which is
// also what `@gh-pr` in a Todoist filter can select on. The colours are the ones
// GitHub itself uses for the two icons, so the sidebar reads at a glance.
export const LABEL_PR = "gh-pr";
export const LABEL_ISSUE = "gh-issue";
// Blocked work is still mine, so it keeps its kind label and gains this one. A
// filter of `!@gh-blocked` is then the list of what can actually be started.
export const LABEL_BLOCKED = "gh-blocked";
export const LABEL_COLORS: Record<string, string> = {
  [LABEL_PR]: "grape",
  [LABEL_ISSUE]: "green",
  [LABEL_BLOCKED]: "red",
};

// Another GitHub issue this one depends on, or that depends on it.
export interface Ref {
  ghId: string;
  number: number;
  repo: string; // owner/name
}

function mention(ref: Ref, here: string): string {
  // Same repo reads as #12; anywhere else needs the full name to resolve.
  return ref.repo === here ? `#${ref.number}` : `${ref.repo}#${ref.number}`;
}

// One piece of GitHub work assigned to me.
export interface Item {
  ghId: string; // GraphQL node id, stable across renames and transfers
  isPr: boolean;
  repoId: string;
  repoName: string;
  ownerId: string;
  ownerLogin: string;
  ownerIsOrg: boolean;
  number: number;
  title: string;
  url: string;
  deadline: Day | null;
  // Only open dependencies are carried: a closed blocker no longer blocks.
  blockedBy: Ref[];
  blocking: Ref[];
}

function fullRepo(item: Item): string {
  return `${item.ownerLogin}/${item.repoName}`;
}

// What this waits on, so the task answers that without opening GitHub.
export function description(item: Item): string {
  const here = fullRepo(item);
  const lines: string[] = [];
  if (item.blockedBy.length) {
    lines.push(`blocked by ${item.blockedBy.map((r) => mention(r, here)).join(", ")}`);
  }
  if (item.blocking.length) {
    lines.push(`blocks ${item.blocking.map((r) => mention(r, here)).join(", ")}`);
  }
  return lines.join("\n");
}

// Todoist renders markdown, so the number doubles as a link. The repo is left
// out because the section already names it.
export function content(item: Item): string {
  return `[#${item.number}](${item.url}) ${item.title}`;
}

// Written as an explicit markdown link, not a bare URL: Todoist rewrites a bare
// URL into a titled link of its own, which would read as a change on every
// single poll and rewrite the description forever.
function ownerUrl(item: Item): string {
  return `https://github.com/${item.ownerLogin}`;
}

export function projectDescription(item: Item): string {
  return `[${item.ownerLogin}](${ownerUrl(item)})`;
}

export function sectionDescription(item: Item): string {
  return `[${item.repoName}](${ownerUrl(item)}/${item.repoName})`;
}

export function priority(item: Item): number {
  return item.isPr ? PRIORITY_PR : PRIORITY_ISSUE;
}

// This item's kind and state, on top of whatever was added by hand.
export function labels(item: Item, current: readonly string[] = []): string[] {
  const ours = [
    item.isPr ? LABEL_PR : LABEL_ISSUE,
    ...(item.blockedBy.length ? [LABEL_BLOCKED] : []),
  ];
  return [...current.filter((x) => !Object.hasOwn(LABEL_COLORS, x)), ...ours];
}

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
}

export interface SectionInfo {
  id: string;
  name: string;
  projectId: string;
  description: string;
}

export interface TaskInfo {
  id: string;
  content: string;
  projectId: string;
  sectionId: string | null;
  priority: number;
  deadline: Day | null;
  labels: string[];
  description: string;
  childOrder: number;
}

export interface LabelInfo {
  id: string;
  color: string;
}

// Todoist's current state, indexed by GitHub id through the state file.
export interface Snapshot {
  root: ProjectInfo | null;
  orgs: Record<string, ProjectInfo>; // owner_id -> sub-project
  sections: Map<string, SectionInfo>; // sectionKey(project_id, repo_id) -> section
  tasks: Record<string, TaskInfo>; // gh_id -> task
  // Every task counts here, ours or not: deleting a container takes whatever
  // is inside it, so a hand written note is enough to keep one alive.
  occupied: Set<string>; // project and section ids holding a task
  emptySince: Record<string, Day>; // id -> first seen empty
  labels: Record<string, LabelInfo>; // label name -> label
}

export function sectionKey(projectId: string, repoId: string): string {
  return `${projectId}\u0000${repoId}`;
}
