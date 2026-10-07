import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { selectWorker, noteWorkerAssignment } from '../src/worker-selection';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { State, Worker } from '../src/types';
import { setEquipmentParking } from '../src/workforce';
import { machineStep } from '../src/boarding';
import { dist } from '../src/path';
function worker(s: State, x: number, z: number, role: Worker['role'] = 'builder') {
  const w: Worker = {
    id: S.id(s, 'worker'),
    name: `Worker #${s.workers.length + 1}`,
    role,
    duty: 'auto',
    status: 'Available',
    x,
    z,
    path: [],
    heading: 0,
    hours: 0,
    wage: 30,
  };
  s.workers.push(w);
  return w;
}
test('automatic workers use reachable walking distance, not register order or straight-line distance', () => {
  const s = S.createState(),
    near = worker(s, 19, 25),
    far = worker(s, 30, 25);
  s.buildings.push({
    id: 'WALL',
    kind: 'office',
    x: 20,
    z: 15,
    w: 1,
    d: 20,
    rotation: 0,
    connected: false,
    name: 'Wall',
  });
  const picked = selectWorker(s, [{ x: 22, z: 25 }]);
  assert.equal(picked!.worker.id, far.id);
  assert.equal(picked!.distance, 8);
  const enclosed = S.createState(),
    blocked = worker(enclosed, 10, 30),
    reachable = worker(enclosed, 20, 30);
  for (const b of [
    { x: 9, z: 29, w: 3, d: 0.5 },
    { x: 9, z: 31, w: 3, d: 0.5 },
    { x: 9, z: 29, w: 0.5, d: 2.5 },
    { x: 11.5, z: 29, w: 0.5, d: 2.5 },
  ])
    enclosed.buildings.push({
      id: `WALL-${enclosed.buildings.length}`,
      kind: 'office',
      rotation: 0,
      connected: false,
      name: 'Wall',
      ...b,
    });
  assert.equal(selectWorker(enclosed, [{ x: 15, z: 30 }])!.worker.id, reachable.id);
  assert.notEqual(near.id, far.id);
  assert.notEqual(blocked.id, reachable.id);
});
test('eligibility preserves duties, shifts, skills, active work and explicit support assignments', () => {
  const s = S.createState();
  const busy = worker(s, 10, 30);
  busy.job = 'ACTIVE';
  const rest = worker(s, 10, 30);
  rest.duty = 'rest';
  const manual = worker(s, 10, 30);
  manual.duty = 'manual';
  const off = worker(s, 10, 30);
  off.schedule = { start: 18, end: 22 };
  const crew = worker(s, 10, 30);
  crew.assistingEquipment = 'OTHER';
  const engineer = worker(s, 20, 30, 'engineer');
  const target = { x: 15, z: 30 };
  assert.equal(
    selectWorker(s, [target], { eligible: (w) => w.role === 'engineer' })!.worker.id,
    engineer.id,
  );
  assert.equal(selectWorker(s, [target])!.worker.id, engineer.id);
  assert.equal(selectWorker(s, [target], { preferredId: manual.id })!.worker.id, manual.id);
  assert.equal(selectWorker(s, [target], { equipmentId: 'OTHER' })!.worker.id, crew.id);
  engineer.processAssignment = 'PROC';
  assert.equal(selectWorker(s, [target]), undefined);
});
test('continuity favors only nearby workers, expires, and cannot steal active reservations', () => {
  const s = S.createState(),
    first = worker(s, 10, 30),
    second = worker(s, 11, 30),
    goal = { x: 15, z: 30 };
  noteWorkerAssignment(s, first, { workId: 'WORK', equipmentId: 'EQ' });
  assert.equal(selectWorker(s, [goal], { workId: 'WORK' })!.worker.id, first.id);
  second.x = 14;
  assert.equal(selectWorker(s, [goal], { workId: 'WORK' })!.worker.id, second.id);
  second.x = 11;
  s.elapsed = 31;
  assert.equal(selectWorker(s, [goal], { workId: 'WORK' })!.worker.id, second.id);
  first.job = 'ACTIVE';
  assert.equal(selectWorker(s, [goal], { preferredId: first.id })!.worker.id, second.id);
});
test('unreachable workers are skipped, ties use stable IDs, and selection has no side effects', () => {
  const s = S.createState(),
    a = worker(s, 10, 30),
    b = worker(s, 10, 30);
  const before = S.save(s);
  assert.equal(selectWorker(s, [{ x: 11, z: 30 }])!.worker.id, a.id);
  s.workers.reverse();
  assert.equal(selectWorker(s, [{ x: 11, z: 30 }])!.worker.id, a.id);
  s.workers.reverse();
  assert.equal(S.save(s), before);
  assert.equal(selectWorker(s, [{ x: 400, z: 400 }]), undefined);
  assert.equal(a.job, undefined);
  assert.equal(b.path.length, 0);
});
test('paving chooses a helper at its actual forklift placement point and keeps the assignment after reload', () => {
  const s = S.createState(),
    e = seedHandlingResources(s, 'forklift');
  e.x = 25;
  e.z = 35;
  const distant = worker(s, 13, 30),
    near = worker(s, 49, 43);
  s.stacks.push({
    id: 'SLABS',
    item: 'slab',
    qty: 5,
    reserved: 0,
    x: 12,
    z: 30,
    w: 1,
    d: 1,
    source: 'test',
  });
  const j = S.plan(s, 'slab', 50, 45).job!;
  tickUntil(s, () => j.status === 'doing', 5);
  assert.equal(j.worker, near.id);
  assert.notEqual(j.worker, distant.id);
  const reloaded = S.load(S.save(s));
  const saved = reloaded.jobs.find((q) => q.id === j.id)!;
  assert.equal(saved.worker, near.id);
  S.tick(reloaded, 0.1);
  assert.equal(saved.worker, near.id);
});
test('fuel assignment tries reachable drum/worker pairs and avoids the first distant register entry', () => {
  const s = S.createState(),
    e = seedHandlingResources(s, 'forklift');
  e.fuel = 10;
  e.x = 30;
  e.z = 35;
  const far = worker(s, 10, 50),
    near = worker(s, 35, 32);
  s.stacks.push({
    id: 'DRUM',
    item: 'diesel',
    qty: 1,
    reserved: 0,
    liters: 200,
    x: 34,
    z: 30,
    w: 1,
    d: 1,
    source: 'test',
  });
  S.refuel(s, e.id);
  const j = s.jobs.find((j) => j.kind === 'refuel')!;
  tickUntil(s, () => j.status === 'doing', 5);
  assert.equal(j.worker, near.id);
  assert.notEqual(j.worker, far.id);
  assert.ok(s.workers.find((w) => w.id === near.id)!.path.length > 0);
});
test('receiving selects the reachable rigger nearest the actual freight lifting face', () => {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  seedHandlingResources(s, 'excavator');
  const far = s.workers[1];
  far.x = 100;
  far.z = 80;
  const near = worker(s, 15, 24);
  const [id] = S.purchase(s, 'slab', 8);
  tickUntil(s, () => !!s.orders.find((o) => o.id === id)?.unload, 900);
  assert.equal(s.orders.find((o) => o.id === id)!.unload!.riggerId, near.id);
  assert.equal(far.deliveryOrder, undefined);
});
test('clearance refuge leases and ongoing driving cannot be commandeered for new work', () => {
  const s = S.createState(),
    e = seedHandlingResources(s, 'forklift'),
    w = s.workers[0];
  const owner = S.plan(s, 'slab', 50, 45).job!;
  e.actionYieldFor = owner.id;
  e.actionYieldUntil = s.elapsed + 30;
  assert.equal(
    selectWorker(s, [{ x: 20, z: 30 }], {
      equipmentId: e.id,
      eligible: (q) => q.role === 'operator',
    }),
    undefined,
  );
  e.actionYieldFor = undefined;
  e.actionYieldUntil = undefined;
  w.vehicle = e.id;
  e.operator = w.id;
  e.path = [{ x: 15, z: 35 }];
  assert.equal(selectWorker(s, [{ x: 20, z: 30 }], { allowVehicle: true }), undefined);
});
test('manual equipment and rail-group assignments supersede saved clearance leases', async () => {
  const { setJobEquipment, setRailCrew } = await import('../src/jobs');
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  s.stacks.push({
    id: 'SLABS',
    item: 'slab',
    qty: 1,
    reserved: 0,
    x: 12,
    z: 30,
    w: 1,
    d: 1,
    source: 'test',
  });
  const j = S.plan(s, 'slab', 50, 45).job!;
  e.actionYieldFor = j.id;
  e.actionYieldUntil = 30;
  assert.equal(setJobEquipment(s, j.id, e.id), '');
  assert.equal(e.actionYieldFor, undefined);
  const r = S.plan(s, 'rail', 125, 4).job!;
  const other = { ...e, id: 'EQ-other', x: 70, path: [] };
  s.equipment.push(other);
  const g = s.jobGroups!.find((g) => g.id === r.parentId)!;
  e.actionYieldFor = r.id;
  e.actionYieldUntil = 30;
  other.actionYieldFor = r.id;
  other.actionYieldUntil = 30;
  assert.equal(setRailCrew(s, g.id, e.id, other.id), '');
  assert.equal(e.actionYieldFor, undefined);
  assert.equal(other.actionYieldUntil, undefined);
});

