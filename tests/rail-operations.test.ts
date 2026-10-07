import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import {
  detachRailFreight,
  orderShunter,
  shuntRailCars,
  requestEmptyReturn,
  parkShunter,
  mainlineExitReady,
} from '../src/rail-operations';
import { railFreightCarPose, requestRailUnloading } from '../src/rail-freight';
import { railRoute } from '../src/rail-routing';
import { saveRailLocation } from '../src/rail-locations';
import { seedHandlingResources, tickUntil } from './support/yard';
const tick = (s: import('../src/types').State, p: () => boolean, seconds = 1200) =>
  tickUntil(s, p, seconds);
function received() {
  const s = S.createState();
  s.creative = true;
  assert.equal(S.addZone(s, { x: 200, z: 100, w: 3, d: 3 }), '');
  assert.equal(S.planMainlineExit(s).error, '');
  assert.equal(mainlineExitReady(s), true);
  S.purchaseBatch(s, [{ item: 'slab', qty: 8 }], 'rail');
  tick(s, () => s.orders[0].status === 'unloading');
  return s;
}
test('supplier engine leaves through the exit while real cars stay fixed and survive reload', () => {
  let s = received(),
    o = s.orders[0];
  const before = railFreightCarPose(o, 0),
    carId = o.railFreight!.cars[0].id;
  assert.equal(detachRailFreight(s, o.id), undefined);
  for (let n = 0; n < 80; n++) {
    S.tick(s, 0.1);
    assert.deepEqual(railFreightCarPose(o, 0), before);
  }
  s = S.load(S.save(s));
  o = s.orders[0];
  assert.equal(o.railFreight!.cars[0].id, carId);
  tick(s, () => o.railFreight!.locomotivePhase === 'gone');
  assert.deepEqual(railFreightCarPose(o, 0), before);
  assert.equal(o.status, 'unloading');
  assert.equal(o.arrived, 0);
});
test('owned shunter is delivered by continuous rail movement, billed once and awaits an operator', () => {
  const s = received(),
    o = s.orders[0];
  assert.equal(detachRailFreight(s, o.id), undefined);
  tick(s, () => o.railFreight!.locomotivePhase === 'gone');
  const result = orderShunter(s);
  assert.equal(result.error, undefined);
  const e = s.shunters![0];
  assert.equal(e.phase, 'ordered');
  assert.equal(s.costs.filter((c) => c.entity === e.id).length, 0);
  let last: { x: number; z: number } | undefined;
  tick(s, () => e.phase === 'parked', 1200);
  assert.ok(Math.abs(e.x - 115) < 0.01);
  assert.equal(e.driverId, undefined);
  assert.equal(e.fuel, 360);
  assert.equal(s.costs.filter((c) => c.entity === e.id).length, 1);
  const loaded = S.load(S.save(s));
  assert.deepEqual(loaded.shunters, JSON.parse(JSON.stringify(s.shunters)));
});
test('empty collection is refused for loaded cars and the second physical exit is mandatory', () => {
  const s = received(),
    o = s.orders[0];
  assert.match(requestEmptyReturn(s, { orderIds: [o.id] }).error!, /released/);
  assert.equal(detachRailFreight(s, o.id), undefined);
  tick(s, () => o.railFreight!.locomotivePhase === 'gone');
  assert.match(requestEmptyReturn(s, { orderIds: [o.id] }).error!, /Unload/);
  const noExit = S.createState();
  S.purchaseBatch(noExit, [{ item: 'slab', qty: 1 }], 'rail');
  tick(noExit, () => noExit.orders[0].status === 'unloading');
  assert.match(detachRailFreight(noExit, noExit.orders[0].id)!, /second mainline connection/);
});
test('detached empty cars stay until mainline pickup, move continuously and return exactly once', () => {
  let s = received(),
    o = s.orders[0];
  seedHandlingResources(s, 'forklift');
  S.addZone(s, { x: 24, z: 26, w: 12, d: 12 });
  // Keep ordinary unloading in its intended nearby yard; the remote stop bay is finite salvage storage.
  s.zones.unshift(s.zones.pop()!);
  assert.equal(detachRailFreight(s, o.id), undefined);
  tick(s, () => o.railFreight!.locomotivePhase === 'gone');
  assert.equal(requestRailUnloading(s, o.id), undefined);
  tick(s, () => o.arrived === o.qty && !o.unload, 1600);
  assert.equal(o.status, 'unloading');
  assert.equal(o.carrierDeparted, undefined);
  const result = requestEmptyReturn(s, { orderIds: [o.id] });
  assert.equal(result.error, undefined);
  let r = s.railReturns![0];
  let previous = { ...railFreightCarPose(o, 0) };
  for (let n = 0; n < 200; n++) {
    S.tick(s, 0.1);
    const p = railFreightCarPose(o, 0);
    assert.ok(Math.hypot(p.x - previous.x, p.z - previous.z) < 0.45);
    previous = { ...p };
  }
  s = S.load(S.save(s));
  o = s.orders[0];
  r = s.railReturns![0];
  tick(s, () => r.phase === 'done', 1200);
  assert.equal(o.status, 'done');
  assert.equal(o.arrived, 8);
  assert.equal(S.totals(s, 'slab').stored, 8);
  assert.equal(o.railFreight!.cars[0].returned, true);
  assert.match(requestEmptyReturn(s, { orderIds: [o.id] }).error!, /released/);
});

