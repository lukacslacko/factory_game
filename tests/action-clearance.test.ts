import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources } from './support/yard';
import {
  requestActionClearance,
  clearActionClearance,
  tickActionClearances,
  actionEnvelopeBlockers,
  actionClearanceHoldsEquipment,
  releaseActionYield,
} from '../src/action-clearance';
import { equipmentBoxes, equipmentSweepBlocked, workerMoveBlocked } from '../src/traffic';
import { move } from '../src/motion';
import { dist } from '../src/path';
import type { State } from '../src/types';
function fixture() {
  const s = S.createState(),
    requester = seedHandlingResources(s, 'excavator'),
    blocker = seedHandlingResources(s);
  Object.assign(requester, {
    x: 34,
    z: 40,
    yaw: 0,
    reach: 2.1,
    parking: { x: 50, z: 40, rotation: 0 },
    parkingState: 'driving',
  });
  Object.assign(blocker, { x: 42, z: 40, yaw: 0, reach: 2.1 });
  const operator = s.workers.find((w) => w.role === 'operator' && w.id !== s.workers[0].id)!;
  blocker.operator = operator.id;
  operator.vehicle = blocker.id;
  operator.x = blocker.x;
  operator.z = blocker.z;
  const envelope = { x: 42, z: 40, yaw: 0, length: 6, width: 5 };
  const request = {
    ownerId: requester.id,
    requesterEquipmentId: requester.id,
    blockerId: blocker.id,
    action: 'Lower a roof panel',
    envelopes: [envelope],
  };
  return { s, requester, blocker, operator, envelope, request };
}
function clock(s: State, dt: number) {
  s.elapsed += dt;
  s.time += dt;
}
test('idle equipment yields through checked physical movement with its own operator and a saved refuge lease', () => {
  const f = fixture(),
    before = { x: f.blocker.x, z: f.blocker.z };
  assert.equal(requestActionClearance(f.s, f.request).requested, true);
  assert.deepEqual({ x: f.blocker.x, z: f.blocker.z }, before, 'request never teleports');
  assert.equal(actionClearanceHoldsEquipment(f.s, f.blocker.id), true);
  let s = S.load(S.save(f.s)),
    e = s.equipment.find((e) => e.id === f.blocker.id)!;
  for (let i = 0; i < 500 && e.path.length; i++) {
    const old = { ...e, path: e.path.slice() },
      probe = { ...e, path: e.path.slice() };
    move(probe, 0.1, 1.5, true);
    assert.equal(equipmentSweepBlocked(s, e, probe), '');
    Object.assign(e, probe);
    clock(s, 0.1);
    assert.ok(dist(old, e) <= 0.150001);
  }
  assert.equal(e.path.length, 0);
  assert.ok(!actionEnvelopeBlockers(s, s.equipment[0], [f.envelope]).includes(e.id));
  assert.equal(e.operator, f.operator.id);
  assert.equal(s.workers.find((w) => w.id === e.operator)!.vehicle, e.id);
});
test('manual, unattended, unfueled and loaded equipment is never forcibly moved', () => {
  for (const condition of ['manual', 'unattended', 'fuel', 'cargo'] as const) {
    const f = fixture();
    if (condition === 'manual') f.operator.duty = 'manual';
    if (condition === 'unattended') {
      f.operator.vehicle = undefined;
      f.blocker.operator = undefined;
      for (const worker of f.s.workers) if (worker.role === 'operator') worker.duty = 'rest';
    }
    if (condition === 'fuel') f.blocker.fuel = 0;
    if (condition === 'cargo') f.blocker.cargo = { item: 'slab', qty: 1 };
    const before = JSON.stringify(f.blocker),
      result = requestActionClearance(f.s, f.request);
    assert.equal(result.requested, false, condition);
    assert.equal(JSON.stringify(f.blocker), before);
    assert.match(
      result.reason,
      condition === 'manual'
        ? /manual control/
        : condition === 'fuel'
          ? /fuel/
          : condition === 'cargo'
            ? /load/
            : /operator/,
    );
  }
});
test('an idle worker gets an actual safe walking route; a worker doing physical work is respected', () => {
  const f = fixture(),
    w = f.s.workers.find((w) => w.role === 'builder')!;
  Object.assign(w, { x: 42, z: 40 });
  // Move the forklift away so the worker starts on clear ground.
  f.blocker.x = 60;
  f.operator.x = 60;
  const request = { ...f.request, blockerId: w.id };
  const old = { x: w.x, z: w.z };
  assert.equal(requestActionClearance(f.s, request).requested, true);
  assert.deepEqual({ x: w.x, z: w.z }, old);
  assert.ok(w.path.length);
  const last = w.path.at(-1)!;
  assert.equal(workerMoveBlocked(f.s, w, last), '');
  clearActionClearance(f.s, f.request.ownerId);
  w.path = [];
  w.yieldingTo = undefined;
  w.job = 'JOB-active';
  const before = JSON.stringify(w);
  assert.equal(requestActionClearance(f.s, request).requested, false);
  assert.equal(JSON.stringify(w), before);
});
test('continuous blockage deduplicates persistent linked warnings across retries, changing blockers and reload', () => {
  const f = fixture();
  f.operator.duty = 'manual';
  requestActionClearance(f.s, f.request);
  for (let i = 0; i < 50; i++) {
    clock(f.s, 0.5);
    requestActionClearance(f.s, f.request);
  }
  assert.equal(f.s.notices.filter((n) => n.title === 'Action blocked').length, 1);
  let s = S.load(S.save(f.s));
  const n = s.notices.find((n) => n.title === 'Action blocked')!;
  assert.equal(n.severity, 'warning');
  assert.match(n.detail, new RegExp(f.blocker.id));
  assert.match(n.detail, /manual control/);
  for (let i = 0; i < 50; i++) {
    clock(s, 0.5);
    requestActionClearance(s, f.request);
  }
  assert.equal(s.notices.filter((n) => n.title === 'Action blocked').length, 1);
  assert.equal(s.events.filter((e) => e.severity === 'warning').length, 1);
  clock(s, 2);
  requestActionClearance(s, { ...f.request, blockerId: 'STK-0999' });
  assert.match(n.detail, /STK-0999/);
  assert.match(n.detail, /fixed infrastructure/);
  clearActionClearance(s, f.request.ownerId);
  assert.equal(n.state, 'done');
  assert.equal(s.actionClearances!.length, 0);
});
test('canceled owners and obsolete actions release warnings and machine refuge reservations', () => {
  const f = fixture();
  requestActionClearance(f.s, f.request);
  assert.equal(actionClearanceHoldsEquipment(f.s, f.blocker.id), true);
  f.requester.parkingState = 'parked';
  f.requester.path = [];
  tickActionClearances(f.s);
  assert.equal(f.blocker.actionYieldFor, undefined);
  assert.equal(f.s.actionClearances!.length, 0);
  const g = fixture();
  g.operator.duty = 'manual';
  requestActionClearance(g.s, g.request);
  clock(g.s, 21);
  requestActionClearance(g.s, g.request);
  clock(g.s, 4);
  tickActionClearances(g.s);
  assert.equal(g.s.notices.find((n) => n.title === 'Action blocked')!.state, 'done');
});
test('saved action timers, blocker records, notification severity and refuge fields are validated', () => {
  const f = fixture();
  requestActionClearance(f.s, f.request);
  for (const mutate of [
    (s: any) => (s.actionClearances[0].since = -1),
    (s: any) => (s.actionClearances[0].lastSeen = s.elapsed + 50),
    (s: any) => (s.actionClearances[0].blockerRetry = { 'EQ-1': s.elapsed + 100 }),
    (s: any) => (s.actionClearances[0].point.x = NaN),
    (s: any) => (s.actionClearances[0].blockerIds = [{}]),
    (s: any) => (s.equipment[1].actionYieldUntil = -2),
    (s: any) => s.actionClearances.push({ ...s.actionClearances[0] }),
  ]) {
    const bad = structuredClone(f.s);
    mutate(bad);
    assert.throws(() => S.load(JSON.stringify(bad)), /Invalid save/);
  }
});

