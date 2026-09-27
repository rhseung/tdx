// The template form: every field on one screen, with the deadlines it would
// produce redrawn under it on each keystroke.
//
// Seeing "13 deadlines, the last on 12/18, skipping 10/23" while choosing the
// dates is the point; a wizard that asks one question at a time would hide the
// consequence until the end.

import { MultiSelect, Select, TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { type ReactNode, useMemo, useState } from "react";
import { type Day, today as localToday } from "../core/day.ts";
import { t } from "../i18n/index.ts";
import { DatePicker } from "../ui/date-picker.tsx";
import { isMouse } from "../ui/mouse.ts";
import { fit, width } from "../ui/text.ts";
import { color, symbol, tint } from "../ui/theme.ts";
import { type Draft, ruleOf, TITLE_EMPTY, validate } from "./draft.ts";
import { appearsOn, dueFor, type Occurrence, occurrences, take, title } from "./rule.ts";

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
  "section",
  "labels",
  "subtasks",
  "notes",
  "save",
] as const;
type Field = (typeof FIELDS)[number];

const LABELS = t.form.labels;
const HINTS = t.form.hints;

// @inkjs/ui's Select takes an empty value for "nothing chosen": focus will not
// leave an option whose value is "", and choosing it never fires onChange. So
// "no project" and "no section" need a value of their own -- one no Todoist
// name can take, since names come from the same list.
const NONE = "\u0000none";

// The current choice is marked in its label rather than passed as the Select's
// default: choosing the default again fires no onChange, which would leave the
// picker open on the one choice that should simply close it.
function choices([noneLabel, none]: [string, string], names: string[], current: string) {
  return [{ label: noneLabel, value: none }, ...names.map((n) => ({ label: n, value: n }))].map(
    (o) => (o.value === current ? { ...o, label: `${o.label} ·` } : o),
  );
}

type Editing =
  | null
  | { kind: "text"; field: "title" | "notes" | "subtasks" | "labels" }
  | { kind: "date"; field: "from" | "until" | "skip" }
  | { kind: "project" }
  | { kind: "section" }
  | { kind: "labels" };

