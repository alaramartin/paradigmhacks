#!/bin/bash
# STRETCH (branch only): switch alara's demo Mac between main's and this branch's hub + TabShell. Usage: swap-tree.sh main|branch
set -e
case "$1" in main) R=/Users/alara/Projects/paradigmhacks;; branch) R=/Users/alara/Projects/paradigmhacks-calendar;; *) echo "main|branch"; exit 1;; esac
lsof -nP -iTCP:7800 -sTCP:LISTEN -t | xargs -r kill || true
pkill -f "TabShell.app/Contents/MacOS/TabShell" || true
sleep 1
(cd "$R/brain" && nohup npm start > "${TMPDIR}tab-hub.log" 2>&1 < /dev/null &)
sleep 4
(cd "$R" && shell/scripts/build-shell.sh --run >/dev/null 2>&1)
sleep 4
echo "hub cwd: $(lsof -a -p $(lsof -nP -iTCP:7800 -sTCP:LISTEN -t) -d cwd -Fn | tail -1)"
