#!/usr/bin/env bun
import { Command } from "commander";
import { Box, Text } from "ink";
import pkg from "../package.json" with { type: "json" };
import * as agent from "./core/agent.ts";
import { disabled, lastRuns, recordRun, setEnabled } from "./core/features.ts";
import { FEATURES } from "./features.ts";
import { syncGithub } from "./github/feature.tsx";
import { GRACE_DAYS } from "./github/reconcile.ts";
import { initScript, SHELLS } from "./init.ts";
import { registerNudge } from "./nudge/commands.tsx";
import { registerRecur } from "./recur/commands.tsx";
import { fail, printOps, Result, withOutput } from "./ui/command.tsx";
import { type OutputFlags, outputOf, printJson, printStatic, showTable } from "./ui/output.tsx";
import { Fields, type OpRow } from "./ui/parts.tsx";
import { withProgress } from "./ui/progress.tsx";
import { color, symbol } from "./ui/theme.ts";
import { ago } from "./ui/time.ts";

const program = new Command("tdx")
  .description("A personal Todoist toolkit that fills the gaps td leaves.")
  .version(pkg.version)
  .showHelpAfterError();

withOutput(
  program
    .command("run")
    .description("run every enabled feature once (what the launchd agent calls)")
    .option("-n, --dry-run", "show what would change, change nothing")
    .option("--only <names>", "comma-separated features to run"),
).action(async (flags: OutputFlags & { dryRun?: boolean; only?: string }) => {
  const output = outputOf(flags);
  const only = flags.only ? new Set(flags.only.split(",")) : null;
  const off = disabled();
  const chosen = FEATURES.filter((f) => (only ? only.has(f.name) : !off.has(f.name)));
  const results: Record<string, { ok: boolean; summary: string; ops: OpRow[] }> = {};

  await withProgress(output, async (progress) => {
    // One feature failing must not starve the rest: they touch different
    // parts of Todoist, and a GitHub outage is no reason to skip a deadline.
    for (const feature of chosen) {
      progress.scope = feature.name;
      try {
        const result = await feature.run(progress, { dryRun: Boolean(flags.dryRun) });
        results[feature.name] = { ok: true, ...result };
      } catch (error) {
        const summary = error instanceof Error ? error.message : String(error);
        results[feature.name] = { ok: false, summary, ops: [] };
      }
      const r = results[feature.name];
      if (r && !flags.dryRun) recordRun(feature.name, r.ok, r.summary);
    }
    const ops = Object.values(results).flatMap((r) => r.ops);
    if (output.mode === "ink") progress.show(<Result ops={ops} dryRun={flags.dryRun} />);
  });

  if (output.mode === "json") printJson(results);
  if (output.mode === "plain") printOps(Object.values(results).flatMap((r) => r.ops));
  if (Object.values(results).some((r) => !r.ok)) process.exit(1);
});

const gh = program.command("gh").description("GitHub issues and PRs, mirrored into Todoist");

withOutput(
  gh
    .command("sync")
    .description("bring Todoist in line with GitHub")
    .option("-n, --dry-run", "show the plan, change nothing")
    .option("--force", "lift the bulk-completion guard")
    .option("--grace <days>", "days an empty section or sub-project may stay", String(GRACE_DAYS)),
).action(async (flags: OutputFlags & { dryRun?: boolean; force?: boolean; grace: string }) => {
  const output = outputOf(flags);
  try {
    const result = await withProgress(output, async (progress) => {
      const result = await syncGithub(progress, {
        dryRun: flags.dryRun,
        force: flags.force,
        grace: Number(flags.grace),
      });
      if (output.mode === "ink") {
        progress.show(
          <Result ops={result.ops} dryRun={flags.dryRun} summary="Todoist is up to date" />,
        );
      }
      return result;
    });
    if (!flags.dryRun) recordRun("gh", true, result.summary);
    if (output.mode === "json") printJson({ items: result.items, ops: result.raw });
    if (output.mode === "plain") printOps(result.ops);
  } catch (error) {
    if (!flags.dryRun)
      recordRun("gh", false, error instanceof Error ? error.message : String(error));
    fail(output, "gh sync failed", error);
  }
});

registerRecur(program);
registerNudge(program);

