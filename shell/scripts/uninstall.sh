#!/bin/bash
# Put this Mac back the way it was before Tab: removes only what this project created.
#   shell/scripts/uninstall.sh            dry run: print what would be removed
#   shell/scripts/uninstall.sh --yes      do it
#   add --artifacts to also delete gitignored build output in the repo (shell/.build, shell/build, brain/node_modules, brain/logs, design/shots)
#
# Stops TabShell, the hub on :7800, C's web daemon and demo sites (only this repo's, by working directory), the debug
# Chrome (only the one using /tmp/tab-chrome; your normal Chrome is untouched), and agent A's gstack browse server (only
# the pid recorded in A's own state file). It deletes the signing keychain and takes it off the keychain search list,
# resets TabShell's Accessibility entry and saved HUD position, and deletes ~/.tab (logs, saved workflows),
# /tmp/tab-chrome, look.mjs's temp folders and try.ts's hub log. web/data (the payment ledger) stays.
# It does NOT touch the Screen Recording / Accessibility grants you gave your terminal app. Revoke those in
# System Settings → Privacy & Security if you want them gone.
set -uo pipefail
cd "$(dirname "$0")/../.."

DO=0
ARTIFACTS=0
for a in "$@"; do
    case "$a" in
        --yes) DO=1 ;;
        --artifacts) ARTIFACTS=1 ;;
        *) echo "unknown flag $a" >&2; exit 2 ;;
    esac
done

run() {
    if [ "$DO" = 1 ]; then echo "+ $*"; "$@"; else echo "would: $*"; fi
}

KC="$HOME/Library/Keychains/tab-shell-signing.keychain-db"

# Processes (matched narrowly so nothing else is hit).
REPO="$(pwd)"
pgrep -x TabShell >/dev/null && run pkill -x TabShell
# Node processes running one of this repo's entry points (cwd check), so another project's hub.ts or main.ts is safe.
stop_in() { # <dir under the repo> <pgrep -f pattern>
    for p in $(pgrep -f "$2"); do
        [ "$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$REPO/$1" ] && run kill "$p"
    done
}
stop_in brain "tsx.* src/hub.ts"    # the hub (npm start, or try.ts flow3-recall's detached restart)
stop_in web "tsx.* src/main.ts"     # C's web daemon (npm start)
stop_in web "tsx.* demo/server.ts"  # the five demo sites (npm run demo)
for p in $(pgrep -f "Chrome\.app/Contents/MacOS/Google Chrome --.*user-data-dir=/tmp/tab-chrome"); do run kill "$p"; done # browser process only
# Agent A's gstack browse server: the pid in A's own state file, and only if it's still that server.
BROWSE_STATE="/tmp/claude-$(id -u)/browse-a-design.json"
if [ -f "$BROWSE_STATE" ]; then
    bp="$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$BROWSE_STATE")"
    [ -n "$bp" ] && ps -o command= -p "$bp" 2>/dev/null | grep -q "browse/src/server.ts" && run kill "$bp"
fi

# Signing keychain and its search-list entry.
if security list-keychains -d user | grep -q "tab-shell-signing"; then
    # Rebuild the list without ours, one array element per keychain, so paths with spaces stay whole.
    keep=()
    while IFS= read -r k; do
        k="$(echo "$k" | sed 's/^[[:space:]]*"//; s/"[[:space:]]*$//')"
        [ -n "$k" ] && [[ "$k" != *tab-shell-signing* ]] && keep+=("$k")
    done < <(security list-keychains -d user)
    run security list-keychains -d user -s "${keep[@]}"
fi
[ -f "$KC" ] && run security delete-keychain "$KC"

# TabShell's privacy entries (harmless if there are none).
run tccutil reset Accessibility dev.tab.shell
run tccutil reset ListenEvent dev.tab.shell

# Saved HUD position/visibility (UserDefaults domain of the app).
defaults read dev.tab.shell >/dev/null 2>&1 && run defaults delete dev.tab.shell

# Files outside the repo.
[ -d "$HOME/.tab" ] && run rm -rf "$HOME/.tab"
[ -d /tmp/tab-chrome ] && run rm -rf /tmp/tab-chrome
[ -f "$BROWSE_STATE" ] && run rm -f "$BROWSE_STATE"
for d in "${TMPDIR:-/tmp}"/tab-look-*; do [ -d "$d" ] && run rm -rf "$d"; done
[ -f "${TMPDIR:-/tmp}/tab-hub-try.log" ] && run rm -f "${TMPDIR:-/tmp}/tab-hub-try.log"

if [ "$ARTIFACTS" = 1 ]; then
    for d in shell/.build shell/build brain/node_modules brain/logs design/shots; do
        [ -e "$d" ] && run rm -rf "$d"
    done
fi

[ "$DO" = 1 ] && echo "done." || echo "dry run; pass --yes to do it."
