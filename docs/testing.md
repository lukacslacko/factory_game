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

## Version 0.13 loaded routing and equipment intent

The new delivery regression orders eight curved rail panels on a real train, reaches the three-stored/one-carried top-up state, demonstrates the former circular route rejection, and saves/reloads that state. It verifies completion into two stacks of four, continuous tool-supported cargo, executed collision checks, balanced materials and one supplier invoice. A separate real dock obstruction retains the lifted cargo and identifies the stack, coordinates and blocking container. The focused delivery suite passes 35/35 tests. The final fresh full suite and browser results are recorded below.

Broader verification exposed a saved traffic escape that could leave a carrying machine with no return path while still far from the storage dock. Delivery handling now retries that real loaded trip in forward or reverse gear, accepts an alternate clear approach when needed, and preserves the lifted load and detailed blockage message while waiting. Failed searches are spaced 1.5 simulated seconds apart. A focused saved-state regression checks the physical return rather than allowing remote lowering.

The first full run passed 253 of 254 tests and exposed a delivery merging a second curved panel onto an active rail job's single-panel staging supports. The captured movement history confirms the extra top-up rather than lost material. Receiving and recovery now distinguish those job-owned staging piles from ordinary partial stock. The installation code continues to require exactly its one reserved physical panel; ordinary stockyard top-ups remain available. Focused and final checks follow this ownership correction.

The now-progressing construction case exposed a source preflight that tested only the excavator's current reverse gear. The captured loading faces were clear with safe loaded withdrawal, but reachable only using a forward entry. Source preflight now considers both gears, matching actual machine movement. Failed initialization searches use the existing 1.5-second retry timer. A focused opening-state regression covers both the false reverse-only rejection and the retry limit. Equipment intent also identifies the reserved stock before a physical rail handling sequence has initialized.

After the routing, traffic-return, staging and entry-gear corrections, a complete full suite passes **257/257** tests in **173.93 seconds**, with no failures, cancellations or skips. Test files run sequentially with a 384 MB JavaScript heap cap. This result replaces the earlier intermediate full result. Accepted conservative delivery paths are retained; actual loaded-pose routing supplies the fallback for falsely rejected long-load approaches. Every executed movement still uses collision guards. Browser verification runs in a separate process.

Visual inspection subsequently caught the old blockage note lingering for the first frame after accepting a route. The note now changes immediately, and both simulation and browser checks assert it. The final frozen fresh suite passes **257/257** tests in **169.27 seconds**, with no failures, cancellations or skips and the same sequential 384 MB cap.

The final integrated browser suite passes with no page or console errors and all 21 register/viewport combinations. The new flow runs the actual eight-panel rail delivery, checks a real blocking container and linked stock/order/blocker records, removes the test obstruction, verifies the accepted route and immediately updated hauling note, then completes both four-panel stacks. Accepted paths, dashed intent, cached target markers, known blocker outlines and empty overlay contents after deselection are checked. Actual blocked and resumed-route screenshots were inspected.

The independent production check passes version 0.13.0 menu/guide, local SQL/WebAssembly, absence of the development harness, older nighttime and 147-job example imports, all three guide images and 768-pixel guide width. No page errors, console warnings, failed requests or external requests were observed. A paused-yard sample averaged 16.67 ms per frame (60 fps); it is not a large-factory performance guarantee. The final 94-file source/test fingerprint and byte-matched deployed assets are recorded in the release package. The example remains a compatible v0.8 save rather than a newly generated v0.13 yard.

## Version 0.14 named rail location checks

Thirteen focused simulation cases cover centerline projection, analytic curve/tangent and turnout branch selection, actual centered intervals across five-meter panels and reversed descriptors, open ends/planned gaps, ambiguity at points and geometric crossings, transactional validation, case-insensitive names, edits/deletion without logistics side effects, legacy imports, reloads, missing recovered anchors and removed neighboring span panels. The isolated browser flow passes create/edit/reposition/delete through controls, real rendered marker picking, duplicate name rejection, escaped text, SQL, save/reload and the 768-pixel inspector with no errors. Final frozen suite and publication results follow after wider checks.

