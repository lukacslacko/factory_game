#!/bin/zsh
cd -- "$(dirname -- "$0")"
if command -v node >/dev/null 2>&1; then
  exec node server.mjs
elif [[ -x /opt/homebrew/bin/node ]]; then
  exec /opt/homebrew/bin/node server.mjs
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  exec "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" server.mjs
else
  print 'Plant 01 needs Node.js 22 or newer to run the included local server.'
  print 'Install Node.js, then open this launcher again.'
  read '?Press Enter to close.'
fi
