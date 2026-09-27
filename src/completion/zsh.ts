// A zsh completion script, written from the same zod schemas Pastel turns
// into flags. A new option or command completes the moment it exists; the only
// upkeep is re-running `tdx completion install`.
//
// The script is static on purpose. Asking tdx on every TAB, as td does, costs
// a Bun start each time; only the template ids, which live in Todoist, are
// looked up when asked for.

import type { z } from "zod";
import type { CommandNode } from "./tree.ts";

interface Def {
  type: string;
  innerType?: z.ZodType;
  defaultValue?: unknown;
  shape?: Record<string, z.ZodType>;
  entries?: Record<string, string | number>;
  items?: z.ZodType[];
  element?: z.ZodType;
}

const def = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

// Pastel keeps a flag's help and alias as JSON inside the zod description.
interface Config {
  description?: string;
  alias?: string;
  name?: string;
  valueDescription?: string;
}

function config(schema: z.ZodType): Config {
  const text = schema.description ?? "";
  const match = /^__pastel_(?:option|argument)_config__(.*)$/.exec(text);
  if (!match) return { description: text };
  return JSON.parse(match[1] ?? "{}");
}

interface Unwrapped {
  schema: z.ZodType;
  optional: boolean;
  defaultValue: unknown;
  description: string;
  alias: string | undefined;
  name: string | undefined;
  valueDescription: string | undefined;
}

// Optional and default wrap the real type in either order, and the
// description may sit on the wrapper or on the type, as Pastel allows.
function unwrap(schema: z.ZodType): Unwrapped {
  let current = schema;
  let optional = false;
  let defaultValue: unknown;
  let meta = config(current);
  for (;;) {
    const d = def(current);
    if (d.type === "optional" && d.innerType) optional = true;
    else if (d.type === "default" && d.innerType) {
      optional = true;
      defaultValue = d.defaultValue;
    } else break;
    current = d.innerType;
    if (!meta.description) meta = config(current);
  }
  return {
    schema: current,
    optional,
    defaultValue,
    description: meta.description ?? "",
    alias: meta.alias,
    name: meta.name,
    valueDescription: meta.valueDescription,
  };
}

const values = (schema: z.ZodType): string[] | null => {
  const d = def(schema);
  return d.type === "enum" && d.entries ? Object.values(d.entries).map(String) : null;
};

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Everything is written inside '…', where only a quote needs escaping; then
// each zsh construct has its own separators on top of that.
const shell = (text: string) => text.replaceAll("'", "'\\''");
// _arguments reads `[help]`, so brackets inside the help end it early.
const help = (text: string) => shell(text).replaceAll("[", "\\[").replaceAll("]", "\\]");
// _describe reads `name:description`, so a colon in the name splits it.
const item = (text: string) => shell(text).replaceAll(":", "\\:");

// Arguments named id or ids are templates -- the only ids tdx takes.
const TEMPLATE_ARGS = new Set(["id", "ids"]);

function action(schema: z.ZodType, name: string | undefined): string {
  const choices = values(schema);
  if (choices) return `(${choices.join(" ")})`;
  if (name && TEMPLATE_ARGS.has(name)) return "_tdx_templates";
  return " ";
}

function optionSpecs(options: z.ZodType | undefined): string[] {
  const specs = ["'(- *)'{-h,--help}'[Show help]'"];
  if (!options) return specs;
  const shape = def(unwrap(options).schema).shape ?? {};
  for (const [key, field] of Object.entries(shape)) {
    const f = unwrap(field);
    const long = kebab(key);
    const isBoolean = def(f.schema).type === "boolean";
    // Pastel spells a boolean that defaults to true as its negation.
    const flag = isBoolean && f.defaultValue === true ? `--no-${long}` : `--${long}`;
    const explanation = `[${help(f.description)}]`;
    const value = isBoolean ? "" : `:${f.valueDescription ?? long}:${action(f.schema, undefined)}`;
    specs.push(
      f.alias && !(isBoolean && f.defaultValue === true)
        ? `'(-${f.alias} ${flag})'{-${f.alias},${flag}}'${explanation}${value}'`
        : `'${flag}${explanation}${value}'`,
    );
  }
  return specs;
}

function argumentSpecs(args: z.ZodType | undefined): string[] {
  if (!args) return [];
  const outer = unwrap(args);
  const d = def(outer.schema);
  if (d.type === "array" && d.element) {
    const name = outer.name ?? "arg";
    return [`'*:${name}:${action(unwrap(d.element).schema, name)}'`];
  }
  return (d.items ?? []).map((item, index) => {
    const a = unwrap(item);
    const name = a.name ?? `arg${index + 1}`;
    return `'${a.optional ? "::" : ":"}${name}:${action(a.schema, name)}'`;
  });
}

const fn = (path: string[]) => `_${path.join("_").replaceAll("-", "_")}`;

function functions(node: CommandNode, path: string[]): string[] {
  const name = fn(path);
  // Pastel adds --version at the top only.
  const version = path.length === 1 ? ["'(- *)'{-v,--version}'[Show version number]'"] : [];
  const own = [...optionSpecs(node.options), ...argumentSpecs(node.args)];
  if (!node.commands.length) {
    return [`${name}() {\n  _arguments -s \\\n    ${own.join(" \\\n    ")}\n}`];
  }
  const items = node.commands.map((c) => `        '${item(c.name)}:${shell(c.description)}'`);
  const cases = node.commands.map((c) => `      ${c.name}) ${fn([...path, c.name])} ;;`);
  const body = `${name}() {
  local curcontext="$curcontext" state line
  local -a commands
  _arguments -C -s \\
    ${[...version, ...optionSpecs(node.options), "'1: :->command'", "'*:: :->argument'"].join(" \\\n    ")}
  case $state in
    command)
      commands=(
${items.join("\n")}
      )
      _describe -t commands '${path.join(" ")} command' commands ;;
    argument)
      case $words[1] in
${cases.join("\n")}
      esac ;;
  esac
}`;
  return [body, ...node.commands.flatMap((c) => functions(c, [...path, c.name]))];
}

export function zshScript(root: CommandNode): string {
  return `#compdef tdx
# Generated by \`tdx completion zsh\`; re-run \`tdx completion install\` after
# adding a command or an option.

# Template ids from Todoist, shown with their names.
_tdx_templates() {
  local -a templates
  templates=(\${(f)"$(tdx recur --color never 2>/dev/null | awk -F'\\t' '{ gsub(/:/, "\\\\:", $1); print $1 ":" $2 }')"})
  _describe -t templates 'template' templates
}

${functions(root, ["tdx"]).join("\n\n")}

_tdx "$@"
`;
}
