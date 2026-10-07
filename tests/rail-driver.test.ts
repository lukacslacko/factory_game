import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { beginShunterRefueling, isRailQualified, verifyRailQualification } from '../src/rail-driver';
import { orderShunter } from '../src/rail-operations';
import { renderState } from '../native-runtime/render';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { State } from '../src/types';

function parked() {
  const s = S.createState();
  seedHandlingResources(s);
  const w = s.workers[0];
  assert.equal(isRailQualified(w), false);
  assert.equal(verifyRailQualification(s, w.id), undefined);
  assert.equal(orderShunter(s, { driverId: w.id }).error, undefined);
  const e = s.shunters![0];
  Object.assign(e, { phase: 'parked', x: 110, z: 5, yaw: 0, fuel: 325,
    anchor: { trackId: 'BOOTSTRAP-SIDING', route: 'straight', offset: 85 } });
  Object.assign(w, { x: 105, z: 20 });
  s.stacks.push({ id: S.id(s, 'STK'), item: 'diesel', qty: 1, reserved: 0, source: 'test supply', x: 112, z: 10, w: 1, d: 1, liters: 60 });
  return s;
}
const totalFuel = (s: State) => s.shunters![0].fuel + (s.stacks[0].liters || 0) + (s.shunters![0].refueling?.carried || 0);

test('qualified railway drivers arrive together in a real crew bus; operator licenses are explicit recorded paperwork', () => {
  const s = S.createState();
  const orders = S.purchaseBatch(s, [{ item: 'railDriver', qty: 3 }]);
  assert.equal(orders.length, 1); assert.equal(s.orders[0].qty, 3);
  assert.equal(s.workers.length, 0);
  tickUntil(s, () => s.workers.length === 3 && s.workers.every(w => !w.transportOrder));
  assert.ok(s.workers.every(isRailQualified));
  assert.doesNotThrow(() => S.load(S.save(s)));
  seedHandlingResources(s);
  const w = s.workers.at(-1)!;
  assert.equal(isRailQualified(w), false);
  assert.equal(verifyRailQualification(s, w.id), undefined);
  assert.equal(isRailQualified(w), true);
  assert.match(verifyRailQualification(s, w.id)!, /already/);
  assert.equal(s.costs.filter(c => c.entity === w.id && c.description.includes('license')).length, 1);
  (w as import('../src/types').Worker).role = 'builder';
  assert.equal(isRailQualified(w), false, 'The flag cannot turn an unrelated trade into an authorized driver');
});
test('can refueling physically approaches, fills, carries and pours with conserved fuel across reload', () => {
  let s = parked(), e = s.shunters![0], w = s.workers[0];
  const before = totalFuel(s), start = { x: w.x, z: w.z };
  assert.equal(beginShunterRefueling(s, e.id), undefined);
  assert.deepEqual({ x: w.x, z: w.z }, start, 'An on-foot driver must walk to the engine instead of teleporting');
  assert.equal(e.refueling!.phase, 'approach-engine');
  tickUntil(s, () => (e.refueling?.carried || 0) > 0, 300, () => assert.ok(Math.abs(totalFuel(s) - before) < 1e-7));
  assert.ok((renderState(s).actors.find(a => a.id === w.id) as any)?.fuelCan);
  const carried = e.refueling!.carried;
  s = S.load(S.save(s)); e = s.shunters![0]; w = s.workers[0];
  assert.equal(e.refueling!.carried, carried);
  let previous = e.fuel;
  tickUntil(s, () => !e.refueling, 300, () => {
    assert.ok(Math.abs(totalFuel(s) - before) < 1e-7);
    assert.ok(e.fuel - previous <= 0.150001, 'Pouring happens gradually, not at a distance');
    previous = e.fuel;
  });
  assert.ok(Math.abs(e.fuel - e.tank) < 1e-7);
  assert.ok(Math.abs(s.stacks[0].liters! - 25) < 1e-7);
  assert.equal(w.railAssignment, undefined);
  assert.equal(s.movements.filter(m => m.to === e.id).length, 2, 'One poured-fuel ledger line per can, not one per frame');
  assert.doesNotThrow(() => S.load(S.save(s)));
});
test('an aboard driver visibly alights before walking to a barrel', () => {
  const s = parked(), e = s.shunters![0], w = s.workers[0];
  Object.assign(w, { vehicle: e.id, x: e.x, z: e.z, y: 1.65 });
  assert.equal(beginShunterRefueling(s, e.id), undefined);
  assert.equal(e.refueling!.phase, 'alighting');
  assert.equal(w.y, 1.65); assert.equal(w.vehicle, undefined);
  for (let n = 0; n < 10; n++) S.tick(s, 0.1);
  assert.ok(w.y! > 0 && w.y! < 1.65); assert.equal(e.refueling!.carried, 0);
  assert.doesNotThrow(() => S.load(S.save(s)));
});
test('blocked filling approaches warn and retain carried diesel until the walking route is cleared', () => {
  const s = parked(), e = s.shunters![0];
  assert.equal(beginShunterRefueling(s, e.id), undefined);
  tickUntil(s, () => (e.refueling?.carried || 0) > 0);
  const total = totalFuel(s);
  s.buildings.push({ id: S.id(s, 'BLD'), kind: 'office', x: 110.8, z: 6, w: 2, d: 2, rotation: 0, connected: false, name: 'temporary blocked approach' });
  for (let n = 0; n < 250; n++) S.tick(s, 0.1);
  assert.ok(s.notices.some(n => n.title === 'Shunter refueling blocked'));
  assert.equal(e.refueling!.carried, 20);
  assert.ok(Math.abs(totalFuel(s) - total) < 1e-7);
  assert.doesNotThrow(() => S.load(S.save(s)));
  s.buildings = [];
  tickUntil(s, () => !e.refueling, 300);
  assert.ok(Math.abs(totalFuel(s) - total) < 1e-7);
});
test('unavailable, unqualified, moving and unreachable fuel requests are rejected without reservation or mutation', () => {
  const s = parked(), e = s.shunters![0], w = s.workers[0];
  w.shiftPhase = 'home';
  assert.match(beginShunterRefueling(s, e.id)!, /on duty/); assert.equal(e.refueling, undefined);
  w.shiftPhase = 'working'; w.railQualified = false;
  assert.match(beginShunterRefueling(s, e.id)!, /qualified/);
  w.railQualified = true; e.phase = 'parking';
  assert.match(beginShunterRefueling(s, e.id)!, /Stop/);
  e.phase = 'parked'; s.stacks[0].x = 200;
  assert.match(beginShunterRefueling(s, e.id)!, /8 m/);
  assert.equal(e.refueling, undefined); assert.equal(w.railAssignment, undefined);
});
test('refueling imports reject missing sources, wrong crew, movement conflicts, impossible can amounts and qualification flags', () => {
  const s = parked(), e = s.shunters![0];
  assert.equal(beginShunterRefueling(s, e.id), undefined);
  const saved = S.save(s);
  for (const change of [
    (q: State) => q.shunters![0].refueling!.barrelId = 'STK-missing',
    (q: State) => q.shunters![0].refueling!.workerId = 'WRK-missing',
    (q: State) => q.shunters![0].refueling!.carried = 21,
    (q: State) => q.shunters![0].refueling!.delivered = -1,
    (q: State) => q.shunters![0].refueling!.phase = 'teleport' as any,
    (q: State) => q.shunters![0].phase = 'parking',
    (q: State) => q.workers[0].railQualified = 'yes' as any,
    (q: State) => q.shunters![0].manualControl = 'yes' as any,
  ]) {
    const q = JSON.parse(saved); change(q); assert.throws(() => S.load(JSON.stringify(q)), /Invalid save/);
  }
});

