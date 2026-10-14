import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { diagnoseLogisticsDependencies } from '../src/logistics-dependencies';
import { seedHandlingResources } from './support/yard';

test('explicit clearance links distinguish moving workers, manual control, stock, and fixed structures', () => {
  let s = S.createState();
  seedHandlingResources(s, 'excavator');
  const worker = s.workers.find((w) => w.role !== 'operator')!;
  const j = S.plan(s, 'lamp', 40, 40).job!;
  j.reason = 'Waiting for the placement area to clear';
  s.elapsed = 40;
  s.actionClearances = [{ ownerId: j.id, action: 'Lower lamp kit',
    blockerIds: [worker.id], since: 12, lastSeen: 40, retryAt: 40,
    point: { x: 40.5, z: 40.5 } }];
  const before = S.save(s);
  let row = diagnoseLogisticsDependencies(s).diagnoses.find((r) => r.id === j.id)!;
  assert.equal(row.classification, 'temporary');
  assert.deepEqual(row.blockerIds, [worker.id]);
  assert.equal(row.waitSeconds, 28);
  assert.equal(row.edges[0].kind, 'action-clearance');
  assert.deepEqual(row.edges[0].point, { x: 40.5, z: 40.5 });
  assert.equal(S.save(s), before, 'Diagnosis never edits the site or notices');
  s = S.load(before);
  assert.deepEqual(diagnoseLogisticsDependencies(s).diagnoses.find((r) => r.id === j.id), row);

  s.workers.find((w) => w.id === worker.id)!.duty = 'manual';
  row = diagnoseLogisticsDependencies(s).diagnoses.find((r) => r.id === j.id)!;
  assert.equal(row.classification, 'player-action');

  s.stacks.push({ id: 'STK-TEST', item: 'slab', x: 42, z: 42,
    w: 1, d: 1, qty: 1, reserved: 0, source: 'opening' });
  s.actionClearances![0].blockerIds = ['STK-TEST'];
  row = diagnoseLogisticsDependencies(s).diagnoses.find((r) => r.id === j.id)!;
  assert.equal(row.classification, 'physical-relocation',
    'Movable material still needs a checked physical relocation');

  s.buildings.push({ id: 'BLD-FIXED', kind: 'office', name: 'Fixed shed',
    x: 45, z: 45, w: 4, d: 2, rotation: 0, connected: false });
  s.actionClearances![0].blockerIds = ['BLD-FIXED'];
  row = diagnoseLogisticsDependencies(s).diagnoses.find((r) => r.id === j.id)!;
  assert.equal(row.classification, 'fixed');
  assert.deepEqual(row.blockerIds, ['BLD-FIXED']);
});

test('mutual traffic blockage yields a bounded cycle, retaining linked actors after save/reload', () => {
  let s = S.createState();
  const a = seedHandlingResources(s, 'excavator');
  const b = seedHandlingResources(s, 'forklift');
  s.elapsed = 35;
  a.blockedBy = b.id;
  b.blockedBy = a.id;
  a.trafficBlockedSince = 10;
  b.trafficBlockedSince = 12;
  const first = diagnoseLogisticsDependencies(s);
  for (const e of [a, b]) {
    const row = first.diagnoses.find((r) => r.id === e.id)!;
    assert.equal(row.classification, 'cycle');
    assert.deepEqual(row.cycle, [e.id, e === a ? b.id : a.id, e.id]);
    assert.equal(row.edges[0].kind, 'traffic');
  }
  assert.ok(first.inspected.edges <= 768);
  s = S.load(S.save(s));
  assert.deepEqual(diagnoseLogisticsDependencies(s), first);
});

