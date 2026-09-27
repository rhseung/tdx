// An in-memory Todoist, answering in the same shapes as API v1.
//
// Replies go through the real schemas, so a fake that drifted from what the
// code expects fails the same way the real API would. Every call is recorded
// so a test can say exactly what was written.

import type { Api, Json, Params } from "../src/core/http.ts";

export interface Call {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: Record<string, unknown> | undefined;
}

type Row = Record<string, Json>;

export class FakeTodoist implements Api {
  calls: Call[] = [];
  projects: Row[] = [];
  sections: Row[] = [];
  tasks: Row[] = [];
  labels: Row[] = [];
  comments: Row[] = [];
  // Fail the nth write (1-based), to test what survives a run that dies.
  failOnWrite: number | null = null;
  #next = 1;
  #writes = 0;

  #id(prefix: string): string {
    return `${prefix}${this.#next++}`;
  }

  section(name: string, projectId: string): Row {
    const row = { id: this.#id("S"), name, project_id: projectId, description: "" };
    this.sections.push(row);
    return row;
  }

  project(name: string, extra: Row = {}): Row {
    const row = {
      id: this.#id("P"),
      name,
      description: "",
      parent_id: null,
      inbox_project: false,
      ...extra,
    };
    this.projects.push(row);
    return row;
  }

  task(fields: Row): Row {
    const row: Row = {
      id: this.#id("T"),
      content: "",
      description: "",
      project_id: this.projects[0]?.["id"] ?? "P0",
      section_id: null,
      parent_id: null,
      priority: 1,
      labels: [],
      deadline: null,
      due: null,
      child_order: this.tasks.length,
      note_count: 0,
      ...fields,
    };
    this.tasks.push(row);
    return row;
  }

  writes(): Call[] {
    return this.calls.filter((c) => c.method !== "GET");
  }

  async get(path: string, params: Params = {}): Promise<Json> {
    this.calls.push({ method: "GET", path });
    const page = (results: Row[]) => ({ results, next_cursor: null });
    if (path === "/projects") return page(this.projects);
    if (path === "/labels") return page(this.labels);
    if (path === "/sections") {
      const project = params["project_id"];
      return page(
        project ? this.sections.filter((s) => s["project_id"] === project) : this.sections,
      );
    }
    if (path === "/tasks") {
      return page(
        this.tasks.filter(
          (t) =>
            (!params["project_id"] || t["project_id"] === params["project_id"]) &&
            (!params["parent_id"] || t["parent_id"] === params["parent_id"]) &&
            (!params["ids"] || String(params["ids"]).split(",").includes(t["id"])),
        ),
      );
    }
    if (path === "/tasks/filter") {
      // Only the one query the tool sends: a deadline and no due date.
      return page(this.tasks.filter((t) => t["deadline"] && !t["due"]));
    }
    throw new Error(`fake todoist: no GET ${path}`);
  }

  async post(path: string, body: Record<string, unknown> = {}): Promise<Json> {
    this.#write({ method: "POST", path, body });
    const [, collection, id, action] = path.split("/");
    if (collection === "tasks" && !id) {
      const { deadline_date, due_date, ...rest } = body;
      // A subtask lives where its parent does, as in Todoist.
      const parent = body["parent_id"] ? this.#find(this.tasks, String(body["parent_id"])) : null;
      return this.task({
        ...(parent ? { project_id: parent["project_id"], section_id: parent["section_id"] } : {}),
        ...rest,
        deadline: deadline_date ? { date: deadline_date, lang: "en" } : null,
        due: due_date ? { date: due_date, is_recurring: false } : null,
      });
    }
    if (collection === "tasks" && id && !action) {
      const task = this.#find(this.tasks, id);
      const { deadline_date, due_date, due_string, ...rest } = body;
      Object.assign(task, rest);
      // Todoist clears a due date only when told in words.
      if (due_string === "no date") task["due"] = null;
      if ("deadline_date" in body) {
        task["deadline"] = deadline_date ? { date: deadline_date, lang: "en" } : null;
      }
      if ("due_date" in body)
        task["due"] = due_date ? { date: due_date, is_recurring: false } : null;
      return task;
    }
    if (collection === "tasks" && action === "close") {
      this.tasks = this.tasks.filter((t) => t["id"] !== id);
      return null;
    }
    if (collection === "tasks" && action === "move") {
      const task = this.#find(this.tasks, id ?? "");
      // As Todoist does: a section carries its project along.
      if (body["section_id"]) {
        const section = this.#find(this.sections, String(body["section_id"]));
        return Object.assign(task, {
          section_id: section["id"],
          project_id: section["project_id"],
        });
      }
      return Object.assign(task, { section_id: null, ...body });
    }
    if (collection === "projects" && !id) return this.project(String(body["name"]), body);
    if (collection === "sections" && !id) {
      const row = { id: this.#id("S"), description: "", ...body };
      this.sections.push(row);
      return row;
    }
    if (collection === "labels" && !id) {
      const row = { id: this.#id("L"), ...body };
      this.labels.push(row);
      return row;
    }
    if (collection === "comments") {
      const row = { id: this.#id("C"), ...body };
      this.comments.push(row);
      return row;
    }
    // Renames, descriptions, label colours, the reorder command: accepted.
    return { id: id ?? this.#id("X") };
  }

  async delete(path: string): Promise<Json> {
    this.#write({ method: "DELETE", path });
    const id = path.split("/")[2];
    // Deleting a task takes its subtasks, as Todoist does.
    this.tasks = this.tasks.filter((t) => t["id"] !== id && t["parent_id"] !== id);
    this.projects = this.projects.filter((p) => p["id"] !== id);
    this.sections = this.sections.filter((s) => s["id"] !== id);
    return null;
  }

  #write(call: Call) {
    this.calls.push(call);
    this.#writes++;
    if (this.#writes === this.failOnWrite)
      throw new Error(`fake todoist: write ${this.#writes} failed`);
  }

  #find(rows: Row[], id: string): Row {
    const row = rows.find((r) => r["id"] === id);
    if (!row) throw new Error(`fake todoist: no ${id}`);
    return row;
  }
}
