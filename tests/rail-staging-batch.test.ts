import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS, EQUIPMENT } from '../src/catalog';
import { setRailCrew } from '../src/jobs';
import { setEquipmentAssistant } from '../src/work-crews';
import {
  planRailStagingBatch,
  reserveRailStagingBatch,
  reconcileRailStagingBatch,
  releaseUnliftedRailBatch,
  railBatchHeld,
  stagedRailStackOwnedBy,
} from '../src/rail-staging';
import { seedHandlingResources, tickUntil } from './support/yard';
import { boxOverlap, equipmentBoxes, staticObstacleRects } from '../src/traffic';
import { trackGeometry } from '../src/track';
import type { RailWork, Item } from '../src/types';

function fixture(curve = false, modular = false) {
  const s = S.createState();
  const installer = seedHandlingResources(s, 'excavator');
  Object.assign(installer, { x: 100, z: 25 });
  const stager = seedHandlingResources(s, 'excavator');
  Object.assign(stager, { x: 20, z: 35 });
  const builders = s.workers.filter((w) => w.role === 'builder');
  assert.equal(setEquipmentAssistant(s, installer.id, builders[0].id), '');
  assert.equal(setEquipmentAssistant(s, stager.id, builders[1].id), '');
  const jobs = curve
    ? S.planRailLayout(s, 'curve', { x: 125, z: 5 }).jobs
    : [125, 130, 135, 140].map((x) =>
        modular
          ? S.planRailLayout(s, 'straight', { x, z: 5 }).jobs[0]
          : S.plan(s, 'rail', x, 4).job!,
      );
  const group = s.jobGroups!.find((g) => g.id === jobs[0].parentId)!;
  assert.equal(setRailCrew(s, group.id, stager.id, installer.id), '');
  const item: Item = curve ? 'railCurve' : 'rail';
  const material = MATERIALS[item];
  const stack = {
    id: S.id(s, 'stack'),
    item,
    qty: 4,
    reserved: 0,
    x: 30,
    z: 29,
    w: material.w,
    d: material.d,
    source: 'opening',
  };
  s.stacks.push(stack);
  if (curve) s.stacks.push({ ...stack, id: S.id(s, 'stack'), z: 55, qty: 2 });
  return { s, stager, installer, jobs, group, stack, item };
}

test('a staging load takes the largest needed capacity-permitted top stack from one physical source', () => {
  const straight = fixture();
  const lead = straight.jobs[0];
  lead.railStageOnly = true;
  lead.stack = straight.stack.id;
  straight.stack.reserved = 1;
  const batch = planRailStagingBatch(straight.s, lead, straight.stager, straight.stack)!;
  assert.equal(batch.qty, 4);
  assert.equal(batch.qty * MATERIALS.rail.mass <= EQUIPMENT.excavator.capacity, true);
  assert.deepEqual(
    batch.jobIds,
    straight.jobs.map((j) => j.id),
  );
  const curved = fixture(true);
  curved.jobs[0].railStageOnly = true;
  curved.jobs[0].stack = curved.stack.id;
  curved.stack.reserved = 1;
  const curveBatch = planRailStagingBatch(curved.s, curved.jobs[0], curved.stager, curved.stack)!;
  assert.equal(curveBatch.qty, 3, 'Four curved panels exceed the real 6 t lift limit');
  curved.stack.qty = 1;
  assert.equal(
    planRailStagingBatch(curved.s, curved.jobs[0], curved.stager, curved.stack),
    undefined,
    'The nearby second stack is not collected or combined remotely',
  );
});

