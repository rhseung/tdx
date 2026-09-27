// A full-screen view that gives the terminal back as it was, the way less
// does.
//
// Pastel renders every command through one Ink instance it creates itself,
// without Ink's `alternateScreen` option, and Ink offers no way to turn that
// on later. So the switch is written here, around the content:
//
//   entering  render nothing, then switch -- a first frame drawn before the
//             switch would be left behind in the scrollback
//   open      the content, full screen
//   leaving   render nothing, then switch back -- the last frame goes with
//             the alternate buffer instead of being redrawn over the shell
//   closed    whatever the content left to say, printed where it stays

import { useApp, useStdout } from "ink";
import { type ReactNode, useEffect, useState } from "react";

const ENTER = "\x1b[?1049h\x1b[2J\x1b[H";
const LEAVE = "\x1b[?1049l";

type Phase = "entering" | "open" | "leaving" | "closed";

export type Close = (after?: ReactNode) => void;

export function AlternateScreen({ children }: { children: (close: Close) => ReactNode }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [phase, setPhase] = useState<Phase>("entering");
  const [after, setAfter] = useState<ReactNode>(null);

  useEffect(() => {
    if (phase === "entering") {
      stdout.write(ENTER);
      // A crash must not strand the terminal in the alternate buffer.
      const restore = () => stdout.write(LEAVE);
      process.once("exit", restore);
      setPhase("open");
      return () => {
        process.off("exit", restore);
      };
    }
    if (phase === "leaving") {
      stdout.write(LEAVE);
      setPhase("closed");
    }
    if (phase === "closed") {
      // One frame for `after`, then out.
      const timer = setTimeout(() => exit(), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase, stdout, exit]);

  if (phase === "open") {
    return children((next) => {
      setAfter(next ?? null);
      setPhase("leaving");
    });
  }
  return phase === "closed" ? after : null;
}
