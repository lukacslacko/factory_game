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

## October 5, 2026 — first chemical plant infrastructure, one checkpoint at a time

The creator wants to begin chemical plant infrastructure: more railway routes including switches and turns; an engine shed, owned shunter and driver; and tanks, tanker pumps, piping, gauges and valves. They explicitly ask to implement only one part in a pass, record the remaining work as todos, and stop for their test and approval before continuing. The selected first checkpoint is physical construction of curves and turnouts. The remaining railway operations and fluid systems are recorded in the development plan rather than started implicitly.

The initial implementation choices are a 20 m radius quarter-turn assembled from six separately handled 15° panels, and a 20 m modular turnout assembled from points, frog, closure and exit components at four stations. To keep actual freight widths plausible, the three later stations each contain separately carried through and branch panels: seven physical lifts in total. Those dimensions and module counts are implementation choices, not new creator requirements. They provide cardinal, grid-connected macro endpoints while allowing real curved intermediate rails. Track geometry, endpoint connections, material identity, placement, pickup and buffer orientation must agree. New train routing and a second terminal buffer belong to the next approved checkpoint; an unfinished or uncapped railway must be labeled honestly.

Final outcome: version 0.12.0 is published at the existing private game URL at 15:21 CEST on October 5. All 246 sequential regressions, the integrated browser suite, strict TypeScript/build and independent production checks pass. The actual interface orders and constructs a connected six-panel curve and seven-panel turnout, then sends a worker to throw the lever and preserves the route across Save/reload. A captured storage deadlock is reproduced and fixed through real loaded withdrawal and aligned stock approaches; the same save completes all panels and deliveries with conserved materials. Separate rendering fixtures measure 1,435 mm inner gauge and crossing geometry, and are distinguished from the actual construction screenshot. Source, documentation and release records are updated in the public MIT repository and downloadable package. Only this first checkpoint is completed; further railway or fluid work requires the creator's approval after playtesting.

## October 5, 2026 — individual GitHub issues and new operating feedback

The creator asks to file individual issues for the preceding railway/chemical requirements and these new requests, without implementing them in this turn:

- Electrical connections must require actual cable installation: excavate dirt, keep the spoil on neighboring cells, lay the cable and backfill. The creator has no strong preference between whole-route and cell-by-cell sequencing.
- A manually fueling worker should visibly hold the real diesel can in their hands.
- Equipment should move close to the actual barrel before refueling so the worker does not carry diesel across the yard.
- Automatic worker assignment should account for reachable walking distance, avoiding crossed trips between railway unloading and consecutive paving cells.
- Detect actors that block actual actions, such as shed roof placement or forklift parking, and move automatic blockers safely. At minimum, notify the player after a prolonged blockage, linking the affected action and blocker.
- Upload the original C concept artwork and track closer visual replication, higher contrast, brighter colors and more varied vegetation. Preserve the accepted perspective/3D world, grid behavior, approximately 80% A / 20% B refinements, Condensed records and dismissible guidance.
- Track a desktop implementation outside the browser, motivated by reliable file saves and continuing simulation in the background. No engine or packaging technology is selected.
- Track game sounds; the first sound set is still a design choice.

Outcome: [twenty individual issues](github-issues.md) are published and read back for exact body/title/URL/state verification. Nineteen remain open, while the curves/turnouts implementation record is closed as completed in v0.12.0. The original C Planning View image is uploaded unchanged as C-original-planning.png, distinct from the later toy option also labeled C, and embedded in the visual issue. Railway/fluid related-work links preserve the breakdown and the existing playtest/approval gates. No game code or hosted release was changed for this tracking request.

## October 5, 2026 — curved-panel delivery blockage and visible equipment intent

The creator ordered eight curved panels by rail. The excavator put three in a stockyard, then picked up one more and stopped with “Load needs a wider clear route to storage.” The message did not explain what was in the way. The creator requests debugging and fixing this case, and showing where selected equipment intends to go so movement problems can be understood directly in the world.

The exact three-plus-one failure was reproduced from an empty yard. The former clearance inflated every obstacle by half the six-meter panel width, incorrectly excluding the valid dock alongside its own partial stack. Loaded delivery routing now replays actual machine poses through the existing collision checks. The saved blocked state resumes, and all eight purchased panels finish in two physical stacks of four. Real dock obstructions retain the cargo and report the intended dock, target stack and blocking asset when identified. Final lowering waits for the tool tip to reach the target, avoiding a small sideways correction.

Selected equipment shows its accepted route and destination; when a route is unavailable, a distinct dashed intent line indicates the target rather than a validated path. The inspector exposes the current assignment phase and reason. Further railway and fluid checkpoints remain awaiting the creator’s playtest approval. Final verification and publication results follow below.

Broader verification exposed a saved traffic escape that could leave a carrying machine with no return path while still far from the storage dock. Delivery handling now retries that real loaded trip in forward or reverse gear, accepts an alternate clear approach when needed, and preserves the lifted load and detailed blockage message while waiting. Failed searches are spaced 1.5 simulated seconds apart. A focused saved-state regression checks the physical return rather than allowing remote lowering.

The first full run passed 253 of 254 tests and exposed a delivery merging a second curved panel onto an active rail job's single-panel staging supports. The captured movement history confirms the extra top-up rather than lost material. Receiving and recovery now distinguish those job-owned staging piles from ordinary partial stock. The installation code continues to require exactly its one reserved physical panel; ordinary stockyard top-ups remain available. Focused and final checks follow this ownership correction.