test('parking skips unreachable operators, chooses the shortest boarding walk and preserves it after reload', () => {
  const s = S.createState(),
    e = seedHandlingResources(s);
  const blocked = s.workers[0];
  blocked.x = 10;
  blocked.z = 40;
  e.x = 30;
  e.z = 32;
  worker(s, 10, 55, 'operator');
  const near = worker(s, 28, 35, 'operator');
  for (const b of [
    { x: 9, z: 39, w: 3, d: 0.5 },
    { x: 9, z: 41, w: 3, d: 0.5 },
    { x: 9, z: 39, w: 0.5, d: 2.5 },
    { x: 11.5, z: 39, w: 0.5, d: 2.5 },
  ])
    s.buildings.push({
      id: S.id(s, 'building'),
      kind: 'office',
      rotation: 0,
      connected: false,
      name: 'Wall',
      ...b,
    });
  assert.equal(setEquipmentParking(s, e.id, 35, 32, 0), '');
  S.tick(s, 0.1);
  assert.equal(e.parkingOperator, near.id);
  assert.equal(blocked.parkingEquipment, undefined);
  const restored = S.load(S.save(s));
  S.tick(restored, 0.1);
  assert.equal(restored.equipment[0].parkingOperator, near.id);
  assert.equal(restored.workers.find((w) => w.id === near.id)!.parkingEquipment, e.id);
});

