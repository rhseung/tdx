import { Box, Text } from "ink";
import { argument } from "pastel";
import { z } from "zod";
import { today } from "../../core/day.ts";
import { t } from "../../i18n/index.ts";
import { requireTerminal } from "../../recur/app.tsx";
import { loadChecked } from "../../recur/feature.tsx";
import type { Checked, RecurState } from "../../recur/plan.ts";
import { appearsOn, describeEvery, dueFor, occurrences, take, title } from "../../recur/rule.ts";
import { outputOptions } from "../../ui/options.ts";
import { type Output, outputOf, printJson } from "../../ui/output.tsx";
import { Fields } from "../../ui/parts.tsx";
import { PickThen } from "../../ui/pick.tsx";
import { Run } from "../../ui/run.tsx";
import { color, symbol, tint } from "../../ui/theme.ts";

export const description = t.help.commands.recurShow;

export const options = outputOptions;

export const args = z.tuple([
  z
    .string()
    .optional()
    .describe(argument({ name: "id", description: t.help.templateId })),
]);

type Props = { options: z.infer<typeof options>; args: z.infer<typeof args> };

// Keys stay English in plain output, where a script may read them; on screen
// they are labels in the reader's language.
type Key =
  | "template"
  | "id"
  | "every"
  | "from"
  | "skip"
  | "appears"
  | "due"
  | "project"
  | "section"
  | "labels"
  | "made"
  | "notes"
  | "subtasks";

export default function Show({ options, args: [id] }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure={t.failed("recur show")}
      task={async (progress) => {
        const { checked, state } = await progress.step(t.steps.readTemplates, () => loadChecked());
        if (id) {
          const one = checked.find((c) => c.template.id === id);
          if (!one) throw new Error(t.recur.noTemplate(id));
          return view(one, state, output);
        }
        // No id: pick by name, then show it.
        requireTerminal("show");
        if (!checked.length) throw new Error(t.recur.noTemplates);
        return (done) => (
          <PickThen
            choices={checked.map((c) => ({ id: c.template.id, label: c.template.content }))}
            prompt={t.recur.pickShow}
            done={done}
            then={([picked]) => {
              const one = checked.find((c) => c.template.id === picked);
              return one ? view(one, state, output) : null;
            }}
          />
        );
      }}
    />
  );
}

function view(one: Checked, state: RecurState, output: Output) {
  const { template, rule, notes, errors } = one;
  const made = Object.keys(state.created[template.id] ?? {}).length;
  if (output.mode === "json") {
    printJson({ template, rule, notes, errors, made });
    return null;
  }

  const fields: [Key, string][] = [
    ["template", template.content],
    ["id", template.id],
  ];
  if (rule) {
    fields.push(["every", describeEvery(rule.every)]);
    fields.push(["from", rule.from + (rule.until ? `  ${t.recur.show.until} ${rule.until}` : "")]);
    if (rule.skip.length) fields.push(["skip", rule.skip.join(", ")]);
    fields.push(["appears", t.recur.show.appearsValue(rule.lead)]);
    if (rule.due !== null) fields.push(["due", t.recur.relative(rule.due)]);
    fields.push(["project", rule.project ?? t.recur.inbox]);
    if (rule.section) fields.push(["section", rule.section]);
  }
  fields.push(["made", String(made)]);
  if (notes) fields.push(["notes", notes]);
  if (template.labels.length) {
    fields.push(["labels", template.labels.map((l) => `@${l}`).join(" ")]);
  }
  if (template.children.length) {
    fields.push(["subtasks", template.children.map((c) => c.content).join(", ")]);
  }
  const next = rule ? take(occurrences(rule), 400).filter((o) => o.deadline >= today()) : [];
  const upcoming = next.slice(0, 5).map((o) => {
    if (!rule || o.skipped)
      return { skipped: true, text: `${o.deadline}  ${t.recur.show.skipped}` };
    const due = dueFor(rule, o.deadline);
    const parts = [o.deadline, title(template.content, o)];
    if (due) parts.push(t.recur.show.dueOn(due));
    parts.push(t.recur.show.appearsOn(appearsOn(rule, o.deadline)));
    return { skipped: false, text: parts.join("  ") };
  });

  if (output.mode === "plain") {
    for (const [key, value] of fields) process.stdout.write(`${key}\t${value}\n`);
    for (const line of upcoming) process.stdout.write(`next\t${line.text}\n`);
    for (const error of errors) process.stdout.write(`error\t${error}\n`);
    return null;
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Fields rows={fields.map(([key, value]) => [t.recur.show[key], value])} />
      {errors.length ? (
        <Box flexDirection="column">
          {errors.map((e) => (
            <Text key={e} color={color.error}>
              {symbol.fail} {e}
            </Text>
          ))}
        </Box>
      ) : null}
      {upcoming.length ? (
        <Box flexDirection="column">
          <Text bold>{t.recur.show.next}</Text>
          {upcoming.map((line) => (
            <Text key={line.text} {...tint(line.skipped ? color.muted : undefined)}>
              {line.text}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
