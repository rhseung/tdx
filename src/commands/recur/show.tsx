import { Box, Text } from "ink";
import { argument } from "pastel";
import { z } from "zod";
import { today } from "../../core/day.ts";
import { loadChecked } from "../../recur/feature.tsx";
import { appearsOn, describeEvery, dueFor, occurrences, take, title } from "../../recur/rule.ts";
import { outputOptions } from "../../ui/options.ts";
import { outputOf, printJson } from "../../ui/output.tsx";
import { Fields } from "../../ui/parts.tsx";
import { Run } from "../../ui/run.tsx";
import { color, symbol, tint } from "../../ui/theme.ts";

export const description = "One template, its rule and next deadlines";

export const options = outputOptions;

export const args = z.tuple([
  z.string().describe(argument({ name: "id", description: "Template id" })),
]);

type Props = { options: z.infer<typeof options>; args: z.infer<typeof args> };

function relative(days: number): string {
  if (days === 0) return "on the deadline";
  const n = Math.abs(days);
  return `${n} day${n === 1 ? "" : "s"} ${days < 0 ? "before" : "after"} the deadline`;
}

export default function Show({ options, args: [id] }: Props) {
  const output = outputOf(options);
  return (
    <Run
      output={output}
      failure="recur show failed"
      task={async () => {
        const { checked, state } = await loadChecked([id]);
        const one = checked[0];
        if (!one) throw new Error(`no template ${id}`);
        const { template, rule, notes, errors } = one;
        const made = Object.keys(state.created[template.id] ?? {}).length;
        if (output.mode === "json") {
          printJson({ template, rule, notes, errors, made });
          return null;
        }

        const fields: [string, string][] = [
          ["template", template.content],
          ["id", template.id],
        ];
        if (rule) {
          fields.push(["every", describeEvery(rule.every)]);
          fields.push(["from", rule.from + (rule.until ? `  until ${rule.until}` : "")]);
          if (rule.skip.length) fields.push(["skip", rule.skip.join(", ")]);
          fields.push(["appears", `${rule.lead} days before the deadline`]);
          if (rule.due !== null) fields.push(["due", relative(rule.due)]);
          fields.push(["project", rule.project ?? "Inbox"]);
          if (rule.section) fields.push(["section", rule.section]);
        }
        fields.push(["made", String(made)]);
        if (notes) fields.push(["notes", notes]);
        if (template.children.length) {
          fields.push(["subtasks", template.children.map((c) => c.content).join(", ")]);
        }
        const next = rule ? take(occurrences(rule), 400).filter((o) => o.deadline >= today()) : [];
        const upcoming = next.slice(0, 5).map((o) => {
          if (!rule || o.skipped) return `${o.deadline}  skipped`;
          const due = dueFor(rule, o.deadline);
          return `${o.deadline}  ${title(template.content, o)}${due ? `  due ${due}` : ""}  appears ${appearsOn(rule, o.deadline)}`;
        });

        if (output.mode === "plain") {
          for (const [key, value] of fields) process.stdout.write(`${key}\t${value}\n`);
          for (const line of upcoming) process.stdout.write(`next\t${line}\n`);
          for (const error of errors) process.stdout.write(`error\t${error}\n`);
          return null;
        }
        return (
          <Box flexDirection="column" gap={1}>
            <Fields rows={fields} />
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
                <Text bold>next</Text>
                {upcoming.map((line) => (
                  <Text key={line} {...tint(line.includes("skipped") ? color.muted : undefined)}>
                    {line}
                  </Text>
                ))}
              </Box>
            ) : null}
          </Box>
        );
      }}
    />
  );
}
