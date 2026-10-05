#!/bin/zsh
set -eu
PROOF_DIR="${0:A:h}"
GODOT_BIN="/Applications/Godot.app/Contents/MacOS/Godot"
if [[ ! -x "$GODOT_BIN" ]]; then
  print "Please install the standard Godot 4.7.2 macOS application in Applications."
  exit 1
fi
print "Preparing Plant 01's native visual study…"
"$GODOT_BIN" --headless --editor --path "$PROOF_DIR" --import --log-file "$PROOF_DIR/captures/launch-import.log"
print "Drag the ground to pan; scroll to zoom; Q/E rotate; H hides the interface."
exec "$GODOT_BIN" --path "$PROOF_DIR" --rendering-driver vulkan --audio-driver Dummy --log-file "$PROOF_DIR/captures/interactive.log"
