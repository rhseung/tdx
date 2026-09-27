// A month calendar driven from the keyboard.
//
// No Ink package has one, and typing ISO dates is exactly the chore this tool
// exists to remove. The grid starts on Monday, the way a timetable does.

import { Box, Text, useInput } from "ink";
import { useState } from "react";
import {
  addDays,
  type Day,
  daysInMonth,
  today as localToday,
  makeDay,
  parts,
  weekday,
} from "../core/day.ts";
import { isMouse } from "./mouse.ts";
import { color, tint } from "./theme.ts";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const HEADER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// Six weeks always, so the picker does not change height between months.
export function monthGrid(month: Day): Day[][] {
  const { year, month: m } = parts(month);
  const first = makeDay(year, m, 1);
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
  );
}

export function shiftMonth(day: Day, months: number): Day {
  const { year, month, date } = parts(day);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return makeDay(y, m, Math.min(date, daysInMonth(y, m)));
}

export interface DatePickerProps {
  initial?: Day | null;
  // Several dates at once (skip weeks): space toggles, enter finishes.
  multiple?: boolean;
  selected?: Day[];
  // Days worth drawing attention to, such as the rule's own deadlines.
  marked?: Set<Day>;
  onSubmit: (days: Day[]) => void;
  onCancel: () => void;
}

export function DatePicker({
  initial,
  multiple = false,
  selected = [],
  marked = new Set(),
  onSubmit,
  onCancel,
}: DatePickerProps) {
  const today = localToday();
  const [cursor, setCursor] = useState<Day>(initial ?? selected[0] ?? today);
  const [chosen, setChosen] = useState<Set<Day>>(new Set(selected));

  useInput((input, key) => {
    if (isMouse(input)) return;
    if (key.escape) return onCancel();
    if (key.leftArrow || input === "h") return setCursor((c) => addDays(c, -1));
    if (key.rightArrow || input === "l") return setCursor((c) => addDays(c, 1));
    if (key.upArrow || input === "k") return setCursor((c) => addDays(c, -7));
    if (key.downArrow || input === "j") return setCursor((c) => addDays(c, 7));
    if (key.pageUp || input === "[") return setCursor((c) => shiftMonth(c, -1));
    if (key.pageDown || input === "]") return setCursor((c) => shiftMonth(c, 1));
    if (input === "t") return setCursor(today);
    if (multiple && input === " ") {
      return setChosen((set) => {
        const next = new Set(set);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
    }
    if (key.return) onSubmit(multiple ? [...chosen].sort() : [cursor]);
  });

  const { year, month } = parts(cursor);
  return (
    <Box
      flexDirection="column"
      alignSelf="flex-start"
      borderStyle="round"
      borderColor={color.muted}
      paddingX={1}
    >
      <Text bold>
        {MONTHS[month - 1]} {year}
      </Text>
      <Text color={color.muted}>{HEADER.join(" ")}</Text>
      {monthGrid(cursor).map((week) => (
        <Text key={week[0]}>
          {week.map((day, i) => {
            const inMonth = parts(day).month === month;
            const isChosen = chosen.has(day);
            return (
              <Text key={day}>
                <Text
                  inverse={day === cursor}
                  dimColor={!inMonth}
                  {...tint(isChosen ? color.warn : marked.has(day) ? color.accent : undefined)}
                  underline={day === today}
                  strikethrough={isChosen}
                >
                  {String(parts(day).date).padStart(2)}
                </Text>
                {i < 6 ? " " : ""}
              </Text>
            );
          })}
        </Text>
      ))}
      <Text color={color.muted}>
        {`←→↑↓ move · [ ] month · t today · ${multiple ? "space toggle · " : ""}enter done · esc cancel`}
      </Text>
    </Box>
  );
}
