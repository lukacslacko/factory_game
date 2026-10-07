import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { localPoint } from '../src/motion.ts';
import {
  boxOverlap,
  equipmentBoxes,
  personTouchesBox,
  staticObstacleRects,
} from '../src/traffic.ts';
import type { State } from '../src/types.ts';
import { tickUntil } from './support/yard.ts';

function legacyRail(stage: 'reserved' | 'carried' | 'installed') {
  const s = S.demoState();
  s.buildings = [];
  s.electrical = { runs: [], meterLedger: [] };
  s.paving = {};
  s.rails = [];
  s.jobs = [];
  s.orders = s.orders.filter((o) => o.item === 'rail');
  s.orders[0].qty = s.orders[0].arrived = 1;
  s.stacks = s.stacks.filter((t) => t.item === 'rail').slice(0, 1);
  const stock = s.stacks[0];
  stock.x = 100;
  stock.z = 23;
  stock.qty = stage === 'reserved' ? 1 : 0;
  stock.reserved = stage === 'reserved' ? 1 : 0;
  const builder = s.workers.find((w) => w.role === 'builder')!;
  const operator = s.workers.find((w) => w.role === 'operator')!;
  s.workers = [builder, operator];
  const fork = s.equipment.find((e) => e.kind === 'forklift')!;
  const crane = s.equipment.find((e) => e.kind === 'excavator')!;
  Object.assign(fork, {
    x: 114,
    z: 11.5,
    y: 0,
    yaw: 0,
    heading: 0,
    lift: 0.7,
    reach: 2.7,
    operator: operator.id,
  });
  Object.assign(crane, { x: 107, z: 17.5, y: 0, yaw: 0, heading: 0 });
  Object.assign(builder, { x: 117, z: 17.5, yaw: 0 });
  Object.assign(operator, { x: fork.x, z: fork.z, vehicle: fork.id, duty: 'rest', yaw: 0 });
  const j = S.plan(s, 'rail', 125, 4).job!;
  Object.assign(j, {
    status: 'doing',
    phase:
      stage === 'reserved'
        ? 'Collect material'
        : stage === 'carried'
          ? 'Carry to site'
          : 'Relocate buffer',
    delivered: stage === 'installed',
    worker: builder.id,
    operator: operator.id,
    equipment: fork.id,
    stack: stage === 'reserved' ? stock.id : undefined,
    elapsed: 4,
  });
  builder.job = operator.job = fork.job = j.id;
  if (stage === 'carried') fork.cargo = { item: 'rail', qty: 1 };
  if (stage === 'installed') {
    s.rails.push({ id: 'RAIL-LEGACY', x: 125, z: 4, rotation: 0, length: 5 });
    s.buffer = { x: 127.5, z: 5 };
  }
  s.version = 3;
  return { s, jobId: j.id, forkId: fork.id, craneId: crane.id, operatorId: operator.id };
}
function conservation(s: State) {
  const t = S.totals(s, 'rail');
  assert.equal(
    t.stored + t.cargo + t.installed,
    1,
    'The original rail panel has exactly one owner',
  );
  assert.equal(t.delivered, 1);
}

test('v3 forklift rail reservation releases crew and stock before reassigning an excavator', () => {
  const fixture = legacyRail('reserved');
  let s = S.load(S.save(fixture.s));
  const j = s.jobs.find((j) => j.id === fixture.jobId)!;
  assert.equal(j.status, 'todo');
  assert.equal(j.equipment, undefined);
  assert.equal(s.stacks[0].reserved, 0);
  assert.ok(s.workers.every((w) => !w.job));
  assert.ok(s.equipment.every((e) => !e.job));
  conservation(s);
  s.workers.find((w) => w.id === fixture.operatorId)!.duty = 'auto';
  tickUntil(
    s,
    () => j.status === 'done',
    1200,
    () => conservation(s),
  );
  assert.equal(s.rails.length, 1);
  assert.deepEqual(s.buffer, { x: 130, z: 5 });
  assert.equal(s.orders.length, 1, 'No replacement panel was ordered');
});

