# Starter Yard validation

This record includes version 0.12 curve/turnout construction and the earlier automatic equipment ownership alongside the earlier forklift support, work checklists, shed assembly, handling, traffic, and rendering checks. It does not certify every browser, an arbitrary large factory, or an unattended multi-hour soak.

## Simulation and motion regressions

The current simulation suite covers the existing construction, recovery, fuel, accounting, and import flows, including these physical handling requirements:

- Freight remains on its carrier when no purchased machine or hired operator exists.
- A waiting freight load does not prevent the bus or machine needed to unload it from arriving.
- A purchased machine keeps its identity on the lowloader, waits for an operator, and is driven down the ramps before site work.
- Unloading reserves owned equipment and a hired seated operator; excavator lifting also needs a rigger.
- Pickup, carrying, release, and save/resume conserve quantities without a second purchase charge.
- Partial stacks receive later deliveries, neighboring slab cells are usable, and a 3 × 3 m area can hold nine full stacks without the old artificial spacing.
- Incoming and recovery reservations cannot overfill a stack. Storage capacity and per-lift mass capacity are distinct.
- Worker names are sequential, and old saves migrate without losing existing stock or creating a free machine.
- Motion accelerates, brakes, turns continuously, and follows track geometry using separate car and bogie positions.

The broader suite exercises initial procurement through a completed base, physical deck capacity, once-only invoicing, construction cancellation before and after pickup, manual assignment, material recovery, retained prefab IDs, buffer relocation, paving removal before rail installation, refueling during work, fuel carried in a can, malformed-save rejection, and material/accounting balances across reloads.

The wide-load test checks the complete 6 × 3 m office footprint against its carrier throughout the turn, and reproduces the former failure when the withdrawal distance is restored to 3 m. The forklift ramp test verifies both unequal wheels at approximately 480 positions across the deck, ramp, and ground transitions.

## Rendered model inspection

Seven isolated Three.js scenes were rendered and visually inspected: train, excavator, forklift, workers, material truck, crew bus, and loaded lowloader. Inspection led to hollow glazed cabs with visible seats and operators, correct wheel contact, grounded worker boots, supported forklift loads, articulated excavator tools, continuous track shoes, and ramps whose upper surfaces reach the ground. A follow-up office-lift inspection prompted longer articulated boom links for roof clearance, while explicit slab spacers and thinner tapered forks support partial-stack pickup.

A separate development QA script checks model geometry. Both rail vehicles have two bogies with two axles each; wheel positions match the rail centers and head height. A standing or walking worker retains a planted boot at Y0. Fork support and cargo-contact anchors match selected lift heights. Excavator hooks reach the requested sling anchor. Lowered ramp tips meet the defined ground endpoint. This script is an auxiliary development check, not part of `npm test` and not a claim to certify the entire collision model.

The main browser physical-rendering checks inspect the integrated scene, including deployment and unload phases, frame interpolation, worker ground contact, and the rebuilt train. Phase screenshots support visual review; numerical assertions alone cannot establish whether an operation looks convincing.

## Browser interaction coverage

`tests/browser.mjs` uses the actual interface for procurement, planning an office by clicking its projected world cell, construction completion, selecting rendered assets, worker control and boarding, SQL, CSV export, notification workflow, and save/reload. It checks dense registers at 1440, 1024, and 768 px widths. Console errors and uncaught page errors fail the run. A development-only harness advances long simulation waits; interface operations still use real browser controls.

`tests/navigation.mjs` checks perspective depth, orbit followed by view-relative WASD, floor-anchor dragging, and gesture separation while controlling an operator. It also protects Stockyard drag planning and the measured rail gauge, crossarm orientation, and buffer supports.

`tests/physical-rendering.mjs` runs inside the browser suite. The final integrated run passed with no page or console errors: grounded boots, rail wheel contact, independent bogies, six interpolated frames between simulation ticks, and no carrier helper models. All 18 register/width combinations passed without horizontal document overflow. The complete procurement, construction, control, SQL, export, and save flow passed. Actual 1×/3× handling phases were also visually inspected, including rail and office loads with the excavator and partial slab top-ups with the forklift.

## Version 0.5 roles and slab handling

The role regressions run receiving and paving simultaneously, switch roles while cargo is carried, save and resume those assignments, and verify that no subsequent ineligible job is claimed. They cover the building, rail, recovery, and hold settings; legacy defaults; invalid imports; and continued access to direct driving, real refueling, and lowloader deployment. Each active transfer is checked against the material balance.

