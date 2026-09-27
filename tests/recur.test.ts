import { describe, expect, test } from "bun:test";
import {
  type Checked,
  CREATE_CAP,
  check,
  type Directory,
  emptyRecurState,
  hash,
  type OpenTask,
  plan,
  type RecurOp,
  type RecurState,
  type TemplateTask,
  templateHash,
  type Written,
} from "../src/recur/plan.ts";
import { format, occurrences, parse, type Rule, take, title } from "../src/recur/rule.ts";

const openTask = (content: string, deadline: string): OpenTask => ({
  projectId: "INBOX",
  sectionId: null,
  content,
  description: "",
  priority: 1,
  labels: [],
  deadline,
  due: null,
  noteCount: 0,
});

// A Friday, the chemistry lab's deadline, early in the autumn semester.
const TODAY = "2026-09-07"; // Monday

const LAB = `every: fri
from: 2026-09-04
until: 2026-12-18
skip: 2026-10-23, 2026-10-30
lead: 5d
due: -2d
project: 화학실험`;

function rule(text: string): Rule {
  const parsed = parse(text);
  if (!parsed.rule) throw new Error(parsed.errors.join("; "));
  return parsed.rule;
}

const deadlines = (r: Rule, count: number) => take(occurrences(r), count).map((o) => o.deadline);

describe("parse", () => {
  test("a full rule reads back every field", () => {
    expect(rule(LAB)).toEqual({
      every: { kind: "weekly", interval: 1, weekdays: [4] },
      from: "2026-09-04",
      until: "2026-12-18",
      skip: ["2026-10-23", "2026-10-30"],
      lead: 5,
      due: -2,
      project: "화학실험",
      section: null,
    });
  });

  test("Korean weekday names and several days a week", () => {
    expect(rule("every: 2 weeks 월, 목\nfrom: 2026-09-01").every).toEqual({
      kind: "weekly",
      interval: 2,
      weekdays: [0, 3],
    });
  });

  test("defaults: a week ahead, no due, the Inbox", () => {
    const r = rule("every: fri\nfrom: 2026-09-04");
    expect([r.lead, r.due, r.project, r.until]).toEqual([7, null, null, null]);
  });

  test("everything below the separator is a note, not a rule", () => {
    const parsed = parse("every: fri\nfrom: 2026-09-04\n---\nNote: bring goggles");
    expect(parsed.errors).toEqual([]);
    expect(parsed.notes).toBe("Note: bring goggles");
  });

  test("a typo above the separator is an error, not a silent default", () => {
    const parsed = parse("every: fri\nfrom: 2026-09-04\nlaed: 3d");
    expect(parsed.rule).toBeNull();
    expect(parsed.errors[0]).toContain("laed: 3d");
  });

  test("each broken field says what it expected", () => {
    const { errors } = parse("every: fryday\nfrom: 9/4\nlead: soon");
    expect(errors.join("\n")).toContain("`fryday` is not a weekday");
    expect(errors.join("\n")).toContain("not a date");
    expect(errors.join("\n")).toContain("not a number of days");
  });

  test("every and from are required", () => {
    expect(parse("").errors).toHaveLength(2);
  });

  test("until before from is refused", () => {
    expect(parse("every: fri\nfrom: 2026-09-04\nuntil: 2026-09-01").errors[0]).toContain("until");
  });
});

describe("format", () => {
  test("round-trips, so the TUI and the phone edit the same rule", () => {
    for (const text of [
      LAB,
      "every: 2 weeks mon, thu\nfrom: 2026-09-01",
      "every: month 31\nfrom: 2026-01-31\nlead: 3d\ndue: +1d",
      "every: 3 months 15\nfrom: 2026-01-15",
    ]) {
      const r = rule(text);
      expect(rule(format(r))).toEqual(r);
    }
  });

  test("notes survive the round trip", () => {
    const text = format(rule(LAB), "예비보고서 먼저");
    expect(parse(text).notes).toBe("예비보고서 먼저");
  });
});