The frozen implementation passes **270/270** fresh sequential simulation tests in **169.77 seconds**, with no failures, cancellations or skipped cases. The suite ran with a 384 MB JavaScript heap cap, before the integrated browser pass. All 97 frozen source/test inputs are fingerprinted and remain unchanged.

The final integrated browser suite passes with no page or console errors, covering all 21 register/viewport combinations and the existing rail construction, cargo support, routing, assembly, work ownership and diagnostic flows. The named-location flow verifies actual track/marker picking, centered length, edit/reposition/delete, duplicate rejection, escaped labels, linked register IDs, SQL, save/reload and a 768-pixel inspector. Actual gameplay screenshots were visually inspected; labels retain readable screen size across zoom and concise anchor distances.

The independent production check passes version 0.14.0 menu/guide, local SQL/WebAssembly, absence of the development harness, older nighttime and 147-job example imports, a named-location save import with linked inspector and SQL, all three guide images and 768-pixel guide width. No page errors, console warnings, failed requests or external requests were observed. The paused-yard frame sample averaged 16.67 ms (60 fps), not a large-factory performance guarantee. The compatible example remains the prior v0.8 save. Final source/test fingerprints and byte-matched production assets accompany the release package.

## Version 0.15 batch rail work and small crews

Focused checks cover two-panel straight and six-panel curve buffer ownership, save/reload between installs, cancellation before pickup and between panels, two-excavator and forklift/excavator pipelines, active-staging cancellation, supply receiving before construction, exact panel inventory, dedicated helpers, ordinary paving with its helper and finishing/prefetch, manual/rest/shift preservation, and safe outward pedestrian escape from a newly placed buffer. Crew routes retain actual operators and collision checks.

Integration debugging found and corrected a route-preview/runtime speed mismatch, an unvalidated flipped forklift staging dock, a nonstraight fork withdrawal, stale crew paths touching the resting buffer, an idle installer blocking the next boom sweep, mutually blocked walking helpers, and automatic work overlooking dedicated helpers. Failed route checks are throttled; no extra machines or workers are created. The initial six rail crew scenarios pass before the broad regression run. Wider checks also exposed an overbroad helper-yield pause affecting ordinary paving, which is now restricted to mutual blockage between different crew machines, and a mixed reverse/forward source approach causing repeated excavator turns. Rail pickup now uses a clear approach, stationary alignment and explicit forward entry; saved approaches retain that handoff.

The cancel-and-resume check found an intermediate panel reserving a hypothetical new buffer resting bay even though the batch buffer was already physically resting elsewhere. Staging now keeps the actual shared buffer pose and checks that obstacle, instead of reserving another bay. The resumed curve completes without duplicate panels.

An older-save regression removes the new approach fields and recreates the former mixed-gear route before save/reload. The machine then physically stops, reapproaches, aligns and enters forward without changing stock or equipment coordinates. That case and canceled-curve resumption pass together; final broad verification uses 103 frozen source/test inputs.

The first complete frozen run passes 289 of 292 cases and identifies two issues in older developed-yard scenarios: helper-distance sorting referenced the delivery pickup before initialization (affecting mixed arrivals and the larger base), and a legacy rail placement could not initialize its staging route. The delivery pickup is now computed before helper selection. The rail route correction and a fresh final full run follow; the intermediate result is not a release validation pass.

The developed-yard rail failure was a prospective dock check rejecting its own automatically assigned, idle rigger at the future placement dock. The preview now excludes only that helper while it plans the later laying pose; the helper physically walks to the source edge before the lift, and actual motion and boom guards still include every person. Manual helpers and unrelated workers remain obstructions.

After both corrections, the final frozen full suite passes **292/292** tests in **248.28 seconds**, with no failures, cancellations or skipped cases. Test files run sequentially with a 384 MB JavaScript heap cap. All 103 source/test fingerprints are retained; the browser pass runs afterward in a separate process.