Slab regressions measure the real top-of-stack pickup position and machine facing at both endpoints, with bounded displacement at every 0.1-second step. They cover both machine types, each active saved phase, cancellation while carried or supported, fuel interruption followed by a real refueling job, legacy in-transit cargo, dense paving, and rejected malformed handling state. The supported setdown exists as a reserved physical stack before installation. Separate storage regressions establish a future withdrawal lane before its machine arrives, then check both general allocation and an actual arriving freight order against it; checking only the current machine position cannot satisfy these cases.

Freight continuity checks also cover both machines: working reach changes gradually during transport, the carried slab reaches the actual destination before lowering begins, and the vehicle faces the stack. This catches the former pickup-reach-to-storage-reach snap in delivery unloading.

The Equipment UI browser check uses the actual register and inspector selectors, checks that live updates preserve keyboard focus, queries roles through SQL, and saves/reloads through the menu. The full browser runner includes this check alongside its earlier procurement and construction flow.

## Version 0.4 traffic and rail checks

- Right-hand lane clearance is measured against the actual bus, truck, and lowloader bodies on both sides of the crossing. Mixed arrivals queue without intersecting a stopped bus or each other.
- Bus departures remain forward; freight saves resume backing, the stopped gear change, and the forward exit; a lowloader follows its forward loop without duplicating its deployed machine. Yard maneuver reservations survive reload while arrivals and multiple departures compete.
- Road vehicles stop for a person in the crossing. A driven machine stops when a worker enters an already planned route; crossing pedestrian and forklift trips both finish without passing through each other.
- Opposing machines yield and retain their destinations across saving. An idle machine moves aside only with its automatic operator seated. Manual/resting operators do not move without the player's command. An obsolete obstruction cannot repeatedly send a distant worker outside the yard.
- Clear routes use one straight run or a simple L, with obstacle detours and thin-wall tests guarding against diagonal shortcuts and the old staircase paths.
- Rail extension retains the same panel and buffer through source pickup, staging, unfastening, lifting aside, panel placement and joining, buffer retrieval, and refastening. Phase-by-phase save/resume checks conserve both cargo and reservations. Cancellation safely restores the buffer and retains the staged material.
- Imported active forklift rail jobs are tested before pickup, during supported setdown and withdrawal, after panel installation, and during cancellation. The same panel and buffer survive saving and the handoff to an excavator.
- Import rejects corrupt suspended poses, missing panel references, and invalid traffic fields. Version 3 road migration runs while the imported yard is paused, keeping ramp passengers, the same owned machine, assignments, and once-only invoices coherent.

Rail handling and road departures were also rendered and visually inspected. The rail clip is continuous accelerated gameplay, not an image-generation mockup. The installed and suspended panels share their geometry and use a 0.36 m storage pitch; the buffer is supported on the ground or rail during its resting phases. Hook alignment was measured against the displayed sling anchor. Road inspection covered the curbside bus, truck backing and forward departure, raised crossing, and lowloader turning loop.

## Version 0.4 release results

The version 0.4 release passed **86/86 simulation, delivery, motion, traffic, migration, and rail tests**, strict TypeScript validation, and the production build. The integrated browser run passed with no console or page errors and all 18 register/width combinations fitting at 1440, 1024, and 768 pixels. A final narrow rail crew-wait correction was checked by the fuel-interruption and physical rail regressions before rebuilding.

The fresh Willow Siding save was generated from actual version 4 purchases and work: 145 completed jobs, all 19 carriers departed, 132 paving cells, 10 buildings/utilities, five rail panels, and the buffer at E150, S5. All material balances match, and no cargo, material reservation, or transport assignment remains. The run took 6,765.1 simulation seconds and recorded $141,850 in costs, with fuel remaining in both machines. The larger save/reload regression completes the same scope. The 7,500-second test bound allows the added staging, fastening, walking, and yielding operations; no free fuel, bypassed collision, or synthetic completion is used.

The production server passed independently with no console warnings, page errors, failed asset requests, or external requests. Its menu and guide report version 0.4.0. Local SQL/WebAssembly loaded, the development harness was absent, the older nighttime save and completed example imported, and all three guide images loaded. The guide fits a 768-pixel viewport. An 80-frame idle-yard sample after warmup at 1440 × 1000 averaged 16.66 ms (60 fps) on this Mac; this is an idle-yard observation, not a large-factory performance guarantee.

