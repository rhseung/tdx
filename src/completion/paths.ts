import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const COMMANDS = fileURLToPath(new URL("../commands", import.meta.url));

// Already on the fpath of a zsh set up the usual way, and ahead of compinit.
export const SITE_FUNCTIONS = join(homedir(), ".local/share/zsh/site-functions");
export const COMPLETION_FILE = join(SITE_FUNCTIONS, "_tdx");
