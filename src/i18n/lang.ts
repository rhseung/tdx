// Which language to speak, decided once from the environment.
//
// TDX_LANG wins, so a person can switch without touching their locale; then
// the POSIX order, where LC_ALL overrides LC_MESSAGES overrides LANG. The
// launchd agent has none of these set and so writes its log in English.

export type Lang = "en" | "ko";

export function detectLang(env: Record<string, string | undefined> = process.env): Lang {
  for (const name of ["TDX_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = env[name];
    // An empty or C/POSIX value means "not set here", so the next one decides.
    if (!value || value === "C" || value === "POSIX") continue;
    return value.toLowerCase().startsWith("ko") ? "ko" : "en";
  }
  return "en";
}

export const lang: Lang = detectLang();
