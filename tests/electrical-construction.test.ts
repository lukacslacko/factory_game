import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources } from './support/yard';
import { electricalValidationProblem } from '../src/electrical-validation';
import { electricalConsumerPower } from '../src/electrical-network';
import { equipmentSweepBlocked, workerMoveBlocked } from '../src/traffic';
import { angleDelta } from '../src/motion';
import { setJobEquipment } from '../src/jobs';
function fixture() {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  s.workers[1].role = 'engineer';
  s.workers[1].wage = 42;
  const source = {
      id: S.id(s, 'building'),
      kind: 'power' as const,
      x: 20,
      z: 20,
      w: 1,
      d: 1,
      rotation: 0,
      connected: true,
      name: 'Incoming16kW',
    },
    target = {
      id: S.id(s, 'building'),
      kind: 'lamp' as const,
      x: 20,
      z: 23,
      w: 1,
      d: 1,
      rotation: 0,
      connected: false,
      name: 'Light',
    };
  s.buildings.push(source, target);
  s.utilities.power = true;
  const reel = {
    id: S.id(s, 'stack'),
    item: 'cableReel' as const,
    x: 32,
    z: 30,
    w: 1,
    d: 1,
    qty: 1,
    reserved: 0,
    cableMeters: 50,
    source: 'opening',
  };
  s.stacks.push(reel);
  const request = {
    sourceId: source.id,
    targetId: target.id,
    cells: [
      { x: 20, z: 21 },
      { x: 20, z: 22 },
    ],
  };
  return { s, e, source, target, reel, request };
}
function wireTotal(s: ReturnType<typeof S.createState>) {
  return (
    s.stacks.filter((t) => t.item === 'cableReel').reduce((n, t) => n + (t.cableMeters ?? 50), 0) +
    (s.electrical?.runs || []).reduce(
      (n, r) => n + r.cableInHand + r.cells.filter((c) => c.cableInstalled && !r.creative).length,
      0,
    )
  );
}
function safeTick(s: ReturnType<typeof S.createState>, expectedMeters = 50) {
  const machines = s.equipment.map((e) => ({ ...e, path: e.path.slice() })),
    workers = s.workers.map((w) => ({ ...w, path: w.path.slice() }));
  S.tick(s, 0.1);
  assert.equal(electricalValidationProblem(s), undefined);
  assert.equal(wireTotal(s), expectedMeters);
  for (const old of machines) {
    const now = s.equipment.find((e) => e.id === old.id)!;
    assert.ok(Math.hypot(now.x - old.x, now.z - old.z) <= 0.32);
    if (
      Math.hypot(now.x - old.x, now.z - old.z) > 1e-7 ||
      Math.abs(angleDelta(old.yaw || 0, now.yaw || 0)) > 1e-7
    )
      assert.equal(equipmentSweepBlocked(s, old, now), '');
  }
  for (const old of workers) {
    const now = s.workers.find((w) => w.id === old.id)!;
    if (old.vehicle || now.vehicle || old.transition || now.transition) continue;
    assert.ok(Math.hypot(now.x - old.x, now.z - old.z) <= 0.171);
    if (Math.hypot(now.x - old.x, now.z - old.z) > 1e-7)
      assert.equal(workerMoveBlocked(s, old, now), '');
  }
}
test('real engineer and excavator deliver a finite reel, excavate, lay, backfill and test a circuit through reload', () => {
  let { s, request, target } = fixture();
  const planned = S.planElectrical(s, request);
  assert.equal(planned.error, undefined);
  const phases = new Set<string>(),
    saved = new Set<string>();
  for (let n = 0; n < 15000 && s.electrical!.runs[0].status !== 'commissioned'; n++) {
    const r = s.electrical!.runs[0];
    phases.add(r.phase);
    if (r.phase === 'collect-cable' || r.phase === 'lay') {
      assert.ok(
        r.cells.every((c) => c.excavation === 1),
        'whole trench opens before cable pulling',
      );
      assert.ok(
        r.cells.every((c) => c.backfilled === 0),
        'cable is laid through the open run',
      );
    }
    if (r.phase.startsWith('backfill')) {
      assert.ok(
        r.cells.every((c) => c.cableInstalled),
        'no backfill before the full cable run is laid',
      );
      assert.ok(
        r.sourceTerminated && r.targetTerminated,
        'both endpoints terminate before restoration',
      );
    }
    if (r.status === 'working' && !saved.has(r.phase)) {
      s = S.load(S.save(s));
      saved.add(r.phase);
    }
    safeTick(s);
  }
  assert.equal(
    s.electrical!.runs[0].status,
    'commissioned',
    JSON.stringify({ r: s.electrical!.runs[0], e: s.equipment, w: s.workers }),
  );
  assert.ok(phases.has('dump-spoil'));
  assert.ok(phases.has('backfill'));
  assert.ok(phases.has('lay'));
  assert.equal(s.stacks[0].cableMeters, 48);
  assert.equal(electricalConsumerPower(s, target.id).powered, true);
});
export { fixture, wireTotal, safeTick };

