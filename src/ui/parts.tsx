import { Box, Text } from "ink";
import { t } from "../i18n/index.ts";
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
  // The verb stays a fixed word in the data (plain output prints it); only
  // what is drawn here is in the reader's language.
  const verb = (op: OpRow) => t.verbs[op.verb] ?? op.verb;
  const verbWidth = Math.max(0, ...shown.map((op) => width(verb(op))));
  return (
    <Box flexDirection="column">
      {shown.map((op, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ops repeat verbs and texts
        <Box key={i} gap={1}>
          <Text color={color[op.change]}>{MARK[op.change]}</Text>
          <Text color={color[op.change]}>{fit(verb(op), verbWidth)}</Text>
          <Text wrap="truncate-end">{op.text}</Text>
        </Box>
      ))}
      {sorted.length > shown.length ? (
        <Text color={color.muted}>{t.more(sorted.length - shown.length)}</Text>
      ) : null}
    </Box>
  );
}

export function countChanges(ops: OpRow[]): [string, string | undefined][] {
  const counts = new Map<Change, number>();
  for (const op of ops) counts.set(op.change, (counts.get(op.change) ?? 0) + 1);
  return ORDER.filter((c) => counts.get(c)).map((c) => [
    t.count(counts.get(c) ?? 0, t.changes[c] ?? c),
    color[c],
  ]);
}