The subsequent browser pass caught the diagnostic export retaining its old version label. Only that metadata literal changed to 0.15.0; all three diagnostic tests and TypeScript pass again. The simulation-run and final-input manifests record this single label difference. Full simulation behavior is unchanged; the final browser and production passes validate the release label.

The existing automatic-work interface check also caught a changed field label for ordinary paving. Its inspector retains **Automatic machine**; only explicit two-machine crews use **Dispatch**. This is a display-label correction in main.ts, covered by the final integrated browser pass and recorded alongside the diagnostic metadata difference.

The final integrated browser suite passes with no page or console errors and all 21 register/layout combinations. New checks cover two distinct machines, operator exclusion and one-helper-per-machine validation, preserved edits during live updates, clickable actor IDs, explicit and default dispatch, legacy adjacent straight groups, helper release, SQL and actual Save/reload controls. The 768-pixel inspector fits; the crew panel screenshot was visually inspected.

The independent production check passes version 0.15.0 menu/guide, local SQL/WebAssembly, no development harness, older nighttime and 147-job example imports, named-location and support-crew save imports with SQL, all three guide images and the 768-pixel guide. There are no page errors, console warnings, failed requests or external requests. A paused-yard sample averages 16.67 ms per frame (60 fps), not a large-factory performance guarantee. The exact verified nine-file build is published on the existing Site; the example remains a compatible v0.8 save. Track recovery #7 is not implemented in this checkpoint.

## Version 0.16 delivery recovery

Focused simulation checks pass: safely retained load/crew/reservation and immediate empty-carrier departure, manual cargo movement and resume, paused save/reload, transfer takeover rejection, safe clearance, durable warning deduplication, real fork withdrawal, fixed-rail-stack aligned reapproach with every executed sweep checked, occupied final dock warnings through actual unloading, and invalid pause/severity metadata rejection. The exact creator save is unavailable; these are equivalent physical reproductions rather than a claim to inspect their particular STK-0074.

The full frozen regression run passes **301/301** tests in **264.55 seconds**, with no failures, cancellations, or skipped cases. Browser/production results follow below after verification. Source/test inputs are frozen before the broad run; processes run sequentially with a 384 MB Node heap cap.

The integrated browser pass succeeds with no page or console errors and all 21 register/layout combinations. New checks reject takeover during a real lift, pause a real loaded carry, preserve the load/reservation/operator across Save/reload, drive through actual floor input, resume to exact stock and one invoice, and retain linked warning-only filtering through live updates and reload. Both new screen captures were visually inspected.

The independent production check passes version 0.16.0 menu/guide, the paused loaded-delivery save and recovery controls, warning-only Activity and SQL severity, older nighttime and completed 147-job example imports, named-location/support-crew imports, local SQL/WebAssembly and all three guide images. No page errors, console warnings, failed requests or external requests occur. A paused-yard sample averages 16.66 ms/frame (60 fps); this is not a large-factory performance guarantee. TypeScript and the nine-file production build pass.

## Version 0.17 rail work corrections

Focused checks cover continuous nearby helper walking during a real 50 m collection trip, immediate unloaded automatic-to-manual reassignment, preserved loaded staging handoff, latest group and later child priorities, nearby automatic vs explicit distant dispatch, connected modern 5 m plans, curve-to-straight grouping, unrelated footprints, older separate-group import, true four-panel carry/shared support and individual installation, capacity-limited curve stacks, all six panels prepared while the installer is unavailable, cancellation before/after pickup and whole-batch cancellation, save/reload, inventory conservation and no duplicate material demand. TypeScript passes. The full frozen sequential suite follows, capped at a 384 MB Node heap; browser checks run separately.

