import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, purchase } from '../src/sim';
import { seedHandlingResources } from './support/yard';
import { equipmentIntent } from '../src/equipment-intent';
import type { UnloadTask } from '../src/types';

function fixture() {
  const s = createState(),
    e = seedHandlingResources(s);
  const [id] = purchase(s, 'railCurve', 4);
  const order = s.orders.find((o) => o.id === id)!;
  order.note = 'No clear loaded route to STK-900 at (34.5, 31.5); clear the approach aisle';
  order.unload = {
    equipmentId: e.id,
    operatorId: s.workers[0].id,
    phase: 'carry',
    clock: 0,
    qty: 1,
    mergeId: 'STK-900',
    source: { x: 22, z: 24 },
    sourceY: 1,
    sourceYaw: 0,
    pickup: { x: 22, z: 27 },
    destination: { x: 34, z: 34, w: 6, d: 3 },
    drop: { x: 34.5, z: 31.5 },
    dropYaw: 0,
    destinationY: 0,
  } satisfies UnloadTask;
  return { s, e, order };
}
test('stalled unloading retains actual order explanation, destination and clickable references without inventing a path', () => {
  const { s, e, order } = fixture();
  const intent = equipmentIntent(s, e);
  assert.equal(intent.detail, order.note);
  assert.equal(intent.phase, 'Delivery · carry');
  assert.deepEqual(intent.target, order.unload!.drop);
  assert.equal(intent.hasRoute, false);
  assert.deepEqual(intent.route, []);
  assert.ok(intent.references.includes('STK-900'));
  assert.ok(intent.references.includes(order.id));
});
test('accepted movement and clearance maneuvers remain distinct from an unplanned delivery target', () => {
  const { s, e } = fixture();
  e.path = [
    { x: 9, z: 29 },
    { x: 10, z: 29 },
  ];
  let intent = equipmentIntent(s, e);
  assert.equal(intent.hasRoute, true);
  assert.deepEqual(intent.target, e.path.at(-1));
  e.trafficGoal = { x: 10, z: 30 };
  intent = equipmentIntent(s, e);
  assert.equal(intent.targetLabel, 'Clearance maneuver');
  assert.deepEqual(intent.target, e.path.at(-1));
  e.path = [];
  assert.deepEqual(equipmentIntent(s, e).target, e.trafficGoal);
});
test('blocking physical stock resolves to a bounded outline and preserves its actual identifier', () => {
  const { s, e } = fixture();
  s.stacks.push({
    id: 'STK-900',
    item: 'railCurve',
    qty: 3,
    reserved: 0,
    source: 'PO-900',
    x: 34,
    z: 34,
    w: 6,
    d: 3,
  });
  e.blockedBy = 'physical-stock:STK-900';
  const intent = equipmentIntent(s, e);
  assert.deepEqual(intent.blocker, { id: 'STK-900', rect: { x: 34, z: 34, w: 6, d: 3 } });
  assert.match(intent.detail, /Waiting for physical-stock:STK-900/);
});
test('parking and idle equipment do not require serialized intent fields', () => {
  const s = createState(),
    e = seedHandlingResources(s);
  assert.equal(equipmentIntent(s, e).target, undefined);
  e.parking = { x: 40, z: 50, rotation: 0 };
  e.parkingState = 'driving';
  assert.deepEqual(equipmentIntent(s, e).target, { x: 40, z: 50 });
  e.parkingState = 'parked';
  assert.equal(equipmentIntent(s, e).target, undefined);
});

test('rail handling intent follows buffer staging, restoration and panel cancellation docks', () => {
  const s = createState(),
    e = seedHandlingResources(s, 'excavator');
  const job: import('../src/types').Job = {
    id: 'JOB-900',
    kind: 'rail',
    item: 'rail',
    qty: 1,
    status: 'doing',
    x: 60,
    z: 40,
    w: 5,
    d: 2,
    rotation: 0,
    phase: 'Handle buffer',
    reason: '',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: 0,
    equipment: e.id,
    railWork: {
      phase: 'buffer-carry-aside',
      clock: 0,
      start: { x: 60, z: 40 },
      end: { x: 65, z: 40 },
      axisYaw: 0,
      side: { x: 0, z: 1 },
      stage: { x: 50, z: 50, w: 5, d: 2 },
      stageDock: { x: 52, z: 55 },
      railDock: { x: 62, z: 44 },
      bufferAside: { x: 58, z: 48 },
      panel: { x: 52, z: 51, y: 0, yaw: 0, state: 'staged' },
      buffer: { id: 'BUFFER-001', x: 58, z: 48, y: 0, yaw: 0, secured: false, carried: true },
    },
  };
  s.jobs.push(job);
  assert.deepEqual(equipmentIntent(s, e).target, { x: 58, z: 52 });
  job.railWork!.phase = 'buffer-retrieve';
  assert.deepEqual(equipmentIntent(s, e).target, { x: 58, z: 52 });
  job.railWork!.phase = 'buffer-carry-end';
  assert.deepEqual(equipmentIntent(s, e).target, { x: 65, z: 44 });
  job.railWork!.restoreOriginal = true;
  assert.deepEqual(equipmentIntent(s, e).target, { x: 60, z: 44 });
  job.railWork!.phase = 'cancel-panel-return';
  assert.deepEqual(equipmentIntent(s, e).target, job.railWork!.stageDock);
});

test('rail source preflight intent identifies reserved stock before physical handling is initialized', () => {
  const s = createState(),
    e = seedHandlingResources(s, 'excavator');
  const stack = {
    id: 'STK-901',
    item: 'rail' as const,
    qty: 2,
    reserved: 1,
    source: 'opening',
    x: 24,
    z: 47,
    w: 5,
    d: 2,
  };
  s.stacks.push(stack);
  const job = {
    id: 'JOB-901',
    kind: 'rail' as const,
    item: 'rail' as const,
    qty: 1,
    status: 'doing' as const,
    x: 125,
    z: 4,
    w: 5,
    d: 2,
    rotation: 0,
    phase: 'Collect material',
    reason: 'Reserved rail panel needs an accessible lifting face',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: 0,
    equipment: e.id,
    stack: stack.id,
  };
  s.jobs.push(job);
  e.job = job.id;
  const intent = equipmentIntent(s, e);
  assert.equal(intent.targetLabel, 'Reserved material');
  assert.deepEqual(intent.target, { x: 26.5, z: 48 });
  assert.ok(intent.references.includes(stack.id));
  assert.equal(intent.detail, job.reason);
});
