# Fantasy chemistry plant design journal

This journal records the creator's feedback in order and separates confirmed direction from assistant proposals. The [original vision](https://chatgpt.com/space/page_89582957570c819187121128803b7d77) remains the historical baseline. The [development proposal](https://chatgpt.com/space/page_4641ba943f1c8191afc9c932cbceec84) and current screen designs should be reconciled with confirmed feedback.

## Documentation practice

The creator has asked for this comment and future comments to be recorded in the documents. When further feedback is received in this design conversation, append a dated entry here, distinguish the creator's decisions from interpretation, update affected current proposals, and preserve earlier ideas as history. A new suggestion is not a confirmed decision until the creator adopts it. This is an ongoing documentation instruction for future conversation turns, not a scheduled background task. Use US spelling. Current records designs should be dense and text-first without realistic illustrations. Condensed is approved for data screens. The original C raster image is the world-art anchor: preserve its angled camera, perspective, three-dimensional form, detail and lighting while improving grid alignment. The flat SVG world studies were rejected and must not guide future visuals. Low-poly alternatives must retain depth. Record later feedback without treating proposals as approved choices.

## 3 October 2026 after the first visual review

### Confirmed direction

C is the preferred main visual direction: an orthographic overhead world with the precise, readable industrial appearance of the planning screenshot. A and B remain possible future views for enjoying and inspecting the plant. Their greater visual demands make them later ambitions.

The strict numbered sequence in C's right panel is not the intended everyday play. The player should be able to select a worker, move them from cell to cell, enter an excavator, and choose what to do. Personal control must be available within the overhead view; it does not depend on building a ground-level camera first.

As the factory grows, the player needs automation. The same planning view should support giving a longer instruction as a whole, such as loading or unloading, or building an entire stretch of track. Detailed physical work remains present even when instructed as a larger task.

A step-by-step panel may remain as a tutorial. It must be dismissible and must not prescribe the player's actions in free play.

Stockpiles and stored objects must have realistic size and handling. Piles of concrete and rails should occupy the space their contents require and be moved using appropriate means. Storage must not conceal implausibly large quantities in a tiny footprint.

Before implementation, develop screens for delivered, used and stored material; workers and duties; equipment and vehicles with statuses; consumables with historical use and present stock; orders and deliveries; logs; and delivery notifications that remain trackable as To do, Doing and Done.

Record this feedback and future feedback in the documents.

### Implications proposed for this revision

Use C as the shared appearance of the main world and its records screens. Put contextual controls near a selected person or object, with a compact dismissible tutorial separate from operating controls.

Represent personal control and delegated work as different ways of directing the same physical actions. Handing control back should preserve the actual position, load, fuel and completed work. The exact movement and machinery controls still need design review.

Use a persistent workboard connected to delivery, worker, asset and material records. Closing a popup changes visibility, while the task retains its status. Real-world completion determines the completion of a physical job; personal reminders can be treated separately.

Record explicit stock footprints, stack height, mass, access and handling restrictions. The mockup uses a provisional example of 24 square slabs in six stacks of four. This is a test layout rather than an approved construction material or lifting specification.

These implications are assistant proposals. The confirmed direction above is the creator's instruction.

### Creator feedback preserved verbatim

> I love the C view. The other two views would take a lot to get right, I hope we'll eventually get there, when we'll want to have fun and just look at things, but I love the visuals of C. I dislike the strict bullet points on the right panel of C though. I'd like it more if one can either click on a worker, and walk with them cell to cell, get in the excavator, go do what they want. Of course eventually this will need to be automated, a single player cannot run a whole factory, so then one can just do the clicking in the planning view to do exactly as you show, to give a long instruction as a whole, to offload/load things, build a whole stretch of rail, etc. And of course we can keep that panel as a tutorial, rather than a must-do thing, but the player is free to click it away. And for things like piles of concrete, piles of rails, etc, we have to make sure they are realistically sized and manipulated, not like a typical game where storage can keep a lot of things. Now, before implementing things, please also work out other screens of the game, like where one tracks the material delivered, used, stored, etc, or the workers, their duty assignment, the equipment and vehicles, their statuses, the consumables and their past usage, current status, and outstanding orders and deliveries, and the system of logs to look at, and how notifications will look like when eg a delivery of a new barrel of fuel, or of a truckload of electric poles, or a train about to arrive with concrete panels will look like and how one will keep track of those notifications to be able to keep them in a todo/doing/done way. Please create proposed visuals for these, and record my notes and ideas in this comment and future comments in the documents.

### Still open

The exact camera zoom and world art detail; keyboard support alongside clicking; the granularity of vehicle movement and excavator manipulation; how much autonomy early workers have; receiving and inspection rules; and the meaning of fantasy chemistry remain open. The visual choice and desire for personal control are now established.

## October 3 2026 after the dense interface review

### Confirmed creator instructions

Use US spelling throughout. Records screens should be dense and text-first, with no realistic portraits, equipment renders, or other illustrations that consume information space. Small functional icons are acceptable. Explore the visual vocabulary of old condensed Gmail, late-1990s tycoon games, and a text-oriented PC interface from around 1994.

