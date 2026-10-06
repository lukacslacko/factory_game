import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { dist } from '../src/path';
import { trackGeometry, type TrackPiece } from '../src/track';
import { equipmentSweepBlocked, equipmentTravelSpeed, workerMoveBlocked } from '../src/traffic';
import { stateSummary } from './support/yard';
import type { Equipment, Item, Job, State, Worker } from '../src/types';

// Compact opening checkpoints from the native 0.19.7 deadlock. The rail panel
// is already legitimately suspended; its next placement dock is occupied by
// the empty crane that installed the preceding straight turnout panel.
function fixture(kind: 'panel' | 'buffer' = 'panel', duty: 'auto' | 'manual' = 'auto') {
  const s = S.createState();
  s.next = 1000;
  const moving: Equipment = {
    id: 'EQ-0019',
    kind: 'excavator',
    x: 107.00017090620572,
    z: 51.5,
    yaw: 58.11950681796259,
    heading: 2,
    y: 0,
    path: [],
    fuel: 80,
    tank: 80,
    used: 0,
    work: 1,
    reach: 4,
    lift: 0.65,
    job: 'JOB-0395',
    operator: 'WRK-0014',
    cargo: { item: 'railClosure', qty: 1, yaw: 3.4796587764266156 },
  };
  const idle: Equipment = {
    id: 'EQ-0489',
    kind: 'excavator',
    x: 112.5,
    z: 41,
    yaw: -36.113966576579514,
    heading: 2,
    y: 0,
    path: [],
    fuel: 80,
    tank: 80,
    used: 0,
    work: 0,
    reach: 4,
    lift: 0,
    operator: 'WRK-0485',
  };
  const track: TrackPiece = {
    layout: 'turnout',
    origin: { x: 125, z: 45 },
    heading: 2,
    hand: 1,
    section: 2,
    route: 'branch',
    groupId: 'WORK-0390',
  };
  const geometry = trackGeometry(track);
  const job: Job = {
    ...geometry.rect,
    id: 'JOB-0395',
    kind: 'rail',
    rotation: 0,
    item: 'railClosure',
    qty: 1,
    status: 'doing',
    phase: 'Align rail panel with existing track',
    reason: '',
    progress: 0.2,
    delivered: false,
    elapsed: 0,
    created: s.time,
    parentId: 'WORK-0390',
    track,
    worker: 'WRK-0484',
    operator: 'WRK-0014',
    equipment: moving.id,
    legacyRailHandoff: 'staged',
    railWork: {
      side: { x: -0.33166329795827415, z: 0.943397825303536 },
      stage: { x: 104, z: 54, w: 6, d: 3 },
      stageDock: { x: 107, z: 51.5 },
      railDock: { x: 111.1733468081669, z: 45.35562255121415 },
      bufferAside: { x: 117.53083114992386, z: 59.4168695469393 },
      stageYaw: Math.PI,
      phase: 'panel-align',
      clock: 0,
      start: { x: geometry.entry.x, z: geometry.entry.z },
      end: { x: geometry.end.x, z: geometry.end.z },
      axisYaw: geometry.pose.yaw,
      entryYaw: geometry.entry.yaw + Math.PI,
      endYaw: geometry.end.yaw,
      configuredHand: 1,
      lifting: 'panel',
      panel: {
        x: 107,
        z: 55.5,
        y: 0.65,
        yaw: 3.4796587764266156,
        state: 'carried',
        stackId: 'STK-1334',
      },
    },
  };
  (s.jobGroups ??= []).push({
    x: 105,
    z: 39,
    w: 20,
    d: 7,
    id: 'WORK-0390',
    label: 'Opening turnout work',
    created: s.time,
    track: { layout: 'turnout', origin: { x: 125, z: 45 }, heading: 2, hand: 1 },
  });
  s.stacks.push({
    x: 104,
    z: 54,
    w: 6,
    d: 3,
    id: 'STK-1334',
    item: 'railClosure',
    qty: 0,
    reserved: 0,
    source: job.id,
    yaw: Math.PI,
  });
  const helper: Worker = {
    id: 'WRK-0484',
    name: 'Worker #2',
    role: 'builder',
    x: 112,
    z: 55.5,
    path: [],
    duty: 'auto',
    status: 'Standing clear of rail handling',
    wage: 28,
    hours: 0,
    heading: 1,
    y: 0,
    job: job.id,
    assistingEquipment: moving.id,
  };
  if (kind === 'buffer') {
    Object.assign(moving, {
      x: 130,
      z: 17,
      yaw: -Math.PI / 2,
      heading: 3,
      cargo: undefined,
      lift: 0.8,
    });
    Object.assign(idle, { x: 130, z: 9, yaw: 0, heading: 0, reach: 2.7 });
    Object.assign(helper, { x: 124, z: 17 });
    Object.assign(job, {
      x: 125,
      z: 4,
      w: 5,
      d: 2,
      track: undefined,
      item: 'rail',
      delivered: true,
      phase: 'Carry buffer to track end',
    });
    Object.assign(job.railWork!, {
      side: { x: 0, z: 1 },
      start: { x: 125, z: 5 },
      end: { x: 130, z: 5 },
      axisYaw: 0,
      entryYaw: 0,
      endYaw: 0,
      railDock: { x: 127.5, z: 9 },
      phase: 'buffer-carry-end',
      lifting: 'buffer',
      panel: { x: 127.5, z: 5, y: 0, yaw: 0, state: 'installed', railId: 'RAIL-0900' },
      buffer: { id: 'BUFFER-001', x: 130, z: 13, y: 0.8, yaw: 0, carried: true, secured: false },
    });
    s.rails.push({ id: 'RAIL-0900', x: 125, z: 4, rotation: 0, length: 5, item: 'rail' });
    s.stacks = [];
    s.buffer = { x: 130, z: 13 };
  }
  const operators: Worker[] = [
    {
      id: 'WRK-0014',
      name: 'Worker #1',
      role: 'operator',
      x: moving.x,
      z: moving.z,
      path: [],
      duty: 'auto',
      status: job.phase,
      wage: 36,
      hours: 0,
      heading: moving.heading,
      y: 0,
      vehicle: moving.id,
      job: job.id,
    },
    {
      id: 'WRK-0485',
      name: 'Worker #3',
      role: 'operator',
      x: idle.x,
      z: idle.z,
      path: [],
      duty,
      status: 'Available in cab',
      wage: 36,
      hours: 0,
      heading: idle.heading,
      y: 0,
      vehicle: idle.id,
    },
  ];
  s.equipment.push(moving, idle);
  s.workers.push(...operators, helper);
  s.jobs.push(job);
  // Validate that this is an ordinary saved physical checkpoint, not a hidden
  // custom path or handoff mechanism used only by the regression.
  S.load(S.save(s));
  return {
    s,
    jobId: job.id,
    movingId: moving.id,
    idleId: idle.id,
    idleOperatorId: operators[1].id,
    item: job.item as Item,
  };
}

