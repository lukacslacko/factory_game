/** Physical railway ground work. Cars stay still until the crew has completed
 * their serialized brake, coupler and hose actions and returned clear of rail. */
import type { State, Point, RailFreightCar, RailCoupling, RailCrewAction, RailServiceCrew, RailReturn, Rail, Worker, RailShunter } from './types';
import { railFreightCarPose } from './rail-freight';
import { localPoint, angleDelta } from './motion';
import { walkRoute, staticObstacleRects, workerMoveBlocked } from './traffic';
import { turnoutWorkerPoint } from './turnout-operation';

export interface CouplingOptions {
  ownerId: string;
  locomotiveId: string;
  locomotivePose: Point & { yaw: number };
  carIds: string[];
  mode: 'couple' | 'uncouple';
  /** The qualified assigned driver performs owned shunter ground work. */
  workerId?: string;
}
type Holder = { coupling?: RailCoupling };
const makeId = (s: State, prefix: string) => `${prefix}-${String(s.next++).padStart(4, '0')}`;
const allCars = (s: State) => s.orders.flatMap(o => o.railFreight?.cars || []);
const carById = (s: State, id: string) => allCars(s).find(c => c.id === id);
function event(s: State, entity: string, text: string, warning = false) {
  s.events.push({ id: makeId(s, 'EV'), time: s.time, entity, type: 'Railway', text,
    severity: warning ? 'warning' : 'info' });
  s.revision++;
}
/** Old saves acquire their existing links once; this never reconstructs a link
 * after it has been deliberately disconnected. */
