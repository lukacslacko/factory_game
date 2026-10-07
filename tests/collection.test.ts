import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import {
  quoteCollection,
  requestCollection,
  cancelCollection,
  collectionInventory,
  COLLECTION_FEES,
} from '../src/collection';
import type { Collection, CollectionAPI } from '../src/collection';
import type { Stack, State } from '../src/types';
import { seedHandlingResources } from './support/yard';
const api: CollectionAPI = {
  id: S.id,
  event: S.event,
  notice: S.notice,
  cost: S.cost,
  movement: S.movement,
  obstacles: S.obstacles,
};
function yard() {
  const s = S.createState() as State & { collections?: Collection[] };
  const stack: Stack = {
    id: S.id(s, 'stack'),
    item: 'slab',
    x: 30,
    z: 32,
    w: 1,
    d: 1,
    qty: 12,
    reserved: 0,
    source: 'opening',
  };
  s.stacks.push(stack);
  return { s, stack };
}
test('collection quotes real physical material mass, deck capacity, transport and disposal fees', () => {
  const { s, stack } = yard();
  const second = { ...stack, id: S.id(s, 'stack'), x: 34 };
  s.stacks.push(second);
  const quote = quoteCollection(s, {
    lines: [
      { stackId: stack.id, qty: 12 },
      { stackId: second.id, qty: 12 },
    ],
  });
  assert.equal(quote.valid, true);
  assert.equal(quote.massKg, 24 * 280);
  assert.equal(quote.loads.length, 1);
  assert.equal(quote.transportFee, COLLECTION_FEES.truck);
  assert.equal(quote.disposalFee, Math.ceil(24 * 280 * COLLECTION_FEES.materialPerKg));
  assert.equal(quote.total, quote.transportFee + quote.disposalFee);
  assert.equal(stack.reserved, 0, 'A quote does not acquire stock');
  for (let i = 0; i < 3; i++) s.stacks.push({ ...stack, id: S.id(s, 'stack'), x: 38 + i * 4 });
  const split = quoteCollection(s, { lines: s.stacks.map((t) => ({ stackId: t.id, qty: t.qty })) });
  assert.equal(split.valid, true);
  assert.ok(split.loads.length > 1);
  assert.ok(split.loads.every((l) => l.massKg <= 12000));
  assert.equal(
    split.loads.flatMap((l) => l.lines).reduce((n, l) => n + l.qty, 0),
    60,
  );
});
test('collection rejects fuel-bearing drums but quotes an empty drum by its actual tare', () => {
  const { s, stack } = yard();
  Object.assign(stack, { item: 'diesel', qty: 1, liters: 30 });
  assert.match(
    quoteCollection(s, { lines: [{ stackId: stack.id, qty: 1 }] }).error!,
    /contains fuel/,
  );
  stack.liters = 0;
  const quote = quoteCollection(s, { lines: [{ stackId: stack.id, qty: 1 }] });
  assert.equal(quote.valid, true);
  assert.equal(quote.massKg, 20);
});
test('collection request validates the complete selection atomically and reserves exact source units', () => {
  const { s, stack } = yard(),
    before = S.save(s);
  assert.match(
    requestCollection(
      s,
      {
        lines: [
          { stackId: stack.id, qty: 12 },
          { stackId: 'MISSING', qty: 1 },
        ],
      },
      api,
    ).error!,
    /physical stack/,
  );
  assert.equal(S.save(s), before);
  const result = requestCollection(s, { lines: [{ stackId: stack.id, qty: 12 }] }, api);
  assert.equal(result.error, undefined);
  assert.equal(result.ids.length, 1);
  const c = s.collections![0];
  assert.equal(stack.qty, 12);
  assert.equal(stack.reserved, 12);
  assert.equal(
    c.lines.reduce((n, l) => n + l.reserved, 0),
    12,
  );
  assert.equal(s.equipment.length, 0, 'Ordering pickup does not invent unloading equipment');
  assert.equal(s.costs.length, 0, 'Fees are charged only when the actual carrier arrives');
  assert.deepEqual(collectionInventory(s, 'slab'), { outbound: 0, collected: 0 });
  assert.match(quoteCollection(s, { lines: [{ stackId: stack.id, qty: 1 }] }).error!, /reserved/);
});
test('canceling before collection dispatch releases reservations without deleting material or charging fees', () => {
  const { s, stack } = yard();
  const { ids } = requestCollection(s, { lines: [{ stackId: stack.id, qty: 12 }] }, api);
  assert.equal(cancelCollection(s, ids[0], api), undefined);
  assert.equal(stack.reserved, 0);
  assert.equal(stack.qty, 12);
  assert.equal(s.collections![0].status, 'canceled');
  assert.equal(s.orders[0].status, 'done');
  assert.equal(s.costs.length, 0);
  assert.match(cancelCollection(s, ids[0], api)!, /not departed/);
});
test('equipment collection quotes retain sealed tank contents and block active work', () => {
  const { s } = yard(),
    e = seedHandlingResources(s);
  const beforeFuel = e.fuel;
  const quote = quoteCollection(s, { equipmentId: e.id });
  assert.equal(quote.valid, true);
  assert.equal(quote.kind, 'equipment');
  assert.equal(quote.transportFee, COLLECTION_FEES.lowloader);
  assert.ok(quote.massKg > 4500);
  assert.equal(e.fuel, beforeFuel);
  const request = requestCollection(s, { equipmentId: e.id }, api);
  assert.equal(request.ids.length, 1);
  assert.equal(e.deliveryOrder, s.orders[0].id);
  assert.equal(quoteCollection(s, { equipmentId: e.id }).valid, false);
  cancelCollection(s, request.ids[0], api);
  assert.equal(e.deliveryOrder, undefined);
  assert.equal(e.fuel, beforeFuel);
  e.cargo = { item: 'slab', qty: 1 };
  assert.match(quoteCollection(s, { equipmentId: e.id }).error!, /busy/);
});
