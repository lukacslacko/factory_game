# Fantasy chemistry plant screens and interactions

Second design round, October 3, 2026, retained as interaction history. Updated October 4: Condensed is approved for records. The flat world studies were rejected; preserve the original C's angled camera, visible object height, material detail and lighting while improving grid alignment. Current [C refinements](https://chatgpt.com/space/page_340a2ce06b1c819184d8d9ef69aaf2e0) and the [records comparison](https://chatgpt.com/space/page_217117b8ea3081919e8f6eeef3dd0830) show these separate directions. The workflow proposals below remain relevant. Implementation is now authorized and a first playable starter yard has been built. The selected world treatment is approximately 80 percent of the latest A and 20 percent B, with Condensed records. Its implemented screens and limits are documented with the local game. See the [design journal](https://chatgpt.com/space/page_d863f0120e988191a039c3a7dff274c5) for confirmed decisions. Older screenshots are historical references.

## Shared appearance and navigation

Keep C's elevated angled view and visible three-dimensional object height. Explore a meaningful range: detailed industrial imagery, an intermediate miniature treatment, toy-like low-poly forms, and schematic solid models. Change geometry, component count and materials rather than only texture or color. Placed footprints, module sizes and parked machinery should visibly follow the ground grid. For the alignment comparison, the excavator's tracks and upper body are square to the grid; its arm is parked along its longitudinal axis. Smooth turnouts and the 1,435 mm rail gauge are explicit grid exceptions. Use the approved Condensed style for records: ivory surfaces, dark text, fine rules, teal accents, compact tables and short text details without realistic illustrations. The world retains contextual controls and dismissible guidance.

The proposed navigation is Site, Materials, People, Equipment, Supplies, Deliveries, Activity and Workboard. Each record has Locate or Follow where applicable. Returning to the site retains the camera and selection. Names, asset IDs and order references link across screens.

Status must use words and symbols as well as color. Tables need sorting, search, units, time filters, and a clear distinction between zero, unknown and not applicable. Opening records should preserve the current simulation speed; pausing remains an explicit control. That timing behavior is a proposal to test.

## Site and direct control

![Site and direct control](/Users/lukacs/Documents/Codex/2026-10-03/de/outputs/screen-01-site-direct-control.png)

Select a worker in the world or People screen. Clicking a reachable cell gives a movement destination; nearby cells along the route show where the worker will walk. The camera can follow the selected worker or remain where the player placed it.

Click the excavator's entry point to walk to it and enter. The context strip changes to the machine's appropriate controls. Proposed actions include travel, position the machine, choose an attachment action, select a load, lift, move and lower. The exact arm-control scheme is still open; this screen establishes personal operation without requiring a ground-level view.

Interaction is contextual rather than a mandatory sequence. A worker can inspect a drum, connect an available pump, enter machinery or move elsewhere whenever physical conditions allow. An unavailable action explains its actual condition, such as the need for a lifting attachment or an occupied access cell.

The Guide can be closed and reopened. Closing it does not cancel a job, remove available controls or block progress. Guidance can suggest a next action without requiring the previous suggestion to be followed.

Later, Plan work can describe a whole outcome: unload this vehicle into this receiving area, load these goods, or build this marked stretch of track. The player assigns resources or handles parts personally. Delegation is not locked behind completing a tutorial.

A manual takeover asks the worker or machine to reach a stable stopping point when necessary. Releasing control leaves actual equipment, cargo and work where they are. Proposed options are to resume a compatible assignment or leave the worker available. There must be no duplicated job, dropped suspended load or reset progress.

## Materials and physical storage

![Materials and physical storage](/Users/lukacs/Documents/Codex/2026-10-03/de/outputs/screen-02-materials-storage.png)

The register distinguishes Received, Installed or consumed, On hand, Reserved, Available and Incoming. Show units per material, plus batch, location and associated delivery. Received is a cumulative movement in the selected period; on-hand is a present balance. A selected time range must make opening balance explicit.

In the example, opening stock is zero, 40 slabs have been received and 16 installed. There are 24 on hand, of which 12 are reserved, leaving 12 available. Another 60 are incoming. Reserved is part of on-hand stock, not additional stock.

Incoming supplier cargo remains a separate category until physically unloaded and accepted according to the eventual receiving rules. Partial receipts record only the accepted amount. Damage, returns, recovery, losses, and stock in motion must remain distinguishable rather than disappear into a net total.

Selecting ST-004 reveals the actual stack and its location. The proposed example uses 1 × 1 × 0.2 m slabs: six stack positions, four slabs per position, 24 slabs total, a net occupied footprint of 2 × 3 m and stack height 0.8 m. Adding a 2 m access strip on all sides reserves a 6 × 7 m area. This is an illustrative game layout; actual item dimensions, permitted stacks, lifting data and machinery access will need a consistent catalog.

Store the physical dimensions and mass of an item, the structure of a stack, its allowed support and stacking, and the space needed to reach and handle it. Long rails and poles need their full length, support positions, overhang clearance and an appropriate lift. A selected item may be blocked by another item above or in front of it; retrieving it then requires real rearrangement.

