// Templates in Todoist, and the tasks made from them.

import type { Api } from "../core/http.ts";
import { Created, parse, RecurStateFile, TodoistSection } from "../core/schema.ts";
import { readState, statePath, writeJson } from "../core/state.ts";
import {
  allPages,
  type Project,
  projects,
  tasks as readTasks,
  type Task,
} from "../core/todoist.ts";
import { t } from "../i18n/index.ts";
import type { Directory, OpenTask, RecurOp, RecurState, TemplateTask } from "./plan.ts";

// Templates live in one project of their own. A task there has no due date,
// so it never shows up in Today or Upcoming, yet it is a plain Todoist task:
// the phone app can edit a rule without this tool anywhere near.
export const TEMPLATES_PROJECT = "Templates";

export const createdId = (reply: unknown): string => parse(Created, reply, "a created object").id;

export function loadState(path: string = statePath("recur")): RecurState {
  return readState(path, RecurStateFile);
}

function saveState(state: RecurState, path: string = statePath("recur")): void {
  writeJson(path, state);
}

interface Section {
  id: string;
  name: string;
  projectId: string;
}

export interface Workspace {
  projects: Project[];
  sections: Section[];
  templatesProject: Project | null;
  templates: TemplateTask[];
}

export function directory(workspace: Workspace): Directory {
  const inbox = workspace.projects.find((p) => p.isInbox);
  if (!inbox) throw new Error("Todoist returned no Inbox project");
  const sections = new Map<string, Map<string, string>>();
  for (const s of workspace.sections) {
    const names = sections.get(s.projectId) ?? new Map<string, string>();
    names.set(s.name.toLowerCase(), s.id);
    sections.set(s.projectId, names);
  }
  return {
    inboxId: inbox.id,
    projects: new Map(workspace.projects.map((p) => [p.name.toLowerCase(), p.id])),
    sections,
  };
}

// Section names per project name, for the form's picker. The Inbox is keyed
// by null, as a template with no project line means it.
export function sectionNames(workspace: Workspace): (project: string | null) => string[] {
  return (project) => {
    const owner = project
      ? workspace.projects.find((p) => p.name.toLowerCase() === project.toLowerCase())
      : workspace.projects.find((p) => p.isInbox);
    return workspace.sections.filter((s) => s.projectId === owner?.id).map((s) => s.name);
  };
}

function toTemplates(tasks: Task[]): TemplateTask[] {
  const children = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    children.set(task.parentId, [...(children.get(task.parentId) ?? []), task]);
  }
  return tasks
    .filter((task) => !task.parentId)
    .sort((a, b) => a.childOrder - b.childOrder)
    .map((task) => ({
      id: task.id,
      content: task.content,
      description: task.description,
      priority: task.priority,
      labels: task.labels,
      children: (children.get(task.id) ?? [])
        .sort((a, b) => a.childOrder - b.childOrder)
        .map((c) => ({
          id: c.id,
          content: c.content,
          description: c.description,
          priority: c.priority,
          labels: c.labels,
        })),
    }));
}

export async function readWorkspace(api: Api): Promise<Workspace> {
  const all = await projects(api);
  const sections = (await allPages(api, "/sections", TodoistSection)).map((s) => ({
    id: s.id,
    name: s.name,
    projectId: s.project_id,
  }));
  const templatesProject = all.find((p) => p.name === TEMPLATES_PROJECT) ?? null;
  if (!templatesProject) return { projects: all, sections, templatesProject, templates: [] };
  const tasks = await readTasks(api, { project_id: templatesProject.id });
  return { projects: all, sections, templatesProject, templates: toTemplates(tasks) };
}

// Where the given tasks stand now. Only unfinished tasks come back, which is
// what moving wants: a finished task stays where it was finished.
const IDS_PER_CALL = 100;
export async function openTasks(api: Api, ids: string[]): Promise<Map<string, OpenTask>> {
  const out = new Map<string, OpenTask>();
  for (let start = 0; start < ids.length; start += IDS_PER_CALL) {
    const batch = ids.slice(start, start + IDS_PER_CALL).join(",");
    for (const task of await readTasks(api, { ids: batch })) {
      out.set(task.id, {
        projectId: task.projectId,
        sectionId: task.sectionId,
        content: task.content,
      });
    }
  }
  return out;
}

export async function ensureTemplatesProject(api: Api, workspace: Workspace): Promise<string> {
  if (workspace.templatesProject) return workspace.templatesProject.id;
  const created = await api.post("/projects", {
    name: TEMPLATES_PROJECT,
    description: t.recur.templatesProjectDescription,
  });
  return createdId(created);
}

async function createTask(api: Api, body: Record<string, unknown>): Promise<string> {
  return createdId(await api.post("/tasks", body));
}

// Records each op as soon as it lands, so a run that dies halfway still
// remembers what it made and never makes it twice.
export async function applyOps(
  api: Api,
  state: RecurState,
  ops: RecurOp[],
  onOp: (op: RecurOp, index: number) => void = () => {},
): Promise<void> {
  try {
    for (const [index, op] of ops.entries()) {
      switch (op.kind) {
        case "CreateInstance": {
          const { task } = op;
          const id = await createTask(api, {
            content: task.content,
            description: task.description,
            priority: task.priority,
            labels: task.labels,
            project_id: task.place.projectId,
            ...(task.place.sectionId ? { section_id: task.place.sectionId } : {}),
            deadline_date: task.deadline,
            ...(task.due ? { due_date: task.due } : {}),
          });
          state.created[op.templateId] = { ...state.created[op.templateId], [op.deadline]: id };
          for (const sub of op.subtasks) {
            await createTask(api, { ...sub, parent_id: id });
          }
          break;
        }
        case "ReportError":
          await api.post("/comments", {
            task_id: op.templateId,
            content: `tdx recur can not read this template:\n${op.message}`,
          });
          state.reported[op.templateId] = op.hash;
          break;
        case "ClearError":
          delete state.reported[op.templateId];
          break;
        case "MoveInstance":
          // One target only: a section already names its project.
          await api.post(
            `/tasks/${op.taskId}/move`,
            op.to.sectionId ? { section_id: op.to.sectionId } : { project_id: op.to.projectId },
          );
          break;
        case "SetPlace":
          state.placed[op.templateId] = op.place;
          break;
      }
      onOp(op, index);
    }
  } finally {
    saveState(state);
  }
}

// Only an explicit delete drops a template's history. A template that merely
// vanished from a read may have been completed by accident and restored, and
// forgetting what it made would make the open weeks a second time.
export async function deleteTemplate(api: Api, state: RecurState, id: string): Promise<void> {
  await api.delete(`/tasks/${id}`);
  delete state.created[id];
  delete state.reported[id];
  delete state.placed[id];
  saveState(state);
}
