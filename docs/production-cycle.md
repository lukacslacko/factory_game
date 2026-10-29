# First production cycle

This version adds a fictional recipe: **raw reagent → refined reagent**, one liter in and one liter out. Both liquids have density 1 kg/L. Raw reagent costs $0.30/L before rail service; shipped refined reagent earns $0.85/L. There is no spending limit, and all recorded costs remain visible alongside sales revenue. Heat, pressure, byproducts, catalysts, and chemical hazards are not simulated by this recipe.

To try the complete plant, import [First production cycle](../examples/first-production-cycle.json) through the game menu. The synthetic example starts paused with two storage tanks, an assembled and powered reactor, independent unloading and loading lines, an empty received tanker, and about 800 L of product already in storage. Import backs up the yard it replaces. It uses Creative placement for construction; all received liquid and produced material came through the normal tanker and reactor commands. No player save is included.

## Build the plant

Open **Process**. Place a **Tank · 30,000 L** for feedstock, a second tank for product, a **Batch reactor**, and two **Rail pumps**. Purchase their kits, slabs, construction equipment, operators, and support workers through Purchase / hire. Ordinary construction physically delivers and erects the assets. The reactor kit weighs 5,400 kg and needs a 6-ton excavator; it occupies a 6 × 6 m paved foundation. The crew installs its base, vessel, pumps, frame, roof, and controls. Creative mode places the same completed components immediately.

Keep each railway pump within 8 m of the stopped tanker's discharge fitting, and keep its hose work point clear for an engineer or builder. Leave access around the reactor and tanks. The reactor's built-in feed and discharge pumps are part of its kit.

## Supply electricity

Build commissioned underground circuits through **Electrical**. Each railway pump needs 2 kW and the enabled reactor needs 8 kW. The incoming station supplies 16 kW shared with lights and other loads. Connected, tested cabling is required; an incoming station alone does not energize a building. Plan and commission these routes before surrounding the equipment with dense piping: trench crossings through installed process equipment are not supported.

## Receive and store feedstock

Use **Process → Order feedstock**. Choose Raw reagent, liters per car, car count, and a connected receiving point. The form quotes payload, tare, train length, and purchase/service cost. A car holds up to 30,000 L. Railway help explains the second mainline connection, supplier locomotive release, shunting, and named receiving locations.

Connect the unloading pump's pipe port to the feed tank. Select the pump, choose **Unload tanker into tank**, select the feed tank, and click **Apply destination and rate**. Choose the stopped tanker and **Request worker to connect hose**. After the worker finishes connecting, start the pump. Open any manual valves with a worker. Liquid fills the finite pipe volume before entering the tank. Stop and request disconnection when the car is empty.

## Connect the reactor and product storage

At default rotation, the reactor inlet is on its west boundary and its outlet on the east boundary. Both sit 2.5 m from its north edge, at the same 0.85 m centerline height as other process piping. R rotates the building and its ports. Tanks retain the four existing fixed side ports.

Build one continuous pipe route from the feed tank to the inlet and a separate route from the outlet to the product tank. Drag the pipe tool for straight runs and rotate elbows as needed. Keep raw and refined circuits separate. Select the reactor to see its actual inlet and outlet routes; a closed valve or unfinished gap blocks the corresponding operation.

## Run batches independently of trains

Select the reactor. In **Batch setup**, select the feed and product tanks, choose 100–1,000 L, then apply. **Start / resume reactor** enables repeating batches. Its built-in pumps fill and discharge at up to 5 L/s; each batch reacts for 60 seconds. The vessel contents change from raw to refined reagent only when the reaction finishes.

The product tank buffers the process. No product tanker or connected loading hose is needed for reaction and discharge. Product remains in storage until you choose to ship it. A full product destination pauses discharge with the remaining batch retained. Missing feed, power loss, an incompatible liquid, an incomplete route, or a closed valve also stops progress without deleting material. A sustained stoppage appears as a persistent **Production blocked** warning. Pausing the reactor preserves its batch and elapsed reaction time. Finish the current batch and stop before changing the tanks or batch size.

## Load product later

Use a separate railway pump and pipe line from the product tank to an emptied delivery tanker. This first version reuses the emptied feedstock cars; ordering additional empty export tankers is not part of this release. You may return unwanted empties through the existing railway workflow and keep selected orders for product loading.

Select the loading pump, choose **Load product from tank**, select the product tank, and apply. Choose the emptied tanker, request hose connection, and start loading. The tank can continue receiving reactor output while the loading pump draws from it. Loading is limited by the source inventory, line capacity, pump rate, and car capacity. Raw residue in the loading line is an incompatibility, so use an independent product line. An inbound car must be completely emptied before accepting product. You can ship a partial product load.

The example yard is ready for this step: stop its unloading pump, request hose disconnection, then configure and connect the nearby second pump for product loading. Use the linked pump and tank IDs in Process rather than coordinates.

## Ship and receive payment

Stop loading and have a worker disconnect the hose. Release the supplier locomotive if it is still attached. Use a shunter to bring the selected cars together at a connected collection point and park it clear. Open **Ship product** in Process or Railway, choose the delivery orders containing loaded product, optionally choose the named collection point, and request pickup. All selected cars must be reachable in one contiguous consist; empty cars in those orders may accompany the product. This uses the existing mainline collection, track reservations, railway crew, coupling, brake test, and physical departure.

Loading and booking pickup do not create revenue. After the loaded train leaves, each sale is paid exactly once for its actual loaded liters at the recorded $0.85/L price. Pickup service and waiting charges are separate costs. **Process → Product sales** shows the car, loaded quantity, rate, shipment state, and payment. Click a sale ID to inspect its linked tanker and payment entry. **Costs** records sales as negative amounts, so its total is net costs. Construction spending remains separate; a small first shipment is not expected to repay the plant.

## Records and limits

Save/load retains partial batches, feed and product storage, line hold-up, valves, hose work, loaded cars, pickup progress, and paid sales. The independent fluid balance includes imported, consumed, produced, stored, carried, and exported liters. Conserved history survives removal of an empty stopped reactor. A reactor or connected tank cannot be removed while its current batch still depends on it.

SQL includes `process_reactors`, `production_totals`, `product_sales`, `process_tanks`, `process_pumps`, `process_lines`, and `fluid_movements`. Example queries include Production and sales and Product revenue. Negative `costs.amount` rows in category Product sales are received payments. Retained liquid in pipes remains real inventory; draining and disposal are still later work.