program
  .command("install")
  .description("install and load the launchd agent")
  .option("--interval <seconds>", "seconds between runs", String(agent.DEFAULT_INTERVAL))
  .action((flags: { interval: string }) => {
    const output = outputOf();
    try {
      const { path, legacy } = agent.install(Number(flags.interval));
      const lines: [string, string][] = [
        ["plist", path],
        ["every", `${flags.interval}s`],
        ["log", agent.LOG],
      ];
      if (legacy) lines.push(["replaced", agent.LEGACY_LABEL]);
      if (output.mode === "ink") {
        printStatic(
          <Box flexDirection="column">
            <Text color={color.ok}>{symbol.ok} agent loaded</Text>
            <Fields rows={lines} />
          </Box>,
        );
      } else {
        for (const [k, v] of lines) process.stdout.write(`${k}\t${v}\n`);
      }
    } catch (error) {
      fail(output, "install failed", error);
    }
  });

program
  .command("uninstall")
  .description("unload and remove the launchd agent")
  .action(() => {
    agent.uninstall();
    const output = outputOf();
    if (output.mode === "ink") printStatic(<Text color={color.ok}>{symbol.ok} agent removed</Text>);
    else process.stdout.write("removed\n");
  });

for (const [name, on] of [
  ["enable", true],
  ["disable", false],
] as const) {
  program
    .command(`${name} <feature>`)
    .description(`${on ? "include" : "skip"} a feature in \`tdx run\``)
    .action((feature: string) => {
      if (!FEATURES.some((f) => f.name === feature)) {
        fail(outputOf(), `unknown feature ${feature}`, FEATURES.map((f) => f.name).join(", "));
      }
      setEnabled(feature, on);
      process.stdout.write(`${feature} ${on ? "enabled" : "disabled"}\n`);
    });
}

withOutput(
  program.command("status").description("show the agent and each feature's last run"),
).action(async (flags: OutputFlags) => {
  const output = outputOf(flags);
  const status = agent.describe();
  const runs = lastRuns();
  const off = disabled();
  const rows = FEATURES.map((f) => ({
    name: f.name,
    enabled: !off.has(f.name),
    description: f.description,
    last: runs[f.name] ?? null,
  }));
  if (output.mode === "json") return printJson({ agent: status, features: rows });

  const table = {
    id: (r: (typeof rows)[number]) => r.name,
    json: (r: (typeof rows)[number]) => r,
    columns: [
      { header: "feature", value: (r: (typeof rows)[number]) => r.name, min: 4 },
      {
        header: "on",
        value: (r: (typeof rows)[number]) => (r.enabled ? "on" : "off"),
        color: (r: (typeof rows)[number]) => (r.enabled ? color.ok : color.muted),
      },
      {
        header: "last run",
        value: (r: (typeof rows)[number]) => (r.last ? ago(r.last.at) : "never"),
        color: () => color.muted,
      },
      {
        header: "result",
        value: (r: (typeof rows)[number]) => (r.last ? (r.last.ok ? "ok" : "failed") : ""),
        color: (r: (typeof rows)[number]) => (r.last?.ok ? color.ok : color.error),
      },
      {
        header: "summary",
        value: (r: (typeof rows)[number]) => r.last?.summary ?? r.description,
        shrink: 4,
      },
    ],
    rows,
  };
  if (output.mode === "plain") return showTable(table, output);

  const agentLine = !status.installed
    ? ["not installed", color.warn]
    : !status.loaded
      ? [`installed but not loaded (every ${status.interval}s)`, color.warn]
      : [`running every ${status.interval}s, last exit ${status.lastExit ?? "?"}`, color.ok];
  printStatic(
    <Box flexDirection="column">
      <Fields
        rows={[
          [
            "agent",
            <Text key="agent" color={agentLine[1]}>
              {agentLine[0]}
            </Text>,
          ],
          ["log", agent.LOG],
          ...(status.legacyLoaded
            ? ([
                [
                  "legacy",
                  <Text key="legacy" color={color.error}>
                    {agent.LEGACY_LABEL} still loaded
                  </Text>,
                ],
              ] as [string, React.ReactNode][])
            : []),
        ]}
      />
    </Box>,
  );
  await showTable(table, output);
});

program
  .command("init <shell>")
  .description(`print shell setup: eval "$(tdx init zsh)" (${SHELLS.join(", ")})`)
  .action((shell: string) => {
    if (!(SHELLS as readonly string[]).includes(shell)) {
      fail(outputOf(), `unsupported shell ${shell}`, `use one of ${SHELLS.join(", ")}`);
    }
    process.stdout.write(initScript([...FEATURES.map((f) => f.name), "status"]));
  });

await program.parseAsync();