export function initializeRailCouplers(s: State) {
  for (const o of s.orders) {
    const f = o.railFreight;
    if (!f) continue;
    for (let i = 0; i < f.cars.length; i++) {
      const c = f.cars[i];
      c.coupledTo ??= [
        ...(i ? [f.cars[i - 1].id] : !f.detached ? [f.locomotiveId] : []),
        ...(i + 1 < f.cars.length ? [f.cars[i + 1].id] : []),
      ];
      c.handbrake ??= !!f.detached;
      c.brakeHoseConnected ??= !f.detached;
    }
  }
}
function carPose(s: State, c: RailFreightCar) {
  const o = s.orders.find(o => o.railFreight?.cars.some(q => q.id === c.id))!;
  return railFreightCarPose(o, o.railFreight!.cars.indexOf(c));
}
function crew(s: State, ownerId: string, locomotiveId: string, pose: Point & { yaw: number }) {
  let c = s.railServiceCrew?.find(c => c.ownerId === ownerId);
  if (!c) {
    c = { id: makeId(s, 'CREW'), name: 'Railway service crew', ownerId, locomotiveId,
      ...localPoint(pose, 0, 2.05), yaw: pose.yaw, y: 1.65, path: [], phase: 'aboard', status: 'Aboard service locomotive' };
    (s.railServiceCrew ??= []).push(c);
    s.costs.push({ id: makeId(s, 'COST'), time: s.time, category: 'Railway', entity: ownerId,
      description: `Railway ground crew service · ${c.id}`, amount: 45 });
    event(s, ownerId, `${c.id} arrived aboard ${locomotiveId}; railway ground work authorized.`);
  }
  return c;
}
const label: Record<RailCrewAction['kind'], string> = {
  'secure-brake': 'Applying car handbrake', disconnect: 'Disconnecting brake hoses and coupler',
  connect: 'Connecting coupler and brake hoses', 'hose-test': 'Testing continuous air brake',
  'release-brake': 'Releasing car handbrake', clear: 'Returning clear of the rail movement', switch: 'Throwing turnout lever',
  inspect: 'Inspecting delivered locomotive', handover: 'Signing locomotive handover',
};
function link(s: State, a: string, b: string, connect: boolean) {
  for (const [own, other] of [[a, b], [b, a]]) {
    const c = carById(s, own);
    if (!c) continue; // Locomotive identities are recorded on their adjacent car.
    const links = c.coupledTo ??= [];
    if (connect && !links.includes(other)) links.push(other);
    if (!connect) c.coupledTo = links.filter(id => id !== other);
  }
}
function actionsFor(s: State, p: CouplingOptions): RailCrewAction[] {
  const cars = p.carIds.map(id => carById(s, id)!);
  const selected = new Set(p.carIds), actions: RailCrewAction[] = [];
  const side = (c: RailFreightCar) => localPoint(carPose(s, c), 0, 2.05);
  const end = (c: RailFreightCar, other: Point) => {
    const cp = carPose(s, c);
    const sign = (other.x - cp.x) * Math.cos(cp.yaw) + (other.z - cp.z) * Math.sin(cp.yaw) >= 0 ? 1 : -1;
    return { ...localPoint(cp, sign * (c.length / 2 + 0.1), 2.05), yaw: cp.yaw - Math.PI / 2 };
  };
  const engineCar = cars.slice().sort((a, b) => {
    const pa = carPose(s, a), pb = carPose(s, b);
    return Math.hypot(pa.x - p.locomotivePose.x, pa.z - p.locomotivePose.z) - Math.hypot(pb.x - p.locomotivePose.x, pb.z - p.locomotivePose.z);
  })[0];
  if (p.mode === 'uncouple') {
    for (const c of cars) actions.push({ kind: 'secure-brake', carId: c.id, point: { ...side(c), yaw: carPose(s, c).yaw - Math.PI / 2 }, seconds: 3 });
    actions.push({ kind: 'disconnect', carId: engineCar.id, otherId: p.locomotiveId, point: end(engineCar, p.locomotivePose), seconds: 4 });
  } else {
    // Split an explicitly selected sub-consist at its boundary before attaching
    // the shunter; untouched cars retain their brakes and exact ground pose.
    for (const c of cars)
      for (const other of c.coupledTo || [])
        if (!selected.has(other) && other !== p.locomotiveId) {
          const peer = carById(s, other);
          actions.push({ kind: 'disconnect', carId: c.id, otherId: other,
            point: end(c, peer ? carPose(s, peer) : p.locomotivePose), seconds: 4 });
        }
    for (let i = 1; i < cars.length; i++)
      if (!cars[i - 1].coupledTo?.includes(cars[i].id))
        actions.push({ kind: 'connect', carId: cars[i - 1].id, otherId: cars[i].id,
          point: end(cars[i - 1], carPose(s, cars[i])), seconds: 4 });
    actions.push({ kind: 'connect', carId: engineCar.id, otherId: p.locomotiveId,
      point: end(engineCar, p.locomotivePose), seconds: 4 });
    actions.push({ kind: 'hose-test', carId: engineCar.id, point: end(engineCar, p.locomotivePose), seconds: 5 });
    for (const c of cars) actions.push({ kind: 'release-brake', carId: c.id,
      point: { ...side(c), yaw: carPose(s, c).yaw - Math.PI / 2 }, seconds: 2 });
  }
  actions.push({ kind: 'clear', point: { ...localPoint(p.locomotivePose, 0, 2.05), yaw: p.locomotivePose.yaw }, seconds: 0 });
  return actions;
}
function newTask(s: State, p: CouplingOptions): RailCoupling {
  initializeRailCouplers(s);
  const service = !p.workerId, w = service ? crew(s, p.ownerId, p.locomotiveId, p.locomotivePose) : s.workers.find(w => w.id === p.workerId)!;
  const t: RailCoupling = { id: makeId(s, 'COUPLING'), ownerId: p.ownerId,
    locomotiveId: p.locomotiveId, workerId: w.id, serviceCrew: service,
    mode: p.mode, carIds: [...p.carIds], actions: actionsFor(s, p), step: 0, clock: 0,
    phase: 'alighting', status: 'Ground crew alighting from locomotive' };
  w.path = [];
  if (!service) (w as Worker).vehicle = undefined;
  else (w as RailServiceCrew).phase = 'alighting';
  Object.assign(w, localPoint(p.locomotivePose, 0, 2.05), { y: 1.65, velocity: 0 });
  event(s, t.ownerId, `${t.workerId} begins ${t.mode} work ${t.id} for ${t.carIds.join(', ')}.`);
  return t;
}
function warn(s: State, t: RailCoupling, reason: string) {
  t.status = reason;
  t.blockedSince ??= s.elapsed;
  if (!t.warned && s.elapsed - t.blockedSince >= 20) {
    t.warned = true;
    s.notices.unshift({ id: makeId(s, 'N'), time: s.time, entity: t.ownerId, title: 'Rail ground work blocked',
      detail: `${t.workerId}: ${reason}. Clear the marked crew approach; the train remains secured.`, state: 'todo', seen: false });
    event(s, t.ownerId, reason, true);
  }
}
function apply(s: State, t: RailCoupling, a: RailCrewAction) {
  const c = a.carId ? carById(s, a.carId) : undefined;
  if (a.kind === 'secure-brake' && c) c.handbrake = true;
  if (a.kind === 'release-brake' && c) c.handbrake = false;
  if ((a.kind === 'connect' || a.kind === 'disconnect') && c && a.otherId) {
    link(s, c.id, a.otherId, a.kind === 'connect');
    if (a.kind === 'disconnect') {
      c.brakeHoseConnected = false;
      const peer = carById(s, a.otherId);
      if (peer) peer.brakeHoseConnected = false;
    }
  }
  if (a.kind === 'hose-test') for (const id of t.carIds) carById(s, id)!.brakeHoseConnected = true;
  if (a.kind === 'switch') s.rails.find(r => r.id === a.trackId)!.selectedRoute = a.route;
  event(s, t.ownerId, `${t.workerId}: ${label[a.kind]}${a.carId ? ` · ${a.carId}` : ''}${a.otherId ? ` ↔ ${a.otherId}` : ''}.`);
}
/** Advance contractor walking here. Owned workers use the game's ordinary
 * pedestrian movement, avoiding double movement and preserving its yielding. */
