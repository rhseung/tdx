// Every test gets a throwaway state directory of its own.
//
// Without it, a test that reaches a real writer (applyOps, applyNudges) would
// overwrite the state files in the checkout -- including the one the GitHub
// sync depends on. And one directory shared by all tests would let a record
// left by one test make the next pass without checking anything.

// Tests assert on English text, and the language is fixed when i18n is first
// imported -- so it is set here, before any test file loads a module.
process.env["TDX_LANG"] = "en";

import { beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fresh = () => {
  process.env["TDX_STATE_DIR"] = mkdtempSync(join(tmpdir(), "tdx-test-state-"));
};

fresh();
beforeEach(fresh);