Results are saved in `test-results/simulation-result.txt`, `simulation-summary.json`, `example-result.txt`, `browser-result.json`, and `production-result.json`. Actual gameplay previews include the traffic screenshot and a 24.1-second continuous rail sequence at 8× speed.

## Version 0.5 release results

The final release passes **109/109 simulation, role, handling, delivery, traffic, migration, recovery, and fuel tests**, strict TypeScript validation, and the production build. The integrated browser suite passed with no page or console errors, including the new register/inspector/SQL/save role checks and all 18 register/width combinations. The final production check also passed: version 0.5.0 menu and guide, local SQL/WebAssembly, no development harness, old nighttime-save import, 147-job example import, three loaded guide images, no failed or external requests, and guide width at 768 pixels. An 80-frame idle-yard sample averaged 16.67 ms (60 fps) on this Mac; this remains a limited idle-yard observation.

The fresh Willow Siding example completed **145 construction jobs plus two actual refueling jobs**, with all 19 carriers departed. It retains 132 paved cells, 10 buildings/utilities, five rail panels, and the buffer at E150, S5. The run took 10,121.7 simulation seconds and recorded $146,218. Every material balance matches. A per-tick fuel audit accounts for initial tank supplies and purchased drums across consumption, drum contents, carried drums, service cans, and tanks. Seven actual drum-to-can collections and seven tank transfers were observed; 61.31 L remains in the excavator and 32.00 L in the forklift. No cargo, reservation, or fuel-filled service can remains.

The larger scenario now requests refueling below 8 L through the same public command as the Equipment button; it never edits tanks or grants fuel. Its bound is 12,000 seconds to allow the longer physical operation. The separate 15-cell paving setup completes at 1,414.0 seconds, and its entire paving/rail/recovery sequence at 1,913.8 seconds. Only that setup's old 1,200-second bound was increased to 1,800; the common timeout and later recovery bounds remain unchanged.

Actual rendered slab checks cover both forklift forks and excavator sling/hook contact. The continuous forklift clip is 46.75 seconds long: handling phases run at 1× and only travel is labeled 4×. The recorded job completed after 89.2 simulation seconds, with zero measured fork-to-slab height error in carried frames. The clip and phase stills were visually reviewed. This is evidence for the tested sequences, not a certification of arbitrary dense yard layouts or rigid-body physics.

Results are in the simulation, example, browser, production, and slab-rendering files under `test-results/`. The archived package includes the new Equipment screenshot and actual slab-handling clip.

## Earlier baseline results

Version 0.3 passed 50 simulation, delivery, motion, and ramp-contact tests. Version 0.2 established the perspective camera, view-relative navigation, floor dragging, precise gauge, and production/offline asset checks. Their observed idle-yard frame rates were specific to this Mac, not large-factory performance guarantees.

## Reproduce

Run `npm run check` for simulation tests, strict TypeScript validation, and production build. Run `npm run test:browser` for browser interaction checks; browser setup is documented in the README. The browser runner also invokes the navigation and physical-rendering checks; their results are included in `test-results/browser-result.json`.

Inspect the generated phase screenshots and play at 1× after accelerated checks. Pay particular attention to boarding, ramp contact, partial-stack pickup, backing clear of the carrier, lowering, and withdrawal. Confirm that closing/reloading during these operations keeps quantities and assignments intact.

Known limits remain explicit: compound collision footprints and sampled swept checks rather than rigid-body physics; fixed public road and delivery routes rather than arbitrary road dispatch; no individual chain or bolt interaction; a finite site and straight buildable rail; scripted utility commissioning; no chemistry, seasons, machinery failures, or component wear. Ground compaction and route preference are implemented. Manually parking or building across a fixed delivery route can stop traffic until the player clears it.

## Version 0.6 coverage

The operations update adds passive diagnostic bounds/state isolation and transition capture, natural/numeric register comparisons, building/paving/rail hierarchy, inherited and overridden assignments, urgent current-cargo and delivery-batch handover, cycle/capability save validation, and tree sorting.

Workforce regressions cover physical boarding/driving/alignment in a parking bay, daily/overnight schedule boundaries, outbound boarding/inbound alighting saves, unchanged worker identity and charter billing, and shift end during a carried slab. The carried slab finishes and the next task stays queued while machines park and workers ride home.

