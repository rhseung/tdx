// Mouse wheel over SGR mouse reporting.
//
// Ink already hands the escape sequence to useInput as text ("[<64;10;5M"), so
// no second stdin reader is needed -- which matters under Bun, where two
// readers on one stdin have been known to starve each other. What is needed is
// for every other key handler to ignore these, or a text field would type them.

const ENABLE = "\x1b[?1000h\x1b[?1006h";
const DISABLE = "\x1b[?1000l\x1b[?1006l";
const EVENT = /\[<(\d+);\d+;\d+[Mm]/g;

const WHEEL_UP = 64;
const WHEEL_DOWN = 65;

export function isMouse(input: string): boolean {
  return input.startsWith("[<") && /[Mm]$/.test(input);
}

// Net wheel steps in one chunk: a fast flick arrives as several events at once.
export function wheelDelta(input: string): number {
  let delta = 0;
  for (const [, button] of input.matchAll(EVENT)) {
    if (Number(button) === WHEEL_UP) delta--;
    if (Number(button) === WHEEL_DOWN) delta++;
  }
  return delta;
}

export function enableMouse(stream: NodeJS.WriteStream = process.stdout): () => void {
  stream.write(ENABLE);
  const off = () => stream.write(DISABLE);
  // A crash must not leave the terminal reporting every click as text.
  process.once("exit", off);
  return () => {
    process.off("exit", off);
    off();
  };
}