function until(
  s: ReturnType<typeof S.createState>,
  predicate: () => boolean,
  limit = 18000,
  expectedMeters = 50,
) {
  for (let n = 0; n < limit && !predicate(); n++) safeTick(s, expectedMeters);
  assert.ok(
    predicate(),
    JSON.stringify({ run: s.electrical?.runs[0], e: s.equipment, w: s.workers }),
  );
}
test('cancellation carries unlaid cable back to its actual reel, backfills, and resumes without loss', () => {
  let { s, request } = fixture();
  assert.equal(S.planElectrical(s, request).error, undefined);
  until(s, () => s.electrical!.runs[0].phase === 'lay');
  let r = s.electrical!.runs[0];
  assert.equal(r.cableInHand, 1);
  const reel = s.stacks.find((t) => t.id === r.reelId)!;
  assert.equal(reel.cableMeters, 49);
  assert.equal(S.cancelElectrical(s, r.id), undefined);
  s = S.load(S.save(s));
  r = s.electrical!.runs[0];
  until(s, () => r.phase === 'return-cable');
  const w = s.workers.find((w) => w.id === r.workerId)!;
  const before = { x: w.x, z: w.z };
  assert.equal(s.stacks.find((t) => t.id === r.reelId)!.cableMeters, 49);
  until(s, () => r.status === 'canceled');
  assert.equal(s.stacks.find((t) => t.id === r.reelId)!.cableMeters, 50);
  assert.equal(r.cableInHand, 0);
  assert.ok(Math.hypot(w.x - before.x, w.z - before.z) > 1);
  assert.ok(r.cells.every((c) => c.excavation === c.backfilled && c.spoilM3 === 0));
  assert.equal(S.resumeElectrical(s, r.id), undefined);
  until(s, () => r.status === 'commissioned');
  assert.equal(wireTotal(s), 50);
  assert.equal(r.cells.filter((c) => c.cableInstalled).length, 2);
});
test('commissioned wire is physically isolated, dug up and returned to finite reels through reload', () => {
  let { s, request, target } = fixture();
  assert.equal(S.planElectrical(s, request).error, undefined);
  until(s, () => s.electrical!.runs[0].status === 'commissioned');
  let r = s.electrical!.runs[0];
  assert.equal(S.recoverElectrical(s, r.id), undefined);
  assert.equal(
    electricalConsumerPower(s, target.id).powered,
    true,
    'queuing recovery does not magically operate its source isolator',
  );
  const phases = new Set<string>();
  let previousProgress = 0;
  assert.equal(s.jobs.find((j) => j.id === r.jobId)!.progress, 0);
  for (let n = 0; n < 18000 && r.status !== 'canceled'; n++) {
    if (!phases.has(r.phase)) {
      phases.add(r.phase);
      s = S.load(S.save(s));
      r = s.electrical!.runs[0];
    }
    if (r.phase === 'recover-cable')
      assert.ok(
        r.cells.every((c) => c.excavation === 1),
        'the full isolated route is opened before cable retrieval',
      );
    if (r.phase.startsWith('backfill'))
      assert.ok(
        r.cells.every((c) => !c.cableInstalled),
        'normal recovery retrieves the full cable run before restoration',
      );
    safeTick(s);
    const progress = s.jobs.find((j) => j.id === r.jobId)!.progress;
    assert.ok(progress >= previousProgress, 'recovery progress counts restored cells forward');
    previousProgress = progress;
  }
  assert.equal(previousProgress, 1);
  assert.equal(r.status, 'canceled', JSON.stringify({ r, e: s.equipment, w: s.workers }));
  assert.ok(phases.has('isolate-source'));
  assert.ok(phases.has('isolate-target'));
  assert.ok(phases.has('recover-cable'));
  assert.ok(phases.has('return-cable'));
  assert.equal(r.cells.filter((c) => c.cableInstalled).length, 0);
  assert.equal(
    s.stacks.filter((t) => t.item === 'cableReel').reduce((n, t) => n + (t.cableMeters || 0), 0),
    50,
  );
  assert.equal(electricalConsumerPower(s, target.id).powered, false);
  assert.equal(r.cableInHand, 0);
  assert.equal(r.soilInBucketM3, 0);
  assert.ok(r.cells.every((c) => c.excavation === c.backfilled && c.spoilM3 === 0));
  s.buildings = s.buildings.filter((b) => b.id !== target.id);
  assert.equal(electricalValidationProblem(s), undefined);
  assert.doesNotThrow(() => S.load(S.save(s)));
});
test('manual electrical crew holds safely, warns once and resumes under automatic control', () => {
  const { s, request } = fixture();
  assert.equal(S.planElectrical(s, request).error, undefined);
  until(s, () => s.electrical!.runs[0].phase === 'dig');
  const r = s.electrical!.runs[0],
    w = s.workers.find((w) => w.id === r.workerId)!;
  w.duty = 'manual';
  const removed = r.cells[0].soilRemovedM3;
  for (let n = 0; n < 250; n++) safeTick(s);
  assert.equal(r.cells[0].soilRemovedM3, removed);
  assert.equal(
    s.notices.filter((n) => n.entity === r.jobId && n.title === 'Electrical construction blocked')
      .length,
    1,
  );
  w.duty = 'auto';
  until(s, () => r.status === 'commissioned');
});
test('terminal dock chooses a real reverse approach and clears its engineer over five cells', () => {
  const { s, e, source, target, reel } = fixture();
  Object.assign(e, { x: 27.5, z: 35.5 });
  Object.assign(s.workers[0], { x: 22.5, z: 35.5 });
  Object.assign(s.workers[1], { x: 22.5, z: 38.5 });
  Object.assign(source, { x: 30, z: 30 });
  Object.assign(target, { x: 36, z: 30 });
  Object.assign(reel, { x: 24, z: 40 });
  assert.equal(
    S.planElectrical(s, {
      sourceId: source.id,
      targetId: target.id,
      cells: Array.from({ length: 5 }, (_, i) => ({ x: 31 + i, z: 30 })),
    }).error,
    undefined,
  );
  until(s, () => s.electrical!.runs[0].status === 'commissioned', 20000);
  assert.equal(reel.cableMeters, 45);
  assert.equal(electricalConsumerPower(s, target.id).powered, true);
});
test('existing paving is physically lifted, staged and restored around finite trench construction', () => {
  let { s, request } = fixture();
  s.paving['20,21'] = 'opening';
  s.paving['20,22'] = 'opening';
  assert.equal(S.planElectrical(s, request).error, undefined);
  const phases = new Set<string>();
  for (let n = 0; n < 18000 && s.electrical!.runs[0].status !== 'commissioned'; n++) {
    phases.add(s.electrical!.runs[0].phase);
    safeTick(s);
    if (s.electrical!.runs[0].cells.some((c) => c.slabCarried)) s = S.load(S.save(s));
  }
  assert.equal(s.electrical!.runs[0].status, 'commissioned', JSON.stringify(s.electrical!.runs[0]));
  assert.ok(phases.has('lift-paving'));
  assert.ok(phases.has('restore-paving'));
  assert.equal(s.paving['20,21'], 'opening');
  assert.equal(s.paving['20,22'], 'opening');
  assert.ok(s.electrical!.runs[0].cells.every((c) => c.slabRestored && !c.slabCarried));
});
test('a late manual pedestrian prevents ground removal and clears physically when released', () => {
  const { s, request } = fixture();
  assert.equal(S.planElectrical(s, request).error, undefined);
  until(s, () => s.electrical!.runs[0].phase === 'dig');
  const r = s.electrical!.runs[0],
    cell = r.cells[0];
  const visitor = {
    ...s.workers[1],
    id: S.id(s, 'worker'),
    name: 'Worker #3',
    role: 'builder' as const,
    duty: 'manual' as import('../src/types').Worker['duty'],
    x: cell.x + 0.5,
    z: cell.z + 0.5,
    job: undefined,
    path: [],
    vehicle: undefined,
    transition: undefined,
  };
  s.workers.push(visitor);
  const before = cell.soilRemovedM3;
  for (let n = 0; n < 80; n++) safeTick(s);
  assert.equal(cell.soilRemovedM3, before);
  assert.match(r.reason, /occupies the electrical work patch/);
  visitor.duty = 'auto';
  until(s, () => r.status === 'commissioned');
  assert.ok(Math.hypot(visitor.x - cell.x - 0.5, visitor.z - cell.z - 0.5) > 1);
});
for (const phase of ['reel-lift', 'swing-spoil', 'swing-trench', 'terminate-source'] as const)
  test(`cancel during ${phase} keeps cargo and soil physical, reloads and resumes`, () => {
    let { s, request } = fixture();
    assert.equal(S.planElectrical(s, request).error, undefined);
    until(s, () => s.electrical!.runs[0].phase === phase);
    const id = s.electrical!.runs[0].id;
    assert.equal(S.cancelElectrical(s, id), undefined);
    s = S.load(S.save(s));
    let r = s.electrical!.runs[0];
    until(s, () => r.status === 'canceled');
    assert.equal(r.cableInHand, 0);
    assert.equal(r.soilInBucketM3, 0);
    assert.ok(!s.equipment[0].cargo);
    assert.ok(
      r.cells.every((c) => Math.abs(c.excavation - c.backfilled) < 1e-7 && c.spoilM3 === 0),
    );
    s = S.load(S.save(s));
    r = s.electrical!.runs[0];
    assert.equal(S.resumeElectrical(s, id), undefined);
    until(s, () => r.status === 'commissioned');
    assert.equal(wireTotal(s), 50);
  });
