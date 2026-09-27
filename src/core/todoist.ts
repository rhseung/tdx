// The Todoist API v1, as thin as it can be: a client, cursor paging, and the
// shapes every feature reads.

import type { z } from "zod";
import type { Day } from "./day.ts";
import { type Api, Client, type Params } from "./http.ts";
import type { Priority } from "./priority.ts";
import { page, parse, TodoistProject, TodoistTask } from "./schema.ts";
import { cliToken } from "./token.ts";

const BASE_URL = "https://api.todoist.com/api/v1";
const PAGE = 200;

export function client(): Client {
  return new Client(BASE_URL, cliToken("TODOIST_API_TOKEN", ["td", "auth", "token", "view"]));
}

// Every page is checked against `item` as it arrives, so a reply in an
// unexpected shape stops the read before any of it is acted on.
export async function allPages<S extends z.ZodType>(
  api: Api,
  path: string,
  item: S,
  params: Params = {},
): Promise<z.output<S>[]> {
  const out: z.output<S>[] = [];
  let cursor: string | undefined;
  do {
    const reply = parse(
      page(item),
      await api.get(path, { limit: PAGE, cursor, ...params }),
      `GET ${path}`,
    );
    out.push(...reply.results);
    cursor = reply.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

export interface Task {
  id: string;
  content: string;
  description: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  priority: Priority;
  labels: string[];
  deadline: Day | null;
  due: Day | null;
  isRecurring: boolean;
  childOrder: number;
  noteCount: number;
}

export function toTask(raw: z.output<typeof TodoistTask>): Task {
  return {
    id: raw.id,
    content: raw.content,
    description: raw.description,
    projectId: raw.project_id,
    sectionId: raw.section_id,
    parentId: raw.parent_id,
    priority: raw.priority,
    labels: raw.labels,
    deadline: raw.deadline?.date ?? null,
    due: raw.due ? raw.due.date.slice(0, 10) : null,
    isRecurring: raw.due?.is_recurring ?? false,
    childOrder: raw.child_order,
    noteCount: raw.note_count,
  };
}

export async function tasks(api: Api, params: Params): Promise<Task[]> {
  return (await allPages(api, "/tasks", TodoistTask, params)).map(toTask);
}

export interface Project {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  isInbox: boolean;
}

export async function projects(api: Api): Promise<Project[]> {
  return (await allPages(api, "/projects", TodoistProject)).map((raw) => ({
    id: raw.id,
    name: raw.name,
    description: raw.description,
    parentId: raw.parent_id,
    isInbox: raw.inbox_project ?? false,
  }));
}
