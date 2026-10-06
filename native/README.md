# Plant 01 — native game

The existing factory simulation now runs in a local Node.js service, with Godot rendering the approved Concept C yard and providing native controls. The service owns simulation time and file persistence, so gameplay can continue while the window is unfocused. No web page, Chrome process, web server, or Internet connection is needed to play.

This is the first playable native migration. The original browser application and static visual proof remain available for comparison. Existing portable JSON saves can be imported; importing preserves the current yard as a backup.

## Download or open on this Mac

[Download the Apple Silicon Mac app](https://github.com/lukacslacko/factory_game/releases/tag/v0.19.10), unzip it, and open **Plant 01.app**. This checkpoint targets macOS 14 or newer.

Open the **Plant 01.app** built beside the repository in `outputs/`. It includes the Godot runner, Node runtime, simulation, terrain maps, and license notices. It is a local app for this Mac, not a notarized public release.

For development, double-click **Open Plant 01.command** in the repository root. It uses Godot in `/Applications` and the installed Node runtime, building the simulation bundle when needed. Or run `npm run native:build` and open `native/project.godot` in Godot.

Choose **Continue**, **Starter yard**, **Empty yard**, or **Example** on the opening screen. An existing save is never silently replaced by a new empty yard. Start with the example to explore established infrastructure; choose the starter yard to receive the initial physical deliveries and build from scratch.

## Saving and browser migration

Use the game menu to save, import, export a portable JSON save, restore the previous backup, or export the rolling diagnostic recording. Command-S saves immediately. Use **Open save folder** in the game menu to show its location in Finder; the controls guide also lists the path. On macOS it is normally:

`~/Library/Application Support/Godot/app_userdata/Plant 01/saves/`

Export your current yard from the browser game's menu, then import that JSON file from the native game. This preserves entity IDs, material balances, assignments, orders, work phases, costs, and the simulation clock. Browser local storage cannot be read by the app automatically.

Saves use a temporary file and atomic rename, retaining the previous valid save as a backup. Autosaves run periodically and the window close action saves before stopping the service. Invalid imports are rejected before replacing live state. Closed time and time while the laptop sleeps are not replayed; an open, unfocused game continues normally at the selected speed.

## Controls

| Input | Action |
| --- | --- |
| Click | Select an entity or place the selected construction tool |
| Drag empty ground | Smooth anchored pan of the view |
| Drag with paving/stockyard tool | Plan a rectangular area |
| W/A/S/D | Move relative to the current view |
| Right-drag / Q/E | Orbit / rotate |
| Mouse wheel / two-finger touchpad scroll / pinch | Smooth zoom |
| R | Rotate the planned object |
| Tab with a rail tool | Switch the curve/turnout hand |
| Space / 1 / 2 / 3 | Pause / 1× / 3× / 10× |
| G / Home / F | Toggle grid / yard view / follow selected entity |
| B | Purchasing |
| Command-S | Save |
| Escape | Cancel placement and selection |
| F12 | Capture the native viewport |

Construction ghosts use cyan for queued plans and amber for work underway; cursor previews use green for valid placement and red for invalid placement. Rails show the actual planned paths and sleepers, while buildings show their footprint and a wireframe. Ghosts stay bright in daylight and dusk, follow the ground or installed paving, and are naturally occluded by workers, equipment, stock, and vegetation. Solid outlines use normal depth and spatial antialiasing; completed or canceled work removes its ghost.

Use the dense registers for sorting and filtering, and click entity IDs to inspect linked equipment, workers, stock, jobs, and orders. Manual assignment and support-worker controls use the same simulation rules as the browser game. The simulation runs independently of drawing; foreground rendering is capped at 60 FPS and unfocused rendering at 15 FPS. Large Retina windows use spatial FSR1 upscaling with 4× MSAA while text and controls remain at full resolution. Full-resolution rendering also uses 4× MSAA. Temporal antialiasing is disabled so moving shadows do not trail across stationary ground. The game menu has **Full-resolution 3D (slower on Retina)** if you prefer maximum native detail; this preference is saved.

Automatic equipment traffic recovery checks the full chassis, boom, forks and carried load. If stored material traps a pedestrian beside a machine, the machine backs straight into verified clear space, lets the worker walk out, then resumes its retained destination. Rail handling preserves the escape sequence. A blockage lasting 20 seconds adds one **Equipment movement blocked** notice to Inbox and a warning in Activity; click the linked blocker to inspect it. The notice resolves when the machine moves again. Physically enclosed routes still require clearing access; recovery never teleports workers, stock or cargo.

Road vehicles issue a targeted clearance request to the blocking worker. Automatic ground workers can walk around stock rows and safely reroute a walking trip that is mutually blocked by that same vehicle. Their original destination is retained; once the carrier parks, they become available again instead of waiting for the whole delivery to finish. Manual/resting workers and unsafe physical operations are preserved. A persistent carrier obstruction produces one **Delivery vehicle blocked** notice after 20 seconds, with a linked blocker and recovery guidance. Sound, including request-triggered horns, remains tracked in GitHub issue #20.

## Actual native screenshots

![Live native equipment and controls](screenshots/02-native-equipment.png)

[Daylight yard](screenshots/01-native-yard.png) · [Rail unloading](screenshots/fixture-rail-unloading.png) · [Shed erection](screenshots/fixture-shed-partial-erection.png) · [Work register](screenshots/03-native-work.png) · [Dusk](screenshots/04-native-dusk.png)

[Grid on](screenshots/camera-grid-on.png) · [Grid off](screenshots/camera-grid-off.png) · [Overview with distant shadows](screenshots/camera-overview-shadows.png)

[Construction ghosts in daylight](screenshots/ghost-plans-day.png) · [Construction ghosts at dusk](screenshots/ghost-plans-dusk.png) · [Valid rail preview](screenshots/ghost-preview-valid.png) · [Invalid rail preview](screenshots/ghost-preview-invalid.png)

All images are unedited Godot captures of the playable simulation.

## Development and testing

```sh
npm ci
npm run native:build
npm run native:test
/Applications/Godot.app/Contents/MacOS/Godot --headless --editor --path native --import
python3 native/tests/run_native_check.py --timeout 45 --name native-integration -- --headless -- --native-self-test --data-dir=/tmp/plant01-native-test
python3 native/tests/run_native_check.py --timeout 55 --name native-capture -- --resolution 1920x1080 -- --native-capture --data-dir=/tmp/plant01-native-capture
python3 native/tests/run_native_check.py --name native-ui -- --headless --script res://tests/ui_smoke.gd
python3 native/tests/run_native_check.py --name native-ghosts -- --headless --script res://tests/ghost_smoke.gd
python3 native/tests/run_native_check.py --timeout 40 --name ghost-raster -- --resolution 1280x720 --script res://tests/ghost_render_check.gd
python3 native/tests/analyze_ghost_raster.py # optional GPU image analysis: Pillow + NumPy
python3 native/tests/run_native_check.py --name native-camera -- --headless --script res://tests/camera_smoke.gd
python3 native/tests/run_native_check.py --name native-models -- --headless --script res://tests/renderer_smoke.gd
python3 scripts/package-native-macos.py
```

Automated native tests use isolated data directories. The watchdog launches one Godot process, stops it on script errors, and limits time and resident memory. Existing simulation regressions remain in `tests/`; `native-runtime/` covers the transport, reporting, and persistence boundary. See the migration notes for feature coverage and measured results.

The native project includes the same CC0 terrain maps as the visual proof. [Terrain credits](assets/CREDITS.md), Godot, Node, SQLite/sql.js, and build-helper notices, and the repository MIT license accompany the app. Packaging currently targets the architecture of the Mac performing the build.


## Rail staging clearance and manual driving

Future rail staging space is planned against permanent geometry, without treating a nearby empty parked machine as a permanent wall. The staging crew can collect its real load and travel toward the site while requesting clearance. An idle empty machine with a seated automatic operator and fuel drives to a checked refuge through normal movement. Manual/rest control, unattended machines, active loads and physical operations are protected. A supported rail panel cannot be lowered while the staging footprint, handling area or withdrawal is occupied. Persistent site obstruction produces one linked warning after 20 seconds, with the staging position and blocker IDs in the work inspector.

The equipment inspector and Equipment register show a separate **Control** status: **Manual driving**, **Automatic**, **Resting**, or **No operator**. Allowed automatic job kinds do not imply that manual control has been released. Click **Return to automatic work** near the top of the equipment inspector, or **Return to automatic** in the driving bar. It restores the same operator to automatic duty, stops an idle manual driving route, retains cab ownership, and allows queued assignments to resume. A paused delivery resumes through its existing safe handling checks; active supported loads and work are retained. Off-shift workers retain their shift restrictions.

Rail installation and buffer approaches request clearance from idle automatic machines occupying their handling space, just as preparation-area work does. Manual or unattended blockers remain in place and generate a linked warning after 20 seconds. Work details show **Handling blockers**. Safe approach can continue while an automatic blocker drives clear; alignment and lowering wait for an empty footprint.

Excavator cab swivels use the shortest relative turn, including after many chassis revolutions and when a new movement snapshot arrives mid-turn. Rail and building rigging animations retain the same physical pickup points and supported loads.
