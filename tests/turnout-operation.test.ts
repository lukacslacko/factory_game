import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { trackGeometry, trackSections } from '../src/track.ts';
import { turnoutLeverPose, turnoutWorkerPoint } from '../src/turnout-operation.ts';
import { equipmentAssignment, equipmentHasAssignedWork, setJobEquipment } from '../src/jobs.ts';
import type { Job, State, Worker } from '../src/types.ts';

function fixture(worker = true, onFoot = false) {
  const s = S.createState(),
    planned = S.planRailLayout(s, 'turnout', { x: 125, z: 5 });
  assert.equal(planned.error, '');
  for (const j of planned.jobs) {
    const g = trackGeometry(j);
    s.rails.push({
      id: S.id(s, 'rail'),
      x: g.rect.x,
      z: g.rect.z,
      rotation: j.rotation,
      length: g.length,
      item: j.item,
      track: j.track,
    });
    j.status = 'done';
    j.delivered = true;
    j.progress = 1;
    j.finished = s.time;
  }
  const points = s.rails[0];
  points.selectedRoute = 'straight';
  s.buffer = { x: 145, z: 5 };
  if (worker) {
    const foot = turnoutWorkerPoint(points),
      lever = turnoutLeverPose(points);
    const w: Worker = {
      id: S.id(s, 'worker'),
      name: 'Worker #1',
      role: 'builder',
      duty: 'auto',
      status: 'Available',
      hours: 0,
      wage: 28,
      x: onFoot ? foot.x : 115,
      z: onFoot ? foot.z : 18,
      heading: 1,
      yaw: Math.atan2(lever.z - foot.z, lever.x - foot.x),
      path: [],
    };
    s.workers.push(w);
  }
  return { s, points };
}
function operation(s: State): Job {
  return s.jobs.find((j) => j.kind === 'throwSwitch')!;
}
function until(s: State, predicate: () => boolean, seconds = 40) {
  for (let t = 0; t < seconds && !predicate(); t += 0.1) S.tick(s, 0.1);
  assert.ok(
    predicate(),
    JSON.stringify({ jobs: s.jobs.filter((j) => j.kind === 'throwSwitch'), workers: s.workers }),
  );
}

test('manual turnout request queues a real worker walking job without changing the route or material balance', () => {
  const { s, points } = fixture();
  const before = s.rails.map((r) => [r.id, r.item, r.length]);
  assert.equal(S.setTurnoutRoute(s, points.id, 'branch'), '');
  const j = operation(s);
  assert.equal(j.target, points.id);
  assert.equal(j.requestedRoute, 'branch');
  assert.equal(j.qty, 0);
  assert.equal(j.item, undefined);
  assert.equal(j.equipment, undefined);
  assert.equal(points.selectedRoute, 'straight');
  until(s, () => j.status === 'doing');
  assert.equal(j.worker, s.workers[0].id);
  assert.ok(s.workers[0].path.length > 0);
  assert.equal(points.selectedRoute, 'straight');
  until(s, () => j.phase === 'Throw manual turnout lever');
  assert.ok(
    Math.hypot(
      s.workers[0].x - turnoutWorkerPoint(points).x,
      s.workers[0].z - turnoutWorkerPoint(points).z,
    ) < 0.12,
  );
  assert.ok(j.elapsed > 0 && j.elapsed < 4);
  until(s, () => j.status === 'done');
  assert.equal(points.selectedRoute, 'branch');
  assert.equal(j.elapsed, 4);
  assert.equal(s.workers[0].job, undefined);
  assert.equal(s.equipment.length, 0);
  assert.deepEqual(
    s.rails.map((r) => [r.id, r.item, r.length]),
    before,
  );
  assert.deepEqual(S.missingMaterials(s), {});
  assert.doesNotThrow(() => S.load(S.save(s)));
});

test('turnout operation needs four seconds at the actual lever and survives a partial save without committing early', () => {
  let { s, points } = fixture(true, true);
  S.setTurnoutRoute(s, points.id, 'branch');
  until(s, () => operation(s).status === 'doing');
  for (let i = 0; i < 39; i++) {
    S.tick(s, 0.1);
    assert.equal(points.selectedRoute, 'straight');
  }
  assert.ok(Math.abs(operation(s).elapsed - 3.9) < 1e-6);
  s = S.load(S.save(s));
  points = s.rails[0];
  assert.equal(points.selectedRoute, 'straight');
  S.tick(s, 0.1);
  assert.equal(points.selectedRoute, 'branch');
  assert.equal(operation(s).status, 'done');
});

test('a missing crew blocks the operation without creating people or equipment', () => {
  const { s, points } = fixture(false);
  S.setTurnoutRoute(s, points.id, 'branch');
  for (let i = 0; i < 20; i++) S.tick(s, 0.1);
  assert.equal(operation(s).status, 'todo');
  assert.match(operation(s).reason, /worker on foot/);
  assert.equal(s.workers.length, 0);
  assert.equal(s.equipment.length, 0);
  assert.equal(points.selectedRoute, 'straight');
});

