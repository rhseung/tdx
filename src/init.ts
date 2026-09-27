// `eval "$(tdx init zsh)"`: make tdx's commands answer as `td <command>`.
//
// td has no plugin mechanism, so the extension is a shell function in front
// of it: our subcommands go to tdx, everything else to the real td untouched.

export const SHELLS = ["zsh", "bash"] as const;

// Shell parameter expansion, meant to reach the script exactly as written.
// biome-ignore lint/suspicious/noTemplateCurlyInString: it is shell, not a template
const PICKER_DEFAULT = "${TDX_PICKER:-fzf}";

export interface Subcommand {
  name: string;
  description: string;
}

// Completion for \`td recur\` and friends. td completes through its own
// function (\`td completion install\` defines _td_completion); this sits in
// front of it the way the td() function does: our subcommands complete as
// tdx (\`tdx completion install\`), the rest as td. Either half is optional,
// so it works whether or not td's completion is installed.
function zshCompletion(subcommands: Subcommand[]): string {
  const items = subcommands
    .map((c) => `'${c.name}:${c.description.replaceAll("'", "'\\''").replaceAll(":", "\\:")}'`)
    .join(" ");
  return String.raw`
# Completion: tdx's subcommands through _tdx, the rest through td's own.
# Keep this eval after td's completion setup, or td's compdef wins.
_td_with_tdx() {
  local -a ours
  ours=(${items})
  if (( CURRENT == 2 )); then
    (( $+functions[_td_completion] )) && _td_completion "$@"
    _describe -t tdx-commands 'tdx' ours
  elif (( $+ours[(r)$words[2]:*] )); then
    words[1]=tdx
    (( $+functions[_tdx] )) && _tdx
  else
    (( $+functions[_td_completion] )) && _td_completion "$@"
  fi
}
(( $+functions[compdef] )) && compdef _td_with_tdx td
`;
}

export function initScript(shell: (typeof SHELLS)[number], subcommands: Subcommand[]): string {
  const cases = [...new Set(subcommands.map((c) => c.name))].join("|");
  return `${String.raw`# tdx: the td subcommands it adds
td() {
  case "$1" in
    ${cases}) tdx "$@" ;;
    *) command td "$@" ;;
  esac
}

# Pick a recurring template with fzf and open it in the form.
tdx-edit() {
  local id
  id=$(tdx recur --color always | fzf --ansi --delimiter '\t' --with-nth 2.. \
    --preview 'tdx recur show {1}' | cut -f1) || return
  [ -n "$id" ] && tdx recur edit "$id"
}

# With fzf around, commands given no id pick with it too.
command -v fzf >/dev/null && export TDX_PICKER="${PICKER_DEFAULT}"
`}${shell === "zsh" ? zshCompletion(subcommands) : ""}`;
}