function walkContractor(s: State, w: RailServiceCrew, dt: number) {
  let remaining = dt * 1.7;
  w.velocity = 0;
  while (remaining > 1e-6 && w.path.length) {
    const target = w.path[0], d = Math.hypot(target.x - w.x, target.z - w.z);
    if (d < 0.005) { w.path.shift(); continue; }
    const step = Math.min(remaining, d, 0.15), next = { x: w.x + (target.x - w.x) * step / d, z: w.z + (target.z - w.z) * step / d };
    const blocked = workerMoveBlocked(s, w, next);
    if (blocked) { w.blockedBy = blocked; w.path = []; return; }
    w.yaw = (w.yaw || 0) + angleDelta(w.yaw || 0, Math.atan2(next.z - w.z, next.x - w.x)) * Math.min(1, dt * 8);
    Object.assign(w, next); w.velocity = 1.7; remaining -= step;
    if (step >= d - 1e-6) w.path.shift();
  }
}
function advanceTask(s: State, t: RailCoupling, dt: number): boolean {
  if (t.phase === 'done') return true;
  const w = t.serviceCrew ? s.railServiceCrew?.find(w => w.id === t.workerId) : s.workers.find(w => w.id === t.workerId);
  if (!w) { warn(s, t, `Assigned ground worker ${t.workerId} is missing`); return false; }
  if (t.phase === 'alighting' || t.phase === 'boarding') {
    t.clock += dt;
    w.y = t.phase === 'alighting' ? Math.max(0, 1.65 * (1 - t.clock / 2)) : Math.min(1.65, 1.65 * t.clock / 2);
    w.status = t.status;
    if (t.clock < 2) return false;
    t.clock = 0;
    if (t.phase === 'boarding') {
      t.phase = 'done';
      (w as RailServiceCrew).phase = 'aboard';
      w.status = 'Aboard service locomotive';
      return true;
    }
    t.phase = 'walking';
    if (t.serviceCrew) (w as RailServiceCrew).phase = 'ground';
  }
  const a = t.actions[t.step];
  if (!a) {
    if (t.mode === 'handover') {
      t.phase = 'done'; (w as RailServiceCrew).phase = 'left-site';
      w.status = 'Supplier driver left the yard on foot through the entrance';
      event(s, t.ownerId, `${w.id} completed delivery inspection and signed handover, then walked out through the site entrance.`);
      return true;
    }
    if (t.serviceCrew) { t.phase = 'boarding'; (w as RailServiceCrew).phase = 'boarding'; t.status = 'Ground crew boarding service locomotive'; return false; }
    t.phase = 'done'; w.status = 'Ground work complete · ready to board'; return true;
  }
  const escape = w.path.at(-1);
  if (!t.serviceCrew && escape && Math.hypot(escape.x - a.point.x, escape.z - a.point.z) > 0.5) {
    t.status = `${w.id} clearing traffic before resuming ground work`; return false;
  }
  if (Math.hypot(w.x - a.point.x, w.z - a.point.z) > 0.22) {
    t.phase = 'walking';
    if (!w.path.length && s.elapsed >= (t.retryAt || 0)) {
      w.path = walkRoute(s, w, a.point, staticObstacleRects(s), t.serviceCrew) || [];
      t.retryAt = s.elapsed + 2;
    }
    if (!w.path.length) { warn(s, t, `No clear walking route to ${a.carId || a.trackId || 'locomotive'} ground work`); return false; }
    t.status = `${w.id} walking to ${a.carId || a.trackId || 'locomotive'} · ${label[a.kind].toLowerCase()}`;
    w.status = t.status;
    if (t.serviceCrew) walkContractor(s, w as RailServiceCrew, dt);
    return false;
  }
  w.path = []; w.velocity = 0; w.yaw = a.point.yaw;
  t.blockedSince = undefined; t.warned = false; t.retryAt = undefined;
  t.phase = 'working'; t.status = `${w.id} · ${label[a.kind]}${a.carId ? ` · ${a.carId}` : ''}`; w.status = t.status;
  t.clock += dt;
  if (t.clock < a.seconds) return false;
  apply(s, t, a); t.step++; t.clock = 0; t.phase = 'walking';
  return false;
}
export function advanceRailCoupling(s: State, holder: Holder, dt: number, p: CouplingOptions): boolean {
  if (!p.carIds.length || p.carIds.some(id => !carById(s, id))) return false;
  if (p.workerId && !s.workers.some(w => w.id === p.workerId)) return false;
  if (!holder.coupling || holder.coupling.mode !== p.mode) holder.coupling = newTask(s, p);
  return advanceTask(s, holder.coupling, dt);
}
/** Mainline service crew can also physically set a lever before a movement. */
export function advanceRailTurnoutService(s: State, ownerId: string, locomotivePose: Point & { yaw: number }, turnout: Rail, route: 'straight' | 'branch', dt: number): boolean {
  const locomotiveId = s.orders.find(o => o.id === ownerId)?.railFreight?.locomotiveId ||
    s.railReturns?.find(r => r.id === ownerId)?.locomotiveId || ownerId;
  const w = crew(s, ownerId, locomotiveId, locomotivePose);
  if (!w.task || w.task.actions[0]?.trackId !== turnout.id || w.task.actions[0]?.route !== route) {
    w.task = { id: makeId(s, 'COUPLING'), ownerId, locomotiveId: w.locomotiveId, workerId: w.id,
      serviceCrew: true, mode: 'switch', carIds: [], actions: [
        { kind: 'switch', trackId: turnout.id, route, point: turnoutWorkerPoint(turnout), seconds: 4 },
        { kind: 'clear', point: { ...localPoint(locomotivePose, 0, 2.05), yaw: locomotivePose.yaw }, seconds: 0 },
      ], step: 0, clock: 0, phase: 'alighting', status: `Ground crew alighting to set ${turnout.id}` };
    Object.assign(w, localPoint(locomotivePose, 0, 2.05), { y: 1.65, path: [], phase: 'alighting' });
  }
  return advanceTask(s, w.task, dt);
}
/** The supplier driver delivers the purchased engine, inspects it on foot,
 * signs the handover and walks out through the site entrance. */
