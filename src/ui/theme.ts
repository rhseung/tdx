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

// Ink's Text types `color` without undefined, and exactOptionalPropertyTypes
// holds it to that, so an optional colour is passed only when there is one.
export const tint = (value: string | undefined): { color?: string } =>
  value ? { color: value } : {};

export const symbol = {
  ok: "✓",
  fail: "✗",
  arrow: "→",
} as const;
