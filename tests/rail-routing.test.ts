import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  planMainlineExit,
  planSidingAccess,
  planRailLayout,
  setCreativeMode,
  save,
  load,
  addZone,
} from '../src/sim.ts';
import {
  railAnchorPose,
  railRoute,
  railInterval,
  anchorAtRailRoute,
  sampleRailRoute,
} from '../src/rail-routing.ts';
import {
  trackGeometry,
  trackNetwork,
  trackOpenPorts,
  trackSections,
  mainlineExitCommissioned,
} from '../src/track.ts';
import { bufferAssets } from '../src/buffers.ts';
import { MATERIALS } from '../src/catalog.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';
const siding = (offset: number) => ({
  trackId: 'BOOTSTRAP-SIDING',
  route: 'straight' as const,
  offset,
});
const main = (x: number) => ({
  trackId: 'BOOTSTRAP-MAINLINE',
  route: 'straight' as const,
  offset: x + 260,
});
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

test('routing uses the physical original switch and never jumps between parallel centerlines', () => {
  const s = createState(),
    route = railRoute(s, main(-10), siding(40))!;
  assert.ok(route);
  assert.deepEqual(route.tracks, ['BOOTSTRAP-MAINLINE', 'BOOTSTRAP-SWITCH', 'BOOTSTRAP-SIDING']);
  assert.deepEqual(route.switches, [{ id: 'BOOTSTRAP-SWITCH', route: 'branch' }]);
  assert.ok(route.points.some((p) => p.x > 5 && p.x < 20 && p.z > 0 && p.z < 5));
  for (let i = 1; i < route.points.length; i++)
    assert.ok(
      Math.abs(
        Math.atan2(
          Math.sin(route.points[i].yaw - route.points[i - 1].yaw),
          Math.cos(route.points[i].yaw - route.points[i - 1].yaw),
        ),
      ) < 0.05,
    );
  const end = anchorAtRailRoute(s, route, route.length)!;
  assert.equal(end.trackId, 'BOOTSTRAP-SIDING');
  close(end.offset, 40);
  close(end.point.x, 65);
  close(sampleRailRoute(route.points, route.length).x, 65);
});
test('same-panel reverse route rotates yaw, while graph cannot reverse at a dead-end to manufacture an exit', () => {
  const s = createState(),
    r = railRoute(s, siding(50), siding(20))!;
  close(r.length, 30);
  close(Math.abs(r.points[0].yaw), Math.PI);
  assert.equal(railRoute(s, siding(50), main(180)), undefined);
});
test('mainline exit is commissioned as seven real panels and does not bypass construction', () => {
  const s = createState(),
    result = planMainlineExit(s);
  assert.equal(result.error, '');
  assert.equal(result.jobs.length, 7);
  assert.equal(s.rails.length, 0);
  assert.ok(result.jobs.every((j) => j.status === 'todo'));
  assert.equal(result.jobs.filter((j) => j.item === 'rail').length, 3);
  assert.equal(railRoute(s, siding(50), main(180)), undefined);
  assert.match(planMainlineExit(s).error, /already/);
  assert.doesNotThrow(() => load(save(s)));
});
test('Creative east exit makes an actual through route, removes the stop from the running track and survives reload', () => {
  const s = createState();
  setCreativeMode(s, true);
  const result = planMainlineExit(s);
  assert.equal(result.error, '');
  assert.equal(s.rails.length, 7);
  assert.ok(result.jobs.every((j) => j.status === 'done'));
  assert.ok(bufferAssets(s).every((b) => !b.secured || b.z !== 5));
  const route = railRoute(s, siding(50), main(180))!;
  assert.ok(route);
  assert.ok(route.points.some((p) => p.x > 125 && p.x < 145 && p.z > 0 && p.z < 5));
  const points = s.rails.find((r) => r.track?.section === 0)!;
  assert.deepEqual(route.switches, [{ id: points.id, route: 'branch' }]);
  assert.equal(trackOpenPorts(s, false).length, 0);
  assert.ok(trackNetwork(s).panels.every((p) => p.connected));
  assert.deepEqual(railRoute(load(save(s)), siding(50), main(180)), route);
});
test('corridor permission is confined to the exact east connection, and occupied siding ends still reject it', () => {
  const s = createState();
  assert.ok(planRailLayout(s, 'turnout', { x: 125, z: 0 }, 0, 1).error);
  assert.ok(planRailLayout(s, 'turnout', { x: 130, z: 0 }, 0, 1, 'converging').error);
  setCreativeMode(s, true);
  assert.equal(planRailLayout(s, 'straight', { x: 125, z: 5 }).error, '');
  assert.match(planMainlineExit(s).error, /parallel|endpoint/i);
});
test('installed arbitrary paths can be routed, but planned panels, missing panels and crossing centerlines cannot', () => {
  const s = createState();
  setCreativeMode(s, true);
  const result = planRailLayout(s, 'curve', { x: 125, z: 5 }, 0, 1);
  assert.equal(result.error, '');
  const last = s.rails.at(-1)!,
    anchor = { trackId: last.id, route: 'straight' as const, offset: 4 };
  assert.ok(railRoute(s, siding(75), anchor));
  s.rails.splice(2, 1);
  assert.equal(railRoute(s, siding(75), anchor), undefined);
  s.rails.push({ id: 'CROSS', x: 99, z: 0, rotation: 1, length: 5 });
  assert.equal(
    railRoute(s, siding(75), { trackId: 'CROSS', route: 'straight', offset: 3 }),
    undefined,
  );
});
test('secured buffer in the interior of a sparsely sampled straight blocks routing', () => {
  const s = createState();
  s.buffers = [{ id: 'STOP', x: 75, z: 5, y: 0.2, yaw: 0, secured: true, carried: false }];
  assert.equal(railRoute(s, siding(20), siding(80)), undefined);
  s.buffers[0].secured = false;
  assert.ok(railRoute(s, siding(20), siding(80)));
});
test('parked consist intervals extend over real joints and retain segment anchors', () => {
  const s = createState(),
    interval = railInterval(s, siding(10), 20, 30)!;
  assert.ok(interval);
  close(interval.length, 50);
  assert.equal(interval.segments[0].trackId, 'BOOTSTRAP-SWITCH');
  assert.equal(anchorAtRailRoute(s, interval, interval.length)!.trackId, 'BOOTSTRAP-SIDING');
  assert.equal(railInterval(s, siding(90), 5, 20), undefined);
  setCreativeMode(s, true);
  planMainlineExit(s);
  const extended = railInterval(s, siding(95), 5, 50)!;
  assert.ok(extended);
  assert.equal(extended.segments.at(-1)!.trackId, 'BOOTSTRAP-MAINLINE');
});