test('stored rail recovery and storage-lift predecessors are explicit edges, without inferring free-text IDs', () => {
  const s = S.createState();
  const parent = S.plan(s, 'rail', 125, 4).job!;
  const child = { ...parent, id: 'JOB-RECOVERY', kind: 'moveStock' as const,
    status: 'todo' as const, reason: '', railPickupRecovery: undefined };
  const predecessor = { ...child, id: 'JOB-PREVIOUS-LIFT' };
  s.jobs.push(child, predecessor);
  child.stockMove = { sourceId: 'STK-BLOCKER',
    destination: { x: 60, z: 50, w: 5, d: 3 }, yaw: 0,
    toStorage: true, afterJobId: predecessor.id };
  parent.railPickupRecovery = { attemptedIds: ['STK-BLOCKER'],
    activeJobId: child.id, activeBlockerId: 'STK-BLOCKER' };
  const report = diagnoseLogisticsDependencies(s);
  const row = report.diagnoses.find((r) => r.id === parent.id)!;
  assert.equal(row.classification, 'temporary');
  assert.deepEqual(row.blockerIds, [child.id]);
  assert.equal(row.edges[0].kind, 'recovery-prerequisite');
  assert.equal(diagnoseLogisticsDependencies(s).diagnoses.find((r) => r.id === child.id)!
    .edges[0].kind, 'storage-predecessor');
  s.buildings.push({ id: 'BLD-FIXED', kind: 'office', name: 'Fixed obstruction',
    x: 65, z: 45, w: 4, d: 2, rotation: 0, connected: false });
  s.actionClearances = [{ ownerId: predecessor.id, action: 'Clear machine dock',
    blockerIds: ['BLD-FIXED'], since: 0, lastSeen: 0, retryAt: 0,
    point: { x: 65, z: 45 } }];
  assert.equal(diagnoseLogisticsDependencies(s).diagnoses.find((r) => r.id === parent.id)!
    .classification, 'fixed', 'A downstream fixed blocker is visible through the prerequisite chain');
  // A reason with an ID is not itself a checked physical dependency edge.
  parent.railPickupRecovery = undefined;
  child.stockMove = undefined;
  s.actionClearances = [];
  parent.reason = 'Waiting: label STK-UNVERIFIED appears in a warning';
  const uncertain = diagnoseLogisticsDependencies(s).diagnoses.find((r) => r.id === parent.id)!;
  assert.equal(uncertain.classification, 'unresolved');
  assert.deepEqual(uncertain.blockerIds, []);
});

test('ordinary progress descriptions do not enter the blocked view', () => {
  const s = S.createState();
  const j = S.plan(s, 'lamp', 40, 40).job!;
  j.reason = 'Walking to installation';
  j.logisticsWaitSince = 2; // A stale warning timestamp is not a checked wait.
  assert.equal(diagnoseLogisticsDependencies(s).diagnoses.some((r) => r.id === j.id), false);
  j.reason = 'Waiting for a clear installation area';
  const waiting = diagnoseLogisticsDependencies(s).diagnoses.find((r) => r.id === j.id)!;
  assert.equal(waiting.classification, 'unresolved');
  assert.deepEqual(waiting.blockerIds, []);
});

test('a surveyed rail-pickup stock blocker remains a typed physical edge through reload', () => {
  const s = S.createState();
  const job = S.plan(s, 'rail', 125, 4).job!;
  s.stacks.push({ id: 'STK-OBSTRUCTION', item: 'railCurve',
    x: 39, z: 48, w: 6, d: 3, qty: 3, reserved: 0, source: 'opening' });
  job.railPickupRecovery = { attemptedIds: [], blockerIds: ['STK-OBSTRUCTION'] };
  job.reason = 'Waiting for the rail pickup to clear';
  const row = diagnoseLogisticsDependencies(S.load(S.save(s))).diagnoses
    .find((r) => r.id === job.id)!;
  assert.equal(row.classification, 'physical-relocation');
  assert.equal(row.edges.find((e) => e.to === 'STK-OBSTRUCTION')?.kind, 'rail-pickup');
});

test('large imported diagnostics stop at documented job and edge bounds', () => {
  const s = S.createState();
  for (let i = 0; i < 800; i++) s.jobs.push({
    id: `JOB-SYN-${i}`, kind: 'lamp', x: 30, z: 30, w: 1, d: 1,
    rotation: 0, qty: 1, status: 'todo', phase: 'Waiting', reason: 'Need a slab',
    progress: 0, delivered: false, elapsed: 0, created: s.time,
  });
  s.buildings.push({ id: 'BLD-BOUNDED', kind: 'office', name: 'Fixed obstruction',
    x: 45, z: 45, w: 4, d: 2, rotation: 0, connected: false });
  s.actionClearances = [{ ownerId: 'JOB-SYN-799', action: 'Clear unloading space',
    blockerIds: ['BLD-BOUNDED'], since: 0, lastSeen: 0, retryAt: 0,
    point: { x: 45, z: 45 } }];
  const report = diagnoseLogisticsDependencies(s);
  assert.equal(report.inspected.jobs, 512);
  assert.equal(report.diagnoses.length, 256);
  assert.equal(report.truncated, true);
  assert.equal(report.diagnoses.find((r) => r.id === 'JOB-SYN-799')?.classification,
    'fixed', 'A checked clearance is not displaced by reason-only waits');
});