test('a driver boards and a shunter pulls selected loaded cars to a named point without jumps', () => {
  const s = received(),
    o = s.orders[0];
  seedHandlingResources(s, 'forklift');
  assert.equal(detachRailFreight(s, o.id), undefined);
  tick(s, () => o.railFreight!.locomotivePhase === 'gone');
  assert.equal(
    saveRailLocation(s, {
      name: 'Test dock',
      kind: 'unloading',
      trackId: 'BOOTSTRAP-SIDING',
      route: 'straight',
      offset: 45,
      length: 40,
    }),
    undefined,
  );
  const target = s.railLocations!.at(-1)!;
  assert.equal(orderShunter(s, { driverId: s.workers[0].id }).error, undefined);
  const e = s.shunters![0];
  tick(s, () => e.phase === 'parked');
  const driver = s.workers[0];
  driver.shiftPhase = 'home';
  assert.match(
    shuntRailCars(s, {
      orderId: o.id,
      carIds: o.railFreight!.cars.map((c) => c.id),
      shunterId: e.id,
      railLocationId: target.id,
    })!,
    /on site and on duty/,
  );
  assert.equal(e.phase, 'parked');
  assert.equal(e.movement, undefined);
  assert.equal(
    driver.railAssignment,
    undefined,
    'Off-site driver must remain available for the workforce to bring back',
  );
  driver.shiftPhase = 'working';
  assert.equal(
    shuntRailCars(s, {
      orderId: o.id,
      carIds: o.railFreight!.cars.map((c) => c.id),
      shunterId: e.id,
      railLocationId: target.id,
    }),
    undefined,
  );
  S.tick(s, 0.1);
  assert.equal(driver.railAssignment, e.id);
  driver.schedule = { start: 18, end: 20 }; // Shift ends after this movement has been accepted.
  let prev = { ...railFreightCarPose(o, 0) };
  tickUntil(
    s,
    () => e.phase === 'parked',
    1200,
    () => {
      const p = railFreightCarPose(o, 0);
      assert.ok(
        Math.hypot(p.x - prev.x, p.z - prev.z) < 0.6,
        'Cargo stays with its car throughout coupling and hauling',
      );
      prev = { ...p };
    },
  );
  assert.ok(Math.abs(railFreightCarPose(o, 0).x - 70) < 0.01);
  assert.equal(o.arrived, 0);
  assert.equal(o.railFreight!.cars[0].locationId, target.id);
  assert.equal(s.workers[0].vehicle, e.id);
  assert.ok(e.used > 0);
  S.tick(s, 0.1);
  assert.equal(
    driver.vehicle,
    undefined,
    'Driver disembarks when completed movement ends outside their shift',
  );
  assert.equal(driver.railAssignment, undefined);
  S.load(S.save(s));
});

