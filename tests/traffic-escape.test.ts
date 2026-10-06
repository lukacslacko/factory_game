import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources } from './support/yard';
import { dist } from '../src/path';
import { equipmentSweepBlocked, equipmentTravelSpeed } from '../src/traffic';

// Actual geometry captured during the larger starter-base scenario: an empty
// forklift's first escape was blocked by the other machine's carried shed kit.
function encounter() {
  const s = S.createState(),
    fork = seedHandlingResources(s),
    crane = seedHandlingResources(s, 'excavator');
  Object.assign(fork, {
    x: 17.71213477295936,
    z: 48.41912526155593,
    yaw: 41.890704496667304,
    heading: 3,
    reverse: false,
    reach: 3,
    lift: -0.025,
    path: [{ x: 17.71213477295936, z: 46.13514341212452 }],
    trafficGoal: { x: 29.5, z: 45.4 },
    trafficWait: 20,
    blockedBy: crane.id,
  });
  Object.assign(crane, {
    x: 20.61821700905533,
    z: 44.49814931041091,
    yaw: 27.374333882308147,
    heading: 1,
    reverse: true,
    reach: 2.1,
    lift: 1.18,
    cargo: { item: 'shed', qty: 1 },
    path: [{ x: 16, z: 43.4 }],
    trafficWait: 20,
    blockedBy: fork.id,
  });
  for (const [e, w] of [
    [fork, s.workers[0]],
    [crane, s.workers[1]],
  ] as const) {
    e.operator = w.id;
    w.vehicle = e.id;
    w.x = e.x;
    w.z = e.z;
  }
  return { s, fork, crane };
}

test('a mutually blocked stale escape replans physically while retaining its real work destination', () => {
  const { s, fork, crane } = encounter();
  const destination = { ...fork.trafficGoal! },
    cargo = { ...crane.cargo! };
  let sawRetreat = false;
  for (let t = 0; t < 15 && dist(crane, { x: 16, z: 43.4 }) > 0.1; t += 0.1) {
    const poses = s.equipment.map((e) => ({ ...e }));
    S.tick(s, 0.1);
    for (let i = 0; i < poses.length; i++) {
      assert.ok(
        dist(poses[i], s.equipment[i]) <= equipmentTravelSpeed(s, poses[i]) * 0.1 + 1e-6,
        'Traffic recovery uses normal gradual movement',
      );
      assert.equal(
        equipmentSweepBlocked(s, poses[i], s.equipment[i]),
        '',
        'Retreat respects actual machine and load clearance',
      );
    }
    sawRetreat ||=
      !!fork.reverse && dist(fork, { x: 17.71213477295936, z: 48.41912526155593 }) > 0.2;
    if (fork.trafficGoal)
      assert.deepEqual(
        fork.trafficGoal,
        destination,
        'Changing an escape keeps the original material destination',
      );
    assert.deepEqual(crane.cargo, cargo);
  }
  assert.ok(
    sawRetreat,
    'The forklift backs away instead of repeatedly turning toward its stale escape',
  );
  assert.ok(dist(crane, { x: 16, z: 43.4 }) < 0.1, 'The loaded machine can continue its real trip');
});

test('a loaded machine can yield to an immobilized empty machine rather than wait on its impossible escape', () => {
  const { s, fork, crane } = encounter();
  fork.fuel = 0;
  const original = { x: crane.x, z: crane.z };
  for (let t = 0; t < 8 && dist(crane, original) < 3; t += 0.1) S.tick(s, 0.1);
  assert.ok(
    dist(crane, original) > 3,
    'A fueled loaded machine physically makes room for the stranded actor',
  );
  assert.equal(fork.fuel, 0, 'No fuel or substitute equipment is invented');
  assert.deepEqual(crane.cargo, { item: 'shed', qty: 1 });
});

