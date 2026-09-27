// The code that writes to Todoist, run against the in-memory fake.

import { describe, expect, test } from "bun:test";
import { apply, snapshot } from "../src/github/apply.ts";
import type { Op } from "../src/github/reconcile.ts";
import { emptyState, type GithubState } from "../src/github/state.ts";
import { applyNudges, loadState as loadNudgeState, runNudge } from "../src/nudge/nudge.ts";
import { blankDraft, draftOf, ruleOf, saveDraft } from "../src/recur/draft.ts";
import { occurrenceRows, runRecur, templateRows } from "../src/recur/feature.tsx";
import {
  applyOps,
  deleteTemplate,
  directory,
  ensureTemplatesProject,
  loadState as loadRecurState,
  readWorkspace,
} from "../src/recur/io.ts";
import { check, emptyRecurState } from "../src/recur/plan.ts";
import { format, parse } from "../src/recur/rule.ts";
import { Progress } from "../src/ui/progress.tsx";
import { FakeTodoist } from "./fake.ts";

const quiet = () => new Progress({ mode: "json", color: false, header: false, pager: false });
const TODAY = "2026-09-27"; // a Sunday
const LAB = "every: fri\nfrom: 2026-09-04\nuntil: 2026-12-18\nlead: 5d\ndue: -2d\n---\n실험복 지참";

function workspace(description = LAB) {
  const fake = new FakeTodoist();
  fake.project("Inbox", { inbox_project: true });
  const templates = fake.project("Templates");
  const template = fake.task({
    project_id: templates["id"],
    content: "화학 실험 {n}주차",
    description,
    priority: 3,
    labels: ["lab"],
  });
  fake.task({
    project_id: templates["id"],
    parent_id: template["id"],
    content: "{n}주차 예비보고서",
  });
  return { fake, template };
}