test('complete factory workflow pulls loaded cars onto a branch, unloads, pushes empties back and collects them', () => {
  const s = S.createState();
  s.creative = true;
  assert.equal(S.addZone(s, { x: 200, z: 100, w: 3, d: 3 }), '');
  assert.equal(S.planSidingAccess(s).error, '');
  assert.equal(S.planMainlineExit(s).error, '');
  for (let x = 100; x < 185; x += 5)
    assert.equal(S.planRailLayout(s, 'straight', { x, z: 10 }).error, '');
  const dockRail = s.rails.find((r) => r.track?.layout === 'straight' && r.track.origin.x === 150)!;
  assert.equal(
    saveRailLocation(s, {
      name: 'Factory dock',
      kind: 'unloading',
      trackId: dockRail.id,
      route: 'straight',
      offset: 0,
      length: 50,
    }),
    undefined,
  );
  const dock = s.railLocations!.at(-1)!;
  assert.equal(
    saveRailLocation(s, {
      name: 'Empty return',
      kind: 'transfer',
      trackId: 'BOOTSTRAP-SIDING',
      route: 'straight',
      offset: 25,
      length: 44,
    }),
    undefined,
  );
  const reception = s.railLocations!.at(-1)!;
  seedHandlingResources(s, 'forklift');
  S.addZone(s, { x: 145, z: 24, w: 12, d: 12 });
  // Keep ordinary unloading in its intended nearby yard; the remote stop bay is finite salvage storage.
  s.zones.unshift(s.zones.pop()!);
  S.purchaseBatch(s, [{ item: 'slab', qty: 4 }], 'rail');
  const o = s.orders[0];
  tick(s, () => o.status === 'unloading');
  assert.equal(detachRailFreight(s, o.id), undefined);
  tick(s, () => o.railFreight!.locomotivePhase === 'gone');
  assert.equal(orderShunter(s, { driverId: s.workers[0].id }).error, undefined);
  const e = s.shunters![0];
  tick(s, () => e.phase === 'parked');
  const move = (target: string) =>
    shuntRailCars(s, {
      orderId: o.id,
      carIds: o.railFreight!.cars.map((c) => c.id),
      shunterId: e.id,
      railLocationId: target,
    });
  assert.equal(move(dock.id), undefined);
  tick(s, () => e.phase === 'parked', 1800);
  assert.ok(Math.abs(railFreightCarPose(o, 0).x - 150) < 0.01);
  assert.ok(Math.abs(railFreightCarPose(o, 0).z - 10) < 0.01);
  // Release the driver and hire a different physical forklift operator for handling.
  const driver = s.workers[0];
  seedHandlingResources(s, 'forklift');
  const handling = s.workers[1];
  handling.x = 140;
  handling.z = 22;
  s.equipment[1].x = 140;
  s.equipment[1].z = 26;
  assert.equal(requestRailUnloading(s, o.id), undefined);
  tick(s, () => o.arrived === o.qty && !o.unload, 1800);
  assert.equal(move(reception.id), undefined);
  assert.ok(
    e.haul && e.movement,
    'A safe coupling and hauling plan remains available for the return',
  );
  tick(s, () => e.phase === 'parked', 1800);
  assert.ok(Math.abs(railFreightCarPose(o, 0).z - 5) < 0.01);
  assert.equal(parkShunter(s, e.id, dock.id), undefined);
  tick(s, () => e.phase === 'parked', 1800);
  const pickup = requestEmptyReturn(s, { orderIds: [o.id], railLocationId: reception.id });
  assert.equal(pickup.error, undefined);
  tick(s, () => o.status === 'done', 1800);
  assert.equal(S.totals(s, 'slab').stored, 4);
  assert.equal(s.railReturns![0].phase, 'done');
  S.load(S.save(s));
});

