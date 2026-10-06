import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { ROAD_ROUTE_VERSION, roadLength, sampleRoad } from '../src/motion';
import { dist } from '../src/path';
import { carrierBoxes, personTouchesBox, workerMoveBlocked } from '../src/traffic';
import { seedHandlingResources } from './support/yard';
import type { State, Worker } from '../src/types';

function encounter(handling = false) {
  const s = S.createState();
  let worker: Worker;
  if (handling) {
    const e = seedHandlingResources(s, 'excavator');
    Object.assign(e, { x: 5.5, z: 31.5 });
    Object.assign(
      s.workers.find((w) => w.role === 'operator')!,
      { x: 3.5, z: 32.5 },
    );
    worker = s.workers.find((w) => w.role === 'builder')!;
    assert.equal(S.addZone(s, { x: 24, z: 35, w: 9, d: 8 }), '');
  } else {
    worker = {
      id: S.id(s, 'worker'),
      name: 'Worker #1',
      role: 'builder',
      duty: 'auto',
      x: 12,
      z: 18,
      path: [],
      status: 'Available',
      wage: 28,
      hours: 0,
      heading: 0,
    };
    s.workers.push(worker);
  }
  Object.assign(worker, { x: 12, z: 18 });
  const [orderId] = S.purchase(s, 'slab', 1);
  const order = s.orders.find((o) => o.id === orderId)!;
  order.eta = s.time;
  S.tick(s, 0.1);
  assert.equal(order.status, 'approaching');
  // Opening transport pose on the real final road segment, after invoicing.
  const distance = roadLength(order) - 14,
    pose = sampleRoad(order, distance);
  Object.assign(order.drive!, {
    distance,
    velocity: 0,
    yaw: pose.yaw,
    roadVersion: ROAD_ROUTE_VERSION,
  });
  order.vehicle = { x: pose.x, z: pose.z };
  // The truck fits this 3.6 m lane. Every 3–8 m perpendicular refuge is
  // obstructed, but a worker can walk around the short rows' eastern ends.
  for (const [i, r] of [
    { x: 10.5, z: 19.8, w: 3, d: 8.2 },
    { x: 10.5, z: 8, w: 3, d: 8.2 },
  ].entries())
    s.buildings.push({
      ...r,
      id: `OPENING-FENCE-${i}`,
      kind: 'fence',
      rotation: 0,
      connected: false,
      name: 'Opening refuge obstruction',
      source: 'opening',
    });
  return { s, workerId: worker.id, orderId };
}

function safeTick(s: State, workerId: string, orderId: string) {
  const w = s.workers.find((w) => w.id === workerId)!;
  const o = s.orders.find((o) => o.id === orderId)!;
  const oldWorker = { ...w },
    oldVehicle = { ...o.vehicle };
  S.tick(s, 0.1);
  assert.ok(dist(oldWorker, w) <= 0.17 + 1e-6, 'Clearance requires actual normal-speed walking');
  assert.ok(
    dist(oldVehicle, o.vehicle) <= 0.45 + 1e-6,
    'The carrier cannot jump past its pedestrian',
  );
  assert.equal(
    workerMoveBlocked(s, oldWorker, w),
    '',
    'The worker never walks through truck or stock',
  );
  if (!o.carrierDeparted && o.status !== 'done')
    assert.ok(
      !carrierBoxes(o).some((b) => personTouchesBox(w, b, 0.31)),
      `Carrier intersects its pedestrian: ${JSON.stringify({ vehicle: o.vehicle, worker: w })}`,
    );
  const totals = S.totals(s, 'slab');
  assert.equal(totals.delivered, totals.stored + totals.cargo + totals.installed);
  return { w, o };
}

const requests = (s: State, orderId: string, workerId: string) =>
  s.events.filter(
    (event) =>
      event.entity === orderId &&
      event.text === `${orderId} requests ${workerId} to clear its driving corridor.`,
  );

