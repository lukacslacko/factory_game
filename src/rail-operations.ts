/** Owned locomotives and physical freight handoff. All movement is measured
 * along installed rail; cargo never changes stock until an actual site lift. */
import type {
  State,
  Order,
  RailFreightCar,
  RailShunter,
  RailReturn,
  RailMove,
  RailAnchor,
  Worker,
  Point,
} from './types';
import {
  railRoute,
  railInterval,
  railAnchorPose,
  sampleRailRoute,
  anchorAtRailRoute,
  type RailRoute,
} from './rail-routing';
import { railLocationPath, railLocationStatus } from './rail-locations';
import { railFreightCarPose, railFreightCarBogies, RAIL_CAR_SPACING } from './rail-freight';
import { bufferAssets } from './buffers';
import { angleDelta, localPoint, RAIL_STOP as railStopStation } from './motion';
import {
  boxOverlap,
  personTouchesBox,
  equipmentBoxes,
  walkRoute,
  workerMoveBlocked,
  machineRoute,
  staticObstacleRects,
  type TrafficBox,
} from './traffic';
import { shiftIsActive } from './workforce';
import { turnoutWorkerPoint, turnoutIsComplete, turnoutOccupant } from './turnout-operation';

const SHUNTER_PRICE = 68000,
  TANK = 360,
  COUPLER = 13.4;
