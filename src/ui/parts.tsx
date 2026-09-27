import { Box, Text } from "ink";
import { fit, width } from "./text.ts";
import { color, symbol, tint } from "./theme.ts";

export function ErrorBox({ title, message }: { title: string; message: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color.error} paddingX={1}>
      <Text color={color.error} bold>
        {symbol.fail} {title}
      </Text>
      <Text>{message}</Text>
    </Box>
  );
}

export function Summary({ parts }: { parts: [string, string | undefined][] }) {
  return (
    <Text>
      {parts.map(([text, shade], i) => (
        <Text key={text} {...tint(shade)}>
          {i ? " · " : ""}
          {text}
        </Text>
      ))}
    </Text>
  );
}

// Key-value lines with the keys lined up, for `status` and `show`.
export function Fields({ rows }: { rows: [string, React.ReactNode][] }) {
  const keyWidth = Math.max(...rows.map(([key]) => width(key)));
  return (
    <Box flexDirection="column">
      {rows.map(([key, value]) => (
        <Box key={key} gap={2}>
          <Text color={color.muted}>{fit(key, keyWidth)}</Text>
          {typeof value === "string" ? <Text>{value}</Text> : value}
        </Box>
      ))}
    </Box>
  );
}

type Change = "create" | "update" | "move" | "complete" | "remove" | "meta";

export interface OpRow {
  change: Change;
  verb: string;
  text: string;
}

const ORDER: Change[] = ["create", "update", "move", "complete", "remove", "meta"];
const MARK: Record<Change, string> = {
  create: "+",
  update: "~",
  move: "→",
  complete: "✓",
  remove: "-",
  meta: "·",
};

// A plan, grouped by what kind of change it makes, so a dry run reads as
// "3 created, 1 completed" before any single line has to be read.
export function OpList({ ops, limit = 40 }: { ops: OpRow[]; limit?: number }) {
  const sorted = [...ops].sort((a, b) => ORDER.indexOf(a.change) - ORDER.indexOf(b.change));
  const shown = sorted.slice(0, limit);
  const verbWidth = Math.max(0, ...shown.map((op) => width(op.verb)));
  return (
    <Box flexDirection="column">
      {shown.map((op, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ops repeat verbs and texts
        <Box key={i} gap={1}>
          <Text color={color[op.change]}>{MARK[op.change]}</Text>
          <Text color={color[op.change]}>{fit(op.verb, verbWidth)}</Text>
          <Text wrap="truncate-end">{op.text}</Text>
        </Box>
      ))}
      {sorted.length > shown.length ? (
        <Text color={color.muted}>… {sorted.length - shown.length} more</Text>
      ) : null}
    </Box>
  );
}

export function countChanges(ops: OpRow[]): [string, string | undefined][] {
  const counts = new Map<Change, number>();
  for (const op of ops) counts.set(op.change, (counts.get(op.change) ?? 0) + 1);
  const words: Record<Change, string> = {
    create: "created",
    update: "updated",
    move: "moved",
    complete: "completed",
    remove: "deleted",
    meta: "other",
  };
  return ORDER.filter((c) => counts.get(c)).map((c) => [`${counts.get(c)} ${words[c]}`, color[c]]);
}
