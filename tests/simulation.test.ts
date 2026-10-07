import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { overlap, route } from '../src/path.ts';
import { MATERIALS, TRACK_GAUGE, RAIL_HEAD_WIDTH, RAIL_CENTER_OFFSET } from '../src/catalog.ts';
import {
  checkScenarioFuel,
  requestLowFuelService,
  seedHandlingResources,
  tickUntil,
} from './support/yard.ts';
import type { State, Item } from '../src/types.ts';
const advance = (s: State, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.1) S.tick(s, 0.1);
};
const until = (s: State, p: () => boolean, seconds = 1200) => {
  let t = 0;
  while (!p() && t < seconds) {
    S.tick(s, 0.1);
    t += 0.1;
  }
  assert.ok(
    p(),
    `Timed out at ${t.toFixed(1)} s; jobs: ${JSON.stringify(s.jobs.filter((j) => j.status !== 'done').map((j) => ({ id: j.id, kind: j.kind, phase: j.phase, reason: j.reason })))}; deliveries: ${JSON.stringify(s.orders.filter((o) => o.status !== 'done').map((o) => ({ id: o.id, item: o.item, status: o.status, phase: o.unload?.phase || o.deployment, note: o.note })))}`,
  );
};
function checkStock(s: State) {
  const stacks = s.stacks.filter((t) => t.qty > 0);
  for (const t of stacks) {
    assert.ok(t.qty <= MATERIALS[t.item].max);
    assert.ok(t.qty >= t.reserved);
    for (const b of stacks)
      if (b.id !== t.id) assert.ok(!overlap(t, b), `${t.id} overlaps ${b.id}`);
  }
}
function checkBalance(s: State, item: Item) {
  const t = S.totals(s, item);
  assert.equal(
    t.delivered,
    t.stored + t.cargo + t.inConstruction + t.installed,
    `Conservation failed for ${item}: ${JSON.stringify(t)}`,
  );
}
function yardWithStorage() {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }, 'Receiving stockyard');
  return s;
}
test('road purchases split by weight; invoices occur once, upon arrival', () => {
  const s = yardWithStorage();
  seedHandlingResources(s);
  const ids = S.purchase(s, 'slab', 100);
  assert.equal(ids.length, 3);
  assert.equal(s.costs.length, 0);
  until(s, () => s.orders.every((o) => o.status === 'done'));
  assert.equal(S.totals(s, 'slab').stored, 100);
  assert.equal(s.costs.filter((c) => c.category === 'Purchases').length, 3);
  advance(s, 60);
  assert.equal(s.costs.filter((c) => c.category === 'Purchases').length, 3);
  assert.equal(
    s.costs.filter((c) => c.category === 'Purchases').reduce((n, c) => n + c.amount, 0),
    100 * 38 + 3 * 90,
  );
  checkStock(s);
  checkBalance(s, 'slab');
});
test('full stockyard holds the delivery until real space is designated', () => {
  const s = yardWithStorage();
  seedHandlingResources(s);
  s.zones = [{ id: 'Z', name: 'Small', x: 25, z: 30, w: 1, d: 1 }];
  const quantity = MATERIALS.slab.max + 1;
  S.purchase(s, 'slab', quantity);
  until(s, () => S.totals(s, 'slab').stored === MATERIALS.slab.max);
  advance(s, 30);
  assert.equal(S.totals(s, 'slab').stored, MATERIALS.slab.max);
  assert.match(s.orders[0].note, /storage|capacity/i);
  assert.equal(S.addZone(s, { x: 35, z: 30, w: 6, d: 6 }), '');
  until(s, () => s.orders[0].status === 'done');
  assert.equal(S.totals(s, 'slab').stored, quantity);
  checkStock(s);
});
test('empty yard bootstraps into paved office with physical handling', () => {
  const s = yardWithStorage();
  S.purchase(s, 'builder', 1);
  S.purchase(s, 'operator', 1);
  S.purchase(s, 'excavator', 1);
  S.purchase(s, 'slab', 18);
  S.purchase(s, 'office', 1);
  const { job, error } = S.plan(s, 'office', 6, 32);
  assert.equal(error, '');
  assert.equal(s.jobs.length, 19);
  until(s, () => job!.status === 'done', 2400);
  assert.equal(Object.keys(s.paving).length, 18);
  assert.equal(s.buildings.filter((b) => b.kind === 'office').length, 1);
  assert.ok(s.movements.some((m) => m.reason === 'Construction pickup'));
  assert.ok(s.equipment[0].used > 0);
  checkBalance(s, 'slab');
  checkBalance(s, 'office');
  checkStock(s);
});
test('save and load while carrying preserves cargo, reservations, and invoices', () => {
  let s = S.demoState();
  const j = S.plan(s, 'rail', 125, 4).job!;
  until(s, () => s.equipment.some((e) => e.cargo?.item === 'rail'));
  const total = s.costs
    .filter((c) => c.category === 'Opening stock')
    .reduce((n, c) => n + c.amount, 0);
  s = S.load(S.save(s));
  const restored = s.jobs.find((k) => k.id === j.id)!;
  until(s, () => restored.status === 'done');
  assert.equal(s.buffer.x, 130);
  assert.equal(s.buffer.z, 5);
  assert.equal(
    s.costs.filter((c) => c.category === 'Opening stock').reduce((n, c) => n + c.amount, 0),
    total,
  );
  checkBalance(s, 'rail');
});
test('canceling reserved work releases crew and material', () => {
  const s = S.demoState();
  const j = S.plan(s, 'rail', 125, 4).job!;
  until(s, () => j.status === 'doing');
  S.cancelJob(s, j.id);
  assert.equal(j.status, 'canceled');
  assert.ok(!s.workers.some((w) => w.job === j.id));
  assert.ok(!s.stacks.some((t) => t.reserved));
  checkBalance(s, 'rail');
});
test('canceling cargo deposits it physically without deleting material', () => {
  const s = S.demoState();
  const j = S.plan(s, 'rail', 125, 4).job!;
  until(s, () => s.equipment.some((e) => e.cargo?.item === 'rail'));
  S.cancelJob(s, j.id);
  until(s, () => j.status === 'canceled');
  assert.ok(s.stacks.some((t) => t.source === j.id && t.qty === 1));
  checkBalance(s, 'rail');
});
test('blocked fuel recovers with a physical service-can trip', () => {
  const s = S.demoState();
  const e = s.equipment[0];
  e.fuel = 0;
  const liters = s.stacks
    .filter((t) => t.item === 'diesel')
    .reduce((n, t) => n + (t.liters || 0), 0);
  S.refuel(s, e.id);
  until(s, () => e.fuel === e.tank);
  assert.ok(Math.abs(
    s.stacks.filter((t) => t.item === 'diesel').reduce((n, t) => n + (t.liters || 0), 0) -
    (liters - e.tank),
  ) < 1e-7, 'Physical can trips conserve fuel within floating-point precision');
  assert.ok(
    s.events.filter((e) => e.type === 'Fuel' && e.entity === s.equipment[0].id && e.text.startsWith('Transferred ')).length === 4,
  );
});
test('missing materials includes incoming supply and prevents duplicate procurement', () => {
  const s = yardWithStorage();
  S.pave(s, { x: 3, z: 35, w: 4, d: 4 });
  assert.equal(S.missingMaterials(s).slab, 16);
  assert.equal(S.buyMissing(s), 16);
  assert.equal(S.buyMissing(s), 0);
});
test('four-direction routes avoid footprints, and no route can enter storage', () => {
  const obstacle = { x: 3, z: 0, w: 2, d: 6 };
  const path = route({ x: 0.5, z: 2.5 }, { x: 7.5, z: 2.5 }, [obstacle], 0.1);
  assert.ok(path);
  assert.ok(path.every((p) => !(p.x > 3 && p.x < 5 && p.z > 0 && p.z < 6)));
  assert.equal(route({ x: 0.5, z: 2.5 }, { x: 4.5, z: 2.5 }, [obstacle]), null);
});
test('invalid save never parses as a valid state', () => {
  assert.throws(() => S.load('{}'));
  assert.throws(() => S.load('not json'));
});
test('equipment can run dry while carrying and recover without losing its job', () => {
  const s = yardWithStorage();
  S.purchase(s, 'builder', 1);
  S.purchase(s, 'operator', 1);
  S.purchase(s, 'excavator', 1);
  S.purchase(s, 'rail', 1);
  S.purchase(s, 'diesel', 1);
  // The only handling machine cannot receive its own rescue fuel after it is empty.
  until(s, () => s.orders.every((o) => o.status === 'done'));
  const j = S.plan(s, 'rail', 125, 4).job!;
  until(s, () => s.equipment.some((e) => e.job === j.id && e.cargo));
  const e = s.equipment.find((e) => e.job === j.id)!;
  e.fuel = 0;
  advance(s, 1);
  assert.match(j.reason, /Out of fuel/);
  S.refuel(s, e.id);
  until(s, () => j.status === 'done', 1200);
  assert.equal(s.buffer.x, 130);
  checkBalance(s, 'rail');
  assert.ok(e.fuel > 0);
});
test('a finished purchased building can be dismantled and rebuilt with the same material', () => {
  const s = S.demoState();
  const j = S.plan(s, 'sanitary', 15, 33).job!;
  until(s, () => j.status === 'done');
  const b = s.buildings.find((b) => b.source === j.id)!;
  assert.ok(b);
  S.removeBuilding(s, b.id);
  until(s, () => s.jobs.some((j) => j.kind === 'remove' && j.status === 'done'));
  assert.ok(!s.buildings.some((t) => t.id === b.id));
  checkBalance(s, 'sanitary');
  const rebuild = S.plan(s, 'sanitary', 15, 33).job!;
  until(s, () => rebuild.status === 'done');
  checkBalance(s, 'sanitary');
});
test('an explicitly assigned manual operator is used instead of an automatic operator', () => {
  const s = S.demoState();
  const op = s.workers.filter((w) => w.role === 'operator')[1];
  op.duty = 'manual';
  const j = S.plan(s, 'rail', 125, 4).job!;
  j.preferredWorker = op.id;
  until(s, () => j.status === 'doing');
  assert.equal(j.operator, op.id);
  until(s, () => j.status === 'done');
  assert.equal(op.duty, 'manual');
});
test('recovery preserves a prefab asset ID through dismantling and reinstallation', () => {
  const s = S.demoState();
  const b = s.buildings.find((b) => b.kind === 'sanitary')!;
  S.removeBuilding(s, b.id);
  until(s, () => s.jobs.some((j) => j.kind === 'remove' && j.status === 'done'));
  const j = S.plan(s, 'sanitary', 5, 38).job!;
  const recovered = s.stacks.find((t) => t.assetId === b.id)!;
  s.stacks = s.stacks.filter((t) => t.id === recovered.id || t.item !== 'sanitary');
  until(s, () => j.status === 'done');
  assert.equal(s.buildings.find((t) => t.x === 5 && t.z === 38)?.id, b.id);
});
test('rail plans recover existing paving and conserve both material types', () => {
  const s = S.demoState();
  const slabs = S.pave(s, { x: 55, z: 20, w: 5, d: 3 });
  assert.equal(slabs, 15);
  // Both machines reserve real pickup and placement lanes; this physical
  // 15-cell workload takes about 1,414 seconds before track recovery begins.
  until(s, () => s.jobs.every((j) => j.status === 'done'), 1800);
  const j = S.plan(s, 'rail', 55, 20).job!;
  until(s, () => j.status === 'done', 2400);
  assert.ok(!s.paving['55,20']);
  checkBalance(s, 'slab');
  checkBalance(s, 'rail');
  assert.equal(S.recoverAt(s, { x: 56, z: 21 }), '');
  until(s, () => s.jobs.every((j) => j.status === 'done'), 1200);
  assert.equal(s.rails.length, 0);
  checkBalance(s, 'rail');
});
test('large rail orders split by actual flatcar deck area as well as weight', () => {
  const s = yardWithStorage();
  S.purchase(s, 'rail', 33, 'rail');
  assert.deepEqual(
    s.orders[0].railFreight!.cars.map((car) => car.manifest.reduce((n,line) => n + line.qty,0)),
    [24, 9],
  );
});
test('save validation rejects broken paths, fuel, and missing crew references', () => {
  for (const mutate of [
    (s: State) => {
      (s.workers[0] as any).path = null;
    },
    (s: State) => {
      s.equipment[0].fuel = -1;
    },
    (s: State) => {
      s.stacks[0].qty = 999;
    },
  ]) {
    const s = S.demoState();
    mutate(s);
    assert.throws(() => S.load(S.save(s)), /Invalid save/);
  }
});
test('a larger starter base completes across save/reload with balanced inventory', () => {
  let s = yardWithStorage();
  S.purchase(s, 'builder', 3);
  S.purchase(s, 'operator', 2);
  S.purchase(s, 'excavator', 1);
  S.purchase(s, 'forklift', 1);
  S.purchase(s, 'power', 1);
  S.purchase(s, 'water', 1);
  S.purchase(s, 'diesel', 2);
  S.plan(s, 'office', 4, 32);
  S.plan(s, 'sanitary', 4, 39);
  S.plan(s, 'shed', 12, 44);
  S.plan(s, 'store', 55, 29);
  for (const [x, z] of [
    [4, 29],
    [21, 31],
    [53, 40],
    [68, 29],
  ])
    S.plan(s, 'lamp', x, z);
  for (let x = 125; x < 150; x += 5) S.plan(s, 'rail', x, 4);
  S.pave(s, { x: 56, z: 35, w: 8, d: 4 });
  S.buyMissing(s);
  advance(s, 200);
  s = S.load(S.save(s));
  let sawServiceCan = false;
  tickUntil(
    s,
    () => s.jobs.every((j) => j.status === 'done'),
    12000,
    () => {
      requestLowFuelService(s);
      checkScenarioFuel(s);
      if (
        s.jobs.some(
          (j) => j.kind === 'refuel' && j.phase === 'Carry fuel' && (j.fuelLiters || 0) > 0,
        )
      )
        sawServiceCan = true;
    },
  );
  assert.ok(s.events.some(e=>e.type==='Traffic'&&e.text.includes('from another setting dock')), 'A loaded slab crew resolves the mutual lamp-placement obstruction by physically choosing another working face');
  assert.equal(s.jobs.filter((j) => j.kind !== 'refuel').length, 145);
  assert.ok(
    sawServiceCan,
    'The longer physical build must receive real drum-to-can-to-tank fuel service',
  );
  assert.ok(s.jobs.some((j) => j.kind === 'refuel' && j.status === 'done'));
  assert.ok(s.events.some((e) => e.type === 'Fuel' && e.text.startsWith('Collected ')));
  assert.ok(s.events.some((e) => e.type === 'Fuel' && e.text.startsWith('Transferred ')));
  assert.equal(s.buildings.filter((b) => b.kind === 'office').length, 1);
  assert.equal(s.buildings.filter((b) => b.kind === 'lamp' && b.connected).length, 4);
  assert.equal(s.buffer.x, 150);
  assert.equal(s.rails.length, 5);
  for (const item of Object.keys(MATERIALS) as Item[]) checkBalance(s, item);
  checkStock(s);
  assert.ok(s.events.length > 150);
  assert.equal(
    s.costs.filter((c) => c.category === 'Purchases').length,
    s.orders.filter((o) => o.invoiced).length,
  );
});
test('a 3 m aisle is wide enough for a machine to approach stored material', () => {
  const stacks = [
    { x: 24, z: 26, w: 1, d: 1 },
    { x: 28, z: 26, w: 1, d: 1 },
    { x: 32, z: 26, w: 1, d: 1 },
    { x: 24, z: 30, w: 1, d: 1 },
    { x: 28, z: 30, w: 1, d: 1 },
  ];
  const p = route({ x: 26.5, z: 22.5 }, { x: 26.5, z: 28.5 }, stacks, 1.1);
  assert.ok(p);
});
test('fuel is conserved in a service can across save and stop-after-current-trip', () => {
  let s = S.demoState();
  const eid = s.equipment[0].id;
  s.equipment[0].fuel = 0;
  S.refuel(s, eid);
  until(s, () => s.jobs.some((j) => (j.fuelLiters || 0) > 0));
  let j = s.jobs.find((j) => j.kind === 'refuel')!;
  assert.equal(j.fuelLiters, 20);
  assert.equal(
    s.stacks.filter((t) => t.item === 'diesel').reduce((n, t) => n + (t.liters || 0), 0),
    380,
  );
  s = S.load(S.save(s));
  j = s.jobs.find((j) => j.kind === 'refuel')!;
  S.cancelJob(s, j.id);
  until(s, () => j.status === 'done');
  assert.ok(Math.abs(s.equipment.find((e) => e.id === eid)!.fuel - 20) < 1e-7);
  assert.equal(
    s.stacks.filter((t) => t.item === 'diesel').reduce((n, t) => n + (t.liters || 0), 0),
    380,
  );
});
test('operating track reserves a symmetric grid envelope around its exact centerline', () => {
  const s = S.demoState();
  const j = S.plan(s, 'rail', 125, 4).job!;
  assert.equal(j.d, 2);
  assert.equal(j.z + j.d / 2, s.buffer.z);
  until(s, () => j.status === 'done');
  assert.equal(s.buffer.z, 5);
});
test('stockyard designations can be removed only when physically empty and unreserved', () => {
  const empty = yardWithStorage();
  assert.equal(S.removeZone(empty, empty.zones[0].id), '');
  assert.equal(empty.zones.length, 0);
  const s = S.demoState();
  assert.match(S.removeZone(s, 'ZONE-RECEIVING'), /still holds/);
  assert.equal(s.zones.length, 1);
});

