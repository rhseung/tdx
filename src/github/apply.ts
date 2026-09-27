// Todoist's current state for the GitHub tree, and how ops are carried out.

import type { Api } from "../core/http.ts";
import { Created, parse, TodoistLabel, TodoistProject, TodoistSection } from "../core/schema.ts";
import { allPages, tasks as readTasks } from "../core/todoist.ts";
import {
  LABEL_COLORS,
  type LabelInfo,
  type ProjectInfo,
  ROOT_NAME,
  type SectionInfo,
  type Snapshot,
  sectionKey,
  type TaskInfo,
} from "./models.ts";
import type { Op, ProjectRef, SectionRef } from "./reconcile.ts";
import { forget, type GithubState } from "./state.ts";

// An id written into the state file has to be a real one: a create that came
// back without it would otherwise be recorded as `undefined` and rebuilt.
const created = (reply: unknown): string => parse(Created, reply, "a created object").id;

async function ourLabels(api: Api): Promise<Record<string, LabelInfo>> {
  const out: Record<string, LabelInfo> = {};
  for (const raw of await allPages(api, "/labels", TodoistLabel)) {
    if (Object.hasOwn(LABEL_COLORS, raw.name)) out[raw.name] = { id: raw.id, color: raw.color };
  }
  return out;
}

// Read Todoist back through the ids the state file remembers.
//
// Anything the state file points at that Todoist no longer has is dropped from
// both, so a project deleted by hand is simply rebuilt on the next run.
export async function snapshot(api: Api, state: GithubState): Promise<Snapshot> {
  const labels = await ourLabels(api);
  const projects = new Map(
    (await allPages(api, "/projects", TodoistProject)).map((p) => [p.id, p]),
  );
  for (const projectId of Object.values(state.orgs)) {
    if (!projects.has(projectId)) forget(state, projectId);
  }
  if (!state.root || !projects.has(state.root)) {
    state.root = null;
    return {
      root: null,
      orgs: {},
      sections: new Map(),
      tasks: {},
      occupied: new Set(),
      emptySince: {},
      labels,
    };
  }

  const info = (id: string): ProjectInfo => {
    const raw = projects.get(id);
    return { id, name: raw?.name ?? "", description: raw?.description ?? "" };
  };
  const orgs: Record<string, ProjectInfo> = {};
  for (const [ownerId, pid] of Object.entries(state.orgs)) {
    if (projects.has(pid)) orgs[ownerId] = info(pid);
  }
  const repoOf = new Map(Object.entries(state.sections).map(([repo, section]) => [section, repo]));
  const ghOf = new Map(Object.entries(state.tasks).map(([gh, task]) => [task, gh]));

  const sections = new Map<string, SectionInfo>();
  const tasks: Record<string, TaskInfo> = {};
  const occupied = new Set<string>();
  const seen = new Set<string>();
  for (const projectId of [state.root, ...Object.values(orgs).map((p) => p.id)]) {
    for (const raw of await allPages(api, "/sections", TodoistSection, { project_id: projectId })) {
      seen.add(raw.id);
      const repoId = repoOf.get(raw.id);
      if (repoId) {
        sections.set(sectionKey(projectId, repoId), {
          id: raw.id,
          name: raw.name,
          projectId,
          description: raw.description ?? "",
        });
      }
    }
    for (const task of await readTasks(api, { project_id: projectId })) {
      seen.add(task.id);
      occupied.add(task.projectId);
      if (task.sectionId) occupied.add(task.sectionId);
      const ghId = ghOf.get(task.id);
      if (ghId) {
        tasks[ghId] = {
          id: task.id,
          content: task.content,
          projectId: task.projectId,
          sectionId: task.sectionId,
          priority: task.priority,
          deadline: task.deadline,
          labels: task.labels,
          description: task.description,
          childOrder: task.childOrder,
        };
      }
    }
  }
  for (const todoistId of [...Object.values(state.sections), ...Object.values(state.tasks)]) {
    if (!seen.has(todoistId)) forget(state, todoistId);
  }

  return {
    root: info(state.root),
    orgs,
    sections,
    tasks,
    occupied,
    emptySince: { ...state.emptySince },
    labels,
  };
}

