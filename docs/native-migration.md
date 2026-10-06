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