Marking a storage zone does not add capacity by itself. Items require room, support, access and suitable handling equipment. Pallets, racks, containers and retaining slabs are physical objects with their own limits and installation work. Storage boundaries follow the grid. Loose piles change shape and height with contents inside those boundaries; a full bay cannot accept more. Slabs and rails retain actual stack and rack dimensions. Heavy paving slabs require suitable machinery. The screenshots are historical appearance studies; these spatial rules govern the eventual simulation.

## Workers and duties

![Workers and duties](/Users/lukacs/Documents/Codex/2026-10-03/de/outputs/screen-03-people-duties.png)

The roster connects employment or contractor status, shift, presence, current duty, immediate activity, location, capability and transport. A hired worker who is off site cannot perform site work. A duty is the ongoing responsibility; the current activity is what the worker is doing now.

Select a worker to Follow, Take control or Release control, or Assign duty. The relevant control changes with state. Personal control pauses or hands off conflicting delegated work; the same person cannot simultaneously drive the excavator and perform a remote task.

Show both expected arrival and actual arrival, plus the transport home. Missing, late and unavailable workers should have understandable states. When replacing or rescheduling a duty, preserve the associated job and make any resulting unstaffed work visible.

The example has Ana organizing receiving, Ben moving an empty drum, Mara under player control, Eli laying paving, and contractor Noor expected at 09:30. Their shift information is fictional design data.

## Equipment and vehicles

![Equipment and vehicles](/Users/lukacs/Documents/Codex/2026-10-03/de/outputs/screen-04-equipment-vehicles.png)

The equipment register distinguishes owned, hired and external vehicles. Show location, present state, operator, assigned work, attachment, available capacity, fuel and maintenance information. An incoming carrier belongs in delivery context as well as the external-vehicle view.

The selected excavator is ready, has no occupant, holds 52 of 80 liters, and has a lifting attachment. Mara is walking toward it. Readiness does not imply it can act without an operator.

Condition should be attached to meaningful components, such as engine, hydraulics, tracks, tires or lamps. A machine's service history connects parts, labor, consumables, downtime and costs. Replacing a part records the old part's disposition and the new part's installation.

The button to enter equipment directs the selected worker to its entry point. An asset-register action does not teleport a person into a cab. Equipment availability includes reach, load limits, fuel and access, not merely ownership.

## Consumables and usage

![Consumables and usage](/Users/lukacs/Documents/Codex/2026-10-03/de/outputs/screen-05-consumables-usage.png)

Separate fuel in storage, fuel already in machines, incoming fuel and consumed fuel. In the example there are 120 L in drum D-006, 52 L in the excavator tank, and 200 L in incoming drum D-007. D-005 is an empty return drum. Container identity and contents remain separate.

At 09:16, 12 L moved from D-006 to EXC-001. That reduces storage and increases the machine's tank; it is not engine consumption. Actual consumption is recorded when the equipment uses fuel. Received fuel should not be charged again as a second purchase when transferred into a machine.

The last seven completed days show illustrative usage of 28, 32, 36, 45, 39, 46 and 54 L, totalling 280 L. Filter this history by equipment, job, shift or time period. Include measurement gaps or estimates when relevant.

Other consumables include oils, lamps, tires and paint, using suitable units and replacement records. Proposed low-stock and projected-runout notifications can be configured; a projection must state its recent usage basis and distinguish usable stock from stock merely on order.

The newly delivered drum can be stored as a spare. It does not require throwing away the 120 L in the currently connected drum. A later replacement job can disconnect, move and connect the appropriate containers.

## Orders and deliveries

![Orders and deliveries](/Users/lukacs/Documents/Codex/2026-10-03/de/outputs/screen-06-orders-deliveries.png)

An order describes the commercial request; a delivery describes a physical shipment; a receipt records what actually entered the accepted stock. One order can have several deliveries, and a truck or train can carry items for multiple orders.

The example includes O-031, a truck arriving with one 200 L drum at 09:20; O-032, a truck expected with 12 electric poles at 09:27; and O-033, a train expected with 60 concrete slabs at 09:32. O-028 is a previously received delivery of 40 slabs.

The screen shows ETA and its uncertainty, carrier and vehicle, cargo manifest, current location, receiving area, crew and equipment, unloaded quantity, discrepancies and return cargo. A timeline helps identify competing arrivals and scarce unloading equipment.

Selecting the train offers access to its approach and a receiving plan. Reserving track or an unloading area only reserves a physical resource. It does not create track, clear an obstruction or move the train. An unavailable destination can keep the train waiting with a visible reason.

Empty drum D-005 is linked as return cargo for the fuel truck. Unload the new drum and load the empty only when those movements actually happen. Receipt, return completion and departure remain separate, inspectable events.

## Activity and logs

![Activity and logs](/Users/lukacs/Documents/Codex/2026-10-03/de/outputs/screen-07-activity-logs.png)

