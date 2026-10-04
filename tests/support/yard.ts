import * as S from '../../src/sim.ts';
import { EQUIPMENT, ROLES } from '../../src/catalog.ts';
import type { State, Equipment, EquipmentKind, Role } from '../../src/types.ts';

// Opening assets for focused unit tests. Full bootstrap tests order these assets
// through procurement and observe every transport/deployment phase instead.
export function seedHandlingResources(s: State, kind: EquipmentKind = 'forklift') {
  const roles: Role[] = kind === 'excavator' ? ['operator', 'builder'] : ['operator'];
  for (const role of roles) {
    s.workers.push({
      id: S.id(s, 'worker'),
      name: `Worker #${s.workers.length + 1}`,
      role,
      duty: 'auto',
      status: 'Available',
      hours: 0,
      wage: ROLES[role].wage,
      x: 13.5 + s.workers.length,
      z: 24.5,
      y: 0,
      heading: 0,
      yaw: 0,
      path: [],
    });
  }
  const e: Equipment = {
    id: S.id(s, 'equipment'),
    kind,
    x: 8.5,
    z: 28.5,
    y: 0,
    heading: 0,
    yaw: 0,
    path: [],
    fuel: EQUIPMENT[kind].tank,
    tank: EQUIPMENT[kind].tank,
    used: 0,
    work: 0,
  };
  s.equipment.push(e);
  return e;
}

export function stateSummary(s: State) {
  return JSON.stringify({
    deliveries: s.orders
      .filter((o) => o.status !== 'done')
      .map((o) => ({
        id: o.id,
        item: o.item,
        status: o.status,
        phase: o.unload?.phase || o.deployment,
        note: o.note,
      })),
    jobs: s.jobs
      .filter((j) => j.status !== 'done')
      .map((j) => ({
        id: j.id,
        kind: j.kind,
        phase: j.phase,
        reason: j.reason,
      })),
    machines: s.equipment.map((e) => ({
      id: e.id,
      x: e.x,
      z: e.z,
      blockedBy: e.blockedBy,
      fuel: e.fuel,
      operator: e.operator,
      delivery: e.deliveryOrder,
      transport: e.transportOrder,
      remainingPath: e.path.length,
    })),
    workers: s.workers
      .filter((w) => w.path.length || w.blockedBy)
      .map((w) => ({
        id: w.id,
        x: w.x,
        z: w.z,
        status: w.status,
        blockedBy: w.blockedBy,
        next: w.path[0],
      })),
  });
}

export function tickUntil(
  s: State,
  predicate: () => boolean,
  seconds = 1800,
  inspect?: () => void,
) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    if (predicate()) return;
    S.tick(s, 0.1);
    inspect?.();
  }
  if (!predicate()) throw new Error(`Timed out after ${seconds} s: ${stateSummary(s)}`);
}

export function advance(s: State, seconds: number) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) S.tick(s, 0.1);
}

// Scenario controller acting as the player: request the existing physical fuel
// service, using drums already ordered by the scenario. It never edits fuel.
export function requestLowFuelService(s: State) {
  if (!s.stacks.some((t) => t.item === 'diesel' && (t.liters || 0) > 0)) return;
  if (
    !s.jobs.some((j) => j.status !== 'done' && j.status !== 'canceled') &&
    !s.orders.some((o) => o.status !== 'done')
  )
    return;
  for (const e of s.equipment) {
    if (
      e.transportOrder ||
      e.fuel >= 8 ||
      s.jobs.some(
        (j) =>
          j.kind === 'refuel' &&
          j.target === e.id &&
          j.status !== 'done' &&
          j.status !== 'canceled',
      )
    )
      continue;
    const error = S.refuel(s, e.id);
    if (error) throw new Error(error);
  }
}

export function checkScenarioFuel(s: State) {
  const supplied =
    s.equipment.reduce((n, e) => n + e.tank, 0) + S.totals(s, 'diesel').delivered * 200;
  const accounted =
    s.equipment.reduce(
      (n, e) => n + e.fuel + e.used + (e.cargo?.item === 'diesel' ? e.cargo.qty * 200 : 0),
      0,
    ) +
    s.stacks.filter((t) => t.item === 'diesel').reduce((n, t) => n + (t.liters || 0), 0) +
    s.jobs.reduce((n, j) => n + (j.fuelLiters || 0), 0);
  if (Math.abs(supplied - accounted) > 0.0001)
    throw new Error(
      `Fuel is not conserved across drums, service cans, tanks, and consumption: ${supplied} != ${accounted}`,
    );
}
