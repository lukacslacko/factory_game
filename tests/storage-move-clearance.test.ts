import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/sim';
import {
  equipmentBoxes,
  equipmentMoveBlocked,
  equipmentSweepBlocked,
  machineRoute,
  staticObstacleRects,
  storageMoveStockHeight,
} from '../src/traffic';
import type { Equipment, Job, State } from '../src/types';

function fixture() {
  const s = createState();
  const e: Equipment = {
    id: 'EQ-TEST',
    kind: 'excavator',
    x: 30,
    z: 40,
    yaw: 0,
    heading: 0,
    path: [],
    fuel: 60,
    tank: 80,
    used: 0,
    work: 0,
    reach: 5.5,
    lift: 0.45,
    cargo: { item: 'office', qty: 1, yaw: 0, storageMove: true },
  };
  s.equipment.push(e);
  return { s, e };
}
function job(s: State, e: Equipment, sourceId: string, mergeId: string) {
  const j = {
    id: 'JOB-TEST',
    kind: 'moveStock',
    status: 'doing',
    item: e.cargo!.item,
    qty: e.cargo!.qty,
    equipment: e.id,
    stockMove: { toStorage: true, sourceId, mergeId },
  } as Job;
  s.jobs.push(j);
  e.job = j.id;
  return j;
}
test('wide storage loads cannot cross a building with a clear chassis, in planning or execution', () => {
  const { s, e } = fixture();
  s.buildings.push({
    id: 'BLD-TIP',
    kind: 'electricalJunction',
    x: 39,
    z: 40,
    w: 1,
    d: 1,
    rotation: 0,
    name: 'Tip obstacle',
    connected: false,
  });
  const goal = { x: 31, z: 40, yaw: 0 };
  assert.equal(equipmentMoveBlocked(s, e, goal), 'BLD-TIP');
  assert.equal(equipmentSweepBlocked(s, e, goal), 'BLD-TIP');
  assert.equal(machineRoute(s, e, goal, staticObstacleRects(s), 40, false, 0), null);
  delete e.cargo!.storageMove;
  assert.equal(
    equipmentMoveBlocked(s, e, goal),
    '',
    'Legacy unflagged hauling retains its existing chassis policy',
  );
});
test('all flagged generic cargo rotates its real bearing with the chassis', () => {
  const { e } = fixture();
  const carried = equipmentBoxes(e, { x: e.x, z: e.z, yaw: Math.PI / 2 }).at(-1)!;
  assert.ok(Math.abs(carried.yaw - Math.PI / 2) < 1e-9);
  assert.equal(carried.length, 6);
  assert.equal(carried.width, 3);
  delete e.cargo!.storageMove;
  assert.equal(equipmentBoxes(e, { x: e.x, z: e.z, yaw: Math.PI / 2 }).at(-1)!.yaw, 0);
});
test('a rigid storage load cannot sweep a nearby column while its chassis turns clear', () => {
  const { s, e } = fixture();
  e.reach = 4;
  e.cargo = { item: 'fence', qty: 1, yaw: 0, storageMove: true };
  s.buildings.push({
    id: 'BLD-TURN',
    kind: 'electricalJunction',
    x: 32.3,
    z: 42.3,
    w: 1,
    d: 1,
    rotation: 0,
    name: 'Turn obstacle',
    connected: false,
  });
  assert.equal(equipmentMoveBlocked(s, e, { x: 30, z: 40, yaw: Math.PI / 4 }), 'BLD-TURN');
  assert.equal(equipmentSweepBlocked(s, e, { x: 30, z: 40, yaw: Math.PI / 2 }), 'BLD-TURN');
});
test('a low carried load is blocked by stock but may pass physically above its top', () => {
  const { s, e } = fixture();
  s.stacks.push({
    id: 'STK-LOW',
    item: 'slab',
    x: 39,
    z: 40,
    w: 1,
    d: 1,
    qty: 2,
    reserved: 0,
    source: 'opening',
  });
  e.lift = 0.1;
  assert.equal(equipmentMoveBlocked(s, e, { x: 31, z: 40, yaw: 0 }), 'STK-LOW');
  e.lift = storageMoveStockHeight('slab', 2) + 0.1;
  assert.equal(equipmentMoveBlocked(s, e, { x: 31, z: 40, yaw: 0 }), '');
  assert.ok(machineRoute(s, e, { x: 31, z: 40 }, staticObstacleRects(s), 40, false, 0));
});
test('work-owned source and receiving stacks permit support contact but not deep penetration', () => {
  const { s, e } = fixture();
  e.cargo = { item: 'slab', qty: 2, yaw: 0, storageMove: true };
  e.reach = 4;
  const t = {
    id: 'STK-SUPPORT',
    item: 'slab' as const,
    x: 35,
    z: 40,
    w: 1,
    d: 1,
    qty: 4,
    reserved: 0,
    source: 'opening',
  };
  s.stacks.push(t);
  job(s, e, t.id, t.id);
  e.lift = storageMoveStockHeight('slab', t.qty) - 0.01;
  assert.equal(equipmentMoveBlocked(s, e, { x: 31.5, z: 40.5, yaw: 0 }), '');
  e.lift = 0.1;
  assert.equal(equipmentMoveBlocked(s, e, { x: 31.5, z: 40.5, yaw: 0 }), t.id);
});
test('open storage transport routes remain available and job ownership also enables the guard', () => {
  const { s, e } = fixture();
  assert.ok(machineRoute(s, e, { x: 35, z: 40 }, staticObstacleRects(s), 40, false, 0));
  assert.equal(equipmentSweepBlocked(s, e, { x: 31, z: 40, yaw: 0 }), '');
  delete e.cargo!.storageMove;
  job(s, e, 'STK-SOURCE', 'STK-DEST');
  s.buildings.push({
    id: 'BLD-TIP',
    kind: 'office',
    x: 39,
    z: 40,
    w: 1,
    d: 1,
    rotation: 0,
    name: 'Tip obstacle',
    connected: false,
  });
  assert.equal(equipmentMoveBlocked(s, e, { x: 31, z: 40, yaw: 0 }), 'BLD-TIP');
});