test('normal east connection physically constructs all seven panels and recovers its buffer to stock', () => {
  const s = createState();
  assert.equal(addZone(s, { x: 130, z: 40, w: 14, d: 14 }), '');
  const machine = seedHandlingResources(s, 'excavator');
  machine.x = 120;
  machine.z = 24;
  s.workers.forEach((w, i) => {
    w.x = 116 + i;
    w.z = 22;
  });
  const result = planMainlineExit(s);
  assert.equal(result.error, '');
  result.jobs.forEach((j, i) => {
    const item = j.item!,
      m = MATERIALS[item];
    s.stacks.push({
      id: 'EXIT-STOCK-' + i,
      item,
      qty: 1,
      reserved: 0,
      x: 70 + Math.floor(i / 3) * 15,
      z: 25 + (i % 3) * 15,
      w: m.w,
      d: m.d,
      source: 'opening',
    });
  });
  tickUntil(
    s,
    () =>
      result.jobs.every((j) => j.status === 'done') &&
      s.jobs
        .filter((j) => j.kind === 'remove' && j.item === 'bufferStop')
        .every((j) => j.status === 'done'),
    4000,
  );
  assert.equal(s.rails.length, 7);
  assert.ok(railRoute(s, siding(50), main(180)));
  assert.equal(bufferAssets(s).length, 0);
  assert.equal(
    s.stacks.filter((t) => t.item === 'bufferStop').reduce((v, t) => v + t.qty, 0),
    1,
  );
  assert.doesNotThrow(() => load(save(s)));
});

