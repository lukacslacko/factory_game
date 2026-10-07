import type { Order, OrderLine, RailFreight, State, RailMove, RailAnchor } from './types';
import { COUPLED_CENTERS, RAIL_STOP, carPose, trackPose } from './motion';
import { itemMass, orderDeckLength } from './procurement';
import { bufferAssets } from './buffers';
import { railLocationStatus } from './rail-locations';
import { railRoute, railInterval, anchorAtRailRoute, sampleRailRoute, type RailRoute } from './rail-routing';

/** Body and axle positions are sampled on the physical path, including behind an arriving engine. */
export function railMovementPose(m: RailMove | RailRoute, at: number, wheelbase: number) {
  const sample = (distance: number) => {
    if (distance >= 0 && distance <= m.length) return sampleRailRoute(m.points, distance);
    const p = distance < 0 ? m.points[0] : m.points.at(-1)!;
    const delta = distance < 0 ? distance : distance - m.length;
    return { ...p, x: p.x + Math.cos(p.yaw) * delta, z: p.z + Math.sin(p.yaw) * delta };
  };
  const a = sample(at - wheelbase / 2), b = sample(at + wheelbase / 2);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: Math.atan2(b.z-a.z,b.x-a.x), bogies: [a,b] };
}

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
  if (o.railFreight?.incomingRailMove) return railMovementPose(o.railFreight.incomingRailMove, o.railFreight.incomingRailMove.distance - (car?.centerOffset ?? COUPLED_CENTERS), car?.wheelbase ?? 11);
  if (car?.pose) return car.pose;
  return carPose(
    (o.drive?.distance ?? o.railFreight?.stopDistance ?? RAIL_STOP) -
      (car?.centerOffset ?? COUPLED_CENTERS),
    car?.wheelbase ?? 11,
  );
}
export function railFreightCarBogies(o: Order, index: number) {
  if (o.railFreight?.incomingRailMove) return railMovementPose(o.railFreight.incomingRailMove, o.railFreight.incomingRailMove.distance - (o.railFreight.cars[index]?.centerOffset ?? COUPLED_CENTERS), o.railFreight.cars[index]?.wheelbase ?? 11).bogies;
  if (o.railFreight?.cars[index]?.bogies) return o.railFreight.cars[index].bogies!;
  const car = o.railFreight?.cars[index],
    at =
      (o.drive?.distance ?? o.railFreight?.stopDistance ?? RAIL_STOP) -
      (car?.centerOffset ?? COUPLED_CENTERS),
    wheelbase = car?.wheelbase ?? 11;
  return [trackPose(at - wheelbase / 2), trackPose(at + wheelbase / 2)];
}
const routeStation = (x: number) => RAIL_STOP + x - 56;
/** Supplier reception follows real connected track, and the whole train must fit its named interval. */
export function railReceptionPlan(s: State, o: Order): { distance?: number; anchor?: RailAnchor; route?: RailRoute; error?: string } {
  if (!o.railFreight) return { distance: RAIL_STOP };
  const f = o.railFreight, required = railFreightLength(o), last = f.cars.at(-1)!;
  let stop: RailAnchor;
  let locationRun: RailRoute | undefined, locationShift=0;
  if (f.receptionLocationId) {
    const location = s.railLocations?.find(l => l.id === f.receptionLocationId);
    if (!location) return { error: 'The named receiving point no longer exists; choose another point.' };
    if (!['unloading', 'transfer'].includes(location.kind)) return { error: 'Choose an unloading or transfer point for the receiving train.' };
    const status = railLocationStatus(s, location);
    if (!status.valid || !status.connected) return { error: status.reason };
    if (location.length < required + 1.2) return { error: `Train needs ${(required+1.2).toFixed(1)} m of clear receiving track; this point has ${location.length.toFixed(1)} m. Choose a longer point or order fewer cars in one train.` };
    const run = railInterval(s, location, location.length/2, location.length/2);
    if (!run) return { error: 'The named receiving interval crosses an ambiguous junction or missing rail.' };
    const shift = (last.centerOffset + last.length/2 - RAIL_LOCOMOTIVE_LENGTH/2) / 2;
    const front = anchorAtRailRoute(s, run, location.length/2 + shift);
    if (!front) return { error: 'Unable to locate the supplier locomotive inside this interval.' };
    stop = front;
    locationRun=run; locationShift=shift;
  } else {
    const from=25.6, to=124.4;
    if (to-from < required) return { error: `Train needs ${required.toFixed(1)} m of clear receiving track; the original siding has ${(to-from).toFixed(1)} m. Choose a longer named reception point or order fewer cars in one train.` };
    const front = Math.max(56, from + last.centerOffset + last.length/2);
    if (front+RAIL_LOCOMOTIVE_LENGTH/2>to) return { error: 'The complete train must fit clear of the mainline switch and siding end.' };
    stop = { trackId: 'BOOTSTRAP-SIDING', route: 'straight', offset: front-25 };
  }
  const possession=s.railPossessions?.find(p=>!p.released);
  if(possession?.kind==='mainlineExit') return {error: `Public rail arrivals are suspended by possession ${possession.id}; finish the connection and reopen the mainline.`};
  let route = railRoute(s, { trackId:'BOOTSTRAP-MAINLINE', route:'straight', offset:140 }, stop);
  if(route && locationRun && Math.cos(route.points.at(-1)!.yaw-locationRun.points.at(-1)!.yaw)<0) {
    stop=anchorAtRailRoute(s,locationRun,locationRun.length/2-locationShift)!;
    route=railRoute(s,{trackId:'BOOTSTRAP-MAINLINE',route:'straight',offset:140},stop);
  }
  if (!route) {
    const blocked=railRoute(s,{trackId:'BOOTSTRAP-MAINLINE',route:'straight',offset:140},stop,{noBuffers:true});
    const buffer=bufferAssets(s).find(b=>b.secured&&!b.carried&&blocked?.points.some((p,i,all)=>{const a=all[Math.max(0,i-1)],dx=p.x-a.x,dz=p.z-a.z,t=(dx*dx+dz*dz)?Math.max(0,Math.min(1,((b.x-a.x)*dx+(b.z-a.z)*dz)/(dx*dx+dz*dz))):0;return Math.hypot(b.x-a.x-t*dx,b.z-a.z-t*dz)<0.8;}));
    return {error:buffer?`Receiving route protected by ${buffer.id}; remove and store it before arrival.`:'Receiving route has a gap, incomplete switch or secured buffer; complete and clear the physical route.'};
  }
  if (s.railPossessions?.some(p=>!p.released && route.points.some(q=>Math.abs(q.z-p.z)<1.5&&q.x>=p.from&&q.x<=p.to))) return {error:'The receiving route crosses an active track possession; finish and reopen that track first.'};
  return { distance: f.receptionLocationId ? route.length : routeStation(25+stop.offset), anchor: stop, route };
}
export function railStopDistance(s: State, o: Order) {
  return o.railFreight?.incomingRailMove?.end ?? o.railFreight?.stopDistance ?? railReceptionPlan(s, o).distance ?? RAIL_STOP;
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
  if (o.status === 'ordered') {o.railFreight.stopDistance = undefined; if(reception!==previous.receptionLocationId) {o.railFreight.incomingRailMove=undefined;o.railFreight.receptionAnchor=undefined;}}
  const plan = railReceptionPlan(s, o);
  if (plan.error) {
    o.railFreight = previous;
    return plan.error;
  }
  if (o.status === 'ordered') o.railFreight.stopDistance = plan.distance;
  s.revision++;
}
export function requestRailUnloading(s: State, orderId: string, carIds?: string[]): string | undefined {
  const o = s.orders.find((o) => o.id === orderId);
  if (!o?.railFreight) return 'Select a supplier freight train.';
  if (o.status !== 'unloading') return 'Wait until this train is stopped at its receiving point.';
  if (o.arrived >= o.qty) return 'This train has no remaining cargo to unload.';
  if(o.railFreight.cars.some(c=>c.kind==='tanker'&&(!carIds||carIds.includes(c.id)))) return 'Tanker cars require a connected transfer pump; forklift unloading is only for flatcars.';
  if (o.unloadPaused)
    return 'Return the unloading equipment to automatic work before resuming this train.';
  if (s.shunters?.some(e => e.carIds?.some(id => o.railFreight!.cars.some(c => c.id === id)) && e.phase !== 'parked') || o.railFreight.returnId)
    return 'Wait until shunting and uncoupling are complete before unloading these cars.';
  if (carIds && (!carIds.length || new Set(carIds).size !== carIds.length || carIds.some(id => !o.railFreight!.cars.some(c => c.id === id && !c.returned))))
    return 'Select one or more available cars from this train.';
  if (
    o.railFreight.storageZoneId
      ? !s.zones.some((z) => z.id === o.railFreight!.storageZoneId)
      : !s.zones.length
  )
    return 'Choose an existing destination stockyard before starting unloading.';
  o.railFreight.unloadRequested = true;
  o.railFreight.unloadCarIds = carIds;
  o.note = 'Unloading requested; awaiting site equipment and workers.';
  s.revision++;
}
