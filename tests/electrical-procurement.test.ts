import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { electricalConsumerPower } from '../src/electrical-network';

/** Complete public-API bootstrap: no seeded equipment, crew, cable, or station. */
test('an empty yard receives its station, crew and reels before physically wiring a built light', () => {
  let s = S.createState();
  assert.equal(S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }), '');
  S.purchaseBatch(s, [
    { item: 'operator', qty: 1 },
    { item: 'builder', qty: 1 },
    { item: 'engineer', qty: 1 },
  ]);
  S.purchase(s, 'excavator', 1);
  S.purchaseBatch(s, [
    { item: 'cableReel', qty: 2 },
    { item: 'lamp', qty: 1 },
    { item: 'slab', qty: 1 },
    { item: 'diesel', qty: 1 },
  ]);
  S.purchase(s, 'power', 1);
  assert.equal(S.plan(s, 'lamp', 10, 22).error, '');
  function until(done: () => boolean, seconds = 4000) {
    for (let n = 0; n < seconds * 10 && !done(); n++) S.tick(s, 0.1);
    assert.ok(
      done(),
      JSON.stringify({
        jobs: s.jobs
          .filter((j) => j.status !== 'done')
          .map((j) => ({ id: j.id, phase: j.phase, reason: j.reason })),
        orders: s.orders
          .filter((o) => o.status !== 'done')
          .map((o) => ({ id: o.id, status: o.status, note: o.note })),
        electrical: s.electrical,
      }),
    );
  }
  until(
    () => s.orders.every((o) => o.status === 'done') && s.buildings.some((b) => b.kind === 'lamp'),
  );
  assert.equal(s.workers.length, 3);
  assert.equal(s.equipment.length, 1);
  const source = s.buildings.find((b) => b.kind === 'power')!,
    target = s.buildings.find((b) => b.kind === 'lamp')!;
  assert.ok(source && !target.connected);
  assert.equal(s.stacks.filter((t) => t.item === 'cableReel').length, 2);
  const cells = [
    ...Array.from({ length: 7 }, (_, i) => ({ x: 3, z: 16 + i })),
    ...Array.from({ length: 6 }, (_, i) => ({ x: 4 + i, z: 22 })),
  ];
  assert.equal(
    S.planElectrical(s, { sourceId: source.id, targetId: target.id, cells }).error,
    undefined,
  );
  s = S.load(S.save(s));
  until(() => s.electrical!.runs[0].status === 'commissioned');
  assert.equal(electricalConsumerPower(s, target.id).powered, true);
  assert.equal(
    s.stacks.filter((t) => t.item === 'cableReel').reduce((n, t) => n + (t.cableMeters || 0), 0),
    87,
  );
  assert.equal(s.electrical!.runs[0].cells.filter((c) => c.cableInstalled).length, 13);
  assert.equal(S.totals(s, 'cableReel').delivered, 2);
  assert.equal(S.totals(s, 'cableReel').stored, 2);
  assert.ok(s.costs.some((c) => c.category === 'Purchases'));
  assert.ok(S.load(S.save(s)).buildings.find((b) => b.id === target.id)?.connected);
});
