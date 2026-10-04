import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { overlap } from '../src/path.ts';
import { tickUntil } from './support/yard.ts';

function yardWithReservedWithdrawal() {
  const s = S.demoState();
  const crane = s.equipment.find((e) => e.kind === 'excavator')!;
  const forklift = s.equipment.find((e) => e.kind === 'forklift')!;
  S.setEquipmentRole(s, crane.id, 'paving');
  S.setEquipmentRole(s, forklift.id, 'receiving');
  const job = S.plan(s, 'slab', 50, 45).job!;
  tickUntil(s, () => !!job.handling);
  const h = job.handling!;
  const direction = {
    x: h.sourceClear.x - h.sourceDock.x,
    z: h.sourceClear.z - h.sourceDock.z,
  };
  // Prioritize an otherwise empty 3×3 stockyard around the future withdrawal
  // pose. The machine has not reached it, so current-position checks alone
  // cannot keep this maneuver clear.
  const lane = {
    x: Math.floor(h.sourceClear.x) - 1,
    z: Math.floor(h.sourceClear.z) - 1,
    w: 3,
    d: 3,
  };
  assert.ok(Math.hypot(direction.x, direction.z) > 1);
  assert.equal(S.addZone(s, lane, 'Incoming stock beside active crane'), '');
  s.zones.unshift(s.zones.pop()!);
  assert.ok(!overlap({ x: crane.x - 1.2, z: crane.z - 1.2, w: 2.4, d: 2.4 }, lane));
  return { s, crane, job, lane };
}

test('storage allocation keeps a slab job’s future straight withdrawal lane empty', () => {
  const { s, lane } = yardWithReservedWithdrawal();
  const space = S.allocate(s, 'slab');
  assert.ok(space, 'Other free storage remains available');
  assert.ok(
    !overlap(space, lane),
    'Storage must not consume an active withdrawal corridor before the machine arrives',
  );
});

test('an incoming truck reserves cargo outside another machine’s active slab withdrawal lane', () => {
  const { s, crane, job, lane } = yardWithReservedWithdrawal();
  // A real fuel stop leaves this job and its maneuver reservation active while
  // the dedicated receiving forklift handles the next truck.
  crane.fuel = 0;
  const [orderId] = S.purchase(s, 'slab', 8);
  const order = s.orders.find((o) => o.id === orderId)!;
  tickUntil(s, () => !!order.unload, 600);
  assert.equal(job.status, 'doing');
  assert.equal(job.handling!.phase, 'approach');
  assert.ok(
    !overlap(order.unload!.destination, lane),
    'The incoming load would trap the crane when it backs away from its source',
  );
  assert.equal(order.unload!.equipmentId, s.equipment.find((e) => e.kind === 'forklift')!.id);
  assert.equal(order.arrived, 0, 'Reserving storage must not unload the cargo early');
});

test('a slab pickup cannot share the top layer with an incoming reserved top-up', () => {
  const s = S.demoState();
  const crane = s.equipment.find((e) => e.kind === 'excavator')!;
  const forklift = s.equipment.find((e) => e.kind === 'forklift')!;
  S.setEquipmentRole(s, crane.id, 'paving');
  S.setEquipmentRole(s, forklift.id, 'receiving');
  const source = s.stacks.find((t) => t.item === 'slab')!;
  // Opening inventory has four fewer slabs, leaving an actual partial stack.
  source.qty -= 4;
  const openingOrder = s.orders.find((o) => o.id === source.source)!;
  openingOrder.qty -= 4;
  openingOrder.arrived -= 4;
  const [id] = S.purchase(s, 'slab', 4);
  const delivery = s.orders.find((o) => o.id === id)!;
  tickUntil(s, () => delivery.unload?.phase === 'carry');
  assert.equal(delivery.unload!.mergeId, source.id);
  const job = S.plan(s, 'slab', 50, 45).job!;
  tickUntil(
    s,
    () => delivery.status === 'done' && job.status === 'done',
    1800,
    () => {
      const h = job.handling;
      if (delivery.unload?.mergeId === source.id && h?.sourceId === source.id)
        assert.equal(
          h.state,
          'stored',
          'An outgoing slab cannot lift while an incoming batch owns that same top layer',
        );
      const totals = S.totals(s, 'slab');
      assert.equal(totals.delivered, totals.stored + totals.cargo + totals.installed);
    },
  );
  assert.equal(delivery.arrived, 4);
  assert.ok(s.paving['50,45']);
});
