import type { State, Order, RailFreightCar } from './types';
import { RAIL_COMMODITIES, isRailCommodity, type RailCommodity } from './rail-commodities';
import { railReceptionPlan } from './rail-freight';
import { railLocationStatus } from './rail-locations';

export const TANKER_CAPACITY = 30000;
export function tankerOrderPreview(product: RailCommodity, litersPerCar: number, carCount: number) {
  if (
    !isRailCommodity(product) ||
    !Number.isInteger(litersPerCar) ||
    litersPerCar < 1 ||
    litersPerCar > TANKER_CAPACITY ||
    !Number.isInteger(carCount) ||
    carCount < 1 ||
    carCount > 10
  )
    throw new Error('Choose a liquid, 1–30,000 whole liters per tanker and 1–10 cars.');
  const commodity = RAIL_COMMODITIES[product],
    liters = litersPerCar * carCount;
  return {
    product,
    carCount,
    litersPerCar,
    liters,
    payloadMass: liters * commodity.density,
    tareMass: carCount * 20000,
    totalMass: liters * commodity.density + carCount * 20000,
    trainLength: 26.1 + (carCount - 1) * 17.6,
    price: liters * commodity.price + carCount * 160 + 240,
  };
}
/** Each leased tanker remains a physical car, including its conserved contained liquid. */
export function orderTankers(
  s: State,
  choices: {
    product: RailCommodity;
    litersPerCar: number;
    carCount: number;
    railLocationId?: string;
  },
): { id?: string; error?: string } {
  let preview: ReturnType<typeof tankerOrderPreview>;
  try {
    preview = tankerOrderPreview(choices.product, choices.litersPerCar, choices.carCount);
  } catch (error) {
    return { error: (error as Error).message };
  }
  if (choices.railLocationId) {
    const l = s.railLocations?.find((l) => l.id === choices.railLocationId);
    if (
      !l ||
      !['transfer', 'unloading'].includes(l.kind) ||
      !railLocationStatus(s, l).valid ||
      !railLocationStatus(s, l).connected
    )
      return { error: 'Choose a valid connected receiving or transfer point.' };
  }
  // Validate the whole draft before allocating IDs or mutating the ledger.
  const next = (prefix: string) => `${prefix}-${String(s.next++).padStart(4, '0')}`;
  const start = s.next,
    oid = next('ORD'),
    loco = next('LOCO');
  const cars: RailFreightCar[] = Array.from({ length: preview.carCount }, (_, i) => ({
    id: next('CAR'),
    kind: 'tanker',
    manifest: [{ item: choices.product, qty: choices.litersPerCar, arrived: 0, orderLineIndex: 0 }],
    length: 16.8,
    width: 2.75,
    wheelbase: 11,
    centerOffset: 13.4 + i * 17.6,
    mass: choices.litersPerCar * RAIL_COMMODITIES[choices.product].density,
    tareMass: 20000,
    deckLength: 0,
    tank: {
      product: choices.product,
      liters: choices.litersPerCar,
      capacity: TANKER_CAPACITY,
      density: RAIL_COMMODITIES[choices.product].density,
    },
    handbrake: false,
    brakeHoseConnected: true,
  }));
  cars.forEach(
    (c, i) =>
      (c.coupledTo = [i === 0 ? loco : cars[i - 1].id, ...(cars[i + 1] ? [cars[i + 1].id] : [])]),
  );
  const order: Order = {
    id: oid,
    item: choices.product,
    qty: preview.liters,
    arrived: 0,
    manifest: [{ item: choices.product, qty: preview.liters, arrived: 0 }],
    mode: 'rail',
    status: 'ordered',
    eta: s.time + 180,
    total: preview.price,
    invoiced: false,
    vehicle: { x: -120, z: 0 },
    stage: 0,
    handler: { x: 20, z: 20 },
    handling: 0,
    note: 'Tanker train ordered; liquids stay contained until connected transfer equipment is available.',
    railFreight: {
      locomotiveId: loco,
      cars,
      receptionLocationId: choices.railLocationId,
      unloadRequested: false,
    },
  };
  const reception = railReceptionPlan(s, order);
  if (
    reception.error &&
    /needs .*m|complete train must fit|usable|interval|longer/.test(reception.error)
  ) {
    s.next = start;
    return { error: reception.error };
  }
  s.orders.push(order);
  s.events.push({
    id: next('EV'),
    time: s.time,
    type: 'Order',
    entity: oid,
    text: `Ordered ${cars.length} tanker car(s), ${preview.liters.toLocaleString('en-US')} L ${RAIL_COMMODITIES[choices.product].name}, ${preview.totalMass.toFixed(0)} kg including tare. Fluid remains contained; shunt to a named transfer point.`,
  });
  s.revision++;
  return { id: oid };
}
