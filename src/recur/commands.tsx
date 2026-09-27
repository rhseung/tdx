import type { Command } from "commander";
import { Box, Text } from "ink";
import { today } from "../core/day.ts";
import { recordRun } from "../core/features.ts";
import { fail, printOps, Result, readIds, withOutput } from "../ui/command.tsx";
import {
  type OutputFlags,
  outputOf,
  printJson,
  printStatic,
  runScreen,
  showTable,
} from "../ui/output.tsx";
import { Fields } from "../ui/parts.tsx";
import { pick } from "../ui/pick.tsx";
import { withProgress } from "../ui/progress.tsx";
import { color, symbol, tint } from "../ui/theme.ts";
import { RecurApp } from "./app.tsx";
import { occurrenceColumns, templateColumns } from "./columns.ts";
import { loadChecked, occurrenceRows, runRecur, templateRows } from "./feature.tsx";
import { deleteTemplate, TEMPLATES_PROJECT } from "./io.ts";
import { appearsOn, describeEvery, dueFor, occurrences, take, title } from "./rule.ts";

function relative(days: number): string {
  if (days === 0) return "on the deadline";
  const n = Math.abs(days);
  return `${n} day${n === 1 ? "" : "s"} ${days < 0 ? "before" : "after"} the deadline`;
}

async function openApp(start: Parameters<typeof RecurApp>[0]["start"], standalone: boolean) {
  const initial = await loadChecked();
  const messages: string[] = [];
  await runScreen(
    <RecurApp
      initial={initial}
      start={start}
      standalone={standalone}
      onMessage={(m) => messages.push(m)}
    />,
  );
  // The app ran in the alternate screen, so what it did is repeated here,
  // where it stays in the scrollback.
  for (const message of messages) process.stdout.write(`${message}\n`);
}

function interactive(command: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(`tdx recur ${command} needs a terminal\n`);
    process.exit(1);
  }
}

async function list(flags: OutputFlags) {
  const output = outputOf(flags);
  if (output.mode === "ink" && output.pager) return openApp({ kind: "list" }, false);
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

  recur
    .command("new")
    .description("make a template in a form, with its deadlines previewed as you type")
    .action(async () => {
      interactive("new");
      await openApp({ kind: "form", id: null }, true);
    });

  recur
    .command("edit [id]")
    .description("edit a template in the form (no id: pick one)")
    .action(async (id?: string) => {
      interactive("edit");
      let chosen = id;
      if (!chosen) {
        const { workspace } = await loadChecked();
        chosen =
          (await pick(
            workspace.templates.map((t) => ({ id: t.id, label: t.content })),
            "Edit which template?",
            "tdx recur show {1}",
          )) ?? undefined;
      }
      if (chosen) await openApp({ kind: "form", id: chosen }, true);
    });

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
      if (rule.due !== null) fields.push(["due", relative(rule.due)]);
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
              <Text key={line} {...tint(line.includes("skipped") ? color.muted : undefined)}>
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