Integrated browser checks use actual controls for group assignment, expand/collapse, entity navigation, coordinates and clicked parking bays, shift presets, header sorting, column filters, diagnostic downloads, and save reload. The diagnostic-review CLI reads the downloaded bundle. Movement regressions include shed posts/back wall, lamps/cabinets/buffer, grounded route execution, and rail stock approaches. Existing full-base, legacy rail, material/fuel balance, freight, and traffic tests remain required.

The work-animation browser check renders seven frames between two simulation updates and verifies distinct excavator-tool and worker-arm poses without a frame-sized jump. The collision geometry cache is checked against an independent polygon projection oracle while reusing and mutating 500 boxes; positions, dimensions, yaw, and clearance margins must invalidate or bypass cached geometry correctly.

An isolated comparison on a saved 5,823-second starter-base state ran the same 600 simulation ticks twice per implementation. The original collision checks took 5.824 and 5.696 seconds; the retained implementation took 5.245 and 5.145 seconds, with identical final state. Caching only nearby pairs was faster in this fixture; caching every pair was slower and was discarded. This measurement concerns one planning-heavy fixture and does not establish a general frame-rate guarantee.

## Version 0.6 release results

The frozen source passes **141/141 regression tests**, including the full starter-base save/reload case, physical collision and handling, work hierarchy, manual assignments, parking, shifts, commuting, carrier pedestrian clearance, diagnostics, and save validation. The run took 469.38 seconds on this Mac; all 53 source/test/config hashes match the recorded input manifest. TypeScript and the production build pass. The final browser suite has no page or console errors and passes all 18 register/width combinations, operations controls, diagnostic export, save reload, and interpolated work-arm checks.

The fresh Willow Siding example completes **145 construction jobs and two actual refueling jobs**, all 18 work-order groups, and all 19 delivery departures. It has 132 paved cells, 10 buildings/utilities, five rail panels, and the same buffer at E150, S5. The run took 10,896.8 simulation seconds and recorded $147,232. All nine material balances match; the 525 L fuel supply is accounted for in consumed fuel, drums, and tanks. Seven physical service-can collections and seven tank transfers occurred. No cargo, reservation, active actor assignment, or fuel-filled service can remains. The original 12,000-second full-base bound is unchanged.

The final carrier regression makes an idle automatic worker walk clear, wait while the vehicle passes, and return through save/reload. A working refueling crew retains its carried can, pauses the service while clearing traffic, and completes afterward. A manual worker remains an obstruction until the player's command moves them.

The final production check passes with no console warnings, page errors, failed asset requests, or external requests. Its version 0.6.0 menu and guide, local SQL/WebAssembly, old nighttime import, fresh 147-job example import, three guide images, and 768-pixel guide width pass. The idle-yard 80-frame sample averaged 16.67 ms (60 fps) on this Mac; this is not a dense-factory performance guarantee.

## Version 0.7 visual verification

The visual release passes strict TypeScript and build checks, the full integrated browser suite (no page/console errors, all 18 register/width combinations), actual perspective/navigation/physical contact/interpolation checks, 62 standalone model geometry assertions, and three diagnostics regressions. The production build independently passes version/guide, local SQL/WebAssembly, no development harness, nighttime save and 147-job example import, guide images/768-pixel width, and zero failed or external requests.

At 1680 × 1000 and DPR2, the final isolated seven-view capture measured 16.7 ms median frame times. The default yard, overview, equipment, containers, stock/shed and turnout had p95 at most 16.8 ms; the train view had occasional 33.3 ms frames. Initial full-scene contact shading added unnecessary work; the retained pass excludes ground cover, reuses existing shadow maps, and computes broad contact shading in a smaller buffer. These measurements apply to this Mac and these paused views, not arbitrary factories.

No simulation core file changed; `visual-simulation-baseline.json` identifies the unchanged 141-test v0.6 baseline. The prior balanced example is reused without regeneration. This distinction avoids labeling old simulation results as a fresh run. Visual reports, model assertion metadata, diagnostic and browser/production records accompany the release.

## Workstation resource limits

The default test command runs one test file at a time with a 384 MB JavaScript heap limit per Node process. Browser verification runs separately from full simulation/example generation. The creator reported a laptop hang and reboot during this iteration; the cause was not established. The earlier default runner allowed test-file parallelism while Chrome and diagnostic reproductions also ran. Subsequent local checks use a single heavy workload and resume saved diagnostic checkpoints where possible. A JavaScript heap limit does not cap all native or GPU memory.