test('canceling an unlifted sibling shrinks the batch and preserves the remaining source reservations', () => {
  const { s, jobs, stager, stack } = fixture();
  const lead = jobs[0];
  lead.railStageOnly = true;
  lead.stack = stack.id;
  stack.reserved = 1;
  lead.status = 'doing';
  lead.railWork = {
    stagingBatch: planRailStagingBatch(s, lead, stager, stack),
    panel: { state: 'stored', y: 0 },
    source: { stackId: stack.id, pose: { y: 0 } },
  } as RailWork;
  reserveRailStagingBatch(s, lead, stack);
  assert.equal(stack.reserved, 4);
  assert(railBatchHeld(s, jobs[1]));
  S.cancelJob(s, jobs[1].id);
  assert.equal(stack.reserved, 3);
  assert.equal(reconcileRailStagingBatch(s, lead), 3);
  assert.equal(lead.railWork.panel.y, 0.36, 'The remaining top three start above the bottom panel');
  releaseUnliftedRailBatch(s, lead);
  assert.equal(stack.reserved, 1, 'Only the leader reservation remains for its normal release');
  assert.equal(jobs[2].stack, undefined);
  assert.equal(jobs[2].railStagingBatch, undefined);
  assert.equal(lead.railWork.stagingBatch, undefined);
});

test('a real four-panel staging trip survives save/reload, supports the full stack, then installs one panel at a time', () => {
  const { s, jobs, item, stager } = fixture();
  tickUntil(s, () => stager.cargo?.qty === 4, 1200);
  assert.equal(stager.cargo!.item, item);
  assert.equal(s.jobs.filter((j) => railBatchHeld(s, j)).length, 3);
  assert.equal(S.totals(s, item).cargo, 4);
  assert.equal(
    S.missingMaterials(s)[item] || 0,
    0,
    'Held batch members already have their steel aboard',
  );
  Object.assign(s, S.load(S.save(s)));
  const ids = jobs.map((j) => j.id);
  let allPrepared = false;
  tickUntil(
    s,
    () => ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'),
    3600,
    () => {
      const t = S.totals(s, item);
      assert.equal(t.stored + t.cargo + t.installed, 4);
      assert.equal(
        S.missingMaterials(s)[item] || 0,
        0,
        'Shared preparation reservations do not generate duplicate demand',
      );
      if (
        s.jobs
          .filter((j) => ids.includes(j.id))
          .every((j) => j.legacyRailHandoff === 'staged' || j.delivered || j.status === 'done')
      )
        allPrepared = true;
    },
  );
  assert(allPrepared, 'All four panels are available before installation finishes');
  const stagedMoves = s.movements.filter((m) => m.reason.includes('temporary staging supports'));
  assert.equal(stagedMoves.length, 1);
  assert.equal(stagedMoves[0].qty, 4);
  const lifts = s.movements.filter(
    (m) => m.reason === 'Lift staged rail panel for track installation',
  );
  assert.equal(lifts.length, 4);
  assert(lifts.every((m) => m.qty === 1));
  assert.equal(S.totals(s, item).installed, 4);
  S.load(S.save(s));
});

test('canceling a sibling during a loaded trip and clearing the crew preserves all physical panels', () => {
  const { s, jobs, item, stager, group } = fixture();
  tickUntil(s, () => stager.cargo?.qty === 4, 1200);
  S.cancelJob(s, jobs[3].id);
  Object.assign(s, S.load(S.save(s)));
  assert.equal(
    s.equipment.find((e) => e.id === stager.id)!.cargo!.qty,
    4,
    'Canceling a carried sibling never deletes its physical panel',
  );
  assert.equal(setRailCrew(s, group.id), '');
  tickUntil(
    s,
    () =>
      !s.equipment.some((e) => e.cargo) && s.stacks.some((t) => t.railStagingJobs && t.qty === 4),
    2000,
  );
  const prepared = s.stacks.find((t) => t.railStagingJobs && t.qty === 4)!;
  assert.equal(prepared.reserved, 3);
  assert.equal(
    prepared.railStagingJobs!.length,
    4,
    'The canceled physical panel retains its identity',
  );
  assert.equal(
    stagedRailStackOwnedBy(
      s,
      prepared,
      s.jobs.find((j) => j.id === jobs[3].id)!,
    ),
    false,
  );
  assert.equal(S.totals(s, item).stored + S.totals(s, item).cargo + S.totals(s, item).installed, 4);
  S.load(S.save(s));
});