The new cancellation checks include immediate save before another tick, shared-stack cancellation/resume, and cancellation between supported setdown and tool withdrawal. A six-curve sequence prepares all steel first, cancels/resumes a staged panel across reload, then physically installs every panel. It reproduces an obstructed buffer dock caused by another prepared stack and requires an accessible resting-place alternative. Two traffic checks reproduce a stale mutual escape and an immobilized blocker, retaining cargo and destinations while checking gradual movement and actual clearance. The unchanged full starter-base scenario also completes after that correction.

The final frozen run passes **329/329 regressions** in **250.34 seconds**, with no failures, cancellations or skipped tests. All 115 recorded source/test/config inputs remain unchanged. Processes run sequentially with a 384 MB Node heap cap; browser verification runs afterward.

The final browser suite passes all 21 register/viewport combinations with no page or console errors. Actual controls override an active unloaded automatic crane, assign one crew to four connected component layouts, resume a canceled child from the whole-work inspector, render all four carried panels, and preserve crew/load/ownership through Save/reload. Component inspectors link their shared parent instead of repeating two-machine selectors. The new gameplay captures were visually inspected.

Independent production checks pass the version 0.17.0 menu/guide, whole-run crew and loaded-batch save import, rail staging SQL, prior recovery/location/support-worker saves, warning filtering, nighttime and completed 147-job example imports, local SQL/WebAssembly, guide images and 768-pixel guide width. There are no page errors, console warnings, failed or external requests. A paused-yard sample averages 16.67 ms/frame; this does not establish arbitrary-factory performance. The example remains the compatible v0.8 save and was not regenerated.

## Version 0.18 boxed rail stock

The user screenshot identifies an enclosed reserved rail source; the actual user save was not available. Equivalent regressions obstruct the old corner/end rigging points, surround the first reserved stack with three outer rail stacks and a diesel corner, and verify real operator/rigger pickup and a conserved fallback reservation. Static checks protect incoming and queued relocation footprints while retaining dense, maximum-height slab storage.

Relocation checks cover excavator and forklift pickup, support-worker/operator participation, actual lifting/carry/lowering/withdrawal phases, rotated curved steel and handed variants, exact source ownership, cancellation while queued/rigging/carried/supported, and carried/supported save import. A lowered panel stays reserved until the tool withdraws. The browser scenario clicks the actual relocation button and destination ground, assigns equipment through the existing work control, and reads the completed relocation from local SQL.

The final storage regression also reserves the entire footprint of a queued relocation: a truck places its parcel in an alternate clear cell, rather than inside that future stack. Supported relocation material remains exclusively reserved until the tools withdraw.

Final verification: **350/350** fresh regressions pass in 292.10 seconds, with 120 frozen source/test inputs unchanged. The final integrated browser run passes actual relocation-button and ground clicks, inherited equipment assignment, physical completed relocation, exported fixture, local SQL, existing rail/construction/delivery controls, and all 21 register width checks. Browser page errors and error logs are empty. Heavy simulation and browser checks run sequentially with a 384 MB Node heap limit. Production verification and deployment are recorded separately after they complete.

Independent production verification passes the 0.18.0 menu/guide, relocated stock save and inspector control, relocation SQL columns, prior delivery recovery/whole-run crew/batch/location/support-worker saves, nighttime and completed 147-job example imports, local SQL/WebAssembly and all three guide images. Page errors, browser warnings, failed requests and external requests are empty. The same tested nine assets deployed successfully at 20:11 UTC. A paused-yard sample averages 16.67 ms/frame; this is not a large-factory performance claim.


## Native stockyard traffic recovery — v0.20.6

All **456/456** sequential simulation/native-host tests pass in **321.09 seconds**, including the full starter-base scenario and new regressions for checked reverse departures, safe clearance by active empty equipment, persistent yielding across save/reload, manual-control protection, and alternative slab docks after construction changes the geometry. Node runs with a 384 MB heap cap. Both TypeScript builds pass.

The packaged Apple Silicon app passes its real native GPU/bridge integration in **8.66 seconds**, with a sampled **416.5 MB** peak under the 45-second/2 GB watchdog. A private copy of the reported yard physically unloads and stores all twenty slabs in 208.4 simulated seconds, with existing stock unchanged. In the installed app, EQ-0429 backs clear and reaches the train; leave the real yard paused and saved. Private gameplay data stays outside the repository and release.