test('one manual blocker cannot starve clearance requests to other automatic actors in the same action', () => {
  const f = fixture(),
    w = f.s.workers.find((w) => w.role === 'builder')!;
  Object.assign(w, { x: 41, z: 38, duty: 'manual' });
  const first = requestActionClearance(f.s, { ...f.request, blockerId: w.id });
  const second = requestActionClearance(f.s, f.request);
  assert.equal(first.requested, false);
  assert.equal(second.requested, true);
  assert.deepEqual({ x: w.x, z: w.z }, { x: 41, z: 38 });
  assert.ok(f.blocker.path.length);
  assert.deepEqual(f.s.actionClearances![0].blockerIds, [w.id, f.blocker.id]);
  const resumed = S.load(S.save(f.s));
  assert.equal(resumed.actionClearances![0].blockerRetry![f.blocker.id], 1.5);
});

test('a displaced fuel worker returns to the real drum and filler before transferring conserved diesel', async () => {
  const { tickUntil } = await import('./support/yard');
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  e.fuel = 20;
  s.stacks.push({
    id: S.id(s, 'stack'),
    item: 'diesel',
    qty: 1,
    reserved: 0,
    liters: 200,
    x: 30,
    z: 30,
    w: 1,
    d: 1,
    source: 'opening',
  });
  const drum = s.stacks[0];
  assert.equal(S.refuel(s, e.id), '');
  tickUntil(s, () => s.jobs.some((j) => j.kind === 'refuel' && j.status === 'doing'), 60);
  const j = s.jobs.find((j) => j.kind === 'refuel')!,
    w = s.workers.find((w) => w.id === j.worker)!;
  w.x = 45;
  w.z = 45;
  w.path = [];
  const originalDrum = drum.liters;
  S.tick(s, 0.1);
  assert.equal(drum.liters, originalDrum);
  assert.ok(w.path.length);
  tickUntil(s, () => (j.fuelLiters || 0) > 0, 120);
  w.x = 45;
  w.z = 45;
  w.path = [];
  const fuel = e.fuel,
    carried = j.fuelLiters;
  S.tick(s, 0.1);
  assert.equal(e.fuel, fuel);
  assert.equal(j.fuelLiters, carried);
  assert.ok(w.path.length);
  tickUntil(s, () => j.status === 'done', 600);
  assert.equal(e.fuel, e.tank);
  assert.ok(Math.abs(e.fuel + e.used + (drum.liters || 0) - 220) < 1e-7);
  S.load(S.save(s));
});