describe("recur", () => {
  test("a due week becomes a task with its deadline, due date, note and subtasks", async () => {
    const { fake, template } = workspace();
    await runRecur(quiet(), { api: fake, today: TODAY });

    const made = fake.tasks.find((t) => t["content"] === "화학 실험 5주차");
    expect(made).toMatchObject({
      description: "실험복 지참",
      priority: 3,
      labels: ["lab"],
      deadline: { date: "2026-10-02" },
      due: { date: "2026-09-30" },
    });
    // No project named: the Inbox is Todoist's default, so none is sent.
    expect(made?.["project_id"]).toBe(fake.projects[0]?.["id"]);
    const sub = fake.tasks.find((t) => t["parent_id"] === made?.["id"]);
    expect(sub?.["content"]).toBe("5주차 예비보고서");
    expect(loadRecurState().created[template["id"]]).toEqual({ "2026-10-02": made?.["id"] });
  });

  test("a second run makes nothing new", async () => {
    const { fake } = workspace();
    await runRecur(quiet(), { api: fake, today: TODAY });
    const before = fake.writes().length;
    await runRecur(quiet(), { api: fake, today: TODAY });
    expect(fake.writes().length).toBe(before);
  });

  test("a broken template gets one comment however often it runs", async () => {
    const { fake, template } = workspace("every: fryday\nfrom: 2026-09-04");
    await runRecur(quiet(), { api: fake, today: TODAY });
    await runRecur(quiet(), { api: fake, today: TODAY });
    expect(fake.comments).toHaveLength(1);
    expect(fake.comments[0]).toMatchObject({ task_id: template["id"] });
    expect(String(fake.comments[0]?.["content"])).toContain("fryday");
  });

  test("a run that dies halfway still remembers what it made", async () => {
    const { fake, template } = workspace(LAB.replace("every: fri", "every: wed, fri"));
    const api = fake;
    const state = emptyRecurState();
    const ws = await readWorkspace(api);
    const { plan } = await import("../src/recur/plan.ts");
    const ops = plan(check(ws.templates, directory(ws)), state, TODAY, directory(ws).inboxId);
    expect(ops.filter((op) => op.kind === "CreateInstance")).toHaveLength(2); // Wednesday and Friday
    // Write 1 is the first task, 2 its subtask, 3 the second task.
    fake.failOnWrite = 3;
    await expect(applyOps(api, state, ops)).rejects.toThrow("write 3 failed");
    expect(Object.keys(loadRecurState().created[template["id"]] ?? {})).toEqual(["2026-09-30"]);
  });

  test("the form's draft saves as a template and edits it in place", async () => {
    const fake = new FakeTodoist();
    fake.project("Inbox", { inbox_project: true });
    const templatesProjectId = await ensureTemplatesProject(fake, await readWorkspace(fake));
    const rule = parse(LAB).rule;
    if (!rule) throw new Error("fixture");
    const draft = {
      ...draftOf({
        template: { id: "", content: "", description: "", priority: 1, labels: [], children: [] },
        rule,
        notes: "실험복 지참",
        errors: [],
        place: null,
      }),
      title: "화학 실험 {n}주차",
      subtasks: ["예비보고서", "결과보고서"],
    };
    const created = await saveDraft(fake, draft, { templatesProjectId });
    expect(created.created).toBe(true);

    const ws = await readWorkspace(fake);
    const [checked] = check(ws.templates, directory(ws));
    if (!checked) throw new Error("template was not saved");
    // What the form wrote is what the scheduler reads.
    expect(checked.rule).toEqual(ruleOf(draft));
    expect(checked.template.description).toBe(format(rule, "실험복 지참"));
    expect(checked.template.children.map((c) => c.content)).toEqual(["예비보고서", "결과보고서"]);

    const keptId = checked.template.children[0]?.id;
    await saveDraft(
      fake,
      { ...draft, subtasks: ["예비보고서", "실험 사진"] },
      {
        templatesProjectId,
        existing: checked,
      },
    );
    const after = (await readWorkspace(fake)).templates[0];
    expect(after?.children.map((c) => c.content)).toEqual(["예비보고서", "실험 사진"]);
    // A kept subtask is the same task, not a copy.
    expect(after?.children[0]?.id).toBe(keptId);
  });

  test("deleting a template takes its subtasks and its history", async () => {
    const { fake, template } = workspace();
    await runRecur(quiet(), { api: fake, today: TODAY });
    await deleteTemplate(fake, loadRecurState(), template["id"]);
    expect(fake.tasks.some((t) => t["id"] === template["id"])).toBe(false);
    expect(loadRecurState().created[template["id"]]).toBeUndefined();
    // The tasks it already made stay.
    expect(fake.tasks.some((t) => t["content"] === "화학 실험 5주차")).toBe(true);
  });
});

describe("nudge", () => {
  test("a near deadline gets today's date, once", async () => {
    const fake = new FakeTodoist();
    fake.project("Inbox");
    const near = fake.task({
      content: "Quiz 2 준비",
      deadline: { date: "2026-09-28", lang: "en" },
    });
    fake.task({ content: "Quiz 3 준비", deadline: { date: "2026-11-04", lang: "en" } });

    await runNudge(quiet(), { api: fake, today: TODAY });
    expect(near["due"]).toEqual({ date: TODAY, is_recurring: false });
    expect(fake.writes()).toHaveLength(1);

    // The due date is taken off by hand; it stays off.
    near["due"] = null;
    await runNudge(quiet(), { api: fake, today: TODAY });
    expect(near["due"]).toBeNull();
  });

  test("a failed nudge keeps the ones before it on record", async () => {
    const fake = new FakeTodoist();
    fake.failOnWrite = 2;
    const nudges = ["A", "B"].map((id) => ({ id, content: id, deadline: TODAY, due: TODAY }));
    fake.task({ id: "A" });
    fake.task({ id: "B" });
    const state = { nudged: {} };
    await expect(applyNudges(fake, state, nudges, TODAY)).rejects.toThrow();
    expect(Object.keys(loadNudgeState().nudged)).toEqual(["A"]);
  });
});

