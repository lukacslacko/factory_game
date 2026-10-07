# Native migration — October 6, 2026

The creator approved the revised Godot visual proof and requested migration of the existing game into it while they were away. They then clarified that no old game is saved, so backward compatibility is not a priority. The goal is a playable native game using the approved art, with reliable file saves and simulation that continues without a focused browser.

## Architecture

The tested TypeScript simulation remains authoritative. A bundled Node process advances it independently at fixed steps. Godot owns the native interface, camera, geometry, lighting, and interpolation. An authenticated loopback connection carries JSON instructions and derived render records; it never opens a web page or uses a browser engine. The service binds an ephemeral local port and accepts only the renderer's random session token.

Simulation rules and source IDs remain shared with the browser application. This keeps physical equipment delivery, material handling, buffer removal, work groups, support workers, traffic, costs, and scheduling consistent. Native rendering uses the revised proof's meshes and materials, populated from actual game entities rather than arranged example objects.

The service sends bounded display histories while retaining complete accounting and events in the saved state and SQL reporting snapshot. It drops stale pending snapshots when the renderer cannot consume them. The client interpolates position, yaw, lifting, and articulated work between snapshots. Save writes use a temporary file and atomic rename, with a previous-save backup. A disconnected renderer causes the owned service to save and exit; normal window closing requests a save before shutdown.

Simulation time advances at 1× real time, independently of display FPS or window focus. Faster speeds scale the same physical clock. The laptop's suspended time is not replayed as an enormous catch-up burst. Rendering is capped at 60 FPS in the foreground and 15 FPS when unfocused.

## Feature coverage

| Existing system | Native presentation / control |
| --- | --- |
| Starter, empty, and example yards | Explicit native opening choices |
| Batch workers, equipment, materials, and services | Purchase quantities, carrier mode, weights and packing preview |
| Physical deliveries and owned equipment deployment | Live road/train models, ramps, cargo and operators |
| Workers and manual operation | Clickable workers/equipment, direct movement and boarding |
| Storage and paving | Actual stock quantities, grid-aligned stacks and area tools |
| Buildings, sheds, lights, fences and utilities | Native placement with existing physical job sequences |
| Straight, curved and branching rail construction | Grid plans, real rail panels and work-phase poses |
| Group assignments, rail crews, support workers | Native inspectors and hierarchical work register |
| Equipment activities, shifts and parking | Native controls using shared assignment rules |
| Delays, deadlocks and recovery | Route intent, linked references, warnings and paused-handling controls |
| Deliveries, activity, costs, material history | Dense sortable/filterable registers |
| Inbox and diagnostics | To do / doing / done controls; bounded recording export |
| SQL | Local SQLite reporting snapshot without a web runtime |
| Persistence | Disk autosaves, manual save, backup and portable JSON files |

This migration does not add tanker routing, shunting locomotives, chemical tanks/pumps/piping, electrical trenching, sounds, or the other future mechanics tracked in GitHub. It brings the already implemented game into the native engine first.

## Build and verification

The runnable source is `native/`; the simulation boundary is `native-runtime/`. `npm run native:build` bundles the service and SQLite runtime. `Open Plant 01.command` is the development launcher. `scripts/package-native-macos.py` builds a self-contained local Mac app using copies of the installed Godot executable and bundled Node runtime, preserving their notices.

Native tests use temporary save directories, and renderer checks run sequentially under a time/memory watchdog. The unchanged simulation suite passed all 350 preexisting tests, and the native boundary passed eight additional integration tests. Godot headless checks cover client startup, all 11 native registers, live typed purchase quantities, popup legibility, entity picking, physical fork dimensions, cargo attachment, rail ghosts, stable vegetation, and keyed geometry reuse. The full native integration check verified that 2.2 real seconds advance the unfocused game by approximately 2.2 simulation seconds, then that pause holds time still.

Twelve actual 1920 × 1080 native captures completed in 28.04 seconds without engine errors or watchdog intervention, with a sampled renderer peak of 564.6 MB. Eight are paused states reached by 110,784 real simulation ticks through public procurement and construction operations: ramp descent, road/rail unloading, physical storage, rail staging, buffer lifting, shed erection, and a worker carrying fuel. These are real game states, not invented presentation phases. The run used Godot 4.7.2 / Forward+ / Metal 3.1 on Apple M2 Pro; no browser was launched. Short checks establish starter-yard behavior, not large-factory scalability.

Hands-on native UI review verified mixed batch purchase, ordered weight, sortable delivery headers, clickable order IDs, rectangle paving, parent work inspection, manual lighting, Command-S, the actual macOS export dialog, exported file contents, and graceful window shutdown. Popup menus and pending typed quantities found during this review were repaired and added to the UI smoke check.

