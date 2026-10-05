import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { seedHandlingResources, tickUntil, advance } from './support/yard.ts';
import { dist } from '../src/path.ts';
import { workerMoveBlocked } from '../src/traffic.ts';
import { setWorkerSchedule } from '../src/workforce.ts';
import {
  setEquipmentAssistant,
  equipmentAssistant,
  availableEquipmentAssistant,
  equipmentAssistantReason,
  workerSupportsEquipment,
  updateEquipmentAssistants,
} from '../src/work-crews.ts';

function crew() {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator'),
    w = s.workers[1];
  return { s, e, w };
}

test('support crews require a hired builder or engineer and reserve one worker for one machine', () => {
  const { s, e, w } = crew();
  const other = { ...e, id: 'EQ-other', x: 70, path: [] };
  s.equipment.push(other);
  assert.match(setEquipmentAssistant(s, e.id, 'missing'), /not found/);
  assert.match(setEquipmentAssistant(s, e.id, s.workers[0].id), /builder or engineer/);
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  assert.equal(equipmentAssistant(s, e.id), w);
  assert.equal(availableEquipmentAssistant(s, e.id), w);
  assert.equal(workerSupportsEquipment(w, e.id), true);
  assert.equal(workerSupportsEquipment(w, other.id), false);
  assert.equal(workerSupportsEquipment(w), false);
  assert.match(setEquipmentAssistant(s, other.id, w.id), /already supports/);
  assert.equal(setEquipmentAssistant(s, e.id), '');
  assert.equal(setEquipmentAssistant(s, other.id, w.id), '');
  assert.equal(equipmentAssistant(s, e.id), undefined);
  assert.equal(s.workers.length, 2, 'No invented operator or assistant');
});

test('changing or releasing support assignments preserves ongoing physical work and player paths', () => {
  const { s, e, w } = crew();
  w.job = 'JOB-live';
  w.path = [{ x: 18, z: 30 }];
  w.status = 'Carry fuel';
  const path = w.path;
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  assert.equal(w.job, 'JOB-live');
  assert.equal(w.path, path);
  assert.equal(availableEquipmentAssistant(s, e.id), undefined);
  assert.match(equipmentAssistantReason(s, e.id), /finish the current operation/);
  updateEquipmentAssistants(s, 0.1);
  assert.equal(w.path, path);
  assert.equal(setEquipmentAssistant(s, e.id), '');
  assert.equal(w.job, 'JOB-live');
  assert.equal(w.path, path);
  w.job = undefined;
  w.duty = 'manual';
  w.status = 'Walking';
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  updateEquipmentAssistants(s, 0.1);
  assert.equal(w.path, path);
  assert.match(equipmentAssistantReason(s, e.id), /manual control/);
});

test('idle supporting workers walk around real stock and stop on clear nearby ground', () => {
  const { s, e, w } = crew();
  w.x = 42;
  w.z = 28.5;
  s.stacks.push({
    id: 'ST-obstacle',
    item: 'rail',
    qty: 1,
    reserved: 0,
    source: 'fixture',
    x: 24,
    z: 25,
    w: 6,
    d: 6,
  });
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  updateEquipmentAssistants(s, 0.1);
  assert.ok(w.path.length > 1, 'Helper takes a route around the stock footprint');
  let previous = { x: w.x, z: w.z };
  for (let t = 0; t < 80 && dist(w, e) > 6.5; t += 0.1) {
    S.tick(s, 0.1);
    updateEquipmentAssistants(s, 0.1);
    assert.ok(dist(previous, w) < 0.18, 'Following uses physical walking rather than teleporting');
    assert.equal(workerMoveBlocked(s, previous, w), '', 'No step intersects machine or stock');
    previous = { x: w.x, z: w.z };
  }
  assert.ok(dist(w, e) <= 6.5);
  assert.equal(w.vehicle, undefined);
  for (let i = 0; i < 30; i++) {
    S.tick(s, 0.1);
    updateEquipmentAssistants(s, 0.1);
  }
  const settled = { x: w.x, z: w.z };
  for (let i = 0; i < 30; i++) {
    S.tick(s, 0.1);
    updateEquipmentAssistants(s, 0.1);
  }
  assert.ok(dist(w, settled) < 0.01, 'Worker stays nearby without circling');
});

test('supporting workers respect rest, manual control, off-site state, and shifts', () => {
  const { s, e, w } = crew();
  w.x = 60;
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  w.duty = 'rest';
  updateEquipmentAssistants(s, 0.1);
  assert.equal(w.path.length, 0);
  assert.match(equipmentAssistantReason(s, e.id), /resting/);
  w.duty = 'manual';
  updateEquipmentAssistants(s, 0.1);
  assert.equal(w.path.length, 0);
  w.duty = 'auto';
  w.shiftPhase = 'home';
  updateEquipmentAssistants(s, 0.1);
  assert.equal(w.path.length, 0);
  w.shiftPhase = 'working';
  s.time = 17 * 3600;
  setWorkerSchedule(s, w.id, 8, 16);
  updateEquipmentAssistants(s, 0.1);
  assert.equal(w.path.length, 0);
  assert.match(equipmentAssistantReason(s, e.id), /off shift/);
  s.time = 9 * 3600;
  updateEquipmentAssistants(s, 0.1);
  assert.ok(w.path.length);
  w.duty = 'rest';
  updateEquipmentAssistants(s, 0.1);
  assert.equal(w.path.length, 0, 'Rest cancels only an idle following walk');
});