The now-progressing construction case exposed a source preflight that tested only the excavator's current reverse gear. The captured loading faces were clear with safe loaded withdrawal, but reachable only using a forward entry. Source preflight now considers both gears, matching actual machine movement. Failed initialization searches use the existing 1.5-second retry timer. A focused opening-state regression covers both the false reverse-only rejection and the retry limit. Equipment intent also identifies the reserved stock before a physical rail handling sequence has initialized.

A complete fresh simulation run passes 257/257 tests in 173.93 seconds with the same sequential 384 MB heap cap. Normal conservative delivery paths are retained, and the actual footprint search handles rejected long-load approaches. The original eight-panel blocked top-up and saved traffic-return cases complete with conserved materials and physically supported cargo. Browser checks and publication follow separately.

Visual review identified one stale-status frame after accepting a previously blocked route. The delivery note now immediately changes to hauling, with regression assertions in simulation and the browser. The final frozen fresh simulation run passes all 257 tests in 169.27 seconds; no simulation failures or skipped cases remain.

Final outcome: version 0.13.0 is published on the existing private Site and origin at 17:13 CEST on October 5. All 257 fresh sequential simulation tests, the integrated browser suite and independent production checks pass. The real eight-panel delivery completes into two stacks of four, including recovery of the reproduced blocked save. Browser checks verify accepted and unavailable routes, known blocker outlines and linked records, immediate resumed status and deselection cleanup. Actual gameplay captures were inspected. Compatible older saves load in production. Source and documentation are updated separately in the public MIT repository and downloadable project; issue #21 is closed. No further railway or fluid checkpoint was started. Heavy checks ran sequentially with capped simulation heaps and one browser.

## October 5, 2026 — reception trains and named shunting destinations

The creator wants railway goods delivered to different points along their built rails. An incoming line locomotive could bring several cars to a reception track, uncouple and leave through a connection at the other end; an owned shunter and driver would then distribute those cars to named loading/unloading places. Pumps naturally define transfer locations, while ordinary freight locations can be marked anywhere suitable along the track. Later, parallel reception tracks should allow multiple incoming trains and flexible shunting. The creator explicitly asks for subtasks and a parent GitHub issue, reusing existing issues, and only one suitable implementation checkpoint in this turn.