## Version 0.8 regression scope

The operations regressions cover both machines prefetching with one builder while the previous supported slab is leveled, independent save/cancel/fuel handling, early receiving-rigger dispatch, and road/rail carriers leaving while site placement continues. Offsite carrier handling survives save/reload and preserves once-only invoices. Clock tests cover real simulation seconds, wages, saved calendar values, and supplier lead time. Motion checks reproduce a short-corner heading reversal and verify consistent steering and translation.

Ground-wear checks account only for committed machine movement, protect pavement and fixed access surfaces, retain the bounded map through saves, compare preferred routes, and replay collision clearance. Browser checks measure the actual 1×/3×/10× foreground controls and render repeated real equipment travel into a worn-path decal. Texture refresh is limited to twice per real second.

The full-base investigation adds blocked placement-crew walks, actual idle-machine dock clearing with automatic/manual controls, and a worker escape around a stock row and a loaded turning envelope. Generic slab routes that custom physical handling discarded are removed from assignment/boarding. Qualification, capacity, fueling, source reservations, operator boarding, custom docks, and executed collision checks remain required.

Segment clearance uses scalar clipping and early bounds rejection. Three focused tests include 25,000 deterministic comparisons against the frozen prior clipping implementation, plus thin walls, points, tangencies, near-parallel segments and custom clearances. A separate benchmark of 240,000 identical queries against 36 obstacles measured 224.0 ms before and 46.2 ms after, with identical results. This is a local clearance benchmark, not a whole-game speed guarantee.

## Version 0.8 validation results

The frozen source passes **167/167 regression tests**, including the complete starter-base save/reload scenario, material and fuel audits, both new dock/crew deadlocks, manual clearing controls, overlapping operations, real calendar time, worn surfaces, and numerical clearance parity. The sequential run completed in 239.63 seconds on this Mac with a 384 MB JavaScript heap cap per test process. The 61-file input manifest records that run. The 12,000-second full-base limit is unchanged.

The integrated browser suite passes with no page or console errors, including all 18 register/width combinations, navigation, manual controls, assignment/parking/shift tools, SQL, diagnostic export, save reload, stable paused controls, and interpolated work arms. Actual foreground samples advanced 1.5, 4.8, and 16.0 simulation seconds over about 1.60 wall seconds at 1×, 3×, and 10× respectively (the simulation uses 0.1-second steps). Repeated public driving/boarding commands traveled 448 m, compacted 58 cells to a maximum of 0.414, and produced a visible ground decal with 2,877 marked texture pixels. The real gameplay worn-path screenshot was visually inspected.

Production verification exposed a per-cell canvas-filter stall when the completed example was loaded. The final renderer composes the cell mask first, blurs it once, rate-limits revision changes, and skips unchanged paused textures. The final browser rerun passes with 3,427 real example cells (7.0 ms mask update) and a renderer-only maximum 12,000-cell fixture (23.8 ms). Both gameplay screenshots were inspected. These are CPU mask-update observations on this Mac, not whole-frame guarantees. Only the renderer and its browser fixture changed after simulation validation; the final release manifest records those two hashes separately. All simulation, physics, routing, save, and configuration inputs remain unchanged.

The fresh Willow Siding example completes 145 construction tasks, two physical refueling jobs, all 18 work groups, and all 19 delivery departures in 8,392.8 simulation seconds. It has 132 paved cells, 10 buildings/utilities, five installed rail panels and the buffer at E150, S5. All nine material balances match. The 525 L fuel supply is accounted for across consumption, drums and tanks; seven service-can collections and seven tank transfers occurred. No cargo, reservation, active actor assignment or filled service can remains. Recorded actual cost is $133,487 with the real-time labor clock.

The final production check passes version 0.8.0 menu/guide, local SQL/WebAssembly, no development harness, legacy nighttime-save import, the fresh 147-job example import, three loaded guide images and guide width at 768 pixels. There are no console warnings, page errors, failed asset requests or external requests. An 80-frame paused-yard sample at 1440 × 1000 averaged 16.67 ms (60 fps); this remains a limited idle-yard observation.

## Version 0.9 regression scope