// A crane has reached its pickup dock but cannot finish turning because an
// approaching forklift's rail load occupies the turn. Its active work has no
// driving path, so it must answer the forklift's clearance request directly.
function stationaryWorkEncounter(
  duty: 'auto' | 'manual',
  phase: 'source-approach' | 'panel-lift' = 'source-approach',
) {
  const s = S.createState(),
    fork = seedHandlingResources(s),
    crane = seedHandlingResources(s, 'excavator');
  Object.assign(fork, {
    x: 30.5,
    z: 35.6283,
    yaw: Math.PI / 2,
    reach: 2.45,
    cargo: { item: 'rail', qty: 1 },
    path: [{ x: 30.5, z: 43.5 }],
    blockedBy: crane.id,
  });
  Object.assign(crane, {
    x: 30.5,
    z: 41,
    yaw: Math.PI - 0.115,
    reach: 2.7,
    work: 1,
    path: [],
    blockedBy: fork.id,
  });
  const operators = s.workers.filter((w) => w.role === 'operator');
  for (const [i, e] of [fork, crane].entries()) {
    const operator = operators[i];
    e.operator = operator.id;
    operator.vehicle = e.id;
    operator.x = e.x;
    operator.z = e.z;
    operator.duty = i ? duty : 'auto';
  }
  // Keep a genuine planned work record assigned while its separate rigging
  // crew is unavailable. This exercises traffic without advancing handling.
  S.plan(s, 'rail', 125, 4);
  const work = s.jobs.find((j) => j.kind === 'rail')!;
  work.status = 'doing';
  work.phase = 'Approach reserved rail panel in stock';
  work.equipment = crane.id;
  work.operator = crane.operator;
  work.railWork = {
    phase,
    clock: 0,
    start: { x: 125, z: 5 },
    end: { x: 130, z: 5 },
    axisYaw: 0,
    side: { x: 0, z: 1 },
    stage: { x: 125, z: 9, w: 5, d: 3 },
    stageDock: { x: 127.5, z: 15 },
    railDock: { x: 127.5, z: 10 },
    bufferAside: { x: 131, z: 10 },
    panel: { x: 30.5, z: 38.3, y: 0.325, yaw: 0, state: 'stored' },
  };
  crane.job = work.id;
  operators[1].job = work.id;
  for (const w of s.workers.filter((w) => w.role !== 'operator')) {
    w.duty = 'rest';
    w.x = 10;
    w.z = 60;
  }
  return { s, fork, crane, work, dock: { x: crane.x, z: crane.z } };
}

test('a stationary active crane yields to a loaded forklift and retains its pickup dock', () => {
  const { s, fork, crane, work, dock } = stationaryWorkEncounter('auto');
  let answeredRequest = false,
    movedClear = false;
  for (let t = 0; t < 60 && dist(fork, { x: 30.5, z: 43.5 }) > 0.1; t += 0.1) {
    const poses = s.equipment.map((e) => ({ ...e }));
    S.tick(s, 0.1);
    for (let i = 0; i < poses.length; i++)
      assert.equal(
        equipmentSweepBlocked(s, poses[i], s.equipment[i]),
        '',
        'Both machines keep every chassis and load sweep clear while yielding',
      );
    if (crane.trafficGoal) {
      answeredRequest = true;
      assert.deepEqual(crane.trafficGoal, dock, 'The clearance maneuver preserves the work dock');
    }
    movedClear ||= dist(crane, dock) > 2;
    assert.equal(crane.job, work.id, 'Yielding keeps the active rail assignment');
    assert.equal(work.status, 'doing');
    assert.deepEqual(fork.cargo, { item: 'rail', qty: 1 });
  }
  assert.ok(answeredRequest && movedClear, 'The stationary crane physically answers the request');
  assert.ok(dist(fork, { x: 30.5, z: 43.5 }) < 0.1, 'The loaded forklift resumes its real trip');
  for (let t = 0; t < 30 && crane.path.length; t += 0.1) S.tick(s, 0.1);
  assert.equal(crane.path.length, 0);
  assert.equal(crane.trafficYieldEquipment, fork.id);
  const waiting = { x: crane.x, z: crane.z };
  for (let t = 0; t < 5; t += 0.1) S.tick(s, 0.1);
  assert.deepEqual(
    { x: crane.x, z: crane.z },
    waiting,
    'The crane stays clear while the stopped forklift still holds its load near the dock',
  );
  assert.deepEqual(crane.trafficGoal, dock);
  assert.equal(crane.job, work.id);

  // The fixture holds its work without a rigging crew or reserved panel.
  // Isolate the valid traffic checkpoint to test persistence independently
  // from those deliberately suspended construction prerequisites.
  const checkpoint = structuredClone(s);
  checkpoint.jobs = [];
  checkpoint.jobGroups = [];
  for (const e of checkpoint.equipment) delete e.job;
  for (const w of checkpoint.workers) delete w.job;
  const restored = S.load(S.save(checkpoint)),
    restoredCrane = restored.equipment.find((e) => e.id === crane.id)!,
    restoredFork = restored.equipment.find((e) => e.id === fork.id)!;
  assert.equal(restoredCrane.trafficYieldEquipment, fork.id);
  assert.deepEqual(restoredCrane.trafficGoal, dock);
  for (let t = 0; t < 5; t += 0.1) S.tick(restored, 0.1);
  assert.deepEqual({ x: restoredCrane.x, z: restoredCrane.z }, waiting);

  // An unloaded forklift can still physically occupy the original dock.
  // Its automatic operator must answer the crane's request to park clear.
  restoredFork.cargo = undefined;
  const forkliftStop = { x: restoredFork.x, z: restoredFork.z };
  let forkliftParkedClear = false;
  for (let t = 0; t < 60 && dist(restoredCrane, dock) > 0.1; t += 0.1) {
    const poses = restored.equipment.map((e) => ({ ...e }));
    S.tick(restored, 0.1);
    forkliftParkedClear ||= dist(restoredFork, forkliftStop) > 2;
    for (let i = 0; i < poses.length; i++)
      assert.equal(equipmentSweepBlocked(restored, poses[i], restored.equipment[i]), '');
  }
  assert.ok(
    forkliftParkedClear,
    'The unloaded forklift automatically parks clear of the work dock',
  );
  assert.ok(dist(restoredCrane, dock) < 0.1, 'The crane physically returns to its original dock');
  assert.equal(restoredCrane.trafficYieldEquipment, undefined);
  assert.equal(restoredCrane.trafficGoal, undefined);
});