Measurements and verification are saved under `native/tests/`; actual screenshots are under `native/screenshots/`. The older static proof and its measurements remain separate; they are not presented as performance measurements of the playable game.

## Packaged Mac checkpoint

`Plant 01.app` is a self-contained arm64 app of approximately 323 MB. It uses copied Godot 4.7.2 and Node 24.19.0 runtimes, requiring only macOS system frameworks; neither Homebrew nor the repository is needed at runtime. Its local ad-hoc signature verifies. The packaged headless integration check passed in 6.69 seconds with 317.7 MB sampled renderer resident memory and 27 live snapshots; the unfocused real-time interval advanced by 2.25 simulation seconds. Launch Services opened the actual app successfully, and its opening choices and corrected popup background were visually checked. It is ready at the startup screen with no invented user save. The app is for this Mac and is not a notarized cross-platform public release.

Source commit `d18bc6e` and the self-contained Mac app are published as [prerelease v0.19.0](https://github.com/lukacslacko/factory_game/releases/tag/v0.19.0). Native migration issue #19 records the checkpoint and remains open for creator playtest feedback.


## Camera and visibility patch — v0.19.1

Mac phased two-finger scrolling now reaches native zoom, as do fractional wheel deltas and pinch. Floor panning is anchored to the mouse-down camera and interpolates at display frame rate. Vertical right-button orbit is reversed. The optional grid starts enabled correctly, remains visible on dirt and installed paving, and uses antialiased 1 m lines plus 10 m guides. Grid and Dusk controls stay synchronized with keyboard and automatic changes. Sun shadows now cover the full 650 m visible range without an early distance fade; existing four cascades keep detail near the current working view.

The camera test passes 44 checks. Actual rendering at 1920×1080 measured median 17.203 ms and p95 17.804 ms; the camera changed on 168 of 180 drawing frames from just 15 mouse events. At 3456×1944, native resolution took median 40.363 ms. GPU temporal upscaling reduces that to 22.643 ms (p95 23.047 ms), with 154 moving frames from 15 events and a sampled 681 MB peak. Interface text remains full resolution. The full-resolution menu option remains available and is persisted outside the app. An isolated MetalFX experiment reported an Apple Neural Engine error and was removed; the delivered app uses FSR2. Measurements are short starter-yard checks, not factory-scale benchmarks.


## Shadow motion patch — v0.19.10

Both former rendering paths retained earlier scene frames: TAA at full resolution and FSR2 on larger Retina windows. Moving shadows have no matching motion vectors on the stationary ground, producing trails during movement. Use 4× MSAA without TAA at every resolution, and spatial FSR1 when reducing 3D resolution. The pixel budget and optional full-resolution preference remain unchanged; interface text remains at full resolution. Keep the same daylight, reflections, SSAO, SSIL and four shadow cascades. A GPU comparison reproduces the trails on both workers and the excavator’s body/boom/bucket, and checks immediate versus settled shadows at the same physical pose without including the moving meshes in its ground mask. Window resizing and the full-resolution preference are checked through the production settings handler.

The final moving-shadow check passes: 717 ground pixels exceed a 4/255 change in the TAA baseline and 885 in FSR2, versus zero in either spatial alternative. The three production policy checks (ordinary window, Retina scaling, Retina native resolution) pass. The isolated Retina camera test at 3456×1944 has median 17.960 ms and p95 18.399 ms, with camera movement on 168 of 180 drawing frames from 15 input events; sampled peak renderer memory is 408.9 MB. These are short graphics checks, not factory-scale benchmarks.


## Independent stops and converging turnouts — v0.19.11

The native railway planner can join two parallel endpoints using a converging turnout. Physical construction reuses the existing seven module types, installing tails before points. Purchasable 850 kg buffer stops have independent identities, collision footprints, installation/recovery handling and saved poses. Railway exposes completed open endpoints and buffer protection; SQL includes `buffers` and turnout `flow`. Redundant stops are carried into reachable stockyard slots before track connections can finish, with one retained stop moved to the common open end. The original saved yard remains intact.

Paid disposal remains future work in issue #35. Existing-track turnout insertion, main-line reception conversion and owned shunting retain their separate tracker scope.

The v0.19.12 follow-up corrects compound endpoint-ID clicks and generalizes numbered buffer links. Its 39 focused native UI/model/picking checks include selecting the actual Tree cell rather than calling the inspector directly.


## Multi-car supplier reception — v0.20.0

Rail batches become one identified supplier train, with bounded individual flatcars, per-car manifests and independently sampled body/bogie movement over the surveyed bootstrap approach. Named original-siding reception and explicit chosen-stockyard unloading are available in native controls; freight IDs and SQL records preserve composition and quantities. New rail orders wait for Start unloading, while old saved single-car services retain their existing behavior. In-game rail help documents the scoped workflow.

The supplier locomotive stays attached and returns with its emptied cars. Custom factory-track supplier routing, physical detachment/exit, owned shunters, splitting consists, return assembly, separate pickup ordering and time-based locomotive charges remain planned; the existing fixed charter fee is retained. Future work must extend commissioned track topology and real crew-operated couplers rather than teleporting cars or spawning invisible equipment.

The v0.20.0 checkpoint passes all 414 simulation/native-host tests, 26 native freight UI checks, 39 freight model checks and 39 existing switch UI checks. Isolated packaged-app integration passes in 6.65 seconds with a 314.7 MB renderer peak. The installed app retains the existing yard and is left paused on the rail help page. See `native/tests/freight-verified-results.json` for the verification record.

## Railway program — v0.22.0

The native Railway register now covers commissioned mainline/factory possessions, manual inherited-steel recovery, reception on connected named tracks, parallel reception and linked swept-route reservations. Physical ground crew perform coupler/brake/hose work. Owned diesel locomotives have qualified drivers, direct forward/reverse controls with explicit manual release, physical can refueling, delivered engine sheds and saved home bays. Tanker trains preserve contained liquid and per-car identities while receiving and shunting. Fluid transfer remains separate chemical-plant work (#8–#12).

See [Rail operations](rail-operations.md) and **Railway → Rail management help** for the current workflow. Automatic combined turnout insertion (#24) is canceled; recover the conflicting rails yourself before placing the switch.

## First fluid system — v0.23.0

The native Process register adds constructed 30,000 L tanks, powered rail transfer pumps, grid-connected DN100 piping, manual valves, and actual flow/level gauges. Components use physical kits, equipment and workers; hoses lock tanker cars against movement. Liquid fills finite pipe hold-up before the destination tank and remains conserved across valve operations, power loss, and saves. See [Fluid operations](fluid-operations.md) and Process → How to use. The Mac bundle includes a synthetic example yard; the browser deployment remains v0.18.0. Pressure hydraulics, reactions, draining, and tank-to-tank transfer remain future work.

## Worker selection and action clearance — v0.24.0

New automatic assignments use reachable walking-path distance to actual work/boarding/fuel positions, respect duties and explicit crews, and retain active assignments. Construction, handling and parking share saved action-clearance records and collision-checked idle actor refuges. Real operators are required to drive equipment; manual control, active work and cargo remain protected. Persistent linked warnings after 20 simulated seconds identify unsafe or impossible maneuvers and resolve when cleared. Native Activity and Inbox offer warning-only filters. See [the guide](worker-assignment-and-clearance.md).


## Site services and atmosphere — v0.25.0

Native equipment service now drives suitable free machines near reachable diesel drums, uses visibly held 20 L cans and retains a clearly labeled stationary emergency path for dry machines or supported loads. Outbound road collections quote costs, reserve real stored assets, load through owned equipment/workers and preserve IDs and disposal history. An operator drives retired forklifts/excavators onto actual low-loader ramps.

Native spatial sounds have saved master/category/mute/background controls and bounded playback. The production launchers use the normal audio driver. Sun, moon, sky, distant shadows and connected lamps follow actual simulated time continuously; every night has a full moon. The Dusk preview control explicitly overrides that presentation until switched off. See [Fuel, collection, sound, and daylight](site-services.md). The browser remains at v0.18.0. The native underground electrical system (#13) adds physical incoming service, delivered cable reels, cell-by-cell excavation/spoil/cable/backfill, and tested circuits to lights and pumps; see [Underground electrical service](electrical-operations.md).


## Underground electrical service — v0.26.0

Issue #13 adds explicit low-voltage underground circuits, conserved cable reels and adjacent spoil, excavator/operator/engineer work, paving restoration, physical recovery, and per-consumer electrical interlocks. Lights can extend a protected branch from their base; all branches share the root station's 16 kW service. Existing saves without circuits require real connections rather than receiving invisible free wiring. The example has an explicitly recorded opening circuit. See [electrical operations](electrical-operations.md).

The creator's earlier game was running during this update. Install the new build alongside it as **Plant 01 v0.26.0.app**; leave the running app and its saves untouched. Save and quit the old instance before continuing in the new one.
