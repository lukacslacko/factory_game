import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { trackGeometry, trackMacroPorts, trackOpenPorts } from '../src/track';
import { bufferAssets } from '../src/buffers';

test('creative paving and completed shed foundations require no stock, crew or charges, and survive saves', () => {
  let s = S.createState();
  S.setCreativeMode(s, true);
  assert.equal(S.pave(s, { x: 50, z: 30, w: 3, d: 2 }), 6);
  const result = S.plan(s, 'shed', 60, 30);
  assert.equal(result.error, '');
  assert.equal(result.job!.status, 'done');
  assert.equal(s.buildings.find((b) => b.kind === 'shed')!.kind, 'shed');
  assert.equal(Object.keys(s.paving).length, 54);
  assert.ok(
    s.jobs.every(
      (j) => j.creative && j.status === 'done' && j.delivered && !j.equipment && !j.worker,
    ),
  );
  assert.equal(s.stacks.length, 0);
  assert.equal(s.orders.length, 0);
  assert.equal(s.costs.length, 0);
  assert.deepEqual(S.missingMaterials(s), {});
  s = S.load(S.save(s));
  assert.equal(s.creative, true);
  assert.equal(s.buildings.find((b) => b.kind === 'shed')!.kind, 'shed');
  const before = JSON.stringify([s.paving, s.buildings, s.rails]);
  S.tick(s, 1);
  assert.equal(JSON.stringify([s.paving, s.buildings, s.rails]), before);
});

test('creative rail layouts install exact physical geometry and preserve the moved buffer identity', () => {
  let s = S.createState();
  S.setCreativeMode(s, true);
  const straight = S.planRailLayout(s, 'straight', { x: 125, z: 5 });
  assert.equal(straight.error, '');
  assert.equal(s.rails.length, 1);
  assert.equal(bufferAssets(s)[0].x, 130);
  assert.equal(bufferAssets(s)[0].id, 'BUFFER-001');
  const curve = S.planRailLayout(s, 'curve', { x: 130, z: 5 });
  assert.equal(curve.error, '');
  assert.equal(curve.jobs.length, 6);
  assert.equal(s.rails.length, 7);
  const ports = trackMacroPorts(curve.jobs[0]);
  const end = ports.find((p) => p.end === 'exit')!;
  assert.ok(Math.hypot(bufferAssets(s)[0].x - end.x, bufferAssets(s)[0].z - end.z) < 0.01);
  assert.ok(s.rails.every((r) => r.length === trackGeometry(r).length));
  s = S.load(S.save(s));
  assert.equal(s.rails.length, 7);
  assert.equal(s.creative, true);
});

test('creative turnout and independent buffer stops retain valid endpoints and operational records', () => {
  let s = S.createState();
  S.setCreativeMode(s, true);
  const result = S.planRailLayout(s, 'turnout', { x: 125, z: 5 });
  assert.equal(result.error, '');
  assert.equal(result.jobs.length, 7);
  assert.equal(s.rails.length, 7);
  const ends = trackOpenPorts(s, false).filter((p) => p.x > 125);
  assert.equal(ends.length, 2);
  const uncapped = ends.find(
    (p) => !bufferAssets(s).some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 0.1),
  )!;
  const stop = S.planBufferStop(s, uncapped);
  assert.equal(stop.error, '');
  assert.equal(stop.job!.status, 'done');
  assert.equal(bufferAssets(s).length, 2);
  assert.equal(S.planBufferStop(s, uncapped).error, 'This endpoint already has a buffer stop.');
  s = S.load(S.save(s));
  assert.equal(s.rails.length, 7);
  assert.equal(s.buffers!.length, 2);
});

test('creative still validates overlap and rail connections, and only bypasses new construction', () => {
  const s = S.createState();
  const old = S.plan(s, 'office', 40, 30).job!;
  S.setCreativeMode(s, true);
  assert.equal(S.plan(s, 'office', 40, 30).job, undefined);
  assert.ok(S.planRailLayout(s, 'straight', { x: 70, z: 40 }).error);
  assert.equal(S.plan(s, 'office', 70, 30).job!.status, 'done');
  assert.equal(old.status, 'todo');
  S.setCreativeMode(s, false);
  const next = S.plan(s, 'shed', 90, 30).job!;
  assert.equal(next.status, 'todo');
  assert.equal(next.creative, undefined);
  assert.equal(S.load(S.save(s)).creative, false);
  assert.throws(() => S.load(S.save({ ...s, creative: 'yes' } as any)), /creative mode/);
});

test('creative rails replace paved track beds directly without scheduling recovery', () => {
  const s = S.createState();
  S.setCreativeMode(s, true);
  for (let x = 125; x < 130; x++) for (let z = 4; z < 6; z++) s.paving[`${x},${z}`] = 'EXISTING';
  assert.equal(S.planRailLayout(s, 'straight', { x: 125, z: 5 }).error, '');
  for (const p of trackGeometry(s.rails[0]).cells)
    assert.equal(s.paving[`${p.x},${p.z}`], undefined);
  assert.ok(!s.jobs.some((j) => j.kind === 'remove'));
});