test('exact endpoint anchors enter and leave neighboring matching rails without reversing, but reject crossing endpoints', () => {
  const s = createState();
  setCreativeMode(s, true);
  planRailLayout(s, 'straight', { x: 125, z: 5 });
  const rail = s.rails[0],
    start = { trackId: rail.id, route: 'straight' as const, offset: 0 },
    end = { ...start, offset: 3 };
  const out = railRoute(s, siding(100), end)!;
  assert.ok(out);
  close(out.length, 3);
  close(out.points[0].yaw, 0);
  const into = railRoute(s, siding(95), start)!;
  assert.ok(into);
  close(into.length, 5);
  const reverse = railRoute(s, start, siding(95))!;
  assert.ok(reverse);
  close(reverse.length, 5);
  s.rails.push({ id: 'WRONG-END', x: 124, z: 0, rotation: 1, length: 5 });
  assert.equal(
    railRoute(s, siding(100), { trackId: 'WRONG-END', route: 'straight', offset: 4 }),
    undefined,
  );
});

test('factory access switch preserves both mainline exit and a buildable connected factory branch', () => {
  const s = createState();
  setCreativeMode(s, true);
  const access = planSidingAccess(s);
  assert.equal(access.error, '');
  assert.equal(access.jobs.length, 7);
  assert.ok(trackOpenPorts(s, false).some((p) => p.x === 100 && p.z === 10));
  const branch = planRailLayout(s, 'straight', { x: 100, z: 10 });
  assert.equal(branch.error, '');
  const custom = s.rails.at(-1)!;
  const route = railRoute(s, siding(30), { trackId: custom.id, route: 'straight', offset: 2.5 })!;
  assert.ok(route);
  assert.ok(route.switches.some((v) => v.route === 'branch'));
  assert.equal(railAnchorPose(s, siding(65)), undefined);
  assert.equal(planMainlineExit(s).error, '');
  assert.ok(railRoute(s, siding(30), main(180)));
  const through = railRoute(s, siding(30), siding(85))!;
  assert.ok(through);
  assert.ok(through.tracks.some((id) => s.rails.find((r) => r.id === id)?.track?.origin.x === 80));
  assert.ok(through.switches.some((v) => v.route === 'straight'));
  assert.ok(railInterval(s, siding(85), 15, 5));
  assert.equal(
    railInterval(s, siding(50), 15, 15),
    undefined,
    'Ambiguous forward fork is not silently chosen for a parked interval',
  );
  assert.doesNotThrow(() => load(save(s)));
});

test('normal factory access uses seven physical panel jobs and then exposes its branch', () => {
  const s = createState(),
    machine = seedHandlingResources(s, 'excavator');
  machine.x = 75;
  machine.z = 25;
  s.workers.forEach((w, i) => {
    w.x = 73 + i;
    w.z = 23;
  });
  const result = planSidingAccess(s);
  assert.equal(result.error, '');
  assert.equal(s.rails.length, 0);
  result.jobs.forEach((j, i) => {
    const item = j.item!,
      m = MATERIALS[item];
    s.stacks.push({
      id: 'ACCESS-STOCK-' + i,
      item,
      qty: 1,
      reserved: 0,
      x: 35 + Math.floor(i / 3) * 15,
      z: 25 + (i % 3) * 15,
      w: m.w,
      d: m.d,
      source: 'opening',
    });
  });
  tickUntil(s, () => result.jobs.every((j) => j.status === 'done'), 4000);
  assert.ok(trackOpenPorts(s, false).some((p) => p.x === 100 && p.z === 10));
  const branch = s.rails.find((r) => r.track?.section === 3 && r.track.route === 'branch')!;
  assert.ok(railRoute(s, siding(30), { trackId: branch.id, route: 'branch', offset: 4 }));
});