test('a v3 carried forklift panel is lowered onto supports, survives saves, and is handed to an excavator', () => {
  const fixture = legacyRail('carried');
  const before = fixture.s.equipment.find((e) => e.id === fixture.forkId)!;
  const originalPose = { x: before.x, z: before.z, yaw: before.yaw, lift: before.lift };
  let s = S.load(S.save(fixture.s));
  assert.deepEqual(s.equipment.find((e) => e.id === fixture.forkId)!.cargo, {
    item: 'rail',
    qty: 1,
  });
  const loaded = s.equipment.find((e) => e.id === fixture.forkId)!;
  assert.deepEqual({ x: loaded.x, z: loaded.z, yaw: loaded.yaw, lift: loaded.lift }, originalPose);
  assert.equal(s.jobs[0].legacyRailHandoff, 'carried');
  let lowered = false,
    withdrew = false,
    previousHeight = Infinity;
  const saved = new Set<string>();
  for (let step = 0; step < 8000; step++) {
    S.tick(s, 0.1);
    conservation(s);
    const j = s.jobs.find((j) => j.id === fixture.jobId)!;
    const fork = s.equipment.find((e) => e.id === fixture.forkId)!;
    const r = j.railWork;
    if (r && ['stage-travel', 'stage-align', 'legacy-fork-withdraw'].includes(r.phase)) {
      const boxes = equipmentBoxes(fork);
      for (const obstacle of staticObstacleRects(s))
        assert.ok(
          !boxOverlap(boxes[0], {
            x: obstacle.x + obstacle.w / 2,
            z: obstacle.z + obstacle.d / 2,
            length: obstacle.w,
            width: obstacle.d,
            yaw: 0,
          }),
          'Imported forklift chassis must avoid the staged panel and fixed objects',
        );
      for (const other of s.equipment.filter((e) => e.id !== fork.id))
        assert.ok(
          !boxes.some((a) => equipmentBoxes(other).some((b) => boxOverlap(a, b))),
          'Imported forklift and its carried panel must avoid the excavator',
        );
      for (const worker of s.workers.filter((w) => !w.vehicle))
        assert.ok(
          !boxes.some((b) => personTouchesBox(worker, b, 0.25)),
          'Imported forklift must not physically pass through its crew',
        );
    }
    if (r?.panel.state === 'carried' && r.phase !== 'stage-lower') {
      const supported = localPoint({ ...fork, yaw: fork.yaw }, fork.reach || 2.7, 0);
      assert.ok(Math.hypot(r.panel.x - supported.x, r.panel.z - supported.z) < 0.02);
      assert.ok(Math.abs(r.panel.yaw - (fork.yaw || 0) - (r.legacyForkYaw || 0)) < 0.001);
    }
    if (r?.phase === 'stage-lower') {
      if (previousHeight < Infinity) assert.ok(r.panel.y <= previousHeight + 1e-8);
      previousHeight = r.panel.y;
      if (r.clock > 0.5) lowered = true;
    }
    if (r?.phase === 'legacy-fork-withdraw') {
      withdrew = true;
      assert.equal(fork.cargo, undefined);
      const stack = s.stacks.find((t) => t.id === r.panel.stackId)!;
      assert.equal(stack.qty, 1);
      assert.equal(stack.baseHeight, 0.06);
      assert.equal(stack.reserved, 1);
      assert.ok(Math.abs(r.panel.y - 0.06) < 1e-9);
    }
    if (r && ['stage-lower', 'legacy-fork-withdraw'].includes(r.phase) && !saved.has(r.phase)) {
      saved.add(r.phase);
      const serialized = JSON.parse(S.save(s));
      s = S.load(S.save(s));
      assert.deepEqual(
        s.jobs.find((j) => j.id === fixture.jobId)!.railWork,
        serialized.jobs[0].railWork,
      );
      assert.deepEqual(s.equipment, serialized.equipment);
    }
    if (j.legacyRailHandoff === 'staged') break;
  }
  assert.ok(lowered && withdrew);
  assert.deepEqual([...saved].sort(), ['legacy-fork-withdraw', 'stage-lower']);
  const j = s.jobs.find((j) => j.id === fixture.jobId)!;
  assert.equal(j.status, 'todo');
  assert.ok(s.workers.every((w) => !w.job));
  assert.ok(s.equipment.every((e) => !e.job));
  assert.equal(s.stacks.filter((t) => t.qty).length, 1);
  s.workers.find((w) => w.id === fixture.operatorId)!.duty = 'auto';
  let sawSupportedSource = false;
  tickUntil(
    s,
    () => j.status === 'done',
    1400,
    () => {
      conservation(s);
      if (j.railWork?.panel.state === 'staged') {
        assert.ok(Math.abs(j.railWork.panel.y - 0.06) < 1e-9);
        if (j.status === 'doing') assert.equal(j.equipment, fixture.craneId);
        sawSupportedSource = true;
      }
    },
  );
  assert.ok(sawSupportedSource);
  assert.deepEqual(s.buffer, { x: 130, z: 5 });
  assert.equal(s.rails.length, 1);
  assert.equal(s.orders.length, 1);
});

