# Move existing material to storage

Native v0.28.0 lets your own equipment return physical stock to a stockyard. Use it for partly used cable reels, fuel drums, rail panels, concrete slabs, and unbuilt kits. A move carries material already on site; it neither orders replacements nor installs a kit as a building. Recover installed infrastructure first if you want to store its components.

## Request a move

1. Click the physical stack in **Yard**, or open its linked **STK** ID in **Materials**. Choose **Move to storage…** in its inspector.
2. **Units to move** starts with all available units in that stack. Reduce it if you want to leave some behind. A drum or reel is one unit, regardless of its remaining liters or meters.
3. Leave **Destination stockyard** on **Automatic** to choose a reachable stockyard with enough space, or filter the list by name or ID and select a particular yard. Designate a stockyard first if you have none.
4. Read the preview's quantity, weight, selected yard, placement, and route-readiness line. With a free machine, operator, and support worker, it checks the actual machine's source approach, rigging access, loaded withdrawal, loaded route to storage, ground-worker access at the destination, and empty-machine withdrawal after setdown. A boxed-in pile is refused before work is created. If the required crew is absent or busy, the preview explicitly says that the route is unverified; you may still queue the work. Click **Refresh preview** if stock or access changed.
5. Click **Create move work**. The game opens the parent work order in **Work**, with individual lifting tasks beneath it.

The preview makes no changes. Creation checks space and reservations again, then reserves the selected material and its destination. Stock already committed to construction, electrical work, collection, or another move must first be released by finishing or safely canceling that work.

The source, path, and destination are rechecked as the yard changes. An occupied landing position or a new blocker can still stop an active load. The remaining access and automatic-recovery work is tracked in [site logistics and deadlock prevention #53](https://github.com/lukacslacko/factory_game/issues/53).

## Provide a machine and crew

Provide a fueled forklift or excavator with enough lifting capacity, an available **operator**, and a **builder or engineer** for ground handling. For automatic dispatch, enable **Recovery / relocation** under the machine's **Automatic work**. To choose a particular machine, select it under **Manually assign equipment** in the parent work order and click **Apply equipment to this whole work**. One parent assignment covers every lift in this move.

The operator boards and drives the actual machine. The crew approaches the stock, rigs or engages the load, lifts it, carries it to the reserved yard, lowers it onto supports, withdraws the tools, and releases it. Larger quantities use sequential lifts within the machine's capacity. Compatible material tops up a finite stack; overflow needs another clear footprint. Rails retain their orientation and handedness, with one panel handled per relocation lift.

Moving a whole single drum or reel keeps its STK ID and exact remaining contents. Nothing refills a partly used container, and empty reels and drums remain movable physical units. Recovered rail panel identities also survive relocation. Moving existing stock uses this physical sequence even in **Creative** mode.

## Follow progress or cancel

Open the parent in **Work** and expand its tasks. Each lift links its source, destination stockyard, receiving stack, assigned machine and workers, current step, and any blocking condition. Click the equipment to see its intended destination in Yard. Keep a lifting face, walking access, and a wide enough travel aisle clear. Persistent blockages appear in **Activity** and **Inbox**. The top-bar **Warnings** count opens an active warnings-only list; inspect a row to locate its work or obstruction. Missing supplies produce one persistent warning for related tasks, updated when the cause changes and resolved when work resumes.

An incoming receiving stack stays reserved until its move is secured: it cannot be moved away, collected, or consumed by another task in the meantime. A drum booked for movement is unavailable for refueling. Saving and loading preserves the load, contents, route, work sequence, and reservations.

Canceling an unlifted task releases its stock and space immediately. Canceling after pickup lets the crew safely set down and release the load at the selected storage destination. For a multi-lift move, expand its parent in Work and use **Cancel this task** on each unwanted remaining lift; completed lifts remain stored. A blocked carried load still needs a physically clear route and landing space before cancellation can finish.

Incoming delivery storage also checks its final alignment. After clearing the carrier, the machine physically retracts its supported load to the travel reach before planning the storage trip. From v0.28.1, an angled machine can make a checked short reverse withdrawal followed by a forward approach. It can try the opposite handling face while keeping the same reserved stack. This resolves recoverable turning blockages without relocating stock; an enclosed or occupied approach still waits safely with a linked reason.
