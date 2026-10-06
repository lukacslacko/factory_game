import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { EQUIPMENT, MATERIALS } from '../src/catalog';
import { shipmentLots, stackHeight, parcelPitch } from '../src/delivery';
import {
  FREIGHT_CAPACITY,
  FREIGHT_DECK_LENGTH,
  orderDeckLength,
  packPurchase,
} from '../src/procurement';
import { requestRailUnloading } from '../src/rail-freight';
import { seedHandlingResources, tickUntil, advance } from './support/yard';
import type { Item } from '../src/types';

const items: Item[] = ['rail', 'railCurve', 'railPoints', 'railFrog', 'railClosure', 'railExit'];

test('eight complete switch sets fit one three-car train in bounded, separated stacks', () => {
  const s = S.createState();
  S.purchaseBatch(
    s,
    [
      { item: 'railPoints', qty: 8 },
      { item: 'railFrog', qty: 8 },
      { item: 'railClosure', qty: 8 },
      { item: 'railExit', qty: 8 },
      { item: 'rail', qty: 24 },
    ],
    'rail',
  );
  const o = s.orders[0];
  assert.equal(s.orders.length, 1);
  assert.equal(o.railFreight!.cars.length, 3);
  assert.equal(o.qty, 56);
  for (const car of o.railFreight!.cars) {
    assert.ok(car.mass <= FREIGHT_CAPACITY.rail);
    assert.ok(car.deckLength <= FREIGHT_DECK_LENGTH.rail);
    const lots = shipmentLots(o).filter((l) => l.carId === car.id);
    for (const [index, lot] of lots.entries()) {
      assert.ok(lot.qty <= 8);
      assert.ok(stackHeight(lot.item, lot.qty) < 3);
      assert.ok(Math.abs(lot.x) + MATERIALS[lot.item].w / 2 <= 8);
      if (index)
        assert.ok(
          lots[index - 1].x + MATERIALS[lots[index - 1].item].w / 2 <=
            lot.x - MATERIALS[lot.item].w / 2,
        );
    }
  }
  assert.deepEqual(S.load(S.save(s)).orders, JSON.parse(S.save(s)).orders);
});

for (const item of items) {
  test(`${item} road stacks respect both payload and height, including a partially filled last truck`, () => {
    const loads = packPurchase([{ item, qty: 17 }], 'road');
    assert.equal(
      loads.reduce((n, load) => n + load.manifest[0].qty, 0),
      17,
    );
    for (const load of loads) {
      assert.ok(load.manifest[0].qty <= 8);
      assert.ok(load.manifest[0].qty * MATERIALS[item].mass <= FREIGHT_CAPACITY.road);
      assert.ok(orderDeckLength(load.manifest) <= FREIGHT_DECK_LENGTH.road);
      assert.ok(stackHeight(item, load.manifest[0].qty) + 1.15 <= 4);
    }
    assert.ok(loads.at(-1)!.manifest[0].qty < loads[0].manifest[0].qty);
  });

  for (const mode of ['road', 'rail'] as const) {
    test(`${mode} ${item} physically stacks eight in one storage footprint through save/reload`, () => {
      let s = S.createState();
      const m = MATERIALS[item];
      assert.equal(S.addZone(s, { x: 40, z: 30, w: m.w, d: m.d }), '');
      seedHandlingResources(s, mode === 'road' ? 'forklift' : 'excavator');
      const ids = S.purchase(s, item, 8, mode);
      if (mode === 'rail') {
        assert.equal(ids.length, 1);
        const o = s.orders[0];
        assert.deepEqual(
          shipmentLots(o).map((l) => l.qty),
          [8],
        );
        tickUntil(s, () => o.status === 'unloading', 900);
        assert.equal(requestRailUnloading(s, o.id), undefined);
      }
      let heights = new Set<number>();
      const watch = () => {
        const t = S.totals(s, item);
        assert.equal(t.delivered, t.stored + t.cargo, JSON.stringify(t));
        for (const e of s.equipment)
          if (e.cargo)
            assert.ok(e.cargo.qty * MATERIALS[e.cargo.item].mass <= EQUIPMENT[e.kind].capacity);
        for (const o of s.orders) {
          if (!o.unload) continue;
          assert.equal(o.unload.item, item);
          assert.ok(o.unload.qty * m.mass <= EQUIPMENT[s.equipment[0].kind].capacity);
          heights.add(o.unload.sourceY);
        }
        const occupied = s.stacks.filter((t) => t.qty > 0);
        assert.ok(
          occupied.length <= 1,
          'Use existing vertical capacity before another ground slot',
        );
        for (const t of occupied) assert.ok(t.qty <= m.max);
      };
      tickUntil(s, () => s.equipment.some((e) => !!e.cargo), 1200, watch);
      s = S.load(S.save(s));
      tickUntil(s, () => s.orders.every((o) => o.status === 'done'), 1800, watch);
      const stacks = s.stacks.filter((t) => t.item === item && t.qty > 0);
      assert.equal(stacks.length, 1);
      assert.equal(stacks[0].qty, 8);
      assert.equal(stacks[0].w * stacks[0].d, m.w * m.d);
      assert.equal(stacks[0].reserved, 0);
      assert.ok(Math.abs(stackHeight(item, 8) - 2.845) < 1e-8);
      assert.ok(heights.size > 1, 'Pick successively lower layers rather than the same deck pose');
      assert.deepEqual(S.load(S.save(s)).stacks, s.stacks);
    });
  }
}

