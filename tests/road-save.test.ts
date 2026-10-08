import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { berth, deckPose, roadLength, sampleRoad, ROAD_ROUTE_VERSION } from '../src/motion.ts';
import { carrierBoxes, boxOverlap } from '../src/traffic.ts';
import type { State, Order } from '../src/types.ts';
import { seedHandlingResources, tickUntil, advance } from './support/yard.ts';

const invoiceCount = (s: State, id: string) =>
  s.costs.filter((c) => c.entity === id && c.category === 'Purchases').length;
const near = (a: number, b: number, message: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} != ${b}`);
function reload(s: State) {
  const before = JSON.parse(S.save(s)) as State;
  const after = S.load(S.save(s));
  assert.deepEqual(after.orders, before.orders, 'Current-format road state survives unchanged');
  assert.deepEqual(after.equipment, before.equipment);
  assert.deepEqual(after.workers, before.workers);
  assert.deepEqual(after.costs, before.costs);
  return after;
}
function restoreLegacy(s: State) {
  s.version = 3;
  for (const o of s.orders)
    if (o.drive) {
      delete o.drive.roadVersion;
      delete o.drive.yardPermit;
    }
  return S.load(S.save(s));
}
function sameDeck(s: State, o: Order) {
  const e = s.equipment.find((e) => e.id === o.equipmentId)!;
  const pose = deckPose(sampleRoad(o, o.drive!.distance));
  near(e.x, pose.x, 'Machine remains on its carrier along X');
  near(e.z, pose.z, 'Machine remains on its carrier along Z');
  near(e.y || 0, pose.y, 'Machine remains supported by its deck');
  assert.equal(e.transportOrder, o.id);
}

test('saving a departing bus preserves its forward trip and never repeats hiring or invoices', () => {
  let s = S.createState();
  const [id] = S.purchase(s, 'builder', 3);
  tickUntil(s, () => s.orders[0].status === 'departing' && s.orders[0].vehicle.x > -15);
  s = reload(s);
  const o = s.orders.find((o) => o.id === id)!;
  let lastX = o.vehicle.x;
  tickUntil(
    s,
    () => o.status === 'done',
    180,
    () => {
      assert.ok(o.vehicle.x >= lastX - 1e-8);
      assert.equal(o.drive!.reverse, false);
      lastX = o.vehicle.x;
    },
  );
  assert.equal(s.workers.length, 3);
  assert.equal(invoiceCount(s, id), 1);
});

test('freight saves resume backing, the gear-change stop, and forward road exit without replaying cargo', () => {
  let s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 12, d: 12 });
  seedHandlingResources(s);
  const [id] = S.purchase(s, 'slab', 8);
  const phases = new Set<string>();
  for (let i = 0; i < 12000; i++) {
    S.tick(s, 0.1);
    const o = s.orders.find((o) => o.id === id)!;
    if (o.status === 'done') break;
    if (o.status !== 'departing') continue;
    const phase =
      (o.drive!.gearPause || 0) > 0.2 && o.drive!.distance > roadLength(o) + 15
        ? 'gear-change'
        : o.drive!.reverse && o.drive!.distance > roadLength(o) + 5
          ? 'backing'
          : !o.drive!.reverse && o.vehicle.z < 0
            ? 'forward'
            : '';
    if (phase && !phases.has(phase)) {
      phases.add(phase);
      s = reload(s);
      const total = S.totals(s, 'slab');
      assert.equal(total.delivered, 8);
      assert.equal(total.delivered, total.stored + total.cargo + total.installed);
      assert.equal(invoiceCount(s, id), 1);
    }
  }
  assert.deepEqual([...phases].sort(), ['backing', 'forward', 'gear-change']);
  assert.equal(s.orders.find((o) => o.id === id)!.status, 'done');
  assert.equal(S.totals(s, 'slab').stored, 8);
  assert.equal(invoiceCount(s, id), 1);
});

test('the lowloader forward loop continues across a save without duplicating the deployed machine', () => {
  let s = S.createState();
  S.purchase(s, 'operator', 1);
  const [id] = S.purchase(s, 'forklift', 1);
  tickUntil(s, () => {
    const o = s.orders.find((o) => o.id === id)!;
    return o.status === 'departing' && o.vehicle.z > 44 && o.vehicle.x < -16;
  });
  const machineId = s.orders.find((o) => o.id === id)!.equipmentId;
  s = reload(s);
  let o = s.orders.find((o) => o.id === id)!;
  tickUntil(
    s,
    () => o.status === 'done',
    240,
    () => {
      assert.equal(o.drive!.reverse, false);
      assert.equal(s.equipment.length, 1);
      assert.equal(s.equipment[0].id, machineId);
      assert.equal(s.equipment[0].transportOrder, undefined);
    },
  );
  assert.equal(invoiceCount(s, id), 1);
});

test('a paused v3 lowloader migrates its parked carrier and same owned machine together', () => {
  let s = S.createState();
  const [id] = S.purchase(s, 'forklift', 1);
  tickUntil(s, () => s.orders[0].status === 'unloading');
  const o = s.orders[0],
    e = s.equipment[0],
    machineId = e.id;
  o.vehicle = { x: -8, z: 36 };
  e.x = -8;
  e.z = 34.5;
  e.y = 0.82;
  s.paused = true;
  s = restoreLegacy(s);
  const migrated = s.orders.find((o) => o.id === id)!;
  assert.equal(s.paused, true);
  assert.deepEqual(migrated.vehicle, { x: berth(migrated).x, z: berth(migrated).z });
  assert.equal(migrated.drive!.roadVersion, ROAD_ROUTE_VERSION);
  assert.equal(s.equipment[0].id, machineId);
  sameDeck(s, migrated);
  assert.equal(invoiceCount(s, id), 1);
  s = reload(s);
  s.paused = false;
  S.purchase(s, 'operator', 1);
  tickUntil(s, () => s.orders.every((o) => o.status === 'done'));
  assert.equal(s.equipment.length, 1);
  assert.equal(s.equipment[0].id, machineId);
  assert.equal(invoiceCount(s, id), 1);
});

test('v3 approaching lowloaders migrate the deck pose before the first rendered frame and invoice once', () => {
  let s = S.createState();
  const [id] = S.purchase(s, 'excavator', 1);
  tickUntil(s, () => s.orders[0].status === 'approaching' && s.orders[0].drive!.distance > 55);
  const o = s.orders[0],
    e = s.equipment[0],
    machineId = e.id;
  // An old single-lane approach, midway between the rail crossing and berth.
  o.vehicle = { x: -8, z: 8 };
  o.drive!.yaw = Math.PI / 2;
  e.x = -8;
  e.z = 6.5;
  e.y = 0.82;
  e.yaw = Math.PI / 2;
  s.paused = true;
  s = restoreLegacy(s);
  sameDeck(s, s.orders[0]);
  assert.equal(s.equipment[0].id, machineId);
  assert.equal(invoiceCount(s, id), 0);
  s.paused = false;
  tickUntil(s, () => s.orders[0].status === 'unloading');
  advance(s, 5);
  sameDeck(s, s.orders[0]);
  assert.equal(invoiceCount(s, id), 1);
  assert.equal(s.equipment.length, 1);
});

test('v3 ramp saves retain the same driver, machine, ramp progress, and support height', () => {
  let s = S.createState();
  S.purchase(s, 'operator', 1);
  const [id] = S.purchase(s, 'forklift', 1);
  tickUntil(s, () => {
    const o = s.orders.find((o) => o.id === id)!;
    return o.deployment === 'offload' && (o.deploymentClock || 0) > 8;
  });
  const o = s.orders.find((o) => o.id === id)!,
    e = s.equipment[0];
  const expected = {
    x: e.x,
    z: e.z,
    y: e.y,
    clock: o.deploymentClock,
    id: e.id,
    operator: e.operator,
  };
  const dx = -8 - o.vehicle.x,
    dz = 36 - o.vehicle.z;
  o.vehicle = { x: -8, z: 36 };
  e.x += dx;
  e.z += dz;
  const w = s.workers.find((w) => w.id === e.operator)!;
  w.x += dx;
  w.z += dz;
  s = restoreLegacy(s);
  const m = s.equipment[0],
    restored = s.orders.find((o) => o.id === id)!;
  near(m.x, expected.x, 'Ramp X offset');
  near(m.z, expected.z, 'Ramp Z offset');
  near(m.y!, expected.y!, 'Ramp height');
  assert.equal(restored.deploymentClock, expected.clock);
  assert.equal(m.id, expected.id);
  assert.equal(m.operator, expected.operator);
  assert.equal(s.workers.find((w) => w.id === m.operator)!.vehicle, m.id);
  tickUntil(s, () => restored.status === 'done');
  assert.equal(invoiceCount(s, id), 1);
  assert.equal(s.equipment.length, 1);
});

test('v3 curb migration carries a stepping passenger with the bus and does not hire them twice', () => {
  let s = S.createState();
  const [id] = S.purchase(s, 'builder', 2);
  tickUntil(s, () => s.workers.some((w) => w.transportOrder === id));
  const o = s.orders[0],
    w = s.workers[0];
  const relative = { x: w.x - o.vehicle.x, z: w.z - o.vehicle.z, y: w.y };
  const dx = -20 - o.vehicle.x,
    dz = -13 - o.vehicle.z;
  o.vehicle = { x: -20, z: -13 };
  w.x += dx;
  w.z += dz;
  s = restoreLegacy(s);
  near(s.workers[0].x - s.orders[0].vehicle.x, relative.x, 'Door passenger X');
  near(s.workers[0].z - s.orders[0].vehicle.z, relative.z, 'Door passenger Z');
  assert.equal(s.workers[0].y, relative.y);
  tickUntil(s, () => s.orders[0].status === 'done');
  assert.equal(s.workers.length, 2);
  assert.equal(invoiceCount(s, id), 1);
});

test('v3 departing bus, freight truck, and lowloader switch to their new exit routes without repeating delivery', () => {
  for (const item of ['builder', 'slab', 'forklift']) {
    let s = S.createState();
    S.addZone(s, { x: 24, z: 26, w: 12, d: 12 });
    if (item === 'slab') seedHandlingResources(s);
    if (item === 'forklift') S.purchase(s, 'operator', 1);
    const [id] = S.purchase(s, item, 1);
    tickUntil(s, () => s.orders.find((o) => o.id === id)!.status === 'departing');
    const o = s.orders.find((o) => o.id === id)!;
    o.vehicle =
      item === 'builder'
        ? { x: -45, z: -13 }
        : item === 'forklift'
          ? { x: -8, z: 20 }
          : { x: 2, z: 18 };
    o.drive!.reverse = true;
    o.drive!.gearPause = 0;
    const assets = s.equipment.map((e) => e.id),
      workers = s.workers.map((w) => w.id);
    s.paused = true;
    s = restoreLegacy(s);
    const migrated = s.orders.find((o) => o.id === id)!;
    const pose = sampleRoad(migrated, migrated.drive!.distance);
    near(migrated.vehicle.x, pose.x, `${item} immediate migrated X`);
    near(migrated.vehicle.z, pose.z, `${item} immediate migrated Z`);
    assert.equal(migrated.arrived, 1);
    assert.equal(invoiceCount(s, id), 1);
    s.paused = false;
    tickUntil(
      s,
      () => migrated.status === 'done',
      180,
      () => {
        if (migrated.vehicle.z < -10 && Math.abs(migrated.vehicle.x) > 35)
          assert.equal(migrated.drive!.reverse, false, `${item} uses forward gear on public road`);
      },
    );
    assert.deepEqual(
      s.equipment.map((e) => e.id),
      assets,
    );
    assert.deepEqual(
      s.workers.map((w) => w.id),
      workers,
    );
    assert.equal(invoiceCount(s, id), 1);
  }
});

test('save validation rejects a non-boolean yard maneuver permit', () => {
  const s = S.createState();
  S.purchase(s, 'slab', 1);
  tickUntil(s, () => s.orders[0].status === 'approaching');
  const malformed = JSON.parse(S.save(s));
  malformed.orders[0].drive.yardPermit = 'held';
  assert.throws(
    () => S.load(JSON.stringify(malformed)),
    /Invalid save: invalid yard maneuver permit/,
  );
});

test('yard maneuver reservations survive reload while arrivals and multiple berth departures compete', () => {
  let s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  for (const [item, qty] of [
    ['builder', 3],
    ['operator', 2],
    ['excavator', 1],
    ['forklift', 1],
    ['water', 1],
    ['diesel', 2],
  ] as [string, number][])
    S.purchase(s, item, qty);
  let savedPermit = false;
  for (let i = 0; i < 18000 && !s.orders.every((o) => o.status === 'done'); i++) {
    S.tick(s, 0.1);
    const active = s.orders.filter((o) => o.status !== 'ordered' && o.status !== 'done');
    const permits = active.filter((o) => o.drive?.yardPermit);
    assert.ok(permits.length <= 1, 'Only one vehicle owns the connecting yard maneuver');
    for (let a = 0; a < active.length; a++)
      for (let b = a + 1; b < active.length; b++)
        assert.ok(
          !carrierBoxes(active[a]).some((x) =>
            carrierBoxes(active[b]).some((y) => boxOverlap(x, y)),
          ),
          `Physical carrier overlap: ${active[a].id}/${active[b].id}`,
        );
    if (!savedPermit && permits.some((o) => o.status === 'departing')) {
      s = reload(s);
      savedPermit = true;
    }
  }
  assert.equal(savedPermit, true);
  assert.ok(
    s.orders.every((o) => o.status === 'done'),
    JSON.stringify(s.orders.map((o) => ({ item: o.item, status: o.status, note: o.note }))),
  );
  for (const o of s.orders) assert.equal(invoiceCount(s, o.id), 1);
  assert.equal(s.equipment.length, 2);
});