test('equal-distance operator assignment uses stable IDs after worker array reordering and reload', () => {
  const s = S.createState(),
    e = seedHandlingResources(s);
  e.x = 25;
  e.z = 35;
  const first = s.workers[0];
  first.x = 20;
  first.z = 35;
  worker(s, 20, 35, 'operator');
  worker(s, 49, 43);
  s.stacks.push({
    id: 'SLABS',
    item: 'slab',
    qty: 5,
    reserved: 0,
    x: 12,
    z: 30,
    w: 1,
    d: 1,
    source: 'test',
  });
  const j = S.plan(s, 'slab', 50, 45).job!;
  const reordered = S.load(S.save(s));
  reordered.workers.reverse();
  tickUntil(s, () => j.status === 'doing', 5);
  const restoredJob = reordered.jobs.find((q) => q.id === j.id)!;
  tickUntil(reordered, () => restoredJob.status === 'doing', 5);
  assert.equal(j.operator, first.id);
  assert.equal(restoredJob.operator, first.id);
});

test('a seated operator can work without walking through a currently obstructed exterior cab step', () => {
  const s = S.createState(),
    e = seedHandlingResources(s),
    w = s.workers[0];
  w.vehicle = e.id;
  e.operator = w.id;
  w.x = e.x;
  w.z = e.z;
  const foot = machineStep(e);
  s.stacks.push({
    id: 'STEP-STOCK',
    item: 'slab',
    qty: 1,
    reserved: 0,
    x: foot.x - 0.5,
    z: foot.z - 0.5,
    w: 1,
    d: 1,
    source: 'test',
  });
  const options = {
    allowVehicle: true,
    equipmentId: e.id,
    eligible: (person: Worker) => person.role === 'operator',
  };
  const seated = selectWorker(s, [foot], options);
  assert.equal(seated?.worker.id, w.id);
  assert.deepEqual(seated?.path, []);
  assert.equal(seated?.distance, 0);
  w.vehicle = undefined;
  e.operator = undefined;
  assert.equal(
    selectWorker(s, [foot], options),
    undefined,
    'An on-foot operator still needs a genuinely reachable boarding point',
  );
});