test('recovering commissioned access rails leaves a physical gap and never regenerates protected original rails', () => {
  const s = createState();
  setCreativeMode(s, true);
  planSidingAccess(s);
  assert.ok(railRoute(s, siding(30), siding(85)));
  s.rails = s.rails.filter((r) => r.track?.section !== 0);
  assert.equal(railRoute(s, siding(30), siding(85)), undefined);
  s.rails = [];
  assert.equal(railRoute(s, siding(30), siding(85)), undefined);
  assert.equal(railAnchorPose(s, siding(65)), undefined);
});

test('caller clearance rejects a blocked shortcut and selects a continuous longer route around a physical loop', () => {
  const s = createState();
  const corners = [
    { x: 50, z: 30, heading: 0 as const },
    { x: 70, z: 50, heading: 1 as const },
    { x: 50, z: 70, heading: 2 as const },
    { x: 30, z: 50, heading: 3 as const },
  ];
  for (const [cornerIndex, corner] of corners.entries())
    for (const piece of trackSections('curve', corner, corner.heading, 1)) {
      const g = trackGeometry(piece);
      s.rails.push({
        id: `LOOP-${cornerIndex}-${piece.section}`,
        x: g.rect.x,
        z: g.rect.z,
        rotation: piece.heading % 2,
        length: g.length,
        track: piece,
      });
    }
  const from = { trackId: 'LOOP-0-0', route: 'straight' as const, offset: 1 },
    to = { trackId: 'LOOP-0-2', route: 'straight' as const, offset: 3 };
  const direct = railRoute(s, from, to)!;
  assert.ok(direct);
  assert.ok(direct.length < 15);
  const obstruction = railAnchorPose(s, { trackId: 'LOOP-0-1', route: 'straight', offset: 2.5 })!;
  const clear = railRoute(s, from, to, {
    allowArc: (points) =>
      points.every((p) => Math.hypot(p.x - obstruction.x, p.z - obstruction.z) > 0.7),
  })!;
  assert.ok(clear);
  assert.ok(clear.length > 100);
  assert.ok(clear.tracks.includes('LOOP-3-3'));
  assert.ok(!clear.tracks.includes('LOOP-0-1'));
  for (let i = 1; i < clear.points.length; i++)
    assert.ok(
      Math.abs(
        Math.atan2(
          Math.sin(clear.points[i].yaw - clear.points[i - 1].yaw),
          Math.cos(clear.points[i].yaw - clear.points[i - 1].yaw),
        ),
      ) < 0.03,
    );
});

test('clearance samples sparse straight interiors and buffers stay enforced unless explicitly disabled', () => {
  const s = createState();
  assert.equal(
    railRoute(s, siding(20), siding(80), {
      allowArc: (points) => points.every((p) => Math.abs(p.x - 75) > 1),
    }),
    undefined,
  );
  s.buffers = [{ id: 'STOP', x: 75, z: 5, y: 0.2, yaw: 0, secured: true, carried: false }];
  assert.equal(railRoute(s, siding(20), siding(80)), undefined);
  assert.ok(railRoute(s, siding(20), siding(80), { noBuffers: true }));
});

test('recovering the commissioned exit leaves a mainline gap instead of restoring the original steel', () => {
  const s = createState();
  assert.equal(mainlineExitCommissioned(s), false);
  setCreativeMode(s, true);
  assert.equal(planMainlineExit(s).error, '');
  assert.equal(mainlineExitCommissioned(s), true);
  const continuous = railRoute(s, main(120), main(170));
  assert.ok(continuous);
  assert.ok(continuous.tracks.some((id) => id !== 'BOOTSTRAP-MAINLINE'));
  assert.equal(railAnchorPose(s, main(135)), undefined);
  assert.ok(railInterval(s, main(120), 0, 50));
  s.rails = s.rails.filter((r) => r.track?.section !== 0);
  assert.equal(railRoute(s, main(120), main(170)), undefined);
  assert.equal(railInterval(s, main(120), 0, 50), undefined);
  s.rails = [];
  assert.equal(mainlineExitCommissioned(s), true);
  assert.equal(railRoute(s, main(120), main(170)), undefined);
  const restored = load(save(s));
  assert.equal(mainlineExitCommissioned(restored), true);
  assert.equal(railRoute(restored, main(120), main(170)), undefined);
});
