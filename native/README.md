# Plant 01 — native game

The existing factory simulation now runs in a local Node.js service, with Godot rendering the approved Concept C yard and providing native controls. The service owns simulation time and file persistence, so gameplay can continue while the window is unfocused. No web page, Chrome process, web server, or Internet connection is needed to play.

This is the first playable native migration. The original browser application and static visual proof remain available for comparison. Existing portable JSON saves can be imported; importing preserves the current yard as a backup.

## Download or open on this Mac

[Download the Apple Silicon Mac app](https://github.com/lukacslacko/factory_game/releases/tag/v0.20.8), unzip it, and open **Plant 01.app**. This checkpoint targets macOS 14 or newer.

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

Automatic excavators also check alternative reachable lifting positions when staged material blocks a rail-handling approach. The selected approach stays stable through travel, lowering, and saving, and the equipment inspector shows its actual destination. The crane routes around real stock without moving or deleting it. If no safe lifting position is reachable, one **Rail route blocked** warning names the blocker after 12 seconds; clear access or relocate the staged stock to storage. The warning resolves once routing succeeds. Existing requests for workers or idle equipment to clear a handling position still apply.

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

### Buffer stops and converging switches — v0.19.12

Buy **Buffer stop** in Purchase / hire and deliver it like other material. The Railway register lists each completed open endpoint and whether it has a secured stop. Select an uncapped endpoint and choose **Install buffer stop**; an owned machine and crew carry the purchased stop there and clamp it to the rails. Select a stop to plan physical recovery into a stockyard. Reserve a clear 2 × 2 m slot for a recovered stop.

Canceling an incomplete curve or turnout retains its installed panels. Once the assembly's remaining work is canceled and any handling finishes, its physically open ends become available for extension and buffer-stop installation. Straight/turnout placement still requires an exact grid-aligned endpoint and tangent; an unfinished curved segment does not create an artificial square-grid connection. Active construction joints remain protected until their assembly is completed or canceled.

For parallel unloading tracks or a future runaround, select **Turnout**, choose **Converging**, and start from one of two parallel open ends. Both ends must face the same direction and be 5 m apart. Flip the side when the other track is on the opposite side. The preview explains a missing or misaligned connection. The same seven purchased panels are installed from the incoming tails toward the common points assembly. An existing outgoing endpoint can also be joined where the geometry matches exactly.

A stop cannot remain across a completed rail joint. The crew preserves it as a real asset, moves it aside and carries surplus stops into storage. Switches still require a worker to throw their lever. Train drop-off, owned shunting and installing turnouts into an already continuous track remain separate tracked work. Paid scrapping is tracked in [issue #35](https://github.com/lukacslacko/factory_game/issues/35).


### Receive multi-car trains — v0.20.7

Open **Railway → + Receiving point** to name an interval on the original `BOOTSTRAP-SIDING`. Its offset is measured from the siding's western start; length is centered there. An unloading or transfer point can receive supplier freight. The full locomotive and all cars must fit between the mainline switch and the siding's end; protected buffer stops can further restrict access. Five flatcars fit a sufficiently long interval; larger consists remain queued with their required length and receive no arrival invoice. Other factory-track designations await commissioned shunting.

In **Purchase / hire**, choose rail transport, enter all material lines, and select the reception and stockyard. The preview shows car count, length and transport cost. Each 16-meter deck has a 48 metric-ton payload limit; a batch spanning several cars remains one purchase and one train arrival. Workers come by bus, and construction equipment by lowloader. Automatic reception selects a fitting stop on the original siding if no named point is chosen.

Once stopped, open the train in **Deliveries**, apply its unloading stockyard, and click **Start unloading**. Owned equipment, an operator, and any needed rigger handle cargo from each real car into that yard. A full or blocked selected yard produces a waiting reason; cargo is not redirected. Destination changes apply between lifts and affect subsequent material. Railway's Freight cars register opens individual manifests and links back to the train; the supplier engine also has an ID. Saves retain every car, remaining quantity, supported load and crew assignment.

**Railway → Rail help**, also available in the game menu, describes reception, unloading, switches, buffers and the next planned steps in paragraphs. The supplier locomotive remains coupled in this checkpoint and returns with the empty cars after unloading. The existing flat charter charge is unchanged; detached-car handoff, locomotive idle billing, owned shunters/drivers, car selection and splitting, return assembly and a separately requested pickup service are future checkpoints in #22, #23, #27, #3, #4 and #5. No invisible shunter or disconnected-car teleportation is introduced.

For focused native verification, run `node --max-old-space-size=384 --import tsx native-runtime/create-freight-visual-fixtures.ts`, then the watchdog with `--headless --script res://tests/freight_renderer_smoke.gd` or `res://tests/freight_ui_smoke.gd`. The dedicated GPU capture is `res://tests/freight_visual_capture.gd`, with isolated saved fixtures and no running production simulation host.

## Creative placement

Turn on **Creative** in the Yard toolbar to place completed concrete, buildings (including foundations), straight rails, curves, turnouts and buffer stops directly. Use the existing tools; no deliveries, workers or construction charges are required for these new placements. Existing work remains unchanged. The status bar displays CREATIVE and the setting saves with your yard. Turn it off to resume normal construction. Grid, occupied-space and rail-endpoint rules still apply.


## Recover installed rail — v0.20.4

Select an installed panel from Yard or Railway and click **Recover this rail panel**. A curve or switch inspector also offers **Recover whole curve / turnout**, which groups all its remaining installed sections into one assignable work order. Recovery uses an excavator, an operator and a construction worker. Workers undo the joint fasteners and attach slings before the excavator lifts the steel. It then carries the same component to an accessible stockyard, lowers it, releases the slings and withdraws. Actual panel types, handedness, IDs and movement history are retained; recovered panels can be used for subsequent construction. Attached buffer stops are physically recovered first. Make stockyard space and finish interfering work or let occupying delivery vehicles leave. A named point anchored to a selected panel must be removed first.

To replace straight rails with a switch, recover the four 5-meter panels occupying its 20-meter length, then build a turnout from the exposed endpoint. The through route can reconnect to surviving track beyond the gap; leave its branch footprint clear. The original receiving siding and public mainline remain protected infrastructure. Recovery pending on a turnout also prevents its lever from being operated.

Cancellation before the lift secures the original track; cancellation after lifting still stores the suspended panel safely. Saves preserve these phases. In Creative, the whole selected recovery is immediate and requires finite stockyard slots for the panels and attached stops. If there is insufficient storage, nothing in the selected assembly changes.

Physical rail loops are supported. Close them with exact, opposing endpoints and appropriate curves or turnouts. The network follows real connections around the loop; overlapping rails without a proper joint do not connect. Supplier freight still uses the original receiving siding, while owned shunting and broader train routing remain future operations checkpoints.

## Information panels — v0.20.5

Click **×** in the upper-right corner of an information panel to dismiss it and clear the yard selection. Click an asset or register ID to open it again. Live updates wait until a button press finishes, so they cannot replace a control halfway through your click.

## Automatic departure from cramped stockyards — v0.20.6

Receiving equipment checks its complete moving footprint and final pickup heading before departing. If it cannot turn beside stored material, it can back straight into clear space, then shift to forward and continue around the stockyard. The work destination survives this maneuver and saving. Automatic workers yield to the reversing machine. A missing or blocked route keeps unloading waiting; equipment must reach the freight car before engaging its load. Existing fixed stock is never shifted invisibly to make room.

Automatic empty equipment can also move clear during a rail pickup approach, keeping its original work assignment. It waits until the loaded vehicle has passed before returning. Empty vehicles parked on that return spot are asked to move; manually controlled operators keep player control. Parking leaves clearance for turns and loads. Slab placement rechecks its approach if new construction occupies an earlier planned dock, and chooses another reachable side of the same cell.


## Stacked rail freight and stock — v0.20.7

Straight panels, curved panels, and every turnout module (points, frog, closure and exit) can stack up to **eight pieces** in one physical storage footprint. With support spacers, a full stack is **2.85 meters high**. The selected stock inspector shows quantity/capacity, height and total mass. Receiving fills accessible partial stacks before allocating more ground space; full stacks require another real slot. Material types remain separate.

Use Purchase / hire to order multiple quantities together. Eight complete turnout sets require eight of each turnout module and 24 straight panels; the batch fits one three-car supplier train. Road deliveries split by the 12-ton payload limit: a truck carries at most six points modules or seven curved/frog/closure/exit panels, even though stockyards hold eight per stack. Freight cars retain their 48-ton payload and 16-meter deck limits. The excavator lifts at most 6 tons and the forklift 2.5 tons per trip, taking actual layers from the top and adding them onto storage.

Existing trains and trucks keep their original stack sizes and positions after the update, including an active unloading lift. New deliveries use the higher stack limit, and existing partial stockyard stacks can receive more pieces up to eight.


## Switch controls and recovered rail stacks — v0.20.8

Use the separate **Diverging switch** and **Converging switch** buttons in Yard. Selecting Straight rail or 90° curve always selects normal rail construction; a previous convergence selection cannot affect those tools. Rotate R and Left / right adjust the selected layout as before. The selected rail button is highlighted.

Recovered rails fill compatible partial stockyard stacks before allocating another footprint, in Creative and normal construction. Each rail material stacks eight high; differently handed curve and switch modules remain separate. Active handling and reserved preparation stock are excluded. When recovering normally, the excavator lowers the panel onto the actual top of the stack. Every recovered panel keeps its original identity through storage, transport, save/reload, and subsequent installation. Existing separate stacks stay in place; future recovery fills available compatible stacks.