test('a full switch stack stays bounded and remaining cargo waits until another physical slot exists', () => {
  const s = S.createState();
  assert.equal(S.addZone(s, { x: 40, z: 30, w: 6, d: 3 }), '');
  seedHandlingResources(s, 'forklift');
  S.purchase(s, 'railFrog', 9, 'rail');
  const o = s.orders[0];
  tickUntil(s, () => o.status === 'unloading', 900);
  assert.equal(requestRailUnloading(s, o.id), undefined);
  tickUntil(s, () => S.totals(s, 'railFrog').stored === 8, 1800);
  advance(s, 15);
  assert.equal(o.arrived, 8);
  assert.equal(
    shipmentLots(o).reduce((n, l) => n + l.qty, 0),
    1,
  );
  assert.match(o.note, /storage|capacity/i);
  assert.equal(S.addZone(s, { x: 53, z: 30, w: 6, d: 3 }), '');
  tickUntil(s, () => o.status === 'done', 1200);
  assert.deepEqual(
    s.stacks
      .filter((t) => t.item === 'railFrog')
      .map((t) => t.qty)
      .sort((a, b) => b - a),
    [8, 1],
  );
});

test('old road and train lots retain their original deck positions and current lift after import', () => {
  for (const mode of ['road', 'rail'] as const) {
    const s = S.createState();
    S.purchase(s, 'railPoints', mode === 'rail' ? 2 : 1, mode);
    const o = s.orders[0];
    delete o.stackLimits;
    if (o.railFreight) o.railFreight.cars[0].deckLength = 12;
    const before = shipmentLots(o);
    assert.deepEqual(
      before.map((l) => l.original),
      mode === 'rail' ? [1, 1] : [1],
    );
    const copy = S.load(S.save(s));
    assert.deepEqual(shipmentLots(copy.orders[0]), before);
    if (mode === 'rail') {
      o.arrived = o.manifest![0].arrived = o.railFreight!.cars[0].manifest[0].arrived = 1;
      const partiallyUnloaded = shipmentLots(o);
      assert.deepEqual(
        partiallyUnloaded.map((l) => l.qty),
        [0, 1],
      );
      assert.deepEqual(
        S.load(S.save(s)).orders[0].railFreight,
        JSON.parse(JSON.stringify(o.railFreight)),
      );
      assert.deepEqual(shipmentLots(S.load(S.save(s)).orders[0]), partiallyUnloaded);
    }
  }
  const s = S.createState();
  seedHandlingResources(s, 'forklift');
  S.addZone(s, { x: 40, z: 30, w: 6, d: 3 });
  S.purchase(s, 'railCurve', 8, 'rail');
  const o = s.orders[0];
  delete o.stackLimits;
  o.railFreight!.cars[0].deckLength = 12;
  tickUntil(s, () => o.status === 'unloading', 900);
  requestRailUnloading(s, o.id);
  tickUntil(s, () => !!o.unload && !!s.equipment[0].cargo, 1200);
  const task = JSON.parse(JSON.stringify(o.unload));
  const lots = shipmentLots(o);
  const restored = S.load(S.save(s));
  assert.deepEqual(restored.orders[0].unload, task);
  assert.deepEqual(shipmentLots(restored.orders[0]), lots);
  tickUntil(restored, () => restored.orders[0].status === 'done', 1800);
  assert.equal(restored.stacks.find((t) => t.item === 'railCurve')!.qty, 8);
});

test('save validation rejects excessive stock or invalid freight parcel limits', () => {
  const s = S.createState();
  S.purchase(s, 'railPoints', 8, 'rail');
  for (const limit of [0, -1, 9, 1.5, '8', null]) {
    const copy = JSON.parse(S.save(s));
    copy.orders[0].stackLimits.railPoints = limit;
    assert.throws(() => S.load(JSON.stringify(copy)), /Invalid save.*freight stack limits/);
  }
  for (const invalid of [{}, [], { railPoints: 8, unknown: 1 }]) {
    const copy = JSON.parse(S.save(s));
    copy.orders[0].stackLimits = invalid;
    assert.throws(() => S.load(JSON.stringify(copy)), /Invalid save.*freight stack limits/);
  }
  for (const item of items) {
    const copy = structuredClone(s);
    copy.stacks.push({
      id: S.id(copy, 'stack'),
      item,
      qty: 9,
      reserved: 0,
      x: 40,
      z: 30,
      w: MATERIALS[item].w,
      d: MATERIALS[item].d,
      source: 'opening',
    });
    assert.throws(() => S.load(S.save(copy)), /Invalid save/);
    assert.equal(parcelPitch(item), 0.36);
  }
});
