# Publication

Version 0.18.0 is published privately at https://plant-01-starter-yard.lukacslacko.chatgpt.site.

The editable game lives in this starter-yard directory. The Site repository is a separate, build-only checkout at `../../work/plant01-publish` relative to this directory, with its own `.openai/hosting.json` and Git metadata. It contains only `dist/` and the hosting manifest. Do not upload the full game project or the private design documents when updating that Site.

The Site identity is `appgprj_6ac1ff4c01388191b1d9d0dba709095e`. Reuse it; do not create a replacement. The successful build-only source commit for version 0.18.0 is `9cce70816598808aa801bf8aed7274bf3988b151`.

For an update, follow the Sites hosting skill to open the existing build-only checkout, build and test the editable game, replace the checkout's `dist/` with that build, inspect its file list, and publish through the same private Site workflow. Keep credentials in process memory/stdin only. The game requires no server secrets, cloud database, or external connectors.

Browser state is local to each browser and origin. Publishing an update keeps saves on the same Site origin. A local-server save must be exported and imported to transfer to the hosted origin.

The initial full-project publication request was rejected by automatic approval review because the upload included source and private design documents beyond the requested playable artifact. A verified nine-file build-only payload was subsequently approved and published. No design notes or saved games were included in that payload.

## Version 0.3 deployment

The final version 0.3.0 deployment succeeded on October 4, 2026 at 08:46 UTC, preserving the existing private Site and origin. The published payload contains only the built game, local SQL runtime, illustrated guide, and preview images. Source, design notes, saved yards, and development captures were excluded.

The release replaces automatic carrier unloading with purchased site equipment and hired workers, and corrects motion, train geometry, ground contact, and storage. Fifty regression tests, integrated browser checks, and the production build check passed before the final upload. Existing saves migrate on this same origin.

## Version 0.4 deployment

Version 0.4.0 deployed successfully on October 4, 2026 at 11:30 UTC on the same private Site and origin. Deployment ID: `appgdep_6ac238b89c648191a46a827032718c8d`. The verified ten-file archive contains only nine built game/guide assets and the hosting manifest. Private source, design notes, examples, and test captures remain in the downloadable local package.

This release adds right-hand lanes, coordinated carrier departures, worker and machinery clearance, routes with fewer turns, and physical panel/buffer handling. Eighty-six regressions, browser interaction checks, and the final production check passed. A newly generated example completed 145 construction jobs and all 19 deliveries with balanced inventory. Version 3 imports include a physical handoff for forklift rail jobs that need an excavator under the new workflow.

## Version 0.5 deployment

Version 0.5.0 deployed successfully on October 4, 2026 at 13:44 UTC on the same private Site and origin. Deployment ID: `appgdep_6ac258196fc481918f15eb4e62e6a379`. The payload contains the nine built game/guide assets and hosting manifest. Source, private design notes, saved yards, and development captures remain in the local package.

This release adds per-machine work roles in the Equipment register and inspector, with safe completion of current work before switching. Slab paving now uses aligned pickup, continuous load poses, supported setdown, tool withdrawal, and worker finishing. Freight reach changes continuously before lowering. Active handling lanes reserve future loads and keep conflicting deliveries clear. Existing version 4 saves keep their material records and default to All work.

All 109 regressions, the integrated browser suite, strict TypeScript validation, and production checks passed. The regenerated example contains 145 completed construction jobs, two physical refueling jobs, and 19 completed deliveries, with balanced material and fuel records.

## Version 0.6 deployment and public source

Version 0.6.0 deployed successfully on October 4, 2026 at 15:11 UTC on the same private Site and origin. Deployment ID: `appgdep_6ac26ca29b7c8191aca4f5186280853d`. The verified payload contains the nine built game/guide assets and hosting manifest. The deployed build is the same production build tested locally.