const anchor = (x: number): RailAnchor => ({
  trackId: 'BOOTSTRAP-SIDING',
  route: 'straight',
  offset: x - 25,
});
const main = (x: number): RailAnchor => ({
  trackId: 'BOOTSTRAP-MAINLINE',
  route: 'straight',
  offset: x + 260,
});
const id = (s: State, prefix: string) => `${prefix}-${String(s.next++).padStart(4, '0')}`;
function record(s: State, entity: string, text: string, warning = false) {
  s.events.push({
    id: id(s, 'EV'),
    time: s.time,
    type: 'Railway',
    entity,
    text,
    severity: warning ? 'warning' : 'info',
  });
  s.revision++;
}
function announce(s: State, entity: string, title: string, detail: string) {
  s.notices.unshift({
    id: id(s, 'N'),
    time: s.time,
    title,
    detail,
    entity,
    state: 'todo',
    seen: false,
  });
  record(s, entity, detail);
}
function charge(s: State, entity: string, description: string, amount: number) {
  s.costs.push({
    id: id(s, 'COST'),
    time: s.time,
    category: 'Railway',
    entity,
    description,
    amount,
  });
}
export function allRailCars(s: State) {
  return s.orders.flatMap((o) =>
    (o.railFreight?.cars || []).map((car, index) => ({ order: o, car, index })),
  );
}
function freezeCars(o: Order) {
  o.railFreight!.cars.forEach((car, i) => {
    if (car.pose) return;
    car.pose = { ...railFreightCarPose(o, i) };
    car.bogies = railFreightCarBogies(o, i).map((p) => ({ ...p }));
    car.anchor = anchor(car.pose.x);
    car.locationId = o.railFreight!.receptionLocationId;
    car.groupId = o.id;
  });
}
function moveFor(route: RailRoute, distance = 0, end = route.length): RailMove {
  return { ...route, distance, end, velocity: 0, clock: 0 };
}
function reverseRoute(route: RailRoute): RailRoute {
  return {
    ...route,
    points: route.points
      .slice()
      .reverse()
      .map((p) => ({ ...p, yaw: p.yaw + Math.PI })),
    segments: route.segments
      .slice()
      .reverse()
      .map((v) => ({ ...v, from: v.to, to: v.from, start: route.length - v.start - v.length })),
  };
}
function joined(...routes: RailRoute[]): RailRoute {
  const result: RailRoute = { points: [], length: 0, tracks: [], switches: [], segments: [] };
  for (const r of routes) {
    result.points.push(...(result.points.length ? r.points.slice(1) : r.points));
    result.segments.push(...r.segments.map((v) => ({ ...v, start: v.start + result.length })));
    result.length += r.length;
    for (const t of r.tracks) if (!result.tracks.includes(t)) result.tracks.push(t);
    for (const t of r.switches)
      if (!result.switches.some((v) => v.id === t.id)) result.switches.push(t);
  }
  return result;
}
const empty = (c: RailFreightCar) => c.manifest.every((l) => l.arrived === l.qty);
export function mainlineExitReady(s: State) {
  return !!railRoute(s, anchor(115), main(180))?.tracks.some(
    (t) => t !== 'BOOTSTRAP-SIDING' && t !== 'BOOTSTRAP-SWITCH' && t !== 'BOOTSTRAP-MAINLINE',
  );
}
export function railRouteReserved(s: State, trackId?: string): string | undefined {
  const active: [string, RailMove | undefined][] = [
    ...s.orders.flatMap(
      (o) =>
        [
          [o.id, o.railFreight?.movement],
          [o.id, o.railFreight?.incomingRailMove],
        ] as [string, RailMove | undefined][],
    ),
    ...(s.shunters || [])
      .filter((e) => e.phase !== 'parked' && e.phase !== 'ordered')
      .flatMap(
        (e) =>
          [
            [e.id, e.movement],
            [e.id, e.haul],
            ...(e.approachQueue || []).map((m) => [e.id, m]),
          ] as [string, RailMove | undefined][],
      ),
    ...(s.railReturns || [])
      .filter((r) => r.phase !== 'done')
      .flatMap(
        (r) =>
          [
            [r.id, r.movement],
            [r.id, r.departure],
          ] as [string, RailMove | undefined][],
      ),
  ];
  return active.find(([, m]) => m && (!trackId || m.tracks.includes(trackId)))?.[0];
}
function motionBusy(s: State, own?: string) {
  return (
    s.jobs.some((j) => j.kind === 'throwSwitch' && !['done', 'canceled'].includes(j.status)) ||
    (railRouteReserved(s) !== undefined && railRouteReserved(s) !== own) ||
    s.orders.some(
      (o) =>
        o.mode === 'rail' &&
        o.id !== own &&
        !o.railFreight?.detached &&
        ['approaching', 'departing'].includes(o.status),
    )
  );
}
function box(
  p: Point & { yaw: number },
  length: number,
  width: number,
  identity: string,
): TrafficBox {
  return { ...p, length, width, id: identity };
}
export function railActorBoxes(s: State): TrafficBox[] {
  return [
    ...(s.shunters || [])
      .filter((e) => !['ordered'].includes(e.phase))
      .map((e) => box(e, 8.6, 2.65, e.id)),
    ...(s.railReturns || []).filter((r) => r.phase !== 'done').map((r) => box(r, 8.6, 2.65, r.id)),
  ];
}
function rollingBoxes(s: State): TrafficBox[] {
  return [
    ...railActorBoxes(s),
    ...s.orders
      .filter((o) => o.railFreight && !['ordered', 'done'].includes(o.status))
      .flatMap((o) => {
        const f = o.railFreight!;
        const locomotive = f.locomotivePose || { ...o.vehicle, yaw: o.drive?.yaw || 0 };
        return [
          ...(!f.detached || ['uncoupling', 'leaving'].includes(f.locomotivePhase || '')
            ? [box(locomotive, 8.6, 2.65, o.id)]
            : []),
          ...f.cars
            .filter((c) => !c.returned)
            .map((c) => box(railFreightCarPose(o, f.cars.indexOf(c)), c.length, c.width, c.id)),
        ];
      }),
  ];
}
function blockage(s: State, boxes: TrafficBox[], ignore: Set<string>, dynamic = true) {
  for (const b of boxes) {
    const stock = rollingBoxes(s).find((q) => !ignore.has(q.id!) && boxOverlap(b, q, 0.12));
    if (stock) return stock.id;
    const stop = bufferAssets(s).find(
      (q) => q.secured && !q.carried && personTouchesBox(q, b, 0.45),
    );
    if (stop) return stop.id;
    if (!dynamic) continue;
    const w = s.workers.find(
      (w) => !w.vehicle && !w.transportOrder && (w.y || 0) < 0.5 && personTouchesBox(w, b, 0.5),
    );
    if (w) return w.id;
    const e = s.equipment.find(
      (e) => !e.transportOrder && equipmentBoxes(e).some((q) => boxOverlap(b, q, 0.1)),
    );
    if (e) return e.id;
    const building = s.buildings.find(
      (q) =>
        q.kind !== 'shed' &&
        boxOverlap(b, { x: q.x + q.w / 2, z: q.z + q.d / 2, length: q.w, width: q.d, yaw: 0 }, 0.1),
    );
    if (building) return building.id;
    const stack = s.stacks.find(
      (q) =>
        q.qty > 0 &&
        boxOverlap(b, { x: q.x + q.w / 2, z: q.z + q.d / 2, length: q.w, width: q.d, yaw: 0 }, 0.1),
    );
    if (stack) return stack.id;
  }
}
function requestClearance(s: State, who: string, blocking: string, p: Point & { yaw: number }) {
  const w = s.workers.find((w) => w.id === blocking);
  if (w && !w.vehicle && !w.path.length && !w.transition && w.duty === 'auto') {
    for (const side of [1, -1]) {
      const target = localPoint(p, 0, side * 4);
      const path = walkRoute(s, w, target, staticObstacleRects(s));
      if (path) {
        w.path = path;
        w.status = `Clearing rail movement ${who}`;
        return;
      }
    }
  }
  const e = s.equipment.find((e) => e.id === blocking);
  if (e && !e.path.length && !e.cargo && !e.job && !e.deliveryOrder && !e.transportOrder) {
    for (const side of [1, -1]) {
      const target = localPoint(p, 0, side * 7);
      const path = machineRoute(s, e, target, staticObstacleRects(s));
      if (path) {
        e.path = path;
        e.blockedBy = undefined;
        return;
      }
    }
  }
}
function bodyPose(m: RailMove, at: number, wheelbase: number, facing = 1) {
  const sample = (distance: number) => {
    if (distance < 0) {
      const p = m.points[0];
      return { ...p, x: p.x + Math.cos(p.yaw) * distance, z: p.z + Math.sin(p.yaw) * distance };
    }
    if (distance > m.length) {
      const p = m.points.at(-1)!;
      return {
        ...p,
        x: p.x + Math.cos(p.yaw) * (distance - m.length),
        z: p.z + Math.sin(p.yaw) * (distance - m.length),
      };
    }
    return sampleRailRoute(m.points, distance);
  };
  const a = sample(at - wheelbase / 2),
    b = sample(at + wheelbase / 2);
  return {
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    yaw: Math.atan2(b.z - a.z, b.x - a.x) + (facing < 0 ? Math.PI : 0),
    bogies: [a, b],
  };
}
function carMotion(s: State, m: RailMove, car: RailFreightCar, at: number) {
  const pose = bodyPose(m, at, car.wheelbase);
  car.pose = { x: pose.x, z: pose.z, yaw: pose.yaw };
  car.bogies = pose.bogies;
  const a = anchorAtRailRoute(s, m, at);
  if (a) car.anchor = { trackId: a.trackId, route: a.route, offset: a.offset };
}
function advance(
  s: State,
  entity: string,
  m: RailMove,
  dt: number,
  shapes: (at: number) => TrafficBox[],
  ignore: Set<string>,
  max = 3,
) {
  const remaining = Math.max(0, m.end - m.distance),
    target = Math.min(max, Math.sqrt(remaining * 1.2));
  const speed = Math.min(target, m.velocity + dt * 0.65),
    travel = Math.min(remaining, speed * dt),
    next = m.distance + travel;
  const blocked = blockage(s, shapes(next), ignore);
  if (blocked) {
    m.velocity = 0;
    m.blockedBy = blocked;
    m.blockedSince ??= s.elapsed;
    requestClearance(s, entity, blocked, shapes(next)[0]);
    if (s.elapsed - m.blockedSince > 12 && !m.warned) {
      m.warned = true;
      announce(
        s,
        entity,
        'Rail movement blocked',
        `${entity} needs ${blocked} to clear its route.`,
      );
      record(s, entity, `Blocked by ${blocked}`, true);
    }
    return false;
  }
  m.blockedBy = undefined;
  m.blockedSince = undefined;
  m.warned = false;
  m.distance = next;
  m.velocity = speed;
  return next >= m.end - 1e-5;
}
function routeClear(
  s: State,
  m: RailMove,
  ignore: Set<string>,
  shapes: (at: number) => TrafficBox[],
) {
  for (let at = m.distance; at <= m.end; at += 2) {
    const blocked = blockage(s, shapes(at), ignore, false);
    if (blocked) return blocked;
  }
  return blockage(s, shapes(m.end), ignore, false);
}
export function detachRailFreight(s: State, orderId: string): string | undefined {
  const o = s.orders.find((o) => o.id === orderId),
    f = o?.railFreight;
  if (!o || !f || o.status !== 'unloading')
    return 'Wait until the supplier train is stopped at reception.';
  if (f.detached) return 'The supplier locomotive is already released.';
  if (o.unload) return 'Finish the current lift before uncoupling the supplier locomotive.';
  if (!mainlineExitReady(s))
    return 'Build the second mainline connection at the east end of the original siding, and remove its buffer stop first.';
  if (motionBusy(s, o.id)) return 'Another rail movement is active; wait until it stops.';
  const route = railRoute(s, anchor(o.vehicle.x), main(350));
  if (!route) return 'No continuous clear route from this locomotive to the east main line.';
  const m = moveFor(route),
    ignore = new Set([o.id]);
  const blocked = routeClear(s, m, ignore, (at) => [box(bodyPose(m, at, 5.58), 8.6, 2.65, o.id)]);
  if (blocked) return `The locomotive exit is blocked by ${blocked}. Clear that rail section.`;
  freezeCars(o);
  f.detached = true;
  f.locomotivePhase = 'uncoupling';
  f.locomotivePose = { ...o.vehicle, yaw: o.drive?.yaw || 0 };
  f.movement = m;
  f.locomotiveClock = 0;
  f.unloadRequested = false;
  o.note = 'Uncoupling supplier locomotive; freight cars remain in the yard';
  record(
    s,
    o.id,
    `Released ${f.locomotiveId}; brake hoses disconnected and cars secured before locomotive departure.`,
  );
}
export function orderShunter(
  s: State,
  choices: { driverId?: string; railLocationId?: string } = {},
): { id?: string; error?: string } {
  if ((s.shunters?.length || 0) >= 32)
    return { error: 'The yard supports at most 32 owned shunters.' };
  const driver = choices.driverId ? s.workers.find((w) => w.id === choices.driverId) : undefined;
  if (choices.driverId && (!driver || driver.role !== 'operator'))
    return { error: 'Choose an equipment operator as the shunter driver.' };
  if (
    driver &&
    (driver.job ||
      driver.deliveryOrder ||
      driver.transportOrder ||
      driver.vehicle ||
      driver.railAssignment ||
      s.shunters?.some((e) => e.driverId === driver.id))
  )
    return {
      error:
        'This operator is assigned elsewhere; order without a driver or release the existing assignment.',
    };
  const destination = choices.railLocationId
    ? s.railLocations?.find((l) => l.id === choices.railLocationId)
    : undefined;
  if (
    choices.railLocationId &&
    (!destination ||
      !railLocationStatus(s, destination).valid ||
      !railLocationStatus(s, destination).connected ||
      destination.length < 9)
  )
    return { error: 'Choose a connected named track point with at least 9 m for the locomotive.' };
  const e: RailShunter = {
    id: id(s, 'SHUNTER'),
    name: `Diesel shunter #${(s.shunters?.length || 0) + 1}`,
    x: 350,
    z: 0,
    yaw: Math.PI,
    fuel: TANK,
    tank: TANK,
    used: 0,
    phase: 'ordered',
    status: 'Ordered · rail delivery pending',
    eta: s.time + 120,
    driverId: driver?.id,
    destinationId: destination?.id,
  };
  (s.shunters ??= []).push(e);
  record(
    s,
    e.id,
    `Ordered owned 32-ton diesel shunter for $${SHUNTER_PRICE}; delivered by rail. Driver ${driver?.id || 'not yet assigned'}.`,
  );
  return { id: e.id };
}
export function setShunterDriver(
  s: State,
  shunterId: string,
  workerId?: string,
): string | undefined {
  const e = s.shunters?.find((e) => e.id === shunterId),
    w = workerId ? s.workers.find((w) => w.id === workerId) : undefined;
  if (!e) return 'Shunter not found.';
  if (!['parked', 'ordered'].includes(e.phase))
    return 'Finish the current shunting movement before changing drivers.';
  if (workerId && (!w || w.role !== 'operator'))
    return 'Choose an equipment operator as the driver.';
  if (
    w &&
    (w.job ||
      w.deliveryOrder ||
      w.transportOrder ||
      (w.vehicle && w.vehicle !== e.id) ||
      (w.railAssignment && w.railAssignment !== e.id) ||
      s.shunters?.some((q) => q.id !== e.id && q.driverId === w.id))
  )
    return 'This operator is assigned elsewhere; release that assignment first.';
  const old = s.workers.find((w) => w.id === e.driverId);
  if (old?.railAssignment === e.id) {
    old.railAssignment = undefined;
    old.vehicle = undefined;
    old.y = 0;
    Object.assign(old, localPoint(e, 0, 2));
  }
  e.driverId = w?.id;
  e.driverPhase = undefined;
  record(s, e.id, `Driver changed to ${w?.id || 'unassigned'}.`);
}
function driverReady(s: State, e: RailShunter, dt: number) {
  const w = s.workers.find((w) => w.id === e.driverId);
  if (!w) {
    e.status = 'Assign an equipment operator as driver';
    return false;
  }
  if (w.vehicle === e.id) {
    w.x = e.x;
    w.z = e.z;
    w.y = 1.65;
    w.status = `Driving ${e.id}`;
    return true;
  }
  if (
    w.job ||
    w.deliveryOrder ||
    w.transportOrder ||
    w.vehicle ||
    w.transition ||
    (!shiftIsActive(s, w) && w.railAssignment !== e.id) ||
    !!w.commuteOrder ||
    !!w.parkingEquipment ||
    !!w.yieldingTo ||
    (!!w.shiftPhase && w.shiftPhase !== 'working') ||
    w.duty === 'rest'
  ) {
    e.status = `Waiting for driver ${w.id} to be available and on duty`;
    return false;
  }
  w.railAssignment = e.id;
  const foot = localPoint(e, 0, 2.0);
  if (Math.hypot(w.x - foot.x, w.z - foot.z) > 0.3) {
    if (!w.path.length) w.path = walkRoute(s, w, foot, staticObstacleRects(s)) || [];
    w.status = `Walk to shunter ${e.id}`;
    e.driverPhase = 'walking';
    e.status = `Waiting for ${w.id} to board`;
    return false;
  }
  e.driverPhase = 'boarding';
  e.driverClock = (e.driverClock || 0) + dt;
  w.status = `Board ${e.id}`;
  w.y = Math.min(1.65, (1.65 * e.driverClock) / 2);
  if (e.driverClock < 2) return false;
  w.vehicle = e.id;
  w.path = [];
  e.driverPhase = 'aboard';
  e.driverClock = 0;
  s.revision++;
  return true;
}
function selectedCars(s: State, orderId: string, ids: string[]) {
  const o = s.orders.find((o) => o.id === orderId);
  if (
    !o?.railFreight ||
    o.status !== 'unloading' ||
    !o.railFreight.detached ||
    o.railFreight.locomotivePhase !== 'gone'
  )
    return { error: 'Release the supplier locomotive and wait until it leaves before shunting.' };
  if (o.unload || o.railFreight.unloadRequested)
    return { error: 'Finish or pause unloading before moving these cars.' };
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
    return { error: 'Select at least one available freight car.' };
  const cars = ids.map((id) => o.railFreight!.cars.find((c) => c.id === id && !c.returned));
  if (cars.some((c) => !c)) return { error: 'A selected car is missing or has already returned.' };
  if (
    s.shunters?.some((e) => e.phase !== 'parked' && e.carIds?.some((id) => ids.includes(id))) ||
    o.railFreight.returnId
  )
    return { error: 'These cars are reserved for another rail movement.' };
  return { order: o, cars: cars as RailFreightCar[] };
}
function destinationAnchor(s: State, locationId: string) {
  const l = s.railLocations?.find((l) => l.id === locationId);
  if (!l || !railLocationStatus(s, l).valid || !railLocationStatus(s, l).connected)
    return { error: 'Choose a valid named location on connected installed rail.' };
  return {
    location: l,
    anchor: { trackId: l.trackId, route: l.route, offset: l.offset } as RailAnchor,
  };
}
/** Place the engine ahead of the consist, with a tail history and room for
 * every axle. This same measured route drives cars, couplers and locomotive. */
