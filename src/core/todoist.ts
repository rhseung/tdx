// The Todoist API v1, as thin as it can be: a client, cursor paging, and the
// shapes every feature reads.

import { type Day, isDay } from "./day.ts";
import { type Api, Client, type Json, type Params } from "./http.ts";
import { cliToken } from "./token.ts";

export const BASE_URL = "https://api.todoist.com/api/v1";
const PAGE = 200;

export function client(): Client {
  return new Client(BASE_URL, cliToken("TODOIST_API_TOKEN", ["td", "auth", "token", "view"]));
}

export async function allPages(api: Api, path: string, params: Params = {}): Promise<Json[]> {
  const out: Json[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.get(path, { limit: PAGE, cursor, ...params });
    out.push(...page.results);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

export function parseDeadline(raw: Json): Day | null {
  const value = raw && typeof raw === "object" ? raw.date : raw;
  return isDay(value) ? value : null;
}

// A due date can carry a time ("2026-10-02T09:00:00"); only the day matters here.
export function parseDue(raw: Json): Day | null {
  const value: unknown = raw?.date;
  return typeof value === "string" && isDay(value.slice(0, 10)) ? value.slice(0, 10) : null;
}

export interface Task {
  id: string;
  content: string;
  description: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  priority: number;
  labels: string[];
  deadline: Day | null;
  due: Day | null;
  isRecurring: boolean;
  childOrder: number;
}

export function toTask(raw: Json): Task {
  return {
    id: raw.id,
    content: raw.content,
    description: raw.description ?? "",
    projectId: raw.project_id,
    sectionId: raw.section_id ?? null,
    parentId: raw.parent_id ?? null,
    priority: raw.priority,
    labels: raw.labels ?? [],
    deadline: parseDeadline(raw.deadline),
    due: parseDue(raw.due),
    isRecurring: Boolean(raw.due?.is_recurring),
    childOrder: raw.child_order ?? 0,
  };
}

export interface Project {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  isInbox: boolean;
}

export async function projects(api: Api): Promise<Project[]> {
  return (await allPages(api, "/projects")).map((raw) => ({
    id: raw.id,
    name: raw.name,
    description: raw.description ?? "",
    parentId: raw.parent_id ?? null,
    isInbox: Boolean(raw.inbox_project),
  }));
}