test('an obstructed standing point reports access and proceeds only after it is cleared', () => {
  const { s, points } = fixture();
  const foot = turnoutWorkerPoint(points);
  s.buildings.push({
    id: S.id(s, 'building'),
    kind: 'lamp',
    x: foot.x - 0.5,
    z: foot.z - 0.5,
    w: 1,
    d: 1,
    rotation: 0,
    connected: true,
    name: 'Obstructing pole',
  });
  S.setTurnoutRoute(s, points.id, 'branch');
  for (let i = 0; i < 20; i++) S.tick(s, 0.1);
  assert.equal(operation(s).status, 'todo');
  assert.match(operation(s).reason, /No walking access/);
  assert.equal(s.workers[0].job, undefined);
  assert.equal(points.selectedRoute, 'straight');
  s.buildings = [];
  s.revision++;
  until(s, () => operation(s).status === 'done');
  assert.equal(points.selectedRoute, 'branch');
});

test('canceling a partly moved lever physically returns it while retaining the previous route across reload', () => {
  let { s, points } = fixture(true, true);
  S.setTurnoutRoute(s, points.id, 'branch');
  until(s, () => operation(s).elapsed >= 1.2);
  const j = operation(s),
    oldElapsed = j.elapsed;
  S.cancelJob(s, j.id);
  assert.equal(j.status, 'doing');
  assert.equal(j.cancel, true);
  assert.equal(points.selectedRoute, 'straight');
  S.tick(s, 0.1);
  assert.ok(j.elapsed < oldElapsed);
  s = S.load(S.save(s));
  points = s.rails[0];
  until(s, () => operation(s).status === 'canceled');
  assert.equal(points.selectedRoute, 'straight');
  assert.equal(operation(s).elapsed, 0);
  assert.equal(s.workers[0].job, undefined);
  assert.equal(S.setTurnoutRoute(s, points.id, 'branch'), '');
  assert.equal(s.jobs.filter((j) => j.kind === 'throwSwitch').length, 2);
});

test('walking cancellation and duplicate requests preserve the old route and release the same worker', () => {
  const { s, points } = fixture();
  S.setTurnoutRoute(s, points.id, 'branch');
  assert.match(S.setTurnoutRoute(s, points.id, 'branch'), /already queued/);
  assert.equal(s.jobs.filter((j) => j.kind === 'throwSwitch').length, 1);
  until(s, () => operation(s).status === 'doing');
  S.cancelJob(s, operation(s).id);
  assert.equal(operation(s).status, 'canceled');
  assert.equal(s.workers[0].job, undefined);
  assert.equal(s.workers[0].path.length, 0);
  assert.equal(points.selectedRoute, 'straight');
});

test('worker-only switch jobs reject equipment assignment and never reserve a machine', () => {
  const { s, points } = fixture();
  s.equipment.push({
    id: S.id(s, 'equipment'),
    kind: 'forklift',
    x: 30,
    z: 40,
    path: [],
    fuel: 45,
    tank: 45,
    used: 0,
    heading: 0,
    work: 0,
  });
  S.setTurnoutRoute(s, points.id, 'branch');
  const j = operation(s),
    e = s.equipment[0];
  assert.match(setJobEquipment(s, j.id, e.id), /worker on foot/);
  assert.equal(j.preferredEquipment, undefined);
  assert.equal(equipmentAssignment(s, j.id).equipmentId, undefined);
  assert.equal(equipmentHasAssignedWork(s, e), false);
  until(s, () => j.status === 'done');
  assert.equal(e.job, undefined);
  assert.equal(e.used, 0);
  assert.equal(e.operator, undefined);
});

test('manual turnout saves reject missing targets, equipment, material, invalid routes, or excess progress', () => {
  const { s, points } = fixture();
  S.setTurnoutRoute(s, points.id, 'branch');
  for (const change of [
    { target: 'MISSING' },
    { requestedRoute: 'invalid' },
    { equipment: 'EQ-MISSING' },
    { item: 'rail' },
    { qty: 1 },
    { elapsed: 4.01 },
    { progress: 1.1 },
  ]) {
    const bad = JSON.parse(S.save(s));
    Object.assign(
      bad.jobs.find((j: Job) => j.kind === 'throwSwitch'),
      change,
    );
    assert.throws(() => S.load(JSON.stringify(bad)), /manual turnout operation/);
  }
});

test('lever and worker positions rotate with every cardinal heading and stay opposite either branch hand', () => {
  for (const heading of [0, 1, 2, 3] as const)
    for (const hand of [1, -1] as const) {
      const piece = trackSections('turnout', { x: 50, z: 50 }, heading, hand)[0],
        g = trackGeometry(piece);
      const rail = {
        id: 'POINTS',
        x: g.rect.x,
        z: g.rect.z,
        rotation: heading % 2,
        length: g.length,
        track: piece,
      };
      const lever = turnoutLeverPose(rail),
        foot = turnoutWorkerPoint(rail),
        yaw = (heading * Math.PI) / 2;
      assert.ok(
        Math.abs(lever.x - (50 + 0.95 * Math.cos(yaw) + hand * 0.9 * Math.sin(yaw))) < 1e-9,
      );
      assert.ok(
        Math.abs(lever.z - (50 + 0.95 * Math.sin(yaw) - hand * 0.9 * Math.cos(yaw))) < 1e-9,
      );
      assert.ok(Math.abs(Math.hypot(foot.x - lever.x, foot.z - lever.z) - 0.65) < 1e-9);
    }
});