test('split car selections keep stock ledgers independent and empty batches couple into one return train', () => {
  const s = received(),
    first = s.orders[0];
  assert.equal(detachRailFreight(s, first.id), undefined);
  tick(s, () => first.railFreight!.locomotivePhase === 'gone');
  // Focused fixture represents two independently received orders already shunted back into a coupled empty consist.
  S.purchaseBatch(s, [{ item: 'diesel', qty: 1 }], 'rail');
  const second = s.orders[1];
  second.status = 'unloading';
  second.invoiced = true;
  second.railFreight!.detached = true;
  second.railFreight!.locomotivePhase = 'gone';
  const cars = [first.railFreight!.cars[0], second.railFreight!.cars[0]];
  for (const [i, car] of cars.entries()) {
    const x = 65 - i * 17.6;
    car.pose = { x, z: 5, yaw: 0 };
    car.bogies = [
      { x: x - 5.5, z: 5, yaw: 0 },
      { x: x + 5.5, z: 5, yaw: 0 },
    ];
    car.anchor = { trackId: 'BOOTSTRAP-SIDING', route: 'straight', offset: x - 25 };
    car.manifest.forEach((l) => (l.arrived = l.qty));
  }
  for (const o of [first, second]) {
    o.arrived = o.qty;
    o.manifest!.forEach((l) => (l.arrived = l.qty));
  }
  const pickup = requestEmptyReturn(s, { orderIds: [first.id, second.id] });
  assert.equal(pickup.error, undefined);
  const r = s.railReturns![0];
  assert.equal(r.carIds.length, 2);
  assert.equal(r.orderIds.length, 2);
  let prev = { ...cars[0].pose! };
  tickUntil(
    s,
    () => r.phase === 'done',
    1200,
    () => {
      const p = railFreightCarPose(first, 0);
      assert.ok(Math.hypot(p.x - prev.x, p.z - prev.z) < 0.6);
      prev = { ...p };
    },
  );
  assert.ok([first, second].every((o) => o.status === 'done'));
  assert.ok(cars.every((c) => c.returned));
  S.load(S.save(s));
});

test('multi-car selected unloading can finish later cargo before earlier cargo and reload safely', () => {
  const s = S.createState();
  s.creative = true;
  assert.equal(S.addZone(s, { x: 200, z: 100, w: 3, d: 3 }), '');
  assert.equal(S.planMainlineExit(s).error, '');
  seedHandlingResources(s, 'forklift');
  S.addZone(s, { x: 24, z: 26, w: 18, d: 18 });
  // Keep ordinary unloading in its intended nearby yard; the remote stop bay is finite salvage storage.
  s.zones.unshift(s.zones.pop()!);
  S.purchaseBatch(
    s,
    [
      { item: 'slab', qty: 192 },
      { item: 'diesel', qty: 1 },
    ],
    'rail',
  );
  const o = s.orders[0];
  assert.ok(o.railFreight!.cars.length > 1);
  tick(s, () => o.status === 'unloading');
  assert.equal(detachRailFreight(s, o.id), undefined);
  tick(s, () => o.railFreight!.locomotivePhase === 'gone');
  const last = o.railFreight!.cars.at(-1)!;
  assert.equal(requestRailUnloading(s, o.id, [last.id]), undefined);
  tick(s, () => last.manifest.every((l) => l.arrived === l.qty) && !o.unload, 1800);
  assert.equal(o.railFreight!.cars[0].manifest[0].arrived, 0);
  assert.ok(o.arrived > 0);
  assert.equal(o.railFreight!.unloadRequested, false);
  S.load(S.save(s));
});
