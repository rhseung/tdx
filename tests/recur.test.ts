import { describe, expect, test } from "bun:test";
import {
  type Checked,
  CREATE_CAP,
  check,
  emptyRecurState,
  hash,
  plan,
  type RecurOp,
  type RecurState,
  type TemplateTask,
} from "../src/recur/plan.ts";
import { format, occurrences, parse, type Rule, take, title } from "../src/recur/rule.ts";

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
    children: [{ content: "{n}주차 예비보고서", description: "", priority: 1, labels: [] }],
    ...overrides,
  });
  const PROJECTS = new Map([["화학실험", "P1"]]);
  const checked = (description: string, overrides?: Partial<TemplateTask>): Checked[] =>
    check([template(description, overrides)], PROJECTS);
  const creates = (ops: RecurOp[]) =>
    ops.flatMap((op) => (op.kind === "CreateInstance" ? [op] : []));

  test("a deadline appears `lead` days before it, with its due and subtasks", () => {
    // Friday the 11th appears on the 6th; the 4th is already past.
    const ops = plan(checked(LAB), emptyRecurState(), TODAY);
    expect(creates(ops).map((op) => op.deadline)).toEqual(["2026-09-11"]);
    const [op] = creates(ops);
    expect(op?.task).toEqual({
      content: "화학 실험 2주차",
      description: "",
      priority: 3,
      labels: ["lab"],
      projectId: "P1",
      deadline: "2026-09-11",
      due: "2026-09-09",
    });
    expect(op?.subtasks[0]?.content).toBe("2주차 예비보고서");
  });

  test("the day before `lead` is too early", () => {
    expect(creates(plan(checked(LAB), emptyRecurState(), "2026-09-05"))).toHaveLength(0);
  });

  test("a deadline already made is never made again, even if its task was deleted", () => {
    const state: RecurState = { created: { T1: { "2026-09-11": "gone" } }, reported: {} };
    expect(creates(plan(checked(LAB), state, TODAY))).toHaveLength(0);
  });

  test("a machine that slept through several lead days catches up", () => {
    const ops = plan(
      checked("every: mon, wed, fri\nfrom: 2026-09-01\nlead: 7d"),
      emptyRecurState(),
      TODAY,
    );
    expect(creates(ops).map((op) => op.deadline)).toEqual([
      "2026-09-07",
      "2026-09-09",
      "2026-09-11",
      "2026-09-14",
    ]);
  });

  test("skipped weeks are not made", () => {
    const ops = plan(checked(LAB), emptyRecurState(), "2026-10-26");
    expect(creates(ops).map((op) => op.deadline)).toEqual([]);
  });

  test("a broken template is reported once, and cleared once fixed", () => {
    const broken = "every: fryday\nfrom: 2026-09-04";
    let ops = plan(checked(broken), emptyRecurState(), TODAY);
    expect(ops.map((op) => op.kind)).toEqual(["ReportError"]);

    const state: RecurState = { created: {}, reported: { T1: hash(broken) } };
    expect(plan(checked(broken), state, TODAY)).toEqual([]);

    ops = plan(checked(LAB), state, TODAY);
    expect(ops[0]?.kind).toBe("ClearError");
  });

  test("an unknown project is a template error, not a task in the Inbox", () => {
    const ops = plan(
      check([template(LAB.replace("화학실험", "없는 프로젝트"))], PROJECTS),
      emptyRecurState(),
      TODAY,
    );
    expect(ops[0]?.kind).toBe("ReportError");
  });

  test("a runaway lead is refused rather than flooding Todoist", () => {
    const ops = plan(
      checked("every: mon, tue, wed, thu, fri\nfrom: 2026-09-07\nlead: 60d"),
      emptyRecurState(),
      TODAY,
    );
    expect(ops.map((op) => op.kind)).toEqual(["ReportError"]);
    expect(ops[0]?.kind === "ReportError" && ops[0].message).toContain(String(CREATE_CAP));
  });

  test("notes become each task's description", () => {
    const ops = plan(checked(`${LAB}\n---\n실험복 지참`), emptyRecurState(), TODAY);
    expect(creates(ops)[0]?.task.description).toBe("실험복 지참");
  });
});
