// Templates in Todoist, and the tasks made from them.

import type { Api } from "../core/http.ts";
import { readJson, statePath, writeJson } from "../core/state.ts";
import { allPages, type Project, projects, type Task, toTask } from "../core/todoist.ts";
import { emptyRecurState, type RecurOp, type RecurState, type TemplateTask } from "./plan.ts";

// Templates live in one project of their own. A task there has no due date,
// so it never shows up in Today or Upcoming, yet it is a plain Todoist task:
// the phone app can edit a rule without this tool anywhere near.
export const TEMPLATES_PROJECT = "Templates";

export function loadState(path: string = statePath("recur")): RecurState {
  const raw = readJson(path) as Partial<RecurState> | undefined;
  return { ...emptyRecurState(), ...raw };
}

export function saveState(state: RecurState, path: string = statePath("recur")): void {
  writeJson(path, state);
}

export interface Workspace {
  projects: Project[];
  templatesProject: Project | null;
  templates: TemplateTask[];
}

export function byName(list: Project[]): Map<string, string> {
  return new Map(list.map((p) => [p.name.toLowerCase(), p.id]));
}

export function toTemplates(tasks: Task[]): TemplateTask[] {
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
          content: c.content,
          description: c.description,
          priority: c.priority,
          labels: c.labels,
        })),
    }));
}

export async function readWorkspace(api: Api): Promise<Workspace> {
  const all = await projects(api);
  const templatesProject = all.find((p) => p.name === TEMPLATES_PROJECT) ?? null;
  if (!templatesProject) return { projects: all, templatesProject, templates: [] };
  const tasks = (await allPages(api, "/tasks", { project_id: templatesProject.id })).map(toTask);
  return { projects: all, templatesProject, templates: toTemplates(tasks) };
}

export async function ensureTemplatesProject(api: Api, workspace: Workspace): Promise<string> {
  if (workspace.templatesProject) return workspace.templatesProject.id;
  const created = await api.post("/projects", {
    name: TEMPLATES_PROJECT,
    description: "Recurring assignment templates for `tdx recur`. Each task here is a rule.",
  });
  return created.id;
}

async function createTask(api: Api, body: Record<string, unknown>): Promise<string> {
  return (await api.post("/tasks", body)).id;
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
            ...(task.projectId ? { project_id: task.projectId } : {}),
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
  saveState(state);
}
