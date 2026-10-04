import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { shipmentLots, orderLines, orderMass } from '../src/delivery.ts';
import { FREIGHT_CAPACITY, FREIGHT_DECK_LENGTH, orderDeckLength } from '../src/procurement.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';

for (const mode of ['road', 'rail'] as const) {
  test(`${mode} mixed freight remains one real carrier and survives every physical transfer`, () => {
    let s = S.createState();
    S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
    const e = seedHandlingResources(s, 'forklift');
    const ids = S.purchaseBatch(
      s,
      [
        { item: 'slab', qty: 8 },
        { item: 'diesel', qty: 1 },
      ],
      mode,
    );
    assert.equal(ids.length, 1);
    const oid = ids[0];
    assert.equal(s.orders.length, 1, 'No hidden companion order or carrier');
    let o = s.orders[0];
    assert.equal(o.qty, 9);
    assert.equal(orderMass(o), 8 * 280 + 185);
    assert.equal(S.totals(s, 'diesel').incoming, 1, 'Secondary line is counted');
    assert.equal(o.total, 8 * 38 + 320 + (mode === 'road' ? 90 : 240));
    const lots = shipmentLots(o);
    assert.deepEqual(
      lots.map((l) => l.item),
      ['slab', 'diesel'],
    );
    assert.ok(lots[0].x + 0.5 <= lots[1].x - 0.5, 'Deck lots do not overlap');
    tickUntil(s, () => !!o.unload && o.unload.item === 'slab', 900);
    s = S.load(S.save(s));
    o = s.orders[0];
    tickUntil(s, () => !!o.unload && o.unload.item === 'diesel' && !!s.equipment[0].cargo, 1200);
    assert.equal(o.manifest![0].arrived, 8);
    assert.equal(o.manifest![1].arrived, 1);
    assert.equal(S.totals(s, 'slab').stored, 8);
    assert.equal(S.totals(s, 'diesel').cargo, 1);
    s = S.load(S.save(s));
    o = s.orders[0];
    tickUntil(s, () => o.status === 'done', 1200);
    assert.equal(S.totals(s, 'diesel').stored, 1);
    assert.equal(s.equipment[0].cargo, undefined);
    assert.equal(s.orders.length, 1);
    assert.equal(s.costs.filter((c) => c.entity === oid).length, 1);
    for (const item of ['slab', 'diesel'] as const) {
      const total = S.totals(s, item);
      assert.equal(total.delivered, total.stored + total.cargo + total.installed);
      assert.equal(
        s.movements.filter((m) => m.from === oid && m.item === item).reduce((n, m) => n + m.qty, 0),
        item === 'slab' ? 8 : 1,
      );
    }
    assert.equal(s.equipment[0].id, e.id);
  });
}

test('mixed-role hires step off one charter bus with separately accounted roles and wages', () => {
  let s = S.createState();
  const ids = S.purchaseBatch(
    s,
    [
      { item: 'builder', qty: 2 },
      { item: 'operator', qty: 2 },
      { item: 'engineer', qty: 1 },
    ],
    'rail',
  );
  assert.equal(ids.length, 1);
  let o = s.orders[0];
  assert.equal(o.mode, 'road');
  assert.equal(o.total, 2 * 90 + 2 * 120 + 150 + 90);
  tickUntil(s, () => o.arrived === 3, 900);
  assert.ok(
    s.workers.some((w) => w.transportOrder === o.id),
    'Passengers really use the bus steps',
  );
  s = S.load(S.save(s));
  o = s.orders[0];
  tickUntil(s, () => o.status === 'done', 900);
  assert.deepEqual(
    s.workers.map((w) => w.role),
    ['builder', 'builder', 'operator', 'operator', 'engineer'],
  );
  assert.deepEqual(
    s.workers.map((w) => w.wage),
    [28, 28, 36, 36, 42],
  );
  assert.deepEqual(
    s.workers.map((w) => w.name),
    ['Worker #1', 'Worker #2', 'Worker #3', 'Worker #4', 'Worker #5'],
  );
  assert.equal(s.orders.length, 1);
  assert.equal(s.costs.filter((c) => c.entity === o.id).length, 1);
  assert.ok(s.workers.every((w) => !w.transportOrder && (w.y || 0) === 0));
});