test('interrupted cable recovery returns its held meter, restores soil and can resume recovery', () => {
  let { s, request } = fixture();
  assert.equal(S.planElectrical(s, request).error, undefined);
  until(s, () => s.electrical!.runs[0].status === 'commissioned');
  let r = s.electrical!.runs[0];
  assert.equal(S.recoverElectrical(s, r.id), undefined);
  until(s, () => r.phase === 'return-cable');
  assert.equal(r.cableInHand, 1);
  assert.equal(S.cancelElectrical(s, r.id), undefined);
  s = S.load(S.save(s));
  r = s.electrical!.runs[0];
  until(s, () => r.status === 'canceled');
  assert.equal(r.cells.filter((c) => c.cableInstalled).length, 1);
  assert.equal(r.cableInHand, 0);
  assert.equal(S.recoverElectrical(s, r.id), undefined);
  until(s, () => r.status === 'canceled');
  assert.equal(r.cells.filter((c) => c.cableInstalled).length, 0);
  assert.equal(s.stacks[0].cableMeters, 50);
});
test('a real L-shaped underground route clears both excavation faces and commissions', () => {
  const { s, source, target } = fixture();
  Object.assign(target, { x: 23, z: 23 });
  const cells = [
    { x: 20, z: 21 },
    { x: 20, z: 22 },
    { x: 20, z: 23 },
    { x: 21, z: 23 },
    { x: 22, z: 23 },
  ];
  assert.equal(
    S.planElectrical(s, { sourceId: source.id, targetId: target.id, cells }).error,
    undefined,
  );
  until(s, () => s.electrical!.runs[0].status === 'commissioned', 20000);
  assert.equal(s.stacks[0].cableMeters, 45);
  assert.equal(electricalConsumerPower(s, target.id).powered, true);
});
test('exhausting a2m reel physically stages a second50m reel and conserves every meter', () => {
  let { s, source, target, reel } = fixture();
  Object.assign(target, { x: 20, z: 26 });
  reel.cableMeters = 2;
  const second = { ...reel, id: S.id(s, 'stack'), x: 40, z: 30, cableMeters: 50 };
  s.stacks.push(second);
  const firstId = reel.id,
    secondId = second.id;
  assert.equal(
    S.planElectrical(s, {
      sourceId: source.id,
      targetId: target.id,
      cells: Array.from({ length: 5 }, (_, i) => ({ x: 20, z: 21 + i })),
    }).error,
    undefined,
  );
  const staged = new Set<string>();
  for (let n = 0; n < 22000 && s.electrical!.runs[0].status !== 'commissioned'; n++) {
    const r = s.electrical!.runs[0];
    if (r.phase === 'reel-lift' && r.reelId && !staged.has(r.reelId)) {
      staged.add(r.reelId);
      s = S.load(S.save(s));
    }
    safeTick(s, 52);
  }
  assert.equal(
    s.electrical!.runs[0].status,
    'commissioned',
    JSON.stringify({ r: s.electrical!.runs[0], e: s.equipment, w: s.workers }),
  );
  assert.equal(staged.size, 2);
  assert.equal(s.stacks.find((t) => t.id === firstId)!.cableMeters, 0);
  assert.equal(s.stacks.find((t) => t.id === secondId)!.cableMeters, 47);
  assert.equal(s.stacks.find((t) => t.id === firstId)!.qty, 1, 'empty real reel remains');
  assert.equal(wireTotal(s), 52);
});
test('canceling queued recovery keeps the live circuit physically unchanged and energized', () => {
  const { s, request, target } = fixture();
  assert.equal(S.planElectrical(s, request).error, undefined);
  until(s, () => s.electrical!.runs[0].status === 'commissioned');
  const r = s.electrical!.runs[0];
  assert.equal(S.recoverElectrical(s, r.id), undefined);
  assert.equal(S.cancelElectrical(s, r.id), undefined);
  safeTick(s);
  assert.equal(r.status, 'commissioned');
  assert.equal(r.recovering, false);
  assert.equal(electricalConsumerPower(s, target.id).powered, true);
  assert.equal(s.stacks[0].cableMeters, 48);
  assert.match(r.reason, /before physical source isolation/);
  assert.doesNotThrow(() => S.load(S.save(s)));
});