## Stacked rail material — v0.20.7

All **478/478** sequential simulation/native-host tests pass in **311.09 seconds**, including the larger starter base, every rail material unloaded by road/forklift and rail/excavator into one eight-layer footprint, finite overflow, payload/deck limits, old partial manifests and a saved active lift. Retain the 384 MB Node heap cap and unchanged source/test inputs during the final suite. Both TypeScript builds pass. Multi-car regression quantities are raised to continue exercising separate cars; top-up expectations follow actual three-panel crane loads and eight-piece storage. The example retains its established aisle layout.

The native headless renderer/UI/interpolation check passes **3,621 assertions** in **3.04 seconds**, with a sampled **337.1 MB** peak. It measures actual geometry for all six rail material types on dirt, paving and flatcar decks, plus the telescoping forklift mast through 500 interpolation frames. All eight-layer stacks are 2.845 meters high and keep their footprint. The carriage stays supported through a 4.24-meter lift. The packaged Mac app passes real GPU/bridge integration in **9.14 seconds**, with a sampled **358.5 MB** peak under the 45-second/2 GB watchdog. All native checks use isolated test data; private saves and captures stay out of the release.


## Switch tools and recovered rail stacks — v0.20.8

The actual-button native switch regression checks convergence → straight → curve → convergence → divergence, selected indicators, and identical preview/placement arguments (58 checks). General UI, Creative UI and manual-control checks pass. New simulation regressions cover Creative and physical recovery merging, anonymous supplier layers, eight-high overflow, handed curves, module types, finite-yard atomic refusal, active/reserved staging exclusions, actual stack-top lowering, material conservation, save/reload, and recovered identity reuse in installation. Existing rail recovery and multi-panel staging regressions remain in place.

The complete sequential suite passes **491/491** tests in **308.51 seconds**. A final import guard for carried rail layer metadata is then verified with **54/54** recovery, recovered-stack, multi-panel staging and native-service tests in **19.55 seconds**; the larger **208/208** rail/receiving subset also passes. Only that import guard and its new regression were added after the complete suite began. Both final builds pass. Native checks pass 58 switch-button, 23 recovery UI and 3,621 stack-geometry assertions. The final packaged GPU/bridge check passes in **8.61 seconds**, sampled **366.1 MB** peak, under the 45-second/2 GB watchdog. The current private Creative save imports and remains untouched during verification.


## Keyboard focus — v0.20.9

A headless native regression opens the real rail-location form and reproduces its separate-viewport focus. It checks root LineEdit and TextEdit editors, held WASD/Q/E, unhandled game shortcuts, a modal whose editor has lost focus, and resumed camera/shortcut behavior after closing. Headless physical-key state is injected at the polling seam; the production frame handler, focus lookup and UI dialog are used directly. Before the fix three assertions fail. Afterward **13/13** pass; the existing camera **44/44** and UI **11 registers/10 inspector types** checks also pass. Each uses the 45-second/2 GB watchdog with no simulation service or GPU. Simulation code is unchanged.

Both final TypeScript builds pass. The packaged GPU/bridge integration passes in **9.70 seconds**, sampled **390.2 MB** peak, under the 45-second/2 GB watchdog with a temporary yard. Install build 212 after preserving the real Creative yard; its save stays byte-identical to the private pre-install checkpoint.


## Native owned shunting and empty collection — v0.21.0

The complete suite passes **530/530** sequential simulation/native-host regressions in **321.97 seconds**, using a 384 MB Node heap cap. Authenticated service tests use localhost access and isolated temporary yards. Existing supplier-invoice checks now distinguish purchase invoices from newly recorded locomotive time charges. Both TypeScript builds pass.

