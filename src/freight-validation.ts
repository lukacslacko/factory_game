import type { Order, State } from './types';
import { orderLines, orderDeckLength, itemMass, freightStackLimits } from './procurement';
import { MATERIALS } from './catalog';

/** Validate real car identities and their allocation against the order ledger. */
export function freightValidationProblem(s: State, o: Order, ids: Set<string>): string | undefined {
  const f = o.railFreight;
  if (f === undefined) return;
  if (!f || typeof f !== 'object') return 'invalid freight consist';
  const identity = (value: unknown, prefix: string) => {
    if (typeof value !== 'string' || !new RegExp(`^${prefix}-[0-9]+$`).test(value) || ids.has(value))
      return false;
    ids.add(value);
    return true;
  };
  if (o.mode !== 'rail' || o.commute || !identity(f.locomotiveId, 'LOCO'))
    return 'invalid rail freight locomotive';
  if (!Array.isArray(f.cars) || !f.cars.length || f.cars.length > 1000)
    return 'missing or oversized freight consist';
  if (f.unloadRequested !== undefined && typeof f.unloadRequested !== 'boolean')
    return 'invalid rail unloading request';
  if (f.receptionLocationId !== undefined &&
      (typeof f.receptionLocationId !== 'string' || (o.status !== 'done' && !s.railLocations?.some(l => l.id === f.receptionLocationId))))
    return 'missing freight reception location';
  if (f.storageZoneId !== undefined &&
      (typeof f.storageZoneId !== 'string' || (o.status !== 'done' && !s.zones.some(z => z.id === f.storageZoneId))))
    return 'missing freight unloading stockyard';
  if (f.stopDistance !== undefined && (!Number.isFinite(f.stopDistance) || f.stopDistance < 0 || f.stopDistance > 10000))
    return 'invalid freight stopping distance';
  const lines = orderLines(o), totals = lines.map(() => ({ qty: 0, arrived: 0 }));
  for (const [index, car] of f.cars.entries()) {
    if (!car || !identity(car.id, 'CAR') || car.kind !== 'flatcar' || car.length !== 16.8 || car.width !== 2.75 ||
        car.wheelbase !== 11 || Math.abs(car.centerOffset - (13.4 + 17.6 * index)) > 1e-7 ||
        car.tareMass !== 20000 || !Array.isArray(car.manifest) || !car.manifest.length || car.manifest.length > 20)
      return 'invalid freight car geometry or identity';
    let mass = 0;
    const seen = new Set<number>();
    for (const line of car.manifest) {
      const n = line.orderLineIndex;
      if (!Number.isInteger(n) || !lines[n] || seen.has(n) || lines[n].item !== line.item ||
          !Object.hasOwn(MATERIALS, line.item) || !Number.isInteger(line.qty) || line.qty < 1 ||
          !Number.isInteger(line.arrived) || line.arrived < 0 || line.arrived > line.qty)
        return 'invalid freight car manifest';
      seen.add(n);
      totals[n].qty += line.qty;
      totals[n].arrived += line.arrived;
      mass += itemMass(line.item)! * line.qty;
    }
    if (mass > 48000 || car.mass !== mass || car.deckLength !== orderDeckLength(car.manifest, freightStackLimits(o)) || car.deckLength > 16)
      return 'overfilled or inconsistent freight car';
  }
  if (totals.some((total, i) => total.qty !== lines[i].qty || total.arrived !== lines[i].arrived))
    return 'freight cars do not balance with order manifest';
  if (o.unload) {
    const task = o.unload, car = f.cars.find(car => car.id === task.carId);
    if (!car || !Number.isInteger(task.carLineIndex)) return 'unloading freight car is missing';
    const line = car.manifest[task.carLineIndex!];
    if (!line || line.item !== task.item || line.orderLineIndex !== task.lineIndex || task.qty > line.qty)
      return 'invalid unloading freight allocation';
  }
}
