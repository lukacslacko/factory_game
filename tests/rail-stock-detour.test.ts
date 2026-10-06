import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { equipmentIntent } from '../src/equipment-intent';
import { equipmentSweepBlocked } from '../src/traffic';
import { trackGeometry } from '../src/track';
import { seedHandlingResources, stateSummary } from './support/yard';
import type { Job, State } from '../src/types';
import type { TrackPiece } from '../src/track';

// The production buffer-placement dock is occupied by a real staged turnout
// panel. Another crane pose at the same reach is clear; retrying the occupied
// dock cannot solve this. No private yard or diagnostic recording is included.
function fixture() {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  const [op, w] = s.workers;
  Object.assign(e, { x: 103, z: 58.5, yaw: 61.26, reach: 4, lift: 0.8, operator: op.id, work: 1 });
  Object.assign(op, { x: e.x, z: e.z, vehicle: e.id });
  Object.assign(w, { x: 95, z: 45 });
  const groupId = S.id(s, 'work');
  const track: TrackPiece = {
    layout: 'turnout',
    origin: { x: 75, z: 45 },
    heading: 0,
    hand: -1,
    section: 3,
    route: 'straight',
    flow: 'converging',
    groupId,
  };
  s.jobGroups = [
    {
      id: groupId,
      x: 75,
      z: 39,
      w: 20,
      d: 8,
      label: 'Converging turnout',
      created: s.time,
      track: {
        layout: track.layout,
        origin: track.origin,
        heading: track.heading,
        hand: track.hand,
        flow: track.flow,
      },
    },
  ];
  const g = trackGeometry(track),
    rid = S.id(s, 'rail');
  s.rails.push({ ...g.rect, id: rid, track, length: g.length, rotation: 0, item: 'rail' });
  const buffer = {
    id: 'BUFFER-001',
    x: 103,
    z: 54.5,
    y: 0.8,
    yaw: Math.PI,
    carried: true,
    secured: false,
    source: 'opening',
  };
  s.buffers = [{ ...buffer }];
  s.buffer = { x: buffer.x, z: buffer.z };
  const j: Job = {
    ...g.rect,
    id: S.id(s, 'job'),
    kind: 'rail',
    item: 'rail',
    qty: 1,
    rotation: 0,
    status: 'doing',
    phase: 'Align buffer over the rails',
    reason: '',
    progress: 0.78,
    delivered: true,
    elapsed: 0,
    created: s.time,
    parentId: groupId,
    track,
    worker: w.id,
    operator: op.id,
    equipment: e.id,
    cancel: true,
    railBufferCleanup: true,
    railWork: {
      phase: 'buffer-align-end',
      clock: 0,
      start: { x: 95, z: 45 },
      end: { x: 90, z: 45 },
      axisYaw: 0,
      entryYaw: Math.PI,
      endYaw: Math.PI,
      side: { x: 0, z: 1 },
      stage: { x: 90, z: 53, w: 5, d: 3 },
      stageDock: { x: 92.5, z: 50.5 },
      railDock: { x: 92.5, z: 49 },
      bufferAside: { x: 103, z: 54.5 },
      panel: { x: 92.5, z: 45, y: 0, yaw: 0, state: 'installed', railId: rid },
      buffer,
      lifting: 'buffer',
    },
  };
  e.job = j.id;
  op.job = j.id;
  w.job = j.id;
  s.jobs.push(j);
  s.stacks.push({
    id: S.id(s, 'stack'),
    x: 91,
    z: 48,
    w: 6,
    d: 3,
    item: 'railExit',
    qty: 1,
    reserved: 0,
    source: 'staging',
    yaw: 0,
  });
  S.load(S.save(s));
  return { s, jobId: j.id, equipmentId: e.id };
}
function tick(s: State, id: string) {
  const e = s.equipment.find((e) => e.id === id)!,
    before = { ...e, path: e.path.slice() };
  S.tick(s, 0.1);
  const distance = Math.hypot(e.x - before.x, e.z - before.z);
  assert.ok(distance <= 0.231, 'Crane movement remains physical and bounded');
  if (distance > 1e-7)
    assert.equal(
      equipmentSweepBlocked(s, before, e),
      '',
      'No driving through staged stock or people',
    );
}

test('a staged panel blocking the buffer approach triggers a stable alternate lifting pose and completes after reload', () => {
  let { s, jobId, equipmentId } = fixture();
  const stock = JSON.stringify(s.stacks),
    railIds = s.rails.map((r) => r.id);
  tick(s, equipmentId);
  let j = s.jobs.find((j) => j.id === jobId)!;
  assert.ok(j.railWork!.approach);
  const approach = structuredClone(j.railWork!.approach);
  assert.notDeepEqual(approach.point, approach.preferred);
  s = S.load(S.save(s));
  j = s.jobs.find((j) => j.id === jobId)!;
  for (let n = 0; n < 1000 && j.status === 'doing'; n++) {
    tick(s, equipmentId);
    assert.deepEqual(j.railWork!.approach, approach, 'Dock selection never flutters between sides');
  }
  assert.equal(j.status, 'done', stateSummary(s));
  assert.equal(JSON.stringify(s.stacks), stock);
  assert.deepEqual(
    s.rails.map((r) => r.id),
    railIds,
  );
  assert.equal(s.buffers![0].id, 'BUFFER-001');
  assert.equal(s.buffers![0].secured, true);
  assert.equal(s.buffers![0].carried, false);
  assert.equal(s.buffers![0].x, 90);
  assert.equal(s.buffers![0].z, 45);
  assert.equal(s.events.filter((e) => e.text.includes('selects an alternate')).length, 1);
});

test('intent shows the saved alternate work approach even when no active route remains', () => {
  const { s, jobId, equipmentId } = fixture();
  tick(s, equipmentId);
  const e = s.equipment.find((e) => e.id === equipmentId)!,
    j = s.jobs.find((j) => j.id === jobId)!;
  e.path = [];
  assert.deepEqual(equipmentIntent(s, e).target, j.railWork!.approach!.point);
  const broken = JSON.parse(S.save(s));
  broken.jobs[0].railWork.approach.point.x = Infinity;
  assert.throws(() => S.load(JSON.stringify(broken)), /alternate rail-handling approach/);
});

test('an enclosed rail approach reports one actionable warning, then recovers when stock is cleared', () => {
  const { s, jobId, equipmentId } = fixture();
  const originalStock = s.stacks.slice();
  for (const x of [83, 89, 95])
    for (const z of [38, 41, 44, 47, 50])
      s.stacks.push({
        id: S.id(s, 'stack'),
        x,
        z,
        w: 6,
        d: 3,
        item: 'railExit',
        qty: 1,
        reserved: 0,
        source: 'staging',
        yaw: 0,
      });
  for (let n = 0; n < 250; n++) tick(s, equipmentId);
  const notices = s.notices.filter((n) => n.entity === jobId && n.title === 'Rail route blocked');
  assert.equal(notices.length, 1, 'Repeated retries do not flood the inbox');
  assert.match(notices[0].detail, /STK-.*Relocate obstructing staged material to storage/);
  assert.equal(
    s.events.filter(
      (e) => e.text.includes('cannot find a safe approach') && e.severity === 'warning',
    ).length,
    1,
  );
  s.stacks = originalStock;
  for (let n = 0; n < 1000 && s.jobs.find((j) => j.id === jobId)!.status === 'doing'; n++)
    tick(s, equipmentId);
  assert.equal(s.jobs.find((j) => j.id === jobId)!.status, 'done');
  assert.equal(notices[0].state, 'done');
});
