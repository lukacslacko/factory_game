import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources, tickUntil } from './support/yard';
import { equipmentBoxes, equipmentReachBlocked } from '../src/traffic';
import { forkTip, FORK_LOAD_CENTER } from '../src/fork-geometry';

test('moving fork carriage has a full tool envelope and cannot extend through a person', () => {
  const s = S.createState(),
    e = seedHandlingResources(s);
  e.x = 10;
  e.z = 20;
  e.yaw = 0;
  e.reach = FORK_LOAD_CENTER;
  const worker = s.workers[0];
  worker.x = 15;
  worker.z = 20;
  const tools = equipmentBoxes(e)[1];
  assert.ok(Math.abs(tools.x + tools.length / 2 - e.x - forkTip(e.reach)) < 1e-9);
  assert.equal(equipmentReachBlocked(s, e, 4), worker.id);
  e.reach = 4;
  assert.equal(
    equipmentReachBlocked(s, e, FORK_LOAD_CENTER),
    '',
    'Withdrawal can clear existing contact',
  );
});

test('a real forklift rail shipment retracts the supported panel during travel and extends only at storage', () => {
  const s = S.createState(),
    e = seedHandlingResources(s);
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  const [oid] = S.purchase(s, 'rail', 1);
  const o = s.orders.find((o) => o.id === oid)!;
  tickUntil(s, () => o.unload?.phase === 'carry' && o.unload.clock > 2 && e.path.length > 0);
  assert.ok((e.reach || 0) < 3, 'Load comes back toward the mast while traveling');
  assert.ok((e.reach || 0) >= FORK_LOAD_CENTER);
  assert.equal(e.cargo?.item, 'rail');
  const carried = o.unload!.cargo!;
  assert.ok(Math.abs(Math.hypot(carried.x - e.x, carried.z - e.z) - e.reach!) < 1e-6);
  tickUntil(s, () => o.status === 'done');
  assert.equal(S.totals(s, 'rail').stored, 1);
  assert.equal(e.cargo, undefined);
});
