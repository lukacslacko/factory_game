#!/bin/zsh
set -eu
project_dir="${0:A:h}"
cd "$project_dir"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PLANT01_NODE="$(command -v node)"
if [[ ! -f native/runtime/service.cjs ]]; then
  if [[ ! -d node_modules ]]; then npm ci; fi
  npm run native:build
fi
if [[ ! -x /Applications/Godot.app/Contents/MacOS/Godot ]]; then
  print 'Install Godot in Applications before opening Plant 01.'
  exit 1
fi
exec /Applications/Godot.app/Contents/MacOS/Godot --path "$project_dir/native" --audio-driver Dummy
