// `tdx recur` at a terminal: the template list, with the form, a preview and
// delete one key away. `new` and `edit` open the same app on the form and
// leave when it closes.

import { Spinner } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useCallback, useRef, useState } from "react";
import { today } from "../core/day.ts";
import type { Api } from "../core/http.ts";
import { AlternateScreen } from "../ui/alternate-screen.tsx";
import type { Outcome } from "../ui/run.tsx";
import { StickyTable } from "../ui/table.tsx";
import { color, symbol } from "../ui/theme.ts";
import { occurrenceColumns, templateColumns } from "./columns.ts";
import { blankDraft, type Draft, draftOf, saveDraft } from "./draft.ts";
import { loadChecked, occurrenceRows, type TemplateRow, templateRows } from "./feature.tsx";
import { Form } from "./form.tsx";
import { deleteTemplate, ensureTemplatesProject, TEMPLATES_PROJECT } from "./io.ts";

export type Data = Awaited<ReturnType<typeof loadChecked>>;

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
        heading={existing ? `Edit ${existing.template.content}` : "New recurring assignment"}
        initial={initialDraft}
        projects={projects}
        isNew={!existing}
        onCancel={back}
        onSave={(draft) =>
          busy(existing ? "Saving" : "Creating", async () => {
            const templatesProjectId = await ensureTemplatesProject(api, data.workspace);
            const saved = await saveDraft(api, draft, { templatesProjectId, existing });
            return `${symbol.ok} ${saved.created ? "created" : "saved"} ${draft.title}`;
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
        hint="q back"
      />
    );
  }

  if (screen.kind === "confirm") {
    return (
      <Confirm
        question={`Delete the template "${screen.row.name}"? Tasks it already made stay.`}
        onAnswer={(yes) =>
          yes
            ? busy("Deleting", async () => {
                await deleteTemplate(api, data.state, screen.row.id);
                return `${symbol.ok} deleted ${screen.row.name}`;
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
        title="Recurring assignments"
        columns={templateColumns}
        rows={rows}
        reserved={flash ? 1 : 0}
        empty="No templates yet. Press n to make one."
        hint="n new  e edit  d delete  enter preview"
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
      {question} <Text color={color.muted}>(y/n)</Text>
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
    throw new Error(`tdx recur ${command} needs a terminal`);
  }
}