test('the stager prepares every curved panel even while the installation crew is unavailable', () => {
  const { s, jobs, installer, item } = fixture(true);
  const installHelper = s.workers.find((w) => w.assistingEquipment === installer.id)!;
  installHelper.duty = 'rest';
  const installOperator = s.workers.find((w) => w.role === 'operator')!;
  installOperator.duty = 'rest';
  const ids = jobs.map((j) => j.id);
  tickUntil(
    s,
    () => ids.every((id) => s.jobs.find((j) => j.id === id)!.legacyRailHandoff === 'staged'),
    3000,
  );
  assert.equal(s.rails.length, 0, 'Pre-staging is independent of installation progress');
  assert.equal(S.totals(s, item).stored, 6);
  const prepared = s.stacks.filter((t) => t.railStagingJobs?.length);
  assert.equal(
    prepared.reduce((n, t) => n + t.qty, 0),
    6,
  );
  assert.equal(
    prepared.reduce((n, t) => n + t.reserved, 0),
    6,
  );
  const loads = s.movements.filter((m) => m.reason.includes('temporary staging supports'));
  assert(
    loads.some((m) => m.qty === 3),
    'The first real storage stack supplies a 3-panel load',
  );
  assert(loads.every((m) => m.qty * MATERIALS[item].mass <= EQUIPMENT.excavator.capacity));
  S.load(S.save(s));
});

test('canceling every member of a carried batch leaves a real unreserved stack after safe withdrawal', () => {
  const { s, jobs, stager, item } = fixture();
  tickUntil(s, () => stager.cargo?.qty === 4, 1200);
  for (const job of jobs) S.cancelJob(s, job.id);
  tickUntil(s, () => s.jobs.every((j) => j.status === 'canceled'), 2200);
  assert.equal(
    s.equipment.some((e) => !!e.cargo),
    false,
  );
  assert.equal(S.totals(s, item).stored, 4);
  assert.equal(
    s.stacks.reduce((n, t) => n + t.reserved, 0),
    0,
  );
  assert.equal(s.rails.length, 0);
  assert(s.jobs.every((j) => !j.railStagingBatch));
  S.load(S.save(s));
});

test('canceling an unlifted last sibling is immediately saveable and the remaining top three install normally', () => {
  const { s, jobs, item, stack } = fixture();
  const leaderId = jobs[0].id;
  tickUntil(s, () => s.jobs.find((j) => j.id === leaderId)?.railWork?.stagingBatch?.qty === 4, 120);
  assert.equal(stack.reserved, 4);
  assert.equal(s.jobs.find((j) => j.id === leaderId)!.railWork!.panel.state, 'stored');
  S.cancelJob(s, jobs[3].id);
  const leader = s.jobs.find((j) => j.id === leaderId)!;
  assert.equal(leader.railWork!.stagingBatch!.qty, 3);
  assert.equal(stack.reserved, 3);
  assert.equal(s.jobs.find((j) => j.id === jobs[3].id)!.railStagingBatch, undefined);
  assert.equal(leader.railWork!.panel.y, 0.36);
  Object.assign(s, S.load(S.save(s))); // No simulation tick is allowed before this round trip.
  const liveIds = jobs.slice(0, 3).map((j) => j.id);
  tickUntil(
    s,
    () => liveIds.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'),
    3200,
  );
  assert.equal(S.totals(s, item).installed, 3);
  assert.equal(S.totals(s, item).stored, 1);
  assert.equal(S.totals(s, item).reserved, 0);
  assert.equal(s.jobs.find((j) => j.id === jobs[3].id)!.status, 'canceled');
  S.load(S.save(s));
});

test('canceling an unlifted batch leader immediately releases siblings and they can form another real staging load', () => {
  const { s, jobs, item, stack, stager } = fixture();
  const leaderId = jobs[0].id;
  tickUntil(s, () => s.jobs.find((j) => j.id === leaderId)?.railWork?.stagingBatch?.qty === 4, 120);
  S.cancelJob(s, leaderId);
  assert.equal(stack.qty, 4);
  assert.equal(stack.reserved, 1, 'The stopping leader keeps only its own reservation');
  assert(jobs.slice(1).every((j) => !j.railStagingBatch && !j.stack));
  Object.assign(s, S.load(S.save(s))); // Pending safe cancellation is valid even while paused.
  tickUntil(s, () => s.equipment.find((e) => e.id === stager.id)?.cargo?.qty === 3, 1300);
  assert.equal(s.jobs.find((j) => j.id === leaderId)!.status, 'canceled');
  assert(s.jobs.every((j) => j.railStagingBatch !== leaderId));
  assert.equal(S.totals(s, item).stored + S.totals(s, item).cargo + S.totals(s, item).installed, 4);
  assert.equal(S.missingMaterials(s)[item] || 0, 0);
  S.load(S.save(s));
});

