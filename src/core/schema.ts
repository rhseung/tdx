// The shape of everything this tool reads from outside: API replies and its
// own state files.
//
// It runs unattended every two minutes, so the failure worth guarding against
// is not a crash but a quiet misread. Were Todoist to rename `deadline`, a
// field read as `raw.deadline ?? null` would come back null for every task,
// and the GitHub sync would faithfully clear every deadline it owns. Parsed
// here, the same change stops the run before anything is written.
//
// Hence the one rule of this file: a field whose absence would be read as
// "empty" is `.nullable()`, never `.optional()`. The key has to be there, even
// when its value is null.

import { z } from "zod";
import { isDay } from "./day.ts";

export class SchemaError extends Error {}

export function parse<S extends z.ZodType>(schema: S, value: unknown, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new SchemaError(`${what} is not in the expected shape: ${issues}`);
}

const Day = z.string().refine(isDay, "not a YYYY-MM-DD date");
// Todoist sends "" for an empty description, but null has been seen on older
// objects; both mean the same thing here.
const text = z
  .string()
  .nullable()
  .transform((v) => v ?? "");
const id = z.string().min(1);

// --- Todoist ------------------------------------------------------------------

export const page = <S extends z.ZodType>(item: S) =>
  z.object({ results: z.array(item), next_cursor: z.string().nullable() });

export const TodoistTask = z.object({
  id,
  content: z.string(),
  description: text,
  project_id: id,
  section_id: id.nullable(),
  parent_id: id.nullable(),
  priority: z.number().int().min(1).max(4),
  labels: z.array(z.string()),
  deadline: z.object({ date: Day }).nullable(),
  due: z
    .object({
      // A timed due date reads "2026-10-02T09:00:00"; only the day is used.
      date: z.string().refine((v) => isDay(v.slice(0, 10)), "not a date"),
      is_recurring: z.boolean(),
    })
    .nullable(),
  child_order: z.number().int(),
});

export const TodoistProject = z.object({
  id,
  name: z.string(),
  description: text,
  parent_id: id.nullable(),
  inbox_project: z.boolean().optional(),
});

export const TodoistSection = z.object({
  id,
  name: z.string(),
  project_id: id,
  description: text.optional(),
});

export const TodoistLabel = z.object({ id, name: z.string(), color: z.string() });

export const Created = z.object({ id });

// --- GitHub -------------------------------------------------------------------

export const GithubRepo = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  archived: z.boolean(),
  owner: z.object({ id: z.number(), login: z.string(), type: z.string() }),
});

// Issues and PRs from both the REST list and search. `milestone` is where the
// deadline comes from, so it has to be present even when there is none.
export const GithubIssue = z.object({
  node_id: id,
  number: z.number().int(),
  title: z.string(),
  html_url: z.string(),
  milestone: z.object({ due_on: z.string().nullable() }).nullable(),
  pull_request: z.unknown().optional(),
  repository: GithubRepo.optional(),
  repository_url: z.string().optional(),
});

export const GithubSearch = z.object({ items: z.array(GithubIssue) });

export const graphql = <S extends z.ZodType>(node: S) =>
  z.object({
    // No data (null or absent) with errors is a refusal, and the caller stops
    // on it; data with some errors is the normal case of an id that no longer
    // resolves, and its node is simply null.
    data: z.object({ nodes: z.array(node.nullable()) }).nullish(),
    errors: z.unknown().optional(),
  });

export const DiscardedNode = z.object({
  id,
  stateReason: z.string().nullish(),
  state: z.string().optional(),
});

const edges = z.object({
  nodes: z.array(
    z.object({
      id,
      number: z.number().int(),
      state: z.string(),
      repository: z.object({ nameWithOwner: z.string() }),
    }),
  ),
});

export const RelationNode = z.object({ id, blockedBy: edges, blocking: edges });

// --- state files --------------------------------------------------------------
// Keys a newer version added default to empty, so an older file still reads.

const ids = z.record(z.string(), z.string());

export const GithubStateFile = z.object({
  root: id.nullable().default(null),
  orgs: ids.default({}),
  sections: ids.default({}),
  tasks: ids.default({}),
  empty_since: z.record(z.string(), Day).default({}),
});

export const RecurStateFile = z.object({
  created: z.record(z.string(), z.record(Day, z.string())).default({}),
  reported: z.record(z.string(), z.string()).default({}),
  placed: z
    .record(z.string(), z.object({ projectId: z.string(), sectionId: z.string().nullable() }))
    .default({}),
});

export const NudgeStateFile = z.object({ nudged: z.record(z.string(), Day).default({}) });

export const ConfigFile = z.object({ disabled: z.array(z.string()).default([]) });

export const RunsFile = z.record(
  z.string(),
  z.object({ at: z.string(), ok: z.boolean(), summary: z.string() }),
);