test('continuous cable pulling walks an open five-meter trench with only one initial reel visit', () => {
  const { s, source, target } = fixture();
  target.z = 26;
  assert.equal(
    S.planElectrical(s, {
      sourceId: source.id,
      targetId: target.id,
      cells: Array.from({ length: 5 }, (_, i) => ({ x: 20, z: 21 + i })),
    }).error,
    undefined,
  );
  const r = s.electrical!.runs[0];
  let collecting = 0,
    previous = '';
  for (let n = 0; n < 22000 && r.status !== 'commissioned'; n++) {
    if (r.phase === 'collect-cable' && previous !== r.phase) collecting++;
    if (r.phase === 'pull-cable') {
      assert.ok(r.cells.every((c) => c.excavation === 1 && c.backfilled === 0));
      assert.ok(r.cells.slice(0, r.cellIndex).every((c) => c.cableInstalled));
    }
    previous = r.phase;
    safeTick(s);
  }
  assert.equal(r.status, 'commissioned', JSON.stringify(r));
  assert.equal(
    collecting,
    1,
    'engineer continuously pulls cable instead of fetching individual meter lengths',
  );
  assert.equal(s.electrical!.meterLedger.filter((row) => row.from.endsWith('/HAND')).length, 5);
});
test('canceling late excavation restores every open cell and lifted paving through reload', () => {
  let { s, source, target } = fixture();
  target.z = 27;
  for (let z = 21; z <= 26; z++) s.paving[`20,${z}`] = 'opening';
  assert.equal(
    S.planElectrical(s, {
      sourceId: source.id,
      targetId: target.id,
      cells: Array.from({ length: 6 }, (_, i) => ({ x: 20, z: 21 + i })),
    }).error,
    undefined,
  );
  until(
    s,
    () => s.electrical!.runs[0].cellIndex === 4 && s.electrical!.runs[0].phase === 'dig-lift',
    26000,
  );
  let r = s.electrical!.runs[0];
  assert.equal(r.cells.filter((c) => c.excavation > 0 && c.backfilled === 0).length, 5);
  assert.ok(r.soilInBucketM3 > 0);
  assert.equal(S.cancelElectrical(s, r.id), undefined);
  s = S.load(S.save(s));
  r = s.electrical!.runs[0];
  until(s, () => r.status === 'canceled', 26000);
  assert.equal(r.soilInBucketM3, 0);
  assert.equal(r.cableInHand, 0);
  assert.ok(
    r.cells.every((c) => c.spoilM3 === 0 && c.excavation === c.backfilled && !c.slabCarried),
  );
  for (let z = 21; z <= 26; z++) assert.equal(s.paving[`20,${z}`], 'opening');
  s = S.load(S.save(s));
  r = s.electrical!.runs[0];
  assert.equal(S.resumeElectrical(s, r.id), undefined);
  until(s, () => r.status === 'commissioned', 30000);
  assert.equal(wireTotal(s), 50);
});
test('soil is lifted above grade before every lateral excavator bucket swing', () => {
  let { s, request } = fixture();
  assert.equal(S.planElectrical(s, request).error, undefined);
  const phases = new Set<string>();
  let r = s.electrical!.runs[0];
  for (let n = 0; n < 22000 && r.status !== 'commissioned'; n++) {
    const e = s.equipment[0];
    phases.add(r.phase);
    if (r.phase === 'dig-lift' || r.phase === 'backfill-lift') {
      assert.ok(r.soilInBucketM3 > 0, 'lift keeps excavated soil inside the bucket');
      if (!phases.has('saved-' + r.phase)) {
        phases.add('saved-' + r.phase);
        s = S.load(S.save(s));
        r = s.electrical!.runs[0];
      }
    }
    if (r.phase === 'swing-spoil' || r.phase === 'swing-trench') {
      assert.ok((e.lift || 0) >= 1.09, `bucket cannot travel laterally underground in ${r.phase}`);
      assert.ok(r.soilInBucketM3 > 0);
    }
    safeTick(s);
  }
  assert.equal(r.status, 'commissioned', JSON.stringify(r));
  assert.ok(phases.has('dig-lift') && phases.has('backfill-lift'));
});