test('a completely empty start has no assigned stockyard; delivery waits for player designation', () => {
  const s = S.createState();
  assert.deepEqual(s.zones, []);
  assert.deepEqual(s.stacks, []);
  assert.deepEqual(s.buildings, []);
  seedHandlingResources(s);
  S.purchase(s, 'slab', 6);
  tickUntil(s, () => s.orders[0].note === 'No stockyard — designate a storage area', 600);
  assert.equal(S.totals(s, 'slab').stored, 0);
  assert.equal(s.orders[0].note, 'No stockyard — designate a storage area');
  S.addZone(s, { x: 24, z: 26, w: 12, d: 12 });
  until(s, () => s.orders[0].status === 'done');
  assert.equal(S.totals(s, 'slab').stored, 6);
});
test('two-cell track preserves 1,435 mm inner gauge and both axis centerlines', () => {
  assert.equal(TRACK_GAUGE, 1.435);
  assert.ok(Math.abs(2 * RAIL_CENTER_OFFSET - RAIL_HEAD_WIDTH - 1.435) < 1e-12);
  const s = S.createState();
  const horizontal = S.plan(s, 'rail', 125, 4).job!;
  const vertical = S.plan(s, 'rail', 59, 60, 1).job!;
  assert.deepEqual([horizontal.w, horizontal.d, horizontal.z + horizontal.d / 2], [5, 2, 5]);
  assert.deepEqual([vertical.w, vertical.d, vertical.x + vertical.w / 2], [2, 5, 60]);
});
test('version 1 rail footprints migrate without moving tracks, buffer, or in-flight destinations', () => {
  const s = S.demoState();
  const j = S.plan(s, 'rail', 125, 4).job!;
  until(s, () => j.status === 'done');
  const carrying = S.plan(s, 'rail', 130, 4).job!;
  until(s, () => s.equipment.some((e) => e.cargo?.item === 'rail'));
  const vertical = S.plan(s, 'rail', 59, 60, 1).job!;
  const legacy = JSON.parse(S.save(s));
  legacy.version = 1;
  for (const r of legacy.rails) r.rotation % 2 ? r.x-- : r.z--;
  for (const r of legacy.jobs.filter((r: any) => r.kind === 'rail')) {
    if (r.rotation % 2) {
      r.x--;
      r.w = 4;
    } else {
      r.z--;
      r.d = 4;
    }
  }
  const restored = S.load(JSON.stringify(legacy));
  assert.equal(restored.version, 4);
  assert.deepEqual(restored.rails, s.rails);
  assert.deepEqual(restored.buffer, s.buffer);
  assert.deepEqual(
    restored.jobs.find((r) => r.id === vertical.id),
    JSON.parse(JSON.stringify(vertical)),
  );
  assert.deepEqual(S.load(S.save(restored)).rails, restored.rails);
  const expectedEquipment = JSON.parse(JSON.stringify(s.equipment));
  for (const equipment of expectedEquipment) {
    equipment.y ??= 0;
    equipment.yaw ??= (equipment.heading * Math.PI) / 2;
  }
  assert.deepEqual(restored.equipment, expectedEquipment);
  until(restored, () => restored.jobs.find((j) => j.id === carrying.id)?.status === 'done');
  assert.deepEqual(restored.buffer, { x: 135, z: 5 });
});

test('pristine legacy empty yards lose the old automatic receiving-zone assignment', () => {
  const s = S.createState();
  s.version = 1;
  s.zones.push({ id: 'ZONE-RECEIVING', name: 'Receiving stockyard', x: 24, z: 26, w: 27, d: 24 });
  assert.deepEqual(S.load(S.save(s)).zones, []);
});
