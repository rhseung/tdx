// `eval "$(tdx init zsh)"`: make tdx's commands answer as `td <command>`.
//
// td has no plugin mechanism, so the extension is a shell function in front
// of it: our subcommands go to tdx, everything else to the real td untouched.

export const SHELLS = ["zsh", "bash"] as const;

export function initScript(subcommands: string[]): string {
  const cases = [...new Set(subcommands)].join("|");
  return String.raw`# tdx: the td subcommands it adds
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
command -v fzf >/dev/null && export TDX_PICKER="${"${TDX_PICKER:-fzf}"}"
`;
}
