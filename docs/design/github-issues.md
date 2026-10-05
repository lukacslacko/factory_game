# GitHub request index — October 5, 2026

Twenty individual issues track the creator's new feedback, the preceding railway/chemical infrastructure request, and two supporting todos already deferred in v0.12.0. Nineteen are open. The curves/turnouts construction record is closed as implemented in v0.12.0; the creator's playtest can identify further defects.

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