const short = (day: Day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;

export interface FormProps {
  heading: string;
  initial: Draft;
  projects: string[];
  // Sections of a project by name; null is the Inbox.
  sections: (project: string | null) => string[];
  // Label names the account has, to pick from; a new one can be typed.
  labels?: string[];
  isNew: boolean;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}

export function Form({
  heading,
  initial,
  projects,
  sections,
  labels = [],
  isNew,
  onSave,
  onCancel,
}: FormProps) {
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

  // Each step is computed from the latest draft, not the one this render saw:
  // a held-down arrow delivers several presses between renders, and each has
  // to build on the last or all but one are lost.
  const change = (next: (d: Draft) => Partial<Draft>) => setDraft((d) => ({ ...d, ...next(d) }));
  const adjust = (step: number) => {
    switch (focus) {
      case "repeats":
        return change((d) => ({ mode: d.mode === "weekly" ? "monthly" : "weekly" }));
      case "interval":
        return change((d) => ({ interval: Math.max(1, d.interval + step) }));
      case "on":
        if (draft.mode === "monthly") {
          return change((d) => ({ monthDay: ((d.monthDay - 1 + step + 31) % 31) + 1 }));
        }
        return setDayCursor((c) => (c + step + 7) % 7);
      case "lead":
        return change((d) => ({ lead: Math.max(0, d.lead + step) }));
      case "due":
        return change((d) => ({ due: (d.due ?? 0) + step }));
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
        if (focus === "section") return set({ section: null });
        if (focus === "labels") return set({ labels: [] });
      }
      if (input === "a" && focus === "labels") {
        return setEditing({ kind: "text", field: "labels" });
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
        case "section":
          return setEditing({ kind: "section" });
        case "labels":
          return setEditing({ kind: "labels" });
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
            <Text inverse={draft.mode === "weekly"}> {t.form.weekly} </Text>{" "}
            <Text inverse={draft.mode === "monthly"}> {t.form.monthly} </Text>
          </Text>
        );
      case "interval":
        return t.form.interval(draft.interval, draft.mode === "weekly");
      case "on":
        if (draft.mode === "monthly") return t.form.monthDay(draft.monthDay);
        return (
          <Text>
            {t.recur.weekdays.map((name, i) => (
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
        return draft.until ?? <Text color={color.muted}>{t.form.noEnd}</Text>;
      case "skip":
        return draft.skip.length ? (
          draft.skip.map(short).join(", ")
        ) : (
          <Text color={color.muted}>{t.form.none}</Text>
        );
      case "lead":
        return t.form.lead(draft.lead);
      case "due":
        return draft.due === null ? (
          <Text color={color.muted}>{t.form.noDue}</Text>
        ) : (
          t.recur.relative(draft.due)
        );
      case "project":
        return draft.project ?? t.recur.inbox;
      case "section":
        return draft.section ?? <Text color={color.muted}>{t.form.none}</Text>;
      case "labels":
        return draft.labels.length ? (
          draft.labels.map((l) => `@${l}`).join(" ")
        ) : (
          <Text color={color.muted}>{t.form.none}</Text>
        );
      case "subtasks":
        return draft.subtasks.length ? (
          draft.subtasks.join(", ")
        ) : (
          <Text color={color.muted}>{t.form.none}</Text>
        );
      case "notes":
        return draft.notes || <Text color={color.muted}>{t.form.none}</Text>;
      case "save":
        return (
          <Text color={errors.length ? color.muted : color.ok} bold>
            [ {isNew ? t.form.create : t.form.save} ]
          </Text>
        );
    }
  };

  const editor = (): ReactNode => {
    if (!editing) return null;
    if (editing.kind === "text") {
      const field = editing.field;
      const adding = field === "subtasks" || field === "labels";
      const initialText = adding ? "" : draft[field];
      return (
        <EscapeAware onEscape={() => setEditing(null)}>
          <Box gap={1}>
            <Text color={color.accent}>
              {field === "subtasks"
                ? t.form.newSubtask
                : field === "labels"
                  ? t.form.newLabel
                  : LABELS[field]}
            </Text>
            <TextInput
              defaultValue={initialText}
              placeholder={field === "title" ? t.form.titlePlaceholder : ""}
              onSubmit={(text) => {
                const entry = text.trim().replace(/^@/, "");
                if (field === "subtasks") {
                  if (entry) set({ subtasks: [...draft.subtasks, entry] });
                } else if (field === "labels") {
                  // Todoist makes a label the first time a task names it.
                  if (entry && !draft.labels.includes(entry)) {
                    set({ labels: [...draft.labels, entry] });
                  }
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
    if (editing.kind === "labels") {
      const names = [...new Set([...labels, ...draft.labels])].sort();
      if (!names.length) {
        return (
          <EscapeAware onEscape={() => setEditing(null)}>
            <Text color={color.muted}>{t.form.noLabels}</Text>
          </EscapeAware>
        );
      }
      return (
        <EscapeAware onEscape={() => setEditing(null)}>
          <Box flexDirection="column">
            <MultiSelect
              visibleOptionCount={8}
              options={names.map((n) => ({ label: `@${n}`, value: n }))}
              defaultValue={draft.labels}
              onSubmit={(picked) => {
                set({ labels: picked });
                setEditing(null);
              }}
            />
            <Text color={color.muted}>{t.picker.multiKeys}</Text>
          </Box>
        </EscapeAware>
      );
    }
    if (editing.kind === "section") {
      const names = sections(draft.project);
      if (!names.length) {
        return (
          <EscapeAware onEscape={() => setEditing(null)}>
            <Text color={color.muted}>{t.form.noSections(draft.project ?? t.recur.inbox)}</Text>
          </EscapeAware>
        );
      }
      return (
        <EscapeAware onEscape={() => setEditing(null)}>
          <Select
            visibleOptionCount={8}
            options={choices([t.form.none, NONE], names, draft.section ?? NONE)}
            onChange={(picked) => {
              set({ section: picked === NONE ? null : picked });
              setEditing(null);
            }}
          />
        </EscapeAware>
      );
    }
    return (
      <EscapeAware onEscape={() => setEditing(null)}>
        <Select
          visibleOptionCount={8}
          options={choices([t.recur.inbox, NONE], projects, draft.project ?? NONE)}
          onChange={(picked) => {
            // A section belongs to one project; a new project starts with none.
            const project = picked === NONE ? null : picked;
            set(project === draft.project ? {} : { project, section: null });
            setEditing(null);
          }}
        />
      </EscapeAware>
    );
  };

  // The widest label in this language, plus a cell to breathe.
  const labelWidth = Math.max(...Object.values(LABELS).map(width)) + 1;
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
  const total = draft.until ? t.form.left(real.length, last?.deadline ?? "-") : t.form.noEndDate;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        {t.form.upcoming} <Text color={color.muted}>· {total}</Text>
      </Text>
      {shown.map((o) => {
        const due = dueFor(rule, o.deadline);
        const line = o.skipped
          ? `${fit("-", 3, "right")}  ${o.deadline}  ${t.form.skipped}`
          : [
              fit(String(o.n), 3, "right"),
              o.deadline,
              fit(title(draft.title || "…", o), 28),
              fit(t.form.appears(short(appearsOn(rule, o.deadline))), 13),
              due ? t.form.due(short(due)) : "",
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