test('clearance requests do not commandeer a manually controlled stationary crane', () => {
  const { s, fork, crane, dock } = stationaryWorkEncounter('manual');
  for (let t = 0; t < 12; t += 0.1) S.tick(s, 0.1);
  assert.deepEqual({ x: crane.x, z: crane.z }, dock);
  assert.equal(crane.path.length, 0);
  assert.equal(crane.trafficGoal, undefined);
  assert.deepEqual(fork.cargo, { item: 'rail', qty: 1 });
});

test('clearance requests do not interrupt an active rail lifting phase', () => {
  const { s, crane, work, dock } = stationaryWorkEncounter('auto', 'panel-lift');
  for (let t = 0; t < 12; t += 0.1) S.tick(s, 0.1);
  assert.deepEqual({ x: crane.x, z: crane.z }, dock);
  assert.equal(crane.path.length, 0);
  assert.equal(crane.trafficGoal, undefined);
  assert.equal(crane.job, work.id);
  assert.equal(work.railWork!.phase, 'panel-lift');
});

test('a yielding crane does not commandeer a manual forklift parked in its return dock', () => {
  const { s, fork, crane, dock } = stationaryWorkEncounter('auto');
  for (
    let t = 0;
    t < 60 && (!crane.trafficYieldEquipment || crane.path.length || fork.path.length);
    t += 0.1
  )
    S.tick(s, 0.1);
  assert.equal(crane.trafficYieldEquipment, fork.id);
  assert.equal(crane.path.length, 0);
  assert.equal(fork.path.length, 0);
  const forkliftStop = { x: fork.x, z: fork.z },
    craneStop = { x: crane.x, z: crane.z };
  s.workers.find((w) => w.id === fork.operator)!.duty = 'manual';
  fork.cargo = undefined;
  for (let t = 0; t < 12; t += 0.1) S.tick(s, 0.1);
  assert.deepEqual({ x: fork.x, z: fork.z }, forkliftStop);
  assert.equal(fork.path.length, 0);
  assert.deepEqual({ x: crane.x, z: crane.z }, craneStop);
  assert.equal(crane.trafficYieldEquipment, fork.id);
  assert.deepEqual(crane.trafficGoal, dock);
});

for (const duty of ['auto', 'manual'] as const)
  test(`a pathless loaded forklift requests clearance with ${duty} crane control`, () => {
    const { s, fork, crane, work, dock } = stationaryWorkEncounter(duty);
    fork.path = [];
    fork.blockedBy = undefined;
    const forkliftStop = { x: fork.x, z: fork.z };
    for (let t = 0; t < 15; t += 0.1) {
      const poses = s.equipment.map((e) => ({ ...e }));
      S.tick(s, 0.1);
      for (let i = 0; i < poses.length; i++)
        assert.equal(
          equipmentSweepBlocked(s, poses[i], s.equipment[i]),
          '',
          'Addressed clearance respects the complete stationary load and moving crane',
        );
      assert.deepEqual({ x: fork.x, z: fork.z }, forkliftStop);
      assert.deepEqual(fork.cargo, { item: 'rail', qty: 1 });
      assert.equal(crane.job, work.id);
      assert.equal(work.status, 'doing');
    }
    if (duty === 'auto') {
      assert.ok(dist(crane, dock) > 2, 'The crane responds even though neither actor had a route');
      assert.equal(crane.trafficYieldEquipment, fork.id);
      assert.deepEqual(crane.trafficGoal, dock);
    } else {
      assert.deepEqual({ x: crane.x, z: crane.z }, dock);
      assert.equal(crane.path.length, 0);
      assert.equal(crane.trafficYieldEquipment, undefined);
      assert.equal(crane.trafficGoal, undefined);
    }
  });
