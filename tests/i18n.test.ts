// Which language tdx speaks, and that Korean reaches every layer: our own
// text, commander's help, and zod's validation messages.

import { expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ko } from "../src/i18n/ko.ts";
import { detectLang } from "../src/i18n/lang.ts";

test("TDX_LANG wins, then LC_ALL, LC_MESSAGES and LANG", () => {
  expect(detectLang({ TDX_LANG: "ko", LANG: "en_US.UTF-8" })).toBe("ko");
  expect(detectLang({ LC_ALL: "ko_KR.UTF-8", LANG: "en_US.UTF-8" })).toBe("ko");
  expect(detectLang({ LC_MESSAGES: "en_US.UTF-8", LANG: "ko_KR.UTF-8" })).toBe("en");
  expect(detectLang({ LANG: "ko_KR.UTF-8" })).toBe("ko");
});

test("an unset, empty or C locale falls through to the next, then to English", () => {
  expect(detectLang({})).toBe("en");
  expect(detectLang({ LC_ALL: "", LANG: "ko_KR.UTF-8" })).toBe("ko");
  expect(detectLang({ LC_ALL: "C", LANG: "ko_KR.UTF-8" })).toBe("ko");
  expect(detectLang({ LANG: "fr_FR.UTF-8" })).toBe("en");
});

test("Korean counts put the word first, English the number", () => {
  expect(en.count(3, en.changes["create"] ?? "")).toBe("3 created");
  expect(ko.count(3, ko.changes["create"] ?? "")).toBe("생성 3");
});

test("every lookup table has the same keys in both languages", () => {
  for (const pick of [
    (m: typeof en) => m.changes,
    (m: typeof en) => m.verbs,
    (m: typeof en) => m.help.titles,
    (m: typeof en) => m.help.builtin,
    (m: typeof en) => m.help.features,
    (m: typeof en) => m.recur.status,
  ]) {
    expect(Object.keys(pick(ko)).sort()).toEqual(Object.keys(pick(en)).sort());
  }
  expect(ko.recur.weekdays).toHaveLength(7);
});

const tdx = (env: Record<string, string>, ...args: string[]) => {
  const run = Bun.spawnSync(["bun", "src/cli.tsx", ...args], {
    env: { ...process.env, ...env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return run.stdout.toString() + run.stderr.toString();
};

test("help is Korean end to end, commander's own lines included", () => {
  const help = tdx({ TDX_LANG: "ko" }, "gh", "sync", "--help");
  expect(help).toContain("사용법:");
  expect(help).toContain("옵션:");
  expect(help).toContain("Todoist를 GitHub에 맞추기");
  expect(help).toContain("도움말 보기");
  expect(help).toContain("기본값:");
});

test("option errors come through zod in Korean", () => {
  const out = tdx({ TDX_LANG: "ko" }, "install", "--interval", "-5");
  expect(out).not.toContain("Too small");
  expect(out).toMatch(/[가-힣]/);
});

test("English stays the default", () => {
  expect(tdx({ TDX_LANG: "en" }, "gh", "sync", "--help")).toContain("Usage:");
});

// Walks a dictionary and renders every entry: a string as it is, a function
// with small numbers for its arguments (every message takes counts, days,
// names or flags, and 2 stands in for any of them).
function render(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === "string") out.push([path, value]);
  else if (typeof value === "function") {
    out.push([
      path,
      String((value as (...a: number[]) => unknown)(...Array(value.length).fill(2))),
    ]);
  } else if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) render(v, `${path}[${i}]`, out);
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) render(v, `${path}.${key}`, out);
  }
  return out;
}

test("every message renders in both languages, and only form.labels.save is blank", () => {
  for (const [name, dictionary] of [
    ["en", en],
    ["ko", ko],
  ] as const) {
    const blank = render(dictionary, name, [])
      .filter(([, text]) => !text.trim() || text.includes("undefined"))
      .map(([path]) => path);
    expect(blank).toEqual([`${name}.form.labels.save`]);
  }
});

test("both dictionaries render the same set of messages", () => {
  const paths = (d: unknown, root: string) =>
    render(d, root, []).map(([p]) => p.slice(root.length));
  expect(paths(ko, "ko").sort()).toEqual(paths(en, "en").sort());
});
