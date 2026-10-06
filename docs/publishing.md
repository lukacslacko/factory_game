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