test('manual excavator assignment takes over after the current safe excavation pass', () => {
  const { s, e, source, target } = fixture();
  target.z = 26;
  const replacement = { ...e, id: S.id(s, 'equipment'), x: 40.5, z: 40.5, path: [] };
  s.equipment.push(replacement);
  s.workers.push({
    ...s.workers[0],
    id: S.id(s, 'worker'),
    name: 'Worker #3',
    x: 38.5,
    z: 40.5,
    path: [],
  });
  assert.equal(
    S.planElectrical(s, {
      sourceId: source.id,
      targetId: target.id,
      cells: Array.from({ length: 5 }, (_, i) => ({ x: 20, z: 21 + i })),
    }).error,
    undefined,
  );
  const r = s.electrical!.runs[0];
  until(s, () => r.phase === 'dig-lift');
  assert.equal(r.equipmentId, e.id);
  assert.equal(setJobEquipment(s, r.jobId, replacement.id), '');
  until(s, () => r.equipmentId === replacement.id, 12000);
  assert.equal(
    r.cells.filter((c) => c.excavation === 1).length,
    1,
    'manual change applies at the first empty-bucket boundary, not after the whole trench',
  );
  until(s, () => r.status === 'commissioned', 24000);
  assert.equal(r.equipmentId, replacement.id);
});

