import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { blankDraft, type Draft, ruleOf, validate } from "../src/recur/draft.ts";
import { Form } from "../src/recur/form.tsx";
import { format, parse } from "../src/recur/rule.ts";
import { DatePicker, monthGrid, shiftMonth } from "../src/ui/date-picker.tsx";

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const strip = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const ENTER = "\r";

describe("calendar", () => {
  test("a month is six Monday-first weeks, padded with its neighbours", () => {
    const grid = monthGrid("2026-09-15");
    expect(grid).toHaveLength(6);
    expect(grid[0]?.[0]).toBe("2026-08-31"); // September 2026 starts on a Tuesday
    expect(grid.flat()).toContain("2026-09-30");
  });

  test("moving a month from the 31st lands on the last day, leap years included", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonth("2028-01-31", 1)).toBe("2028-02-29");
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-15");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-15");
  });

  test("arrows move by day and week, enter picks", async () => {
    let picked: string[] = [];
    const view = render(
      <DatePicker initial="2026-09-04" onSubmit={(d) => (picked = d)} onCancel={() => {}} />,
    );
    await tick();
    view.stdin.write(RIGHT);
    view.stdin.write(DOWN);
    await tick();
    view.stdin.write(ENTER);
    await tick();
    expect(picked).toEqual(["2026-09-12"]);
    view.unmount();
  });

  test("in multiple mode space toggles and enter returns them sorted", async () => {
    let picked: string[] = [];
    const view = render(
      <DatePicker
        initial="2026-10-30"
        multiple
        onSubmit={(d) => (picked = d)}
        onCancel={() => {}}
      />,
    );
    await tick();
    view.stdin.write(" ");
    await tick();
    view.stdin.write("\x1b[A"); // up a week
    await tick();
    view.stdin.write(" ");
    await tick();
    view.stdin.write(ENTER);
    await tick();
    expect(picked).toEqual(["2026-10-23", "2026-10-30"]);
    view.unmount();
  });
});

describe("form", () => {
  const draft: Draft = {
    ...blankDraft("2026-09-01"),
    title: "화학 실험 {n}주차",
    weekdays: [4],
    from: "2026-09-04",
    until: "2026-12-18",
  };

  test("what the form saves is exactly what the scheduler parses", () => {
    const rule = ruleOf({ ...draft, skip: ["2026-10-30", "2026-10-23"], due: -2 });
    expect(parse(format(rule)).rule).toEqual(rule);
  });

  test("an empty title or no weekday is caught before saving", () => {
    expect(validate({ ...draft, title: " " })).toContain("the title is empty");
    expect(validate({ ...draft, weekdays: [] })).toContain("pick at least one weekday");
  });

  test("toggling a weekday redraws the upcoming deadlines", async () => {
    const view = render(
      <Form
        heading="Edit"
        initial={draft}
        projects={[]}
        sections={() => []}
        isNew={false}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    await tick();
    expect(strip(view.lastFrame())).toContain("Upcoming");
    for (let i = 0; i < 3; i++) view.stdin.write(DOWN); // title -> repeats -> every -> on
    await tick();
    view.stdin.write("2"); // Tuesday
    await tick();
    // Both a Tuesday and a Friday now show up among the next deadlines.
    const frame = strip(view.lastFrame());
    const upcoming = frame.slice(frame.indexOf("Upcoming"));
    const dates = [...upcoming.matchAll(/20\d\d-\d\d-\d\d/g)].map((m) => m[0]);
    const weekdays = new Set(dates.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay()));
    expect(weekdays).toEqual(new Set([2, 5]));
    view.unmount();
  });

  test("ctrl+s saves the edited draft", async () => {
    let saved: Draft | null = null;
    const view = render(
      <Form
        heading="Edit"
        initial={draft}
        projects={[]}
        sections={() => []}
        isNew={false}
        onSave={(d) => (saved = d)}
        onCancel={() => {}}
      />,
    );
    await tick();
    for (let i = 0; i < 7; i++) view.stdin.write(DOWN); // down to "Appears"
    await tick();
    view.stdin.write("\x1b[D"); // one day less
    await tick();
    view.stdin.write("\x13"); // ctrl+s
    await tick();
    expect(saved).not.toBeNull();
    expect((saved as Draft | null)?.lead).toBe(draft.lead - 1);
    view.unmount();
  });

  test("a new template starts in the title field and takes typing", async () => {
    let saved: Draft | null = null;
    const view = render(
      <Form
        heading="New"
        initial={{ ...draft, title: "" }}
        projects={[]}
        sections={() => []}
        isNew
        onSave={(d) => (saved = d)}
        onCancel={() => {}}
      />,
    );
    await tick();
    view.stdin.write("실험 {n}");
    await tick();
    view.stdin.write(ENTER);
    await tick();
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.title).toBe("실험 {n}");
    view.unmount();
  });
});

describe("form: project and section", () => {
  const SECTIONS: Record<string, string[]> = { 화학실험: ["실험 보고서", "예비"], 물리: [] };
  const draft: Draft = {
    ...blankDraft("2026-09-01"),
    title: "화학 실험 {n}주차",
    weekdays: [4],
    from: "2026-09-04",
    project: "화학실험",
  };
  const UP = "\x1b[A";
  const toSection = (view: { stdin: { write: (s: string) => void } }) => {
    // Up from the title wraps round: save, notes, subtasks, section.
    for (let i = 0; i < 4; i++) view.stdin.write(UP);
  };
  const form = (onSave: (d: Draft) => void, initial: Draft = draft) =>
    render(
      <Form
        heading="Edit"
        initial={initial}
        projects={["화학실험", "물리"]}
        sections={(p) => SECTIONS[p ?? ""] ?? []}
        isNew={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );

  test("the section is picked from the project's own sections", async () => {
    let saved: Draft | null = null;
    const view = form((d) => (saved = d));
    await tick();
    toSection(view);
    await tick();
    view.stdin.write(ENTER);
    await tick();
    expect(strip(view.lastFrame())).toContain("실험 보고서");
    view.stdin.write(DOWN); // from "none" to the first section
    await tick();
    view.stdin.write(ENTER);
    await tick();
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.section).toBe("실험 보고서");
    view.unmount();
  });

  test("x clears the section", async () => {
    let saved: Draft | null = null;
    const view = form((d) => (saved = d), { ...draft, section: "예비" });
    await tick();
    toSection(view);
    await tick();
    view.stdin.write("x");
    await tick();
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.section).toBeNull();
    view.unmount();
  });

  test("changing the project drops a section that belonged to the old one", async () => {
    let saved: Draft | null = null;
    const view = form((d) => (saved = d), { ...draft, section: "예비" });
    await tick();
    toSection(view);
    view.stdin.write(UP); // project
    await tick();
    view.stdin.write(ENTER);
    await tick();
    view.stdin.write(DOWN); // focus starts on Inbox: past 화학실험 to 물리
    view.stdin.write(DOWN);
    await tick();
    view.stdin.write(ENTER);
    await tick();
    view.stdin.write("\x13");
    await tick();
    expect(saved).toMatchObject({ project: "물리", section: null });
    view.unmount();
  });

  test("a project without sections says so", async () => {
    const view = form(() => {}, { ...draft, project: "물리" });
    await tick();
    toSection(view);
    await tick();
    view.stdin.write(ENTER);
    await tick();
    expect(strip(view.lastFrame())).toContain("물리 has no sections");
    view.unmount();
  });
});
