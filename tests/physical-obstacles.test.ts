import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { angleDelta, localPoint } from '../src/motion.ts';
import { staticObstacleRects, workerMoveBlocked, equipmentMoveBlocked, equipmentBoxes, boxOverlap, boxPenetrationDepth, type TrafficBox } from '../src/traffic.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';
import type { Building, State } from '../src/types.ts';

function addBuilding(s: State, kind: Building['kind'], x: number, z: number, w: number, d: number, rotation = 0) {
  const b: Building = { id: S.id(s, 'building'), kind, x, z, w, d, rotation, name: 'Test fixture', connected: false, source: 'opening' };
  s.buildings.push(b);
  return b;
}

test('rotated open sheds have six solid post bases and a back wall while their interior remains usable', () => {
  for (const rotation of [0, 1]) {
    const s = S.createState();
    const b = addBuilding(s, 'shed', 20, 30, rotation ? 6 : 8, rotation ? 8 : 6, rotation);
    const obs = staticObstacleRects(s).filter((r) => r.id === b.id);
    assert.equal(obs.length, 7);
    const c = { x: b.x + b.w / 2, z: b.z + b.d / 2, yaw: rotation * Math.PI / 2 };
    const back = localPoint(c, 0, -3);
    assert.equal(workerMoveBlocked(s, { x: back.x - 2, z: back.z - 2 }, back), b.id);
    for (const x of [-3.82, 3.82])
      for (const z of [-2.82, 0, 2.82]) {
        const post = localPoint(c, x, z);
        assert.equal(workerMoveBlocked(s, { x: -10, z: 20 }, post), b.id);
      }
    assert.equal(workerMoveBlocked(s, { x: 0, z: 20 }, c), '');
    const e = seedHandlingResources(s, 'excavator');
    assert.equal(equipmentMoveBlocked(s, e, { ...c, yaw: c.yaw }), '');
  }
});

test('workers and machines collide with light poles, utility cabinets and the actual stationary buffer', () => {
  const s = S.createState();
  const e = seedHandlingResources(s);
  for (const kind of ['lamp', 'power', 'water'] as const) {
    const b = addBuilding(s, kind, 25, 30, 1, 1);
    assert.equal(workerMoveBlocked(s, { x: 25.5, z: 28 }, { x: 25.5, z: 30.5 }), b.id);
    assert.equal(equipmentMoveBlocked(s, e, { x: 25.5, z: 30.5, yaw: 0 }), b.id);
    s.buildings.length = 0;
  }
  assert.equal(equipmentMoveBlocked(s, e, { x: s.buffer.x + 0.5, z: s.buffer.z, yaw: 0 }), 'BUFFER-001');
  assert.equal(workerMoveBlocked(s, { x: 125, z: 2 }, s.buffer), 'BUFFER-001');
});

test('manual forklift detour uses continuous progress and few deliberate turns around new shed posts', () => {
  const s = S.createState(), e = seedHandlingResources(s), w = s.workers[0];
  e.x = 10; e.z = 30; e.yaw = 0;
  w.vehicle = e.id; w.x = e.x; w.z = e.z; e.operator = w.id;
  addBuilding(s, 'shed', 16, 27, 8, 6);
  assert.equal(S.moveWorker(s, w.id, { x: 30, z: 30 }), '');
  let prior = { x: e.x, z: e.z, yaw: e.yaw }, turning = 0, ticksWithoutProgress = 0, longestPause = 0;
  tickUntil(s, () => !e.path.length, 120, () => {
    turning += Math.abs(angleDelta(prior.yaw, e.yaw!));
    const progress = Math.hypot(e.x - prior.x, e.z - prior.z);
    ticksWithoutProgress = progress < 0.0001 ? ticksWithoutProgress + 1 : 0;
    longestPause = Math.max(longestPause, ticksWithoutProgress);
    const body = equipmentBoxes(e, e, false)[0];
    for (const r of staticObstacleRects(s))
      assert.ok(!boxOverlap(body, { x: r.x + r.w / 2, z: r.z + r.d / 2, yaw: 0, length: r.w, width: r.d }, 0.01), `Body crosses ${r.id}`);
    prior = { x: e.x, z: e.z, yaw: e.yaw! };
  });
  assert.ok(Math.hypot(e.x - 30, e.z - 30) < 0.02);
  assert.ok(turning < Math.PI * 2, `Repeated alternating steering: ${turning * 180 / Math.PI} degrees`);
  assert.ok(longestPause < 50, `No-progress oscillation lasts ${longestPause / 10} s`);
});

