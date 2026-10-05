# Fantasy chemistry plant development proposal

Updated October 5, 2026: the creator has authorized implementation of the first playable starter yard, with no chemical production yet. The latest world art choice is approximately 80 percent A Detailed industrial and 20 percent B Simplified matte miniature; Condensed governs the records. The staged proposal below is retained as the longer-term roadmap. The current implementation and its tested limits are documented with the local starter-yard game.

Current decisions are recorded in the [design journal](https://chatgpt.com/space/page_d863f0120e988191a039c3a7dff274c5). The [current screen proposal](https://chatgpt.com/space/page_c019dc6339888191887aec4620f45b6a) develops the selected C direction, direct control and operating records. Condensed from the [records comparison](https://chatgpt.com/space/page_217117b8ea3081919e8f6eeef3dd0830) is now approved for data screens. The flat world alternatives were rejected. The October 4 refinements in [visual directions](https://chatgpt.com/space/page_340a2ce06b1c819184d8d9ef69aaf2e0) preserve the original C's angled camera, three-dimensional detail and lighting while improving grid alignment.

## Start with one complete job

The first playable target should be a small yard where the player can select a worker, walk cell to cell, enter and operate an excavator, and physically perform a branch-extension job. The player can inspect why an action cannot proceed and examine the records it produces. This job touches delivery, physical handling, labor, placement, equipment, fuel, and cost accounting in one understandable place.

Use a finite test area initially while keeping the world-coordinate model able to expand. “Infinite” can eventually mean generating and storing parts of the world as needed. This is a development shortcut, not a proposed change to the world.

Get to a small chemical process soon after the construction loop works. The early yard should prove the foundations; it should not absorb the whole project before there is anything to manufacture.

## Agree the interaction contract first

The creator has selected direct control in the C overhead view as a starting interaction: select a worker, walk between cells, enter machinery and choose the work to perform. Later, the player can give whole instructions for loading, unloading or constructing a stretch of track. Both modes must operate on the same physical actions and state. A tutorial may suggest steps but must be dismissible and must not gate free play.

A placement outline is a plan with a bill of materials and work steps. It becomes a finished object only when the physical prerequisites are met. A blueprint can repeat the plan without skipping delivery or installation.

Every blocked task should explain its specific cause and offer a way to inspect it: “No operator on site”, “Receiving area occupied”, “Pump not connected”, or “Delivery cannot reach unloading point”. Quiet, reliable operation should not generate a stream of acknowledgment buttons.

## Development stages

| Stage                           | Features to introduce                                                                                                                                                                                                                                                   | Evidence that it works                                                                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Design trials               | Refine C and the connected records screens; storyboard worker movement, entering and operating equipment, notifications and optional guidance. Set provisional grid and time rules.                                                                                     | The creator can describe how to perform and later delegate the work without a mandatory checklist.                                                                                                                |
| 1 — A physical construction job | C overhead view; select a worker, walk, enter and operate equipment; dismissible guide; physical stock footprints and handling; starter road and railway; excavator; delivered rail panels; movable buffer; fuel; IDs; job, movement and cost records; save and resume. | Personally perform the branch extension, with actual handling, buffer relocation and traceable records. Close the guide and keep playing. Resume a saved job without losing or duplicating people, cargo or work. |
| 2 — An operating base           | Concrete blocks; office and sanitary containers; worker arrivals and departures; bus service; shifts; electrical and water contractors; supply limits; lamps; barrel and pump; excavator shed; simple day and night cycle.                                              | Run several shifts with transport, lighting, welfare facilities, and fuel replenishment. A missed arrival or empty barrel produces an understandable interruption and recovery.                                   |
| 3 — First chemical production   | A small fictional process with a few materials; a reactor; storage; pipes; valves; pumps; essential sensing; input deliveries; output dispatch; basic waste handling. Expand rail handling and offer worker transport alternatives.                                     | Produce and dispatch a batch. Stopping a required utility or input visibly stops the relevant process; restoring it allows recovery without unexplained material creation.                                        |
| 4 — Managing a growing plant    | Whole instructions for loading, unloading and construction; reusable plans; standing orders; maintenance jobs; scheduling; mature workboard, records, reports and SQL; more transport choices.                                                                          | A larger plant runs through delegation while the player can take over a worker or machine and hand back control without resetting or duplicating work.                                                            |
| 5 — Weather and site services   | Rain and snow effects; seasonal work; wear and replacement; shovels and snowplows; stores; kitchen; fire brigade; environmental monitoring; fences and security.                                                                                                        | A full seasonal cycle creates useful planning decisions, including winter preparation, maintenance, and summer storage.                                                                                           |

Stages are dependency gates rather than date estimates. Their size depends on the camera, control scheme, team, and technology choices still to be made.

## Keep the first test deliberately small

For the first construction scenario, propose one excavator, one contractor crew, one panel type, one buffer stop, one unloading area, and one fuel source. A truck can deliver the excavator and a train can deliver panels. These fixed routes are a test scenario; player choice between road and rail belongs in the broader design.

Include loading, travel, unloading, placement, fastening, and departure. Represent early fastening as a crew task with time and state; individual loose bolts and a manual wrench interaction can wait for evidence that they improve the experience.

Test both bare ground and a short pre-paved obstruction. The second case verifies that removed concrete remains in a stockpile or recovery flow. Do not require concrete removal across the whole original 100 m example when the revised starting surface is unpaved.

External crews should bring the kit needed for the service they sell. A contractor's incoming excavator can arrive fueled, with an operator and a means of unloading. This avoids requiring the player to own the infrastructure that the contractor is being hired to create. Tools, consumables, and included services still appear in the records.

## Systems that should share a common foundation

| System      | Initial features                                                                                | Later depth                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Placement   | Meter grid, occupied cells, orientation, track center lines, explicit placement states          | Curves and turnouts, elevations, underground layers, clearance and access overlays |
| Jobs        | Preconditions, assigned workers and equipment, reserved materials, current step, blocked reason | Reusable procedures, priorities, recurring work, contractor scheduling             |
| Goods       | Physical deliveries, unloading, stockpiles, installed components, empty packaging               | Returns, recovery, waste streams, material quality and batch histories             |
| Transport   | Entering the site, stopping, loading and unloading, leaving                                     | Dispatch, shunting, bus and railbus schedules, congestion and larger networks      |
| Workers     | Presence, role, assigned work, working hours                                                    | Skills, shifts, welfare facilities, kitchen and site services                      |
| Equipment   | Location, ownership or hire, fuel, operator, task                                               | Attachments, servicing, oil, tires, lamps, storage and replacement                 |
| Utilities   | Connected or disconnected state, available capacity, demand                                     | Distribution networks, pumps, protection, outages, expanded supply                 |
| Chemistry   | Invented materials, inventories, a simple process, inputs and outputs                           | Temperature and pressure behavior, catalysts, monitoring, process variety          |
| Records     | Stable asset IDs, supplier orders, deliveries, job events, cost entries                         | Reports, physical signs, cost allocation, SQL and exports                          |
| Environment | Time and light                                                                                  | Weather, seasons, contamination, environmental observation and response            |

## Spatial rules to settle before content production

Use a coherent 1 m construction grid: paving seams, rectangular building bases, storage boundaries and chosen module sizes should visibly meet grid lines. Straight track centerlines sit on grid lines. The creator specifies 1,435 mm track gauge between the inner rail faces, symmetric about the centerline; do not round this to an integer number of cells. Turnouts and curves cross cells smoothly and are exempt from axis alignment. Physical component dimensions, such as pipe diameters, remain independent of the planning grid.

Workers are directed from cell to cell; smooth movement between destinations is a proposed visual treatment. Parked machinery should actually align with the grid axes. The current visual comparison shows an excavator with both tracks parallel to the straight rail, its upper carriage square to the chassis, and its boom parked in the same longitudinal plane. A grid-aligned selection rectangle around an angled machine does not satisfy this. Slewing during work and turning during travel remain possible and must respect physical space. Turnout shapes can have grid-aligned connection points while their intervening rails curve smoothly; their detailed engineering geometry remains open.

Track width, working space, storage space, and vehicle clearance should be separate concepts. Stored items retain physical dimensions, mass, stack limits and handling requirements. Storage footprints and retaining walls follow grid boundaries. Within a loose-material bay, the pile profile and height respond to quantity without crossing the boundary or exceeding safe capacity. Full bays prevent further unloading. Walls, racks and containers must themselves be delivered and installed. A designated zone creates no abstract capacity. The 2 m strip in the original example is an illustrative construction footprint, not the whole access envelope of a railway and excavator.

Keep the utility corridor and crossing accessible in the starter layout. Large items must have a receiving and lifting route. The interface should identify access problems while planning, before a delivery arrives.

## The records are part of the world model

Give each durable asset an ID at creation and preserve it through delivery, installation, movement, maintenance, and disposal. The buffer moved to the new end of the line remains the same buffer. A drum remains the same drum as its contents change.

A proposed record set includes assets, locations, people, shifts, suppliers, purchase orders, deliveries, work orders, work steps, inventory movements, utility use, maintenance events, and cost entries. Separate a material batch from its container, and a supplier order from the physical delivery it produces.

Record events as the work happens. Reports should be derived from those events so that they agree with the visible world. Keep estimated, committed, and recorded actual costs distinct. Avoid counting both an invoice and its underlying material movement as separate acquisition costs.

Later SQL access should initially query a read-only snapshot or reporting store, with a documented schema. Routine analysis should not change live simulation state. Useful questions include the cost of extending the branch, diesel consumed by each machine, recurrent failures by lamp type, and contractor time lost waiting for access.

The absence of a budget limit must survive these accounting features. Time, space, access, equipment, people, and supply capacity create the operating constraints.

## Delegation as a way to scale

The creator has confirmed that delegation is needed as the factory grows. Proposed recurring jobs and supply policies should organize the same work that can be performed personally; they do not require completing a tutorial. A reorder rule can place a barrel order at a chosen threshold; the supplier still delivers it, the excavator still unloads it, and a worker still connects it.

A maintenance plan can schedule lamp replacement; someone still obtains a lamp and travels to the pole. The player gains organizational tools as the site grows. The physical work continues to exist.

Start with simple job states: planned, awaiting resources, ready, active, blocked, completed, and canceled. Canceling work releases future reservations, but leaves already delivered goods and completed physical work in the world. Recovery and removal become explicit jobs.

## Technical principles for the later implementation

The authorized first version now uses TypeScript, Vite, and Three.js for a local browser game, with a separate deterministic simulation and sql.js reporting snapshots. The source and technical guide accompany the starter-yard deliverable. The principles below also guide later development.

Keep the simulation state independent of the camera and interface. Use clear ownership and transfer rules for cargo and materials. Update distant or idle assets only as much as needed, while preserving the events and constraints that matter. Use detailed movement and animation where the player can see or interact with it.

Make work and time resumable from the beginning. Save pending deliveries, reservations, cargo positions, partially completed jobs, and event history together. Avoid relying on an animation finishing to remember whether an item exists.

The initial technical choice targets a desktop browser and a modest operating yard, with real 3D geometry and explicit grid dimensions. Reassess renderer and simulation performance as the factory grows; this first implementation does not settle the engine choice for every future scale.

## Tests that protect the central idea

The first job should be checked for meaningful failure and recovery: missing panel, absent operator, blocked unloading point, low fuel, and interrupted work. Items must have one location and owner or custodian at a time; transfers must conserve the relevant quantity. A vehicle must not depart carrying goods already unloaded.

Test saving in the middle of unloading and relocating the buffer. On reload, work must resume consistently, with no duplicate material or cost entries. Costs must reconcile to the deliveries and work that generated them.

Test whether a player can discover a blockage from the interface without knowing the internals. Later, apply the same checks to a full chemical batch and its utility use.

## Risks to resolve through play

The largest design risk is making repeated detail demand repeated attention. Demonstrate the complete work, then offer scheduling and delegation that preserve its physical meaning.

A second risk is hiding the chemical plant behind years of construction features. Reach one complete production loop before broadening the catalog of buildings, vehicles, and consumables.

A third is building a detailed world with poor explanations. Inspection, job dependencies, and a readable history belong in the first test. They are how the player understands cause and effect.

A fourth is losing the chosen art direction while trying to reduce scope. C is the selected world direction: an elevated angled view with three-dimensional detail, depth and lighting on a flat grid. The creator rejected flat SVG world treatments. Condensed is approved for data screens; its text-first simplicity must not be imposed on the world. Direct control works in C. A and B remain possible later views.

## The next review

Play the implemented starter yard and review the construction pace, direct controls, equipment handling, access rules, stock dimensions, and Condensed registers against the selected 80 percent A and 20 percent B visual target. The included player guide separates working features from deliberate limits. After this construction version is reviewed, deepen transport and utility work and specify the first fictional chemical process; chemistry is intentionally outside the current version.

## October 5, 2026 — chemical plant checkpoints

The creator asks to begin the railway and fluid infrastructure for the first chemical plant, with one bounded implementation chunk followed by their playtest. Further chunks require their approval; recording a todo does not authorize starting it.

| Checkpoint                           | Scope                                                                                                                                                                                                                                                                       | Status / playtest gate                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1 — Curves and turnouts              | Grid-connected cardinal endpoints, 20 m radius quarter-turns made from six real curved panels, 20 m turnouts made from seven real panels at four construction stations; order, deliver, store, rig, lay and fasten each piece. Shared track geometry and endpoint topology. | Implemented in v0.12.0; published and awaiting the creator's playtest.                      |
| 2 — Owned railway operation          | Purchase and physically deliver a diesel shunter, hire a driver, construct an engine shed, add independently purchased terminal buffers, and move/couple tanker cars over the connected railway with switch and clearance rules.                                            | Todo; propose after checkpoint 1 review and wait for approval. Split further if needed.     |
| 3 — First tank and unloading station | Build a tank and a tanker transfer pump with actual foundations, component installation, delivered parts and worker/equipment tasks.                                                                                                                                        | Todo; requires approval and a useful railway handling scenario.                             |
| 4 — Fluid connections and control    | Construct piping between rail pump and tank; install valves and readable tank/pipe gauges. Conserve fluid through pumps, pipe volumes and tanks; expose flow, level and operating status in the dense registers.                                                            | Todo; requires approval. No chemical production added until this transfer loop is reviewed. |

Railway construction alone does not introduce general train dispatch. Incoming supplier trains continue using the original siding route. A turnout's extra exit is visibly uncapped until another buffer or connected continuation is constructed; do not imply that unprotected track is ready for owned train operation. The next railway checkpoint must resolve this before running a shunter there. Intermediate joints of curved panels can lie between grid lines; the whole curve's endpoints are on grid lines and face cardinal directions. This preserves real rail geometry rather than forcing 1,435 mm gauge or a curve onto integer cells.

## GitHub tracking — October 5, 2026

The creator requests individual GitHub issues for the railway and chemical infrastructure breakdown and eight further improvements. The [GitHub request index](github-issues.md) links all twenty issues, their related work and the uploaded original C concept image. Curves/turnouts are recorded as completed; the other nineteen issues are open. Electrical excavation/cabling/backfill, held fuel-can visuals, nearby refueling, distance-aware worker assignments, blocker recovery/notifications, visual fidelity, desktop saves/background operation and sounds are tracked individually. Filing these issues does not start the next implementation checkpoint.

## Authorized playtest repair — version 0.13

Before the next railway checkpoint, repair the creator's eight-curved-panel delivery stall and show selected equipment's accepted route or intended destination. Include blocked-save resumption, continuous supported cargo and clearer linked explanations. Broader checks also require a physical return after interrupted traffic yielding and separation of temporary rail staging supports from receiving/recovery capacity. This work is recorded in issue #21 and does not authorize the shunter or chemical checkpoints.

## October 5, 2026 — railway reception and shunting checkpoints

The newer request refines owned railway operation into smaller checkpoints under [parent #22](https://github.com/lukacslacko/factory_game/issues/22). One checkpoint is authorized in this turn, followed by creator playtesting. The previous driver/shunter/shed/fluid todos are retained and reused.

| Checkpoint                        | Individual issues and dependencies                                                                                                                                                    | Review status                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Named rail destinations           | #25: stable editable loading/unloading/transfer/parking references on installed rail; world guides, dense records, save/SQL                                                           | Completed in v0.14.0; published for creator playtesting.                                                                 |
| Reconstruct and connect reception | #7 reusable rail recovery; #24 turnout insertion into an existing straight run; #23 physically commissioned second main-line turnout and through reception track; #6 terminal buffers | Todo; choose a bounded piece after named-location review. The protected main line requires a deliberate service/possession handover. |
| Receive and hand off consists     | #26 multiple real cars on one arriving train; #27 physical coupling/uncoupling, secured detached cars and a clear line-locomotive exit                                                | Todo; usable reception length, car identity and route clearance precede handoff.                                                     |
| Owned shunting                    | Existing #3 delivered diesel shunter, #4 real qualified driver, #5 freight/tanker moves to named IDs, #2 physically constructed engine shed                                           | Todo; coupling and connected commissioned routes are dependencies.                                                                   |
| Parallel reception                | #28 several arrival tracks, occupancy and nonconflicting route/fouling reservations                                                                                                   | Todo; review a complete single-track arrival/handoff/shunting loop first.                                                            |
| Pump destination integration      | Existing #9 transfer-pump station references a named transfer position and physically positioned tanker                                                                               | Subsequent fluid checkpoint; no pump/chemistry implementation in the current pass.                                                   |

Named lengths designate real continuous track, not confirmed car fit, buffer/fouling clearance or a traffic reservation. Those checks belong to operational dispatch. Retain cars, cargo, identity, coupling state, secured location, workers and costs through every later save, interruption and handoff. No step should move cars by changing a location field or leave a line engine with a magical exit.