The log is the durable account of what happened. The workboard is the current account of what needs attention. They are connected views with different purposes.

Each event includes simulation time, event type, actor or source, affected quantity, unit, origin, destination, location and references to the relevant asset, material batch, order, task and document. Simple entries show only the necessary fields; expanding one reveals its supporting details.

Search and filter by entity, event type and time. Selecting an entry locates the object when it still exists, opens linked paperwork and shows related events. Archived or removed objects retain their history. Corrections should be explicit new records rather than silently rewriting the past.

Examples include a truck arriving, the player taking control of Mara, the 12 L refueling transfer and the receipt of 40 slabs. Reviewing or acknowledging an event does not change stock or complete a job.

Exports and optional read-only SQL should query the same underlying records as the interface. A real material transfer should appear once in the ledger even when several screens reference it.

## Notifications and workboard

![Notifications and workboard](/Users/lukacs/Documents/Codex/2026-10-03/de/outputs/screen-08-notifications-workboard.png)

A notification briefly explains what changed and points to a physical object or persistent task. A small toast has a short title, cargo or issue, location or ETA, timestamp, and Show on site and Open workboard actions. It can be closed without losing the underlying work.

Actionable arrivals create or update one work card per receiving job. Advance notice, revised ETA, arrival and unloading progress update that card instead of creating duplicates. Ordinary events can remain in the log without generating work. The illustrated three-column board is optional to open and can be filtered by owner, location, type or urgency.

| Column | Meaning                                                                                                          | Examples                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| To do  | Work needs an owner or a next action, including a future arrival that needs preparation                          | Receive the fuel drum; prepare a bay for 12 poles; arrange the concrete train's receiving track |
| Doing  | A person, crew or the player has taken responsibility; show active, scheduled, waiting or blocked as a substatus | Ben clearing the bay; Eli laying paving; unloading in progress                                  |
| Done   | The card's recorded completion condition has actually occurred                                                   | The 12 L refueling transfer completed; 40 slabs received                                        |

Moving or assigning a card changes organization and responsibility, not physical reality. Starting work can move it into Doing. A blocked active job remains there with an explicit reason. Actual completion moves a physical task to Done. A personal reminder can be marked done manually, clearly identified as a reminder.

Read or unread state is independent of To do, Doing and Done. Dismissing a toast changes neither. Snoozing hides a reminder until its chosen trigger but retains the task. Canceling work produces a visible canceled outcome and leaves completed work and goods where they are. Archiving a completed card preserves the linked log.

For the fuel drum, the persistent card links O-031, truck T-018, drum D-007, its assigned handler and destination. If the card is defined as the receiving-and-return job, it completes after the new drum is unloaded and accepted and D-005 is loaded for return; the scope is shown on the card. Connecting the spare later is a separate task. These scopes must be visible rather than hidden behind a generic Done button.

For the poles, the notice exposes long-item storage and lifting needs before the truck arrives. For the concrete train, it exposes receiving-track availability and unloading resources. None requires a tutorial checklist to be open.

## Boundaries for the next review

This round settles a proposed screen family and interaction language. It does not select an engine or implement a simulation. The exact controls for driving and lifting, material catalog, quantitative handling limits and rules for receiving discrepancies still need review.

The artwork includes illustrative people, values and previews. The definitions and numerical examples in this document are the reference for intended behavior. Future feedback should be appended to the design journal and reflected here without presenting proposals as confirmed decisions.

## Rail work crew controls

The parent rail work inspector offers two compact selectors: Staging equipment and Installation equipment, with an explicit save action. Both blank means the usual single-machine workflow. Current machine, operator, support-worker and stock IDs remain linked in ordinary records. Equipment registers and inspectors offer Support worker selection; worker records link their supported equipment and permit release. The current panel phase distinguishes staging withdrawal, waiting for installation crew, and actual placement.

## Loaded delivery recovery and Activity severity

The equipment inspector offers **Pause unloading & take control**, explains unsafe physical phases, and shows **Resume unloading** while paused. The world mode hint identifies the paused delivery; after reload the inspector can restore direct control of the retained operator. Manual movement uses existing floor input and collision checks. No new operator or forklift is spawned.

Activity has dense **Warnings**, **Info**, and **All** buttons with counts and a Severity column. Warnings hides routine material movement rows. IDs remain linked, and the filter survives live updates, tab changes and reload. A prolonged delivery blockage creates a linked unseen Inbox **Delivery handling blocked** todo, retained for the player's task board.

## One crew choice for connected rail work

The panel inspector links **Whole rail work**. A component-layout inspector directs the player to its connected parent; only that parent shows the two staging/installation selectors, with total panel count. Applying a crew immediately overrides unloaded automatic work; a physical pass reports a pending manual handover when its load must first be supported. Existing edits persist through live updates.

The world renders each panel in a carried preparation batch and raises the crane hook above the actual stack. Equipment cargo shows quantity; shared stock IDs and individual jobs remain linked. SQL and diagnostics include batch leader, quantity and preparation ownership IDs.