test('finishing electrical work clears an old tool blocker and releases a bystander for later construction', () => {
  const { s, e, request } = fixture();
  const result = S.planElectrical(s, request);
  assert.equal(result.error, undefined);
  const run = s.electrical!.runs[0],
    job = s.jobs.find((j) => j.id === result.jobId)!;
  for (let n = 0; n < 20000 && run.phase !== 'test'; n++) safeTick(s);
  assert.equal(run.phase, 'test');
  const worker = {
    ...s.workers[1],
    id: S.id(s, 'worker'),
    name: 'Worker #3',
    role: 'builder' as const,
    wage: 28,
    x: e.x + 5,
    z: e.z + 5,
    path: [],
    job: undefined,
    yieldingTo: e.id,
    status: 'Available',
  };
  s.workers.push(worker);
  e.blockedBy = worker.id;
  for (let n = 0; n < 100 && job.status !== 'done'; n++) safeTick(s);
  assert.equal(job.status, 'done');
  assert.equal(e.blockedBy, undefined, 'The completed action cannot retain its historical blocker');
  safeTick(s);
  assert.equal(
    worker.yieldingTo,
    undefined,
    'An unrelated bystander is not reserved after completion',
  );
  assert.equal(e.job, undefined);
  assert.equal(e.cargo, undefined);
  assert.equal(wireTotal(s), 50);
});
