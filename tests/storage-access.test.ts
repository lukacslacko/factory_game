import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { createStorageAccessCheck, storageMergePreservesAccess } from '../src/storage-access.ts';
import { storageMoveDestinationError } from '../src/storage-move-destination.ts';
import type { Job, Stack } from '../src/types.ts';

function narrowBay(withSource = true) {
  const s = S.createState();
  s.zones = [{ id: 'BAY', name: 'Narrow bay', x: 33, z: 32, w: 25, d: 25 }];
  if (withSource) s.stacks.push({ id: 'STACK-A', item: 'slab', x: 40, z: 40,
    w: 1, d: 1, qty: 12, reserved: 0, source: 'opening' });
  for (const [id, x, z, w, d] of [
    ['NORTH', 35, 32, 12, 7],
    ['WEST', 33, 39, 6, 8],
    ['EAST', 42, 39, 8, 8],
  ] as const)
    s.buildings.push({ id, kind: 'office', x, z, w, d,
      rotation: 0, connected: false, name: id });
  return s;
}

test('ordinary storage keeps a future retrieval aisle instead of sealing the only face', () => {
  const trapped = narrowBay();
  const empty = narrowBay(false);
  const mouth = { x: 40, z: 42, w: 1, d: 1 };
  assert.equal(createStorageAccessCheck(empty)('slab', mouth, 0, 12), true,
    'The candidate itself remains retrievable');
  assert.equal(createStorageAccessCheck(trapped)('slab', mouth, 0, 12), false,
    'The placement may not strand the older stack');
  assert.equal(createStorageAccessCheck(trapped)('slab',
    { x: 52, z: 50, w: 1, d: 1 }, 0, 12), true);
});

test('ordinary access includes earlier projected parcels and finite stack layers', () => {
  const s = narrowBay();
  const first: Stack = { id: 'FUTURE-SLAB', item: 'slab', x: 40, z: 41,
    w: 1, d: 1, qty: 12, reserved: 0, source: 'preview' };
  assert.equal(createStorageAccessCheck(s)('slab', first, 0, 12), true);
  assert.equal(createStorageAccessCheck(s, [first])('slab',
    { x: 40, z: 42, w: 1, d: 1 }, 0, 12), false);
  assert.equal(createStorageAccessCheck(s)('slab',
    { x: 52, z: 50, w: 1, d: 1 }, 0, 13), false,
    'The preview cannot promise a thirteenth slab on a 12-layer stack');
});

test('top-up merge checks the next physical layer without consuming another bay', () => {
  const s = S.createState();
  s.zones = [{ id: 'Y', name: 'Y', x: 30, z: 30, w: 30, d: 30 }];
  const stack: Stack = { id: 'PARTIAL', item: 'slab', x: 40, z: 40,
    w: 1, d: 1, qty: 11, reserved: 0, source: 'opening' };
  s.stacks.push(stack);
  assert.equal(storageMergePreservesAccess(s, stack, 1), true);
  assert.equal(storageMergePreservesAccess(s, stack, 2), false);
});

test('a storage landing can touch a neighboring grid-aligned slab without false overlap', () => {
  const s = S.createState();
  s.zones = [{ id: 'Y', name: 'Y', x: 45, z: 40, w: 30, d: 30 }];
  s.stacks.push({ id: 'NEIGHBOR', item: 'slab', x: 50, z: 53,
    w: 1, d: 1, qty: 3, reserved: 0, source: 'opening' });
  const job = { item: 'rail', qty: 1, stockMove: { toStorage: true,
    zoneId: 'Y', destination: { x: 50, z: 50, w: 5, d: 3 },
    sourceId: 'SOURCE', yaw: 0 } } as Job;
  assert.equal(storageMoveDestinationError(s, job), '');
  s.stacks[0].z = 52.9;
  assert.match(storageMoveDestinationError(s, job), /NEIGHBOR/);
});

test('temporary rail preparation footprint remains reserved until that panel is placed', () => {
  const s = S.createState();
  s.zones = [{ id: 'Y', name: 'Y', x: 40, z: 40, w: 30, d: 25 }];
  const stage = { x: 50, z: 50, w: 5, d: 3 };
  const job = { id: 'RAIL-JOB', kind: 'rail', item: 'rail',
    status: 'todo', railWork: { stage, panel: { state: 'stored' } } } as unknown as Job;
  s.jobs.push(job);
  const candidate = { x: 51, z: 51, w: 1, d: 1 };
  assert.equal(createStorageAccessCheck(s)('slab', candidate), false);
  job.railWork!.panel.state = 'placed';
  assert.equal(createStorageAccessCheck(s)('slab', candidate), true);
});