Batch regressions execute mixed concrete/diesel shipments by both road and rail with real machine boarding, load handling, storage transfers, and carrier departure. Saves are reloaded during the first and second manifest lines. They check cargo conservation, secondary-item incoming totals, fixed deck slots, and one invoice per carrier. Mixed-role hires step off one bus, retain individual wages, and survive a save during alighting. Packing tests enforce 12 seats, payload limits, deck length, dedicated lowloaders/services, and validation before any state mutation. Invalid and tampered manifests are rejected.

Terrain regressions run the actual landscape geometry builder and compare every surviving instance's position, scale, orientation, and color after paving and compaction. Gate-pad geometry has no coplanar intersections. Thin hardstanding receives shadows from equipment and workers without acting as a ground-shadow occluder.

The full sequential simulation suite passes **175/175** tests in **116.81 seconds**, with no failures or skipped tests and a 384 MB JavaScript heap cap per test process. Browser verification runs separately. The existing balanced Willow Siding example is retained as a compatible prior-release save; it is not a newly generated v0.9 example.

The final integrated browser check passes with no page or console errors. It orders six mixed-role workers on one bus, previews the same 8,355 kg manifest as two road loads or one rail load, checks six line-level SQL rows and save validation, and verifies procurement at 1440/1024/768 pixels. The turnaround and receiving hardstanding screenshot was inspected and no longer has the reported diagonal stripes. All 18 register/width combinations, controls, roles, shifts, diagnostics, interpolated work animations, real-time controls, and maximum-map wear rendering pass. The production build and independent production-browser check pass version 0.9.0 menu/guide, local SQL assets, older saved yards, the existing 147-job example, and loaded guide images with no console warnings, errors, failed requests, or external requests. These browser and build checks follow the simulation run; simulation inputs remain unchanged.

## Version 0.10 support, checklist, and construction coverage

Fork geometry regressions raycast the actual tines at both rail-panel bearing locations across working reach positions. Delivery checks cover retracting travel, person clearance during reach changes, and conserved rail cargo. The browser checks sample seven interpolated frames during rail and slab travel and lowering, measuring actual tine contact, fixed tine lengths, carriage support, and frame displacement.

Automatic work regressions cover multiple selected activities, legacy roles, explicit assignments, saved selections, and invalid imports. Browser controls exercise the register and inspector, keep a focused checkbox through running refreshes, and close the checklist with Escape while retaining the selected equipment.

Shed regressions exercise staging and unpacking, each anchor and component phase, operator and builder participation, elevated fastening on a supplied ladder, rotated construction, mid-lift saves, old forklift handoff, partial cancellation, and kit balance throughout assembly. Browser checks inspect the actual partial and completed models, component counts, smooth load/tool motion, and worker climbing. The finished building is absent until its last component is fastened. Actual screenshots are captured from live simulation snapshots, rather than generated illustrations.

The wider suite also covers a recovered office backing clear before turning beside the longer forks, and a yielding machine returning to its original destination after its blocker parks. Existing collision checks remain active in these scenarios.

The final frozen implementation passes **189/189** sequential simulation regressions in **109.84 seconds**, with no failures, cancellations, or skipped tests and a 384 MB heap cap. The integrated browser suite passes with no page or console errors, including all five shed component types, ladder climbing, supported rail/slab loads, retained checklist focus, and all 18 register/width combinations. The contact tests measure actual cargo/tine meshes; the motion bound accounts for chassis travel, turn radius, extension and lift. Worker-clearance pauses are retained, with interpolation sampled during an advancing tick.

The final production check passes version 0.10.0 menu/guide, local SQL/WebAssembly, absence of the development harness, older nighttime and 147-job example imports, all three guide images, and the guide at 768 pixels. No page errors, console warnings, failed requests, or external asset requests were observed. A paused-yard sample averaged 16.67 ms per frame on this Mac; it is not a large-factory performance guarantee. The complete source/test fingerprint and deployed build hashes are recorded in the local release package.

## Version 0.11 single-machine automatic work

Fifteen new regressions cover sticky ownership across paving cells and unloading lifts, independent parallel work orders/carriers, saved ownership, safe role/fuel/operator handoffs, capacity changes across foundations and heavy assembly, explicit overrides, legacy active assignments, and invalid saved references. Current cargo remains with its real machine. The full sequential suite passes **204/204** tests in **120.19 seconds**, with no failures, cancellations or skips, and a 384 MB heap cap.

The browser check selects a real automatically owned paving order through the Work register, follows its linked equipment ID, queries its SQL owner, and reloads that same owner through the Save control. Broader integrated and production results are recorded after those checks.