function safeTick(s: State, item: Item) {
  const machines = s.equipment.map((e) => ({ ...e, path: e.path.slice() }));
  const workers = s.workers.map((w) => ({ ...w, path: w.path.slice() }));
  S.tick(s, 0.1);
  for (const before of machines) {
    const after = s.equipment.find((e) => e.id === before.id)!;
    assert.ok(
      dist(before, after) <= Math.max(2.3, equipmentTravelSpeed(s, before)) * 0.1 + 1e-6,
      'Clearance never teleports either machine',
    );
    if (dist(before, after) > 1e-7 || Math.abs((before.yaw || 0) - (after.yaw || 0)) > 1e-7)
      assert.equal(
        equipmentSweepBlocked(s, before, after),
        '',
        `${before.id} respects actual swept collision guards`,
      );
  }
  for (const before of workers) {
    const after = s.workers.find((w) => w.id === before.id)!;
    if (before.vehicle || after.vehicle || before.transition || after.transition) continue;
    assert.ok(dist(before, after) <= 0.17 + 1e-6, 'The rigger must physically walk');
    if (dist(before, after) > 1e-7) assert.equal(workerMoveBlocked(s, before, after), '');
  }
  const totals = S.totals(s, item);
  assert.equal(
    totals.stored + totals.cargo + totals.installed,
    1,
    'Clearance never deletes or duplicates the panel',
  );
}

function until(s: State, item: Item, predicate: () => boolean, seconds = 180) {
  for (let t = 0; t < seconds && !predicate(); t += 0.1) safeTick(s, item);
  assert.ok(predicate(), stateSummary(s));
}

const requests = (s: State, jobId: string, idleId: string) =>
  s.events.filter((e) => e.entity === jobId && e.text.includes(`requests ${idleId} to clear`));

