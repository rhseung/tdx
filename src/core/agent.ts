// The launchd agent that runs every feature on a timer.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const LABEL = "local.tdx";
export const LEGACY_LABEL = "local.gh-todoist-sync";
const AGENTS = join(homedir(), "Library/LaunchAgents");
export const PLIST = join(AGENTS, `${LABEL}.plist`);
export const LOG = join(homedir(), "Library/Logs/tdx.log");
export const DEFAULT_INTERVAL = 120;

// launchd hands the job a minimal PATH, so `gh` and `td` -- which the token
// lookup shells out to -- have to be findable.
const PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

const domain = () => `gui/${process.getuid?.() ?? 501}`;

// Bun by absolute path, not through a shebang: under launchd there is no
// shell to have activated mise, so `bun` on PATH is not a given.
function programArguments(): string[] {
  return [process.execPath, resolve(import.meta.dir, "../cli.tsx"), "run"];
}

const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function plist(interval: number = DEFAULT_INTERVAL): string {
  const args = programArguments()
    .map((a) => `<string>${xml(a)}</string>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${args}</array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${PATH}</string></dict>
  <key>StartInterval</key><integer>${interval}</integer>
  <!-- Without this the first run is one whole interval after login, which
       wastes the moment the machine is most likely to be out of date. -->
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
  <!-- The run is almost entirely network wait, so it should never compete
       with real work for the foreground scheduler. -->
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
</dict>
</plist>
`;
}

function launchctl(...args: string[]) {
  const out = Bun.spawnSync(["launchctl", ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

export function isLoaded(label: string = LABEL): boolean {
  return launchctl("print", `${domain()}/${label}`).code === 0;
}

// The Python agent ran the same sync under another name; leaving it loaded
// would have two processes writing one Todoist tree.
function removeLegacy(): boolean {
  const legacy = join(AGENTS, `${LEGACY_LABEL}.plist`);
  const found = isLoaded(LEGACY_LABEL) || existsSync(legacy);
  if (isLoaded(LEGACY_LABEL)) launchctl("bootout", `${domain()}/${LEGACY_LABEL}`);
  rmSync(legacy, { force: true });
  return found;
}

export function install(interval: number = DEFAULT_INTERVAL): { path: string; legacy: boolean } {
  const legacy = removeLegacy();
  mkdirSync(AGENTS, { recursive: true });
  writeFileSync(PLIST, plist(interval));
  if (isLoaded()) launchctl("bootout", `${domain()}/${LABEL}`);
  const result = launchctl("bootstrap", domain(), PLIST);
  if (result.code !== 0) throw new Error(`launchctl bootstrap failed: ${result.stderr.trim()}`);
  return { path: PLIST, legacy };
}

export function uninstall(): void {
  if (isLoaded()) launchctl("bootout", `${domain()}/${LABEL}`);
  rmSync(PLIST, { force: true });
}

export interface AgentStatus {
  installed: boolean;
  loaded: boolean;
  interval: number | null;
  lastExit: string | null;
  legacyLoaded: boolean;
}

export function describe(): AgentStatus {
  const installed = existsSync(PLIST);
  const loaded = installed && isLoaded();
  let interval: number | null = null;
  if (installed) {
    const match = /<key>StartInterval<\/key><integer>(\d+)<\/integer>/.exec(
      readFileSync(PLIST, "utf8"),
    );
    interval = match ? Number(match[1]) : null;
  }
  let lastExit: string | null = null;
  if (loaded) {
    const line = launchctl("print", `${domain()}/${LABEL}`)
      .stdout.split("\n")
      .find((l) => l.toLowerCase().includes("last exit"));
    lastExit = line?.split("=").at(-1)?.trim() ?? null;
  }
  return { installed, loaded, interval, lastExit, legacyLoaded: isLoaded(LEGACY_LABEL) };
}
