# First fluid system — native v0.23.0

The Process tab builds and operates the first plant equipment: storage tanks, railway transfer pumps, supported pipe sections, elbows, tees, manual valves, and gauges. Water and diesel arrive in actual railway tanker cars. Chemical reactions, hydraulic pressure, gravity flow, tank-to-tank transfer, and liquid disposal are later work.

To try a ready-made system, download [First fluid transfer](../examples/first-fluid-transfer.json), then use the native game menu → Import to open it. This synthetic example starts paused with a connected tanker, six inline components, an operating pump, and a partly filled water tank. Import replaces the current yard after retaining its backup.

## Build the equipment

Use Purchase / hire to order process equipment kits and construction materials. The form shows unit and batch masses, freight capacity and costs. A tank kit weighs 4,800 kg and requires the 6-ton excavator; the 2.5-ton forklift cannot lift it. The pump kit weighs 900 kg. Workers and equipment must actually unload, store, collect, and assemble the delivered components.

A tank occupies 4 × 4 meters and holds 30,000 liters. A pump occupies 2 × 2 meters and transfers up to 5 L/s using 2 kW from a completed site electrical connection. Foundation paving is ordinary slab work. Tank assembly erects the base, shell courses, roof, and fittings; upper fastening uses a ladder. Pump assembly installs the skid, motor, pump, and manifold. Supported line fittings occupy 1 × 1 meter cells and are installed in stages too. Cancellation recovers components into the same identified kit rather than deleting them.

Select a placement tool in Process, then click the yard. R rotates pumps and fittings through four cardinal directions. Tank nozzles remain fixed on their four sides. Ground markings show actual connection positions and the pump outlet direction. Creative mode places the same completed assets immediately, without procurement or labor.

## Connect a continuous pipe route

All fixed pipe centerlines are 0.85 meters above the site datum, with DN100 internal diameter. At default rotation a straight section connects west to east, an elbow connects west to north, and a tee connects west/east/north. The pump has a west hose inlet and east pipe outlet; its outlet is half a meter from the north edge of its footprint. The tank’s west/east ports are 2.5 meters from its north edge, and north/south ports are 2.5 meters from its west edge.

Drag the Pipe tool to plan a straight cardinal run of up to 200 meter cells. The longer drag axis determines direction; a single cell uses the current rotation. A run becomes one assignable work order with individual physical installation tasks. If any cell is blocked, the whole request is rejected. Use separately rotated elbows and tees for corners and branches. Coincident opposing ports connect automatically only after installation; touching footprints or unfinished ghosts alone do not conduct liquid.

For a simple test layout on clear ground, place a default pump at E30, S30 and a tank at E38, S28. Fill E32–E37, S30 with inline components: for example pipes at E32/E33/E35/E37, a valve at E34, and a gauge at E36. Their ports align exactly. This layout illustrates pipe geometry; position the pump within hose reach of an actual stopped tanker for operation.

A meter of straight pipe holds about 7.854 L. Fluid fills real line capacity before reaching the tank; fittings retain their own hold-up. Closed valves retain fluid already present. Empty, isolate, and disconnect components before removing them. A filled component cannot currently be recovered: draining and disposal are not yet available, so test routes with water before committing a full production layout.

## Receive a tanker and attach its hose

Use Railway → + Tanker train, choose water or diesel, liters per car, car count and a connected named receiving point. Receive and release the supplier locomotive as described in [Rail operations](rail-operations.md), then use an owned shunter to move the car to a transfer point if needed. A forklift cannot unload liquid.

Place the pump close enough that its inlet is within 8 meters of the tanker’s actual side discharge fitting. Select the installed pump, choose the destination tank and requested L/s, and click Apply destination and rate. Choose the stopped tanker and request a worker to connect its hose. An available builder or engineer walks to the pump, carries the hose to the car fitting, connects it, and checks the pump connection. Keep both pedestrian work points accessible.

The car is locked against shunting and empty collection throughout connection, connected use, and disconnection. A hose can attach to only one pump. An approaching or moving tanker cannot be connected. Worker and operation IDs are linked in the Process register and inspectors; a delayed operation reports its blocked work point and produces a warning.

## Transfer and inspect

Request a worker to open the manual valve. Its position changes only after the worker reaches and turns the wheel. Start the pump when its hose, destination, completed open pipe route, product compatibility and site power are ready. A lost supply, closed valve, incomplete connection, full destination or empty source stops actual flow and appears in the pump status. The motor uses the site’s finite power capacity alongside existing loads.

The Process register shows tanks, pumps, line contents, valves, gauges, and ground operations in dense sortable/filterable tables. Click linked asset, worker, and car IDs to inspect them. Each component lists its directly connected neighbors; a pump lists both its installed route and currently open route, so a closed valve is easy to trace. Tank quantity and capacity are liters; pump and gauge flow is L/s. Gauges show actual flow, direction, and the uniquely connected tank’s level. Isolated, disconnected, dry or ambiguous networks have explicit states. These factory-calibrated instruments do not invent pressure readings.

Every accepted liter leaves the tanker and enters a pipe or tank. Tanker manifests, remaining payload, transfer totals, and the independent liquid balance update together. Stop the pump and request hose disconnection before moving or returning an empty car. Stop/start, valve operations, power loss, construction interruption, and save/load preserve all fluid and physical work state.

## Reports and saving

SQL tables are `process_tanks`, `process_pumps`, `process_lines`, `process_valves`, `process_gauges`, `process_operations`, and `fluid_movements`. Existing freight-car and order-line tables show the decreasing tanker inventory. The SQL examples include Fluid inventory, Transfer interlocks, and Fluid movement ledger. SQL results can be exported as CSV.

The fluid movement ledger aggregates each transfer run by physical source/destination edge rather than creating a row every simulation tick. Its bounded history is independent of the conserved source baselines and live vessel contents. Native display snapshots limit historical rows; portable saves and reporting retain the full bounded records. Ordinary procurement costs, labor, stable component IDs, and construction material movements remain in their existing registers.

## Underground electrical prerequisite

The pump motor needs a commissioned circuit to its own electrical box. A site-wide utility flag alone no longer supplies pumps. Open Electrical, order the incoming station and cable reels, then build a valid underground connection with an excavator, operator, and engineer. The motor draws 2 kW while enabled; each connected light draws 0.1 kW from the shared 16 kW station. See [Underground electrical service](electrical-operations.md).
