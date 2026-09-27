// Help text in the chosen language, down to the lines commander writes itself.
//
// Pastel builds the commander program internally and hands out no hook, so
// the translation goes onto commander's Help class -- the copy Pastel
// resolves, which may be nested under pastel/node_modules rather than the
// one at the top. Only titles, commander's own option lines and the
// choices/default notes are touched; our descriptions arrive translated.

import { createRequire } from "node:module";
import { t } from "./index.ts";

interface HelpProto {
  styleTitle(str: string): string;
  optionDescription(option: unknown): string;
  argumentDescription(argument: unknown): string;
  subcommandDescription(command: unknown): string;
}

const { Help } = createRequire(import.meta.resolve("pastel"))("commander") as {
  Help: { prototype: HelpProto };
};
const proto = Help.prototype;

// "(choices: …, default: …)" is appended by commander after our text.
const notes = (text: string) =>
  text
    .replace(/\((choices|default): /g, (_, word: string) =>
      word === "choices" ? `(${t.help.choices}: ` : `(${t.help.default}: `,
    )
    .replace(/, default: /g, `, ${t.help.default}: `);

const builtin = (text: string) => t.help.builtin[text] ?? text;

const styleTitle = proto.styleTitle;
proto.styleTitle = function (str) {
  return styleTitle.call(this, t.help.titles[str] ?? str);
};
const optionDescription = proto.optionDescription;
proto.optionDescription = function (option) {
  return notes(builtin(optionDescription.call(this, option)));
};
const argumentDescription = proto.argumentDescription;
proto.argumentDescription = function (argument) {
  return notes(argumentDescription.call(this, argument));
};
const subcommandDescription = proto.subcommandDescription;
proto.subcommandDescription = function (command) {
  return builtin(subcommandDescription.call(this, command));
};