export function advanceShunterHandover(s: State, e: RailShunter, dt: number): boolean {
  if (!e.handover) {
    const w = crew(s, e.id, e.id, e);
    e.handover = { id: makeId(s, 'COUPLING'), ownerId: e.id, locomotiveId: e.id,
      workerId: w.id, serviceCrew: true, mode: 'handover', carIds: [], actions: [
        { kind: 'inspect', point: { ...localPoint(e, 3.5, 2.05), yaw: e.yaw - Math.PI / 2 }, seconds: 4 },
        { kind: 'inspect', point: { ...localPoint(e, -3.5, 2.05), yaw: e.yaw - Math.PI / 2 }, seconds: 4 },
        { kind: 'handover', point: { ...localPoint(e, 0, 2.05), yaw: e.yaw - Math.PI / 2 }, seconds: 3 },
        { kind: 'clear', point: { x: -40, z: -15, yaw: Math.PI }, seconds: 0 },
      ], step: 0, clock: 0, phase: 'alighting', status: 'Supplier driver alighting for delivery inspection' };
    Object.assign(w, localPoint(e, 0, 2.05), { y: 1.65, phase: 'alighting', path: [] });
  }
  return advanceTask(s, e.handover, dt);
}
/** Pickup time is paid only while its engine is on site and not traveling.
 * Whole-minute lines plus final fractional settlement conserve all seconds. */
export function tickRailPickupBilling(s: State, r: RailReturn, dt: number) {
  const waiting = r.phase === 'coupling' || (r.phase !== 'done' && (r.movement.velocity === 0 || !!r.movement.blockedBy));
  if (waiting) { r.waitingClock = (r.waitingClock || 0) + dt; r.waitingSeconds = (r.waitingSeconds || 0) + dt; }
  const bill = (seconds: number) => {
    if (seconds <= 1e-6) return;
    const amount = seconds * 3 / 60;
    r.waitingCost = (r.waitingCost || 0) + amount;
    s.costs.push({ id: makeId(s, 'COST'), time: s.time, entity: r.id, category: 'Railway',
      description: `Pickup locomotive waiting · ${seconds.toFixed(1)} seconds`, amount });
    event(s, r.id, `Pickup locomotive waiting charge: ${seconds.toFixed(1)} seconds · $${amount.toFixed(2)}.`);
  };
  while ((r.waitingClock || 0) >= 60) { r.waitingClock! -= 60; bill(60); }
  if (r.phase === 'done' && (r.waitingClock || 0) > 1e-6) { bill(r.waitingClock!); r.waitingClock = 0; }
}
