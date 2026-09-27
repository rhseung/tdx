import { describe, expect, test } from "bun:test";
import { render as renderInk } from "ink-testing-library";
import { blankDraft, type Draft, ruleOf, validate } from "../src/recur/draft.ts";
import { Form } from "../src/recur/form.tsx";
import { format, parse } from "../src/recur/rule.ts";
import { DatePicker, monthGrid, shiftMonth } from "../src/ui/date-picker.tsx";

// Every screen a test draws, so a wait can tell when they have all settled.
const drawn: { frames: string[] }[] = [];
const render: typeof renderInk = (node) => {
  const view = renderInk(node);
  drawn.push(view);
  return view;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frameCount = () => drawn.reduce((n, v) => n + v.frames.length, 0);

// Waits until no screen has drawn a new frame for a while, rather than a
// fixed time: with the linter and type checker running alongside, a render
// can take longer than any fixed delay, and a key sent before it lands
// reaches the wrong screen.
async function tick() {
  let seen = -1;
  for (let i = 0; i < 100; i++) {
    await sleep(25);
    const now = frameCount();
    if (now === seen && i >= 1) return;
    seen = now;
  }
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const strip = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const ENTER = "\r";

type View = { stdin: { write: (s: string) => void }; lastFrame: () => string | undefined };

// Moves focus up until the arrow points at `label`, reading the screen rather
// than counting presses, so a field added to the form breaks no test.
async function focusOn(view: View, label: string) {
  for (let i = 0; i < 20; i++) {
    const line = strip(view.lastFrame())
      .split("\n")
      .find((l) => l.startsWith("→"));
    if (line?.includes(label)) return;
    view.stdin.write("\x1b[A");
    await tick();
  }
  throw new Error(`no field ${label}`);
}

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
    await focusOn(view, "Section");
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
    await focusOn(view, "Section");
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
    await focusOn(view, "Project");
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
    await focusOn(view, "Section");
    await tick();
    view.stdin.write(ENTER);
    await tick();
    expect(strip(view.lastFrame())).toContain("물리 has no sections");
    view.unmount();
  });
});

describe("form: labels", () => {
  const draft: Draft = {
    ...blankDraft("2026-09-01"),
    title: "화학 실험 {n}주차",
    weekdays: [4],
    from: "2026-09-04",
  };
  const form = (onSave: (d: Draft) => void, labels: string[], initial: Draft = draft) =>
    render(
      <Form
        heading="Edit"
        initial={initial}
        projects={[]}
        sections={() => []}
        labels={labels}
        isNew={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );

  test("labels are picked from the account's own, several at once", async () => {
    let saved: Draft | null = null;
    const view = form((d) => (saved = d), ["lab", "school", "urgent"]);
    await tick();
    await focusOn(view, "Labels");
    view.stdin.write(ENTER);
    await tick();
    view.stdin.write(" "); // lab
    view.stdin.write(DOWN);
    view.stdin.write(DOWN);
    view.stdin.write(" "); // urgent
    await tick();
    view.stdin.write(ENTER);
    await tick();
    expect(strip(view.lastFrame())).toContain("@lab @urgent");
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.labels).toEqual(["lab", "urgent"]);
    view.unmount();
  });

  test("a new label can be typed, with or without its @", async () => {
    let saved: Draft | null = null;
    const view = form((d) => (saved = d), []);
    await tick();
    await focusOn(view, "Labels");
    view.stdin.write("a");
    await tick();
    view.stdin.write("@화학");
    await tick();
    view.stdin.write(ENTER);
    await tick();
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.labels).toEqual(["화학"]);
    view.unmount();
  });

  test("x clears the labels", async () => {
    let saved: Draft | null = null;
    const view = form((d) => (saved = d), ["lab"], { ...draft, labels: ["lab"] });
    await tick();
    await focusOn(view, "Labels");
    view.stdin.write("x");
    await tick();
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.labels).toEqual([]);
    view.unmount();
  });
});

test("the project picker leaves the Inbox, and closes on the current choice", async () => {
  const base: Draft = {
    ...blankDraft("2026-09-01"),
    title: "t {n}",
    weekdays: [4],
    from: "2026-09-04",
  };
  const saves: Draft[] = [];
  const view = render(
    <Form
      heading="Edit"
      initial={base}
      projects={["화학실험", "물리"]}
      sections={() => []}
      isNew={false}
      onSave={(d) => saves.push(d)}
      onCancel={() => {}}
    />,
  );
  await tick();
  await focusOn(view, "Project");
  view.stdin.write(ENTER);
  await tick();
  view.stdin.write(DOWN); // Inbox -> 화학실험
  await tick();
  view.stdin.write(ENTER);
  await tick();
  view.stdin.write("\x13");
  await tick();
  expect(saves.at(-1)?.project).toBe("화학실험");
  // Picking the first entry again still closes the picker.
  view.stdin.write(ENTER);
  await tick();
  view.stdin.write(ENTER);
  await tick();
  view.stdin.write("\x13");
  await tick();
  expect(saves.at(-1)?.project).toBeNull();
  view.unmount();
});

describe("form: priority", () => {
  const draft: Draft = {
    ...blankDraft("2026-09-01"),
    title: "화학 실험 {n}주차",
    weekdays: [4],
    from: "2026-09-04",
  };
  const form = (onSave: (d: Draft) => void, initial: Draft = draft) =>
    render(
      <Form
        heading="Edit"
        initial={initial}
        projects={[]}
        sections={() => []}
        isNew={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );

  test("a new template starts at p4, and 1-4 set it as Todoist writes it", async () => {
    let saved: Draft | null = null;
    const view = form((d) => (saved = d));
    await tick();
    await focusOn(view, "Priority");
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.priority).toBe(1); // p4
    view.stdin.write("1");
    await tick();
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.priority).toBe(4); // p1
    view.unmount();
  });

  test("the arrows step towards p1 and stop at either end", async () => {
    let saved: Draft | null = null;
    const view = form((d) => (saved = d), { ...draft, priority: 3 });
    await tick();
    await focusOn(view, "Priority");
    for (let i = 0; i < 3; i++) view.stdin.write("\x1b[C");
    await tick();
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.priority).toBe(4);
    for (let i = 0; i < 5; i++) view.stdin.write("\x1b[D");
    await tick();
    view.stdin.write("\x13");
    await tick();
    expect((saved as Draft | null)?.priority).toBe(1);
    view.unmount();
  });
});

test("a held-down arrow counts every press, not just the last", async () => {
  let saved: Draft | null = null;
  const view = render(
    <Form
      heading="Edit"
      initial={{ ...blankDraft("2026-09-01"), title: "t {n}", weekdays: [4], from: "2026-09-04" }}
      projects={[]}
      sections={() => []}
      isNew={false}
      onSave={(d) => (saved = d)}
      onCancel={() => {}}
    />,
  );
  await tick();
  await focusOn(view, "Appears");
  for (let i = 0; i < 5; i++) view.stdin.write("\x1b[C"); // all before the next render
  await tick();
  view.stdin.write("\x13");
  await tick();
  expect((saved as Draft | null)?.lead).toBe(12);
  view.unmount();
});