The integrated browser suite passes with no page or console errors. The actual automatic owner is linked in the work inspector, survives the interface Save/reload flow, and appears in SQL. Independent simulation checks cover concurrent work and receiving. All 18 register/width combinations and prior cargo, construction, controls, notices, logs and terrain checks pass. After the full simulation run, only browser fixture navigation, inspector layout, and the SQL column declaration were corrected; simulation inputs remain unchanged. The final browser run also asserts that assignment controls cannot clip linked equipment IDs.

The final production check passes version 0.11.0 menu/guide, local SQL/WebAssembly, absence of the development harness, older nighttime and 147-job example imports, all guide images, and 768-pixel guide width. No page errors, console warnings, failed requests or external asset requests were observed. The paused-yard sample averaged 16.67 ms per frame on this Mac; it does not establish large-factory performance. Production assets match the deployed build byte for byte.

## Version 0.12 railway checkpoint checks

The new geometry cases cover all eight curve orientations, exact analytical joints and tangent continuity, consistent rigid cargo profiles, all seven bounded turnout pieces, occupied-cell strips, protected bootstrap topology and endpoint-only joins. Planner checks cover exact material demand, real deck limits, planned chains, cardinal connections, protected corridors, priority-independent physical ordering, blocked resumption, and matching geometry/material imports. Focused construction cases exercise actual six-panel curve construction, seven-piece turnout construction, supported left-hand kit reconfiguration, mid-lift save/reload, safe cancellation/replanning and continuation after a canceled partial assembly. Material quantities and reservations are audited through the sequences.

Rendered curve stock is checked during a real purchase/unloading operation. Isolated installed-layout fixtures verify geometry, gauge, crossing gaps and manual lever visuals; those fixtures are explicitly rendering checks, not evidence of construction. The interface flow separately plans and completes a connected curve and turnout through normal deliveries and owned equipment, checks the actual Railway register, and saves/reloads all thirteen panels. Nine additional manual-operation regressions cover actual walking and four-second lever time, missing crew, blocked access, partial saved progress, physical return on cancellation, duplicate requests, equipment/material isolation, invalid imported operation state and all heading/hand combinations. Final release results are recorded after the sequential full simulation, integrated browser and production checks finish.

The frozen simulation implementation passes **244/244** tests in **157.16 seconds**, with no failures, cancellations or skips. The suite runs sequentially with a 384 MB JavaScript heap cap. An initial legacy save round-trip comparison exposed an optional field being emitted as `undefined`; the corrected implementation passes the full rerun.

The browser pass subsequently corrected the diagnostic export version label and exposed missing through-rail subdivision at a turnout frog. The final visual mesh contains a localized interruption on both crossing rails. All four focused visual tests and all three diagnostics tests pass again after those fixes; the simulation scheduling and construction inputs are unchanged.

The end-to-end procurement playtest exposed a loaded stock-face deadlock and a final-turn obstruction beside stored fencing. Rail work now preflights the loaded withdrawal envelope, uses a collision-checked forward exit through a vacated source bay when needed, and retries blocked stock turns through a straight lifting-lane entry. Two added regressions cover a receiving forklift beside the pickup face and the real curve-to-turnout Buy missing flow. The captured failed save also completes every panel and delivery without manual asset edits, with conserved materials and continuous suspended-panel motion.

After those fixes, the final full suite passes **246/246** tests in **161.15 seconds**, with no failures, cancellations or skipped tests and the same sequential 384 MB heap cap. This is a fresh run against the final source; the earlier 244-test result records the intermediate check.

The final integrated browser suite passes with no page or console errors, including 21 register/viewport combinations. It physically unloads a purchased curved panel, measures 264 inner rail-head mesh gaps at 1,435 mm, and plans/orders/builds the thirteen-panel connected curve and turnout through the interface. A real worker throws the lever, and the selected route plus installed panels survive the interface Save/reload controls. Actual construction and separate rendering-fixture images were inspected.

The independent production check passes version 0.12.0 menu/guide, local SQL/WebAssembly, no development harness, older nighttime and 147-job example imports, all three guide images and 768-pixel guide width. No page errors, console warnings, failed requests or external requests were observed. The paused-yard sample averaged 16.66 ms per frame (60 fps); it is not a large-factory performance guarantee. The example remains the compatible v0.8 save, not a newly generated v0.12 yard. Final input fingerprints and byte-matched production assets are included in the release package.
