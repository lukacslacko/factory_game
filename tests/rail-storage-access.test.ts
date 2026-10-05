import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import {
  createRailStorageAccessCheck,
  railStoragePlacementPreservesAccess,
} from '../src/delivery.ts';
import { staticRailPickupFaces } from '../src/rail-pickup.ts';
import { staticObstacleRects } from '../src/traffic.ts';
import { MATERIALS } from '../src/catalog.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';
import type { Stack } from '../src/types.ts';

function oneFaceYard() {
  const s = S.createState();
  const stack: Stack = {
    id: 'RAIL-STOCK',
    item: 'railCurve',
    x: 40,
    z: 40,
    w: 6,
    d: 3,
    qty: 4,
    reserved: 0,
    source: 'opening',
  };
  s.stacks.push(stack);
  for (const [id, x, z, w, d] of [
    ['NORTH', 32, 31, 24, 7],
    ['WEST', 32, 38, 7, 15],
    ['EAST', 47, 38, 8, 15],
  ] as const)
    s.buildings.push({ id, kind: 'office', x, z, w, d, rotation: 0, connected: false, name: id });
  return { s, stack };
}

test('storage cannot close the last exposed rail lifting face with neighboring material', () => {
  const { s, stack } = oneFaceYard();
  assert.equal(staticRailPickupFaces(s, stack, 'excavator', staticObstacleRects(s)).length, 1);
  const check = createRailStorageAccessCheck(s);
  assert.equal(check('slab', { x: 42, z: 46, w: 1, d: 1 }), false);
  assert.equal(check('diesel', { x: 42, z: 46, w: 1, d: 1 }), false);
  assert.equal(check('slab', { x: 65, z: 46, w: 1, d: 1 }), true);
  assert.equal(check('slab', { x: 45, z: 53, w: 1, d: 1 }), true);
});

test('new rail stock needs a real chassis face and exposed rigging edge', () => {
  const { s, stack } = oneFaceYard();
  s.stacks = [];
  s.buildings.push({
    id: 'SOUTH',
    kind: 'office',
    x: 39,
    z: 44,
    w: 8,
    d: 9,
    rotation: 0,
    connected: false,
    name: 'South wall',
  });
  assert.equal(railStoragePlacementPreservesAccess(s, stack.item, stack), false);
  assert.equal(
    railStoragePlacementPreservesAccess(s, 'railCurve', { x: 65, z: 40, w: 6, d: 3 }),
    true,
  );
});

test('incoming reserved rail rectangles retain their last pickup face before setdown', () => {
  const { s, stack } = oneFaceYard();
  s.stacks = [];
  const [oid] = S.purchase(s, 'railCurve', 4);
  const order = s.orders.find((o) => o.id === oid)!;
  order.allocated = { x: stack.x, z: stack.z, w: stack.w, d: stack.d };
  assert.equal(railStoragePlacementPreservesAccess(s, 'slab', { x: 42, z: 46, w: 1, d: 1 }), false);
  assert.equal(railStoragePlacementPreservesAccess(s, 'slab', { x: 65, z: 46, w: 1, d: 1 }), true);
});

test('pending nonrail drops count as solids for a newly arriving rail panel', () => {
  const { s, stack } = oneFaceYard();
  s.stacks = [];
  const [oid] = S.purchase(s, 'slab', 12);
  s.orders.find((o) => o.id === oid)!.allocated = { x: 42, z: 46, w: 1, d: 1 };
  assert.equal(railStoragePlacementPreservesAccess(s, 'railCurve', stack), false);
});

test('queued and active rail relocation destinations reserve their future pickup face', () => {
  const { s, stack } = oneFaceYard();
  const destination = { x: stack.x, z: stack.z, w: stack.w, d: stack.d };
  stack.x = 65;
  s.zones = [{ id: 'ZONE-MOVE', name: 'Relocated rails', ...destination }];
  const result = S.moveRailStock(s, stack.id, destination);
  assert.equal(result.error, '');
  const job = result.job!;
  for (const status of ['todo', 'doing'] as const) {
    job.status = status;
    assert.equal(
      railStoragePlacementPreservesAccess(s, 'slab', { x: 42, z: 46, w: 1, d: 1 }),
      false,
    );
  }
  job.status = 'canceled';
  assert.equal(railStoragePlacementPreservesAccess(s, 'slab', { x: 42, z: 46, w: 1, d: 1 }), true);
});

