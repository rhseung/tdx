// Todoist's API counts priority backwards from its app: 4 is p1, the most
// urgent, and 1 is p4, the default. Everything here is in the API's terms,
// and only what a person reads or types is turned into p1-p4.

export type Priority = 1 | 2 | 3 | 4;

// As the app lists them, most urgent first.
export const PRIORITIES: readonly Priority[] = [4, 3, 2, 1];

export const clampPriority = (n: number): Priority =>
  Math.min(4, Math.max(1, Math.round(n))) as Priority;

// "p1" <-> 4.
export const fromLabel = (p: number): Priority => clampPriority(5 - p);
export const priorityLabel = (p: Priority): string => `p${5 - p}`;
