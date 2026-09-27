// Calendar days as ISO strings.
//
// Every date this tool handles is a whole day -- a deadline, a due date, the
// day a section went empty. A JS Date carries a time and a zone, and doing day
// arithmetic on it drifts by one around midnight and DST. A "YYYY-MM-DD" string
// has neither, sorts correctly as a string, and is what both APIs speak.

export type Day = string;

const PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is Day {
  if (typeof value !== "string" || !PATTERN.test(value)) return false;
  return toUtc(value).toISOString().slice(0, 10) === value;
}

function toUtc(day: Day): Date {
  return new Date(`${day}T00:00:00Z`);
}

function fromUtc(date: Date): Day {
  return date.toISOString().slice(0, 10);
}

export function today(now: Date = new Date()): Day {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(day: Day, days: number): Day {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

// 0 is Monday, matching how a week is written in a timetable.
export function weekday(day: Day): number {
  return (toUtc(day).getUTCDay() + 6) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parts(day: Day): { year: number; month: number; date: number } {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return { year, month, date };
}

export function makeDay(year: number, month: number, date: number): Day {
  return fromUtc(new Date(Date.UTC(year, month - 1, date)));
}