test('batch preview packs freight by payload and physical deck length and crew by seats', () => {
  const s = S.createState();
  for (const mode of ['road', 'rail'] as const) {
    const lines = [
      { item: 'slab', qty: 100 },
      { item: 'rail', qty: 9 },
      { item: 'office', qty: 3 },
      { item: 'diesel', qty: 15 },
    ];
    const loads = S.planPurchaseBatch(lines, mode);
    const ids = S.purchaseBatch(s, lines, mode);
    assert.equal(ids.length, loads.length);
    for (const id of ids) {
      const o = s.orders.find((o) => o.id === id)!;
      assert.ok(orderMass(o) <= FREIGHT_CAPACITY[mode]);
      assert.ok(orderDeckLength(orderLines(o)) <= FREIGHT_DECK_LENGTH[mode]);
    }
  }
  const loads = S.planPurchaseBatch(
    [
      { item: 'builder', qty: 10 },
      { item: 'operator', qty: 8 },
      { item: 'forklift', qty: 2 },
      { item: 'power', qty: 1 },
    ],
    'rail',
  );
  assert.equal(loads.filter((l) => l.manifest[0].item in { builder: 1, operator: 1 }).length, 2);
  assert.deepEqual(
    loads.slice(0, 2).map((l) => l.manifest.reduce((n, line) => n + line.qty, 0)),
    [12, 6],
  );
  assert.equal(loads.filter((l) => l.manifest[0].item === 'forklift').length, 2);
  assert.equal(loads.filter((l) => l.manifest[0].item === 'power').length, 1);
});

test('batch request rejects every invalid line before allocating any order IDs', () => {
  const s = S.createState();
  const before = S.save(s);
  assert.throws(
    () =>
      S.purchaseBatch(s, [
        { item: 'slab', qty: 12 },
        { item: 'unknown', qty: 1 },
      ]),
    /Unknown/,
  );
  assert.equal(S.save(s), before);
  assert.throws(() => S.purchaseBatch(s, [{ item: 'builder', qty: 1.5 }]), /whole quantity/);
  assert.equal(S.save(s), before);
  assert.throws(() => S.purchaseBatch(s, [{ item: 'toString', qty: 1 }]), /Unknown/);
  assert.throws(() => S.purchaseBatch(s, [{ item: '__proto__', qty: 1 }]), /Unknown/);
  assert.throws(
    () =>
      S.purchaseBatch(s, [
        { item: 'slab', qty: 600 },
        { item: 'slab', qty: 600 },
      ]),
    /1,000/,
  );
  assert.equal(S.save(s), before);
});

test('manifest validation rejects tampered totals, mixed categories, payload and unloading ownership', () => {
  const s = S.createState();
  S.purchaseBatch(s, [
    { item: 'slab', qty: 12 },
    { item: 'diesel', qty: 1 },
  ]);
  const tamper = (fn: (copy: typeof s) => void) => {
    const copy = JSON.parse(S.save(s));
    fn(copy);
    assert.throws(() => S.load(JSON.stringify(copy)), /Invalid save/);
  };
  tamper((copy) => {
    copy.orders[0].manifest![1].arrived = 1;
  });
  tamper((copy) => {
    copy.orders[0].manifest![1].item = 'builder';
  });
  tamper((copy) => {
    copy.orders[0].manifest![0].qty = 100;
    copy.orders[0].qty = 101;
  });
  tamper((copy) => {
    copy.orders[0].manifest![1].arrived = 1;
    copy.orders[0].arrived = 1;
  });
  assert.deepEqual(S.load(S.save(s)).orders[0].manifest, s.orders[0].manifest);
});