describe("github apply", () => {
  const create: Op[] = [
    { kind: "CreateRoot" },
    {
      kind: "CreateSection",
      repoId: "1",
      name: "rds",
      description: "",
      project: { kind: "newRoot" },
    },
    {
      kind: "CreateTask",
      ghId: "I_a",
      content: "[#1](u) a",
      description: "",
      priority: 1,
      deadline: "2026-10-01",
      labels: ["gh-issue"],
      project: { kind: "newRoot" },
      section: { kind: "newSection", repoId: "1" },
    },
    { kind: "ReorderTasks", ghIds: ["I_a"] },
  ];

  test("new objects are wired to each other through the state file", async () => {
    const fake = new FakeTodoist();
    const state = emptyState();
    const saves: GithubState[] = [];
    await apply(fake, state, create, (s) => saves.push(s));

    const root = fake.projects.find((p) => p["name"] === "GitHub");
    const section = fake.sections[0];
    expect(section?.["project_id"]).toBe(root?.["id"]);
    const task = fake.tasks[0];
    expect(task).toMatchObject({ section_id: section?.["id"], deadline: { date: "2026-10-01" } });
    expect(state).toMatchObject({ root: root?.["id"], sections: { "1": section?.["id"] } });
    expect(state.tasks["I_a"]).toBe(task?.["id"]);
    // The reorder names the real task id it just made.
    const sync = fake.calls.find((c) => c.path === "/sync");
    expect(JSON.stringify(sync?.body)).toContain(String(task?.["id"]));
    expect(saves).toEqual([state]);
  });

  test("a clearing update sends null, not a missing key", async () => {
    const fake = new FakeTodoist();
    const task = fake.task({ content: "c", deadline: { date: "2026-10-01", lang: "en" } });
    await apply(
      fake,
      emptyState(),
      [
        {
          kind: "UpdateTask",
          id: task["id"],
          content: "c",
          description: "",
          priority: 1,
          deadline: null,
          labels: [],
        },
      ],
      () => {},
    );
    const body = fake.writes()[0]?.body ?? {};
    expect("deadline_date" in body && body["deadline_date"] === null).toBe(true);
    expect(task["deadline"]).toBeNull();
  });

  test("the state is saved even when an op fails partway", async () => {
    const fake = new FakeTodoist();
    fake.failOnWrite = 2;
    const state = emptyState();
    let saved = false;
    await expect(apply(fake, state, create, () => (saved = true))).rejects.toThrow();
    expect(saved).toBe(true);
    // The root made before the failure is remembered, so it is not made twice.
    expect(state.root).not.toBeNull();
  });
});

describe("github snapshot", () => {
  test("ids the state file points at but Todoist no longer has are forgotten", async () => {
    const fake = new FakeTodoist();
    const root = fake.project("GitHub");
    fake.sections.push({ id: "S1", name: "rds", project_id: root["id"], description: "d" });
    const task = fake.task({ project_id: root["id"], section_id: "S1", content: "[#1](u) a" });
    fake.task({ project_id: root["id"], content: "a note written by hand" });
    const state: GithubState = {
      ...emptyState(),
      root: root["id"],
      sections: { "1": "S1", "2": "S_gone" },
      tasks: { I_a: task["id"], I_b: "T_gone" },
    };

    const snap = await snapshot(fake, state);

    expect(state.sections).toEqual({ "1": "S1" });
    expect(state.tasks).toEqual({ I_a: task["id"] });
    expect(snap.tasks["I_a"]).toMatchObject({ sectionId: "S1", content: "[#1](u) a" });
    // A hand-written task still marks its project as occupied.
    expect(snap.occupied.has(root["id"])).toBe(true);
  });

  test("a root project deleted by hand means the tree is rebuilt", async () => {
    const state: GithubState = { ...emptyState(), root: "P_gone" };
    const snap = await snapshot(new FakeTodoist(), state);
    expect(snap.root).toBeNull();
    expect(state.root).toBeNull();
  });
});