test('a late pedestrian stops delivery setdown, receives one saved warning, and can release automatic recovery', async () => {
  const { tickUntil } = await import('./support/yard');
  let s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 20, d: 20 });
  seedHandlingResources(s);
  const [oid] = S.purchase(s, 'slab', 4);
  tickUntil(s, () => s.orders.find((o) => o.id === oid)?.unload?.phase === 'lower', 600);
  const order = s.orders.find((o) => o.id === oid)!,
    t = order.unload!,
    worker = {
      ...s.workers[0],
      id: S.id(s, 'worker'),
      name: 'Worker #2',
      role: 'builder' as const,
      duty: 'manual' as const,
      vehicle: undefined,
      deliveryOrder: undefined,
      job: undefined,
      transition: undefined,
      path: [],
      x: t.destination.x + 0.5,
      z: t.destination.z + 0.5,
    };
  s.workers.push(worker);
  const carried = s.equipment.find((e) => e.id === t.equipmentId)!.cargo!.qty,
    clockBefore = t.clock;
  tickUntil(
    s,
    () =>
      s.notices.some((n) => n.title === 'Delivery handling blocked' && n.entity === t.equipmentId),
    90,
  );
  assert.equal(order.unload!.clock, clockBefore, 'lowering clock stays paused');
  assert.equal(s.equipment.find((e) => e.id === t.equipmentId)!.cargo!.qty, carried);
  assert.equal(
    s.stacks.filter((q) => q.item === 'slab').reduce((n, q) => n + q.qty, 0),
    0,
  );
  const warning = s.notices.find(
    (n) => n.title === 'Delivery handling blocked' && n.entity === t.equipmentId,
  )!;
  assert.equal(
    s.events.filter((v) => v.severity === 'warning').length,
    1,
    'The action and delivery watchdog share one warning',
  );
  assert.match(warning.detail, new RegExp(worker.id));
  s = S.load(S.save(s));
  assert.equal(S.releaseWorker(s, worker.id), '');
  tickUntil(s, () => !s.orders.find((o) => o.id === oid)!.unload, 600);
  assert.equal(S.totals(s, 'slab').stored, 4);
  assert.equal(s.notices.find((n) => n.id === warning.id)!.state, 'done');
  S.load(S.save(s));
});