test('rotated relocation footprints preserve their actual rail orientation', () => {
  const s = S.createState();
  const stack: Stack = {
    id: 'ROTATED',
    item: 'railCurve',
    x: 40,
    z: 40,
    w: 3,
    d: 6,
    yaw: Math.PI / 2,
    qty: 1,
    reserved: 0,
    source: 'opening',
  };
  for (const [id, x, z, w, d] of [
    ['WEST', 31, 32, 7, 24],
    ['NORTH', 38, 32, 15, 7],
    ['SOUTH', 38, 47, 15, 8],
  ] as const)
    s.buildings.push({ id, kind: 'office', x, z, w, d, rotation: 0, connected: false, name: id });
  assert.equal(railStoragePlacementPreservesAccess(s, stack.item, stack), true);
  assert.equal(railStoragePlacementPreservesAccess(s, stack.item, stack, stack.yaw), true);
  s.jobs.push({
    ...stack,
    id: 'MOVE-ROTATED',
    kind: 'moveStock',
    rotation: 1,
    status: 'todo',
    phase: 'Queued',
    reason: '',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: s.time,
    stockMove: { sourceId: 'ROTATED', destination: stack, yaw: stack.yaw! },
  });
  assert.equal(railStoragePlacementPreservesAccess(s, 'slab', { x: 46, z: 42, w: 1, d: 1 }), false);
});

test('delivery selects another storage cell instead of sealing a rail pickup face', () => {
  const { s, stack } = oneFaceYard();
  seedHandlingResources(s);
  s.zones = [
    { id: 'ZONE-BLOCK', name: 'Would block rail handling', x: 42, z: 46, w: 1, d: 1 },
    { id: 'ZONE-CLEAR', name: 'Clear unloading', x: 65, z: 46, w: 1, d: 1 },
  ];
  const [oid] = S.purchase(s, 'slab', 12);
  const order = s.orders.find((o) => o.id === oid)!;
  tickUntil(s, () => !!order.unload, 300);
  assert.deepEqual(order.unload!.destination, { x: 65, z: 46, w: 1, d: 1 });
  assert.equal(staticRailPickupFaces(s, stack, 'excavator', staticObstacleRects(s)).length, 1);
});

test('slab-only stockyards keep full dense capacity and maximum stack height', () => {
  const s = S.createState();
  seedHandlingResources(s);
  s.zones = [{ id: 'ZONE-DENSE', name: 'Dense slabs', x: 25, z: 30, w: 3, d: 1 }];
  S.purchase(s, 'slab', MATERIALS.slab.max * 3);
  tickUntil(s, () => s.orders.every((o) => o.status === 'done'), 2400);
  const stacks = s.stacks.filter((t) => t.item === 'slab' && t.qty > 0);
  assert.equal(stacks.length, 3);
  assert.equal(
    stacks.reduce((n, t) => n + t.qty, 0),
    MATERIALS.slab.max * 3,
  );
  assert.ok(stacks.every((t) => t.qty === MATERIALS.slab.max));
});

test('incoming parcels and allocator cannot occupy a queued relocation footprint', () => {
  const s = S.createState();
  seedHandlingResources(s);
  s.zones = [
    { id: 'ZONE-DEST', name: 'Future rail stack', x: 40, z: 30, w: 5, d: 3 },
    { id: 'ZONE-OPEN', name: 'Free slab cell', x: 65, z: 40, w: 1, d: 1 },
  ];
  const t: Stack = {
    id: S.id(s, 'stack'),
    item: 'rail',
    x: 30,
    z: 29,
    w: 5,
    d: 3,
    qty: 2,
    reserved: 0,
    source: 'opening',
  };
  s.stacks.push(t);
  const { job, error } = S.moveRailStock(s, t.id, { x: 40, z: 30, w: 5, d: 3 });
  assert.equal(error, '');
  assert.equal(railStoragePlacementPreservesAccess(s, 'slab', { x: 42, z: 31, w: 1, d: 1 }), false);
  assert.deepEqual(S.allocate(s, 'slab'), { x: 65, z: 40, w: 1, d: 1 });
  const [oid] = S.purchase(s, 'slab', 12),
    o = s.orders.find((o) => o.id === oid)!;
  tickUntil(s, () => !!o.unload, 300);
  assert.deepEqual(o.unload!.destination, { x: 65, z: 40, w: 1, d: 1 });
  S.cancelJob(s, job!.id);
  assert.equal(railStoragePlacementPreservesAccess(s, 'slab', { x: 42, z: 31, w: 1, d: 1 }), true);
});