The breakdown is recorded under [parent #22](https://github.com/lukacslacko/factory_game/issues/22), with twelve native GitHub sub-issues. New issues cover the through reception connection (#23), inserting turnouts into existing straight runs (#24), named locations (#25), multiple physical cars per arrival (#26), coupling/uncoupling and line-engine handoff (#27), and parallel reception/traffic (#28). Existing recovery (#7), buffers (#6), shunter (#3), driver (#4), car movement (#5) and shed (#2) are reused. Car movement #5 now explicitly covers ordinary freight as well as tankers and named destination IDs. The existing pump-station issue #9 remains related; fluid construction is not folded into this checkpoint.

The selected bounded checkpoint is named rail service locations, a shared reference needed by both supplier reception and shunting. It provides editable name, purpose and centered interval on actual installed track, virtual map markers, linked dense records, save support and SQL. Length can span uniquely connected real panels; planned sections, gaps and ambiguous forks cannot be substituted for a physical interval. Removing track leaves a visible repairable record rather than silently relocating it. This is a planning designation, not an automatically constructed trackside sign or a claim that a train route is safe or commissioned. Supplier trains keep their existing original berth. The creator will review this checkpoint before additional reception or shunting implementation starts.

Final outcome: v0.14.0 published on the existing private Site and origin at 17:41 CEST on October 5. All 270 fresh sequential simulation tests, the integrated browser suite, TypeScript/build and independent production checks pass. The real interface creates, edits, repositions, selects, queries, saves/reloads and deletes a named location. Duplicate names, escaped text and the small-screen layout were checked; labels were improved after visual inspection. Compatible older yards and a named-location save import correctly in production. The public MIT source and complete downloadable package are updated separately. Issue #25 is closed, parent #22 remains open, and the next checkpoint is not started. Recommended next prerequisite: physical recovery of new track assemblies before inserting turnouts into existing runs.

## October 5, 2026 — batch rail work and small crews

The creator asked for this bounded change before track recovery #7: remove the buffer at the beginning of a multi-panel work order and attach it after all panels; optionally assign one machine to carrying/preparation and another to final placement; assign a worker who stays near a machine to rig and tighten its components. This explicitly authorizes implementation, not only discussion.

Decision: retain the default single-machine automatic work, add explicit staging/installation crew selectors on rail parent orders and dedicated builder/engineer helpers per equipment. Use original panel records and one real panel staged ahead, with actual operators, supporting stock, withdrawal and collision checks. Preserve shifts, manual control, physical cancellation and saves. Track recovery #7 is still unstarted. Track this release in #29, linked under railway parent #22.

Outcome: v0.15.0 is published at the same game origin. All 292 simulation regressions, final integrated interface checks and the production check pass. Source approaches now use a clear stop/alignment and explicit gear handoff; older mixed-gear saves resume physically. Batch cancellation restores the latest installed end, and staging checks the actual resting buffer. The release is the review checkpoint before #7.

## October 5 — Loaded forklift trapped beside fixed rail stock

Creator reports a forklift carrying a diesel barrel waiting for STK-0074 to clear its turning area. Fixed rail stock cannot move itself. Delivery ownership prevents the existing direct-control command, leaving no obvious player recovery. The blockage was easy to miss among ordinary Activity events; request explicit warnings filtering. The affected yard is in another browser/local instance, so its exact save was not inspected.

Implement a collision-checked aligned reapproach, safe pause / retained-operator manual driving / resume, durable blockage Inbox todo, and Activity Warnings/Info/All. Preserve supported cargo, real crew, destination reservation, carrier departure and invoicing. Do not allow takeover in a physical transfer. Validate equivalent fixed-stack and occupied-destination scenarios, save/reload, clickable warnings, and actual floor input. Track this scoped fix in #30; leave broader blocker behavior #17 and railway recovery #7 open.

Outcome: v0.16.0 is published at the same game origin; 301/301 sequential regressions, integrated browser controls and production checks pass. The source/test inputs remained unchanged across verification. The release includes compatible saves, diagnostic metadata and SQL severity; the next railway checkpoint remains deferred.

## October 5 — Rail helpers, manual priority, batch staging and one connected work

Creator reports support workers only walk to hang a panel after the excavator arrives; requested they always stay close. The initial collection drive occurs before detailed rail handling exists, and several travel phases lacked following. Extend actual nearby walking across those legs while preserving rigging, clearance and player/shift control.

Applying a two-excavator crew after automatic dispatch must replace that automatic assignment. Manual decisions take precedence throughout the factory. Release unloaded work immediately; preserve an already carried or partly installed load until a safe physical handoff. Prefer nearby feasible automatic equipment/operators instead of arbitrary distant choices.

The stager should carry the largest needed supported stack fitting capacity, and bring all required panels ahead rather than one-panel-ahead throttling. Track shared physical preparation piles and per-panel ownership, including cancellation, saving and material demand. No remote combination of separate source piles.

Additional creator steering: every 5 m placement currently requires a separate two-machine selection. Group connected planned joints into a whole-run work order, exposing one crew choice and keeping individual panel jobs and component geometry IDs. Do not merge crossings or merely close footprints. Track these corrections individually in #31, #32 and #33; railway recovery #7 remains outside this release.

Outcome: v0.17.0 is published on the same game origin at 19:33 UTC. Connected plans share a whole-run crew, automatic unloaded work yields immediately to manual choices, helpers accompany transit, and supported source stacks carry up to four straight or three curved panels within excavator capacity. The stager prepares all needed available steel independently of installation. Shared-stack cancellation/resume and a blocked curve buffer dock were reproduced and corrected with conserved assets and checked real routes. All 329 frozen regressions, final browser controls and production verification pass. Issues #31–#33 are completed; railway recovery #7 remains deferred.

## October 5, 2026 — boxed rail stock pickup and physical relocation

The creator reports rail construction stuck at Collect material, with equipment EQ0013, job JOB0377, and reserved stock STK0067. The screenshot shows the target near E40.5, S25.5 surrounded by other stored panels and a barrel, while the equipment explanation says the crew needs access to an exposed rail-panel edge. The actual affected save has not been inspected; the repair's reproduction is based on the screenshot and equivalent stock arrangements, not a confirmed replay of the creator's exact yard.

The authorized v0.18 repair addresses crew edge access and actual machine pickup/loaded withdrawal together. Safe intermediate panel-edge positions supplement corners. Before lifting, construction can fall back to an accessible source of the same catalog item and handed variant while retaining the player's assigned equipment/helper. New receiving, recovery, and planned stock drops must not seal the last exposed loading/rigging face of nearby rail stacks. This must preserve the already approved dense concrete storage, including adjacent slab cells and stacking, rather than globally adding wasteful gaps.

Existing boxed stock also needs a physical recovery action. Select an exposed outer rail stack, use Relocate one rail panel, then click a clear original-footprint destination inside a stockyard. One work group moves one panel from that exact source using a real operator, rigger, suitable forklift/excavator, lift, carry, supported lowering, and withdrawal. It does not install rail or touch the buffer. Repeating the move opens access through stacked outer panels. Existing reservations must be released through their waiting work or a different unreserved outer panel chosen; no remote source substitution or teleportation is allowed for the explicit relocation.

This is a bounded stock-access checkpoint. Railway recovery #7, reception/shunting/fluid work, and broader construction/parking blockage #17 remain separate. Code and verification are still in progress; testing and publication outcomes belong to the release records after final checks.

Outcome: v0.18.0 published on the same game origin at 20:11 UTC. Equivalent enclosed-stock and obstructed-edge scenarios, reservation fallback, physical forklift/excavator relocation, carried/supported saves and cancellation, rotated handed steel, warning recovery, future-footprint reservation and dense slab capacity pass. All 350 frozen regressions and final browser/production checks pass. The actual creator save was not inspected. Issue #34 tracks this correction; railway recovery #7 and the next railway/chemical checkpoint remain deferred.

## October 5, 2026 — native desktop migration discussion

The creator wants a non-browser game that continues while its window lacks focus, supports proper file saves, and can be tested without launching Chrome. They ask which engine to download and for setup instructions. This follows existing GitHub issue #19. This turn is a recommendation and setup discussion, not an implemented migration or a confirmed engine choice.

Inspection confirms that the existing TypeScript simulation already has 350 browser-free Node regressions. Browser dependencies are concentrated in the Three.js rendering, HTML interface, save dialogs/storage, and requestAnimationFrame-driven clock. The recommended direction is standard stable Godot 4, with native 3D and dense native controls. Preserve the tested simulation initially in a bundled Node process, communicating with the native game through local pipes; this proposal requires integration and packaging work. A later full simulation port can be considered separately. Electron is quicker to wrap but embeds Chromium; Unity is a credible alternative, while Unreal adds unnecessary complexity for the current scope.

The first proposed checkpoint is a small native playable slice: perspective yard, camera controls, equipment movement, an independently ticking simulation while unfocused, JSON save import, and atomic file saves with backups. Verify that checkpoint before porting all tables and workflows. Headless tests cover simulation and nonvisual integration; rendering still needs native visual review. The application must remain running and the Mac awake; progress during sleep or after quitting is a separate design decision.

Setup recommendation: download the standard Godot Engine macOS Universal stable release from https://godotengine.org/download/macos/ (4.7.2 at this check), extract Godot.app into Applications, launch it once, and optionally verify its version using the executable inside the app bundle. Node and Git are already available locally. Install matching macOS export templates through Editor > Manage Export Templates when the actual native project is ready to package. No engine was downloaded or installed in this turn.

## October 5, 2026 — native lighting and concept-art fidelity

The creator asks whether Godot can provide beautiful lighting and emphasizes that the original concept C aesthetic is an essential destination. Native migration must preserve this visual goal, not merely reproduce the current procedural visuals in another engine.

After reviewing the original C image and official Godot lighting documentation, the recommendation remains Godot. Its lighting, shadows, ambient occlusion, reflections, indirect lighting, and color controls support the needed visual ingredients, subject to renderer choice and measured hardware performance. Reaching the reference also requires better machinery and building geometry, material variation, layered vegetation, camera composition, and ground detail. Installing an engine or enabling effects alone does not establish that result.

Before a broad interface migration, propose an actual native visual proof scene matching the reference composition: track, an excavator, containers, stock, and vegetation, viewed in daylight and dusk. Review native screenshots and performance on the creator's Mac before committing to the full visual implementation. Retain grid-aligned construction, true perspective, readable game objects, and the dense Condensed interface. This proposal has not been implemented or approved as the next work checkpoint.

## October 5, 2026 — approved native visual proof

The creator installed standard Godot in Applications and opened it once to approve the macOS download notice. They authorize the proposed Godot visual proof scene and want to inspect it before a gameplay migration. The original concept C image and accepted 80% A / 20% B studies remain the visual anchors.

Implemented a separate native-proof project: true-perspective grid-aligned yard, standard-gauge turnout and four-axle flatcar, shaped excavator/forklift with mechanical details, grounded workers, truck, corrugated office/WC containers, physical stock and rubble bin, terrain maps and deterministic instanced vegetation. Provide daylight/dusk and smooth camera presets, floor dragging, view-relative WASD, orbiting, zoom, grid and native screenshots with a small Condensed-style toolbar. Terrain maps are verified CC0 assets with retained credits; code and procedural models use the repository MIT license.

Verified Godot 4.7.2 / Forward+ / Vulkan on the creator's Apple M2 Pro. Headless normal checks and dispatched-input checks pass; actual native controls and the macOS launcher were reviewed. The final four-view capture suite completed in 23.89 seconds, with 60 FPS at 1440×900, 16.66 ms median frame times and roughly 387 MB sampled peak resident memory (repeated full proof checks 387–529 MB). Automated processes are sequential and have a 2 GB / bounded-time watchdog because of the earlier laptop hang concern. These are short static-scene measurements, not full-factory scalability results.

Corrected shadow acne at dusk, lamp self-occlusion, custom mesh winding, texture mipmaps and foliage color space. A covered macOS window suppressed normal drawing and originally stalled screenshot waits; explicit offscreen draws corrected the harness. No browser was launched for native proof testing. Actual screenshots and reproducible validation are saved with the project.

The native window is left open in the daylight yard view for the creator. This is a visual proof with static example assets; the tested browser simulation, saves and Site are unchanged. The models, ground and foliage are still a first art pass with a visible gap to the generated reference. Review this result before integrating the simulation, file saves and background clock. Native migration issue #19 stays open.


## October 5, 2026 — concept C fidelity revision

The creator rejects the first Godot proof as weaker than the newly supplied concept C reference: too little brightness and contrast, unpolished rails without highlights, pixelated edges, bland materials and insufficient detail. Their instruction is to continue improving actual native renders until they look similar. The supplied image is retained as `C-native-target.png`, alongside the original C and accepted A/B studies.

Revise the scene itself, rather than supplying new generated art. Add true rounded machinery edges, reflective glass and polished pistons, curved rail crowns with smooth normals, concrete panel sleepers and fittings, physically layered slab stock with recessed lifting sockets, container fasteners/gutters, a supported truck load and six grounded workers. Improve sun/shade separation and cloud-sky reflections; enable Retina output, temporal antialiasing, 4× MSAA and 16× anisotropic filtering.

Compare repeated native captures against the target. Correct the first revision's excessive exposure, lime foliage, white grid, flat ballast and cropped foreground. Tighten the practical yard layout while preserving meter-scaled assets, standard gauge and grid alignment. Layer olive shrubs, short curved dry/green tufts, stones and granular sandy soil. Avoid broad grassy blotches and dominant paving. Thin power wires retain their geometry but stop casting stippled subpixel shadow artifacts. No browser is needed for the native tests.

Keep this checkpoint a static visual proof; native gameplay, save import and background simulation remain the separately approved future migration work. The playable web game is unchanged. Final render and verification results are recorded below when complete.


Outcome — October 6: the revised native scene and six unedited Godot captures are complete. Daylight has stronger light/shade separation, continuous steel and hydraulic highlights, rounded machinery, aged stock, layered olive crowns, short curved grass and clustered stones. Capture-guided shadow diagnosis found PCSS bands at dusk lamps; fixed filtered lamp shadows corrected them, and the equipment view at dusk was added to verification.

Godot 4.7.2 / Forward+ / Vulkan on Apple M2 Pro rendered six 1920×1080 views in 30.16 seconds without engine errors or watchdog intervention. Yard daylight/dusk measured 60 FPS; equipment/trackside/close dusk measured 54–55 FPS. Median per-view frame times 16.66–18.39 ms, p95 below 19.34 ms, sampled peak resident memory 671.9 MB. These short static-scene checks do not establish large-factory scalability. Geometry and native input checks pass: 118,126 custom/instanced triangles with zero winding/normal failures, and 22 herb triangles. Actual launcher, camera presets, daylight/dusk, floor drag and Grid were reviewed in the native window, which is left open at daylight Yard. Tests used one guarded 3D process at a time and no browser.

The target is preserved for later comparisons; the scene is an engine-rendered interpretation and remains a visual proof. The browser game, saves and 350 simulation tests were not modified; gameplay migration and file saves remain future work under #19. Source, screenshots and measured verification are included in the public project.


## October 6, 2026 — approved native visuals and playable migration

The creator called the revised Godot scene beautiful and approved migrating the existing game into that framework and visual style. They authorized autonomous overnight work without questions. They subsequently clarified that there is no old saved yard, so backward compatibility should not consume extra effort.

The migration preserves the tested simulation in a local Node process and replaces browser rendering and controls with Godot. The explicit priorities are the approved bright, detailed perspective yard; physical deliveries and work rather than visual shortcuts; dense text-first registers and clickable references; independent background simulation; and reliable file-backed saves. The old static proof remains a reference, while the native yard is populated by live simulation entities. Tests and screenshots must come from the actual native game, and renderer runs remain bounded and sequential because of the earlier laptop hang.


Outcome — the first playable native migration is implemented as `native/` plus `native-runtime/`, with a self-contained Plant 01 Mac app. It retains the existing gameplay simulation and uses the accepted bright Godot materials, perspective and lighting for live entities. Native controls cover batch purchasing and mass, workers, deliveries, storage, building and rail plans, assignments/work groups, parking and shifts, linked sortable/filterable registers, notifications, diagnostic recording and SQL. An independent fixed-step process advances at real-time 1× while the renderer is unfocused; autosaves, atomic files, backups, chosen-path portable saves and normal shutdown are verified. New saves are the priority; existing import works through the already established loader without additional compatibility engineering.

The unchanged preexisting simulation suite passed 350 tests, and the native boundary passed eight integration tests. UI, entity picking, fixed fork support geometry, smooth attachments, stable vegetation, keyed scene updates and exact track previews pass headless checks. Twelve unedited 1920×1080 captures from actual gameplay completed in 28.04 seconds with 564.6 MB sampled renderer peak, under the sequential watchdog. Eight states were reached by real procurement/construction work over 110,784 simulation ticks. Capture review corrected forklift mast linkage, trailer ramps, bed heights, suspended-load slings, completed roof joins, staged-stock duplication, buffer height and vegetation intersections; it added actual fuel cans, shed anchors/components and detailed correctly spaced railway vehicles.

Actual native UI review caught and fixed unreadable popup menus and typed quantities that required Enter. Hands-on review also verified batch ordering, mass, sortable deliveries, linked inspectors, area paving, parent work controls, lighting, Command-S, the macOS export dialog and saved file contents. The packaged app passes its own full integration check using its bundled runtimes, including background time, pause, SQL and saving, and opens through macOS Launch Services. An overnight UI call was delayed while the Mac was asleep; its six-minute guard stopped the isolated app test. The later successful launch is ready at the fresh yard-selection screen. Test state remained in temporary directories.

The application is the first native playable checkpoint, not a large-factory scalability certification or a notarized public binary. Chemical production and the remaining reception/shunting mechanics stay in their existing issues. The web deployment is unchanged. Native instructions, architecture, real screenshots, fixture saves and measured results are included in the public source.

The completed native source was pushed as `d18bc6e`, and the self-contained Mac app was published in public prerelease `v0.19.0`. Migration issue #19 records the checkpoint and remains open for playtest feedback. The local app is ready at the fresh yard-selection screen; no test game was saved in the normal user folder.


## October 6, 2026 — native camera and visibility feedback

The creator confirms that the migrated game works and looks gorgeous. They request working Mac touchpad scrolling alongside the mouse wheel, smooth ground dragging, a clearly visible optional grid, reversed vertical right-button orbit movement, and distant shadows that remain visible. Preserve the approved visual treatment while correcting input and visibility.

Implementation replaces mouse-event camera snaps with frame-time smoothing and an absolute ground anchor picked through the frozen camera at mouse-down. Mac phased two-finger scroll events and high-precision wheel deltas now drive continuous zoom; pinch remains available. Enable the grid material at startup, draw antialiased 1 m lines and stronger 10 m guides on dirt and installed paving, and reverse the vertical orbit delta. Extend sun shadows through the full visible camera range, retain them without fading before that range, and concentrate the existing four shadow maps around the working distance without increasing their texture size.


Validation found an additional performance cost at the creator’s larger Retina view: native 3456×1944 rendering measured about 25 FPS even with continuous camera updates. GPU temporal reconstruction improved this to about 44 FPS while keeping full-resolution controls and text. At 1920×1080 the camera runs around 58 FPS. Preserve a saved full-resolution graphics option for the creator to choose detail versus motion. The Apple temporal upscaler failed in an isolated test and was removed; use GPU FSR2. The camera and toggle regressions pass 44 checks, with actual grid-on/grid-off and overview-shadow captures. The creator’s active yard was saved and gracefully closed before sequential tests; replacement of the app must preserve that file and resume the existing yard.

Outcome: the rebuilt v0.19.1 app passes its bundled-runtime integration check in 6.63 seconds with a 292.5 MB sampled renderer peak. The actual saved yard reopened successfully with its original six workers, costs and deliveries. Native scrolling, floor drag, Grid shortcut and the large Retina window were reviewed. The app is left running on that existing yard. Source, three new unedited visibility screenshots and measured camera checks are retained for the public patch.


## October 6, 2026 — visible construction ghosts

The creator reports that markers for items to be built are difficult to see, particularly planned rails. Improve construction intent rather than changing the accepted physical art. The native renderer previously skipped all planned rail geometry and used faint dashed rectangles for every job.

Queued rail jobs now show their canonical rail paths, curves, turnout branches and sleepers as bright cyan ghost geometry with dark edging and a translucent corridor. Work underway uses amber; cursor previews use green or red for valid or invalid placement. Other jobs have stronger footprints, and office/sanitary/shed/store plans include a three-dimensional wireframe. Annotations remain unshaded and visible through vegetation, cast no physical shadows, do not alter collisions or clear plants, and reuse keyed meshes until their plans change. Finished and canceled work removes the ghost. Avoid recreating hundreds of per-cell cursor meshes for rail layouts. Add the color legend to the controls tooltip and native instructions.

Outcome: 61 focused ghost checks pass, including canonical straight/curved/turnout paths, keyed reuse, planned-versus-installed separation, vegetation stability and finished/canceled cleanup. Existing renderer checks also pass. Four unedited GPU captures show 82 real planned jobs and 14 planned rail geometries in daylight, dusk, and valid/invalid cursor previews. The final sequential capture took 8.62 seconds with 584.2 MB sampled peak renderer memory. The self-contained v0.19.2 Mac app passes its bundled-runtime integration check in 6.61 seconds with 295.7 MB sampled peak, including saving, background time and SQL. Test saves remain isolated in temporary directories. Actual screenshots and measured results accompany the public source.

The updated app reopened the creator’s existing yard successfully (six workers and $97,686 in recorded costs), with visible paving ghosts. The saved game was continued and its large window restored; no test plans were added to it.


## October 6, 2026 — grounded, stable construction ghosts

The creator likes the stronger ghosts but reports nervous subpixel vibration and an incorrect 3D illusion when ghosts draw in front of workers placing slabs. They request floor markings on the ground with normal occlusion. The previous ghost material disabled depth testing and put even solid strokes into the transparent pass. Restore ordinary depth testing; render solid outlines in the opaque pass so they participate in temporal antialiasing and motion vectors. Keep only the footprint wash translucent. Place floor markings a few centimeters above soil or installed paving, and update cached plan heights as foundations are installed. Preserve bright color coding and real rail geometry.

Outcome: 115 focused checks pass, including ordinary depth testing, opaque depth-writing strokes, soil/paving heights, neighboring paving exclusion and cached-plan updates. A static GPU fixture reproduced cyan ghosts painting over an opaque obstacle: 204 pixels with native TAA and 207 with Retina-style FSR2; both drop to zero. Over 12 consecutive frames per configuration, mean ghost-edge-region variation on an 8-bit scale falls from 9.0971 to 0.8511 with FSR2 (about 91%), and from 0.7752 to 0.6384 with native TAA. These are fixed-camera fixture measurements, not a claim of zero temporal noise in every scene. Four real-game daylight/dusk/placement captures retain clear outlines with natural vegetation occlusion. The GPU comparison completed in 19.74 seconds at 506.7 MB sampled peak; an initial test-harness frame wait hit its 40-second watchdog and was corrected to explicit draws. The real-game capture passes in 8.62 seconds at 584.9 MB, and the bundled v0.19.3 app integration passes in 6.62 seconds at 287.5 MB. All test state is isolated from the creator’s saved yard.

The updated app reopened and continued the creator’s original saved yard successfully, preserving its six workers, $97,732 cost record and queued construction. Workers and a forklift were reviewed during paving with the corrected ground markings. No test plans were added to that yard.


## October 6, 2026 — remove decorative roadside powerline

The creator reports dotted shadows from overhead electrical wires. Since buried electrical construction is already planned in GitHub issue #13, they request a minimal change: stop placing roadside poles/wires, retaining all assets. Extract the existing native corridor powerline builder into an unused helper. Public road and railway remain intact, player-built equipment and utilities are unaffected, and the static concept/proof assets remain available. This is only the removal of decorative placement, not implementation of underground cabling.

Validation: the existing headless renderer regression passes in 1.51 seconds with 247.3 MB sampled peak resident memory; native build passes. The player’s current yard was saved before replacing the app.

Outcome: the updated v0.19.4 app was opened and visually reviewed. The roadside poles, overhead wires and dotted shadows are absent. The original yard continues with eight workers and its $126,668 recorded costs; no test plans or gameplay changes were introduced.


## October 6, 2026 — trapped pedestrian and equipment deadlocks

The creator reports a stuck EQ-0019 in their running native yard and explicitly requests general prevention rather than a one-off rescue. Inspect the running yard and preserve a local reproduction. EQ-0019 approaches reserved curved rail stock for JOB-0126, blocked by idle WRK-0011 (Worker #2) at E41.6/S31.5. The worker is boxed between the excavator’s boom/body and a row of concrete stacks; even a fine 0.125 m walking search finds no physical exit. Route retries assumed the worker could yield and repeatedly attempted the same turn.

Implement a short straight reverse maneuver replayed against actual swept footprints, people and cargo before accepting it. Execute normal movement, retain the work destination, and prevent rail-source alternate-face retries from replacing an accepted traffic escape. This applies to ordinary machines rather than only this ID or rail work. A retained destination with an empty route must remain active and be retried. Track physical blockage independently from route retries, issue one actionable Inbox notice and warning-severity Activity event after 20 seconds, and resolve that notice on movement recovery. A genuinely enclosed yard must stay safely blocked rather than teleporting actors or stock.

The first full saved-yard replay exposed a second load clearance case: a three-panel suspended rail batch blocks the worker more than 8 m from the chassis. Use an explicitly confirmed swept blocker rather than the old center-distance assumption. For each candidate reverse endpoint, also preview a real worker walking escape; avoid a retreat that merely moves the chassis without opening the pocket. Wait for the accepted walking route before resuming work. Protect that wait centrally even if another handler tries to populate a machine path, but retain rail alternate-lifting-face recovery when the old destination has become genuinely unreachable. Avoid repeatedly assigning a completed walking escape from a stale blocker.

Outcome: all 364 simulation and native-runtime regressions pass in 288.87 seconds, run sequentially with a 384 MB Node heap limit. Six focused recovery tests verify continuous collision-safe driving/walking, a single coordinated retreat in the compact fixture, unchanged stock and attached cargo, the distant carried-load blocker, warning resolution after opening an enclosure, and valid saved recovery state. A cloned capture of the actual yard runs for 480 simulated seconds and completes JOB-0126 with its panel installed and staged batch observed, using two separated clearance retreats and no traffic warnings. No replay state was imported into the live yard. The rebuilt self-contained v0.19.5 app passes its isolated integration check in 6.59 seconds with 290.4 MB sampled peak renderer memory. The creator's actual save was retained and continued; EQ-0019 moves away from the original blockage and is visibly carrying three curved panels toward staging at E126.6/S33.9 with no blocker. Leave the updated app running on that yard.


## October 6, 2026 — delivery vehicles request pedestrian clearance

The creator reports road delivery vehicles waiting for a worker who never moves. They suggest a targeted honk/request, or another reliable coordination mechanism, and ask for a sound issue if one is not already present. GitHub issue #20 already tracks audio; extend its scope with spatial horns on actual clearance requests, cooldowns, saved audio controls and no historical replay after loading. This patch implements physical cooperation and visible requests; it does not implement audio.

Existing carriers only search perpendicular escape targets and reject every worker with a walking path, including a path blocked by that same truck. Expand the bounded refuge search around the actual upcoming driving corridor. Permit narrowly scoped rerouting of an automatic ground worker's mutual wait after one second, preserving its interrupted return destination and checking actual walking clearance. Respect manual/rest duty, off-site workers, boarding/transport, delivery operations, elevated work and ladders. Record the addressed worker once per blocked episode. Track continuous carrier blockage independently of look-ahead braking, issue one linked warning after 20 seconds, and resolve it when the route clears.

A second scheduling cycle is visible in the source: a worker who yielded to an arriving truck remains unavailable until the entire order finishes, even if unloading itself needs that worker. Release the worker when the carrier has parked or physically departed, returning to the earlier destination only along a safe route. Wait for the vehicle's motion to pass rather than for its cargo paperwork to close. The creator's earlier play state is not captured; use compact equivalent physical reproductions and do not claim that exact incident was inspected.

Outcome: all 370 regressions pass in 289.09 seconds, run sequentially with a 384 MB Node heap limit. Six new compact physical regressions cover obstructed side refuges, interrupted routes and preserved yield destinations, the sole builder becoming available to unload the truck they yielded to, manual/rest control, warning deduplication/resolution and saved recovery state. Existing carrier, delivery and traffic checks pass (63 tests). Native UI checks pass for 11 tabs and 10 inspector types in 1.52 seconds with 252.6 MB sampled peak resident memory; the self-contained v0.19.6 package passes isolated integration in 6.59 seconds with 322.2 MB sampled peak memory. The actual saved yard is retained and continued with 12 workers and $250,196 recorded costs. No reproduction fixtures were imported into it. The delivery inspector now links the driving blocker and addressed worker. Sound issue #20 was updated rather than duplicated; audible horns remain pending audio work.


## October 6, 2026 — rail staging requests clearance; visible manual driving

The creator reports a two-excavator rail crew deadlock: the staging machine refuses to collect stock because the idle installation machine occupies future preparation space, but the installer receives no request to clear it. They want useful loading/travel to continue while temporary site occupants can move. They subsequently move an excavator manually, find it no longer resumes work, and request a clear distinction between manual driving and automatic equipment plus an easy release action.

Separate future preparation-site preview from executed collision checks. In that future-site preview only, omit nearby empty temporary machines and suitable ground occupants; retain static structures, supported stock, active loads/work and actual source pickup access. Request the identified site occupants to clear the load footprint, docking/turning area and empty withdrawal corridor while source collection is underway. An idle empty machine with a real seated automatic operator and fuel selects and physically drives to checked refuge. No pushing, teleportation, invented operator, fuel or stock is used. Manual/rest control, occupied lifting, unattended/unpowered machines and shift restrictions remain protected. An occupied landing cannot advance the lowering animation or create supported stock. Saved request ownership deduplicates events and 20-second warnings; work details and equipment references link the actual blockers.

Make manual driving visible in the equipment inspector, Equipment register, and vehicle-specific driving bar. Put Return to automatic work at the top of a manual machine's inspector and Return to automatic in the driving bar. The shared release command stops idle manual routes and stale traffic intent, preserves the seated operator and active physical assignments, and resumes paused delivery handling through its existing safety checks. Reject unsafe paused transfer without changing its manual state. Releasing duty does not bypass shift schedules.

A read-only capture of the actual current yard is retained locally. An isolated 600-second simulation of that capture, restoring its four manually controlled seated operators to automatic duty, picks up/stages the current load and finishes four previously queued rail jobs. It also exposes remaining independent rail-source access and rigging-worker waits; do not claim the entire larger yard is free of all deadlocks. No replay or release command from that simulation is imported into the live save.

Outcome: all 382 regressions pass in 298.87 seconds, sequentially with a 384 MB Node heap cap. Six new staging-clearance regressions verify conserved four-panel batches, actual safe driving and walking, automatic installer clearance, manual approach and release, saved warning/request ownership, blocked lowering, static obstructions, and unpowered/unattended protection. Additional control regressions verify stale manual-route cancellation, retained active load/work, shift limits, safe paused-delivery resume/rejection, and the native release command. Native manual-control UI checks pass in 1.02 seconds (152.1 MB sampled peak); all-screen UI checks pass for 11 tabs/10 inspector types in 1.53 seconds (264.0 MB). The self-contained v0.19.7 app passes isolated integration in 7.14 seconds (313.2 MB sampled peak). Save the latest live yard before replacing its app, retaining the previous build in a local temporary backup. Continue the creator's current yard with 12 workers and $250,290 recorded costs; its manual operator modes are preserved for the creator to release through the new controls.


## October 6, 2026 — occupied rail installation destination

The creator pauses another deadlock and authorizes inspecting and operating the running game. Preserve its exact save locally. EQ-0019 carries a turnout closure module for JOB-0395 at E107/S51.5; its planned installation dock is E111.17/S45.36. EQ-0489 is idle, fueled and occupied by an automatic operator at E112.5/S41. Its chassis/boom occupies the required final cargo/handling footprint. The actual route planner correctly rejects both gears, but the handler returns a generic route failure without asking the identified blocker to move. Earlier staging clearance only handles preparation-site occupancy. Removing EQ-0489 in a read-only route preview produces a short valid approach; no geometry or source-stock alteration is necessary.

Share addressed clearance coordination between staging, installation approaches and buffer placement. Protect the destination chassis, attached cargo and full arrival-to-alignment sweep, with an explicit buffer landing footprint. An idle fueled machine with its real automatic operator drives to a checked refuge. Retain manual/rest duty, unattended/unpowered machines and active handling. Actor-relaxed future route preview allows useful approach, while every executed movement still checks actual swept collisions. Alignment and lowering cannot advance through an occupied destination, including an occupant arriving after a lift begins. Save the clearance area identity, requested IDs, retry and warning ownership; expose linked handling blockers and one warning after 20 seconds, resolving it when clear. Do not teleport, fabricate stock/operators, remove static obstacles or alter player assignments to rescue the save.

The first isolated 600-second replay of the exact paused yard, preserving all manual duties and work assignments, completes all seven remaining rail jobs (JOB-0395, 0396, 0397, 0400, 0403, 0406, 0409). No replay state is imported into the creator's yard.

Outcome: 382 existing regressions pass in 297.85 seconds and six new physical installation-clearance regressions pass in 0.52 seconds, sequentially with a 384 MB Node heap cap. Cases cover the captured turnout geometry, buffer placement, manual release, saved/deduplicated warning ownership, unpowered actors, frozen late-occupied lowering, collision-safe driving/walking and conserved material. Native UI checks pass for 11 tabs and 10 inspector types in 1.52 seconds (268.8 MB sampled peak); self-contained v0.19.8 integration passes in 7.10 seconds (298.3 MB sampled peak).

Save the real yard, retain the previous app in a temporary recoverable backup, install the update and continue its actual save. Observe JOB-0395 completion and the next crew's work through normal simulation. During accelerated verification six of the seven queued rail jobs complete; EQ-0019 is empty and available, and the last rail job remains queued/collecting. Restore 1×, pause and save at D1 12:27:26 with all 12 workers and the same $250,384 cost record. Manual forklift duties are unchanged. An independent preexisting refueling order still lacks diesel in storage; no resource is fabricated to satisfy it. Leave the actual game paused near the recovered rail work.
