#!/bin/bash
# PolyZone: Tactics — macOS launcher. Double-click this file in Finder.
# Installs dependencies on first run, starts the game server, and opens the game in your browser.

cd "$(dirname "$0")" || exit 1

# Finder starts with a minimal PATH, so add the usual Node install locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"

echo ""
echo "  ▲ PolyZone: Tactics"
echo "  ────────────────────"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed."
  echo "  Install the LTS version from https://nodejs.org, then double-click this file again."
  open "https://nodejs.org/en/download" 2>/dev/null
  echo ""
  read -r -p "  Press Enter to close…" _
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo ""
  echo "  Node.js $(node -v) is too old. Version 22 or newer is required."
  echo "  Install the LTS version from https://nodejs.org, then try again."
  open "https://nodejs.org/en/download" 2>/dev/null
  read -r -p "  Press Enter to close…" _
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "  Installing dependencies (first run only, needs internet)…"
  if ! npm install --no-audit --no-fund; then
    echo ""
    echo "  npm install failed. Check your internet connection and try again."
    read -r -p "  Press Enter to close…" _
    exit 1
  fi
  touch node_modules
fi

# Use port 3000, or the next free one if something else is already using it.
PORT=3000
while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
export PORT

# Open the browser once the server answers.
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://localhost:$PORT/healthz"; then
      open "http://localhost:$PORT/"
      exit 0
    fi
    sleep 0.5
  done
) &

echo "  Starting the game at http://localhost:$PORT/"
echo "  Close this window or press Ctrl+C to stop the game."
echo ""
exec node server.js