function locomotiveApproach(s: State, e: RailShunter, target: RailAnchor): RailMove[] | undefined {
  const ignore = new Set([e.id]);
  const allowArc = (points: (Point & { yaw: number })[]) =>
    !points.some((p) => blockage(s, [box(p, 8.6, 2.65, e.id)], ignore, false));
  function legs(anchors: RailAnchor[]) {
    const result: RailMove[] = [];
    const settings = new Map(s.rails.map((r) => [r.id, r.selectedRoute || 'straight']));
    let previous = e.anchor!;
    const safeMove = (r: RailRoute) => {
      const m = moveFor(r);
      return routeClear(s, m, ignore, (at) => [box(bodyPose(m, at, 5.58), 8.6, 2.65, e.id)])
        ? undefined
        : m;
    };
    const blockers = (r: RailRoute, parked: RailAnchor) => {
      const pose = railAnchorPose(s, parked)!;
      // Survey future stopping positions without moving the actual engine or
      // its driver. Executed clearances remain real queued rail movements.
      const view = {
        ...s,
        shunters: s.shunters?.map((q) =>
          q.id === e.id ? { ...q, ...pose, bogies: undefined } : q,
        ),
      };
      return r.switches
        .filter((sw) => settings.get(sw.id) !== sw.route)
        .map((sw) => {
          const rail = s.rails.find((r) => r.id === sw.id);
          return rail ? turnoutOccupant(view, rail) : undefined;
        })
        .filter((v): v is string => !!v);
    };
    for (const next of anchors) {
      let r = railRoute(s, previous, next, { allowArc });
      if (!r) return;
      const blocked = blockers(r, previous);
      if (blocked.some((id) => id !== e.id)) return;
      if (blocked.includes(e.id)) {
        let cleared = false;
        // Stop clear of the pointwork before the driver gets out to throw it.
        // Moving away uses only the route that is already selected, never a
        // temporary point change under this locomotive's own nose or axles.
        for (const distance of [0.45, 0.5, 3, 5, 8, 12, 18]) {
          for (const direction of [-1, 1] as const) {
            const interval = railInterval(
              s,
              previous,
              direction < 0 ? distance : 0,
              direction > 0 ? distance : 0,
            );
            if (!interval) continue;
            const clearRoute = direction < 0 ? reverseRoute(interval) : interval;
            if (clearRoute.switches.some((sw) => settings.get(sw.id) !== sw.route)) continue;
            const clearMove = safeMove(clearRoute);
            if (!clearMove) continue;
            const clearAnchor = anchorAtRailRoute(s, clearRoute, clearRoute.length);
            if (!clearAnchor) continue;
            const onward = railRoute(s, clearAnchor, next, { allowArc });
            if (!onward || blockers(onward, clearAnchor).length || !safeMove(onward)) continue;
            result.push(clearMove);
            previous = clearAnchor;
            r = onward;
            cleared = true;
            break;
          }
          if (cleared) break;
        }
        if (!cleared) return;
      }
      const m = safeMove(r);
      if (!m) return;
      result.push(m);
      for (const sw of r.switches) settings.set(sw.id, sw.route);
      previous = next;
    }
    return result;
  }
  const direct = legs([target]);
  if (direct) return direct;
  if (mainlineExitReady(s)) {
    for (const via of [
      [main(190), main(-40)],
      [main(-40), main(190)],
    ]) {
      const route = legs([...via, target]);
      if (route) return route;
    }
    // Reverse only at a genuine clear stopping position, outside car
    // couplers and switch fouling points. Needed to re-enter a factory spur.
    const spots = allRailCars(s)
      .filter((q) => !q.car.returned && q.car.pose?.z === 5)
      .flatMap((q) => [q.car.pose!.x - COUPLER, q.car.pose!.x + COUPLER]);
    for (const x of spots.filter((x) => x > 25 && x < 125))
      for (const side of [190, -40]) {
        for (const via of [
          [main(side), anchor(x)],
          [main(side === 190 ? -40 : 190), main(side), anchor(x)],
        ]) {
          const route = legs([...via, target]);
          if (route) return route;
        }
      }
  }
}
function haulingPlan(s: State, cars: RailFreightCar[], target: RailAnchor, pushing = false) {
  if (cars.some((c) => !c.anchor || !c.pose))
    return { error: 'These cars do not have a valid parked rail position.' };
  const first = cars[0],
    centerRoute = railRoute(s, first.anchor!, target);
  if (!centerRoute || centerRoute.length < 0.01)
    return { error: 'No continuous route to this named location, or the cars are already there.' };
  const fromPose = railAnchorPose(s, first.anchor!)!;
  const direction = Math.cos(angleDelta(fromPose.yaw, centerRoute.points[0].yaw)) >= 0 ? 1 : -1;
  const endPose = railAnchorPose(s, target)!;
  const endDirection =
    Math.cos(angleDelta(endPose.yaw, centerRoute.points.at(-1)!.yaw)) >= 0 ? 1 : -1;
  // Select the leading exposed car in the route's travel direction.
  const ordered = cars.slice().sort((a, b) => {
    const pa = a.pose!,
      pb = b.pose!;
    return (
      direction * ((pb.x - pa.x) * Math.cos(fromPose.yaw) + (pb.z - pa.z) * Math.sin(fromPose.yaw))
    );
  });
  for (let i = 1; i < ordered.length; i++) {
    const between = railRoute(s, ordered[i].anchor!, ordered[i - 1].anchor!);
    if (!between || Math.abs(between.length - RAIL_CAR_SPACING) > 0.35)
      return {
        error:
          'Select a contiguous group of coupled cars at one exposed end. Move separated groups individually.',
      };
  }
  const lead = ordered[0],
    tail = (cars.length - 1) * RAIL_CAR_SPACING;
  const targetSpan = tail ? railInterval(s, target, tail / 2, tail / 2) : undefined;
  if (tail && !targetSpan)
    return {
      error: 'The destination lacks clear continuous track for these cars and the shunter.',
    };
  const targetLead = targetSpan
    ? anchorAtRailRoute(s, targetSpan, targetSpan.length / 2 + (endDirection * tail) / 2)!
    : target;
  const center = railRoute(s, lead.anchor!, targetLead);
  if (!center) return { error: 'No continuous rail route from these cars to that destination.' };
  const dir =
    Math.cos(angleDelta(railAnchorPose(s, lead.anchor!)!.yaw, center.points[0].yaw)) >= 0 ? 1 : -1;
  const prefix0 = railInterval(
    s,
    lead.anchor!,
    dir > 0 ? tail + COUPLER + 6 : 0,
    dir < 0 ? tail + COUPLER + 6 : 0,
  );
  const suffix0 = railInterval(
    s,
    targetLead,
    endDirection < 0 ? COUPLER + 6 : 0,
    endDirection > 0 ? COUPLER + 6 : 0,
  );
  if (!prefix0 || !suffix0)
    return { error: 'Not enough continuous track behind the cars or beyond the stopping point.' };
  const prefix = dir > 0 ? prefix0 : reverseRoute(prefix0),
    suffix = endDirection > 0 ? suffix0 : reverseRoute(suffix0);
  const route = joined(prefix, center, suffix),
    offset = pushing ? -(tail + COUPLER) : COUPLER,
    m = moveFor(route, prefix.length + offset, prefix.length + center.length + offset);
  m.couplerOffset = offset;
  const engineStart = anchorAtRailRoute(s, m, m.distance);
  if (!engineStart) return { error: 'Cannot locate the exposed coupling end.' };
  return { movement: m, cars: ordered, engineStart, direction: dir as 1 | -1 };
}
export function shuntRailCars(
  s: State,
  choices: { orderId: string; carIds: string[]; shunterId: string; railLocationId: string },
): string | undefined {
  const selected = selectedCars(s, choices.orderId, choices.carIds);
  if (selected.error) return selected.error;
  const e = s.shunters?.find((e) => e.id === choices.shunterId);
  if (!e || e.phase !== 'parked' || !e.anchor) return 'Choose a delivered idle shunter.';
  if (!e.driverId) return 'Assign an operator to this shunter first.';
  const driver = s.workers.find((w) => w.id === e.driverId);
  if (
    !driver ||
    !shiftIsActive(s, driver) ||
    driver.duty === 'rest' ||
    (driver.shiftPhase && driver.shiftPhase !== 'working') ||
    driver.commuteOrder
  )
    return 'Wait until the assigned driver is on site and on duty before dispatching.';
  if (
    driver.job ||
    driver.deliveryOrder ||
    driver.transportOrder ||
    driver.transition ||
    driver.parkingEquipment ||
    driver.yieldingTo ||
    (driver.vehicle && driver.vehicle !== e.id)
  )
    return 'The assigned driver is busy with another task; release that assignment before dispatching.';
  if (e.fuel < 2) return 'Refuel the shunter before moving cars.';
  if (motionBusy(s)) return 'Another rail movement is active; wait until it stops.';
  const dest = destinationAnchor(s, choices.railLocationId);
  if (dest.error) return dest.error;
  const required = (selected.cars!.length - 1) * RAIL_CAR_SPACING + 16.8;
  const existing = allRailCars(s).filter(
    (q) =>
      !q.car.returned &&
      q.car.locationId === dest.location!.id &&
      !choices.carIds.includes(q.car.id),
  );
  // A return point is filled end-to-end: later batches stop behind the cars
  // already there, so the resulting consist can be coupled for one pickup.
  let target = dest.anchor!;
  if (existing.length) {
    const path = railLocationPath(s, dest.location!)!;
    const end = path.at(-1)!,
      p = path[0],
      yaw = Math.atan2(end.z - p.z, end.x - p.x);
    const rear = existing
      .map((q) => q.car)
      .sort(
        (a, b) => (a.pose!.x - b.pose!.x) * Math.cos(yaw) + (a.pose!.z - b.pose!.z) * Math.sin(yaw),
      )[0];
    const interval = railInterval(
      s,
      rear.anchor!,
      ((selected.cars!.length + 1) * RAIL_CAR_SPACING) / 2,
      0,
    );
    if (!interval) return 'No remaining connected length behind the cars already at this point.';
    const a = anchorAtRailRoute(s, interval, 0);
    if (!a) return 'No return consist assembly space.';
    target = a;
  }
  if (
    !existing.length &&
    dest.location!.kind === 'transfer' &&
    dest.location!.trackId === 'BOOTSTRAP-SIDING'
  ) {
    const run = railInterval(s, dest.anchor!, 0, dest.location!.length / 2 - required / 2 - 0.4);
    const a = run && anchorAtRailRoute(s, run, run.length);
    if (a) target = a;
  }
  if (dest.location!.length < required + 0.8 + existing.length * RAIL_CAR_SPACING)
    return `Selected cars need ${(required + existing.length * RAIL_CAR_SPACING).toFixed(1)} m; ${dest.location!.name} is ${dest.location!.length} m long.`;
  let plan = haulingPlan(s, selected.cars!, target);
  if (plan.error) return plan.error;
  if (
    dest.location!.trackId === 'BOOTSTRAP-SIDING' &&
    plan.cars!.some((c, i) => {
      const x = bodyPose(
        plan.movement!,
        plan.movement!.end - (plan.movement!.couplerOffset ?? COUPLER) - i * RAIL_CAR_SPACING,
        c.wheelbase,
      ).x;
      return (
        x - c.length / 2 < 25 + dest.location!.offset - dest.location!.length / 2 ||
        x + c.length / 2 > 25 + dest.location!.offset + dest.location!.length / 2
      );
    })
  )
    return 'The assembled cars would extend beyond this named interval. Choose a longer empty return point.';
  const ignore = new Set([e.id, ...choices.carIds]);
  let queue = locomotiveApproach(s, e, plan.engineStart!);
  const push = haulingPlan(s, selected.cars!, target, true);
  // Keep the locomotive on the accessible side of a factory unloading spur.
  // This prevents parking it behind its own detached cars on a dead-end track.
  if (!push.error && (dest.location!.trackId !== 'BOOTSTRAP-SIDING' || !queue)) {
    const alternative = locomotiveApproach(s, e, push.engineStart!);
    if (alternative) {
      plan = push;
      queue = alternative;
    }
  }
  if (!queue)
    return 'Neither exposed coupling end is accessible. Clear the track or build a runaround connection.';
  const neededFuel =
    (queue.reduce((n, m) => n + m.end - m.distance, 0) +
      plan.movement!.end -
      plan.movement!.distance) *
      0.04 +
    2;
  if (e.fuel < neededFuel)
    return `This movement needs at least ${neededFuel.toFixed(1)} L of diesel including a reserve; refuel before dispatch.`;
  const a = queue.shift()!;
  const blocked = routeClear(s, plan.movement!, ignore, (at) =>
    consistBoxes(plan.movement!, plan.cars!, at, e.id),
  );
  if (blocked && !existing.some((q) => q.car.id === blocked))
    return `The shunting route or stopping area is occupied by ${blocked}.`;
  e.carIds = plan.cars!.map((c) => c.id);
  e.orderId = selected.order!.id;
  e.destinationId = dest.location!.id;
  e.movement = a;
  e.approachQueue = queue;
  e.haul = plan.movement;
  e.direction = plan.direction;
  e.phase = 'boarding';
  e.clock = 0;
  e.status = 'Waiting for driver to board';
  selected.order!.railFreight!.unloadRequested = false;
  record(
    s,
    e.id,
    `Shunt ${e.carIds.join(', ')} from ${selected.order!.id} to ${dest.location!.name}; driver ${e.driverId}.`,
  );
}
function consistBoxes(m: RailMove, cars: RailFreightCar[], at: number, engineId: string) {
  return [
    box(bodyPose(m, at, 5.58), 8.6, 2.65, engineId),
    ...cars.map((c, i) =>
      box(
        bodyPose(m, at - (m.couplerOffset ?? COUPLER) - i * RAIL_CAR_SPACING, c.wheelbase),
        c.length,
        c.width,
        c.id,
      ),
    ),
  ];
}
export function parkShunter(s: State, shunterId: string, locationId: string): string | undefined {
  const e = s.shunters?.find((e) => e.id === shunterId),
    dest = destinationAnchor(s, locationId);
  if (!e || e.phase !== 'parked' || !e.anchor) return 'Choose a delivered idle shunter.';
  if (!e.driverId) return 'Assign a driver first.';
  const driver = s.workers.find((w) => w.id === e.driverId);
  if (
    !driver ||
    !shiftIsActive(s, driver) ||
    driver.duty === 'rest' ||
    (driver.shiftPhase && driver.shiftPhase !== 'working') ||
    driver.commuteOrder
  )
    return 'Wait until the assigned driver is on site and on duty before dispatching.';
  if (
    driver.job ||
    driver.deliveryOrder ||
    driver.transportOrder ||
    driver.transition ||
    driver.parkingEquipment ||
    driver.yieldingTo ||
    (driver.vehicle && driver.vehicle !== e.id)
  )
    return 'The assigned driver is busy with another task; release that assignment before dispatching.';
  if (dest.error) return dest.error;
  if (dest.location!.length < 9) return 'Parking point needs at least 9 m.';
  if (motionBusy(s)) return 'Another rail movement is active.';
  const queue = locomotiveApproach(s, e, dest.anchor!);
  if (!queue)
    return 'No clear locomotive route to this parking point. Clear its approach or build a runaround.';
  const neededFuel = queue.reduce((n, m) => n + m.end - m.distance, 0) * 0.04 + 2;
  if (e.fuel < neededFuel)
    return `Parking needs at least ${neededFuel.toFixed(1)} L of diesel including a reserve; refuel before dispatch.`;
  e.movement = queue.shift();
  e.approachQueue = queue;
  e.destinationId = locationId;
  e.carIds = undefined;
  e.phase = 'parking';
  e.status = 'Moving to parking point';
  record(s, e.id, `Park at ${dest.location!.name}.`);
}
export function refuelShunter(s: State, shunterId: string): string | undefined {
  const e = s.shunters?.find((e) => e.id === shunterId);
  if (!e || e.phase !== 'parked') return 'Stop and uncouple the shunter before refueling.';
  if (!e.driverId) return 'Assign a driver to refuel the locomotive.';
  const barrel = s.stacks
    .filter(
      (t) =>
        t.item === 'diesel' &&
        (t.liters || 0) > 0 &&
        Math.hypot(t.x + t.w / 2 - e.x, t.z + t.d / 2 - e.z) < 8,
    )
    .sort((a, b) => Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z))[0];
  if (!barrel)
    return 'Place a diesel barrel within 8 m of the parked shunter, or park closer to one.';
  const liters = Math.min(e.tank - e.fuel, barrel.liters || 0);
  if (liters <= 0) return 'The fuel tank is already full.';
  e.fuel += liters;
  barrel.liters! -= liters;
  s.movements.push({
    id: id(s, 'MV'),
    time: s.time,
    item: 'diesel',
    qty: liters,
    from: barrel.id,
    to: e.id,
    reason: 'Refueled diesel shunter (liters)',
  });
  record(s, e.id, `Filled ${liters.toFixed(1)} L from ${barrel.id}.`);
}
export function requestEmptyReturn(
  s: State,
  choices: { orderIds: string[]; railLocationId?: string },
): { id?: string; error?: string } {
  if (
    !Array.isArray(choices.orderIds) ||
    !choices.orderIds.length ||
    new Set(choices.orderIds).size !== choices.orderIds.length
  )
    return { error: 'Choose one or more empty supplier orders.' };
  if (motionBusy(s)) return { error: 'Another rail movement is active; wait until it stops.' };
  if (!mainlineExitReady(s))
    return { error: 'Build and clear the second mainline connection before pickup.' };
  const orders = choices.orderIds.map((id) => s.orders.find((o) => o.id === id));
  if (
    orders.some(
      (o) =>
        !o?.railFreight?.detached ||
        o.railFreight.locomotivePhase !== 'gone' ||
        o.status !== 'unloading' ||
        o.unload ||
        o.railFreight.returnId,
    )
  )
    return {
      error: 'Choose released, stopped freight orders with no active unloading or return movement.',
    };
  const cars = orders.flatMap((o) => o!.railFreight!.cars.filter((c) => !c.returned));
  if (!cars.length || cars.some((c) => !empty(c)))
    return { error: 'Unload every selected car before requesting an empty return train.' };
  if (cars.some((c) => c.anchor?.trackId !== 'BOOTSTRAP-SIDING' || Math.abs(c.pose!.z - 5) > 0.1))
    return {
      error:
        'Assemble all selected empty cars on the original receiving siding before requesting pickup.',
    };
  if (choices.railLocationId) {
    const l = s.railLocations?.find((l) => l.id === choices.railLocationId);
    if (!l || l.trackId !== 'BOOTSTRAP-SIDING' || !['unloading', 'transfer'].includes(l.kind))
      return { error: 'Choose a receiving or transfer point on the original siding for pickup.' };
    if (
      cars.some(
        (c) =>
          c.pose!.x - c.length / 2 < 25 + l.offset - l.length / 2 - 0.05 ||
          c.pose!.x + c.length / 2 > 25 + l.offset + l.length / 2 + 0.05,
      )
    )
      return {
        error: `The cars are outside ${l.name}; shunt them into that collection interval first.`,
      };
  }
  cars.sort((a, b) => b.pose!.x - a.pose!.x);
  if (cars.some((c, i) => i && Math.abs(cars[i - 1].pose!.x - c.pose!.x - RAIL_CAR_SPACING) > 0.8))
    return {
      error:
        'The empty cars must be a contiguous consist. Shunt them to the same named return point first.',
    };
  const lead = cars[0],
    tail = cars.at(-1)!;
  const exit = railRoute(s, lead.anchor!, main(400)),
    prefix = railInterval(s, tail.anchor!, 6, 0);
  if (!exit || !prefix) return { error: 'No clear connected mainline pickup route.' };
  const bodyRoute = railRoute(s, anchor(tail.pose!.x - 6), lead.anchor!);
  if (!bodyRoute) return { error: 'Unable to reserve the assembled return train.' };
  const departure = moveFor(
    joined(bodyRoute, exit),
    bodyRoute.length + COUPLER,
    bodyRoute.length + exit.length,
  );
  const coupling = anchor(lead.pose!.x + COUPLER);
  const approach = railRoute(s, main(400), coupling);
  if (!approach) return { error: 'The pickup locomotive cannot reach the coupling end.' };
  const pickupId = id(s, 'RETURN'),
    locomotiveId = id(s, 'LOCO'),
    movement = moveFor(approach);
  const ignored = new Set([pickupId, ...cars.map((c) => c.id)]),
    blocked = routeClear(s, departure, ignored, (at) =>
      consistBoxes(departure, cars, at, pickupId),
    );
  if (blocked)
    return { error: `Return route is occupied by ${blocked}. Park the shunter clear first.` };
  const r: RailReturn = {
    id: pickupId,
    locomotiveId,
    orderIds: orders.map((o) => o!.id),
    carIds: cars.map((c) => c.id),
    phase: 'collecting',
    status: 'Mainline locomotive approaching for empty cars',
    x: 400,
    z: 0,
    yaw: 0,
    movement,
    departure,
    clock: 0,
  };
  (s.railReturns ??= []).push(r);
  for (const o of orders) {
    o!.railFreight!.returnId = pickupId;
    o!.railFreight!.unloadRequested = false;
  }
  charge(s, pickupId, `Mainline empty-car collection · ${cars.length} cars`, 240);
  record(
    s,
    pickupId,
    `Ordered pickup of ${cars.map((c) => c.id).join(', ')} from ${orders.map((o) => o!.id).join(', ')}.`,
  );
  return { id: pickupId };
}
function switchReady(s: State, e: RailShunter, m: RailMove, dt: number) {
  const target = m.switches.find((sw) => {
    const r = s.rails.find((r) => r.id === sw.id);
    return r && (r.selectedRoute || 'straight') !== sw.route;
  });
  if (!target) return true;
  const r = s.rails.find((r) => r.id === target.id)!;
  if (!turnoutIsComplete(s, r)) {
    e.status = `Finish turnout ${r.id} before shunting`;
    return false;
  }
  const occupied = turnoutOccupant(s, r);
  if (occupied) {
    e.status = `Turnout ${r.id} occupied by ${occupied}; clear it before changing points`;
    return false;
  }
  const w = s.workers.find((w) => w.id === e.driverId)!;
  if (e.driverPhase !== 'switch') {
    // Driver alights and walks to each lever before the reserved movement.
    w.vehicle = undefined;
    w.y = 0;
    Object.assign(w, localPoint(e, 0, 2));
    e.driverPhase = 'switch';
    e.switchId = r.id;
    e.driverClock = 0;
  }
  const foot = turnoutWorkerPoint(r);
  const p = [
    foot,
    ...[0.8, -0.8].map((offset) => ({
      ...foot,
      x: foot.x + Math.cos(foot.yaw) * offset,
      z: foot.z + Math.sin(foot.yaw) * offset,
    })),
  ].find((candidate) => !workerMoveBlocked(s, w, candidate));
  if (!p) {
    e.status = `No clear standing position beside ${r.id} lever`;
    return false;
  }
  if (Math.hypot(w.x - p.x, w.z - p.z) > 0.3) {
    if (!w.path.length) w.path = walkRoute(s, w, p, staticObstacleRects(s)) || [];
    w.status = `Set turnout ${r.id}`;
    e.status = `Driver walking to ${r.id} lever`;
    return false;
  }
  e.driverClock = (e.driverClock || 0) + dt;
  e.status = `Driver throwing ${r.id} to ${target.route}`;
  if (e.driverClock < 4) return false;
  r.selectedRoute = target.route;
  record(s, r.id, `${w.id} set turnout to ${target.route} for ${e.id}.`);
  e.driverPhase = 'walking';
  e.driverClock = 0;
  e.switchId = undefined;
  return false;
}
function supplierSwitches(s: State, m: RailMove, dt: number) {
  const pending = m.switches.filter((sw) =>
    s.rails.some((r) => r.id === sw.id && (r.selectedRoute || 'straight') !== sw.route),
  );
  if (!pending.length) return true;
  if (
    pending.some((sw) =>
      turnoutOccupant(
        s,
        s.rails.find((r) => r.id === sw.id)!,
      ),
    )
  ) {
    m.clock = 0;
    return false;
  }
  m.clock += dt;
  if (m.clock < 4) return false;
  for (const sw of pending) {
    const r = s.rails.find((r) => r.id === sw.id)!;
    r.selectedRoute = sw.route;
    record(s, r.id, `Railway service crew set turnout ${sw.route} for mainline locomotive.`);
  }
  m.clock = 0;
  return true;
}
export function prepareRailArrival(s: State, o: Order, dt: number): string | undefined {
  const f = o.railFreight;
  if (!f) return;
  const x = o.drive?.distance !== undefined ? o.vehicle.x : 56;
  // The original station system is linear east of its first protected turnout.
  const receivingX = f.stopDistance !== undefined ? 56 + f.stopDistance - railStopStation : x;
  const route = railRoute(s, main(-120), anchor(receivingX));
  if (!route) return 'Receiving route has a gap, incomplete switch or secured buffer.';
  const leverJob = s.jobs.find(
    (j) =>
      j.kind === 'throwSwitch' &&
      !['done', 'canceled'].includes(j.status) &&
      route.switches.some((sw) => sw.id === j.target),
  );
  if (leverJob)
    return `Waiting for turnout operation ${leverJob.id} to finish before reserving arrival.`;
  f.incomingRailMove ??= moveFor(route);
  if (!supplierSwitches(s, f.incomingRailMove, dt))
    return 'Railway service crew setting arrival turnouts';
}
export function tickRailOperations(s: State, dt: number) {
  for (const o of s.orders) {
    const f = o.railFreight;
    if (!f?.detached || !f.movement) continue;
    if (f.locomotivePhase === 'uncoupling') {
      f.locomotiveClock = (f.locomotiveClock || 0) + dt;
      if (f.locomotiveClock < 5) continue;
      f.locomotivePhase = 'leaving';
      record(s, o.id, 'Supplier locomotive uncoupled; cars secured on track.');
    }
    if (!supplierSwitches(s, f.movement, dt)) {
      o.note = 'Railway service crew setting exit turnout';
      continue;
    }
    const done = advance(
      s,
      o.id,
      f.movement,
      dt,
      (at) => [box(bodyPose(f.movement!, at, 5.58), 8.6, 2.65, o.id)],
      new Set([o.id]),
      4,
    );
    const p = bodyPose(f.movement, f.movement.distance, 5.58);
    f.locomotivePose = { x: p.x, z: p.z, yaw: p.yaw };
    f.locomotiveBogies = p.bogies;
    if (done) {
      f.locomotivePhase = 'gone';
      f.movement = undefined;
      o.note = 'Supplier locomotive left; cars awaiting shunting or unloading';
      announce(
        s,
        o.id,
        'Supplier locomotive released',
        `${f.locomotiveId} left the yard; idle locomotive charges stopped.`,
      );
    }
  }
  for (const e of s.shunters || []) {
    if (e.phase === 'ordered') {
      if (s.time < e.eta || motionBusy(s)) continue;
      const dest = e.destinationId
        ? destinationAnchor(s, e.destinationId)
        : { anchor: anchor(115) };
      if ('error' in dest && dest.error) {
        e.status = dest.error;
        continue;
      }
      const route = railRoute(s, main(350), dest.anchor!);
      if (!route) {
        e.status =
          'Delivery needs the completed east mainline connection and a clear receiving point';
        continue;
      }
      const m = moveFor(route),
        blocked = routeClear(s, m, new Set([e.id]), (at) => [
          box(bodyPose(m, at, 5.58), 8.6, 2.65, e.id),
        ]);
      if (blocked) {
        e.status = `Delivery waiting for ${blocked} to clear track`;
        continue;
      }
      e.movement = m;
      e.phase = 'delivering';
      e.status = 'Supplier driver delivering owned shunter';
    }
    if (e.phase === 'parked') {
      const w = s.workers.find((w) => w.id === e.driverId);
      if (w?.vehicle === e.id && !shiftIsActive(s, w)) {
        w.vehicle = undefined;
        w.railAssignment = undefined;
        w.y = 0;
        Object.assign(w, localPoint(e, 0, 2));
        e.driverPhase = undefined;
      }
      continue;
    }
    const m = e.movement;
    if (!m) continue;
    if ((e.gearPause || 0) > 0) {
      e.gearPause = Math.max(0, (e.gearPause || 0) - dt);
      e.status = 'Stopped · reversing direction for runaround';
      continue;
    }
    if (e.phase !== 'delivering') {
      // Switch work can interrupt boarding; do not reboard until the lever is set.
      if (e.driverPhase === 'switch') {
        if (!switchReady(s, e, m, dt)) continue;
      }
      if (!driverReady(s, e, dt)) continue;
      if (!switchReady(s, e, m, dt)) continue;
    } else if (!supplierSwitches(s, m, dt)) continue;
    if (e.phase === 'boarding') e.phase = 'approaching';
    if (e.phase === 'coupling' || e.phase === 'uncoupling') {
      e.clock = (e.clock || 0) + dt;
      if (e.clock < 5) {
        e.status =
          e.phase === 'coupling'
            ? 'Connecting couplers, brake hoses and releasing car brakes'
            : 'Securing car brakes and disconnecting couplers';
        continue;
      }
      if (e.phase === 'coupling') {
        e.phase = 'hauling';
        e.movement = e.haul;
        e.clock = 0;
        continue;
      }
      for (const c of allRailCars(s)
        .filter((q) => e.carIds?.includes(q.car.id))
        .map((q) => q.car)) {
        c.locationId = e.destinationId;
        c.groupId = e.destinationId;
      }
      const o = s.orders.find((o) => o.id === e.orderId);
      if (o)
        o.note = `Cars at ${s.railLocations?.find((l) => l.id === e.destinationId)?.name}; start unloading or assemble empties`;
      e.phase = 'parked';
      e.locationId = e.destinationId;
      e.movement = undefined;
      e.haul = undefined;
      e.carIds = undefined;
      e.orderId = undefined;
      e.clock = 0;
      e.status = 'Parked · automatic shunting available';
      announce(
        s,
        e.id,
        'Shunting complete',
        `${e.id} secured the cars at ${s.railLocations?.find((l) => l.id === e.destinationId)?.name}.`,
      );
      continue;
    }
    const cars = allRailCars(s)
      .filter((q) => e.carIds?.includes(q.car.id))
      .sort((a, b) => e.carIds!.indexOf(a.car.id) - e.carIds!.indexOf(b.car.id))
      .map((q) => q.car);
    if (e.fuel <= 0 && e.phase !== 'delivering') {
      m.velocity = 0;
      e.status = 'Out of diesel; stop, deliver fuel and refuel';
      continue;
    }
    const hauling = e.phase === 'hauling',
      old = m.distance;
    const done = advance(
      s,
      e.id,
      m,
      dt,
      (at) =>
        hauling ? consistBoxes(m, cars, at, e.id) : [box(bodyPose(m, at, 5.58), 8.6, 2.65, e.id)],
      new Set([e.id, ...(hauling ? e.carIds || [] : [])]),
      e.phase === 'delivering' ? 4 : 2.5,
    );
    const p = bodyPose(m, m.distance, 5.58);
    e.x = p.x;
    e.z = p.z;
    e.yaw = p.yaw + (Math.abs(angleDelta(e.yaw, p.yaw)) > Math.PI / 2 ? Math.PI : 0);
    e.bogies = p.bogies;
    const a = anchorAtRailRoute(s, m, m.distance);
    if (a) e.anchor = { trackId: a.trackId, route: a.route, offset: a.offset };
    if (e.phase !== 'delivering') {
      const used = Math.min(e.fuel, (m.distance - old) * 0.025 + dt * 0.001);
      e.fuel -= used;
      e.used += used;
      const w = s.workers.find((w) => w.id === e.driverId);
      if (w?.vehicle === e.id) {
        w.x = e.x;
        w.z = e.z;
      }
    }
    if (hauling)
      cars.forEach((c, i) =>
        carMotion(s, m, c, m.distance - (m.couplerOffset ?? COUPLER) - i * RAIL_CAR_SPACING),
      );
    e.status = m.blockedBy
      ? `Waiting for ${m.blockedBy} to clear rail route`
      : hauling
        ? m.couplerOffset! < 0
          ? 'Pushing freight cars'
          : 'Pulling freight cars'
        : e.phase === 'parking'
          ? 'Driving to parking point'
          : 'Approaching coupling end';
    if (!done) continue;
    if (e.phase === 'delivering') {
      e.phase = 'parked';
      e.movement = undefined;
      e.locationId = e.destinationId;
      e.status = 'Delivered · assign a driver to begin work';
      charge(s, e.id, 'Owned diesel shunter + rail delivery', SHUNTER_PRICE + 240);
      announce(
        s,
        e.id,
        'Shunter delivered',
        `${e.id} is on site and ready for its assigned driver.`,
      );
    } else if (e.phase === 'parking') {
      if (e.approachQueue?.length) {
        e.movement = e.approachQueue.shift();
        e.gearPause = 1.5;
      } else {
        e.approachQueue = undefined;
        e.phase = 'parked';
        e.locationId = e.destinationId;
        e.movement = undefined;
        e.status = 'Parked';
        record(s, e.id, 'Reached assigned parking point.');
      }
    } else if (e.phase === 'approaching') {
      if (e.approachQueue?.length) {
        e.movement = e.approachQueue.shift();
        e.gearPause = 1.5;
        e.status = 'Stopped before reversing runaround';
      } else {
        e.approachQueue = undefined;
        e.phase = 'coupling';
        e.clock = 0;
      }
    } else if (e.phase === 'hauling') {
      e.phase = 'uncoupling';
      e.clock = 0;
    }
  }
  for (const r of s.railReturns || []) {
    if (r.phase === 'done') continue;
    const m = r.movement;
    if (r.phase === 'coupling') {
      r.clock += dt;
      if (r.clock < 8) {
        r.status = 'Railway crew coupling and testing brakes';
        continue;
      }
      r.phase = 'returning';
      r.movement = r.departure;
      r.clock = 0;
      record(s, r.id, 'Return consist coupled; brake test complete.');
      continue;
    }
    if (!supplierSwitches(s, m, dt)) {
      r.status = 'Railway service crew setting pickup route';
      continue;
    }
    const cars = r.carIds.map((id) => allRailCars(s).find((q) => q.car.id === id)!.car),
      hauling = r.phase === 'returning';
    const done = advance(
      s,
      r.id,
      m,
      dt,
      (at) =>
        hauling
          ? consistBoxes(m, cars, at, r.id)
          : [box(bodyPose(m, at, 5.58, -1), 8.6, 2.65, r.id)],
      new Set([r.id, ...(hauling ? r.carIds : [])]),
      4,
    );
    const p = bodyPose(m, m.distance, 5.58, hauling ? 1 : -1);
    r.x = p.x;
    r.z = p.z;
    r.yaw = p.yaw;
    r.bogies = p.bogies;
    if (hauling)
      cars.forEach((c, i) =>
        carMotion(s, m, c, m.distance - (m.couplerOffset ?? COUPLER) - i * RAIL_CAR_SPACING),
      );
    r.status = m.blockedBy
      ? `Waiting for ${m.blockedBy}`
      : hauling
        ? 'Empty return train departing forward'
        : 'Mainline locomotive backing to coupling end';
    if (!done) continue;
    if (!hauling) {
      r.phase = 'coupling';
      r.clock = 0;
      continue;
    }
    r.phase = 'done';
    r.status = 'Empty cars returned to supplier';
    cars.forEach((c) => (c.returned = true));
    for (const oid of r.orderIds) {
      const o = s.orders.find((o) => o.id === oid)!;
      o.railFreight!.returnId = undefined;
      if (o.railFreight!.cars.every((c) => c.returned)) {
        o.status = 'done';
        o.carrierDeparted = true;
        o.note = 'Empty cars returned by mainline collection';
      }
    }
    announce(
      s,
      r.id,
      'Empty train departed',
      `${r.carIds.length} empty cars returned; ${r.orderIds.join(', ')} complete.`,
    );
  }
  // Running charges are measured in actual simulated seconds; detached
  // supplier engines stop costing money when they clear the factory.
  const idling = s.orders.filter(
    (o) =>
      o.railFreight &&
      !['ordered', 'done'].includes(o.status) &&
      (!o.railFreight.detached || o.railFreight.locomotivePhase !== 'gone'),
  );
  for (const o of idling) {
    const f = o.railFreight!;
    f.idleClock = (f.idleClock || 0) + dt;
    if (f.idleClock >= 60) {
      f.idleClock -= 60;
      charge(s, o.id, 'Mainline locomotive time · 1 minute', 3);
    }
  }
}