test('canceling a whole unlifted batch before another tick immediately saves and releases all reserved steel', () => {
  const { s, jobs, item, stack } = fixture();
  tickUntil(s, () => s.jobs[0].railWork?.stagingBatch?.qty === 4, 120);
  for (const j of jobs) S.cancelJob(s, j.id);
  assert.equal(stack.reserved, 1);
  Object.assign(s, S.load(S.save(s)));
  tickUntil(s, () => s.jobs.every((j) => j.status === 'canceled'), 2);
  assert.equal(S.totals(s, item).stored, 4);
  assert.equal(S.totals(s, item).reserved, 0);
  assert.equal(S.totals(s, item).cargo, 0);
  assert.equal(s.rails.length, 0);
  assert(s.jobs.every((j) => !j.railStagingBatch));
  S.load(S.save(s));
});

for (const curve of [false, true])
  test(`a canceled shared staged ${curve ? 'six-panel curve' : 'four-panel straight'} survives save/reload and resumes its physical steel`, () => {
    const { s, jobs, installer, item } = fixture(curve, !curve);
    const helperId = s.workers.find((w) => w.assistingEquipment === installer.id)!.id;
    const operatorId = s.workers.find((w) => w.role === 'operator')!.id;
    for (const id of [helperId, operatorId]) s.workers.find((w) => w.id === id)!.duty = 'rest';
    const ids = jobs.map((j) => j.id);
    tickUntil(
      s,
      () => ids.every((id) => s.jobs.find((j) => j.id === id)!.legacyRailHandoff === 'staged'),
      3000,
    );
    const canceledId = ids[2];
    const stackId = s.jobs.find((j) => j.id === canceledId)!.stack!;
    const stagingTrips = s.movements.filter((m) =>
      m.reason.includes('temporary staging supports'),
    ).length;
    S.cancelJob(s, canceledId);
    Object.assign(s, S.load(S.save(s)));
    assert.equal(s.jobs.find((j) => j.id === canceledId)!.stack, undefined);
    assert(s.stacks.find((t) => t.id === stackId)!.railStagingJobs!.includes(canceledId));
    const remaining = s.stacks.find((t) => t.id === stackId)!;
    const batchQty = curve ? 3 : 4;
    assert.equal(remaining.qty, batchQty);
    assert.equal(remaining.reserved, batchQty - 1);
    assert(remaining.railStagingJobs!.includes(canceledId));
    assert.equal(S.resumeTrackWork(s, canceledId), '');
    const resumed = s.jobs.find((j) => j.id === canceledId)!;
    assert.equal(resumed.stack, stackId);
    assert.equal(resumed.legacyRailHandoff, 'staged');
    assert.equal(remaining.reserved, batchQty);
    assert.equal(S.missingMaterials(s)[item] || 0, 0);
    Object.assign(s, S.load(S.save(s)));
    for (const id of [helperId, operatorId]) s.workers.find((w) => w.id === id)!.duty = 'auto';
    let loadedRoundTrip = false,
      recoveredOldBufferTarget = false;
    tickUntil(
      s,
      () => ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'),
      1800,
      () => {
        for (const e of s.equipment) {
          const chassis = equipmentBoxes(e)[0];
          for (const rect of staticObstacleRects(s))
            assert(
              !boxOverlap(chassis, {
                x: rect.x + rect.w / 2,
                z: rect.z + rect.d / 2,
                length: rect.w,
                width: rect.d,
                yaw: 0,
              }),
              `${e.id} chassis crossed ${rect.id}`,
            );
        }
        const totals = S.totals(s, item);
        assert.equal(totals.stored + totals.cargo + totals.installed, ids.length);
        const first = s.jobs.find((j) => j.id === ids[0])!;
        if (curve && !recoveredOldBufferTarget && first.railWork?.phase === 'buffer-carry-aside') {
          // Reproduce the pre-fix saved destination, selected before the later
          // staging stack occupied the crane's rear parking/turning clearance.
          const r = first.railWork,
            geometry = trackGeometry(first);
          const p = { x: r.stage.x + r.stage.w / 2, z: r.stage.z + r.stage.d / 2 };
          const gap = Math.abs(
            (p.x - geometry.pose.x) * r.side.x + (p.z - geometry.pose.z) * r.side.z,
          );
          r.bufferAside = {
            x: r.start.x + r.side.x * gap - 8 * Math.cos(geometry.entry.yaw + Math.PI),
            z: r.start.z + r.side.z * gap - 8 * Math.sin(geometry.entry.yaw + Math.PI),
          };
          Object.assign(s, S.load(S.save(s)));
          recoveredOldBufferTarget = true;
        }
        if (!loadedRoundTrip && s.equipment.find((e) => e.id === installer.id)?.cargo) {
          Object.assign(s, S.load(S.save(s)));
          loadedRoundTrip = true;
        }
      },
    );
    assert(loadedRoundTrip, 'Save/reload also retains the installer carrying one real panel');
    assert.equal(S.totals(s, item).installed, ids.length);
    assert.equal(S.totals(s, item).stored, 0);
    assert.equal(
      s.movements.filter((m) => m.reason.includes('temporary staging supports')).length,
      stagingTrips,
    );
    assert.equal(
      s.events.filter(
        (e) => e.entity === 'BUFFER-001' && /released the existing buffer rail clamps/.test(e.text),
      ).length,
      1,
    );
    assert.equal(
      s.events.filter((e) => e.entity === 'BUFFER-001' && /secured the same buffer/.test(e.text))
        .length,
      1,
    );
    const end = trackGeometry(s.jobs.find((j) => j.id === ids.at(-1))!).end;
    assert(Math.hypot(s.buffer.x - end.x, s.buffer.z - end.z) < 0.02);
    if (curve) {
      assert(recoveredOldBufferTarget);
      assert(
        s.events.some((e) => /accessible alternate buffer resting place/.test(e.text)),
        'A carried legacy buffer reroutes physically around the new staged stock',
      );
    }
    S.load(S.save(s));
  });

