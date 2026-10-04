# Work and operations

A work order is a planning relationship above actual physical tasks. Office installation contains a foundation subgroup and assembly task; the foundation contains slab tasks. A paving drag creates one area order, and adjacent siding panels share a rail stretch. The tasks remain independent serialized state machines with their own reservations, cargo, workers, material movements, and costs.

Equipment assignment follows the nearest explicit choice on a task or its ancestors. A child override takes precedence. The newest explicit request for a machine takes priority after current physical work or freight batch finishes safely. An assigned machine is reserved for those descendants; it cannot drift into unrelated automatic jobs or delivery unloading. Clearing an assignment restores parent inheritance or the shared automatic pool. An assignment never makes a forklift lift an office or lay rail, invents an operator, skips fueling, or bypasses an obstructed approach.

The Work table opens with active work. Expand controls show the hierarchy; sorting compares siblings and retains descendant blocks. Work ID, worker, operator, current equipment, preferred equipment, stock, and parent references lead to inspectors. Historical stock and movement references expose their retained history even after consumption. Text and column filters narrow every register; sorting/filtering happens before pagination.

Parking uses a grid coordinate at the machine center and one of four cardinal directions. The visible bay belongs to equipment and can be changed using a yard click or inspector coordinates. The full chassis must fit, including between a shed's physical posts and back wall. An idle machine waits for a real operator, boarding and routing; it does not move unoccupied. Fuel is consumed while driving. Missing operators, fuel, and routes retain visible parking reasons.

Worker schedules use the displayed clock. Hours can cross midnight. Always on is the default for new and existing workers. Shift end gates new assignments, while a current operation safely completes. Workers then park their equipment, exit the cab, walk to the bus, and board. Their same identities return for their next shift. Each charter bus uses the road and passenger transitions, and its $180 charge is recorded. The bus can wait for a delayed passenger rather than leaving them behind. The game does not progress while closed.

## Diagnostic bundles

The recorder is passive and separate from the simulation save. It retains changed job/delivery states, events, material movements, UI commands, and actor positions every 0.2 simulation seconds while moving. Each actor sample includes direction, velocity, path/destination, blocker, assignment, cargo, and equipment working reach. Up to 18,000 entries or 6 MB of entry text are retained, with four recent full checkpoints. Export includes the current yard; rolled-off entry count is explicit. Local IndexedDB is written with normal autosaves. It is never automatically uploaded.

`tools/review-recording.mjs` accepts an exported bundle and reports incomplete work, waiting deliveries, and prolonged low-displacement movement windows, including heading reversals and blocking IDs. A traffic wait is not automatically a bug. Compare the route and load envelope with its neighbors. Full checkpoint/current states can be extracted into ordinary save files for exact state inspection, but the trace is not a guaranteed deterministic input replay. Diagnostic exports should not be passed directly to the save importer.

## Physical limits

Routing uses sampled swept compound shapes, not a rigid-body engine. Open sheds have solid post bases and a back wall; solid buildings, light bases, cabinets, corridor poles, stored loads, and a resting buffer affect both paths and movement execution. Carrying a buffer removes its resting obstacle while the lifting envelope remains. Approaches validate actual machine poses and turning space. Legacy paths are checked and replanned during execution rather than allowed to cross new obstacles.

The operating model still uses fixed supplier berths and road routes, straight buildable track, simplified fastening/rigging, and local charter buses. A transit route editor, train dispatch, precise articulated joint controls, maintenance, weather, production, and worker welfare remain future work.
