/** Validate native railway operations without importing simulation mutations. */
import type { State } from './types';
import { routingEdges, sampleRailRoute } from './rail-routing';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0 && v < 1e9;
const pose = (v: any) =>
  v &&
  finite(v.x) &&
  finite(v.z) &&
  Math.abs(v.x) < 10000 &&
  Math.abs(v.z) < 10000 &&
  finite(v.yaw) &&
  Math.abs(v.yaw) < 1e8;
const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length < 2000;
const routeName = (v: unknown) => v === 'straight' || v === 'branch';
const uniqueStrings = (v: any, max = 1000) =>
  Array.isArray(v) && v.length <= max && v.every(text) && new Set(v).size === v.length;
const optionalClock = (v: unknown) => v === undefined || nonnegative(v);
const bogies = (v: any) => v === undefined || (Array.isArray(v) && v.length === 2 && v.every(pose));

export function railOperationsValidationProblem(s: State, ids: Set<string>): string | undefined {
  const shunters: any = s.shunters === undefined ? [] : s.shunters,
    returns: any = s.railReturns === undefined ? [] : s.railReturns;
  if (!Array.isArray(shunters) || shunters.length > 32) return 'invalid shunter register';
  if (!Array.isArray(returns) || returns.length > 150000) return 'invalid return train register';
  const edges = new Map(routingEdges(s).map((e) => [`${e.trackId}:${e.path.route}`, e.path]));
  const identity = (v: any, prefix: string) => {
    if (typeof v !== 'string' || !new RegExp(`^${prefix}-[0-9]+$`).test(v) || ids.has(v))
      return false;
    ids.add(v);
    return true;
  };
  const anchor = (v: any, active = true) => {
    if (!v || !text(v.trackId) || !routeName(v.route) || !nonnegative(v.offset)) return false;
    const path = edges.get(`${v.trackId}:${v.route}`);
    return path ? v.offset <= path.length + 1e-3 : !active;
  };
  const at = (trackId: string, route: string, offset: number) => {
    const p = edges.get(`${trackId}:${route}`)!;
    let length = 0;
    for (let n = 1; n < p.points.length; n++)
      length += Math.hypot(p.points[n].x - p.points[n - 1].x, p.points[n].z - p.points[n - 1].z);
    return sampleRailRoute(p.points, (offset / p.length) * length);
  };
  const movement = (m: any, active = true) => {
    if (
      !m ||
      !Array.isArray(m.points) ||
      m.points.length < 2 ||
      m.points.length > 50000 ||
      !m.points.every(pose) ||
      !['length', 'distance', 'end', 'velocity', 'clock'].every((k) => nonnegative(m[k])) ||
      m.distance > m.end + 1e-3 ||
      m.end > m.length + 1e-3 ||
      m.velocity > 20 ||
      (m.couplerOffset !== undefined &&
        (!finite(m.couplerOffset) ||
          Math.abs(m.couplerOffset) < 13.4 - 0.001 ||
          Math.abs(m.couplerOffset) > 20000)) ||
      !uniqueStrings(m.tracks, 150000) ||
      !m.tracks.length ||
      !Array.isArray(m.segments) ||
      !m.segments.length ||
      m.segments.length > 150000 ||
      !Array.isArray(m.switches) ||
      m.switches.length > 150000 ||
      (m.blockedBy !== undefined && !text(m.blockedBy)) ||
      !optionalClock(m.blockedSince) ||
      (m.blockedSince !== undefined && m.blockedSince > s.elapsed + 0.1) ||
      (m.warned !== undefined && typeof m.warned !== 'boolean')
    )
      return false;
    let end = 0;
    for (const part of m.segments) {
      if (
        !part ||
        !text(part.trackId) ||
        !routeName(part.route) ||
        !['from', 'to', 'start', 'length'].every((k) => nonnegative(part[k])) ||
        !m.tracks.includes(part.trackId) ||
        Math.abs(part.start - end) > 1e-3 ||
        Math.abs(part.length - Math.abs(part.to - part.from)) > 1e-3 ||
        !anchor({ trackId: part.trackId, route: part.route, offset: part.from }, active) ||
        !anchor({ trackId: part.trackId, route: part.route, offset: part.to }, active)
      )
        return false;
      end += part.length;
    }
    if (
      Math.abs(end - m.length) > 0.001 ||
      new Set(m.segments.map((v: any) => v.trackId)).size !== m.tracks.length
    )
      return false;
    const switches = new Set();
    for (const sw of m.switches) {
      if (
        !sw ||
        !text(sw.id) ||
        !routeName(sw.route) ||
        switches.has(sw.id) ||
        !m.tracks.includes(sw.id)
      )
        return false;
      switches.add(sw.id);
      if (
        active &&
        sw.id !== 'BOOTSTRAP-SWITCH' &&
        !s.rails.some(
          (r) => r.id === sw.id && r.track?.layout === 'turnout' && r.track.section === 0,
        )
      )
        return false;
    }
    if (!active) return true; // Completed records may refer to later-recovered rail.
    let actual = 0;
    const distances = [0];
    for (let n = 1; n < m.points.length; n++) {
      actual += Math.hypot(m.points[n].x - m.points[n - 1].x, m.points[n].z - m.points[n - 1].z);
      distances.push(actual);
    }
    if (Math.abs(actual - m.length) > Math.max(0.05, m.length * 0.005)) return false;
    let index = 0;
    for (let n = 0; n < m.points.length; n++) {
      const station = actual ? (distances[n] / actual) * m.length : 0;
      while (
        index < m.segments.length - 1 &&
        station > m.segments[index].start + m.segments[index].length + 0.001
      )
        index++;
      const part = m.segments[index],
        expected = at(
          part.trackId,
          part.route,
          part.from +
            Math.sign(part.to - part.from) *
              Math.min(part.length, Math.max(0, station - part.start)),
        );
      if (Math.hypot(m.points[n].x - expected.x, m.points[n].z - expected.z) > 0.15) return false;
    }
    return true;
  };
  const supportedPose = (p: any, samples: any, wheelbase = 5.58) => {
    if (samples === undefined) return true;
    const a = samples[0],
      b = samples[1],
      span = Math.hypot(b.x - a.x, b.z - a.z);
    return (
      Math.hypot(p.x - (a.x + b.x) / 2, p.z - (a.z + b.z) / 2) < 0.05 &&
      span >= wheelbase * 0.85 &&
      span <= wheelbase * 1.05 &&
      Math.abs(Math.cos(p.yaw - Math.atan2(b.z - a.z, b.x - a.x))) > 0.99
    );
  };
  const anchoredPose = (p: any, a: any, tolerance: number) => {
    const edge = edges.get(`${a.trackId}:${a.route}`);
    if (!edge) return true; // Only historical returned car anchors can be absent.
    const expected = at(a.trackId, a.route, a.offset);
    return Math.hypot(p.x - expected.x, p.z - expected.z) < tolerance;
  };
  const movingPose = (p: any, m: any, wheelbase = 5.58) => {
    const sample = (station: number) => {
      if (station < 0) {
        const v = m.points[0];
        return { x: v.x + Math.cos(v.yaw) * station, z: v.z + Math.sin(v.yaw) * station };
      }
      if (station > m.length) {
        const v = m.points.at(-1);
        return {
          x: v.x + Math.cos(v.yaw) * (station - m.length),
          z: v.z + Math.sin(v.yaw) * (station - m.length),
        };
      }
      return sampleRailRoute(m.points, station);
    };
    const a = sample(m.distance - wheelbase / 2),
      b = sample(m.distance + wheelbase / 2);
    return Math.hypot(p.x - (a.x + b.x) / 2, p.z - (a.z + b.z) / 2) < 0.1;
  };
  const cars = new Map(
    s.orders.flatMap((o) =>
      (o.railFreight?.cars || []).map((c) => [c.id, { car: c, order: o }] as const),
    ),
  );
  const reservedCars = new Set<string>(),
    drivers = new Set<string>();
  for (const e of shunters) {
    if (
      !e ||
      !identity(e.id, 'SHUNTER') ||
      !text(e.name) ||
      !text(e.status) ||
      !pose(e) ||
      ![
        'ordered',
        'delivering',
        'parked',
        'boarding',
        'approaching',
        'coupling',
        'hauling',
        'uncoupling',
        'parking',
      ].includes(e.phase) ||
      !nonnegative(e.fuel) ||
      !nonnegative(e.tank) ||
      e.tank <= 0 ||
      e.tank > 10000 ||
      e.fuel > e.tank ||
      !nonnegative(e.used) ||
      !nonnegative(e.eta) ||
      !bogies(e.bogies) ||
      !optionalClock(e.clock) ||
      !optionalClock(e.driverClock) ||
      !optionalClock(e.gearPause) ||
      (e.approachQueue !== undefined &&
        (!Array.isArray(e.approachQueue) ||
          e.approachQueue.length > 5 ||
          e.approachQueue.some((m: any) => !movement(m)))) ||
      (e.direction !== undefined && ![-1, 1].includes(e.direction)) ||
      (e.driverPhase !== undefined &&
        !['walking', 'boarding', 'aboard', 'switch'].includes(e.driverPhase))
    )
      return 'invalid owned shunter';
    if (e.anchor !== undefined && !anchor(e.anchor))
      return 'missing or invalid shunter track anchor';
    if (!supportedPose(e, e.bogies) || (e.anchor && !anchoredPose(e, e.anchor, 0.5)))
      return 'shunter pose is inconsistent with rail position';
    if (e.phase === 'parked' && !e.anchor) return 'parked shunter has no track anchor';
    if (
      (e.movement !== undefined && !movement(e.movement)) ||
      (e.haul !== undefined && !movement(e.haul))
    )
      return 'invalid shunter movement';
    if (e.movement && !movingPose(e, e.movement))
      return 'shunter pose is inconsistent with current movement';
    if (!['ordered', 'parked'].includes(e.phase) && !e.movement)
      return 'active shunter has no reserved movement';
    if (['coupling', 'hauling', 'uncoupling'].includes(e.phase) && !e.haul)
      return 'shunting consist has no haul route';
    for (const key of ['locationId', 'destinationId'])
      if (e[key] !== undefined && (!text(e[key]) || !s.railLocations?.some((l) => l.id === e[key])))
        return 'missing shunter named location';
    if (
      e.switchId !== undefined &&
      (!text(e.switchId) ||
        !s.rails.some(
          (r) => r.id === e.switchId && r.track?.layout === 'turnout' && r.track.section === 0,
        ))
    )
      return 'missing shunter switch';
    if (e.driverId !== undefined) {
      const w = s.workers.find((w) => w.id === e.driverId);
      if (
        !w ||
        w.role !== 'operator' ||
        drivers.has(w.id) ||
        (w.vehicle !== undefined && w.vehicle !== e.id) ||
        (w.railAssignment !== undefined && w.railAssignment !== e.id)
      )
        return 'invalid or duplicate shunter driver';
      if (e.driverPhase === 'aboard' && w.vehicle !== e.id) return 'shunter driver is not aboard';
      drivers.add(w.id);
    }
    if (e.driverPhase !== undefined && !e.driverId) return 'shunter driver phase has no driver';
    if (e.orderId !== undefined && !s.orders.some((o) => o.id === e.orderId && o.railFreight))
      return 'missing shunter freight order';
    if (e.carIds !== undefined) {
      if (
        !uniqueStrings(e.carIds) ||
        !e.carIds.length ||
        !s.orders.some((o) => o.id === e.orderId && o.railFreight?.detached)
      )
        return 'invalid shunting car reservation';
      if (
        e.haul?.couplerOffset !== undefined &&
        Math.abs(e.haul.couplerOffset - 13.4) > 0.001 &&
        Math.abs(e.haul.couplerOffset + (13.4 + 17.6 * (e.carIds.length - 1))) > 0.001
      )
        return 'shunter coupler does not match reserved consist';
      for (const id of e.carIds) {
        const record = cars.get(id);
        if (!record || record.order.id !== e.orderId || record.car.returned || reservedCars.has(id))
          return 'missing or duplicate shunting car';
        reservedCars.add(id);
      }
    } else if (['coupling', 'hauling', 'uncoupling'].includes(e.phase))
      return 'active shunting consist has no cars';
  }
  for (const w of s.workers)
    if (
      w.railAssignment !== undefined &&
      (!text(w.railAssignment) ||
        !shunters.some((e: any) => e.id === w.railAssignment && e.driverId === w.id))
    )
      return 'worker rail assignment is missing';
  for (const r of returns) {
    if (
      !r ||
      !identity(r.id, 'RETURN') ||
      !identity(r.locomotiveId, 'LOCO') ||
      !pose(r) ||
      !text(r.status) ||
      !['collecting', 'coupling', 'returning', 'done'].includes(r.phase) ||
      !nonnegative(r.clock) ||
      !bogies(r.bogies) ||
      !uniqueStrings(r.orderIds, 1000) ||
      !r.orderIds.length ||
      !uniqueStrings(r.carIds) ||
      !r.carIds.length ||
      !movement(r.movement, r.phase !== 'done') ||
      !movement(r.departure, r.phase !== 'done')
    )
      return 'invalid empty return train';
    if (!supportedPose(r, r.bogies)) return 'return locomotive bogies do not support its body';
    if (r.phase !== 'done' && !movingPose(r, r.movement))
      return 'return locomotive pose is inconsistent with current movement';
    for (const oid of r.orderIds)
      if (
        !s.orders.some(
          (o) =>
            o.id === oid &&
            o.railFreight?.detached &&
            (r.phase === 'done' || o.railFreight.returnId === r.id),
        )
      )
        return 'missing or unbound return train order';
    for (const id of r.carIds) {
      const record = cars.get(id);
      if (
        !record ||
        !r.orderIds.includes(record.order.id) ||
        record.car.manifest.some((l) => l.arrived !== l.qty) ||
        (r.phase !== 'done' && (record.car.returned || reservedCars.has(id)))
      )
        return 'loaded, missing or duplicate return car';
      if (r.phase !== 'done') reservedCars.add(id);
      else if (!record.car.returned) return 'completed return has unreturned car';
    }
  }
  for (const o of s.orders) {
    const f = o.railFreight;
    if (!f) continue;
    if (
      (f.detached !== undefined && typeof f.detached !== 'boolean') ||
      (f.locomotivePhase !== undefined &&
        !['attached', 'uncoupling', 'leaving', 'gone'].includes(f.locomotivePhase)) ||
      (f.locomotivePose !== undefined && !pose(f.locomotivePose)) ||
      !bogies(f.locomotiveBogies) ||
      !optionalClock(f.locomotiveClock) ||
      !optionalClock(f.idleClock)
    )
      return 'invalid detached freight locomotive';
    if (f.locomotivePose && !supportedPose(f.locomotivePose, f.locomotiveBogies))
      return 'supplier locomotive bogies do not support its body';
    if (
      (f.detached && !['uncoupling', 'leaving', 'gone'].includes(f.locomotivePhase || '')) ||
      (!f.detached && f.locomotivePhase !== undefined && f.locomotivePhase !== 'attached')
    )
      return 'inconsistent freight locomotive release';
    if (f.incomingRailMove !== undefined && !movement(f.incomingRailMove, o.status !== 'done'))
      return 'invalid reserved supplier approach';
    if (f.movement !== undefined && !movement(f.movement, o.status !== 'done'))
      return 'invalid supplier locomotive movement';
    if (f.movement && f.locomotivePose && !movingPose(f.locomotivePose, f.movement))
      return 'supplier locomotive pose is inconsistent with current movement';
    if (
      ['uncoupling', 'leaving'].includes(f.locomotivePhase || '') &&
      (!f.movement || !f.locomotivePose)
    )
      return 'departing supplier locomotive has no physical route';
    if (f.locomotivePhase === 'gone' && f.movement)
      return 'departed supplier locomotive still reserves rail';
    if (
      f.unloadCarIds !== undefined &&
      (!uniqueStrings(f.unloadCarIds) ||
        f.unloadCarIds.some(
          (id) => !f.cars.some((c) => c.id === id && (!f.unloadRequested || !c.returned)),
        ))
    )
      return 'invalid selected unloading cars';
    if (
      f.returnId !== undefined &&
      !returns.some(
        (r: any) => r.id === f.returnId && r.phase !== 'done' && r.orderIds.includes(o.id),
      )
    )
      return 'missing active freight return';
    for (const c of f.cars) {
      if (
        (c.returned !== undefined && typeof c.returned !== 'boolean') ||
        (c.pose !== undefined && !pose(c.pose)) ||
        !bogies(c.bogies) ||
        (c.anchor !== undefined && !anchor(c.anchor, !c.returned))
      )
        return 'invalid freight car physical pose';
      if (
        c.pose &&
        (!supportedPose(c.pose, c.bogies, c.wheelbase) ||
          (c.anchor && !anchoredPose(c.pose, c.anchor, 1.8)))
      )
        return 'freight car pose is inconsistent with rail position';
      if (f.detached && (!c.pose || !c.anchor || !c.bogies))
        return 'detached freight car has no physical track position';
      if (c.returned && (!f.detached || c.manifest.some((l) => l.arrived !== l.qty)))
        return 'loaded or attached freight car marked returned';
      if (
        c.locationId !== undefined &&
        (!text(c.locationId) ||
          (!c.returned && !s.railLocations?.some((l) => l.id === c.locationId)))
      )
        return 'missing freight car named location';
      if (
        c.groupId !== undefined &&
        (!text(c.groupId) ||
          (!c.returned && c.groupId !== o.id && !s.railLocations?.some((l) => l.id === c.groupId)))
      )
        return 'missing freight car group';
    }
  }
}
