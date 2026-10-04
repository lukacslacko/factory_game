# Plant 01 — Starter Yard

A playable first version of the fantasy chemistry plant game. Build and operate the construction yard before chemical production arrives: hire a crew, receive physical materials, move equipment, pave ground, extend track, and assemble a small base.

The world uses a true perspective 3D camera, with a meter grid, dimensional stock, angled lighting, and grid-aligned parked equipment. The records use the approved Condensed direction. The visual target is the latest **80% A / 20% B** selection, rather than the earlier rejected flat world studies.

## Play

The private game Site is **https://plant-01-starter-yard.lukacslacko.chatgpt.site**. This package documents version **0.8.0**; deployment status is recorded in `docs/publishing.md`. Sign in with the account that owns the Site. Local and hosted browser saves are separate; use Export save / Import save to transfer a yard.

On this Mac, double-click **Start Plant 01.command**. It starts the included local server and opens the game at **http://127.0.0.1:4173/**. Keep its Terminal window open while playing; Control-C stops the server.

The production build is included in `dist/`. Normal play needs **Node.js 22 or newer** and a desktop browser with WebGL. It does not require npm installation, a network connection, a service account, or a game engine editor. Chrome on macOS was used for the browser checks. Other browsers are not yet certified.

From a terminal:

```sh
node server.mjs
```

Choose **Start a new yard** for bare ground and an incoming starter order, **Start completely empty** to buy everything yourself, or **Explore Birch Junction** for a stocked example. There is no budget limit.

An additional save, **examples/willow-siding.json**, contains a complete small base built through 145 construction jobs and physical refueling jobs, with its full material, fuel, and cost history. Import it from the game menu to inspect or continue it.

Open **manual.html** through the local server for the illustrated player guide, or use **?** inside the game. Source and technical notes are in `docs/architecture.md`; validation is recorded in `docs/testing.md`. The original vision, design journal, and selected A/B reference images are preserved in `docs/design/`.

## What works

- Hire builders, equipment operators, and site engineers, named Worker #1, Worker #2, and so on. Buy a 6 t excavator or a 2.5 t forklift. Your own operator walks to its lowloader, boards, and drives it down the ramps.
- Order material by truck or train. Loads split by weight and available deck length. Freight waits for your own suitable machine, qualified operator, fuel, and reachable storage. Excavator lifts also require a builder or engineer to rig the load. Every batch moves from carrier to machine to its physical stack.
- Designate storage areas. Slabs stack up to 12 high in neighboring 1 m² cells; incoming batches top up partial stacks first. A forklift lifts at most eight 280 kg slabs per trip. Full-length rail panels, containers, kits, poles, fence panels, and diesel drums retain their dimensions and stack limits. Keep a reachable loading face and travel aisles.
- Drag paving plans; place offices, WC/showers, sheds, stores, lights, fences, and straight 5 m rail panels. Required foundations become ordinary construction jobs.
- Builders and operators board equipment, collect material, carry it, place it, and install it. The work register explains missing resources and access problems.
- Select a worker to walk cell to cell, board equipment, drive, or take a particular job. Hand control back without resetting the person or machine.
- Recover buildings, paving, and player-built rail into storage. Recovered prefab containers retain their asset IDs. Track plans recover existing paving first. Extending the initial siding relocates the same buffer.
- Road traffic keeps right on an 8.4 m road, queues behind stopped vehicles, and yields at the crossing. Carriers take turns through the connecting yard maneuver, while parked deliveries release it for other arrivals. Buses continue forward; freight and utility trucks back clear inside the yard before departing forward; lowloaders use a forward turning loop. Machinery yields to workers and routes around obstructions.
- Rail construction stages the panel beside the track, unbolts and lifts the existing buffer aside, lowers and joins the panel, then lifts and refastens that same buffer at the new end. Keep space beside the extension for staging and lifting.
- Consume diesel, receive low-fuel notices, and refuel through a worker carrying a 20 L service can. Fuel held in a can survives saving and loading.
- Order electrical and water/sewer services. Utility crews arrive and commission the service. Connected lights illuminate the yard at night.
- Inspect materials, workers, equipment, structures, deliveries, jobs, events, material movements, actual costs, and outstanding commitments. Track notifications in To do / Doing / Done.
- Query a fresh SQLite reporting snapshot and export costs as CSV. Autosave locally, export/import a portable save, and restore the previous yard backup.