test('canceling the shared leader after lowering releases its reservation after safe withdrawal and can resume', () => {
  const { s, jobs, installer, item } = fixture(false, true);
  for (const w of s.workers.filter(
    (w) =>
      w.assistingEquipment === installer.id ||
      w.id === s.workers.find((w) => w.role === 'operator')!.id,
  ))
    w.duty = 'rest';
  const leaderId = jobs[0].id;
  tickUntil(
    s,
    () => s.jobs.find((j) => j.id === leaderId)!.railWork?.phase === 'legacy-fork-withdraw',
    2000,
  );
  const before = s.jobs.find((j) => j.id === leaderId)!;
  const stackId = before.railWork!.panel.stackId!;
  assert.equal(s.stacks.find((t) => t.id === stackId)!.reserved, 4);
  S.cancelJob(s, leaderId);
  Object.assign(s, S.load(S.save(s)));
  tickUntil(s, () => s.jobs.find((j) => j.id === leaderId)!.status === 'canceled', 600);
  const prepared = s.stacks.find((t) => t.id === stackId)!;
  assert.equal(prepared.qty, 4);
  assert.equal(prepared.reserved, 3);
  assert(prepared.railStagingJobs!.includes(leaderId));
  Object.assign(s, S.load(S.save(s)));
  assert.equal(S.resumeTrackWork(s, leaderId), '');
  assert.equal(s.jobs.find((j) => j.id === leaderId)!.stack, stackId);
  assert.equal(s.stacks.find((t) => t.id === stackId)!.reserved, 4);
  for (const w of s.workers) w.duty = 'auto';
  tickUntil(
    s,
    () => jobs.every((j) => s.jobs.find((live) => live.id === j.id)!.status === 'done'),
    6000,
  );
  assert.equal(S.totals(s, item).installed, 4);
  assert.equal(S.totals(s, item).stored, 0);
  assert.equal(S.totals(s, item).reserved, 0);
  S.load(S.save(s));
});
