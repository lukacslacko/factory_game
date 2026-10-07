/** Bound imported ground work and reject broken physical coupler identities. */
import type { State, RailCoupling } from './types';
import { isRailQualified } from './rail-driver';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0 && v < 1e9;
const pose = (p: any) => p && finite(p.x) && finite(p.z) && Math.abs(p.x) < 10000 && Math.abs(p.z) < 10000;
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 2000;
export function railCouplingValidationProblem(s: State, ids: Set<string>): string | undefined {
  const crew: any = s.railServiceCrew === undefined ? [] : s.railServiceCrew;
  if (!Array.isArray(crew) || crew.length > 150000) return 'invalid railway service crew register';
  const owners = new Set([...s.orders.filter(o => o.railFreight).map(o => o.id), ...(s.shunters || []).map(e => e.id), ...(s.railReturns || []).map(r => r.id)]);
  const locomotives = new Set([...s.orders.flatMap(o => o.railFreight ? [o.railFreight.locomotiveId] : []), ...(s.shunters || []).map(e => e.id), ...(s.railReturns || []).map(r => r.locomotiveId)]);
  const cars = new Map(s.orders.flatMap(o => (o.railFreight?.cars || []).map(c => [c.id, c] as const)));
  const seenOwners = new Set<string>();
  for (const c of crew) {
    if (!c || !/^CREW-[0-9]+$/.test(c.id) || ids.has(c.id) || !text(c.name) ||
      !owners.has(c.ownerId) || !locomotives.has(c.locomotiveId) || seenOwners.has(c.ownerId) ||
      !pose(c) || !finite(c.yaw) || (c.y !== undefined && (!nonnegative(c.y) || c.y > 2)) ||
      !['aboard', 'alighting', 'ground', 'boarding', 'left-site'].includes(c.phase) || !text(c.status) ||
      !Array.isArray(c.path) || c.path.length > 50000 || !c.path.every(pose)) return 'invalid railway service crew';
    ids.add(c.id); seenOwners.add(c.ownerId);
  }
  const activeWorkers = new Set<string>();
  const tasks = [...s.orders.map(o => o.railFreight?.coupling), ...(s.shunters || []).flatMap(e => [e.coupling, e.handover]), ...(s.railReturns || []).map(r => r.coupling), ...crew.map((c: any) => c.task)].filter(Boolean) as RailCoupling[];
  for (const t of tasks) {
    if (!t || !/^COUPLING-[0-9]+$/.test(t.id) || ids.has(t.id) || !owners.has(t.ownerId) ||
      !locomotives.has(t.locomotiveId) || typeof t.serviceCrew !== 'boolean' ||
      !['couple', 'uncouple', 'switch', 'handover'].includes(t.mode) || !['alighting', 'walking', 'working', 'boarding', 'done'].includes(t.phase) ||
      !text(t.status) || !nonnegative(t.clock) || !Number.isInteger(t.step) || t.step < 0 ||
      !Array.isArray(t.carIds) || t.carIds.length > 1000 || new Set(t.carIds).size !== t.carIds.length || t.carIds.some(id => !cars.has(id)) ||
      (['couple', 'uncouple'].includes(t.mode) && !t.carIds.length) || !Array.isArray(t.actions) || !t.actions.length || t.actions.length > 6003 ||
      t.step > t.actions.length || (t.phase === 'done' && t.step !== t.actions.length) ||
      (t.retryAt !== undefined && !nonnegative(t.retryAt)) || (t.blockedSince !== undefined && (!nonnegative(t.blockedSince) || t.blockedSince > s.elapsed + 0.1)) ||
      (t.warned !== undefined && typeof t.warned !== 'boolean')) return 'invalid railway ground work';
    ids.add(t.id);
    const worker = t.serviceCrew ? crew.find((c: any) => c.id === t.workerId && c.ownerId === t.ownerId) : s.workers.find(w => w.id === t.workerId);
    if (!worker || (!t.serviceCrew && !isRailQualified(worker)) || (t.phase !== 'done' && activeWorkers.has(t.workerId))) return 'missing or duplicate railway ground worker';
    if (t.phase !== 'done') activeWorkers.add(t.workerId);
    for (const a of t.actions) {
      if (!a || !['secure-brake', 'disconnect', 'connect', 'hose-test', 'release-brake', 'clear', 'switch', 'inspect', 'handover'].includes(a.kind) ||
        !pose(a.point) || !finite(a.point.yaw) || !nonnegative(a.seconds) || a.seconds > 60 ||
        (a.carId !== undefined && !t.carIds.includes(a.carId)) ||
        (a.otherId !== undefined && !cars.has(a.otherId) && !locomotives.has(a.otherId)) ||
        (!['clear', 'switch', 'inspect', 'handover'].includes(a.kind) && a.carId === undefined) ||
        (['connect', 'disconnect'].includes(a.kind) && a.otherId === undefined) ||
        (a.kind === 'switch' && ((!text(a.trackId) || (t.phase !== 'done' && !s.rails.some(r => r.id === a.trackId && r.track?.layout === 'turnout'))) || !['straight', 'branch'].includes(a.route || '')))) return 'invalid railway ground work action';
    }
  }
  for (const c of cars.values()) {
    if ((c.handbrake !== undefined && typeof c.handbrake !== 'boolean') ||
      (c.brakeHoseConnected !== undefined && typeof c.brakeHoseConnected !== 'boolean')) return 'invalid freight car brake state';
    if (c.coupledTo !== undefined && (!Array.isArray(c.coupledTo) || c.coupledTo.length > 2 ||
      new Set(c.coupledTo).size !== c.coupledTo.length || c.coupledTo.some(id => id === c.id || !cars.has(id) && !locomotives.has(id)))) return 'invalid freight car coupler state';
    for (const other of c.coupledTo || []) {
      const peer = cars.get(other);
      if (peer && !peer.coupledTo?.includes(c.id)) return 'asymmetric freight car coupling';
    }
  }
  for (const r of s.railReturns || [])
    if ([r.waitingClock, r.waitingSeconds, r.waitingCost].some(v => v !== undefined && !nonnegative(v)) ||
      (r.waitingClock !== undefined && r.waitingClock >= 60.001)) return 'invalid pickup waiting account';
}