// Runs ops in order, recording into the state file what each one created.
//
// The state file doubles as the symbolic-reference table: a project created
// earlier in this same run is already in it by the time an op refers to it.
class Applier {
  constructor(
    private readonly api: Api,
    private readonly state: GithubState,
  ) {}

  project(ref: ProjectRef): string {
    switch (ref.kind) {
      case "existing":
        return ref.id;
      case "newRoot":
        if (!this.state.root) throw new Error("root project referenced before it was created");
        return this.state.root;
      case "newOrg":
        return this.#created(this.state.orgs[ref.ownerId], `org ${ref.ownerId}`);
    }
  }

  section(ref: SectionRef): string {
    return ref.kind === "existing"
      ? ref.id
      : this.#created(this.state.sections[ref.repoId], `section for repo ${ref.repoId}`);
  }

  #created(id: string | undefined, what: string): string {
    if (!id) throw new Error(`${what} referenced before it was created`);
    return id;
  }

  async run(op: Op): Promise<void> {
    const { api, state } = this;
    switch (op.kind) {
      case "CreateRoot":
        state.root = created(await api.post("/projects", { name: ROOT_NAME }));
        return;
      case "CreateOrgProject":
        state.orgs[op.ownerId] = created(
          await api.post("/projects", {
            name: op.name,
            parent_id: this.project({ kind: "newRoot" }),
            description: op.description,
          }),
        );
        return;
      case "RenameProject":
        await api.post(`/projects/${op.id}`, { name: op.name });
        return;
      case "CreateSection":
        state.sections[op.repoId] = created(
          await api.post("/sections", {
            name: op.name,
            project_id: this.project(op.project),
            description: op.description,
          }),
        );
        return;
      case "RenameSection":
        await api.post(`/sections/${op.id}`, { name: op.name });
        return;
      case "CreateTask":
        state.tasks[op.ghId] = created(
          await api.post("/tasks", {
            content: op.content,
            description: op.description,
            priority: op.priority,
            labels: op.labels,
            project_id: this.project(op.project),
            section_id: this.section(op.section),
            deadline_date: op.deadline,
          }),
        );
        return;
      case "UpdateTask":
        await api.post(`/tasks/${op.id}`, {
          content: op.content,
          description: op.description,
          priority: op.priority,
          labels: op.labels,
          deadline_date: op.deadline,
        });
        return;
      case "ReorderTasks": {
        // The REST surface has no place to state an order, so this is the one
        // sync command the tool sends. Ids created earlier in this same run are
        // already in state, so a fresh task lands in place.
        const items = op.ghIds
          .map((ghId, index) => ({ id: state.tasks[ghId], child_order: index }))
          .filter((item) => item.id);
        if (items.length) {
          await api.post("/sync", {
            commands: [{ type: "item_reorder", uuid: crypto.randomUUID(), args: { items } }],
          });
        }
        return;
      }
      case "MoveTask":
        await api.post(`/tasks/${op.id}/move`, {
          project_id: this.project(op.project),
          section_id: this.section(op.section),
        });
        return;
      case "CompleteTask":
        await api.post(`/tasks/${op.id}/close`);
        delete state.tasks[op.ghId];
        return;
      case "DeleteTask":
        await api.delete(`/tasks/${op.id}`);
        delete state.tasks[op.ghId];
        return;
      case "SetDescription":
        await api.post(`/${op.collection}/${op.id}`, { description: op.description });
        return;
      case "Delete":
        await api.delete(`/${op.collection}/${op.id}`);
        forget(state, op.id);
        return;
      case "MarkEmpty":
        if (op.since === null) delete state.emptySince[op.id];
        else state.emptySince[op.id] = op.since;
        return;
      case "SetLabel":
        await api.post(op.id ? `/labels/${op.id}` : "/labels", { name: op.name, color: op.color });
        return;
    }
  }
}

// Saves whatever got applied, even if an op throws partway through.
//
// Without that, a run that dies after creating tasks would forget their ids and
// build a second copy of every one of them on the next run.
export async function apply(
  api: Api,
  state: GithubState,
  ops: Op[],
  save: (state: GithubState) => void,
  onOp: (op: Op, index: number) => void = () => {},
): Promise<void> {
  const applier = new Applier(api, state);
  try {
    for (const [index, op] of ops.entries()) {
      await applier.run(op);
      onOp(op, index);
    }
  } finally {
    save(state);
  }
}
