# Fuel, collection, sound, and daylight

These instructions describe native version 0.25.0. The browser deployment remains at 0.18.0. The version 0.24.0 tutorial booklet teaches the earlier core game; the controls below extend that workflow.

## Refuel equipment

Order a diesel drum and store it with clear driving and walking access. Hire an operator and keep them available for automatic work. Select a forklift or excavator and click **Request refueling**. The service chooses an available drum automatically. The operator boards a free, fueled machine and moves it to a reachable service position near the drum if necessary; a machine already suitably parked can stay there. The operator alights, fills a 20-liter can, walks to the actual filler, and pours. Repeated short trips continue until the tank is full or the drum is empty.

The worker visibly holds the can while filling, carrying, pouring, and returning empty. Drum contents, fuel in the can, fuel in the machine, and diesel already burned remain accounted for. Driving to the drum consumes diesel; refueling does not give the machine a free trip.

A request waits for a powered machine's current job to finish safely. Return a manually controlled operator to automatic duty to release it. A machine already carrying a supported load, or with too little fuel to drive, receives an explicitly labeled **Emergency can delivery** at its present position. Its load and original work remain intact. This can mean a longer walk; keep drums near the work area to avoid it.

The equipment inspector and refueling task show the service mode, drum ID, any planned service position, actual can contents, and liters delivered. Click IDs to inspect the linked records. Before an operator can be assigned, the request stays in **Work** with its waiting reason. Once service starts, a blocked drive, cab step, drum face, or filler produces a persistent warning after 20 simulated seconds. Clear the named route or obstruction and service can resume. Canceling a service that already holds diesel safely finishes pouring that can; it leaves subsequent diesel in the drum.

## Collect unwanted material

Installed assets must first be recovered into storage. Open **Materials → Collect unwanted material…**, or select a physical stack and choose **Collect unwanted units…**. Choose quantities from one or more unreserved stacks, then click **Get collection quote**. The quote shows weight, carrier count, transport, disposal and handling, and the total ceiling. Changing quantities requires a new quote.

Click **Order paid collection** after reviewing the quote. A road truck physically arrives at receiving. In the handling machine's inspector, open **Automatic work** and enable **Recovery**. The owned machine, a qualified operator, and any required helper collect the selected stock and secure it on the truck. Excavator lifts need a ground helper with reachable rigging access; forklift loads must fit its lift limit and clear route. The truck leaves with its secured cargo. Collection does not spawn site equipment or remove material merely because a button was clicked.

Use **Deliveries → Outbound paid collections** to inspect its carrier, material, crew, loading phase, waiting reason, quoted total, and actual charges. Ordinary incoming orders remain in their own register. Material totals and SQL distinguish stock carried by a collection truck from material that has left the site. Original stock IDs stay available in collection history even after their live stacks are exhausted.

Keep a driving route and loading clearance available. A collection accepts empty diesel drums only; use their contents first. Reserved or actively handled stacks cannot be collected. The first road service uses 12-ton trucks with six-meter decks; larger selections split into identified carrier loads.

## Retire a forklift or excavator

Select the machine and choose **Retire / collect equipment…**. Finish or release its work, empty its cargo, clear any dedicated support or parking assignment, and return its operator to automatic duty. The machine needs at least 1 L of diesel to drive onto the low-loader; request refueling first if it is dry. Review the low-loader quote before ordering.

An actual operator boards the machine, drives to the low-loader, climbs the ramps, stops on the deck, and walks off. The carrier waits until the operator is clear before leaving. This service handles mobile forklifts and excavators; rail locomotives and freight cars continue to use the separate railway operations.

After departure, **Equipment → Retired equipment archive** retains the original ID, collection, remaining sealed tank fuel, and diesel-use history. Historical job and ledger references remain inspectable. The retired machine cannot work on site. Its transport mass includes the fuel still in its sealed tank.

## Pause, cancel, and charges

A collection inspector offers pause, resume, and cancellation. Pause is available when handling is safely stationary; a driving approach or ramp maneuver must finish first. Pausing retains asset reservations and the supported physical operation. Canceling releases units still in storage and returns a suspended load safely. Cargo already secured on the truck still leaves; canceling is not an undo of completed loading. A machine partly on its ramps must reverse physically onto clear ground before cancellation finishes.

The arrival transport fee is charged once when the carrier reaches receiving. Disposal and handling are charged for cargo actually secured for departure. Cancel before dispatch to avoid a carrier charge; a carrier that has already arrived retains its service fee. The inspector separates the quoted ceiling from actual charges. These are game service prices, not estimates of real-world contractor rates.

## Sound and the game clock

Open **☰ → Sound settings…** for master volume, mute, vehicle, work, and notification levels, plus **Mute sound while the window is in the background**. Preferences stay on this device. By default the game becomes quiet when unfocused while its simulation continues.

Engine sounds follow actual vehicles and machines. Work, footsteps, cans, setdowns, pumps, and notifications have their own cues. A new targeted clearance request can honk once, with a cooldown; honking does not replace the existing physical clearance system. Pausing stops work sounds. Loading a yard does not replay its old notifications. Nearby activity has priority within a fixed, bounded voice budget.

Sun direction, color, ambient light, sky, and shadows follow simulated time. Morning light comes from the east, noon from the south, and evening light from the west. Every night has a full moon so an unlit yard remains usable; connected lamps provide stronger local illumination. Pause freezes the lighting clock, and faster speeds advance it with the game. **Dusk preview** explicitly holds an evening preview; turn it off to return to the actual clock.
