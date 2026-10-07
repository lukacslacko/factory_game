# GitHub request index — October 5, 2026

The first twenty individual issues track the creator's new feedback, the preceding railway/chemical infrastructure request, and two supporting todos already deferred in v0.12.0. Nineteen are open. The curves/turnouts construction record is closed as implemented in v0.12.0; the creator's playtest can identify further defects.

These are tracking records. Further implementation remains subject to the creator's review and approval of a bounded chunk. Open design choices are recorded in the issues rather than silently decided.

## Railway

- [#1 — Build curved railway panels and turnouts](https://github.com/lukacslacko/factory_game/issues/1) — completed in v0.12.0
- [#2 — Construct an engine shed for the owned shunter](https://github.com/lukacslacko/factory_game/issues/2)
- [#3 — Purchase and physically deliver an owned diesel shunter](https://github.com/lukacslacko/factory_game/issues/3)
- [#4 — Hire and assign a shunter driver](https://github.com/lukacslacko/factory_game/issues/4)
- [#5 — Move and couple tanker cars across the factory railway](https://github.com/lukacslacko/factory_game/issues/5)
- [#6 — Order and install independent buffer stops on new railway ends](https://github.com/lukacslacko/factory_game/issues/6)
- [#7 — Physically recover the new track assemblies](https://github.com/lukacslacko/factory_game/issues/7)

Independent buffers and recovery of new track assemblies are supporting todos from the release, rather than additional chemical requirements invented for this request.

## Chemical infrastructure

- [#8 — Build physical storage tanks for the first chemical plant](https://github.com/lukacslacko/factory_game/issues/8)
- [#9 — Build a railway tanker transfer-pump station](https://github.com/lukacslacko/factory_game/issues/9)
- [#10 — Construct piping between railway pumps and storage tanks](https://github.com/lukacslacko/factory_game/issues/10)
- [#11 — Install readable gauges for tank and pipe operation](https://github.com/lukacslacko/factory_game/issues/11)
- [#12 — Install and operate valves that control fluid routes](https://github.com/lukacslacko/factory_game/issues/12)

## New feedback

- [#13 — Lay buried electrical cables through excavation and backfilling](https://github.com/lukacslacko/factory_game/issues/13)
- [#14 — Show manually carried diesel cans in workers' hands](https://github.com/lukacslacko/factory_game/issues/14)
- [#15 — Move equipment close to the fuel barrel before refueling](https://github.com/lukacslacko/factory_game/issues/15)
- [#16 — Use walking distance when automatically assigning workers](https://github.com/lukacslacko/factory_game/issues/16)
- [#17 — Detect action blockers, clear them safely, and notify on prolonged blockage](https://github.com/lukacslacko/factory_game/issues/17)
- [#18 — Match the C concept art more closely: contrast, color and vegetation](https://github.com/lukacslacko/factory_game/issues/18)
- [#19 — Run the game outside the browser with reliable saves and background simulation](https://github.com/lukacslacko/factory_game/issues/19)
- [#20 — Add game sounds and audio controls](https://github.com/lukacslacko/factory_game/issues/20)

## Visual reference

The original [C Planning View concept image](C-original-planning.png) is uploaded to the public repository and embedded in issue #18. It is concept art, not a gameplay screenshot, and should not be confused with the later toy-style option labeled C. The accepted detailed A/matte B refinements remain relevant. Keep true perspective, dimensional/grid-aligned assets, direct worker control, dismissible guidance and Condensed records; the old mandatory right-side work list was rejected.

## Open choices retained

- Electrical trenches may be prepared as a complete route, cell by cell, or another coherent sequence. The creator has no strong preference. Excavated spoil occupies neighboring space and must remain physically accounted for.
- The desktop implementation technology is not selected. Reliable file saves and continuing simulation while unfocused/minimized are the requested outcomes.
- The sound set, prolonged-blockage notification delay and the first fluid-model specifications require further design decisions.

## Authorized playtest bug fixes

- [#21 — Fix curved-panel stack top-up route rejection and show selected equipment intent](https://github.com/lukacslacko/factory_game/issues/21) — **completed in v0.13.0**; the creator explicitly authorized this fix after the initial issue list. It is separate from the broader blocker auto-clearing design in #17.

## Reception and shunting parent request — October 5, 2026

[**#22 — Receive multi-car trains and shunt freight to named factory rail locations**](https://github.com/lukacslacko/factory_game/issues/22) is the parent, with twelve original native GitHub sub-issues and the additional crew prerequisite #29. It remains open while separately reviewed checkpoints are completed.

| Issue                                                        | Scope                                                             | Relation                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [#25](https://github.com/lukacslacko/factory_game/issues/25) | Named loading, unloading, transfer and parking positions          | Completed in v0.14.0; closed after verification and publication.                   |
| [#23](https://github.com/lukacslacko/factory_game/issues/23) | Through reception track and second commissioned main-line turnout | New; depends on safe reconstruction and buffer handling.                           |
| [#24](https://github.com/lukacslacko/factory_game/issues/24) | Insert turnouts into existing straight runs                       | New; depends on #7 real recovery.                                                  |
| [#26](https://github.com/lukacslacko/factory_game/issues/26) | Multiple physical cars per incoming train                         | New; stable per-car cargo/geometry and reception fit.                              |
| [#27](https://github.com/lukacslacko/factory_game/issues/27) | Coupling/uncoupling and line-locomotive drop-off/collection       | New; real securing, detachment and clear exit.                                     |
| [#28](https://github.com/lukacslacko/factory_game/issues/28) | Parallel reception tracks and safe concurrent traffic             | New; follows a reviewed single-track loop.                                         |
| [#7](https://github.com/lukacslacko/factory_game/issues/7)   | Recover track assemblies                                          | Existing prerequisite reused.                                                      |
| [#6](https://github.com/lukacslacko/factory_game/issues/6)   | Independent physical buffer stops                                 | Existing prerequisite reused.                                                      |
| [#3](https://github.com/lukacslacko/factory_game/issues/3)   | Purchase/deliver diesel shunter                                   | Existing issue reused.                                                             |
| [#4](https://github.com/lukacslacko/factory_game/issues/4)   | Hire/assign real shunter driver                                   | Existing issue reused.                                                             |
| [#5](https://github.com/lukacslacko/factory_game/issues/5)   | Shunt freight and tanker cars to named locations                  | Existing issue broadened to ordinary freight, without duplicating tanker movement. |
| [#2](https://github.com/lukacslacko/factory_game/issues/2)   | Engine shed and locomotive parking                                | Existing issue reused.                                                             |

Pump station #9 will use the same named transfer references later. Completing the current named-location checkpoint does not implement supplier routing, multi-car consists or shunting, and does not authorize those subsequent chunks automatically.

## Authorized batch rail work prerequisite

[#29 — Batch rail buffer handling and small staging/installation work crews](https://github.com/lukacslacko/factory_game/issues/29) is completed in v0.15.0, linked under #22. The release passes 292 simulation regressions and final browser/production checks. It precedes the separately reviewed recovery checkpoint #7.

[#30 — Recover loaded delivery equipment blocked by fixed stock and surface warnings](https://github.com/lukacslacko/factory_game/issues/30) tracks the creator's STK-0074 forklift report, safe manual recovery, automatic alignment reapproaches, and durable warning filters. Related broader yielding work #17 stays open; this does not implement railway recovery #7.

Issue #30 is completed in published v0.16.0 with 301 regressions and integrated browser/production verification. #17 retains the broader construction/parking scope.

- [#31 — Rail support workers should accompany machines during pickup travel](https://github.com/lukacslacko/factory_game/issues/31).
- [#32 — Manual rail crews must replace existing automatic assignments](https://github.com/lukacslacko/factory_game/issues/32).
- [#33 — Batch and pre-stage rails for the whole connected work run](https://github.com/lukacslacko/factory_game/issues/33), including one crew assignment for connected 5 m plans.

Issues #31–#33 are completed in published v0.17.0, verified by 329 frozen regressions and final browser/production checks. Shared-stock cancellation/resume, one whole-work crew, and full six-curve installation are included. Broader blocker behavior #17 and railway recovery #7 remain open.

## Boxed-in rail stock — October 5, 2026

[#34 — Recover rail pickup blocked by surrounding stock and preserve storage access](https://github.com/lukacslacko/factory_game/issues/34) tracks the screenshot-reported stockyard deadlock, safe exposed-edge rigging, accessible-source selection, physical outer-panel relocation, and prevention of sealed pickup faces. It is a separate fix from broad traffic deadlocks #17 and deferred railway recovery #7.

Issue #34 is implemented in published v0.18.0, validated by 350 regressions and browser/production checks. Remaining general traffic cases in #17 are not claimed complete.

## First fluid system — v0.23.0 (#8–#12)

Complete the five connected issues as one usable native checkpoint: physical tank construction (#8), railway tanker transfer pumps (#9), supported piping/elbows/tees (#10), actual flow and uniquely connected tank-level gauges (#11), and worker-operated manual valves (#12). The creator authorized #8–#10 and allowed #11/#12 in the same chunk. Procurement, visible staged assembly, component identities, costs, real hose operations, conserved finite contents, operational interlocks, connected ID inspection, SQL, portable saves, and in-game help are included. Reactions, pressure hydraulics, drainage/disposal, and tank-to-tank transfer remain future work; underground cable construction remains #13. See [Fluid operations](../fluid-operations.md).