describe("occurrences", () => {
  test("weekly, with skipped weeks keeping their place but not their number", () => {
    const all = [...occurrences(rule(LAB))];
    expect(all[0]).toEqual({ deadline: "2026-09-04", n: 1, skipped: false });
    const skipped = all.filter((o) => o.skipped).map((o) => o.deadline);
    expect(skipped).toEqual(["2026-10-23", "2026-10-30"]);
    expect(all.at(-1)).toEqual({ deadline: "2026-12-18", n: 14, skipped: false });
  });

  test("until ends the list", () => {
    expect([...occurrences(rule("every: fri\nfrom: 2026-09-04\nuntil: 2026-09-18"))]).toHaveLength(
      3,
    );
  });

  test("every other week keeps the rhythm of the first week", () => {
    expect(deadlines(rule("every: 2 weeks mon, thu\nfrom: 2026-09-03"), 4)).toEqual([
      "2026-09-03",
      "2026-09-14",
      "2026-09-17",
      "2026-09-28",
    ]);
  });

  test("the 31st of a short month is its last day", () => {
    expect(deadlines(rule("every: month 31\nfrom: 2026-01-01"), 3)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  test("a leap February gets its 29th", () => {
    expect(deadlines(rule("every: month 30\nfrom: 2028-01-30"), 2)).toEqual([
      "2028-01-30",
      "2028-02-29",
    ]);
  });

  test("title fills the number and the date", () => {
    const [first] = take(occurrences(rule(LAB)), 1);
    expect(first && title("화학 실험 {n}주차 ({date})", first)).toBe("화학 실험 1주차 (9/4)");
  });
});

describe("plan", () => {
  const template = (description: string, overrides: Partial<TemplateTask> = {}): TemplateTask => ({
    id: "T1",
    content: "화학 실험 {n}주차",
    description,
    priority: 3,
    labels: ["lab"],
    children: [
      { id: "C1", content: "{n}주차 예비보고서", description: "", priority: 1, labels: [] },
    ],
    ...overrides,
  });
  const PROJECTS: Directory = {
    inboxId: "INBOX",
    projects: new Map([["화학실험", "P1"]]),
    sections: new Map([["P1", new Map([["실험 보고서", "S1"]])]]),
  };
  const checked = (description: string, overrides?: Partial<TemplateTask>): Checked[] =>
    check([template(description, overrides)], PROJECTS);
  const creates = (ops: RecurOp[]) =>
    ops.flatMap((op) => (op.kind === "CreateInstance" ? [op] : []));

  test("a deadline appears `lead` days before it, with its due and subtasks", () => {
    // Friday the 11th appears on the 6th; the 4th is already past.
    const ops = plan(checked(LAB), emptyRecurState(), TODAY, "INBOX");
    expect(creates(ops).map((op) => op.deadline)).toEqual(["2026-09-11"]);
    const [op] = creates(ops);
    expect(op?.task).toEqual({
      content: "화학 실험 2주차",
      description: "",
      priority: 3,
      labels: ["lab"],
      place: { projectId: "P1", sectionId: null },
      deadline: "2026-09-11",
      due: "2026-09-09",
    });
    expect(op?.subtasks[0]?.content).toBe("2주차 예비보고서");
  });

  test("the day before `lead` is too early", () => {
    expect(creates(plan(checked(LAB), emptyRecurState(), "2026-09-05", "INBOX"))).toHaveLength(0);
  });

  test("a deadline already made is never made again, even if its task was deleted", () => {
    const state: RecurState = {
      ...emptyRecurState(),
      created: { T1: { "2026-09-11": "gone" } },
    };
    expect(creates(plan(checked(LAB), state, TODAY, "INBOX"))).toHaveLength(0);
  });

  test("a machine that slept through several lead days catches up", () => {
    const ops = plan(
      checked("every: mon, wed, fri\nfrom: 2026-09-01\nlead: 7d"),
      emptyRecurState(),
      TODAY,
      "INBOX",
    );
    expect(creates(ops).map((op) => op.deadline)).toEqual([
      "2026-09-07",
      "2026-09-09",
      "2026-09-11",
      "2026-09-14",
    ]);
  });

  test("skipped weeks are not made", () => {
    const ops = plan(checked(LAB), emptyRecurState(), "2026-10-26", "INBOX");
    expect(creates(ops).map((op) => op.deadline)).toEqual([]);
  });

  test("a broken template is reported once, and cleared once fixed", () => {
    const broken = "every: fryday\nfrom: 2026-09-04";
    let ops = plan(checked(broken), emptyRecurState(), TODAY, "INBOX");
    expect(ops.map((op) => op.kind)).toEqual(["ReportError"]);

    const state: RecurState = {
      created: {},
      reported: { T1: hash(broken) },
      placed: {},
      synced: {},
      written: {},
    };
    expect(plan(checked(broken), state, TODAY, "INBOX")).toEqual([]);

    ops = plan(checked(LAB), state, TODAY, "INBOX");
    expect(ops[0]?.kind).toBe("ClearError");
  });

  test("an unknown project is a template error, not a task in the Inbox", () => {
    const ops = plan(
      check([template(LAB.replace("화학실험", "없는 프로젝트"))], PROJECTS),
      emptyRecurState(),
      TODAY,
      "INBOX",
    );
    expect(ops[0]?.kind).toBe("ReportError");
  });

  test("a runaway lead is refused rather than flooding Todoist", () => {
    const ops = plan(
      checked("every: mon, tue, wed, thu, fri\nfrom: 2026-09-07\nlead: 60d"),
      emptyRecurState(),
      TODAY,
      "INBOX",
    );
    expect(ops.map((op) => op.kind)).toEqual(["ReportError"]);
    expect(ops[0]?.kind === "ReportError" && ops[0].message).toContain(String(CREATE_CAP));
  });

  test("notes become each task's description", () => {
    const ops = plan(checked(`${LAB}\n---\n실험복 지참`), emptyRecurState(), TODAY, "INBOX");
    expect(creates(ops)[0]?.task.description).toBe("실험복 지참");
  });

  describe("where tasks go", () => {
    const moves = (ops: RecurOp[]) => ops.flatMap((op) => (op.kind === "MoveInstance" ? [op] : []));
    const placeOf = (ops: RecurOp[]) =>
      ops.flatMap((op) => (op.kind === "CreateInstance" ? [op.task.place] : []));
    const inProject = `${LAB}\nsection: 실험 보고서`;
    const open = (at: Partial<OpenTask> = {}): Map<string, OpenTask> =>
      new Map([["X1", { ...openTask("화학 실험 2주차", "2026-09-11"), ...at }]]);
    const made = (placed: RecurState["placed"] = {}): RecurState => ({
      ...emptyRecurState(),
      created: { T1: { "2026-09-11": "X1" } },
      placed,
    });

    test("no project means the Inbox, as a real place", () => {
      const ops = plan(
        checked(LAB.replace("project: 화학실험", "")),
        emptyRecurState(),
        TODAY,
        "INBOX",
      );
      expect(placeOf(ops)).toEqual([{ projectId: "INBOX", sectionId: null }]);
    });

    test("a section resolves by name inside its project", () => {
      const ops = plan(checked(inProject), emptyRecurState(), "2026-09-14", "INBOX");
      expect(placeOf(ops)).toEqual([{ projectId: "P1", sectionId: "S1" }]);
    });

    test("an unknown section is a template error naming the project", () => {
      const [one] = checked(`${LAB}\nsection: 없는 섹션`);
      expect(one?.errors).toEqual(["section: no section named `없는 섹션` in 화학실험"]);
    });

    test("section and project round-trip through the description", () => {
      expect(parse(format(rule(inProject))).rule?.section).toBe("실험 보고서");
    });

    test("a template pointed somewhere new takes its open tasks along", () => {
      const ops = plan(checked(inProject), made(), TODAY, "INBOX", open());
      expect(moves(ops)).toEqual([
        {
          kind: "MoveInstance",
          templateId: "T1",
          taskId: "X1",
          content: "화학 실험 2주차",
          to: { projectId: "P1", sectionId: "S1" },
        },
      ]);
      expect(ops.at(-1)).toEqual({
        kind: "SetPlace",
        templateId: "T1",
        place: { projectId: "P1", sectionId: "S1" },
      });
    });

    test("a task moved by hand stays where it was put", () => {
      const elsewhere = open({ projectId: "P9" });
      expect(moves(plan(checked(inProject), made(), TODAY, "INBOX", elsewhere))).toEqual([]);
    });

    test("a finished task, gone from the open list, is not moved", () => {
      expect(moves(plan(checked(inProject), made(), TODAY, "INBOX", new Map()))).toEqual([]);
    });

    test("nothing moves, and nothing is recorded, while the place is unchanged", () => {
      const settled = made({ T1: { projectId: "P1", sectionId: "S1" } });
      const ops = plan(checked(inProject), settled, TODAY, "INBOX", open());
      expect(ops.filter((op) => op.kind === "MoveInstance" || op.kind === "SetPlace")).toEqual([]);
    });
  });

  describe("editing a template updates the weeks already made", () => {
    const wrote = (n: number, deadline: string, due: string): Written => ({
      content: `화학 실험 ${n}주차`,
      description: "",
      priority: 3,
      labels: ["lab"],
      deadline,
      due,
    });
    const X1 = wrote(2, "2026-09-11", "2026-09-09");
    const X2 = wrote(3, "2026-09-18", "2026-09-16");
    // Synced with the original template, as the last run left it.
    const settled = (): RecurState => ({
      ...emptyRecurState(),
      created: { T1: { "2026-09-11": "X1", "2026-09-18": "X2" } },
      placed: { T1: { projectId: "P1", sectionId: null } },
      synced: { T1: templateHash(template(LAB)) },
      written: { X1, X2 },
    });
    const at = (w: Written, extra: Partial<OpenTask> = {}): OpenTask => ({
      ...w,
      projectId: "P1",
      sectionId: null,
      noteCount: 0,
      ...extra,
    });
    const open = (x1: Partial<OpenTask> = {}, x2: Partial<OpenTask> = {}) =>
      new Map([
        ["X1", at(X1, x1)],
        ["X2", at(X2, x2)],
      ]);
    const after = (description: string, overrides?: Partial<TemplateTask>, found = open()) =>
      plan(checked(description, overrides), settled(), TODAY, "INBOX", found).filter(
        (op) => op.kind !== "CreateInstance",
      );
    const kinds = (ops: RecurOp[]) =>
      ops.map((op) => ("taskId" in op ? `${op.kind} ${op.taskId}` : op.kind));
    const patches = (ops: RecurOp[]) =>
      ops.flatMap((op) =>
        op.kind === "SyncInstance" && Object.keys(op.patch).length ? [[op.taskId, op.patch]] : [],
      );

    test("an unchanged template leaves its tasks alone and reads nothing", () => {
      expect(after(LAB)).toEqual([]);
    });

    test("a new title is written to every open week, numbered anew", () => {
      const ops = after(LAB, { content: "화학 실험 {n}회차" });
      expect(patches(ops)).toEqual([
        ["X1", { content: "화학 실험 2회차" }],
        ["X2", { content: "화학 실험 3회차" }],
      ]);
      expect(ops.at(-1)?.kind).toBe("SetSynced");
    });

    test("a field changed by hand is left as the person set it", () => {
      const ops = after(
        LAB,
        { content: "화학 실험 {n}회차", priority: 4 },
        open({ content: "내 제목" }),
      );
      expect(patches(ops)).toEqual([
        ["X1", { priority: 4 }],
        ["X2", { content: "화학 실험 3회차", priority: 4 }],
      ]);
      // Still recorded as ours as it was, so it keeps reading as changed by hand.
      const x1 = ops.find((op) => op.kind === "SyncInstance" && op.taskId === "X1");
      expect(x1?.kind === "SyncInstance" && x1.written.content).toBe("화학 실험 2주차");
    });

    test("labels read back in another order are not a change by hand", () => {
      const ops = after(LAB, { labels: ["lab", "chem"] }, open({ labels: ["lab"] }));
      expect(patches(ops)).toContainEqual(["X1", { labels: ["lab", "chem"] }]);
    });

    test("a due rule removed clears the due date", () => {
      const ops = after(LAB.replace("due: -2d\n", ""));
      expect(patches(ops)).toEqual([
        ["X1", { due: null }],
        ["X2", { due: null }],
      ]);
    });

    test("a changed weekday deletes the untouched weeks it no longer has", () => {
      expect(kinds(after(LAB.replace("every: fri", "every: thu")))).toEqual([
        "DeleteInstance X1",
        "DeleteInstance X2",
        "SetSynced",
      ]);
    });

    test("a week that is now skipped goes, and the weeks after it renumber", () => {
      const ops = after(LAB.replace("skip: ", "skip: 2026-09-11, "));
      expect(kinds(ops)).toEqual(["DeleteInstance X1", "SyncInstance X2", "SetSynced"]);
      expect(patches(ops)).toEqual([["X2", { content: "화학 실험 2주차" }]]);
    });

    test("a removed week that was commented on or changed by hand is kept", () => {
      const thu = LAB.replace("every: fri", "every: thu");
      expect(kinds(after(thu, {}, open({ noteCount: 1 }, { due: "2026-09-17" })))).toEqual([
        "KeepInstance X1",
        "KeepInstance X2",
        "SetSynced",
      ]);
    });

    test("a finished week is not touched", () => {
      const onlyX2 = new Map([["X2", at(X2)]]);
      expect(kinds(after(LAB.replace("every: fri", "every: thu"), {}, onlyX2))).toEqual([
        "DeleteInstance X2",
        "SetSynced",
      ]);
    });

    test("a task seen for the first time is taken as it stands", () => {
      const state = { ...settled(), written: {}, synced: {} };
      const ops = plan(
        checked(LAB),
        state,
        TODAY,
        "INBOX",
        open({ content: "화학 실험 2주차 (늦음)" }),
      );
      // Nothing to rewrite, since nothing is known to have been changed by
      // hand -- but the first title is the rule's, so it is put right.
      expect(patches(ops)).toEqual([["X1", { content: "화학 실험 2주차" }]]);
      expect(ops.filter((op) => op.kind === "SyncInstance")).toHaveLength(2);
    });
  });
});
