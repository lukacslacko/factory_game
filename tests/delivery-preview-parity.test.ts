import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { previewUnloading } from '../src/delivery';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { State } from '../src/types';

function arrivedSlab(qty = 1) {
  const s = S.createState();
  assert.equal(S.addZone(s, { x: 24, z: 47, w: 3, d: 3 }), '');
  const [orderId] = S.purchase(s, 'slab', qty);
  tickUntil(s, () => s.orders.find((o) => o.id === orderId)?.status === 'unloading');
  return { s, orderId };
}
const inspect = (s: State, orderId: string, workerId?: string) =>
  previewUnloading(s, orderId, workerId ? { workerId } : {},
    { obstacles: S.obstacles });

test('unloading preflight is read only and dispatch commits the same next-lift plan', () => {
  const { s, orderId } = arrivedSlab();
  seedHandlingResources(s, 'forklift');
  const operator = s.workers.find((w) => w.role === 'operator')!;
  const before = S.save(s);
  const plan = inspect(s, orderId, operator.id);
  assert.equal(plan.readiness, 'ready');
  assert.equal(plan.feasible, true);
  assert.equal(S.save(s), before, 'Neither the order nor maneuver leases change on preview');
  assert.equal(S.unloadDelivery(s, orderId, operator.id), '');
  const task = s.orders.find((o) => o.id === orderId)!.unload!;
  assert.equal(task.equipmentId, plan.equipmentId);
  assert.equal(task.operatorId, plan.operatorId);
  assert.equal(task.qty, plan.quantity);
  assert.deepEqual(task.destination, plan.destination);
  assert.deepEqual(task.drop, plan.drop);
  assert.equal(inspect(s, orderId).readiness, 'unverified',
    'A committed lift may be blocked later; do not promise present route readiness');
});

test('batched slab preflight uses the actual machine-capacity lift quantity', () => {
  const { s, orderId } = arrivedSlab(8);
  seedHandlingResources(s, 'forklift');
  const operator = s.workers.find((w) => w.role === 'operator')!;
  const plan = inspect(s, orderId, operator.id);
  assert.equal(plan.feasible, true);
  assert.ok((plan.quantity || 0) > 1);
  assert.equal(S.unloadDelivery(s, orderId, operator.id), '');
  assert.equal(s.orders.find((o) => o.id === orderId)!.unload!.qty, plan.quantity);
});

test('a failed loaded final approach is reported before dispatch, while an alternate dock is accepted', () => {
  const { s, orderId } = arrivedSlab();
  seedHandlingResources(s, 'forklift');
  const operator = s.workers.find((w) => w.role === 'operator')!;
  const base = inspect(s, orderId, operator.id);
  assert.equal(base.feasible, true);
  assert.deepEqual(base.drop, { x: 24.5, z: 46.5 });

  s.buildings.push({ id: 'BLD-SOUTH', kind: 'office', name: 'South wall',
    x: 24, z: 46, w: 1, d: 1, rotation: 0, connected: false });
  const alternate = inspect(s, orderId, operator.id);
  assert.equal(alternate.feasible, true);
  assert.deepEqual(alternate.drop, { x: 24.5, z: 52.5 });
  assert.equal(S.unloadDelivery(s, orderId, operator.id), '');
  assert.deepEqual(s.orders.find((o) => o.id === orderId)!.unload!.drop, alternate.drop);

  const { s: blocked, orderId: blockedId } = arrivedSlab();
  seedHandlingResources(blocked, 'forklift');
  const blockedOperator = blocked.workers.find((w) => w.role === 'operator')!;
  for (const [i, rect] of [
    { x: 23, z: 52, w: 4, d: 3 },
    { x: 25, z: 43, w: 3, d: 1 },
    { x: 26, z: 45, w: 4, d: 1 },
  ].entries()) blocked.buildings.push({ id: `BLD-BLOCK-${i}`,
    kind: 'office', name: 'Wall', rotation: 0, connected: false, ...rect });
  const before = S.save(blocked);
  const plan = inspect(blocked, blockedId, blockedOperator.id);
  assert.equal(plan.feasible, false);
  assert.equal(plan.readiness, 'blocked');
  assert.match(plan.reason, /loaded route.*final turn/i);
  assert.equal(S.save(blocked), before);
  assert.match(S.unloadDelivery(blocked, blockedId, blockedOperator.id), /loaded route.*final turn/i);
  assert.equal(blocked.orders.find((o) => o.id === blockedId)!.unload, undefined);
});

test('without an available machine and crew, physical route readiness stays unverified', () => {
  const { s, orderId } = arrivedSlab();
  const before = S.save(s);
  const plan = inspect(s, orderId);
  assert.equal(plan.feasible, false);
  assert.equal(plan.readiness, 'unverified');
  assert.match(plan.reason, /operator/i);
  assert.equal(S.save(s), before);
});
