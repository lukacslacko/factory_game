import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { MATERIALS } from '../src/catalog.ts';
import { dist } from '../src/path.ts';
import { claimManeuver, reconcileManeuverReservations } from '../src/maneuver-reservations.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';
import type { Stack } from '../src/types.ts';

test('delivery owns only its next local maneuver and saves without letting another crew claim it', () => {
  let s = S.createState();
  assert.equal(S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }), '');
  seedHandlingResources(s);
  const [orderId] = S.purchase(s, 'slab', 1);
  const order = () => s.orders.find((o) => o.id === orderId)!;
  tickUntil(s, () => !!order().unload, 300);
  const pickup = s.maneuverReservations?.find((r) => r.ownerId === orderId);
  assert.equal(pickup?.kind, 'pickup');
  assert.equal(claimManeuver(s, { ownerId: 'OTHER-CREW', equipmentId: 'OTHER-MACHINE',
    kind: 'pickup', area: pickup!.area }), orderId);
  assert.equal(s.maneuverReservations?.length, 1);
  s = S.load(S.save(s));
  assert.equal(s.maneuverReservations?.[0]?.ownerId, orderId);
  tickUntil(s, () => order().unload?.phase === 'carry' &&
    dist(s.equipment[0], order().unload!.drop) > 10, 600);
  assert.equal(s.maneuverReservations?.length || 0, 0,
    'A remote trip does not lock the storage bay across the yard');
  tickUntil(s, () => order().unload?.phase === 'carry' &&
    dist(s.equipment[0], order().unload!.drop) <= 10 &&
    s.maneuverReservations?.[0]?.kind === 'landing', 600);
  const landing = s.maneuverReservations![0];
  assert.equal(claimManeuver(s, { ownerId: 'OTHER-CREW', equipmentId: 'OTHER-MACHINE',
    kind: 'landing', area: landing.area }), orderId);
  s = S.load(S.save(s));
  assert.equal(s.maneuverReservations?.[0]?.kind, 'landing');
  tickUntil(s, () => order().status === 'done', 900);
  assert.equal(s.maneuverReservations?.length || 0, 0);
});

test('storage-move pickup ownership releases immediately on an unlifted cancellation', () => {
  const s = S.createState();
  assert.equal(S.addZone(s, { x: 52, z: 36, w: 20, d: 20 }), '');
  const e = seedHandlingResources(s, 'excavator');
  Object.assign(e, { x: 25.5, z: 45.5 });
  Object.assign(s.workers[0], { x: 24.5, z: 42.5 });
  Object.assign(s.workers[1], { x: 28.5, z: 49.5 });
  const m = MATERIALS.slab;
  const source: Stack = { id: S.id(s, 'stack'), item: 'slab', x: 35, z: 45,
    w: m.w, d: m.d, qty: 2, reserved: 0, source: 'opening' };
  s.stacks.push(source);
  const result = S.moveToStorage(s, { id: source.id, quantity: 1 });
  assert.equal(result.error, '');
  const job = result.job!;
  tickUntil(s, () => !!job.handling && ['approach', 'rig'].includes(job.handling.phase) &&
    !!s.maneuverReservations?.some((r) => r.ownerId === job.id && r.kind === 'pickup'), 300);
  const owned = s.maneuverReservations!.find((r) => r.ownerId === job.id)!;
  assert.equal(claimManeuver(s, { ownerId: 'SECOND-JOB', equipmentId: 'SECOND-MACHINE',
    kind: 'pickup', area: owned.area, resourceId: source.id }), job.id);
  S.cancelJob(s, job.id);
  assert.equal(job.status, 'canceled');
  assert.equal(s.maneuverReservations?.some((r) => r.ownerId === job.id), false);
  S.load(S.save(s));
});

test('a storage move changes from a pickup lease to a nearby landing lease and releases it', () => {
  let s = S.createState();
  assert.equal(S.addZone(s, { x: 52, z: 36, w: 20, d: 20 }), '');
  const e = seedHandlingResources(s, 'excavator');
  Object.assign(e, { x: 25.5, z: 45.5 });
  Object.assign(s.workers[0], { x: 24.5, z: 42.5 });
  Object.assign(s.workers[1], { x: 28.5, z: 49.5 });
  const m = MATERIALS.slab;
  const source: Stack = { id: S.id(s, 'stack'), item: 'slab', x: 35, z: 45,
    w: m.w, d: m.d, qty: 2, reserved: 0, source: 'opening' };
  s.stacks.push(source);
  const result = S.moveToStorage(s, { id: source.id, quantity: 1 });
  assert.equal(result.error, '');
  const jobId = result.job!.id;
  const job = () => s.jobs.find((j) => j.id === jobId)!;
  tickUntil(s, () => job().handling?.phase === 'carry' &&
    dist(s.equipment[0], job().handling!.destinationDock) > 10, 600);
  assert.equal(s.maneuverReservations?.length || 0, 0);
  tickUntil(s, () => !!s.maneuverReservations?.some((r) =>
    r.ownerId === jobId && r.kind === 'landing'), 600);
  const landing = s.maneuverReservations!.find((r) => r.ownerId === jobId)!;
  assert.equal(claimManeuver(s, { ownerId: 'SECOND-JOB', equipmentId: 'SECOND-MACHINE',
    kind: 'landing', area: landing.area }), jobId);
  s = S.load(S.save(s));
  assert.equal(s.maneuverReservations?.[0]?.kind, 'landing');
  tickUntil(s, () => job().status === 'done', 900);
  assert.equal(s.maneuverReservations?.length || 0, 0);
});

test('expired or interrupted maneuver leases cannot pin another crew, and damaged saves are rejected', () => {
  const s = S.createState();
  const [orderId] = S.purchase(s, 'slab', 1);
  const o = s.orders.find((q) => q.id === orderId)!;
  o.status = 'unloading';
  o.unload = { item: 'slab', equipmentId: 'EQ-TEST', operatorId: 'WRK-TEST',
    phase: 'approach', clock: 0, qty: 1, source: { x: 4, z: 4 },
    sourceY: 1, sourceYaw: 0, pickup: { x: 4, z: 8 },
    destination: { x: 30, z: 30, w: 1, d: 1 }, drop: { x: 32, z: 30 },
    dropYaw: 0, destinationY: 0 };
  const area = { x: 2, z: 6, w: 4, d: 4 };
  assert.equal(claimManeuver(s, { ownerId: orderId, equipmentId: 'EQ-TEST',
    kind: 'pickup', area }), '');
  s.elapsed += 7;
  reconcileManeuverReservations(s);
  assert.equal(s.maneuverReservations?.length, 0);
  assert.equal(claimManeuver(s, { ownerId: 'SECOND', equipmentId: 'EQ-OTHER',
    kind: 'pickup', area }), '');
  const malformed = JSON.parse(S.save(s));
  malformed.maneuverReservations[0].area.w = -1;
  assert.throws(() => S.load(JSON.stringify(malformed)), /maneuver reservation/i);
  const conflicting = JSON.parse(S.save(s));
  conflicting.maneuverReservations.push({ ...conflicting.maneuverReservations[0],
    ownerId: 'THIRD', equipmentId: 'EQ-THIRD' });
  assert.throws(() => S.load(JSON.stringify(conflicting)), /conflicting saved maneuver reservations/i);
});
