# Native simulation service

The Godot game starts a local Node.js process. This process runs the existing TypeScript simulation and reporting code without a browser or rendering library. The native window can lose focus while the independent simulation clock keeps running. Closing the window disconnects the socket, saves the yard, and exits the child process.

## Build and tests

From the repository root:

```sh
npm install
npm run native:build
npm run native:test
```

The build produces `native/runtime/service.cjs` and `native/runtime/sql-wasm.wasm`. The desktop app packages these with Node; a development launcher may instead use a locally installed Node.js runtime. SQLite reporting uses the bundled local WebAssembly file and makes no web requests.

For a headless standalone invocation, provide a new cryptographically random token and paths:

```sh
node --max-old-space-size=384 native/runtime/service.cjs \
  --port-file=/tmp/plant01-port.json \
  --token=replace-with-a-long-random-token \
  --data-dir=/absolute/path/to/local-save-directory
```

The service writes `{port,pid,protocol}` to the port file and listens only on `127.0.0.1`. The first NDJSON command must be `{"id":1,"action":"hello","token":"..."}`. Later commands use `{"id":2,"action":"pause","args":{"paused":true}}`. Replies carry the matching ID; snapshots have a separate `type:"snapshot"`. The complete command reference is [protocol.json](protocol.json).

## Clock and storage

An existing `yard.json` opens paused in the startup menu. `continue` starts it; `new_game` selects empty, starter-order, or example yards. Startup does not overwrite a save before a choice is made. At 1×, one real second advances one game second. The 20 Hz clock uses 0.05-second physical steps; 3× and 10× execute more steps rather than making movement/collision steps larger. A stalled or sleeping process catches up at most one real second, so computer sleep is not offline production.

Explicit saves, autosaves every 30 seconds, and authenticated disconnect/shutdown write `yard.json` atomically using a same-directory temporary file, file synchronization, and rename. `yard.backup.json` retains the previous successful primary save. Import validates the entire JSON before replacing anything. Browser exports can be imported directly using the existing simulation loader. JSON exports, diagnostics, and cost CSV files can be written to paths selected by the native file dialog.

## Transport and diagnostics limits

Snapshots are published at 5 Hz. An obstructed socket skips stale snapshots; the next available one contains current state. It does not accumulate a frame queue. Writes have an 8 MB upper bound, snapshot generation pauses above 1 MB pending, commands are capped at 64 pending, and an incoming packet is capped at 64 MB (the existing save loader accepts at most 50 MB). Oversized or unresponsive connections close and trigger a save. This version is intended for starter yards; very large snapshots may need a later incremental protocol.

The snapshot contains all live entities and bounded display tails of 1,000 events, 1,000 material movements, and 2,000 costs. Saves, SQL, and cost exports retain complete history. The passive rolling diagnostic recorder retains at most 12,000 entries / 4 MB of entry data and four full checkpoints. Diagnostic checkpoint size depends on yard size; it is not counted in the 4 MB entry limit. The native process is launched with a bounded heap.

Snapshots also contain authoritative work-order rows, inventory totals, catalogs, and engine-neutral render poses. The render serializer uses shared rail, delivery, construction, and shed geometry helpers. It provides machine tool targets and work clocks for Godot to interpolate. Rendering, camera control, interaction, and native UI remain in the Godot client. The service does not implement new shunting/tank/chemistry features beyond the existing simulation.

## Verification

The integration tests start real headless child services with temporary save directories and exercise authentication, startup choices, an unfocused clock, pause/speed, file persistence, disconnect exit, atomic import/backup/export, batched procurement, rail snapping/planning, worker/equipment assignments, SQLite queries, diagnostics, deliberately unread socket backpressure, and 10× movement parity with direct fixed-step simulation. No Chrome or GPU is needed.

## Mechanics-derived visual fixtures

`npm run native:fixtures` runs procurement and construction scenarios with actual 0.1-second simulation ticks, then writes paused native-importable saves under `native/tests/fixtures`. The generated `index.json` gives camera focus coordinates, observed work phases, and descriptions. Fixtures cover lowloader ramp descent, road and rail unloading, a delivered stockyard, panel staging, buffer lifting, partial shed erection, and a worker carrying a service fuel can. The scenarios never assign invented handling phases or directly fill/empty fuel tanks. `native/tests/verification-simulation.json` records their loader validation and the tick count. These saves support renderer QA; they are not separate game rules or demonstration animations.
