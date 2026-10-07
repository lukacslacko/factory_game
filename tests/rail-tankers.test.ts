import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { tankerOrderPreview, orderTankers } from '../src/rail-tankers';
import { RAIL_COMMODITIES } from '../src/rail-commodities';
import { orderMass } from '../src/procurement';
import { railFreightCarPose, railFreightLength, requestRailUnloading } from '../src/rail-freight';
import {
  detachRailFreight,
  orderShunter,
  shuntRailCars,
  requestEmptyReturn,
} from '../src/rail-operations';
import { saveRailLocation, railLocationStatus } from '../src/rail-locations';
import { railAnchorPose } from '../src/rail-routing';
import { commissionExit } from './support/rail';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { State, Order } from '../src/types';
function yard() {
  const s = S.createState();
  s.creative = true;
  assert.equal(commissionExit(s).error, '');
  return s;
}
const litersInCars = (o: Order) =>
  o.railFreight!.cars.reduce((n, c) => n + (c.tank?.liters || 0), 0);
test('tanker quote reports real liters, commodity density, tare, consistent train length and costs', () => {
  for (const product of ['bulkWater', 'bulkDiesel'] as const) {
    const p = tankerOrderPreview(product, 25000, 3);
    assert.equal(p.liters, 75000);
    assert.equal(p.payloadMass, 75000 * RAIL_COMMODITIES[product].density);
    assert.equal(p.tareMass, 60000);
    assert.equal(p.totalMass, p.payloadMass + 60000);
    assert.ok(Math.abs(p.trainLength - 61.3) < 1e-8);
    assert.equal(p.price, 75000 * RAIL_COMMODITIES[product].price + 720);
    const s = yard();
    assert.equal(orderTankers(s, { product, litersPerCar: 25000, carCount: 3 }).error, undefined);
    const o = s.orders[0];
    assert.ok(Math.abs(railFreightLength(o) - p.trainLength) < 1e-8);
    assert.equal(orderMass(o), p.payloadMass);
    assert.equal(o.total, p.price);
    assert.equal(litersInCars(o), p.liters);
    assert.equal(new Set(o.railFreight!.cars.map((c) => c.id)).size, 3);
    assert.ok(
      o.railFreight!.cars.every(
        (c) => c.tareMass === 20000 && c.tank!.capacity === 30000 && c.kind === 'tanker',
      ),
    );
  }
});
test('invalid tanker inputs, unusable destinations and oversized trains leave the entire state unchanged', () => {
  const s = yard();
  for (const input of [
    { product: 'unknown', litersPerCar: 1000, carCount: 1 },
    { product: 'bulkDiesel', litersPerCar: 0, carCount: 1 },
    { product: 'bulkWater', litersPerCar: 30001, carCount: 1 },
    { product: 'bulkWater', litersPerCar: 1.5, carCount: 1 },
    { product: 'bulkWater', litersPerCar: 1000, carCount: 0 },
    { product: 'bulkWater', litersPerCar: 1000, carCount: 11 },
    { product: 'bulkWater', litersPerCar: 1000, carCount: 10 },
    { product: 'bulkWater', litersPerCar: 1000, carCount: 1, railLocationId: 'MISSING' },
  ]) {
    const before = S.save(s);
    assert.ok(orderTankers(s, input as any).error);
    assert.equal(S.save(s), before);
  }
  assert.equal(
    saveRailLocation(s, {
      name: 'Tiny dock',
      kind: 'transfer',
      trackId: 'BOOTSTRAP-SIDING',
      route: 'straight',
      offset: 35,
      length: 12,
    }),
    undefined,
  );
  const before = S.save(s);
  assert.match(
    orderTankers(s, {
      product: 'bulkDiesel',
      litersPerCar: 2000,
      carCount: 1,
      railLocationId: s.railLocations!.at(-1)!.id,
    }).error!,
    /needs/,
  );
  assert.equal(S.save(s), before);
});
test('loaded tanker train arrives continuously, invoices once and keeps all liquid contained across reload', () => {
  let s = yard();
  const r = orderTankers(s, { product: 'bulkDiesel', litersPerCar: 30000, carCount: 3 });
  assert.equal(r.error, undefined);
  let o = s.orders.find((o) => o.id === r.id)!;
  let last: ReturnType<typeof railFreightCarPose> | undefined;
  tickUntil(
    s,
    () => o.status === 'unloading',
    1200,
    () => {
      if (o.status === 'approaching') {
        const p = railFreightCarPose(o, 1);
        if (last) assert.ok(Math.hypot(p.x - last.x, p.z - last.z) < 0.65);
        last = { ...p };
      }
      assert.equal(litersInCars(o), 90000);
      assert.equal(o.arrived, 0);
      assert.equal(o.unload, undefined);
    },
  );
  assert.ok(last);
  assert.equal(o.invoiced, true);
  assert.equal(s.costs.filter((c) => c.entity === o.id).length, 1);
  assert.equal(
    s.costs.find((c) => c.entity === o.id)!.amount,
    tankerOrderPreview('bulkDiesel', 30000, 3).price,
  );
  assert.ok(o.railFreight!.cars.every((c) => c.anchor && c.pose && c.bogies?.length === 2));
  for (const c of o.railFreight!.cars) {
    const pose = railAnchorPose(s, c.anchor!)!;
    assert.ok(Math.hypot(pose.x - c.pose!.x, pose.z - c.pose!.z) < 0.01);
  }
  const before = o.railFreight!.cars.map((c) => ({
    id: c.id,
    liters: c.tank!.liters,
    anchor: c.anchor,
    pose: c.pose,
  }));
  s = S.load(S.save(s));
  o = s.orders.find((o) => o.id === r.id)!;
  assert.deepEqual(
    o.railFreight!.cars.map((c) => ({
      id: c.id,
      liters: c.tank!.liters,
      anchor: c.anchor,
      pose: c.pose,
    })),
    before,
  );
  for (let i = 0; i < 50; i++) S.tick(s, 0.1);
  assert.equal(s.costs.filter((c) => c.entity === o.id).length, 1);
  assert.equal(litersInCars(o), 90000);
  assert.equal(s.stacks.filter((t) => t.item === 'diesel').length, 0);
});
test('tanker cannot be forklift-unloaded or returned while containing fluid', () => {
  const s = yard();
  seedHandlingResources(s, 'forklift');
  const r = orderTankers(s, { product: 'bulkWater', litersPerCar: 30000, carCount: 1 });
  const o = s.orders.find((o) => o.id === r.id)!;
  tickUntil(s, () => o.status === 'unloading', 1200);
  const before = S.save(s);
  assert.match(requestRailUnloading(s, o.id)!, /transfer pump/);
  assert.equal(S.save(s), before);
  assert.equal(detachRailFreight(s, o.id), undefined);
  tickUntil(s, () => o.railFreight!.locomotivePhase === 'gone', 1200);
  const detached = S.save(s);
  assert.match(requestEmptyReturn(s, { orderIds: [o.id] }).error!, /Unload/);
  assert.equal(S.save(s), detached);
  assert.equal(litersInCars(o), 30000);
  assert.equal(o.arrived, 0);
});
test('tanker save validation rejects altered liquid, density, geometry and manifest balance', () => {
  const s = yard();
  assert.equal(
    orderTankers(s, { product: 'bulkDiesel', litersPerCar: 10000, carCount: 2 }).error,
    undefined,
  );
  const original = S.save(s);
  for (const mutate of [
    (c: any) => (c.tank.liters = 9999),
    (c: any) => (c.tank.liters = -1),
    (c: any) => (c.tank.liters = NaN),
    (c: any) => (c.tank.capacity = 40000),
    (c: any) => (c.tank.density = 1),
    (c: any) => (c.tank.product = 'bulkWater'),
    (c: any) => (c.tank = undefined),
    (c: any) => (c.mass = 1),
    (c: any) => (c.centerOffset = 14),
    (c: any) => (c.kind = 'flatcar'),
    (c: any) => c.manifest[0].qty++,
  ]) {
    const v = JSON.parse(original);
    mutate(v.orders[0].railFreight.cars[0]);
    assert.throws(() => S.load(JSON.stringify(v)), /Invalid save/);
  }
});
test('flatcar and liquid orders keep distinct physical records in one save', () => {
  const s = yard();
  S.purchaseBatch(s, [{ item: 'slab', qty: 12 }], 'rail');
  assert.equal(
    orderTankers(s, { product: 'bulkWater', litersPerCar: 10000, carCount: 2 }).error,
    undefined,
  );
  const loaded = S.load(S.save(s));
  assert.equal(loaded.orders.length, 2);
  assert.equal(loaded.orders[0].railFreight!.cars[0].kind, 'flatcar');
  assert.equal(loaded.orders[1].railFreight!.cars[0].kind, 'tanker');
  assert.equal(litersInCars(loaded.orders[1]), 20000);
});
test('queued loaded tanker train waits for clear rail while the first is detached and shunted intact', () => {
  let s = yard();
  seedHandlingResources(s, 'forklift');
  s.workers[0].railQualified = true;
  assert.equal(
    saveRailLocation(s, {
      name: 'Tank transfer',
      kind: 'transfer',
      trackId: 'BOOTSTRAP-SIDING',
      route: 'straight',
      offset: 70,
      length: 30,
    }),
    undefined,
  );
  const dock = s.railLocations!.at(-1)!;
  assert.equal(railLocationStatus(s, dock).connected, true);
  const first = orderTankers(s, { product: 'bulkDiesel', litersPerCar: 24000, carCount: 1 });
  const second = orderTankers(s, { product: 'bulkWater', litersPerCar: 17000, carCount: 1 });
  let a = s.orders.find((o) => o.id === first.id)!,
    b = s.orders.find((o) => o.id === second.id)!;
  tickUntil(s, () => a.status === 'unloading', 1200);
  assert.equal(b.status, 'ordered');
  assert.equal(b.invoiced, false);
  assert.equal(detachRailFreight(s, a.id), undefined);
  tickUntil(s, () => a.railFreight!.locomotivePhase === 'gone', 1200);
  assert.equal(orderShunter(s, { driverId: s.workers[0].id }).error, undefined);
  const e = s.shunters![0];
  tickUntil(s, () => e.phase === 'parked', 1200);
  assert.equal(
    shuntRailCars(s, {
      orderId: a.id,
      carIds: a.railFreight!.cars.map((c) => c.id),
      shunterId: e.id,
      railLocationId: dock.id,
    }),
    undefined,
  );
  let last = { ...railFreightCarPose(a, 0) };
  tickUntil(
    s,
    () => e.phase === 'parked',
    1200,
    () => {
      const p = railFreightCarPose(a, 0);
      assert.ok(Math.hypot(p.x - last.x, p.z - last.z) < 0.6);
      last = { ...p };
      assert.equal(litersInCars(a), 24000);
    },
  );
  assert.equal(a.railFreight!.cars[0].locationId, dock.id);
  tickUntil(s, () => b.status === 'unloading', 1200);
  assert.equal(litersInCars(b), 17000);
  s = S.load(S.save(s));
  a = s.orders.find((o) => o.id === first.id)!;
  b = s.orders.find((o) => o.id === second.id)!;
  assert.equal(litersInCars(a) + litersInCars(b), 41000);
  assert.equal(a.arrived + b.arrived, 0);
});

test('loaded multi-car tanker reception fits every car inside its chosen named interval', () => {
  const s = yard();
  assert.equal(
    saveRailLocation(s, {
      name: 'Liquid reception',
      kind: 'unloading',
      trackId: 'BOOTSTRAP-SIDING',
      route: 'straight',
      offset: 55,
      length: 70,
    }),
    undefined,
  );
  const location = s.railLocations!.at(-1)!;
  const ordered = orderTankers(s, {
    product: 'bulkWater',
    litersPerCar: 18000,
    carCount: 2,
    railLocationId: location.id,
  });
  assert.equal(ordered.error, undefined);
  const o = s.orders.find((o) => o.id === ordered.id)!;
  tickUntil(s, () => o.status === 'unloading', 1200);
  assert.equal(o.railFreight!.receptionLocationId, location.id);
  for (const c of o.railFreight!.cars) {
    assert.ok(c.pose!.x - c.length / 2 >= 45);
    assert.ok(c.pose!.x + c.length / 2 <= 115);
    assert.equal(c.locationId, location.id);
  }
  assert.equal(litersInCars(o), 36000);
  assert.equal(o.arrived, 0);
  assert.equal(S.load(S.save(s)).orders[0].railFreight!.receptionLocationId, location.id);
});
