# Worker assignment and action clearance

Native v0.24.0 addresses [#16](https://github.com/lukacslacko/factory_game/issues/16) and [#17](https://github.com/lukacslacko/factory_game/issues/17).

## Automatic crew selection

When a new task needs a worker, the simulation compares eligible workers by the length of a reachable walking route to the actual work point. Receiving uses the rigging position beside the load; construction uses its real standing positions; operators approach the machine's boarding step; fuel service approaches the drum. A worker on the other side of a wall is not considered closer merely because their straight-line distance is shorter. Unreachable candidates are skipped.

Worker roles, duties, shifts, boarding transitions, transport and current physical assignments remain constraints. Dedicated support workers and explicitly selected workers keep precedence. Existing jobs do not continuously trade crew members as distances change. A small, short-lived continuity preference favors a nearby worker who just helped the same equipment or work order. Stable IDs settle equal choices; work priority and queue order remain unchanged.

The assigned worker and equipment IDs remain clickable in the native inspectors. Saved active assignments resume as assigned. The short-lived preference used to choose between otherwise idle nearby workers is recalculated after loading; it does not alter active assignments.

## Clearing a blocked action

Clearance checks cover the action's actual occupied space, including final turns, load reach and setdown, construction component footprints and parking approaches. Existing vehicle travel, stock access and rail staging recovery continue to use their physical clearance checks.

An idle automatic worker can walk to checked clear ground. An idle, empty automatic machine can request a reachable available operator, who physically walks to its boarding step and climbs into the cab. It can drive to a checked refuge only with its actual operator seated and fuel available. Its temporary clearance reservation prevents parking or new automatic dispatch from immediately sending it back into the same operation. Each blocker receives its own retry, so a manually controlled blocker cannot prevent another automatic blocker from being asked to move.

A loaded slab handler that cannot make its final turn can try a different checked working face, carrying the same supported load along the real route. It does not force another active machine to abandon its work.

The simulation preserves active physical work, suspended loads, delivered cargo, off-duty workers and direct player control. A machine without an operator cannot drive itself away. These cases wait safely and explain what needs attention. Fuel workers displaced while carrying a can return to the actual filler before pouring; they cannot transfer fuel remotely.

## Finding and resolving warnings

After 20 continuous simulated seconds, an unresolved action creates one persistent **Action blocked** warning. Retries and changing blockers update the same notice. The record survives save/reload and resolves when clearance succeeds or the work ends. Legacy delivery handling warnings also resolve after recovery.

Use **Warnings only** in **Activity** or **Inbox** to hide informational entries. The menu’s controls help also summarizes automatic assignment and clearance. Warning toasts take priority over ordinary information. Open the affected work, equipment or worker inspector to see the action, blocker IDs, elapsed wait, working location, reason, and **Inspect**/**Locate** controls. Related IDs in historical notice details remain clickable after the live clearance ends.

For a manual worker, use **Return to automatic duty** in their inspector. For manually driven equipment, use **Return to automatic work**, or move it to clear ground yourself first. A fixed stock pile needs a different path or physical relocation. An impossible maneuver—such as turning a loaded forklift between shed posts with no safe refuge—requires changing the layout or moving equipment deliberately. Clearance never teleports an actor, deletes cargo, or forces a vehicle through an obstruction.

This release closes the tracked improvement with safe automatic recovery and actionable fallbacks for the covered operations. It is not a guarantee that every arbitrary factory layout can be untangled automatically. New reproducible failures should include an exported save or rolling diagnostic log and the linked action/blocker IDs.