test('fuel work pauses for traffic yielding and displacement instead of filling or pouring remotely', () => {
  const s = parked(), e = s.shunters![0], w = s.workers[0];
  assert.equal(beginShunterRefueling(s, e.id), undefined);
  tickUntil(s, () => e.refueling?.phase === 'fill-can' && e.refueling.clock >= 1);
  const barrelBefore = s.stacks[0].liters;
  w.path = [{ x: w.x, z: w.z + 3 }];
  S.tick(s, 0.1);
  assert.equal(s.stacks[0].liters, barrelBefore);
  assert.equal(e.refueling!.clock, 0);
  assert.ok(w.path.length > 0, 'Ground work honors a traffic escape rather than canceling it');
  tickUntil(s, () => e.refueling?.phase === 'pour');
  const engineBefore = e.fuel, carriedBefore = e.refueling!.carried;
  w.path = [{ x: w.x, z: w.z + 3 }];
  S.tick(s, 0.1);
  assert.equal(e.fuel, engineBefore); assert.equal(e.refueling!.carried, carriedBefore);
  assert.ok(w.path.length > 0);
  // A real displacement also requires walking back to the filler first.
  w.path = []; w.z += 3;
  S.tick(s, 0.1);
  assert.equal(e.fuel, engineBefore); assert.ok(w.path.length > 0);
  assert.doesNotThrow(() => S.load(S.save(s)));
  tickUntil(s, () => !e.refueling, 300);
  assert.ok(Math.abs(e.fuel - e.tank) < 1e-7);
});

test('a prolonged rail blocker cannot consume the shunter trip reserve and make recovery impossible', async () => {
  const { driveShunter } = await import('../src/rail-operations');
  const s = parked(), e = s.shunters![0], w = s.workers[0];
  e.fuel = 3;
  const blocker = { ...w, id: S.id(s, 'WRK'), name: 'Worker #2', role: 'builder' as const, duty: 'rest' as const,
    railQualified: false, x: 105, z: 5, y: 0, path: [], railAssignment: undefined, vehicle: undefined };
  s.workers.push(blocker);
  assert.equal(driveShunter(s, e.id, -10), undefined);
  tickUntil(s, () => e.movement?.blockedBy === blocker.id);
  for (let n = 0; n < 20; n++) S.tick(s, 0.1);
  assert.equal(e.movement!.blockedBy, blocker.id);
  const fuel = e.fuel;
  // Use the same bounded physics steps as the real native runtime.
  for (let n = 0; n < 36000; n++) S.tick(s, 0.1);
  assert.equal(e.fuel, fuel);
  assert.ok(e.fuel > 0);
  blocker.z = 20;
  tickUntil(s, () => e.phase === 'parked');
  assert.ok(Math.abs(e.x - 100) < 0.01);
  assert.ok(e.fuel > 0);
  assert.doesNotThrow(() => S.load(S.save(s)));
});
