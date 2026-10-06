import type { Order, OrderLine, RailFreight, State } from './types';
import { COUPLED_CENTERS, RAIL_STOP, carPose, trackPose } from './motion';
import { itemMass, orderDeckLength } from './procurement';
import { bufferAssets } from './buffers';

export const RAIL_CAR_LENGTH = 16.8;
export const RAIL_CAR_SPACING = 17.6;
export const RAIL_LOCOMOTIVE_LENGTH = 8.6;
/** Stable supplier assets belong to this purchase, never to an equipment inventory. */
export function makeRailFreight(
  loads: { manifest: OrderLine[] }[],
  manifest: OrderLine[],
  nextId: (prefix: string) => string,
): RailFreight {
  return {
    locomotiveId: nextId('LOCO'),
    unloadRequested: false,
    cars: loads.map((load, index) => ({
      id: nextId('CAR'),
      kind: 'flatcar',
      manifest: load.manifest.map((line) => ({
        ...line,
        orderLineIndex: manifest.findIndex((m) => m.item === line.item),
      })),
      length: RAIL_CAR_LENGTH,
      width: 2.75,
      wheelbase: 11,
      centerOffset: COUPLED_CENTERS + index * RAIL_CAR_SPACING,
      mass: load.manifest.reduce((sum, l) => sum + (itemMass(l.item) || 0) * l.qty, 0),
      tareMass: 20000,
      deckLength: orderDeckLength(load.manifest),
    })),
  };
}
export function aggregateRailManifest(loads: { manifest: OrderLine[] }[]): OrderLine[] {
  const lines: OrderLine[] = [];
  for (const load of loads)
    for (const line of load.manifest) {
      const existing = lines.find((m) => m.item === line.item);
      if (existing) existing.qty += line.qty;
      else lines.push({ ...line });
    }
  return lines;
}
export function railFreightLength(o: Order): number {
  const last = o.railFreight?.cars.at(-1);
  return (
    RAIL_LOCOMOTIVE_LENGTH / 2 +
    (last ? last.centerOffset + last.length / 2 : COUPLED_CENTERS + RAIL_CAR_LENGTH / 2)
  );
}
export function railFreightCarPose(o: Order, index: number) {
  const car = o.railFreight?.cars[index];
  return carPose(
    (o.drive?.distance ?? o.railFreight?.stopDistance ?? RAIL_STOP) -
      (car?.centerOffset ?? COUPLED_CENTERS),
    car?.wheelbase ?? 11,
  );
}
export function railFreightCarBogies(o: Order, index: number) {
  const car = o.railFreight?.cars[index],
    at =
      (o.drive?.distance ?? o.railFreight?.stopDistance ?? RAIL_STOP) -
      (car?.centerOffset ?? COUPLED_CENTERS),
    wheelbase = car?.wheelbase ?? 11;
  return [trackPose(at - wheelbase / 2), trackPose(at + wheelbase / 2)];
}
const routeStation = (x: number) => RAIL_STOP + x - 56;
/** This checkpoint receives trains only on the original, surveyed 100-meter siding. */
export function railReceptionPlan(s: State, o: Order): { distance?: number; error?: string } {
  if (!o.railFreight) return { distance: RAIL_STOP };
  let from = 25.6,
    to = 124.4;
  const target = o.railFreight.receptionLocationId;
  if (target) {
    const location = s.railLocations?.find((l) => l.id === target);
    if (!location)
      return { error: 'The named receiving point no longer exists; choose another point.' };
    if (location.trackId !== 'BOOTSTRAP-SIDING' || location.route !== 'straight')
      return {
        error: 'Supplier trains currently receive only at points on the original receiving siding.',
      };
    if (!['unloading', 'transfer'].includes(location.kind))
      return { error: 'Choose an unloading or transfer point for the receiving train.' };
    from = Math.max(from, 25 + location.offset - location.length / 2);
    to = Math.min(to, 25 + location.offset + location.length / 2);
  }
  const required = railFreightLength(o);
  if (to - from < required - 1e-5)
    return {
      error: `Train needs ${required.toFixed(1)} m of clear receiving track; this point has ${Math.max(0, to - from).toFixed(1)} m. Choose a longer point or order fewer cars in one train.`,
    };
  const last = o.railFreight.cars.at(-1)!;
  const minimumFront = from + last.centerOffset + last.length / 2;
  const maximumFront = to - RAIL_LOCOMOTIVE_LENGTH / 2;
  const front = target ? (minimumFront + maximumFront) / 2 : Math.max(56, minimumFront);
  const rear = front - last.centerOffset - last.length / 2;
  const nose = front + RAIL_LOCOMOTIVE_LENGTH / 2;
  const stop = bufferAssets(s).find(
    (b) => !b.carried && b.secured && Math.abs(b.z - 5) < 0.7 && b.x > 25 && b.x <= nose + 0.6,
  );
  if (stop)
    return {
      error: `Receiving route is protected by ${stop.id} at E${stop.x.toFixed(1)}; remove and store it before this train arrives.`,
    };
  if (rear < 25.5 || nose > 124.5)
    return { error: 'The complete train must fit clear of the mainline switch and siding end.' };
  return { distance: routeStation(front) };
}
export function railStopDistance(s: State, o: Order) {
  return o.railFreight?.stopDistance ?? railReceptionPlan(s, o).distance ?? RAIL_STOP;
}
export function configureRailFreight(
  s: State,
  orderId: string,
  choices: { railLocationId?: string; storageZoneId?: string },
): string | undefined {
  const o = s.orders.find((o) => o.id === orderId);
  if (!o?.railFreight) return 'Select a supplier freight train.';
  if (o.status === 'departing' || o.status === 'done') return 'This train is already returning.';
  if (o.unload) return 'Finish the current physical lift before changing the destination.';
  if (choices.storageZoneId && !s.zones.some((z) => z.id === choices.storageZoneId))
    return 'Select an existing stockyard for unloading.';
  const reception = Object.hasOwn(choices, 'railLocationId')
    ? choices.railLocationId || undefined
    : o.railFreight.receptionLocationId;
  const storage = Object.hasOwn(choices, 'storageZoneId')
    ? choices.storageZoneId || undefined
    : o.railFreight.storageZoneId;
  if (o.status !== 'ordered' && reception !== o.railFreight.receptionLocationId)
    return 'The receiving point can only change before the train starts approaching.';
  const previous = { ...o.railFreight };
  o.railFreight.receptionLocationId = reception;
  o.railFreight.storageZoneId = storage;
  if (o.status === 'ordered') o.railFreight.stopDistance = undefined;
  const plan = railReceptionPlan(s, o);
  if (plan.error) {
    o.railFreight = previous;
    return plan.error;
  }
  if (o.status === 'ordered') o.railFreight.stopDistance = plan.distance;
  s.revision++;
}
export function requestRailUnloading(s: State, orderId: string): string | undefined {
  const o = s.orders.find((o) => o.id === orderId);
  if (!o?.railFreight) return 'Select a supplier freight train.';
  if (o.status !== 'unloading') return 'Wait until this train is stopped at its receiving point.';
  if (o.arrived >= o.qty) return 'This train has no remaining cargo to unload.';
  if (o.unloadPaused)
    return 'Return the unloading equipment to automatic work before resuming this train.';
  if (
    o.railFreight.storageZoneId
      ? !s.zones.some((z) => z.id === o.railFreight!.storageZoneId)
      : !s.zones.length
  )
    return 'Choose an existing destination stockyard before starting unloading.';
  o.railFreight.unloadRequested = true;
  o.note = 'Unloading requested; awaiting site equipment and workers.';
  s.revision++;
}
