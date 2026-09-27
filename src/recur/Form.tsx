// The template form: every field on one screen, with the deadlines it would
// produce redrawn under it on each keystroke.
//
// Seeing "13 deadlines, the last on 12/18, skipping 10/23" while choosing the
// dates is the point; a wizard that asks one question at a time would hide the
// consequence until the end.

import { Select, TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { type ReactNode, useMemo, useState } from "react";
import { type Day, today as localToday } from "../core/day.ts";
import { DatePicker } from "../ui/DatePicker.tsx";
import { isMouse } from "../ui/mouse.ts";
import { fit } from "../ui/text.ts";
import { color, symbol, tint } from "../ui/theme.ts";
import { type Draft, ruleOf, TITLE_EMPTY, validate } from "./draft.ts";
import {
  appearsOn,
  dueFor,
  type Occurrence,
  occurrences,
  take,
  title,
  WEEKDAY_NAMES,
} from "./rule.ts";

const FIELDS = [
  "title",
  "repeats",
  "interval",
  "on",
  "from",
  "until",
  "skip",
  "lead",
  "due",
  "project",
  "subtasks",
  "notes",
  "save",
] as const;
type Field = (typeof FIELDS)[number];

const LABELS: Record<Field, string> = {
  title: "Title",
  repeats: "Repeats",
  interval: "Every",
  on: "On",
  from: "First",
  until: "Until",
  skip: "Skip",
  lead: "Appears",
  due: "Due",
  project: "Project",
  subtasks: "Subtasks",
  notes: "Notes",
  save: "",
};

const HINTS: Partial<Record<Field, string>> = {
  title: "enter to edit · {n} is the number, {date} the deadline",
  repeats: "←→ switch",
  interval: "←→ change",
  on: "←→ move · space or 1-7 toggle",
  from: "enter to pick",
  until: "enter to pick · x clear",
  skip: "enter to pick several",
  lead: "←→ change",
  due: "←→ change · x none",
  project: "enter to pick",
  subtasks: "enter to add · x remove the last",
  notes: "enter to edit · copied into every task",
  save: "enter or ctrl+s to save · esc to cancel",
};

type Editing =
  | null
  | { kind: "text"; field: "title" | "notes" | "subtasks" }
  | { kind: "date"; field: "from" | "until" | "skip" }
  | { kind: "project" };

const short = (day: Day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;

function days(n: number, word: string): string {
  if (n === 0) return `on the ${word}`;
  return `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ${n < 0 ? "before" : "after"} the ${word}`;
}

export interface FormProps {
  heading: string;
  initial: Draft;
  projects: string[];
  isNew: boolean;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}

export function Form({ heading, initial, projects, isNew, onSave, onCancel }: FormProps) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [focus, setFocus] = useState<Field>("title");
  const [editing, setEditing] = useState<Editing>(isNew ? { kind: "text", field: "title" } : null);
  const [dayCursor, setDayCursor] = useState(draft.weekdays[0] ?? 0);
  const [tried, setTried] = useState(false);
  const errors = validate(draft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const fields = FIELDS;
  const move = (step: number) =>
    setFocus((f) => fields[(fields.indexOf(f) + step + fields.length) % fields.length] ?? f);

  const save = () => {
    setTried(true);
    if (!errors.length) onSave(draft);
  };

  const adjust = (step: number) => {
    switch (focus) {
      case "repeats":
        return set({ mode: draft.mode === "weekly" ? "monthly" : "weekly" });
      case "interval":
        return set({ interval: Math.max(1, draft.interval + step) });
      case "on":
        if (draft.mode === "monthly") {
          return set({ monthDay: ((draft.monthDay - 1 + step + 31) % 31) + 1 });
        }
        return setDayCursor((c) => (c + step + 7) % 7);
      case "lead":
        return set({ lead: Math.max(0, draft.lead + step) });
      case "due":
        return set({ due: (draft.due ?? 0) + step });
      default:
        // Text, dates and the project change through enter, not the arrows.
        return;
    }
  };

  const toggleDay = (day: number) =>
    set({
      weekdays: draft.weekdays.includes(day)
        ? draft.weekdays.filter((d) => d !== day)
        : [...draft.weekdays, day].sort(),
    });

  useInput(
    (input, key) => {
      if (isMouse(input)) return;
      if (key.escape) return onCancel();
      if (key.ctrl && input === "s") return save();
      if (key.upArrow || (key.shift && key.tab)) return move(-1);
      if (key.downArrow || key.tab) return move(1);
      if (key.leftArrow) return adjust(-1);
      if (key.rightArrow) return adjust(1);
      if (focus === "on" && draft.mode === "weekly") {
        if (input === " ") return toggleDay(dayCursor);
        if (/^[1-7]$/.test(input)) return toggleDay(Number(input) - 1);
      }
      if (input === "x") {
        if (focus === "until") return set({ until: null });
        if (focus === "due") return set({ due: null });
        if (focus === "subtasks") return set({ subtasks: draft.subtasks.slice(0, -1) });
        if (focus === "skip") return set({ skip: [] });
      }
      if (!key.return) return;
      switch (focus) {
        case "title":
        case "notes":
        case "subtasks":
          return setEditing({ kind: "text", field: focus });
        case "from":
        case "until":
        case "skip":
          return setEditing({ kind: "date", field: focus });
        case "project":
          return setEditing({ kind: "project" });
        case "save":
          return save();
        default:
          return move(1);
      }
    },
    { isActive: editing === null },
  );

  // The deadlines depend on the schedule alone, so an unfinished title must
  // not blank the preview -- that is when it is most useful.
  const valid = !errors.some((e) => e !== TITLE_EMPTY);
  // Keyed on the rule's text: a fresh Rule object every render would defeat
  // the memo, and walking a semester of dates on every keystroke is wasteful.
  const ruleKey = JSON.stringify(ruleOf(draft));
  const upcoming = useMemo((): Occurrence[] => {
    if (!valid) return [];
    const today = localToday();
    return take(occurrences(JSON.parse(ruleKey)), 400).filter((o) => o.deadline >= today);
  }, [valid, ruleKey]);
  // The rule's own deadlines, skipped or not, lit up in the calendar so a
  // skip is picked from real deadlines rather than guessed.
  const marked = useMemo(() => {
    if (!valid) return new Set<Day>();
    const rule = { ...JSON.parse(ruleKey), skip: [] };
    return new Set(take(occurrences(rule), 400).map((o) => o.deadline));
  }, [valid, ruleKey]);

  const value = (field: Field): ReactNode => {
    switch (field) {
      case "title":
        return draft.title || <Text color={color.muted}>화학 실험 {"{n}"}주차</Text>;
      case "repeats":
        return (
          <Text>
            <Text inverse={draft.mode === "weekly"}> weekly </Text>{" "}
            <Text inverse={draft.mode === "monthly"}> monthly </Text>
          </Text>
        );
      case "interval":
        return `${draft.interval} ${draft.mode === "weekly" ? "week" : "month"}${draft.interval > 1 ? "s" : ""}`;
      case "on":
        if (draft.mode === "monthly") return `day ${draft.monthDay}`;
        return (
          <Text>
            {WEEKDAY_NAMES.map((name, i) => (
              <Text key={name}>
                <Text
                  inverse={focus === "on" && i === dayCursor}
                  color={draft.weekdays.includes(i) ? color.accent : color.muted}
                  bold={draft.weekdays.includes(i)}
                >
                  {name}
                </Text>{" "}
              </Text>
            ))}
          </Text>
        );
      case "from":
        return draft.from;
      case "until":
        return draft.until ?? <Text color={color.muted}>no end</Text>;
      case "skip":
        return draft.skip.length ? (
          draft.skip.map(short).join(", ")
        ) : (
          <Text color={color.muted}>none</Text>
        );
      case "lead":
        return `${draft.lead} day${draft.lead === 1 ? "" : "s"} before the deadline`;
      case "due":
        return draft.due === null ? (
          <Text color={color.muted}>no due date</Text>
        ) : (
          days(draft.due, "deadline")
        );
      case "project":
        return draft.project ?? "Inbox";
      case "subtasks":
        return draft.subtasks.length ? (
          draft.subtasks.join(", ")
        ) : (
          <Text color={color.muted}>none</Text>
        );
      case "notes":
        return draft.notes || <Text color={color.muted}>none</Text>;
      case "save":
        return (
          <Text color={errors.length ? color.muted : color.ok} bold>
            [ {isNew ? "Create" : "Save"} ]
          </Text>
        );
    }
  };

  const editor = (): ReactNode => {
    if (!editing) return null;
    if (editing.kind === "text") {
      const field = editing.field;
      const initialText = field === "subtasks" ? "" : draft[field];
      return (
        <EscapeAware onEscape={() => setEditing(null)}>
          <Box gap={1}>
            <Text color={color.accent}>{field === "subtasks" ? "new subtask" : LABELS[field]}</Text>
            <TextInput
              defaultValue={initialText}
              placeholder={field === "title" ? "화학 실험 {n}주차" : ""}
              onSubmit={(text) => {
                if (field === "subtasks") {
                  if (text.trim()) set({ subtasks: [...draft.subtasks, text.trim()] });
                } else set({ [field]: text });
                setEditing(null);
                if (field === "title" && isNew) move(1);
              }}
            />
          </Box>
        </EscapeAware>
      );
    }
    if (editing.kind === "date") {
      const field = editing.field;
      return (
        <DatePicker
          initial={
            field === "skip" ? (upcoming[0]?.deadline ?? draft.from) : (draft[field] ?? draft.from)
          }
          multiple={field === "skip"}
          selected={field === "skip" ? draft.skip : []}
          marked={marked}
          onCancel={() => setEditing(null)}
          onSubmit={(picked) => {
            if (field === "skip") set({ skip: picked });
            else if (picked[0]) set({ [field]: picked[0] });
            setEditing(null);
          }}
        />
      );
    }
    return (
      <EscapeAware onEscape={() => setEditing(null)}>
        <Select
          visibleOptionCount={8}
          defaultValue={draft.project ?? ""}
          options={[
            { label: "Inbox", value: "" },
            ...projects.map((p) => ({ label: p, value: p })),
          ]}
          onChange={(picked) => {
            set({ project: picked || null });
            setEditing(null);
          }}
        />
      </EscapeAware>
    );
  };

  const labelWidth = 9;
  return (
    <Box flexDirection="column">
      <Text bold>{heading}</Text>
      <Box flexDirection="column" marginTop={1}>
        {fields.map((field) => (
          <Box key={field} gap={1}>
            <Text {...tint(focus === field ? color.accent : undefined)}>
              {focus === field ? symbol.arrow : " "}
            </Text>
            <Text color={color.muted}>{fit(LABELS[field], labelWidth)}</Text>
            <Text wrap="truncate-end">{value(field)}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>{editor() ?? <Text color={color.muted}>{HINTS[focus] ?? ""}</Text>}</Box>
      <Preview
        draft={draft}
        errors={tried || !isNew ? errors : errors.filter((e) => e !== TITLE_EMPTY)}
        upcoming={upcoming}
      />
    </Box>
  );
}

function EscapeAware({ onEscape, children }: { onEscape: () => void; children: ReactNode }) {
  useInput((_, key) => {
    if (key.escape) onEscape();
  });
  return <>{children}</>;
}

function Preview({
  draft,
  errors,
  upcoming,
}: {
  draft: Draft;
  errors: string[];
  upcoming: Occurrence[];
}) {
  if (errors.length) {
    return (
      <Box flexDirection="column" marginTop={1}>
        {errors.map((e) => (
          <Text key={e} color={color.error}>
            {symbol.fail} {e}
          </Text>
        ))}
      </Box>
    );
  }
  const rule = ruleOf(draft);
  const real = upcoming.filter((o) => !o.skipped);
  const shown = upcoming.slice(0, 6);
  const last = real.at(-1);
  const total = draft.until
    ? `${real.length} deadlines left, the last on ${last?.deadline ?? "-"}`
    : "no end date";
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        Upcoming <Text color={color.muted}>· {total}</Text>
      </Text>
      {shown.map((o) => {
        const due = dueFor(rule, o.deadline);
        const line = o.skipped
          ? `${fit("-", 3, "right")}  ${o.deadline}  skipped`
          : [
              fit(String(o.n), 3, "right"),
              o.deadline,
              fit(title(draft.title || "…", o), 28),
              fit(`appears ${short(appearsOn(rule, o.deadline))}`, 13),
              due ? `due ${short(due)}` : "",
            ].join("  ");
        return (
          <Text key={o.deadline} {...tint(o.skipped ? color.muted : undefined)} wrap="truncate-end">
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
