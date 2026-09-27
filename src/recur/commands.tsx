import type { Command } from "commander";
import { Box, Text } from "ink";
import { today } from "../core/day.ts";
import { recordRun } from "../core/features.ts";
import { fail, printOps, Result, readIds, withOutput } from "../ui/command.tsx";
import { type OutputFlags, outputOf, printJson, printStatic, showTable } from "../ui/output.tsx";
import { Fields } from "../ui/parts.tsx";
import { withProgress } from "../ui/progress.tsx";
import type { Column } from "../ui/Table.tsx";
import { color, symbol } from "../ui/theme.ts";
import {
  loadChecked,
  type OccurrenceRow,
  occurrenceRows,
  runRecur,
  type TemplateRow,
  templateRows,
} from "./feature.tsx";
import { deleteTemplate, TEMPLATES_PROJECT } from "./io.ts";
import { appearsOn, describeEvery, dueFor, occurrences, take, title } from "./rule.ts";

function relative(days: number): string {
  if (days === 0) return "on the deadline";
  const n = Math.abs(days);
  return `${n} day${n === 1 ? "" : "s"} ${days < 0 ? "before" : "after"} the deadline`;
}

const statusColor: Record<string, string> = {
  created: color.ok,
  planned: color.accent,
  skipped: color.muted,
  past: color.muted,
};

export const templateColumns: Column<TemplateRow>[] = [
  { header: "template", value: (r) => r.name, shrink: 3 },
  { header: "every", value: (r) => r.every, color: () => color.muted },
  { header: "next", value: (r) => r.next ?? "", min: 10 },
  { header: "made", value: (r) => String(r.made), align: "right" },
  {
    header: "status",
    value: (r) => r.status,
    color: (r) => (r.ok ? (r.status === "ok" ? color.ok : color.muted) : color.error),
    shrink: 4,
  },
];

export const occurrenceColumns: Column<OccurrenceRow>[] = [
  { header: "n", value: (r) => (r.n === null ? "-" : String(r.n)), align: "right" },
  { header: "title", value: (r) => r.title, shrink: 4 },
  { header: "deadline", value: (r) => r.deadline, min: 10 },
  { header: "due", value: (r) => r.due ?? "", color: () => color.muted },
  { header: "appears", value: (r) => r.appears, color: () => color.muted },
  { header: "status", value: (r) => r.status, color: (r) => statusColor[r.status] },
];

async function list(flags: OutputFlags) {
  const output = outputOf(flags);
  const { checked, state, workspace } = await loadChecked();
  const rows = templateRows(checked, state, today());
  await showTable(
    {
      columns: templateColumns,
      rows,
      id: (r) => r.id,
      json: (r) => r,
      empty: workspace.templatesProject
        ? `No templates yet. Add one with \`tdx recur new\`.`
        : `No ${TEMPLATES_PROJECT} project yet. \`tdx recur new\` makes it.`,
    },
    output,
  );
}

export function registerRecur(program: Command): Command {
  const recur = program
    .command("recur")
    .description("assignments that come out on a schedule, with a deadline each time");

  withOutput(recur.command("list", { isDefault: true }).description("list templates")).action(list);

  withOutput(
    recur
      .command("preview [ids...]")
      .description("every deadline a template makes, past and upcoming")
      .option("--upcoming <count>", "upcoming deadlines per template", "12"),
  ).action(async (ids: string[], flags: OutputFlags & { upcoming: string }) => {
    const output = outputOf(flags);
    const { checked, state } = await loadChecked(await readIds(ids));
    const rows = occurrenceRows(checked, state, today(), Number(flags.upcoming));
    await showTable(
      {
        columns: occurrenceColumns,
        rows,
        id: (r) => `${r.templateId}:${r.deadline}`,
        json: (r) => r,
        empty: "no templates with a valid rule",
      },
      output,
    );
  });

  withOutput(
    recur.command("show <id>").description("one template, its rule and next deadlines"),
  ).action(async (id: string, flags: OutputFlags) => {
    const output = outputOf(flags);
    const { checked, state } = await loadChecked([id]);
    const one = checked[0];
    if (!one) fail(output, "no such template", id);
    const { template, rule, notes, errors } = one;
    const next = rule ? take(occurrences(rule), 400).filter((o) => o.deadline >= today()) : [];
    const made = Object.keys(state.created[template.id] ?? {}).length;
    if (output.mode === "json") return printJson({ template, rule, notes, errors, made });

    const fields: [string, string][] = [
      ["template", template.content],
      ["id", template.id],
    ];
    if (rule) {
      fields.push(["every", describeEvery(rule.every)]);
      fields.push(["from", rule.from + (rule.until ? `  until ${rule.until}` : "")]);
      if (rule.skip.length) fields.push(["skip", rule.skip.join(", ")]);
      fields.push(["appears", `${rule.lead} days before the deadline`]);
      if (rule.due !== null) fields.push(["due", `${rule.due} days from the deadline`]);
      fields.push(["project", rule.project ?? "Inbox"]);
    }
    fields.push(["made", String(made)]);
    if (notes) fields.push(["notes", notes]);
    if (template.children.length) {
      fields.push(["subtasks", template.children.map((c) => c.content).join(", ")]);
    }
    const upcoming = next.slice(0, 5).map((o) => {
      const due = rule ? dueFor(rule, o.deadline) : null;
      const shown = rule ? appearsOn(rule, o.deadline) : "";
      return o.skipped
        ? `${o.deadline}  skipped`
        : `${o.deadline}  ${title(template.content, o)}${due ? `  due ${due}` : ""}  appears ${shown}`;
    });

    if (output.mode === "plain") {
      for (const [key, value] of fields) process.stdout.write(`${key}\t${value}\n`);
      for (const line of upcoming) process.stdout.write(`next\t${line}\n`);
      for (const error of errors) process.stdout.write(`error\t${error}\n`);
      return;
    }
    printStatic(
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
              <Text key={line} color={line.includes("skipped") ? color.muted : undefined}>
                {line}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>,
    );
  });

  withOutput(
    recur
      .command("run [ids...]")
      .description("make every task that is due to appear by now")
      .option("-n, --dry-run", "show what would be made, make nothing"),
  ).action(async (ids: string[], flags: OutputFlags & { dryRun?: boolean }) => {
    const output = outputOf(flags);
    try {
      const chosen = await readIds(ids);
      const result = await withProgress(output, async (progress) => {
        const result = await runRecur(progress, { dryRun: flags.dryRun, ids: chosen });
        if (output.mode === "ink") {
          progress.show(
            <Result ops={result.ops} dryRun={flags.dryRun} summary="nothing is due yet" />,
          );
        }
        return result;
      });
      if (!flags.dryRun && !chosen.length) recordRun("recur", true, result.summary);
      if (output.mode === "json") printJson(result.raw);
      if (output.mode === "plain") printOps(result.ops);
    } catch (error) {
      fail(output, "recur run failed", error);
    }
  });

  recur
    .command("rm <ids...>")
    .description("delete templates (tasks already made stay)")
    .action(async (ids: string[]) => {
      const output = outputOf();
      const chosen = await readIds(ids);
      const { api, state, workspace } = await loadChecked();
      const known = new Map(workspace.templates.map((t) => [t.id, t.content]));
      for (const id of chosen) {
        const name = known.get(id);
        if (!name) fail(output, "no such template", id);
        await deleteTemplate(api, state, id);
        if (output.mode === "ink") {
          printStatic(
            <Text>
              <Text color={color.remove}>- </Text>
              {name}
            </Text>,
          );
        } else process.stdout.write(`removed\t${id}\t${name}\n`);
      }
    });

  return recur;
}