test('a dedicated crew assignment and safe busy handoff survive save and reload', () => {
  const { s, e, w } = crew();
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  const loaded = S.load(S.save(s));
  const restored = loaded.workers.find((q) => q.id === w.id)!;
  assert.equal(restored.assistingEquipment, e.id);
  assert.equal(equipmentAssistant(loaded, e.id), restored);
  restored.deliveryOrder = 'ORD-live';
  restored.path = [{ x: 15, z: 24 }];
  updateEquipmentAssistants(loaded, 0.1);
  assert.equal(restored.deliveryOrder, 'ORD-live');
  assert.deepEqual(restored.path, [{ x: 15, z: 24 }]);
});

test('excavator delivery waits for its dedicated helper instead of borrowing another crew', () => {
  const { s, e, w } = crew();
  assert.equal(S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }), '');
  const spare = { ...w, id: 'WK-spare', x: 20, path: [] };
  s.workers.push(spare);
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  w.duty = 'rest';
  S.purchase(s, 'railCurve', 1, 'rail');
  tickUntil(s, () => s.orders[0].status === 'unloading');
  advance(s, 5);
  assert.equal(s.orders[0].unload, undefined);
  assert.match(s.orders[0].note, new RegExp(`${w.id}.*resting`));
  assert.equal(spare.deliveryOrder, undefined);
  w.duty = 'auto';
  tickUntil(s, () => !!s.orders[0].unload, 60);
  assert.equal(s.orders[0].unload!.riggerId, w.id);
});

test('a helper already touching an imported machine steps to clear nearby ground', () => {
  const { s, e, w } = crew();
  w.x = e.x;
  w.z = e.z;
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  updateEquipmentAssistants(s, 0.1);
  assert.ok(w.path.length, 'An existing overlap must not be treated as a safe waiting spot');
  const end = w.path.at(-1)!;
  assert.equal(workerMoveBlocked(s, { x: -10000, z: -10000 }, end), '');
});

test('dedicated rail helper accompanies transit and gives rigging and clearance paths priority', () => {
  const { s, e, w } = crew();
  const j = S.plan(s, 'rail', 116, 28).job!;
  e.x = 65;
  e.z = 40;
  e.path = [{ x: 100, z: 40 }];
  e.job = j.id;
  w.x = 30;
  w.z = 40;
  w.job = j.id;
  j.worker = w.id;
  j.equipment = e.id;
  j.status = 'doing';
  j.railWork = {
    phase: 'stage-travel',
    clock: 0,
    start: { x: 116, z: 28 },
    end: { x: 122, z: 28 },
    axisYaw: 0,
    side: { x: 0, z: 1 },
    stage: { x: 114, z: 36, w: 6, d: 3 },
    stageDock: { x: 116, z: 40 },
    railDock: { x: 116, z: 32 },
    bufferAside: { x: 113, z: 32 },
    panel: { x: 68, z: 40, y: 1, yaw: 0, state: 'carried' },
  };
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  updateEquipmentAssistants(s, 0.1);
  assert.ok(
    w.path.length,
    'The helper accompanies its own traveling machine even while assigned to its job',
  );
  assert.ok(dist(w.path.at(-1)!, e) <= 6.5);
  // Movement clones route arrays and railwork updates the human-readable status.
  // Ownership must survive both, without treating a genuine operation route as following.
  w.path = w.path.slice();
  w.status = 'Standing clear of panel staging area';
  j.railWork.phase = 'stage-lower';
  e.path = [];
  updateEquipmentAssistants(s, 0.1);
  assert.equal(
    w.path.length,
    0,
    'Once transit ends, rigging/fastening may claim the worker immediately',
  );
  const explicit = [{ x: 115, z: 36 }];
  w.path = explicit;
  w.status = 'Walking to exposed fasteners';
  j.railWork.phase = 'configure-staged-panel';
  updateEquipmentAssistants(s, 0.1);
  assert.equal(w.path, explicit, 'Follow logic never replaces a fastening approach');
  j.railWork.phase = 'source-clear';
  e.path = [{ x: 70, z: 40 }];
  w.status = 'Walking clear of the attached load and machine withdrawal';
  updateEquipmentAssistants(s, 0.1);
  assert.equal(w.path, explicit, 'A physical lifting clearance walk takes priority over following');
});

test('ordinary automatically assigned paving uses its own dedicated helper without requiring an unassigned builder', async () => {
  const { seedHandlingResources, tickUntil } = await import('./support/yard');
  const s = S.createState();
  const e = seedHandlingResources(s, 'excavator');
  const w = s.workers.find((w) => w.role === 'builder')!;
  assert.equal(setEquipmentAssistant(s, e.id, w.id), '');
  s.stacks.push({
    id: 'HELPER-SLABS',
    item: 'slab',
    qty: 2,
    reserved: 0,
    x: 35,
    z: 35,
    w: 1,
    d: 1,
    source: 'opening',
  });
  S.pave(s, { x: 55, z: 35, w: 2, d: 1 });
  let prefetched = false;
  tickUntil(
    s,
    () => s.jobs.every((j) => j.status === 'done'),
    1500,
    () => {
      if (
        s.jobs.some((j) => j.status === 'doing' && !j.worker) &&
        s.jobs.some((j) => j.handling?.phase === 'settle')
      )
        prefetched = true;
      for (const j of s.jobs) if (j.worker) assert.equal(j.worker, w.id);
    },
  );
  assert.equal(S.totals(s, 'slab').installed, 2);
  assert.ok(
    prefetched,
    'The machine can fetch the next slab while its dedicated helper finishes leveling',
  );
});