C remains the preferred world view. Explore less realistic versions while preserving its overall feel. Equipment should tend to stay aligned with the grid; a turning animation is acceptable. Storage piles and their boundaries should align visibly to the grid. Potential retaining slabs, capacity limits that prevent overfill, and quantity-dependent pile rendering must support believable physical storage.

The creator explicitly recognizes that earlier generated images are holistic renders rather than a cell-based implementation. This feedback requests a range of refinements and does not reject C or require all motion to remain axis-aligned.

### Proposals for this review

Compare Condensed, Tycoon 1998, and Text console 1994 records using the same seven screens and sample data. Compare C1 Flat industrial, C2 Tile tycoon, and C3 Technical plan using the same yard geometry and fixed storage bay. These names and specific treatments are assistant proposals, not approved selections.

Keep records style and world treatment independently selectable during design review. Default parked alignment, precise motion rules, storage capacities, wall construction details, and the final retro style still need review. The 6 × 4 m bay and 12 m³ capacity are illustrative values.

### Document updates

Updated the written design documents to US spelling and reconciled the development plan and screen proposal with this direction. Earlier raster images remain historical references, including their baked-in labels. The new [dense interface alternatives](https://chatgpt.com/space/page_217117b8ea3081919e8f6eeef3dd0830) contain the current comparison and spatial rules. No game implementation was started.

## October 4 2026 after the world rendering correction

### Confirmed creator decisions

Condensed is the accepted visual style for data screens. Its compact typography, density, ivory surfaces, restrained teal accents, and text-first layout match the intended aesthetic. The retro alternatives remain historical explorations.

The creator rejects all three flat world treatments from the preceding round: Flat industrial, Tile tycoon, and Technical plan. Their crude top-down appearance and unattractive switch geometry lost the qualities of the original C render. The request for improved grid alignment was not permission to remove perspective, depth, material detail, or the three-dimensional feel.

The original C raster render is the visual anchor for the world. Preserve its elevated angled camera, visible building and machine height, lighting, contact shadows, and industrial detail on a flat two-dimensional construction grid. Better align placed objects, stationary machinery, and bounded storage to that grid. Keep smoothly curved, plausible railway turnouts. A stylized low-poly alternative is requested, but it must retain three-dimensional form, depth and perspective.

### Correction to the design interpretation

The assistant incorrectly extended the request for dense old-school records into a flat, schematic world aesthetic. Keep these design decisions separate: Condensed governs records and compact interface chrome; the world retains the rich dimensional character of the original C. Grid alignment describes placement and spatial rules, not an instruction to flatten the art.

### New alternatives for review

Using the original C image as the positive reference, generated three new raster proposals: C-A Original depth with clearer grid alignment; C-B the same detailed treatment with more explicit equipment and storage modules; and C-C a sculpted low-poly treatment with retained depth and lighting. These are new proposals, not approved selections. They are saved in [visual directions](https://chatgpt.com/space/page_340a2ce06b1c819184d8d9ef69aaf2e0).

Physical storage limits, quantity-dependent pile geometry, installed retaining slabs, direct worker control, optional guidance, later delegation, and US spelling all remain in force. No game implementation was started.

## October 4 2026 after the request for a wider style range

### Creator feedback

The preceding three C renders were still too similar. The creator specifically pointed out that the excavator remained angled instead of standing parallel to the grid axes. Small changes to textures and foliage did not address the requested range of visual abstraction.

The creator requests one option close to the attractive original C, but with buildings, storage, object sizes and parked machinery visibly matching grid lines and axes. The railway switch is an explicit exception because it curves across cells. Track gauge is explicitly 1,435 mm; rails must retain that physical spacing rather than snapping to an integer number of meters.

Other alternatives should be meaningfully more toy-like, low-poly or schematic while retaining the angled view and three-dimensional depth. The creator wants a range between detailed imagery and extreme flat abstraction. A schematic style is acceptable when it uses dimensional forms; the rejected flat SVG studies remain unsuitable.

### Working interpretation and review criteria

For the new comparison, park the excavator facing left along a grid row: crawler tracks parallel to the straight rails, upper carriage aligned with the chassis, and the boom working in the same longitudinal vertical plane. A colored rectangular outline around an angled vehicle is not an alignment correction. This parked pose does not forbid slewing during work or turning during movement.

Use common grid boundaries for paving seams, rectangular building bases, stockpile walls and storage racks. Object footprints and dimensions should be evident from the grid. The illustrative 6 × 3 office, 3 × 2 sanitary unit and example storage dimensions used in prompts are assistant layout choices, not newly approved specifications.

The four new proposals are Detailed industrial, Simplified matte miniature, Chunky toy construction set, and Schematic foam model. They explore texture, component count, shape, material, color and level of detail, not merely recoloring the same scene. The toy and schematic render attempts were revised further when their first versions retained too much realistic detail.

Physical quantities, handling, storage capacity and construction work remain part of the game even when their appearance is stylized. The toy treatment does not authorize abstract storage or instant building. Condensed remains the approved records style. The new images remain unapproved visual studies; exact millimeter geometry and every cell dimension are requirements for eventual implementation, not measurements certified by the generated pictures. No game implementation has begun.

## October 4 2026 implementation authorized

### Confirmed creator decisions

The creator selects the latest A, Detailed industrial with clearer grid placement, blended roughly 80 percent A and 20 percent B, Simplified matte miniature. These letters refer to the four-image wider C style range, not the original camera alternatives. Condensed remains the approved records style.

The creator now explicitly authorizes a full first playable version. It should let the player hire workers, buy equipment and materials, deploy them, pave areas, construct rail, and build a small starter base freely. Chemical production is outside this version. The creator asks for sustained autonomous implementation, playtesting, fixes, and good documentation.

This authorization supersedes the earlier instruction to remain in design only. The historical entries and original vision remain intact.

### Implementation direction

Build a local browser game using a real 3D scene and a separate deterministic simulation. Preserve metric dimensions, the meter grid, 1,435 mm rail gauge, axis-aligned parked machinery, bounded physical storage, no budget ceiling, traceable costs, and dense text-first registers.

The first-version scope includes deliveries, physical stock and cargo, worker and equipment assignments, direct worker control, paving, rail panels, office and sanitary containers, a shed, a stores building, lamps, fencing, fuel, utility services, persistent notices, saves, and SQL reporting. A generous finite yard, simplified carrier operations and utility installation, and straight buildable rail are implementation boundaries, not changes to the long-term vision. Shift transport, maintenance, weather and chemistry remain later work.

The source, playable build, player guide, and test record are maintained together in the local starter-yard deliverable.

### First playable implementation outcome

The local first version implements the construction sandbox: a true 3D grid-based yard, procurement, physical stock and carrier deliveries, worker and equipment control, construction and recovery, fuel, simplified utility services, day/night lighting, linked Condensed registers, workflow notices, costs, SQL snapshots, and portable saves. The included Willow Siding example was built from an empty state through 145 completed jobs, with 132 square meters of paving and a 25-meter siding extension. Chemical production remains intentionally absent.

Validation includes 22 simulation regressions, an actual browser interaction suite, production/offline-asset checks, import of completed and nighttime saves, and visual inspection. The player guide and technical/test notes document finite-world, straight-track, contractor, traffic, shift, and utility-network limits.

The choice of 80 percent A / 20 percent B is the art target. The implemented procedural 3D art is an initial asset set and remains open to visual feedback. Condensed remains the records anchor.

Online synchronization is partial: the earlier selection and authorization entries were saved, but automatic approval review rejected further online plan and screen updates because it could not verify destination ownership and authorization. The local design documents and the game documentation contain the current changes. No alternate route was used to bypass that rejection.

## October 4, 2026 — first-play usability corrections

The creator requests a true perspective camera instead of orthographic projection, WASD relative to the current view, and left-button dragging on empty ground for Mac touchpad use. Short clicks must still select, walk, or drive; drawing with Pave or Stockyard retains its construction meaning.

Straight track must occupy two one-meter grid rows straddling its centerline, with 1,435 mm between the inner rail faces. The previous implementation encoded the gauge correctly but used a four-cell construction envelope and wider sleeper/ballast treatment that contradicted the requested two-cell presentation. Version 0.2 keeps the gauge and narrows the footprint, sleepers, and bed. Existing saves retain their track centerlines and buffer positions through migration.

A completely empty start must contain no automatically assigned receiving stockyard. The public receiving point may remain to guide carriers. Players designate storage themselves; deliveries wait if none exists. The truncated ground label was caused by fixed-size lettering; labels now fit their text. Stockyard outlines and labels are planning annotations, not installed signs or painted assets.

The creator identifies unsupported-looking buffer crossbars and crossarms parallel to their overhead conductors. Version 0.2 adds vertical buffer uprights, braces behind the stopping face, feet and buffer pads; pole crossarms span perpendicular to the route, with three separate conductors attached to corresponding insulators.

The creator requests publication as a playable artifact. The selected publication path is a private hosted browser game, retaining the downloadable local version. Browser saves remain local to each browser and origin; exporting/importing transfers a yard between local and hosted play.

The creator explicitly notes that the implemented art is substantially worse than the approved concept renders and is open to Unity or Unreal. This is not approval to replace the project immediately. The assistant agrees that the visual target remains unmet. For the longer-term desktop game, Unity with URP is the current recommendation, subject to an actual engine decision. Detailed modeled assets, coherent materials, lighting, and animation are still required in any engine. The concept renders remain the quality target; this usability patch is not a claim to match them.

Publication outcome: version 0.2.0 was successfully published as a private playable Site. Automatic approval review rejected the initial full-project payload; the approved upload contained only the built game, local SQL runtime, illustrated guide, and its preview images. Private source documents and saved yards were excluded. The source remains available in the local downloadable package.

## October 4, 2026 — physical operation and presentation corrections

### Confirmed creator feedback

Workers should be named **Worker #1, Worker #2**, and so on. Vehicles must move and turn smoothly rather than jump between cells or headings. Workers must stand on the ground; their detached-looking shadows exposed a broader ground-contact and lighting problem.

The creator rejects the first train model: overlapping cars and locomotive, insufficient visible wheel/axle structure, and careless geometry. The requested standard is convincing, coherent machinery, with enough implementation and inspection effort to address the problem. The approved A/B concept direction remains the art target; these corrections do not redefine that target downward.

Unloading must obey the same physical rules as the rest of the game. A forklift must be ordered, delivered, exist somewhere in the world, and be driven off its delivery truck by a hired operator. The player needs a worker to occupy and operate it during unloading. A forklift appearing at a carrier, moving without an operator, or passing through a truck is unacceptable. The creator explicitly clarified this after the assistant initially considered automatically supplied contractor equipment; that interpretation is withdrawn. Purchasing a service may still eventually bring an actual contracted crew and equipment when the player explicitly orders that service, but a freight order must not silently create a free site machine.

The supplied storage screenshot shows scattered partial slab stacks and large unused gaps while unloading reports insufficient space. Slabs must be stacked on top of one another and fill usable grid-aligned storage cells. Physical limits still apply; the correction is to use existing stack capacity and adjacent cells, not to hide unlimited quantities in one location.

The creator authorizes splitting independent implementation work among subagents. Documentation should continue to record future feedback in this journal.

### Version 0.3 implementation response

Number workers consistently, including migrated saves. Separate the locomotive and flatcar, use two two-axle bogies per vehicle, align wheels with the true rail geometry, and give bodies/bogies their own poses along the track. Continuous motion, gradual heading changes, and display interpolation replace visible fixed-step jumps. Reworked worker origins, feet, shadow bias, seats, and cab geometry address the hovering appearance.

A purchased machine now arrives as one persistent asset on a lowloader. Its hired operator approaches, climbs aboard, drives down lowered ramps, and parks it. Material unloading reserves the player's machine and operator; excavator lifts also use a builder or engineer for rigging. The load moves from the carrier into machine cargo and then into physical storage, with records for each transfer. The operator remains in the cab afterward. Freight, crew, equipment, and service vehicles use distinct receiving points so waiting freight cannot block its own bootstrap resources. A manually controlled operator can be assigned to a waiting delivery through the same sequence.

Storage tops up reachable partial stacks before allocating adjacent empty cells. The current slab limit is 12 per 1 m² stack; machine capacity limits each lift separately. A 2.5 t forklift carries at most eight of the current 280 kg slabs in one lift. Dense storage needs a reachable loading face and travel aisles. These values are provisional catalog rules, not a claim to reproduce a particular commercial machine or construction product.

Version 3 saves retain active deployment and unloading phases. Migrating older saves preserves stock and accounting, renumbers workers, and resumes active older carriers at their receiving points. Material in a removed carrier-handler animation returns to its carrier's remaining quantity and waits for owned equipment; the migration does not grant a forklift.

### Remaining boundaries

This update does not implement chemistry, infinite construction, worker shifts and commutes, full utility networks, weather, wear, or the other later systems in the original vision. Carrier bounding rectangles affect routes, but complete swept-volume collision, general moving-vehicle traffic, detailed chains, and individually controlled boom joints remain unfinished. Utility commissioning remains scripted. Road carriers currently reverse along their arrival path.

Model and simulation checks support this revision, with integrated browser review required before release. Publication is a separate final step; this entry does not assert that the private Site has already been updated.

### Version 0.3 validation outcome

The updated game passes 50 simulation, delivery, motion, and ramp-contact tests, the integrated browser interaction/navigation/rendering suite, and a separate production build check with no warnings or failed assets. The Willow Siding example has been rebuilt through actual version 3 orders: 145 completed construction jobs and 19 completed deliveries, with balanced material records and no stranded cargo.

Close-up review corrected the remaining overlap between wide cargo and its truck during turning, the excavator boom crossing an office roof, and an obstructing receiving sign. The game now represents slab handling spacers and tapered forks; rigger approach and retreat precede an excavator lift. Source, guide, and examples retain the original long-term requirements and clearly state that steering, traffic, and detailed rigging are still simplified.

Publication outcome: the final version 0.3.0 build succeeded on the same private Site. The local ZIP includes the editable source, guide, tests, completed example, and actual gameplay previews; the published payload contains only the built playable game and guide.

## October 4, 2026 — Traffic and physical rail laying

The creator liked the improved version and identified six further problems: road vehicles drove along the center line; carriers passed through one another; departing buses and trucks reversed their arrival paths; machinery passed through workers; excavator routes made too many turns; and track construction made the rail panel and buffer disappear or relocate without visible handling.

Road traffic should keep right on a road wide enough for the actual vehicles. A bus can continue forward after stopping. A delivery truck can turn in the yard or back clear of its berth before departing forward. People and vehicles must yield rather than intersect. Routes should favor long, straight runs and a small number of bends; grid-aligned parking and construction do not forbid diagonal travel or smooth turns.

Track laying should stage the delivered rail panel beside the work, unbolt and lift the existing buffer to a temporary resting place, lay and join the panel, then lift the same buffer onto the new end and fasten it. The panel and buffer must remain visible, physically located, and accounted for throughout. Saving, fuel interruptions, and cancellation must preserve those objects and complete any necessary safe placement.

These are corrections to the existing physical-construction premise, not a change in the selected visual direction. The implementation continues using the current 3D world and Condensed records.

### Version 0.4 implementation response

The public road is now 8.4 m wide with distinct right-hand lanes. The bus stops at the curb and continues forward. Material and service trucks back within the yard, stop to change gear, and depart forward; lowloaders use a forward turning loop. Saved crossing and yard maneuver reservations coordinate competing carriers. Imported older road vehicles move once to a compatible route position, including while the save is paused, with their riders and carried machines kept together.

Vehicles check oriented bodies, tools, loads, and people before translating or turning. Automatic workers step aside; an idle machine can repark only with an automatic operator seated. Route planning prefers straight runs and a few bends, while local detours include backing and clearance along the machine's existing heading. Player-controlled or unoccupied equipment remains an obstruction until the player moves it.

Rail construction now retains the panel and buffer throughout a visible staging, unbolting, lifting, laying, joining, retrieval, and refastening sequence. Saving preserves the current poses and reservations. Canceling completes safe placement and secures the buffer. The freight rigger waits until the machine parks and aligns, then clears the lifting area before the load leaves the carrier.

This iteration preserves the current 3D visual direction. The movement model still uses simplified compound shapes and sampled swept checks, not a rigid-body engine or general road-network dispatcher. These limits remain documented alongside the original longer-term vision.

### Version 0.4 validation outcome

Eighty-six regressions pass, along with the integrated browser checks, TypeScript validation, and the production build check. A fresh empty yard completed all 145 construction jobs and all 19 delivery departures with balanced stock and no stranded cargo or reservations. The final example is saved with its actual material movements, costs, and fuel use. The production guide includes a current rail-handling screenshot; a separate continuous gameplay clip shows staging through buffer fastening.

Testing also corrected narrow work approaches, machines waiting face-to-face, occupied loading destinations, workers approaching before crane turns, and old forklift rail assignments. Older carried panels receive a physical supported handoff to an excavator; installed panels retain their identity and finish only the remaining buffer work.

## October 4, 2026 — Dedicated equipment roles and precise slab handling

The creator reported that an excavator and forklift competed for individual paving slabs while new deliveries waited. They want to dedicate one machine to receiving supplies and another to paving. The design response is an explicit per-vehicle work role, adjustable from both the equipment register and the world inspector, with safe completion of current work before reassignment. Older saves should retain their previous shared-pool behavior until a role is chosen.

They also observed that machines picked up or placed concrete while merely near the source or destination, making the slab jump sideways by several meters. The required correction is continuous physical handling: orient the vehicle and its lifting gear toward the actual slab, pick it up from its real stack position, carry it, align at the destination, lower it, and release it without a lateral position jump. This reinforces the original construction premise; it is not a change in the desired 3D visual style.

### Version 0.5 implementation outcome

Vehicle roles are now explicit in the Equipment register and world inspector: All work, Receiving only, Paving only, Building only, Rail work only, Recovery only, and Hold new work. Current construction jobs and unloading batches finish safely before a change applies. Roles persist in saves, are recorded in the activity history, and appear in the SQL equipment table. The intended receiving-forklift/paving-excavator pairing is tested with simultaneous work and one operator per machine.

Concrete paving now aligns each machine with the actual source slab and destination cell. Fork engagement or rigging precedes pickup; the same load is lifted, carried, lowered onto temporary runners, and left supported while the machine withdraws. The builder then removes supports and levels the slab. World-space poses and real temporary stock preserve quantities through saves, cancellation, and refueling. Delivery handling also adjusts working reach continuously before setdown. Future machine/tool/load envelopes reserve the working lanes so another operation cannot fill or occupy them midway through a lift.

The full-base test exposed and corrected competing pickup lanes, incoming stock blocking withdrawal, a turn-speed planning mismatch, and inaccessible recovery destinations. Longer physical handling requires real refueling in the completed example. Version 0.5 passed 109 regressions and final browser/production checks, and was published on the existing private Site. The game package retains the guide, technical notes, updated example, test records, and actual gameplay clip.

## October 4, 2026 — Reviewable operations, work orders, and shifts

The creator reported repeated forklift heading changes without progress and a rail extension stuck at “Approach reserved rail panel in stock.” They request detailed local diagnostic history with export for later review; they explicitly selected a rolling local recorder rather than manual Start/Stop recording.

All tables should sort on header clicks and offer filters. Active work should be visible before completed work. IDs and assigned workers/equipment should be clickable wherever shown, including references to reserved stock and blockers. The player should be able to urgently assign a machine to a particular job. Work should have a hierarchy: a complete office installation contains foundation paving and assembly, and paving contains individual slab tasks; assignments should apply at any level.

The creator also observed machines crossing a replaced buffer, shed pillars, and light poles, and a worker passing through a wall. Those must be physical obstacles. Excavator arms and worker fastening motions should interpolate smoothly between simulation updates. Equipment needs player-assigned parking positions inside usable shed bays; workers should park their machines and take an actual bus home and return according to daily or overnight shifts.

The whole project is requested as a public GitHub repository at `lukacslacko/factory_game`, under the MIT license. This explicitly authorizes source and design documentation publication; playable hosting remains on the existing Site. These additions deepen the original physical-construction premise and retain the approved perspective world and dense Condensed records.

### Version 0.6 implementation

New construction plans create nested work orders. A building contains its foundation work and assembly; a paving order contains each physical slab task; a rail stretch contains its panel jobs. An equipment assignment inherits through those groups, with a more specific assignment taking precedence. Urgent assignments receive priority after current cargo handling or the active freight batch completes safely. Automatic roles still govern equipment that has no explicit work assignment. Existing ungrouped jobs remain intact when older saves are loaded.

The Condensed registers now have sortable headers, text and column filters, active work by default, and collapsible work groups. Entity IDs link to current records or retained history. Equipment inspectors accept grid-aligned parking bays, including a clicked location and cardinal direction. Worker inspectors accept daily or overnight shifts; Always on remains the default for existing workers. Shift end completes active handling, parks the machine, and boards a real charter bus. The same workers return for their next shifts.

A passive local rolling recorder captures commands, movement samples, work and delivery transitions, blockers, accounting events, and periodic state checkpoints. Activity and the game menu export the bundle. The included offline review command summarizes prolonged waits and heading reversals. The recorder does not change simulation state or transmit data automatically; it is a diagnostic history, not a claim of deterministic replay.

Collision footprints include shed posts and back walls, lamps, cabinets, corridor poles, stocks, and a buffer resting beside the rail. Imported blocked rail approaches can select a new reachable lifting face while keeping the reserved material. Work-arm clocks interpolate between simulation ticks. Full-base testing exposed alternating machine escape maneuvers, which now use stable yielding priority, and a departing carrier blocked by an idle automatic worker, which must clear through physical walking rather than disappearing or disabling collision.

### Version 0.6 validation outcome

The frozen source passes 141 regressions, including the complete starter-base save/reload, plus the final browser controls and animation checks and TypeScript/build validation. The fresh Willow Siding example finishes 145 construction tasks, two real refueling jobs, all 18 work-order groups, and all 19 deliveries. Its material and 525 L fuel balances reconcile without stranded cargo, reservations, service fuel, or worker/equipment assignments. The full-base timeout remains unchanged. Publication is recorded separately after deployment and public-source verification.

Publication outcome: version 0.6.0 deployed successfully on the existing private Site at 15:11 UTC. The complete project is published separately as the requested public MIT repository at `github.com/lukacslacko/factory_game`. The downloadable release includes the production build, current source and documentation, fresh example, and validation records.

## October 4, 2026 — Return to the accepted C concept art

The creator asked to look again at the last option C visuals and move the current playable graphics closer to them. The accepted target remains the final detailed-grid A at roughly 80%, with 20% of matte-miniature B. This is a request to improve the rendered game, not create another flat top-down study or replace the Condensed records style.

The comparison identified excessively wide framing, an olive cast, repetitive dark grass, weak soil/pavement/ballast separation, striped slab joints and roof ribs, and simple vehicle silhouettes. The revised world uses a closer axis-facing perspective view, neutral sky and room reflections, light gray concrete, tan earth with varied patches, darker asphalt, defined gray ballast, quieter grid lines, fine slab joints, and smaller leafy clusters. Containers have shallow zinc ribs, frames, glazing, corner fittings, vents, and steps. The excavator has a sloped glazed cab, curved tail, tapered boom/stick plates, pivot collars, barrel/rod hydraulics, and an open bucket. Forklift, road/rail vehicles and worker clothing/proportions received corresponding detail. An unassigned motionless excavator rests its empty tool low; loaded and active work poses retain their original anchors.

Contact shading was reduced to solid objects, reuses the beauty pass shadows, and uses a smaller depth buffer after Retina measurement found that the initial full-scene pass occasionally missed frames. Ground cover remains visible in the color pass. The visual geometry preserves wheels, boot contact, tool/load anchors, deck/ramp support, animation pivots and named parts. The simulation, job rules, purchasing, inventory, collision routing, and save schema remain unchanged.

Validation and publication outcome: version 0.7.0 passed the integrated browser/production checks, actual geometry/contact/animation checks, three diagnostic regressions and TypeScript/build validation, then published on the existing private Site at 17:10 UTC. The simulation core is unchanged from the 141-test v0.6 baseline. Final Retina captures and frame measurements are recorded in the test documentation. The public MIT source and gameplay previews are updated.

## October 4, 2026 — overlapping operations, real time, and worn paths

The creator requests concurrency wherever physical dependencies allow it. Once a machine has placed a slab and safely withdrawn, it should head for the next pickup while the worker removes runners and levels the previous slab. An empty delivery carrier should leave as soon as its final parcel is lifted clear, independently of the journey to storage. An assisting worker should be requested and walk toward unloading while the machine/operator approach or board. Crew, machine, cargo, and working space remain real resources; overlapping actions must not erase required clearance or ownership.

The creator selects actual real time at 1×. Movement already uses seconds at that rate and is acceptable; the formerly accelerated calendar is rejected. Clock, attendance, wages, shift schedules, arrivals, and physical work now share simulation seconds, with 3× and 10× relative to that baseline. Existing saved dates and financial history must not be rewritten.

The creator reports excavator heading flutter: roughly three left/right corrections of about 30 degrees. A short-corner path reproduced the defect locally: steering selected the second waypoint while translation still followed the first. The fix keeps both targets consistent. The local rolling diagnostic export remains available for other cases; it can be attached to the chat for later review.

Repeated equipment travel should compact dirt into visible worn paths. Comparable routes should prefer concrete, then established dirt, then fresh dirt, while preserving swept obstacle clearance and avoiding large unnecessary detours. Wear is accumulated only from actual accepted equipment movement and persists in saves. This is ground compaction; the planned consumable, machinery maintenance, and seasonal wear systems remain future work.

The creator reports a laptop hang/reboot, possibly related to memory exhaustion, and asks that the resumed work be careful with resources. The project files and an intermediate simulation checkpoint survived. The cause of the reboot is unverified. Testing now runs one file at a time with a capped Node heap, and Chrome checks are separated from heavy simulation runs. The complete-base regression revealed an unresolved approach/reservation stall; it must be fixed before this release is marked complete.

The resumed approach stall was reproduced from the saved full-base checkpoint. Builders left beside a completed slab occupied all four placement approaches; dock preflight rejected each pose before equipment movement could request yielding. Planning now treats stationary automatic workers as candidates to walk clear, then explicitly routes idle/assigned crew out of the future placement and withdrawal area during pickup preparation. Manual crew remains an obstacle. Actual movement keeps pedestrian and swept equipment collision checks. The checkpoint completed its remaining work at 8,581.9 simulation seconds, with the new focused six-cell regression covering the formerly blocked approach.

A clean full-base run then exposed an earlier resource cycle: an empty forklift beside stock repeatedly claimed a paving task while the excavator held that task's placement lane and could not approach the same stock. An idle, empty machine with its seated automatic operator can now be asked to drive clear of a blocked future dock before movement starts. Manual operators remain parked until commanded. A later stock row also blocked every sideways crew escape; walking clearance searches now include routes around the loaded turning envelope. Both mechanisms use actual checked routes.

A capped CPU profile identified duplicate generic slab-route searches during assignment/boarding, which custom physical handling immediately discarded. Slab allocation keeps qualification, capacity, fuel, manual assignments, source reservations, and worker/operator access checks, then uses the physical handling planner after boarding. Other construction types retain their existing preflight. Inaccessible slab approaches release their crew and reservations before pickup.

The final frozen simulation run passes all 167 regressions, including the clean complete-base save/reload scenario and material/fuel audits. The 12,000-second scenario bound remains unchanged; no free fuel, material creation, bypassed collision, or synthetic task completion is used. Browser/production verification and a freshly generated example follow in separate processes.

Final browser and production checks passed. Loading the freshly completed yard exposed excessive per-cell canvas filtering; the renderer now paints one bounded mask, blurs it once, and skips unchanged paused updates. The final browser check covers 3,427 actual worn cells and the maximum 12,000-cell rendering map. The fresh example completes 145 construction tasks, two real refueling jobs and 19 departed deliveries, with balanced material and fuel records. Existing saved dates/cost history are preserved; newly recorded labor follows the real-time clock.

Publication outcome: version 0.8.0 deployed successfully at 20:32 UTC on the same private Site and origin. The public MIT repository and downloadable project retain the corresponding source, design grounding, current example and verification records. The cause of the creator's earlier reboot remains unverified; subsequent heavy checks ran separately with capped simulation heaps.

## October 4, 2026 — shared delivery batches, weights, and stable terrain

The creator requests ordering or hiring several things together: a bus should bring a group of workers rather than a separate bus per worker, and one train should carry the mix of supplies needed for a plan. Individual weights and total quantity weights should be visible so the player can judge when trucks or trains make sense. This extends the existing requirement that transport and cargo remain real physical resources; a batch cannot become an unlimited invisible load.

The creator reports striped z-fighting across hardstanding in Screenshot 2026-10-04 at 22.44.25.png, and vegetation that sometimes jumps to different positions. Both are rendering defects to correct while retaining the accepted perspective and detailed grid style. Plants should clear affected construction or worn ground without reshuffling the rest of the landscape.

Version 0.9 adds a Purchase draft: set quantities, use Add on several rows, compare the road/rail packing preview, and commit with Place batch order. Direct Hire/Order remains available. Material manifests combine types within 12 t/6 m road loads or 48 t/16 m rail loads. Mixed worker roles share 12-seat buses. Equipment and services retain dedicated road carriers. The preview and catalog show unit/line weights, total cargo weight, carrier count, and committed cost. Every resulting carrier remains a separately tracked order, with actual crew, equipment, cargo handling, and invoicing. Manifest lines retain received quantities in saves, inspectors, diagnostics, and the order_lines SQL table. Existing single-item orders keep their contents.

The terrain correction addresses ground shadow/depth artifacts and overlapping gate/apron surfaces. Decorative vegetation uses stable world-space candidate seeds before filtering installed/planned or worn footprints, so removing a local plant cannot change the positions or shapes of unrelated plants. Validation and publication outcomes will be recorded after final checks.

Final outcome: all 175 sequential simulation regressions pass, including road/rail mixed-load conservation and mixed-role bus alighting through saves. Browser checks verify the actual Purchase controls, an 8,355 kg three-item manifest previewed as two truck loads or one train load, SQL line reporting, and dense layouts at 1440/1024/768 pixels. The corrected apron screenshot was visually inspected. Production checks pass without errors or external asset requests. Version 0.9.0 deployed at 21:25 UTC to the same private game URL; existing saves stay on that origin. Heavy checks ran separately with capped simulation heaps.

## October 4, 2026 — supported forklift loads, work checklists, and shed assembly

The creator observes that a forklift carries a rail panel on the very tips of its forks rather than on their working surfaces. They request that the forklift carry things reasonably. The intended correction is actual support beneath the load: orient a long panel across both forks, seat it over their working lengths, and keep that same position through lifting, transport, and setdown. The physical cargo envelope and clearance checks must match the rendered position; a visual offset alone would conceal the same handling defect.

The creator requests a checkbox list inside the equipment panel's Automatic work dropdown. A machine should be able to accept several selected job kinds rather than choosing only one exclusive role. The implemented checklist is shared by the equipment register and yard inspector, offers All and None, and preserves the open list and focused checkbox during live refreshes. Receiving deliveries, paving, building, rail work, and recovery / dismantling can be combined; rail construction still requires suitable equipment. Current work finishes safely before a changed selection applies, and explicit job assignments retain their existing override behavior. Older saved roles remain compatible. Driving, deployment, and worker-operated refueling remain available independently.

The creator also reports that an equipment shed magically appears after its kit is carried to the paved area. Their request is: “It should actually be built with a somewhat, at least schematically, realistic sequencing of events and with the help of the equipment and the worker.” This reinforces the original requirement that construction actually takes place. Delivering a kit should begin assembly, rather than complete the building.

The implementation response stages that same delivered kit at the site, then builds six anchors, six posts, three beams, four roof sheets, two wall panels, and one brace through individual collection, rigging, lifting, carrying, lowering, and fastening steps. Equipment handles structural parts while the worker prepares and fastens them; unfinished components remain visible and represented in inventory. The job inspector reports phase, installed component counts, and the current part. Save/reload and cancellation must preserve or recover the real remaining kit and work already installed. These component counts are an implementation choice for the existing shed design, not a new creator requirement.

Final outcome: version 0.10.0 passes all 189 sequential simulation regressions, the integrated browser suite, strict TypeScript/build validation, and production checks. Actual cargo support, seven-frame component/tool interpolation, ladder climbing, unfinished component counts, and the completed structure were verified; gameplay captures were visually inspected. Partial assembly and cancellation conserve the same kit through saving. The work checklist retains focus during live refresh and Escape closes it without clearing the selected equipment. A recovered office now backs clear before turning, and obsolete traffic detours resume their original destination when a blocker parks. The earlier compatible example is retained rather than represented as a new construction run.

Publication succeeded at 22:48 UTC on October 4 on the existing private game Site and origin. Source and documentation are updated separately in the public MIT repository and downloadable project. Heavy simulation and browser checks ran separately with capped simulation heaps. Construction remains schematic; complete-building recovery still uses the earlier whole-kit sequence.

## October 5, 2026 — one automatically assigned machine per work

The creator observes that two machines paving or unloading the same work get in each other's way and slow progress. They request only one automatically assigned piece of equipment for one work. The interpretation is one machine per outer construction work order across its child tasks, and one machine per physical delivery carrier across its lifts. Separate orders remain parallel. This is an automatic-dispatch default, preserving the creator's ability to assign equipment manually.

Sticky ownership is saved, displayed through linked machine IDs, and distinguished from explicit assignments. Current loads and active construction are protected during handoff. A machine that cannot continue because of role, qualification, fuel, operator availability or manual priority can release future work after finishing its current physical operation. Existing saves with several machines already working drain those operations safely before applying single-machine dispatch. Final outcome: all 204 sequential simulation regressions, integrated browser checks, TypeScript/build and production checks pass. Fifteen new cases cover ownership and safe handoffs, and the actual linked inspector, SQL owner and interface save/reload were verified. A visual inspection caught assignment controls clipping machine IDs; the layout was corrected and checked in the final browser run. Version 0.11.0 published at 12:57 CEST on October 5 to the existing private game URL. The public MIT source and complete downloadable project are updated separately. Simulation and browser processes ran sequentially with capped simulation heaps.