describe("recur views", () => {
  test("the list shows the next deadline, how many were made, and broken templates", async () => {
    const { fake, template } = workspace();
    fake.task({ project_id: template["project_id"], content: "broken", description: "every: x" });
    await runRecur(quiet(), { api: fake, today: TODAY });
    const ws = await readWorkspace(fake);
    const rows = templateRows(check(ws.templates, directory(ws)), loadRecurState(), TODAY);
    expect(rows.map((r) => [r.name, r.next, r.made, r.ok])).toEqual([
      ["화학 실험 {n}주차", "2026-10-02", 1, true],
      ["broken", null, 0, false],
    ]);
  });

  test("the preview marks each week made, planned, skipped or past", async () => {
    const { fake } = workspace(`${LAB.split("\n---")[0]}\nskip: 2026-10-09`);
    await runRecur(quiet(), { api: fake, today: TODAY });
    const ws = await readWorkspace(fake);
    const rows = occurrenceRows(check(ws.templates, directory(ws)), loadRecurState(), TODAY, 3);
    expect(rows.map((r) => [r.deadline, r.n, r.status])).toEqual([
      ["2026-09-04", 1, "past"],
      ["2026-09-11", 2, "past"],
      ["2026-09-18", 3, "past"],
      ["2026-09-25", 4, "past"],
      ["2026-10-02", 5, "created"],
      ["2026-10-09", null, "skipped"],
      ["2026-10-16", 6, "planned"],
    ]);
    expect(rows.find((r) => r.status === "skipped")?.title).toBe("화학 실험 {n}주차");
  });
});

describe("recur placement", () => {
  test("pointing a template at a section moves the weeks left in the Inbox", async () => {
    const { fake, template } = workspace(LAB.replace("lead: 5d", "lead: 12d"));
    await runRecur(quiet(), { api: fake, today: TODAY });
    const made = fake.tasks.filter((t) => /\d주차$/.test(String(t["content"])));
    expect(made.map((t) => t["content"])).toEqual(["화학 실험 5주차", "화학 실험 6주차"]);
    // One of the two is moved by hand, and must stay where it was put.
    const course = fake.project("화학실험");
    const reports = fake.section("실험 보고서", course["id"]);
    const elsewhere = fake.project("다른 곳");
    Object.assign(made[1] ?? {}, { project_id: elsewhere["id"] });

    template["description"] = `${template["description"]}`.replace(
      "\n---",
      "\nproject: 화학실험\nsection: 실험 보고서\n---",
    );
    await runRecur(quiet(), { api: fake, today: TODAY });

    expect(made[0]).toMatchObject({ project_id: course["id"], section_id: reports["id"] });
    expect(made[1]).toMatchObject({ project_id: elsewhere["id"] });
    expect(loadRecurState().placed[template["id"]]).toEqual({
      projectId: course["id"],
      sectionId: reports["id"],
    });

    // Settled: the next run reads nothing extra and moves nothing.
    const before = fake.calls.length;
    await runRecur(quiet(), { api: fake, today: TODAY });
    const later = fake.calls.slice(before);
    expect(later.some((c) => c.path.includes("/move"))).toBe(false);
    expect(later.filter((c) => c.path === "/tasks")).toHaveLength(1); // the templates, no ids lookup
  });

  test("new weeks are made straight into the section", async () => {
    const { fake } = workspace(
      LAB.replace("\n---", "\nproject: 화학실험\nsection: 실험 보고서\n---"),
    );
    const course = fake.project("화학실험");
    const reports = fake.section("실험 보고서", course["id"]);
    await runRecur(quiet(), { api: fake, today: TODAY });
    const made = fake.tasks.find((t) => t["content"] === "화학 실험 5주차");
    expect(made).toMatchObject({ project_id: course["id"], section_id: reports["id"] });
  });
});

