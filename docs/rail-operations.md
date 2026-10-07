# Rail operations — native v0.22.0

These controls run in the native Godot game. The hosted browser remains v0.18.0. The game’s Railway → Rail management help gives the same workflow in plain paragraphs.

## Prepare physical connections

Open **Railway → Mainline connection → Prepare mainline work possession**. Public rail arrivals pause while that section is closed. Four inherited 5 m panels become individually selectable assets in Installed track. Create a reachable stockyard, manually recover the panels, then **Plan / build the siding exit**. In normal mode the crew unfastens, lifts and stores each original panel and constructs the seven new modules. Creative performs the same finite material edits instantly. Finally use **Reopen completed track**: the service checks physical continuity before releasing the possession.

For an internal factory branch, use **+ Yard access switch**, choose a five-meter start station, prepare its local possession, manually recover its four original panels and then plan the turnout. At the default E80, S5 position, extend factory rail from E100, S10. Reopen that local possession after construction. Arrivals crossing an active work boundary wait; unrelated physical routes remain usable. A canceled operation does not erase steel or reopen a gap.

Ordinary straight-to-switch replacement stays manual: recover conflicting straight panels, then place and build the switch. Automatic combined turnout insertion (#24) was canceled at the creator’s request.

## Receive and release trains

Designate a named **unloading** or **transfer** interval on connected track. Give it enough usable length for the complete supplier locomotive and cars. Intervals follow real continuous track; a name on disconnected rail does not create a connection, and an interval cannot guess its way through a fork. The original siding remains the automatic reception choice.

In **Purchase / hire**, select Rail and enter a batch of materials. Its preview shows masses, number of cars, length and transport price. Choose the receiving point before approach starts. Supplier trains can use suitable connected factory reception tracks as well as the original siding. The selected point remains selected if its route is occupied or too short; the order explains the obstacle instead of silently rerouting.

Build and name parallel tracks to receive several trains. Actual swept route corridors reserve shared sections, switches and fouling areas. Independent routes can operate together. Conflicting trains wait, and pointwork cannot change underneath rolling stock. **Active rail route reservations** in Railway links each reservation to its owning order or engine and blocker; the same records are available through SQL.

Once stopped, open the delivery and **Release supplier locomotive**. The supplier’s identified crew alights, walks to the cars, secures handbrakes, disconnects the hose and coupler and returns clear. Composition changes after the physical steps. The engine then leaves forward over a completed clear route; it does not back through its cars. The cars remain physical obstacles with the same cargo and IDs. Supplier idle charges stop after departure.

## Own and drive a shunter

**+ Shunter** buys a 32-ton diesel engine for $68,000 plus $240 rail delivery. The asset records its mass, ownership, price, delivery service, fuel and position. A supplier driver delivers it over connected rails, inspects it, signs the handover and walks out through the site entrance. It is billed once when delivery completes.

Hire **Qualified railway drivers** in Purchase / hire. Several workers share one bus and retain Worker #N names, pay, shifts and attendance. Existing licensed equipment operators can have their railway authorization recorded through **Verify railway license · $180** in their worker inspector. This is a license verification, not an invisible training course. A general equipment-operator role alone does not authorize driving.

Assign an available qualified driver from the locomotive inspector. They walk to the cab and board before motion, visit levers and couplers on foot as needed, and reboard before hauling. New dispatch respects on-duty status and other work. An accepted safe movement finishes before the worker leaves for their shift-end commute.

**Forward 5 m** and **Reverse 5 m** drive an uncoupled locomotive relative to its cab orientation along actual track. Buffers, people, vehicles, switch ambiguity and reservations still apply. The inspector prominently shows MANUAL after a move; **Release manual control** returns it to delegated operation. Named parking and car work require released manual control.

To refuel, park within 8 m of an accessible diesel barrel and choose **Refuel stopped shunter**. The driver physically alights or approaches, fills a 20 L can, carries it to the filler and pours it gradually, repeating until the tank is full or the barrel is empty. Barrel, can and engine quantities remain conserved through reload. A blocked route warns and retries. Locomotive movement stays locked during refueling.

## Move and unload cars

After the supplier locomotive leaves, open the delivery, select an exposed contiguous block of cars, choose the owned shunter and a connected named destination, then **Shunt selected cars**. The engine approaches the correct end, its driver physically couples and tests hoses/releases brakes, then moves the cars continuously over the committed route. At the destination the crew secures and disconnects them. Correctly facing endpoints create connectivity; crossed rails alone do not. Build runarounds where the locomotive must reach the other end.

Choose and apply a physical **Unloading stockyard**, select flatcars and **Start unloading**. Actual owned equipment, operators and riggers handle the goods. **Pause unloading after current lift** finishes the current safe lift before allowing shunting. A full or inaccessible stockyard gives a linked reason. Cars, order allocations and invoices are conserved throughout separate unloading and movement.

**+ Tanker train** orders process water (1 kg/L) or bulk diesel (0.84 kg/L), 1–30,000 L per car and up to ten cars if a receiving interval can fit them. The quote includes loaded-car payload and tare, train length and supplier service cost; locomotive mass is not included in the loaded-car mass. Each tanker has a stable ID, 30,000 L capacity, own contents, bogies, brakes and couplers. Receive, release and shunt it to a named transfer point as for flatcars.

Liquid remains inside the tanker. Pumps and source-to-destination fluid transfer are separate work (#9), together with tanks, piping, gauges and valves (#8–#12). A forklift cannot unload a tanker, and a loaded tanker cannot be returned as empty.

## Build and use an engine shed

Purchase an **Engine shed** kit ($14,800; 5.2 metric tons). Place the 6 × 14 m footprint centered on at least 14 m of connected straight internal rail and rotate it to align both doors with the track. Foundations occupy the ground beside the track bed, leaving the rails intact. Keep columns, doors and approaches clear of other rails and buffers.

Normal construction uses an excavator, operator and ground worker to install six anchors, six columns, three frames, eight roof sections, four side walls and two raised roller doors. Partial structures remain visible and affect movement. Installed components retain identities through cancellation and reload. Creative completes the shed and its foundations immediately.

Select the finished shed, choose an owned locomotive and **Assign shed and park locomotive**. Its visible saved bay is a normal named rail parking point. Entry and exit use actual connected rail movement, qualified drivers, fuel and route clearance. The locomotive retains its home shed while working elsewhere; **Return to assigned engine shed** drives it back.

## Return empties and inspect work

Use the shunter to assemble empty supplier cars at a connected named return interval near the main line. Cars must actually be adjacent and coupled in a usable consist; assigning the same location name is insufficient. Park the shunter clear of the collection approach and departure route.

Choose **Collect empty cars**, select empty supplier orders, choose the return point if desired and **Request mainline locomotive**. A distinct supplier engine arrives, its identified crew connects the couplers and hoses, tests the brakes, releases handbrakes and boards. The engine then hauls the complete empty train through the clear exit. Loaded, unreleased or reserved cars are rejected. Service and exact waiting time appear in Costs and the linked return inspector, including a final partial minute.

Car inspectors expose contained cargo, current location, couplings, hose and handbrake state. Ground operations link their worker, engine and cars. The Railway register shows active route reservations, and Activity retains warnings and useful blocker identities. Save/reload preserves accepted ground steps, queues, routes, actual car poses, fuel and invoice history without repeating completed work.

## Editing rails and buffer stops

Open **Railway** and select a completed panel in **Installed track**. Its inspector distinguishes the selected panel from the remaining panels in its curve or turnout assembly. Choose **Review this panel recovery…** or **Review whole curve/turnout…**. The review lists the actual material types, quantities, weights and identities, including attached stops. It shows automatic stockyard destinations and any blocking constraint before you submit the edit. Preview destinations are not reservations; normal work rechecks capacity and access when handling the material.

In normal play, **Plan physical recovery** creates work for your crew and lifting equipment. A worker unfastens and rigs the material, the machine lifts and carries it to storage, and attached stops are recovered before their supporting rail. Open the linked work order to assign equipment and follow progress. Trains, reserved movements, named locations and conflicting work can prevent recovery. Cancel unbuilt plans through **Work**; recover completed infrastructure through its inspector.

Use **Railway → Buffer stops / editing** for the installed, available and incoming stop counts, a focused purchase form, and installation at real completed open endpoints. Select an installed stop in Railway or the yard and choose **Review buffer recovery…**. Stops occupy a finite 2 × 2 meter stockyard slot and keep their identities when recovered and reinstalled. Purchases bring material to the site; installation is separate physical work. The review explains missing stock, workers, equipment or storage. The Railway register links stop stock, incoming orders and active stop work.

Creative uses the same review but offers **Install instantly** or **Recover instantly**. Recovery is immediate and still requires finite stockyard capacity; an impossible edit changes nothing. Installing a stop reuses available recovered stock before supplying a new Creative asset. Track extensions move their incoming stop to an open end. Connecting track, including either turnout tail, recovers redundant stops into storage; ordinary construction performs that recovery physically. Secured stops continue to block train routes until removed.

### Buffer-stop representation decision (#40)

A stop is mounted rail infrastructure with its own stable identity and a shared placement/inspection/recovery workflow. It does not contribute extra track length. We evaluated treating it as a five-meter straight panel with a stop in its middle. That would add or replace steel, shift the stopping plane by half a panel, change usable dock lengths, and complicate recovery of existing track and active connected construction. Keeping the mount and supporting steel as separate accounted assets preserves those physical meanings. Panel recovery includes its attached stops, and the common editing review presents both together. This resolves the lifecycle inconsistency without silently changing track geometry or allowing trains through secured stops.
