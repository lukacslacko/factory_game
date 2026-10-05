import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources, tickUntil } from './support/yard';

test('receiving selects a nearby feasible excavator before a forklift across the factory', () => {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  const near = seedHandlingResources(s, 'excavator');
  const far = seedHandlingResources(s, 'forklift');
  far.x = 165;
  far.z = 60;
  s.workers[2].x = 165;
  s.workers[2].z = 63;
  S.purchase(s, 'slab', 6);
  tickUntil(s, () => !!s.orders[0].unload, 1000);
  assert.equal(s.orders[0].unload!.equipmentId, near.id);
  assert.equal(s.orders[0].automaticEquipment, near.id);
  assert.equal(far.deliveryOrder, undefined);
});
