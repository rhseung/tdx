// Todoist's own palette where it has one, so a p1 here reads like a p1 there.

export const color = {
  accent: "#e44332", // Todoist red
  muted: "gray",
  ok: "green",
  warn: "yellow",
  error: "red",
  create: "green",
  update: "yellow",
  move: "cyan",
  complete: "blue",
  remove: "red",
  meta: "gray",
} as const;

// API priority 4 is the UI's p1.
export const priorityColor: Record<number, string> = {
  4: "#d1453b",
  3: "#eb8909",
  2: "#246fe0",
  1: "gray",
};

export const priorityLabel = (apiPriority: number): string => `p${5 - apiPriority}`;

export const symbol = {
  ok: "✓",
  fail: "✗",
  pending: "·",
  bullet: "•",
  arrow: "→",
} as const;
