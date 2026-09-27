// `tdx recur` at a terminal: the template list, with the form, a preview and
// delete one key away. `new` and `edit` open the same app on the form and
// leave when it closes.

import { Spinner } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useCallback, useRef, useState } from "react";
import { today } from "../core/day.ts";
import type { Api } from "../core/http.ts";
import { t } from "../i18n/index.ts";
import { AlternateScreen } from "../ui/alternate-screen.tsx";
import { opLine } from "../ui/parts.tsx";
import { Progress } from "../ui/progress.tsx";
import type { Outcome } from "../ui/run.tsx";
import { StickyTable } from "../ui/table.tsx";
import { color, symbol } from "../ui/theme.ts";
import { occurrenceColumns, templateColumns } from "./columns.ts";
import { blankDraft, type Draft, draftOf, saveDraft } from "./draft.ts";
import {
  loadChecked,
  occurrenceRows,
  runRecur,
  type TemplateRow,
  templateRows,
} from "./feature.tsx";
import { Form } from "./form.tsx";
import { deleteTemplate, ensureTemplatesProject, sectionNames, TEMPLATES_PROJECT } from "./io.ts";

export type Data = Awaited<ReturnType<typeof loadChecked>>;

// Steps are not drawn inside the app; only the result is.
const QUIET = { mode: "json", color: false, header: false, pager: false } as const;

export type Screen =
  | { kind: "list" }
  | { kind: "form"; id: string | null }
  | { kind: "preview"; id: string }
  | { kind: "confirm"; row: TemplateRow }
  | { kind: "busy"; label: string };

interface AppProps {
  initial: Data;
  start: Screen;
  // Opened straight on a form (`new`, `edit`): closing it ends the program.
  standalone?: boolean;
  // Called once, when the app is done, with what it did -- the app runs in
  // the alternate screen, so these are the lines that stay behind.
  onClose: (messages: string[]) => void;
}

function RecurApp({ initial, start, standalone = false, onClose }: AppProps) {
  const messages = useRef<string[]>([]);
  const close = useCallback(() => onClose(messages.current), [onClose]);
  const [data, setData] = useState<Data>(initial);
  const [screen, setScreen] = useState<Screen>(start);
  const [flash, setFlash] = useState<string>("");
  const api: Api = data.api;

  const back = useCallback(() => {
    if (standalone) close();
    else setScreen({ kind: "list" });
  }, [standalone, close]);

  const busy = async (label: string, work: () => Promise<string>) => {
    setScreen({ kind: "busy", label });
    try {
      const message = await work();
      setData(await loadChecked());
      setFlash(message);
      messages.current.push(message);
    } catch (error) {
      setFlash(`${symbol.fail} ${error instanceof Error ? error.message : String(error)}`);
    }
    if (standalone) close();
    else setScreen({ kind: "list" });
  };

  const projects = data.workspace.projects
    .filter((p) => p.name !== TEMPLATES_PROJECT && !p.isInbox)
    .map((p) => p.name);

  if (screen.kind === "busy") {
    return <Spinner label={screen.label} />;
  }

  if (screen.kind === "form") {
    const existing = data.checked.find((c) => c.template.id === screen.id);
    const initialDraft: Draft = existing ? draftOf(existing) : blankDraft();
    return (
      <Form
        heading={existing ? t.form.editHeading(existing.template.content) : t.form.newHeading}
        initial={initialDraft}
        projects={projects}
        sections={sectionNames(data.workspace)}
        labels={data.workspace.labels}
        isNew={!existing}
        onCancel={back}
        onSave={(draft) =>
          busy(existing ? t.recur.saving : t.recur.creating, async () => {
            const templatesProjectId = await ensureTemplatesProject(api, data.workspace);
            const saved = await saveDraft(api, draft, {
              templatesProjectId,
              existing,
              personalLabels: data.workspace.personalLabels,
            });
            const done = `${symbol.ok} ${saved.created ? t.recur.created(draft.title) : t.recur.saved(draft.title)}`;
            // Applied now rather than on the agent's next pass, so what the
            // edit did to the weeks already made -- and which it left, having
            // been changed by hand -- is seen while the change is fresh.
            try {
              const result = await runRecur(new Progress(QUIET), { ids: [saved.id], api });
              return [done, ...result.ops.map((op) => `  ${opLine(op)}`)].join("\n");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return `${done}\n${symbol.fail} ${message}`;
            }
          })
        }
      />
    );
  }

  if (screen.kind === "preview") {
    const checked = data.checked.filter((c) => c.template.id === screen.id);
    const rows = occurrenceRows(checked, data.state, today(), 52);
    return (
      <StickyTable
        title={checked[0]?.template.content ?? ""}
        columns={occurrenceColumns}
        rows={rows}
        onQuit={() => setScreen({ kind: "list" })}
        hint={t.table.back}
      />
    );
  }

  if (screen.kind === "confirm") {
    return (
      <Confirm
        question={t.recur.confirmDelete(screen.row.name)}
        onAnswer={(yes) =>
          yes
            ? busy(t.recur.deleting, async () => {
                await deleteTemplate(api, data.state, screen.row.id);
                return `${symbol.ok} ${t.recur.deleted(screen.row.name)}`;
              })
            : setScreen({ kind: "list" })
        }
      />
    );
  }

  const rows = templateRows(data.checked, data.state, today());
  return (
    <Box flexDirection="column">
      <StickyTable
        title={t.recur.title}
        columns={templateColumns}
        rows={rows}
        reserved={flash ? flash.split("\n").length : 0}
        empty={t.recur.emptyApp}
        hint={t.recur.listHint}
        onQuit={close}
        onSelect={(row) => setScreen({ kind: "preview", id: row.id })}
        onKey={(input, row) => {
          setFlash("");
          if (input === "n") setScreen({ kind: "form", id: null });
          if (input === "e" && row) setScreen({ kind: "form", id: row.id });
          if (input === "d" && row) setScreen({ kind: "confirm", row });
        }}
      />
      {flash ? (
        <Text color={flash.startsWith(symbol.fail) ? color.error : color.ok}>{flash}</Text>
      ) : null}
    </Box>
  );
}

function Confirm({ question, onAnswer }: { question: string; onAnswer: (yes: boolean) => void }) {
  useInput((input, key) => {
    if (input === "y") onAnswer(true);
    if (input === "n" || key.escape) onAnswer(false);
  });
  return (
    <Text>
      {question} <Text color={color.muted}>{t.recur.yesNo}</Text>
    </Text>
  );
}

// The app full screen, and afterwards, in the scrollback, what it did.
export function appOutcome(initial: Data, start: Screen, standalone: boolean): Outcome {
  return () => (
    <AlternateScreen>
      {(close) => (
        <RecurApp
          initial={initial}
          start={start}
          standalone={standalone}
          onClose={(messages) =>
            close(
              messages.length ? (
                <Box flexDirection="column">
                  {messages.map((m) => (
                    <Text key={m}>{m}</Text>
                  ))}
                </Box>
              ) : null,
            )
          }
        />
      )}
    </AlternateScreen>
  );
}

// Forms and pagers read keys; from a pipe there are none to read.
export function requireTerminal(command: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(t.needsTerminal(`recur ${command}`));
  }
}