for (const mode of ['idle', 'returning', 'equipment-yield'] as const)
  test(`a truck requests its ${mode} pedestrian to walk around obstructed side refuges`, () => {
    const { s, workerId, orderId } = encounter();
    const w = s.workers.find((w) => w.id === workerId)!;
    if (mode !== 'idle') {
      w.path = [{ x: 0, z: 18 }];
      w.status = 'Returning to task';
      w.trafficRetry = s.elapsed + 3;
      if (mode === 'equipment-yield') {
        const e = seedHandlingResources(s);
        Object.assign(e, { x: 30, z: 38 });
        w.yieldingTo = e.id;
        w.yieldTarget = { x: 0, z: 18 };
      }
    }
    let sawClearance = false;
    for (let t = 0; t < 60; t += 0.1) {
      const { w, o } = safeTick(s, workerId, orderId);
      if (w.yieldingTo === orderId) {
        sawClearance = true;
        if (mode !== 'idle')
          assert.deepEqual(
            w.yieldTarget,
            { x: 0, z: 18 },
            'The clearance interruption retains the original return destination',
          );
      }
      if (o.status === 'unloading') break;
    }
    assert.ok(sawClearance, 'The specifically addressed worker accepts a real walking detour');
    assert.equal(
      s.orders.find((o) => o.id === orderId)!.status,
      'unloading',
      JSON.stringify({
        order: s.orders.find((o) => o.id === orderId),
        worker: s.workers.find((w) => w.id === workerId),
        events: s.events.slice(-8),
      }),
    );
    assert.equal(
      requests(s, orderId, workerId).length,
      1,
      'A continuing blockage produces one request',
    );
  });

test('the only builder becomes available to unload after clearing the approaching truck', () => {
  const { s, workerId, orderId } = encounter(true);
  let usedBuilder = false;
  for (let t = 0; t < 240; t += 0.1) {
    const { o } = safeTick(s, workerId, orderId);
    usedBuilder ||= o.unload?.riggerId === workerId;
    if (o.status === 'departing' && !o.unload && S.totals(s, 'slab').stored === 1) break;
  }
  const o = s.orders.find((o) => o.id === orderId)!;
  assert.ok(
    usedBuilder,
    'The worker must not remain unavailable until their own unloading order finishes',
  );
  assert.equal(
    o.status,
    'departing',
    `Unloading is still waiting: ${JSON.stringify({ note: o.note, unload: o.unload })}`,
  );
  assert.equal(o.arrived, 1);
  assert.equal(o.unload, undefined);
  assert.equal(S.totals(s, 'slab').stored, 1);
});

for (const duty of ['manual', 'rest'] as const)
  test(`a ${duty} pedestrian keeps control, gets one saved warning, then clears after automatic duty resumes`, () => {
    let { s, workerId, orderId } = encounter();
    let w = s.workers.find((w) => w.id === workerId)!;
    w.duty = duty;
    for (let t = 0; t < 30; t += 0.1) safeTick(s, workerId, orderId);
    assert.deepEqual({ x: w.x, z: w.z }, { x: 12, z: 18 });
    assert.equal(w.duty, duty);
    assert.equal(requests(s, orderId, workerId).length, 1);
    const warnings = s.notices.filter(
      (n) => n.entity === orderId && n.title === 'Delivery vehicle blocked',
    );
    assert.equal(warnings.length, 1);
    assert.notEqual(warnings[0].state, 'done');
    const before = s.orders.find((o) => o.id === orderId)!.drive!;
    s = S.load(S.save(s));
    assert.equal(
      s.orders.find((o) => o.id === orderId)!.drive!.clearanceRequestedFor,
      before.clearanceRequestedFor,
    );
    assert.equal(s.orders.find((o) => o.id === orderId)!.drive!.trafficBlockedNotice, true);
    w = s.workers.find((w) => w.id === workerId)!;
    assert.equal(w.duty, duty);
    S.releaseWorker(s, workerId);
    for (let t = 0; t < 60; t += 0.1) {
      const { o } = safeTick(s, workerId, orderId);
      if (o.status === 'unloading') break;
    }
    assert.equal(
      s.orders.find((o) => o.id === orderId)!.status,
      'unloading',
      JSON.stringify({
        order: s.orders.find((o) => o.id === orderId),
        worker: s.workers.find((w) => w.id === workerId),
        events: s.events.slice(-8),
      }),
    );
    assert.equal(s.notices.find((n) => n.id === warnings[0].id)!.state, 'done');
    assert.equal(
      requests(s, orderId, workerId).length,
      1,
      'Save/reload cannot duplicate the same clearance request',
    );
  });