for (const kind of ['panel', 'buffer'] as const)
  test(`an occupied ${kind} installation dock requests safe physical clearance and completes its saved placement`, () => {
    const { s, jobId, idleId, item } = fixture(kind);
    const initial = { ...s.equipment.find((e) => e.id === idleId)! };
    until(s, item, () => s.jobs.find((j) => j.id === jobId)!.status === 'done');
    assert.ok(
      dist(
        s.equipment.find((e) => e.id === idleId)!,
        initial,
      ) > 1,
    );
    assert.equal(requests(s, jobId, idleId).length, 1);
    assert.equal(S.totals(s, item).installed, 1);
    if (kind === 'buffer') {
      assert.deepEqual(s.buffer, { x: 130, z: 5 });
      assert.equal(s.jobs[0].railWork!.buffer!.secured, true);
    }
    S.load(S.save(s));
  });

for (const kind of ['panel', 'buffer'] as const)
  test(`manual equipment at a ${kind} placement dock gets one saved warning and clears only after release`, () => {
    let { s, jobId, idleId, idleOperatorId, item } = fixture(kind, 'manual');
    const initial = { ...s.equipment.find((e) => e.id === idleId)! };
    for (let t = 0; t < 30; t += 0.1) safeTick(s, item);
    assert.equal(
      dist(
        s.equipment.find((e) => e.id === idleId)!,
        initial,
      ),
      0,
    );
    assert.equal(s.jobs[0].delivered, kind === 'buffer');
    const warnings = s.notices.filter(
      (n) => n.entity === jobId && n.title === 'Rail handling blocked',
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].detail.includes(idleId));
    assert.notEqual(warnings[0].state, 'done');
    const clearance = structuredClone(s.jobs[0].railWork!.siteClearance);
    s = S.load(S.save(s));
    assert.deepEqual(s.jobs[0].railWork!.siteClearance, clearance);
    for (let t = 0; t < 5; t += 0.1) safeTick(s, item);
    assert.equal(requests(s, jobId, idleId).length, 1);
    assert.equal(
      s.notices.filter((n) => n.entity === jobId && n.title === 'Rail handling blocked').length,
      1,
    );
    assert.equal(S.releaseWorker(s, idleOperatorId), '');
    until(s, item, () => s.jobs[0].status === 'done');
    assert.equal(s.notices.find((n) => n.id === warnings[0].id)!.state, 'done');
  });

test('an unpowered seated crane cannot be pushed out of an installation approach', () => {
  const { s, jobId, idleId, item } = fixture();
  const idle = s.equipment.find((e) => e.id === idleId)!;
  idle.fuel = 0;
  const initial = { ...idle };
  for (let t = 0; t < 30; t += 0.1) safeTick(s, item);
  assert.equal(dist(idle, initial), 0);
  assert.equal(idle.fuel, 0);
  assert.equal(idle.operator, initial.operator);
  assert.equal(s.jobs[0].delivered, false);
  assert.equal(requests(s, jobId, idleId).length, 1);
  assert.equal(
    s.notices.filter((n) => n.entity === jobId && n.title === 'Rail handling blocked').length,
    1,
  );
});

test('a late occupied landing freezes an already started panel-lowering animation', () => {
  const { s, jobId, idleId, idleOperatorId, item } = fixture();
  until(s, item, () => s.jobs[0].railWork!.phase === 'panel-lower');
  const r = s.jobs[0].railWork!,
    idle = s.equipment.find((e) => e.id === idleId)!;
  // Opening checkpoint under review: a manually controlled machine occupies
  // the landing square before lowering. No actor is relocated during replay.
  Object.assign(idle, trackGeometry(s.jobs[0]).pose, {
    path: [],
    trafficGoal: undefined,
    velocity: 0,
  });
  Object.assign(
    s.workers.find((w) => w.id === idleOperatorId)!,
    { x: idle.x, z: idle.z, duty: 'manual' },
  );
  const pose = { ...r.panel },
    clock = r.clock;
  for (let t = 0; t < 3; t += 0.1) safeTick(s, item);
  assert.equal(r.phase, 'panel-lower');
  assert.equal(r.clock, clock);
  assert.deepEqual(r.panel, pose);
  assert.equal(s.jobs[0].delivered, false);
  assert.ok(requests(s, jobId, idleId).length >= 1);
});