test('manual walking route goes around a shed back wall and never cuts through it', () => {
  const s = S.createState(), e = seedHandlingResources(s), w = s.workers[0];
  s.equipment.length = 0;
  addBuilding(s, 'shed', 20, 30, 8, 6);
  w.x = 24; w.z = 27;
  assert.equal(S.moveWorker(s, w.id, { x: 24, z: 33 }), '');
  let prior = { x: w.x, z: w.z };
  tickUntil(s, () => !w.path.length, 90, () => {
    assert.equal(workerMoveBlocked(s, prior, w), '');
    prior = { x: w.x, z: w.z };
  });
  assert.ok(Math.hypot(w.x - 24, w.z - 33) < 0.02);
});

test('saved rail source approach recovers from an obsolete blocked lifting face without losing reserved stock', () => {
  let s = S.demoState();
  const jobId = S.plan(s, 'rail', 125, 4).job!.id;
  let job = s.jobs.find((j) => j.id === jobId)!;
  tickUntil(s, () => job.railWork?.phase === 'source-approach');
  const oldDock = { ...job.railWork!.source!.dock };
  addBuilding(s, 'lamp', oldDock.x - 0.5, oldDock.z - 0.5, 1, 1);
  const machine = s.equipment.find((e) => e.id === job.equipment)!;
  machine.x = 32.5; machine.z = 40; machine.yaw = -Math.PI / 2;
  machine.path = [{ ...oldDock }];
  s = S.load(S.save(s));
  job = s.jobs.find((j) => j.id === jobId)!;
  let changedFace = false;
  tickUntil(s, () => job.status === 'done', 1800, () => {
    const dock = job.railWork!.source!.dock;
    changedFace ||= Math.hypot(dock.x - oldDock.x, dock.z - oldDock.z) > 0.1;
    const total = S.totals(s, 'rail');
    assert.equal(total.delivered, total.stored + total.cargo + total.installed);
  });
  assert.ok(changedFace, 'Choose an accessible opposite lifting face instead of repeatedly steering at an occupied cell');
  assert.equal(s.buffer.x, 130);
  assert.ok(s.events.some((e) => e.type === 'Traffic' && e.entity === job.id && e.text.includes('reserved panel')));
});

test('an existing attached slab clearance overlap can escape outward while new or deeper overlap remains blocked', () => {
  const s = S.createState(), e = seedHandlingResources(s, 'excavator'), f = seedHandlingResources(s);
  e.x = 23.71371115375236; e.z = 44.5; e.yaw = -2.9915926535897923;
  e.reach = 4; e.cargo = { item: 'slab', qty: 1, yaw: 1.7207963267948974 };
  f.x = 17.541999999999998; f.z = 44.5; f.yaw = 103.67255756846318; f.reach = 3;
  s.workers.length = 0;
  assert.ok(equipmentBoxes(e).some((a) => equipmentBoxes(f).some((b) => boxOverlap(a, b, 0.06))), 'Reproduce the small existing load/chassis clearance overlap');
  // Rotation toward the clear side reduces this overlap; simply insisting on
  // zero overlap at the first quarter-step would deadlock both vehicles.
  assert.equal(equipmentMoveBlocked(s, e, { ...e, yaw: e.yaw + 0.15 }), '');
  assert.equal(equipmentMoveBlocked(s, e, { ...e, x: e.x - 0.3 }), f.id, 'Do not permit a deeper overlap');
  assert.equal(equipmentMoveBlocked(s, e, { x: f.x, z: f.z, yaw: 0 }), f.id, 'Do not drive the chassis into the other machine');
});

