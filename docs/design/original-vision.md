# Fantasy chemistry plant original vision

Recorded 3 October 2026 from the initial design conversation. This is the reference for the original intent. Later decisions should be recorded separately so that changes remain visible.

This document preserves the initial vision. Current decisions are recorded in the [design journal](https://chatgpt.com/space/page_d863f0120e988191a039c3a7dff274c5). The [current screen proposal](https://chatgpt.com/space/page_c019dc6339888191887aec4620f45b6a) develops the selected C direction, direct control and operating records. Condensed from the [records comparison](https://chatgpt.com/space/page_217117b8ea3081919e8f6eeef3dd0830) is now approved for data screens. The flat world alternatives were rejected. The October 4 refinements in [visual directions](https://chatgpt.com/space/page_340a2ce06b1c819184d8d9ef69aaf2e0) preserve the original C's angled camera, three-dimensional detail and lighting while improving grid alignment.

## The experience

Build, operate, and care for a fantasy chemical works, from an almost empty plot beside a transport corridor to a large industrial site. The intended combination is the factory planning of Factorio, the tangible machinery and transport work suggested by Derail Valley, and the clean spatial organization suggested by Shapez. These are the creator's reference points, not a commitment to copy their mechanics or appearance.

The pleasure should come from making a place function: a delivered rail panel becoming track, a connected barrel keeping an excavator running, a crew arriving for its shift, or a carefully installed lamp illuminating an orderly yard. Production will eventually give this infrastructure its purpose. Building and maintaining the infrastructure is itself a substantial part of the game.

## The current starting world

The land is flat and effectively unbounded. A straight railway continues through it, with a parallel two-lane road and a utility corridor. The railway is not electrified. A nearby power line provides a potential electricity supply; it does not imply overhead traction power.

A switch leads to a branch that becomes parallel to the main line. The initial branch is approximately 100 meters long after the switch, with about 5 meters between the parallel track center lines, and ends at a buffer stop. A road crossing just before the switch allows vehicles to reach the site. Exact turnout geometry and the point from which branch length is measured remain open.

Everything built on the site follows a 1 × 1 meter planning grid. A straight track's center line lies on a grid line, with its two rails mirrored on either side in the adjacent rows of cells. Containers, poles, foundations, columns, walls, roofs, signs, and other installations are positioned neatly and consistently.

The final version of the initial idea replaces the infinite concrete surface with land that must be paved. Concrete comes as individual 1 m² blocks that must be ordered, transported, unloaded, and placed. The extent of any small starting paved area has not been decided. The original concrete-removal example still applies whenever construction crosses paving already laid.

Road and rail are both legitimate ways to bring in equipment, goods, services, and workers. The player should be able to choose between them as mechanics and infrastructure permit. The initial excavator might arrive on a truck; rail panels might arrive on a flat wagon. Workers might use a bus, a railbus, or a small train.

Clean water and dirty-water connections are available along the corridor, as is a potential electricity connection. Available services still need physical connections and installation work.

## Physical work is the governing rule

An order initiates a real sequence of activity. Materials and equipment arrive in vehicles, are unloaded, occupy space, and are moved into position. People travel to the work, use the required equipment, and perform the installation or service. Completed equipment operates only when its needed connections and supplies exist.

The player can buy services from external companies as well as materials and equipment. A contractor is a company that actually sends people, vehicles, tools, and goods into the world. Buying the service does not make the work disappear.

The desired level of physical detail includes handling a buffer stop, attaching a pump to a barrel, connecting a lamp, and moving individual construction components. Exactly how much the player drives or manipulates personally, and how much is assigned to simulated workers, is still undecided.

## The representative construction job

Extending the initial branch from about 100 to 200 meters is the defining early example.

1. Arrange the crew, excavator, transport, and materials.

2. Prepare the roughly 2 × 100 meter extension corridor in the example. Where concrete exists, remove it and place the recovered material in a real pile.

3. Receive an appropriate quantity of rail panels, potentially on a flat wagon.

4. Use the excavator to lift panels from the vehicle, carry them to the work, and lower them into position.

5. Have the crew release the old buffer stop from its fastenings. Move that same object to the new end using the excavator, then have the crew fasten it there.

6. Return people and equipment to their transport and send the service away, or retain purchased equipment for future work.

This describes the intended gameplay granularity. The example dimensions, fastening method, ground preparation, and panel handling are provisional game rules, not settled engineering specifications. Additional assembly tasks can be resolved during design without losing the physical sequence.

## The site has to support its own operation

The player may buy an excavator because many future jobs will need one. Ownership creates further work: arranging fuel, storage, maintenance, and people who can operate it.

Temporary office and sanitary containers are delivered and placed on the grid. The sanitary unit has toilets and showers. Water contractors attend, excavate as required, place pipes, make connections, and cover the trench.

An excavator shed is assembled from delivered parts such as columns and corrugated metal. A diesel barrel and pump must be placed and connected. Refueling consumes fuel and work time. When the supply is nearly empty, another full barrel is ordered, delivered, and unloaded. The empty barrel is moved and returned; a worker connects the replacement. These are continuing logistics loops.

Electricity begins with a small connection box installed by an electrical contractor on a pole, providing low voltage with limited available current. Site lighting requires delivered poles, bases attached to the concrete, erection, wiring, and lamps. Increasing demand eventually calls for better infrastructure.

People also require logistics. Workers are hired, shifts are arranged, and a chosen bus or rail service brings them in and takes them home. Later operation can include multiple shifts, a kitchen, and further staff facilities.

## Time changes the plant

The world has a day and night cycle, rain, snow, and seasons. Lamps burn out, machines wear, and consumables are used. The plant needs recurring attention after construction is finished.

Winter creates practical work. At first, workers can be assigned snow shovels. A larger site may justify snowplows, which themselves need fuel, oil, replacement lamps, tires, and summer storage. The intended result is an interconnected industrial place whose supporting equipment has its own operating needs.

## An orderly and inspectable world

The player should be able to give installations meaningful names and place physical identification signs on lamp posts, vehicles, and other assets. Paint can be ordered and workers assigned to paint signs and road markings on concrete. There is a central database of what exists and what happens.

Paperwork and cost tracking are part of the experience. Purchases, services, deliveries, work, and operating expenses should be traceable. The game has no budget restriction in the original concept: costs are recorded for understanding and analysis, rather than limiting what the player can afford.

A player who wants to write SQL should be able to analyze the records. A player who does not should still have useful ordinary screens. The database should help answer questions about individual assets, jobs, suppliers, consumption, and the cost of developing and running the site.

## The factory this grows into

The eventual business is chemical production. It will need more tracks, chemical reactors, pipework, monitoring, and everything required to make and move products. Site development grows to include an internal fire brigade, a kitchen, environmental monitoring, fences, and security.

The meaning of “fantasy chemistry” is intentionally unresolved. It could involve invented substances or more visibly fantastical processes. No particular magic system, chemical recipe set, industrial era, story, or visual style has been selected.

## Questions that remain open

Camera and art style, direct vehicle control, worker autonomy, construction detail, simulation speed, and the chemical system all need exploration. So do elevations and buried services, track curves and turnouts within the grid system, and how a large plant remains comfortable to manage.

Multiplayer, combat, a technology tree, financial survival, and an ending have not been requested. They should not become assumed requirements.

## How to use this reference

Before accepting a major new feature, ask whether it strengthens the physical work, useful production, orderly construction, or inspectable history of the plant. Where a later decision changes this vision, retain this dated baseline and record the decision and reason separately.

The core promise is a chemical works whose construction, transport, staffing, supplies, and upkeep can all be watched, understood, and traced.