New regressions cover the full receive–release–shunt–unload–assemble–park–collect workflow; pulled and pushed car poses; physical runarounds and direction changes; selected later-car unloading before earlier cargo; multiple original orders in a collected empty consist; ordinary construction of the seven-panel exit and buffer recovery; save checkpoints and corrupt operation records; turnouts occupied by actual axles; nose overhang without chassis collision bypass; owned locomotives in inbound/pedestrian/equipment traffic; and permanent track gaps after recovering commissioned replacement steel.

Final native checks pass **37 UI**, **23 renderer**, and **47 authenticated command-bridge** assertions. The command bridge uses real dispatched actions, snapshots, imports, inspectors, SQL and isolated save files. Actual long physical movement is covered by the simulation workflow rather than fabricated render poses. The final self-contained Mac package passes real GPU/bridge integration in **8.63 seconds**, with a sampled **400.6 MB** memory peak under the 45-second/2 GB watchdog; simulation continues while its window is unfocused. The visible mainline extends beyond the new supplier and pickup departure positions.

Install build 213 only after preserving the previous application and private paused yard. The real save imports successfully and remains byte-identical before and after installation/reopening. Test data, private saves, backups, logs and captures are excluded from the release. Remaining schematic inherited-track replacement and external crew/coupling/fueling limits are documented in the native walkthrough and in-game help.

A final driver-availability guard is added after that full suite: refuse a new dispatch until its driver is on site, on duty and free from conflicting work. Once accepted, a movement finishes safely even if the shift ends during boarding or lever work; the driver then disembarks for home transport. All **26/26** focused operations, operation-validation, rail-safety and workforce regressions pass in **2.74 seconds** after this change, including off-site refusal and the real shift-end completion/disembark sequence. Both final builds pass; repeat the native authenticated bridge and exact packaged GPU check with the guard included.

The final guard-inclusive native bridge passes all 47 assertions, and the exact rebuilt package passes GPU/bridge integration in 8.63 seconds at sampled 400.6 MB. Install this final package with its matching simulation bundle; reopening again preserves the paused private save.


## Rail editing and buffer-stop lifecycle — v0.21.1 (#38, #40)

The final frozen-source sequential suite passes **548/548** tests in **313.94 seconds**, with the 384 MB Node heap cap. Both TypeScript builds pass; the browser build retains its existing bundle-size advisory. New regressions cover instantaneous Creative stop recovery, finite-space atomic refusal, original identities and opening-asset accounting, exact opposing turnout connections including the divergent tail, surplus convergence stops, generic recovery dispatch, stop reuse, saved work, occupied and reserved rail, and physical mounting rechecks before lowering and fastening. Secured stops still obstruct sparse train routes.

Creative receiving/return test fixtures now provide a real finite salvage bay for the removed opening stop; their intended unloading stockyards stay first in the allocation order. An initial broad run loaded the previous invalid 2 × 2 m fixture before its correction and failed those fixture setups. All 14 affected operations/validation checks pass after the correction, and the complete 548-test suite is then repeated successfully against the frozen revision.

Native verification passes **222 assertions**: 49 rail-recovery UI, 62 switch/buffer UI, 37 shunting UI, 26 freight UI, 13 keyboard focus, and 35 real UI/authenticated-command bridge checks. The bridge opens the actual review controls, confirms preview is read-only, commits recovery, checks stock identities, reinstalls the same stop, purchases a delivered stop, checks its Railway register row and saves only inside a temporary test directory. The review dialog uses compact clickable IDs and a fixed action footer; a bounded GPU capture is inspected for readability. Loose legacy stops remain recoverable, and depleted stop stock is omitted from the outstanding register.

The exact final self-contained Mac package passes GPU/bridge integration in **8.68 seconds**, sampled **401.3 MB** peak, under the 45-second/2 GB watchdog. Background simulation, pause, normal work planning, local SQL/save/diagnostics, Creative building/rail placement and identity-preserving curve-plus-stop recovery all work in that package. The private yard imports successfully; its file remains byte-identical throughout isolated verification and installation. Tests, recordings, captures and private saves are excluded from the release.