describe("recur edits", () => {
  // Two weeks made: Fri 10/2 and Fri 10/9, with lead 12d on the 27th.
  const TWO = LAB.replace("lead: 5d", "lead: 12d");
  const madeWeeks = (fake: FakeTodoist) =>
    fake.tasks.filter((t) => /\d(주차|회차)$/.test(String(t["content"])));

  test("a retitled template renames its open weeks, and a hand edit survives", async () => {
    const { fake, template } = workspace(TWO);
    await runRecur(quiet(), { api: fake, today: TODAY });
    const [first, second] = madeWeeks(fake);
    expect([first?.["content"], second?.["content"]]).toEqual([
      "화학 실험 5주차",
      "화학 실험 6주차",
    ]);
    Object.assign(second ?? {}, { content: "6주차는 조별" }); // by hand

    template["content"] = "화학 실험 {n}회차";
    await runRecur(quiet(), { api: fake, today: TODAY });
    expect(first?.["content"]).toBe("화학 실험 5회차");
    expect(second?.["content"]).toBe("6주차는 조별");

    // Settled: nothing is read or written on the next run.
    const before = fake.calls.length;
    await runRecur(quiet(), { api: fake, today: TODAY });
    expect(fake.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);
  });

  test("a changed weekday removes the old weeks and makes the new ones", async () => {
    const { fake, template } = workspace(TWO);
    await runRecur(quiet(), { api: fake, today: TODAY });
    const [first, second] = madeWeeks(fake);
    fake.comments.push({ id: "C9", task_id: second?.["id"], content: "자료 링크" });
    Object.assign(second ?? {}, { note_count: 1 });

    template["description"] = String(template["description"]).replace("every: fri", "every: thu");
    await runRecur(quiet(), { api: fake, today: TODAY });

    const weeks = madeWeeks(fake).map((t) => [t["content"], t["deadline"]?.["date"] ?? null]);
    expect(fake.tasks).not.toContain(first);
    // The commented Friday stays beside the new Thursdays, which count from
    // the first Thursday after `from` (9/10), so 10/1 is the fourth.
    expect(weeks).toEqual([
      ["화학 실험 6주차", "2026-10-09"],
      ["화학 실험 4주차", "2026-10-01"],
      ["화학 실험 5주차", "2026-10-08"],
    ]);
  });

  test("dropping the due rule clears the due dates", async () => {
    const { fake, template } = workspace(TWO);
    await runRecur(quiet(), { api: fake, today: TODAY });
    template["description"] = String(template["description"]).replace("due: -2d\n", "");
    await runRecur(quiet(), { api: fake, today: TODAY });
    expect(madeWeeks(fake).map((t) => t["due"])).toEqual([null, null]);
  });

  test("a run over a template reports kept weeks in its ops", async () => {
    const { fake, template } = workspace(TWO);
    await runRecur(quiet(), { api: fake, today: TODAY });
    const [first] = madeWeeks(fake);
    Object.assign(first ?? {}, { priority: 4 });
    template["description"] = String(template["description"]).replace("every: fri", "every: thu");
    const result = await runRecur(quiet(), { api: fake, today: TODAY });
    expect(result.ops.filter((op) => op.verb === "kept").map((op) => op.text)).toEqual([
      expect.stringContaining("화학 실험 5주차"),
    ]);
  });
});

test("labels chosen in the form are the template's, and reach its weeks", async () => {
  const fake = new FakeTodoist();
  fake.project("Inbox", { inbox_project: true });
  const templates = fake.project("Templates");
  const draft = { ...blankDraft(TODAY), title: "화학 실험 {n}주차", labels: ["lab", "화학"] };
  fake.labels.push({ id: "L1", name: "lab", color: "blue" });
  const saved = await saveDraft(fake, draft, {
    templatesProjectId: templates["id"],
    personalLabels: ["lab"],
  });
  expect(fake.tasks.find((t) => t["id"] === saved.id)?.["labels"]).toEqual(["lab", "화학"]);
  // Only the new name is made a personal label, as typing it in Todoist would.
  expect(fake.labels.map((l) => l["name"])).toEqual(["lab", "화학"]);
  const ws = await readWorkspace(fake);
  expect(ws.labels).toEqual(["lab", "화학"]);
  await runRecur(quiet(), { api: fake, today: draft.from });
  const week = fake.tasks.find((t) => /\d주차$/.test(String(t["content"])));
  expect(week?.["labels"]).toEqual(["lab", "화학"]);
});