test('an unattended idle blocker recruits a reachable operator, saves walking and boarding, and drives physically clear', () => {
  const f = fixture();
  f.operator.vehicle = undefined;
  f.blocker.operator = undefined;
  f.operator.x = 42;
  f.operator.z = 48;
  // The other operator belongs to the requester and cannot be borrowed.
  f.s.workers[0].job = 'PROTECTED-WORK';
  let s = f.s;
  assert.equal(requestActionClearance(s, f.request).requested, true);
  let e = s.equipment.find((e) => e.id === f.blocker.id)!,
    w = s.workers.find((w) => w.id === e.actionYieldOperator)!;
  assert.equal(w.id, f.operator.id);
  assert.ok(w.path.length);
  assert.equal(w.vehicle, undefined);
  assert.equal(e.path.length, 0);
  s.workers[0].job = undefined;
  s = S.load(S.save(s));
  let walkingSaved = true,
    boardingSaved = false,
    moved = false;
  for (let time = 0; time < 120; time += 0.1) {
    e = s.equipment.find((e) => e.id === f.blocker.id)!;
    w = s.workers.find((w) => w.id === f.operator.id)!;
    const prior = { x: e.x, z: e.z };
    requestActionClearance(s, f.request);
    if (w.transition?.kind === 'enter' && !boardingSaved) {
      s = S.load(S.save(s));
      boardingSaved = true;
    }
    S.tick(s, 0.1);
    e = s.equipment.find((e) => e.id === f.blocker.id)!;
    assert.ok(dist(prior, e) < 0.4, 'A request cannot teleport or drive without actual boarding');
    moved ||= dist(e, { x: 42, z: 40 }) > 2;
    if (moved && !e.path.length) break;
  }
  assert.ok(walkingSaved && boardingSaved);
  assert.ok(moved);
  assert.equal(e.operator, f.operator.id);
  assert.equal(s.workers.find((w) => w.id === f.operator.id)!.vehicle, e.id);
  S.load(S.save(s));
  e.parkingState = 'parked';
  e.path = [];
  e.parking = undefined;
  const owner = s.equipment.find((e) => e.id === f.request.ownerId)!;
  owner.parking = undefined;
  owner.path = [];
  tickActionClearances(s);
  assert.equal(e.actionYieldOperator, undefined);
  assert.equal(s.workers.find((w) => w.id === f.operator.id)!.actionClearanceEquipment, undefined);
});
test('canceling a clearance owner releases a walking operator reservation without boarding or teleporting', () => {
  const f = fixture();
  f.operator.vehicle = undefined;
  f.blocker.operator = undefined;
  f.operator.x = 42;
  f.operator.z = 48;
  f.s.workers[0].duty = 'rest';
  assert.equal(requestActionClearance(f.s, f.request).requested, true);
  const before = { x: f.operator.x, z: f.operator.z };
  f.requester.parking = undefined;
  f.requester.path = [];
  tickActionClearances(f.s);
  assert.equal(f.blocker.actionYieldOperator, undefined);
  assert.equal(f.operator.actionClearanceEquipment, undefined);
  assert.equal(f.operator.path.length, 0);
  assert.deepEqual({ x: f.operator.x, z: f.operator.z }, before);
  assert.equal(f.operator.vehicle, undefined);
  S.load(S.save(f.s));
});

test('validated manual movement immediately releases reciprocal walking recruitment without losing the new command', () => {
  const f = fixture();
  f.operator.vehicle = undefined;
  f.blocker.operator = undefined;
  f.operator.x = 42;
  f.operator.z = 48;
  f.s.workers[0].duty = 'rest';
  assert.equal(requestActionClearance(f.s, f.request).requested, true);
  assert.equal(S.moveWorker(f.s, f.operator.id, { x: 46, z: 49 }), '');
  assert.equal(f.operator.duty, 'manual');
  assert.ok(f.operator.path.length);
  assert.equal(f.operator.actionClearanceEquipment, undefined);
  assert.equal(f.blocker.actionYieldOperator, undefined);
  assert.equal(f.blocker.actionYieldFor, undefined);
  S.load(S.save(f.s));
});
test('explicit clearance override releases saved reservations while a physical boarding transition finishes', () => {
  const f = fixture();
  f.operator.vehicle = undefined;
  f.blocker.operator = undefined;
  f.s.workers[0].duty = 'rest';
  f.operator.x = 41.8;
  f.operator.z = 41.85;
  assert.equal(requestActionClearance(f.s, f.request).requested, true);
  for (let i = 0; i < 30 && !f.operator.transition; i++) {
    S.tick(f.s, 0.1);
    requestActionClearance(f.s, f.request);
  }
  assert.equal(f.operator.transition?.kind, 'enter');
  releaseActionYield(f.s, f.blocker.id);
  assert.equal(f.operator.actionClearanceEquipment, undefined);
  assert.equal(f.blocker.actionYieldOperator, undefined);
  assert.equal(f.operator.transition?.kind, 'enter');
  let s = S.load(S.save(f.s));
  for (let time = 0; time < 2; time += 0.1) S.tick(s, 0.1);
  assert.equal(s.workers.find((w) => w.id === f.operator.id)!.vehicle, f.blocker.id);
  S.load(S.save(s));
});