test('an installed v3 panel remains installed while its same partly moved buffer is secured by an excavator', () => {
  const fixture = legacyRail('installed');
  let s = S.load(S.save(fixture.s));
  const j = s.jobs.find((j) => j.id === fixture.jobId)!;
  assert.equal(j.legacyRailHandoff, 'installed');
  assert.equal(j.status, 'todo');
  assert.equal(j.delivered, true);
  assert.deepEqual(s.buffer, { x: 127.5, z: 5 });
  assert.equal(s.rails[0].id, 'RAIL-LEGACY');
  assert.ok(s.equipment.every((e) => !e.cargo && !e.job));
  s.workers.find((w) => w.id === fixture.operatorId)!.duty = 'auto';
  let seenBuffer = false,
    saved = false,
    previous = { ...s.buffer };
  for (let step = 0; step < 12000; step++) {
    S.tick(s, 0.1);
    conservation(s);
    const j = s.jobs.find((j) => j.id === fixture.jobId)!;
    assert.equal(s.rails.length, 1);
    assert.equal(s.rails[0].id, 'RAIL-LEGACY');
    assert.ok(
      s.equipment.every((e) => !e.cargo),
      'Buffer-only continuation never consumes another panel',
    );
    assert.ok(
      Math.hypot(s.buffer.x - previous.x, s.buffer.z - previous.z) < 0.8,
      'The original buffer moves continuously',
    );
    previous = { ...s.buffer };
    if (j.railWork?.buffer) {
      assert.equal(j.railWork.buffer.id, 'BUFFER-001');
      if (j.status === 'doing') assert.equal(j.equipment, fixture.craneId);
      seenBuffer = true;
      if (j.railWork.phase === 'buffer-lift-return' && !saved) {
        const buffer = { ...j.railWork.buffer };
        s = S.load(S.save(s));
        assert.deepEqual(s.jobs.find((j) => j.id === fixture.jobId)!.railWork!.buffer, buffer);
        saved = true;
      }
    }
    if (j.status === 'done') break;
  }
  assert.ok(seenBuffer && saved);
  assert.equal(s.jobs.find((j) => j.id === fixture.jobId)!.status, 'done');
  assert.deepEqual(s.buffer, { x: 130, z: 5 });
  assert.equal(s.jobs.find((j) => j.id === fixture.jobId)!.railWork!.buffer!.secured, true);
  assert.equal(s.orders.length, 1);
});

test('canceling a saved legacy forklift handoff finishes safe placement without consuming the panel', () => {
  const fixture = legacyRail('carried');
  let s = S.load(S.save(fixture.s));
  tickUntil(s, () => s.jobs[0].railWork?.phase === 'stage-lower');
  S.cancelJob(s, fixture.jobId);
  s = S.load(S.save(s));
  const j = s.jobs.find((j) => j.id === fixture.jobId)!;
  tickUntil(
    s,
    () => j.status === 'canceled',
    600,
    () => conservation(s),
  );
  assert.equal(s.rails.length, 0);
  assert.deepEqual(s.buffer, { x: 125, z: 5 });
  assert.ok(s.equipment.every((e) => !e.cargo && !e.job));
  assert.ok(s.workers.every((w) => !w.job));
  const staged = s.stacks.find((t) => t.qty > 0)!;
  assert.equal(staged.qty, 1);
  assert.equal(staged.reserved, 0);
  assert.equal(staged.baseHeight, 0.06);
});