The complete editable project is published separately at [lukacslacko/factory_game](https://github.com/lukacslacko/factory_game), publicly under the MIT license, as explicitly requested. It includes source, tests, documentation, design grounding, accepted visual references, guide, previews, and the completed example. Builds, local saves, diagnostic captures, workstation configuration, and credentials are excluded from Git. GitHub CI runs simulation tests, TypeScript, and the production build.

Before publication, all 141 regressions, the final integrated browser suite, strict TypeScript validation, and the production check passed. The fresh example completed 145 construction tasks, two physical refueling jobs, all 18 work groups, and all 19 deliveries, with material and fuel records balanced. This release adds diagnostic exports, sortable/filterable linked registers, hierarchical/manual work assignment, equipment parking, worker shifts and bus commutes, more complete obstacles, rail recovery, stable traffic yielding, and smooth work-arm animation.

## Version 0.7 visual update

Version 0.7.0 deployed successfully on October 4, 2026 at 17:10 UTC, on the same private Site and origin. Deployment ID: `appgdep_6ac2888e996081918e06b70e5e6ef34d`. The payload remains the nine built game/guide assets and hosting manifest. The public MIT repository is updated with the corresponding source and actual gameplay previews.

The visual pass follows the accepted detailed-grid A/matte-miniature B concepts: closer perspective, neutral light and reflections, refined industrial models, material textures, restrained grid/seams, and clustered ground cover. Integrated browser, physical/contact/animation, 62 model-geometry assertions, three diagnostic tests, TypeScript, production and Retina checks pass. The simulation core and save schema are unchanged; the 141-test v0.6 simulation baseline and balanced example remain applicable and are recorded as baseline results, not a newly executed full simulation run.

## Version 0.8 operations update

Version 0.8.0 deployed successfully on October 4, 2026 at 20:32 UTC on the existing private Site and origin. Deployment ID: `appgdep_6ac2b7b4792c81919a2dd1d679c79584`. Source commit: `242478de8ac2090d014275d7e4940e39701194a7`. The verified payload contains nine built game/guide assets plus the hosting manifest. It matches the final locally tested production build; source, design notes, examples, diagnostic captures and credentials are excluded from the Site.

The release adds independent slab finishing/prefetch, early receiving assistance, departing empty carriers, a real-time calendar and labor clock, a reproduced steering correction, persistent worn dirt paths and surface preference. Physical dock/crew deadlocks and redundant slab-route planning were corrected. A large-yard ground texture stall found during production verification was fixed and checked against the maximum supported wear map.

All 167 simulation regressions pass, including the complete-base save/reload and material/fuel audits. Final integrated browser, maximum-map renderer, TypeScript/build and production checks pass. The fresh example completes 145 construction tasks, two physical refueling jobs and 19 deliveries with balanced materials and fuel. Source and documentation are published separately in the public MIT repository. The local package includes the exact deployed build, example and validation records.

## Version 0.9 shared procurement and terrain fixes

Version 0.9.0 deployed successfully on October 4, 2026 at 21:25 UTC, preserving the existing private Site and origin. Deployment ID: `appgdep_6ac2c42707f88191b15bb743c5bc8814`. Source commit: `64605856db792baa1af8ab5d1c3c2e99966c6cf4`. The nine built assets plus hosting manifest match the verified production build. Source, design notes, examples, diagnostic captures, and credentials are excluded from the hosted payload.

Mixed catalog lines share physical freight carriers or crew buses. Packing previews and item/quantity weights explain road and rail choices. Dedicated equipment and utility deliveries retain their existing physical operations. Ground self-shadow artifacts and coplanar gate overlap are corrected, and scenery clearing no longer relocates unrelated vegetation. All 175 simulation regressions, integrated browser checks, and production checks pass. The existing balanced example remains a verified prior-release save; it was not regenerated for this release. The public MIT source and local downloadable package retain source, documentation, previews, and validation records separately from the private Site.

## Version 0.10 supported cargo and staged construction

Version 0.10.0 deployed successfully on October 4, 2026 at 22:48 UTC, preserving the existing private Site and origin. Deployment ID: `appgdep_6ac2d7baac988191b436e14685167d8a`. Build-only source commit: `9a77979aa92d8cf05192c836d8cd29c30b21bf03`. Its nine built assets and hosting manifest match the final locally verified production build. Source, design notes, examples, diagnostic captures, and credentials remain excluded from the Site payload.

Forklift cargo rests on the working sections of both fixed fork extensions, and the carriage retracts for travel. Automatic work offers a multi-checkbox dropdown in both equipment views. Shed kits now pass through physical staging, anchors, individual member lifts, positioning, and worker fastening with an assembly ladder before the completed building appears. Partial construction survives saving and can be recovered after cancellation. Two clearance regressions found during verification were fixed without bypassing collisions.

All 189 sequential simulation regressions, integrated browser checks, TypeScript/build validation, and independent production checks pass. Actual forklift and partial-shed gameplay captures were visually inspected. The existing balanced example remains a compatible v0.8 save, checked in production and not regenerated for this release. The public MIT source and downloadable project include implementation, documentation, previews, and validation records separately from the private Site.

## Version 0.11 single-machine automatic dispatch

Version 0.11.0 deployed successfully on October 5, 2026 at 12:57 CEST, on the same private Site and origin. Deployment ID: `appgdep_6ac3827720c48191b5dc0dd9b3d087f3`. Build-only source commit: `30198869bcc5f2e7c08f0d04e444dba225286ea2`. Its nine built assets and hosting manifest match the final locally tested production build; source, design notes, saves, diagnostics and credentials remain excluded from the Site.

A whole construction work order now keeps one automatic machine across its child tasks. A freight carrier similarly keeps one machine across receiving lifts. Independent orders stay parallel; safe handoffs and explicit assignments remain available. Saved ownership and legacy active tasks are preserved, and linked work inspectors identify the machine. Inspector assignment controls no longer push IDs outside the panel.

All 204 sequential simulation tests, integrated browser checks, TypeScript/build and independent production checks pass. The existing compatible example remains a verified prior-release save rather than a newly generated yard. Source, documentation, gameplay captures and validation records are updated separately in the public MIT repository and downloadable package.

## Version 0.12 railway construction checkpoint

Version 0.12.0 deployed successfully on October 5, 2026 at 15:21 CEST, preserving the existing private Site and origin. Deployment ID: `appgdep_6ac3a42abdd8819197f50ff07e6fbf3e`. Build-only source commit: `d871c3d1771581c189b5610ff8fcec615faf9a38`. The nine verified production assets and hosting manifest match the final locally tested build. Source, design notes, examples, saved yards, diagnostics and credentials remain excluded from the Site payload.

The release adds physically procured six-panel quarter-turns and seven-panel turnouts, grid-connected endpoint planning, material/weight previews, canonical construction sequencing, safe canceled-work resumption, a linked Railway register and SQL topology, and worker-operated manual switch levers. Gauge is measured from the rendered inner rail-head faces. Real end-to-end procurement found and corrected loaded stock-face withdrawal and final-turn obstructions without disabling collisions.

All 246 sequential regressions, integrated browser checks, TypeScript/build and independent production checks pass. The real browser playtest constructs thirteen connected panels, relocates the original buffer, operates a switch with a worker and preserves it through Save/reload. Actual gameplay and isolated geometry-fixture captures are distinguished in the documentation. The compatible prior-release example is retained and checked in production. The complete source and validation records are updated separately in the public MIT repository and downloadable package.

This completes only checkpoint 1. The creator will test it before authorizing further work. Shunter, driver, engine shed, additional terminal buffers, tanker handling, tanks, pumps, piping, gauges and valves remain gated todos. Supplier trains retain their original route, the additional turnout exit is labeled uncapped, and recovery of the new track assemblies remains a todo.

## Version 0.13 loaded delivery routing and equipment intent

Version 0.13.0 deployed successfully on October 5, 2026 at 17:13 CEST, preserving the existing private Site and origin. Deployment ID: `appgdep_6ac3be749f2c8191b209802ffc11c44c`. Build-only source commit: `a0e217c86ca20616c17d3ed45d0ab46d33720402`. The nine verified built assets and hosting manifest match the final locally tested build byte for byte. Source, design notes, examples, saves, diagnostics and credentials remain excluded from the hosted payload.

The reproduced eight-curved-panel rail delivery now completes into two stacks of four, including reload of its blocked top-up state. Actual loaded machine poses correct conservative clearance rejection without bypassing collision checks. Saved detours physically return to storage, active rail staging supports reject unrelated top-ups, and rail pickup entry checks both gears. Selected equipment shows its accepted route, dashed destination intent when no path is active, target marker and known blocker outline; the inspector links related actors and records.

All 257 fresh sequential simulation regressions, integrated browser checks, TypeScript/build and independent production checks pass. The compatible v0.8 example remains a prior-release save verified in production. Source, documentation, actual gameplay previews and validation records are updated separately in the public MIT repository and downloadable project. GitHub issue #21 is closed as completed; further railway and fluid checkpoints remain gated for creator approval.

## Version 0.14 named railway locations

Version 0.14.0 deployed successfully on October 5, 2026 at 17:41 CEST, preserving the existing private Site and origin. Deployment ID: `appgdep_6ac3c5159ea881919cdcfee824dc161f`. Build-only source commit: `9cb1446433d8d9315b34c94af4dcb2e12418386c`. The nine verified built assets and hosting manifest match the final locally tested build byte for byte; source, design notes, examples, saves, diagnostics and credentials remain excluded from the Site.

The release adds virtual named loading, unloading, transfer and parking destinations on actual installed rail, editable centered lengths and anchor offsets, track-following world guides and readable selectable labels, linked dense records, repairable missing-track references, SQL and compatible saves. These designations create no material, physical signage or traffic reservation. Supplier trains retain their original berth. Parent issue #22 has twelve native sub-issues reusing the existing engine, driver, shed, buffers and recovery work; named-location issue #25 is completed. The next reception/shunting checkpoint awaits creator playtesting and approval.

All 270 fresh sequential simulation regressions, integrated browser checks, TypeScript/build and independent production checks pass. Production checks import a named-location yard as well as the older nighttime and v0.8 completed example, and exercise linked inspection and SQL. Source, documentation, actual gameplay previews and validation records are updated separately in the public MIT repository and downloadable project.

## Version 0.15 batch rail work and small crews

Version 0.15.0 deployed successfully on October 5, 2026 at 17:31 UTC on the existing private Site and origin. Deployment ID: `appgdep_6ac3dececa94819181b40b8e53eec09d`. Build-only source commit: `81d7523019f4d97f23c48bf52e18bc4ac59ccda9`. The nine built assets and hosting manifest match the locally verified production build. Source, design notes, saves, diagnostic captures and credentials remain excluded from the Site.

Connected rail work keeps its one real buffer aside until the final panel. Optional two-machine crews physically stage one panel ahead, then install it with a separate excavator; assigned support workers stay nearby, perform ground work and retain normal shifts and manual control. The release preserves default single-machine dispatch. Cancellation, stock conservation, safe withdrawal and saved source approach gear changes are checked. Track recovery #7 remains the next separately reviewed checkpoint; #29 records this prerequisite under parent #22.

All 292 simulation regressions pass. The subsequent diagnostic-version and ordinary-work display-label corrections pass their targeted and integrated browser checks. The final browser suite passes all 21 register/layout combinations and the new crew controls, linked references, SQL, save/reload and narrow inspector. Production checks pass with no page errors, warnings, failed requests or external requests, including older saves and support-worker SQL. The example remains the compatible prior v0.8 save. Source/test fingerprints, the two metadata/display-label deltas and byte-matched assets are retained in the downloadable package. Public source and documentation are published separately under MIT.

## Version 0.16 loaded delivery recovery and warnings

Version 0.16.0 deployed successfully on October 5, 2026 at 18:44 UTC on the same private Site and origin. Deployment ID: `appgdep_6ac3efe662ac8191a22447b131ef7711`. Build-only source commit: `2312b5d8a372bb137018b37ede202e7580309f6b`. The nine verified built assets plus hosting manifest contain no source, save, diagnostics, design documents, or credentials.

The release adds safe pause/manual-drive/resume for supported delivery loads, collision-checked final-heading reapproaches around fixed stock, durable blockage Inbox todos and Activity severity filtering. All 301 frozen simulation regressions, integrated browser checks with actual floor input and Save/reload, TypeScript/build, and independent production checks pass. The compatible completed v0.8 example is retained. The creator's exact blocked save was not available; equivalent fixed-rail-stack and occupied-destination cases validate the fix. Broader blocker yielding #17 and railway recovery #7 remain open.

## Version 0.17 connected rail work and bulk staging

Version 0.17.0 deployed successfully on October 5, 2026 at 19:33 UTC, preserving the same private Site and origin. Deployment ID: `appgdep_6ac3fb76d0288191a0bf2d1ee82713e2`. Build-only source commit: `141783b6ffe0d8c5787b1ea9100999c87185055f`. The nine verified built assets plus hosting manifest match the exact locally tested production build; source, design notes, saves, diagnostics and credentials remain excluded.

Connected pending rail plans share one whole-work crew assignment. Helpers accompany pickup/travel, explicit assignments supersede unloaded automation, and real capacity-limited stacks are prepared ahead of installation. Shared steel, canceled reservations and safe handoffs persist through save/reload. Curve buffer resting places include the crane's actual route and final pose. A reproduced mutual traffic escape is corrected through physical checked withdrawal.

All 329 frozen regressions, the final integrated browser suite, TypeScript/build and independent production checks pass. Browser controls verify four-panel carrying, whole-run assignment and child-component resume. Production verifies loaded-batch import/SQL and older saves, with no runtime errors or external requests. The completed example remains a compatible v0.8 save. Issues #31–#33 track these corrections; broader blocker behavior #17 and railway recovery #7 remain open. Public MIT source and the downloadable project are updated separately.

## Version 0.18 accessible rail stock

Version 0.18.0 deployed successfully on October 5, 2026 at 20:11 UTC on the same private Site and origin. Deployment ID: `appgdep_6ac4045da6f481919c7bc69c7a9b12fb`. Build-only source commit: `9cce70816598808aa801bf8aed7274bf3988b151`. Saved version: `appgprj_6ac1ff4c01388191b1d9d0dba709095e~appgver_f40026ccbbf88191abb76d9f7e85e4e5`. The nine built assets match the exact locally checked production build. Source, design notes, diagnostics and credentials remain outside the deployment.

The release adds safe exposed-edge rigging, reachable matching-source reservations and unloaded fallback, physical outer-panel relocation, and protection for future storage footprints and lifting faces. Final verification passes 350 fresh regressions, the integrated browser controls, and independent production save/SQL/guide checks. The completed example remains the compatible v0.8 147-job save. Refresh the existing game page to load the update; the same-origin save remains available.

## Native rail recovery — v0.20.4

Publish the Apple Silicon Mac app and source for installed track recovery. Native inspector controls recover individual panels or remaining complete curve/turnout assemblies through real crew, fastener, crane and storage work; attached buffers are prerequisites. Creative recovery checks finite storage atomically. Real downstream islands can be rejoined, and the physical network supports closed loops with exact opposing endpoint connections. #7 is completed; #24 retains the combined insert-switch preview and reconstruction workflow, and #38 retains the broader rail-control overhaul. Browser hosting remains at 0.18.0 and is unchanged by this native release.

Validation: 445 sequential simulation/native-host tests, both TypeScript builds, 23 headless native UI/renderer checks, and the self-contained GPU/bridge integration pass. Keep the previous installed app and user's save as private temporary backups; no private gameplay data is published.

## Native information-panel fix — v0.20.5

Fix the upper-right close control by rejecting empty record IDs, preventing missing supplier-locomotive references on road deliveries from reopening a dismissed panel. Postpone live register and inspector refresh during a real button press so releases are not lost. The focused real-input regression passes all 13 checks and fails against the old UI; native UI, freight and recovery checks pass. The packaged GPU/bridge integration passes in 17.31 seconds with a sampled 449.1 MB memory peak. Publish Apple Silicon Mac build 208 and source; the browser deployment remains 0.18.0.


## Native stockyard traffic recovery — v0.20.6

Publish Apple Silicon Mac build 209 and source. Tight stockyard departures now use a checked straight reverse maneuver before continuing forward. Automatic empty equipment clears loaded traffic and retains its assignment while waiting to return; manual driving and active lifting remain protected. Construction refreshes slab-setting docks blocked by completed structures. The complete 456-test suite, both TypeScript builds, and packaged native GPU/bridge integration pass. Install the verified bundle and confirm the reported forklift reaches its train in the real yard, then leave it paused and saved. Previous app and save backups remain private. Browser hosting remains at 0.18.0.


## Native stacked rail material — v0.20.7

Publish Apple Silicon Mac build 210 and source. All six rail panel/module types stack eight high (2.85 meters with spacers), using bounded physical footprints and actual vehicle payload, deck-length and equipment lift limits. Existing saved freight retains its original parcel arrangement and current lift. Add stock capacity/height in the inspector and telescoping forklift mast support for high-stack handling. All 478 simulation/native-host regressions, both builds, the native headless geometry/UI check and packaged GPU/bridge integration pass.

Save and pause the creator's current yard at D1 13:54:29 through the actual game controls, then close it. Retain private backups of both yard and previous app. Install the verified bundle and reopen: the existing yard appears behind its normal Continue dialog, paused and byte-identical to the checkpoint. Browser hosting remains 0.18.0. No private gameplay data is published.


## Native direct switch tools and recovery stacking — v0.20.8

Publish Apple Silicon Mac build 211 and source. Separate diverging/converging switch tools remove the leaked convergence setting that blocked straight rails and curves. Creative and physical recovery fill compatible finite stockyard stacks up to eight high, with original rail identities retained per layer. Keep private saves, diagnostic records and captures outside the source and package. Preserve the currently open creative yard with a paused checkpoint and previous-app backup before installation.

Verified 491 complete sequential regressions, 208 focused handling tests, and 54 final layer-validation/recovery/native-service tests; both builds; 58 switch, 23 recovery UI and 3,621 geometry assertions. Final packaged integration: 8.61 seconds, sampled 366.1 MB peak. The last save-import guard and its regression are checked after the complete suite begins. Install and publish the same self-contained build, leaving the private Creative yard paused and unchanged.


## Native keyboard focus — v0.20.9

Publish Apple Silicon build 212 and source. Typing railway location names or using other text editors/popups no longer pans or orbits the yard or activates game shortcuts. Camera controls resume after closing the dialog. Verify the new native focus regression plus existing camera/UI checks and packaged native integration. Keep private gameplay data outside the package and repository; preserve the live yard during replacement.

Final verification passes 13 focus checks, 44 camera checks, the general UI smoke check, both builds, and packaged GPU/bridge integration (9.70 seconds, sampled 390.2 MB). The install preserves the real paused save.


## Native owned shunting and empty returns — v0.21.0

Publish Apple Silicon build 213 with the next railway operations checkpoint. Add a real seven-panel eastern reception exit, a separate factory access switch, owned diesel shunters and assigned operators, supplier locomotive handoff/departure, selected-car moves to named installed-track locations, chosen-stockyard unloading and separately requested empty-car collection. Keep stable freight identities, continuous bogie-following movement, driver boarding/manual lever visits, save/SQL records, fuel and waiting costs. Railway → Rail help explains the workflow in paragraphs.

Keep the browser deployment at 0.18.0. Native movements are serialized; this checkpoint handles flatcars. Inherited track replacement, external service-crew coupling and locomotive fuel transfer remain schematic; general reconstruction, tanker operation, parallel reception, direct shunter driving and an engine shed remain tracked work. Preserve the creator’s paused private save and previous application, run bounded isolated native checks, and exclude private data and captures from source and release.

Final verification: 530/530 sequential regressions; both builds; 107 new native UI/renderer/bridge checks; packaged GPU/bridge integration at 8.63 seconds and sampled 400.6 MB. Install and reopen the same tested build, preserving the paused private save byte for byte and retaining the previous application. Publish source and the self-contained Mac archive to v0.21.0; no browser deployment.

The last driver availability/shift-end guard is verified by 26 focused regressions after the complete suite, both rebuilt TypeScript bundles, 47 authenticated native checks, and the final packaged GPU run (8.63 seconds, sampled 400.6 MB). The published build includes this guard.


## Native rail editing and buffer recovery — v0.21.1

Publish Apple Silicon Mac build 214 with the shared rail editing workflow and buffer-stop lifecycle fixes for #38 and #40. Panel/assembly recovery and stop installation/recovery have a read-only review listing real identities, material masses, finite stockyard destinations and operational constraints. Railway includes focused stop purchasing and stock/order/work links; in-game help explains normal work versus Creative edits. Exact turnout connections recover redundant stops, Creative recovery is immediate and atomic, recovered stops are reused, and occupied or reserved rail is protected during handling. Mounted stops retain their geometry and train-stopping behavior instead of adding fictitious straight panels.

Final verification: 548/548 sequential simulation/native-host regressions, both builds, 222 native UI/focus/authenticated bridge assertions, inspected GPU review capture, and the exact packaged GPU/bridge check (8.68 seconds, sampled 401.3 MB). Preserve the closed private yard unchanged and retain the previous application as a private temporary backup before installation. Publish source and the self-contained Mac archive to v0.21.1. Browser hosting remains v0.18.0; private saves, logs, test fixtures and captures are excluded from the package.

## Railway program — native v0.22.0

The [v0.22.0 native release](https://github.com/lukacslacko/factory_game/releases/tag/v0.22.0) publishes the completed railway program under #22: explicit possessions and manual steel recovery, connected named/parallel reception, protected concurrent routes, physical service crews/couplers/brakes/hoses, qualified drivers, owned shunter controls and can refueling, constructed engine sheds/home bays, contained-liquid tankers, and requested empty collection with waiting charges. Automatic combined turnout insertion (#24) is canceled; ordinary replacement remains recover-then-build. Fluid-transfer construction remains separate #8–#12 work.

The final full suite passes 589/589 tests in 341.25 seconds. Both builds, 422 native assertions and the exact packaged GPU/authenticated-service integration pass. Build 215 is installed with a previous-app backup and byte-identical private save. The self-contained Apple Silicon archive contains the native app, runtimes, assets and license notices; private saves, source workspaces, test fixtures, recordings and development captures are excluded. The browser Site remains v0.18.0.

## First fluid system — native v0.23.0

Publish Apple Silicon build 216 and source for #8–#12. The native Process register provides physical 30,000 L tank construction, rail tanker transfer pumps, supported DN100 pipes/elbows/tees, worker-operated manual valves, and actual flow/connected tank-level gauges. Real hose operations, 2 kW power demand, route and movement interlocks, finite conserved pipe/tank contents, linked IDs, procurement/labor records, SQL and atomic saves make this a usable first transfer system. Process → How to use explains construction and operation; the bundle includes a public synthetic example yard in `Contents/Resources/examples/first-fluid-transfer.json`.

Verification passes 621 complete regressions, 31 final focused regressions plus the authenticated fluid-command test after read-only report polish, both builds, 290 counted native assertions, the general UI check, and exact packaged GPU integration (8.72 seconds, sampled 446.1 MB). Preserve the closed private yard unchanged, retaining a private backup of it and the previous app. Verify installed source hashes and signature. The release excludes private saves, logs, development captures, source workspaces and test fixtures; the explicitly public example save is included. The browser Site remains v0.18.0. Pressure hydraulics, reactions, drainage/disposal and tank-to-tank transfer are later work.

## Worker assignment and action clearance — native v0.24.0

Publish Apple Silicon build 217 and source for #16 and #17. Automatic workers are ranked by actual reachable walking routes with explicit crews, qualifications, shifts and active work preserved. Construction, load handling and parking share physical action-envelope recovery, real operator recruitment, protected manual/active loads, alternate loaded slab approaches, and persistent linked warnings after 20 simulated seconds. Native inspectors expose blockers and release controls; Activity and Inbox offer Warnings only. Physically impossible layouts remain safely stopped with actionable reasons. See [the guide](worker-assignment-and-clearance.md).

Verification passes 653/653 frozen-input sequential regressions in 548.28 seconds, both builds, 140 counted native assertions and the general UI check. The actual authenticated bridge exercises physical parking recovery and save/reload. The exact package passes GPU/bridge integration in 9.65 seconds at sampled 466.2 MB, including unfocused real-time simulation. Install only with the game closed, retain private previous-app/save backups, verify signature/source hashes, and leave the save byte-identical and app closed. The browser Site remains v0.18.0.

The self-contained archive excludes private saves, logs, test fixtures, captures and source workspaces. `Plant-01-macOS-arm64-v0.24.0.zip` SHA-256: `10277300c2ef8778e7e49963bac19758a343658f29c1c29798152761f2938353`.

## Site services, audio, and daylight — native v0.25.0

Publish Apple Silicon **build 218** and public MIT source for #14/#15, #35, #20 and #39. Equipment uses visible conserved service cans and qualified operators to drive near accessible drums; dry machines and supported loads receive explicit stationary emergency service. Paid road collection reserves real material, uses owned crew/equipment for loading, and drives retiring mobile equipment onto low-loaders. Original asset IDs, off-site history, fuel, cancellation and actual invoices remain accounted for. Seventeen original MIT sounds provide bounded spatial vehicle/work/notification playback and local category controls. Sunlight, sky, shadows, readable full-moon nights and connected lamps follow simulated time. See [the service guide](site-services.md).

Verification passes **696/696** frozen-input sequential regressions, both builds, **461** native assertions and the general UI check. The exact package passes actual authenticated service controls (6.17 seconds, sampled 328.5 MB) and general GPU/bridge integration (7.65 seconds, sampled 386.5 MB), including unfocused real-time simulation. Sound checks use silent playback; subjective listening remains a playtest item. Actual synthetic-yard screenshots are reviewed and included in source, while private data, tests and captures stay outside the app.

Install the same verified, ad-hoc-signed macOS 14+ app with private previous-app/save backups. Verify every candidate file, the installed signature, and 70 repository source/asset hashes; retain byte-identical private saves and leave the app closed. The archive includes its runtimes, assets, notices, public fluid example and five player guides. The browser Site remains v0.18.0. Close the completed service issues and the already accepted #18/#19; leave #13 explicitly deferred.

Release: [v0.25.0](https://github.com/lukacslacko/factory_game/releases/tag/v0.25.0). `Plant-01-macOS-arm64-v0.25.0.zip` is **151,628,998 bytes**, SHA-256 **`c5753e46957995c506ffb73863a259c8b9b970d9a5c8ce55f6b6d3d57888e465`**. Measured results and scope limits are recorded in `native/tests/site-services-verified-results.json`.


## Underground electrical circuits — native v0.26.0

Publish Apple Silicon **build 219** and public MIT source for #13. The approved buried-cable concepts become real low-voltage construction: a utility-installed 16 kW cabinet, delivered 50-meter reels, physical operator/excavator/engineer work, neighboring conserved spoil, lifted/restored paving, terminations and testing. Rooted light-base branches share supply capacity; individual lamps and tanker pumps require commissioned circuits. Safe cancellation, physical cable recovery, local saves, linked warnings, dense Electrical registers and SQL retain every meter and work phase. See [electrical operations](electrical-operations.md).

The complete frozen suite passes **725/725** tests and both builds. Actual native UI/render/bridge and exact packaged checks are detailed in `native/tests/electrical-verified-results.json`. Preserve the existing running game and install the new app alongside it as **Plant 01 v0.26.0.app**. Public archives keep the usual **Plant 01.app** name and exclude private data, test fixtures and development captures. The browser Site remains v0.18.0.

Release: [v0.26.0](https://github.com/lukacslacko/factory_game/releases/tag/v0.26.0). `Plant-01-macOS-arm64-v0.26.0.zip` is **152,135,261 bytes**, SHA-256 **`899b5e9b05af5fdedc29eaba16b73fedb0a0e0af648384ff5f8c6948788caae8`**. All 91 packaged source/asset hashes match the verified repository; the installed versioned app matches the signed candidate.


## Whole trenches, junctions, and electrical selection — native v0.27.0

Publish Apple Silicon **build 220** and public MIT source for #45, #46 and #47. Excavator buckets gather, lift clear, swing and tip soil above ground with smooth synchronized motion. Entire electrical runs are excavated before continuous reel-fed cable pulling, connections, whole-run backfill and commissioning. Procured junction cabinets create rooted branches sharing the station's 16 kW capacity. Cancellation, safe equipment handoff, recovery and saves preserve real physical progress and materials.

Players can rename electrical assets and select each circuit endpoint either through searchable name/ID/type lists or directly on the map. Locate selected, explicit source/destination highlights, stable clickable IDs, named registers and SQL retain useful context. Existing named railway locations remain the railway naming system. See [electrical operations](electrical-operations.md).

Verification passes **739/739** frozen-input sequential tests, both builds and **688** counted native assertions. The exact package passes electrical GPU/bridge integration in 43.71 seconds and general integration in 9.12 seconds, including unfocused real-time simulation. Actual public-fixture digging and selection screenshots are reviewed. Install the signed app alongside the existing running version as **Plant 01 v0.27.0.app**, leave it closed, and preserve the running game and private saves untouched. The public archive retains the normal **Plant 01.app** name, excludes private data and development tests/captures, and includes the updated electrical guide. The browser Site remains v0.18.0.

Release: [v0.27.0](https://github.com/lukacslacko/factory_game/releases/tag/v0.27.0). `Plant-01-macOS-arm64-v0.27.0.zip` is **152,151,760 bytes**, SHA-256 **`11c67a8c4881074e39304007bda951c9e34dc676e32edacfc53bf90dcf0acc61`**. All 91 packaged source/asset hashes match the verified repository, all 161 installed files match the signed candidate, and the installed signature verifies.


## Idle equipment clearance — native v0.27.1

Publish Apple Silicon **build 221** and public MIT source for the reported EQ-0015 / WRK-0030 stale reservation. Finished equipment work and idle states loaded from saves release obsolete movement reports without moving actors, removing real obstacles or weakening active collision checks. Verify the actual original yard privately, retain its backup and the previous app, and reopen the updated game with that yard paused. The full frozen suite passes **743/743** tests, both builds pass, and native clearance plus exact packaged general integration pass **49 counted assertions**. Private exports, diagnostic entries, logs and test captures are excluded from source and release. The browser Site remains v0.18.0.

Release: [v0.27.1](https://github.com/lukacslacko/factory_game/releases/tag/v0.27.1). `Plant-01-macOS-arm64-v0.27.1.zip` is **152,152,642 bytes**, SHA-256 **`b19815edff38a0a25363740c537d23b3662ac91fa4602bc9d6d1c14b53fcf436`**. All **93** packaged source/asset files match the repository; all **161** installed files match the signed candidate. The original yard is reopened in the patched app, saved and left paused after 9.45 simulated seconds, with actor poses, materials, jobs, costs and electrical state preserved.


## Move existing material to storage — native v0.28.0

Publish Apple Silicon **build 222** and public MIT source. Physical stacks expose **Move to storage…**, with all or some available units, automatic reachable storage or a searchable selected stockyard. A parent work order covers every real lifting task and accepts one inherited equipment assignment. Owned equipment, an operator and ground crew carry the material; partly used cable reels and drums keep their contents and identity. Finite compatible stacking, rail orientation/handedness, actual full-batch mass, source/destination reservations, safe carried-load cancellation, saved phases and full generic-load clearance remain enforced. See [storage moves](storage-moves.md).

Verification passes **787/787** full-suite checks. After a final isolated new-storage capacity correction and added regression, **53/53** focused checks and **19/19** native-host checks pass, along with both builds. The exact package passes **112** storage workflow assertions and **30** general native checks. GPU captures are reviewed using isolated synthetic data. All **95** packaged source/asset files and **163** installed files match, and the installed ad-hoc signature verifies. Install the versioned app alongside the running older game, leave the new app closed, and preserve the current session and player saves untouched. The release excludes private data, tests and development captures and includes the new storage guide. The browser Site remains v0.18.0.

Release: [v0.28.0](https://github.com/lukacslacko/factory_game/releases/tag/v0.28.0). `Plant-01-macOS-arm64-v0.28.0.zip` is **152,166,031 bytes**, SHA-256 **`f470ccd0dbdad3e04005e51805c483c1cca9383cd725aa998fc4ed5dc63b6766`**. Measured results and scope limits: `native/tests/storage-moves-verified-results.json`.


## Loaded delivery storage approaches — native v0.28.1

The complete final suite passes **796/796** sequential simulation/native-host regressions in **616.26 seconds**, with a 384 MiB Node heap cap and all **202** recorded inputs unchanged throughout verification. Both builds pass; the browser build retains its existing bundle-size advisory.

Publish Apple Silicon **build 223** and public MIT source for storage-delivery planning recovery. Loaded trips account for the final dock turn; machines physically retract from their pickup extension before planning, can make a swept short reverse withdrawal and aligned forward reapproach, and can choose a compatible alternate face of the same reserved footprint. Shaped-rail stacking bearing, real cargo, operator, destination ownership and saved gear/path remain intact. Failed searches are throttled; impossible layouts retain their actual obstruction rather than moving arbitrary stock.

The final signed package passes the exact GPU/authenticated-service integration (**30 assertions**, 14.79 seconds, sampled 560.8 MB renderer memory), and a private packaged replay stores all seven original panels in 86.25 simulated seconds, including atomic mid-retreat save/reload. The original blocking reel remains unchanged and no extra purchase occurs. After a private backup and safe old-app shutdown, the actual yard is reopened in the new version; its stuck three panels reach storage, the next batch starts, and the game is saved and left paused at 1× after 39 simulated seconds. Private exports, recordings, diagnostic scripts and captures are excluded from source and archive.

The installed **Plant 01 v0.28.1.app** matches all **163** tested bundle files and all **95** packaged repository source/asset files; its ad-hoc signature verifies. Keep the previous application and original private save. The public archive retains the usual **Plant 01.app** name and includes offline guides and the public fluid example. The browser Site remains v0.18.0.

Release: [v0.28.1](https://github.com/lukacslacko/factory_game/releases/tag/v0.28.1). `Plant-01-macOS-arm64-v0.28.1.zip` is **152,166,889 bytes**, SHA-256 **`165388004a36da7bf13a6191d8bd04a6bba73d7552fd134d8c3565ac56214d17`**. Measured verification: `native/tests/delivery-reapproach-verified-results.json`.