test('simultaneous receiving and paving keep nearby helpers instead of crossing their walking assignments', () => {
  let s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  const receiver = seedHandlingResources(s, 'excavator');
  const pavingHelper = s.workers[1];
  pavingHelper.x = 49;
  pavingHelper.z = 43;
  pavingHelper.duty = 'rest';
  const paver = seedHandlingResources(s, 'forklift');
  paver.x = 25;
  paver.z = 35;
  const receivingHelper = worker(s, 15, 24);
  receivingHelper.duty = 'rest';
  S.setEquipmentRole(s, receiver.id, 'receiving');
  S.setEquipmentRole(s, paver.id, 'paving');
  s.stacks.push({
    id: 'PAVING-SLABS',
    item: 'slab',
    qty: 5,
    reserved: 0,
    x: 60,
    z: 50,
    w: 1,
    d: 1,
    source: 'test',
  });
  const [orderId] = S.purchase(s, 'slab', 1);
  tickUntil(s, () => s.orders.find((o) => o.id === orderId)!.status === 'unloading', 600);
  const receivingStart = { ...receivingHelper },
    pavingStart = { ...pavingHelper };
  pavingHelper.duty = receivingHelper.duty = 'auto';
  const j = S.plan(s, 'slab', 50, 45).job!;
  tickUntil(s, () => !!s.orders.find((o) => o.id === orderId)!.unload && j.status === 'doing', 10);
  const unloading = s.orders.find((o) => o.id === orderId)!.unload!;
  assert.equal(
    unloading.riggerId,
    receivingHelper.id,
    'Receiving skips the first register helper who is near paving',
  );
  assert.equal(j.worker, pavingHelper.id);
  const receivingPoint = { x: unloading.source.x - 1.6, z: unloading.source.z + 1.9 };
  const pavingPoint = { x: j.x + 0.5, z: j.z + 0.5 };
  // Compare the two assigned work areas before lift choreography starts walking helpers.
  const localWalks = dist(receivingStart, receivingPoint) + dist(pavingStart, pavingPoint);
  const crossedWalks = dist(pavingStart, receivingPoint) + dist(receivingStart, pavingPoint);
  assert.ok(
    localWalks + 30 < crossedWalks,
    `${localWalks} local meters versus ${crossedWalks} crossed meters`,
  );
  s = S.load(S.save(s));
  assert.equal(s.jobs.find((q) => q.id === j.id)!.worker, pavingHelper.id);
  assert.equal(s.orders.find((o) => o.id === orderId)!.unload!.riggerId, receivingHelper.id);
  tickUntil(
    s,
    () =>
      s.jobs.find((q) => q.id === j.id)!.status === 'done' &&
      s.orders.find((o) => o.id === orderId)!.status === 'done',
    900,
  );
  assert.ok(s.paving['50,45']);
  assert.equal(s.orders.find((o) => o.id === orderId)!.arrived, 1);
});
