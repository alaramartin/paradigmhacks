#!/bin/bash
# Put this Mac back the way it was before Tab: removes only what this project created.
#   shell/scripts/uninstall.sh            dry run: print what would be removed
#   shell/scripts/uninstall.sh --yes      do it
#   add --artifacts to also delete gitignored build output in the repo (shell/.build, shell/build, brain/node_modules, brain/logs, design/shots)
#
# Stops TabShell, the hub on :7800, the debug Chrome (only the one using /tmp/tab-chrome; your normal Chrome is untouched),
# and the agents' gstack browse server on :9407. It deletes the signing keychain and takes it off the keychain search list,
# resets TabShell's Accessibility entry and saved HUD position, and deletes ~/.tab and /tmp/tab-chrome.
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
pgrep -x TabShell >/dev/null && run pkill -x TabShell
for p in $(pgrep -f "tsx.* src/hub.ts"); do run kill "$p"; done # npm wrapper, tsx, and the node child
for p in $(pgrep -f "Chrome\.app/Contents/MacOS/Google Chrome --.*user-data-dir=/tmp/tab-chrome"); do run kill "$p"; done # browser process only
for p in $(lsof -tiTCP:9407 -sTCP:LISTEN 2>/dev/null); do
    ps -o command= -p "$p" | grep -q "browse/src/server.ts" && run kill "$p"
done

# Signing keychain and its search-list entry.
if security list-keychains -d user | grep -q "tab-shell-signing"; then
    # shellcheck disable=SC2046
    run security list-keychains -d user -s $(security list-keychains -d user | tr -d '"' | grep -v "tab-shell-signing")
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
[ -f /tmp/claude-501/browse-a-design.json ] && run rm -f /tmp/claude-501/browse-a-design.json

if [ "$ARTIFACTS" = 1 ]; then
    for d in shell/.build shell/build brain/node_modules brain/logs design/shots; do
        [ -e "$d" ] && run rm -rf "$d"
    done
fi

[ "$DO" = 1 ] && echo "done." || echo "dry run; pass --yes to do it."
