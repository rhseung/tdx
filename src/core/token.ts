// Prefer an explicit token, else borrow the one the CLI already keeps.
//
// Reading gh's and td's stored credentials is what keeps this zero-config: no
// PAT to mint, rotate, or leave lying around in a dotfile. fnox, when used,
// fills the env var, so it wins without this file knowing about it.
export function cliToken(envVar: string, argv: string[]): string {
  const value = process.env[envVar];
  if (value) return value;
  const out = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  const token = out.stdout.toString().trim();
  if (out.exitCode !== 0 || !token) {
    throw new Error(
      `set ${envVar}, or log in so \`${argv.join(" ")}\` works: ${out.stderr.toString().trim()}`,
    );
  }
  return token;
}