## Physical slab placement

Paving now uses the actual top slab in its stack. The machine faces the loading side, aligns its forks or sling, lifts, backs clear, and carries the slab to the planned cell. It faces that cell before lowering onto temporary runners. After the machine withdraws, the builder removes the supports and sets the slab level. Keep the loading face, turning area, and withdrawal aisle accessible; obstructed operations wait instead of moving the load sideways. Saving, refueling interruptions, and cancellation retain the slab's physical location and inventory record.

## Assigning vehicles to work

Open **Equipment** and use each vehicle's **Automatic work** selector. You can also select a vehicle in the yard and change the same setting in its inspector. For simultaneous deliveries and paving, choose **Receiving only** for the forklift and **Paving only** for the excavator, with an available operator for each.

**All work** keeps the original shared pool. Other choices are **Building only**, **Rail work only** (excavator), **Recovery only**, and **Hold new work**. Paving includes building foundations; Building only covers the structure after its foundation is ready. Roles also apply when assigning an automatic job to a controlled operator. Direct driving, equipment deployment, and refueling remain available regardless of role.

Changes take effect after the current construction job or unloading batch finishes safely. The selector shows when a switch is waiting for current work. A receiving machine cannot be borrowed for paving, and a paving machine cannot be borrowed to unload. Blocked work explains when role settings exclude every suitable machine. Roles persist in saves and appear as `equipment.workRole` in SQL; older saves default to All work.

## Work orders, parking, and shifts

**Work** opens with active work orders. Expand a building to see its foundation and assembly; expand the foundation to see individual slabs. A paving drag forms one work order; contiguous rail extensions share a stretch. **Assign equipment** at any level. Children inherit the nearest assignment, and a child can override it. An urgent explicit assignment takes priority after the machine completes its current job or unloading batch. It overrides the vehicle's automatic work role, but requires a suitable machine, operator, fuel, and accessible route. Clearing an assignment restores inheritance or automatic selection.

Click any displayed asset or work ID to open its inspector. Assigned workers, operators, equipment, reserved stock, and parent work orders are linked. Historical references open retained events, material movements, and costs. Click table headers to sort; **Column filters** adds per-column text filters alongside the general search. Work sorting retains parent/child blocks. Large registers show 250 rows per page after sorting and filtering.

Select a machine, then **Choose bay in yard**, and click the center of a clear parking space. R changes the cardinal direction. Its inspector also accepts whole-meter coordinates. Bays can be inside the open part of a shed if the entire machine and approach fit between its posts and back wall. An available operator really boards and parks the machine when it is idle; blocked routes and missing operators appear in its status. Clear a bay to stop automatic parking there.

Use **Workers → Shift** for Always on, 07:00–17:00, 08:00–16:00, or 22:00–06:00. A worker inspector accepts custom hours, including quarter-hour increments. Schedules use the displayed yard clock, which advances one second per simulation second (1× is real time; 3× and 10× scale both movement and the clock). A shift ending stops new assignments; current physical work finishes before departure. The actual charter bus waits for its passengers; workers arrive for the next shift by bus rather than appearing at work. Always on is the default for existing and newly hired workers. The yard does not advance while closed.

## Diagnostic recordings

The local rolling recorder runs automatically. When a movement or assignment looks wrong, use **Activity → Export diagnostic history** or the same button in the game menu. The JSON includes the current portable yard state, up to four recent full checkpoints, phase transitions, commands, material events, and actor samples every 0.2 simulation seconds while moving (idle samples every half real second) with heading, next waypoints, cargo, fuel, and blocking IDs. Entries are bounded to 18,000 records or 6 MB, whichever comes first. Old records roll off; the export reports how many were dropped.

History is stored separately in IndexedDB on this device; no recording is uploaded automatically. The export is a diagnostic bundle, not an input to **Import save**. Its `current` state and checkpoint states can be extracted as ordinary saves. To summarize stalls and heading oscillation locally:

```sh
node tools/review-recording.mjs path/to/plant01-diagnostics-day1.json
```

The summary flags low-displacement route waits and heading reversals for review. A flagged wait can be legitimate traffic; inspect the blocker and work phase before treating it as a pathfinding defect. If browser storage is unavailable, Activity reports **Memory only** and the export still works until the page closes.

## A first construction session

1. Start a new yard, then choose **Stockyard** and drag a storage area (for example E24–51, S26–50). Empty yards have no storage assigned. Leave access around the loading face; slabs can occupy neighboring cells without a gap between every stack.
2. If starting completely empty, hire an operator and a builder, then buy an excavator and order materials. A forklift is an optional additional purchase; it never appears automatically. Watch your operator board the delivered machine and reverse down the lowloader ramps. Freight can arrive first and wait.
3. Choose **Office** and click on clear ground outside the stockyard, such as E4, S32. The game plans its 18 paving cells and its installation.
4. Choose **Pave** and drag an additional working area. Use **Buy missing** if your plans need more slabs than you ordered.
5. Place a sanitary container and a shed. Order water service for the sanitary container and electricity for lights.
6. Choose **Rail end**, then place rail panels beginning at E125, S5. The placement outline uses a symmetric two-cell footprint; the actual centerline and gauge remain precise.
7. Open **Deliveries** for an unloading delay or **Work** for a construction delay. An operator, construction worker, available machine with sufficient lift capacity, fuel, material, and an accessible route are all required.

Use **Unload with controlled operator** in a waiting delivery inspector to assign an operator you are controlling. Otherwise available workers on automatic duty handle it. Workers already in another idle machine climb out and walk to the required vehicle. Use 3× or 10× to shorten the wait. The field notes are optional and can be closed immediately.

## Controls

| Action                            | Control                                              |
| --------------------------------- | ---------------------------------------------------- |
| Select or place                   | Left click                                           |
| Pave or designate storage         | Drag with the corresponding tool                     |
| Pan                               | Left drag empty ground; W A S D relative to the view |
| Orbit                             | Right mouse drag                                     |
| Zoom                              | Mouse wheel                                          |
| Rotate a planned object           | R                                                    |
| Cancel placement or close a panel | Esc                                                  |
| Pause/resume                      | Space                                                |
| 1× / 3× / 10×                     | 1 / 2 / 3                                            |
| Grid                              | G                                                    |
| Yard camera                       | H                                                    |
| Follow controlled worker          | F                                                    |
| Purchase                          | B                                                    |
| Save                              | Ctrl / Cmd + S                                       |

Use **Overview** to see the whole buildable yard and **Rail end** to reach the far siding end.

## Saving and portability

The yard autosaves every 20 seconds while a game is open. Browser storage belongs to the browser and local URL, including its port. A different browser or port has separate saves. **Export save** is the portable backup; **Import save** validates the file before replacing the current yard and resumes paused. Starting a new yard preserves the old one as a browser backup. **Restore previous yard** swaps the current and previous yards.

Version 4 saves preserve traffic waiting, yard right-of-way, gear changes, deployment, unloading, and every rail handling pose and phase. Version 3 imports preserve materials and assignments. Moving road carriers map to the nearest compatible point of the new arrival or departure route; parked carriers move to their updated berth. These positions update immediately, including while paused, and any equipment or passenger still on a carrier moves with it. This one-time migration preserves equipment IDs, ramp progress, and invoices. An imported forklift rail job hands off safely: a carried panel is staged for an excavator, while installed track stays installed and only its buffer work continues. Version 1/2 saves migrate on import: workers are numbered, existing stock and ledgers stay intact, and active older carrier deliveries resume at their receiving point using your own resources. Material in the old carrier-handling animation returns to that carrier; it is not duplicated as stock. Version 1 rail centerlines retain the earlier version 2 migration.

The game does not advance while closed. Clearing browser data removes browser saves. Export important yards. A storage failure is reported instead of silently claiming to save.

## Deliberate first-version boundaries