test('opposing empty machines keep one traffic priority instead of repeatedly exchanging escape maneuvers', () => {
  const s = S.createState(), e = seedHandlingResources(s, 'excavator'), f = seedHandlingResources(s);
  e.x = 29.7; e.z = 53.5; e.yaw = 0.38; e.reach = 2.1;
  f.x = 43.25; f.z = 53.6; f.yaw = 0.28; f.reach = 3; f.reverse = true;
  const operators = s.workers.filter((w) => w.role === 'operator');
  for (const [machine, worker] of [[e, operators[0]], [f, operators[1]]] as const) {
    worker.vehicle = machine.id; worker.x = machine.x; worker.z = machine.z; machine.operator = worker.id;
  }
  s.workers = operators;
  for (const x of [28, 29, 30, 31, 32, 33, 35, 39])
    s.stacks.push({ id: S.id(s, 'stack'), x, z: 49, w: 1, d: 1, item: 'slab', qty: 4, reserved: 0, source: 'opening' });
  assert.equal(S.moveWorker(s, operators[0].id, { x: 35.5, z: 53.5 }), '');
  assert.equal(S.moveWorker(s, operators[1].id, { x: 28.5, z: 53.6 }), '');
  let yaw = e.yaw, turning = 0;
  tickUntil(s, () => Math.hypot(e.x - 35.5, e.z - 53.5) < 0.1 && Math.hypot(f.x - 28.5, f.z - 53.6) < 0.1, 120, () => {
    turning += Math.abs(angleDelta(yaw, e.yaw!)); yaw = e.yaw!;
    assert.ok(!equipmentBoxes(e, e, false).some((a) => equipmentBoxes(f, f, false).some((b) => boxOverlap(a, b, 0))), 'Actual chassis must remain separated');
  });
  assert.ok(turning < Math.PI * 2, `Priority machine repeatedly reverses its maneuver: ${turning * 180 / Math.PI} degrees`);
});


test('collision geometry stays correct as reused boxes move, rotate, resize, and change clearance', () => {
  // Independent polygon projection oracle: generate actual corners, then project
  // those polygons onto every edge normal. Reuse the same objects to exercise
  // position reads and geometry-cache invalidation rather than fresh objects.
  const polygon = (b: TrafficBox, margin: number) => {
    const c = Math.cos(b.yaw), n = Math.sin(b.yaw);
    return [[-1,-1], [1,-1], [1,1], [-1,1]].map(([sx,sz]) => {
      const x = sx * (b.length / 2 + margin), z = sz * (b.width / 2 + margin);
      return { x: b.x + x * c - z * n, z: b.z + x * n + z * c };
    });
  };
  const oracle = (a: TrafficBox, b: TrafficBox, margin: number) => {
    const pa = polygon(a, margin), pb = polygon(b, margin);
    let depth = Infinity;
    for (const p of [pa,pb]) for (let i=0;i<4;i++) {
      const edge = { x: p[(i+1)%4].x-p[i].x, z: p[(i+1)%4].z-p[i].z };
      const size = Math.hypot(edge.x,edge.z), axis = { x:-edge.z/size, z:edge.x/size };
      const aa = pa.map(v=>v.x*axis.x+v.z*axis.z), bb = pb.map(v=>v.x*axis.x+v.z*axis.z);
      // Distance to separate either interval includes containment depth.
      depth = Math.min(depth, Math.max(...aa)-Math.min(...bb), Math.max(...bb)-Math.min(...aa));
    }
    return Math.max(0,depth);
  };
  const a = { x:0, z:0, yaw:0, length:3.76, width:2.6 },
    b = { x:2, z:0, yaw:0, length:3.15, width:1.96 };
  for (let i=0;i<500;i++) {
    a.x = Math.sin(i*.13)*5; a.z = Math.cos(i*.17)*3;
    b.x = Math.cos(i*.09)*7; b.z = Math.sin(i*.21)*4;
    a.yaw = i*.07; b.yaw = -i*.11;
    a.length = 2 + (i%7)*.3; a.width = 1 + (i%5)*.2;
    b.length = 1 + (i%11)*.4; b.width = 1.4 + (i%3)*.1;
    const margin = (i%4)*.08, expected = oracle(a,b,margin);
    assert.equal(boxOverlap(a,b,margin), expected > 1e-7, `Case ${i}`);
    assert.ok(Math.abs(boxPenetrationDepth(a,b,margin)-expected)<1e-9, `Penetration case ${i}`);
  }
});
