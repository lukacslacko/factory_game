import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import type { ElectricalRun } from '../src/electrical-types';
import { electricalRender, electricalToolPose } from '../native-runtime/electrical-render';
import { renderState } from '../native-runtime/render';
import { seedHandlingResources } from './support/yard';
function fixture() {
  const s = S.createState();
  s.utilities.power = true;
  s.buildings.push(
    {
      id: 'BLD-1001',
      kind: 'power',
      name: 'Incoming cabinet',
      x: 30,
      z: 30,
      w: 1,
      d: 1,
      rotation: 0,
      connected: true,
    },
    {
      id: 'BLD-1002',
      kind: 'lamp',
      name: 'Yard lamp',
      x: 34,
      z: 30,
      w: 1,
      d: 1,
      rotation: 0,
      connected: true,
    },
  );
  const run: ElectricalRun = {
    id: 'ELE-1001',
    jobId: 'JOB-1001',
    sourceId: 'BLD-1001',
    targetId: 'BLD-1002',
    cells: [31, 32, 33].map((x) => ({
      x,
      z: 30,
      excavation: 1,
      backfilled: 0,
      soilRemovedM3: 0.36,
      spoilM3: 0.36,
      spoilRect: { x, z: 31, w: 1, d: 2 },
      cableInstalled: true,
    })),
    phase: 'lay',
    status: 'working',
    cellIndex: 1,
    clock: 1,
    created: s.time,
    reservations: [],
    stagedReels: [],
    cableInHand: 1,
    soilInBucketM3: 0,
    sourceTerminated: false,
    targetTerminated: false,
    tested: false,
    reason: '',
  };
  s.electrical = { runs: [run], meterLedger: [] };
  return { s, run };
}
test('Electrical render exposes actual below-grade cuts and conserved soil, not imaginary surface cables', () => {
  const { s, run } = fixture();
  const r = electricalRender(s);
  assert.equal(r.trenches.length, 3);
  assert.equal(r.cuts.length, 3);
  assert.equal(r.trenches[0].depth, 0.6);
  assert.equal(r.trenches[0].spoilM3, 0.36);
  assert.deepEqual(r.cuts[0], { x: 31, z: 30.2, w: 1, d: 0.6, depth: 0.6 });
  run.cells[0].backfilled = 0.5;
  run.cells[0].spoilM3 = 0.18;
  assert.equal(electricalRender(s).trenches[0].depth, 0.3);
  for (const c of run.cells) {
    c.backfilled = 1;
    c.spoilM3 = 0;
  }
  const done = electricalRender(s);
  assert.equal(done.trenches.length, 0);
  assert.equal(done.cuts.length, 0);
  assert.equal(done.restored.length, 3);
  assert.equal(done.restored.filter((c) => c.marker).length, 2);
});
test('Electrical corner cuts share an open interior without overlapping floor rectangles', () => {
  const { s, run } = fixture();
  run.cells[2].x = 32;
  run.cells[2].z = 31;
  const cuts = electricalRender(s).trenches[1].cuts;
  assert.equal(cuts.length, 2);
  for (const [i, a] of cuts.entries())
    for (const b of cuts.slice(i + 1))
      assert.ok(
        a.x + a.w <= b.x + 1e-8 ||
          b.x + b.w <= a.x + 1e-8 ||
          a.z + a.d <= b.z + 1e-8 ||
          b.z + b.d <= a.z + 1e-8,
      );
  assert.ok(cuts.some((c) => c.z === 30.8 && c.d === 0.2));
  assert.ok(
    Math.abs(cuts.reduce((n, c) => n + c.w * c.d, 0) - 0.6) < 1e-8,
    'A right-angle cell retains the actual0.6m² trench footprint',
  );
});
test('Lights require a commissioned, terminated, tested circuit even with incoming power enabled', () => {
  const { s, run } = fixture();
  assert.equal(electricalRender(s).consumers[0].powered, false);
  run.status = 'commissioned';
  run.phase = 'complete';
  run.tested = run.sourceTerminated = run.targetTerminated = true;
  for (const c of run.cells) {
    c.backfilled = 1;
    c.spoilM3 = 0;
  }
  assert.equal(electricalRender(s).consumers[0].powered, true);
  s.utilities.power = false;
  const consumer = electricalRender(s).consumers[0];
  assert.equal(consumer.connected, true);
  assert.equal(consumer.powered, false);
});
test('Electrical tool consumes real swept pose and remains stable with accumulated chassis yaw', () => {
  const { s, run } = fixture();
  const e = seedHandlingResources(s, 'excavator');
  run.equipmentId = e.id;
  run.toolPoint = { x: e.x + 3, z: e.z };
  run.phase = 'swing-spoil';
  run.soilInBucketM3 = 0.12;
  e.yaw = 58;
  e.reach = 3;
  e.lift = 0.4;
  assert.deepEqual(electricalToolPose(run, e), {
    point: run.toolPoint,
    reach: 3,
    lift: 0.4,
    bucketPitch: 0.55,
    bucketBottomReference: true,
  });
  const actor = renderState(s).actors.find((a) => a.id === e.id)! as any;
  assert.equal(
    actor.upperYaw,
    0,
    'The renderer must not slew instantly toward a future target while the actual chassis is still turning',
  );
  assert.equal(actor.soilInBucketM3, 0.12);
  assert.equal(actor.lift, 0.4);
});
test('Carried partial cable reels retain their real meter count through job ownership', () => {
  const { s, run } = fixture();
  const e = seedHandlingResources(s, 'excavator');
  run.equipmentId = e.id;
  run.phase = 'reel-carry';
  e.cargo = { item: 'cableReel', qty: 1 };
  s.stacks.push({
    id: 'STK-1001',
    item: 'cableReel',
    qty: 0,
    reserved: 1,
    x: 40,
    z: 30,
    w: 1,
    d: 1,
    source: 'opening',
    cableMeters: 17,
    electricalCarriedBy: run.jobId,
  });
  const load = renderState(s).loads.find((l) => l.parentEquipmentId === e.id)!;
  assert.equal(load.cableMeters, 17);
});