This is a construction sandbox, with **no chemical production yet**. The buildable structure area is 232 × 98 m; the surrounding landscape and public transport lines are visual context. Buildable rail is straight; only the supplied turnout curves. There is no train driving, shunting, dispatch system, or builder for new switches yet.

Workers default to Always on. Assign daily or overnight shifts to use recurring charter buses: workers finish their current work, park equipment in assigned bays, leave the cab, walk to the bus, and return for their next shift. Labor is recorded while workers are on site; each charter is recorded separately. Food and welfare simulation are future work. Office and shed interiors are not simulated. Weather, seasons, tire wear, component failures, and repairs are not implemented.

The freight charge covers transport. Unloading uses purchased site equipment and hired workers. Road deliveries use separate crew, equipment, freight, and utility receiving points to keep a waiting load from blocking its unloading resources. Vehicle motion and heading are continuous, with rendered interpolation between simulation steps; train cars and bogies follow the track separately.

Utility services still use a scripted visiting crew and a commissioned site connection; individual pipes, wires, supply loading, and utility metering are not modeled. Routes avoid carrier bounding rectangles, buildings, and stock. Traffic checks use compound footprints and short swept motion samples. People walk around stopped vehicles, equipment routes favor fewer bends, and carriers follow fixed lane and yard routes with crossing and yard maneuver reservations. This is not a vehicle physics engine: arbitrary road networks, multi-vehicle dispatch, individual chain attachment, and manual boom-joint controls remain future work. A player can still block a fixed delivery route with construction or manually parked equipment; the affected vehicle waits and identifies its blocker. Parked grid alignment does not require vehicles to snap to a cardinal heading while turning.

Construction uses one material unit per hauling cycle. Kit assembly and fastening have visible work time rather than individual bolts. Recovery of assembled buildings returns a reusable kit. Empty fuel drums remain in storage; supplier returns are not implemented. Submitted orders cannot yet be canceled. These are implementation limits, not revisions to the original design vision.

## Develop and verify

```sh
npm ci
npm run dev
npm run check
npm run test:browser
```

`check` runs the simulation regression suite, strict TypeScript validation, and a production build. `test:browser` starts its own isolated Vite server on port 4180 and uses an isolated browser context. It uses installed Chrome on macOS, or Playwright Chromium elsewhere. Set `PLANT01_CHROME` to a browser executable, or install Chromium with `npx playwright install chromium`.

`npm run format` formats the source and documentation. A package lock is included. The runtime uses Three.js and sql.js; their license notices are included in `THIRD_PARTY_NOTICES.txt`.

## Source and license

The complete source, tests, design grounding, accepted visual references, guide, and example yard are published at [lukacslacko/factory_game](https://github.com/lukacslacko/factory_game). The project uses the MIT license; upstream libraries retain their licenses in `THIRD_PARTY_NOTICES.txt`. GitHub CI runs simulation tests, TypeScript, and the production build. Generated builds, local saves, diagnostic captures, and workstation hosting configuration are excluded from Git.

## Visual direction

Version 0.7 moves the playable world toward the accepted final C concepts, approximately 80% detailed A and 20% matte miniature B. It uses a closer, axis-facing perspective camera, neutral daylight and metal reflections, restrained contact shading, textured earth/concrete/asphalt/ballast, small leaf clusters, and more detailed machinery, people, and containers. Placed objects keep their physical grid footprints; the rail gauge and working load anchors are unchanged. Condensed records keep their dense text layout. The screenshots are actual gameplay, not concept renders.

## Version 0.8 operations update

Machines can prefetch the next slab while a worker levels the last one, including a one-builder crew. Receiving riggers walk ahead; empty carriers leave while site placement continues. These operations retain real crew, cargo, and clearance requirements through save/load.

1× is real time for both motion and the calendar, with seconds in the top bar. 3× and 10× scale both. Existing dates and financial records are preserved. A reproduced short-corner steering mismatch was corrected; if another flutter occurs, attach the JSON from Activity → Export diagnostic history for review.

Repeated actual equipment travel creates persistent worn dirt paths. Comparable routes prefer hardstanding, then established dirt, then ordinary dirt. Wear is bounded; machinery damage and weather remain future work.