test('Lifted original paving remains in its real reserved staging square until restored', () => {
  const { s, run } = fixture();
  const cell = run.cells[0];
  cell.originalPaving = 'JOB-PAVE';
  cell.slabLifted = true;
  cell.slabRect = { x: 31, z: 33, w: 1, d: 1 };
  assert.deepEqual(electricalRender(s).stagedPaving, [
    { x: 31, z: 33, w: 1, d: 1, id: `${run.id}/paving/0`, runId: run.id },
  ]);
  cell.slabRestored = true;
  s.paving['31,30'] = 'JOB-PAVE';
  cell.backfilled = 1;
  cell.spoilM3 = 0;
  assert.equal(electricalRender(s).stagedPaving.length, 0);
  assert.equal(electricalRender(s).restored[0].paved, true);
});

test('Nearby nonconsecutive route cells never create a visual cable branch', () => {
  const { s, run } = fixture();
  run.cells = [
    { x: 31, z: 30 },
    { x: 32, z: 30 },
    { x: 32, z: 31 },
    { x: 31, z: 31 },
  ].map((p) => ({ ...run.cells[0], ...p }));
  const first = electricalRender(s).trenches[0];
  assert.equal(first.cableSegments.length, 2);
  assert.equal(first.cuts.length, 1);
  assert.equal(first.cuts[0].d, 0.6);
});

test('One-cell vertical circuit follows cabinet and load terminal boundaries', () => {
  const { s, run } = fixture();
  s.buildings[0].x = 31;
  s.buildings[0].z = 29;
  s.buildings[1].x = 31;
  s.buildings[1].z = 31;
  run.cells = [run.cells[0]];
  const trench = electricalRender(s).trenches[0];
  assert.deepEqual(trench.cuts, [{ x: 31.2, z: 30, w: 0.6, d: 1, depth: 0.6 }]);
  assert.ok(trench.cableSegments.every((segment) => segment.a.x === segment.b.x));
});

test('Digging projection lifts conserved soil before swinging and uses only accepted core time', () => {
  const { run } = fixture();
  const e = { x: 28, z: 30, yaw: 0, lift: -0.4, reach: 3.5 };
  run.toolPoint = { x: 31.5, z: 30.5 };
  run.phase = 'dig';
  run.clock = 3;
  assert.equal(electricalToolPose(run, e)!.bucketPitch, 0.55);
  run.phase = 'dig-lift';
  run.clock = 1.25;
  run.soilInBucketM3 = 0.12;
  e.lift = 0.35;
  const held = electricalToolPose(run, e)!;
  assert.equal(held.lift, 0.35);
  assert.equal(held.bucketPitch, 0.55);
  assert.deepEqual(
    electricalToolPose(run, e),
    held,
    'A blocked accepted clock cannot keep animating',
  );
  run.phase = 'swing-spoil';
  e.lift = 1.1;
  assert.equal(electricalToolPose(run, e)!.lift, 1.1);
  run.phase = 'dump-spoil';
  run.clock = 0;
  assert.equal(electricalToolPose(run, e)!.bucketPitch, 0.55);
  run.clock = 2;
  assert.ok(Math.abs(electricalToolPose(run, e)!.bucketPitch + 0.6) < 1e-9);
  run.phase = 'dig-return';
  run.clock = 0;
  assert.ok(Math.abs(electricalToolPose(run, e)!.bucketPitch + 0.6) < 1e-9);
  run.clock = 2;
  assert.ok(Math.abs(electricalToolPose(run, e)!.bucketPitch - 0.1) < 1e-9);
  run.phase = 'crew-clear';
  run.clock = 0;
  assert.ok(
    Math.abs(electricalToolPose(run, e)!.bucketPitch + 0.6) < 1e-9,
    'The last dump also uncurls continuously before retreat',
  );
});
test('Backfill bucket retains a bottom-height reference through pickup, lift, swing, and return', () => {
  const { run } = fixture();
  run.toolPoint = { x: 32, z: 32 };
  const e = { x: 28, z: 30, reach: 4.5, lift: 1.1 };
  for (const phase of [
    'backfill-pick',
    'backfill-lift',
    'swing-trench',
    'backfill',
    'backfill-return',
  ] as const) {
    run.phase = phase;
    run.clock = 1;
    const pose = electricalToolPose(run, e)!;
    assert.equal(pose.bucketBottomReference, true);
    assert.equal(pose.reach, 4.5);
    assert.equal(pose.lift, 1.1);
  }
  run.phase = 'lift-paving';
  assert.equal(
    electricalToolPose(run, e)!.bucketBottomReference,
    false,
    'Rigged paving retains its suspension reference',
  );
});
