import { seedHandlingResources, tickUntil } from './support/yard.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { trackGeometry, trackOpenPorts } from '../src/track.ts';
import { packPurchase, orderDeckLength, FREIGHT_DECK_LENGTH } from '../src/procurement.ts';
import { MATERIALS } from '../src/catalog.ts';
import type { Item } from '../src/types.ts';

test('curve planning has six real curved panels, exact material demand, and a reusable saved parent', () => {
  const s = S.createState(),
    result = S.planRailLayout(s, 'curve', { x: 125, z: 5 });
  assert.equal(result.error, '');
  assert.equal(result.jobs.length, 6);
  assert.ok(result.jobs.every((j) => j.item === 'railCurve' && j.parentId === result.group!.id));
  assert.equal(S.missingMaterials(s).railCurve, 6);
  assert.equal(S.missingMaterials(s).rail, undefined);
  const restored = S.load(S.save(s));
  assert.deepEqual(
    restored.jobs.map((j) => j.track),
    s.jobs.map((j) => j.track),
  );
  assert.deepEqual(
    trackOpenPorts(s, true)
      .filter((p) => p.end === 'exit')
      .map((p) => ({ x: p.x, z: p.z })),
    [{ x: 145, z: 25 }],
  );
  const straight = S.planRailLayout(s, 'straight', { x: 145, z: 25 }, 1);
  assert.equal(straight.error, '');
  assert.equal(straight.jobs[0].item, 'rail');
  assert.equal(trackGeometry(straight.jobs[0]).end.z, 30);
});

test('turnout demand includes seven transportable panels at four stations, not one wide assembly', () => {
  const s = S.createState(),
    r = S.planRailLayout(s, 'turnout', { x: 125, z: 5 });
  assert.equal(r.error, '');
  assert.equal(r.jobs.length, 7);
  const bill = S.missingMaterials(s);
  assert.deepEqual(bill, { railPoints: 1, rail: 3, railFrog: 1, railClosure: 1, railExit: 1 });
  for (const j of r.jobs) assert.ok(MATERIALS[j.item!].d <= 3);
  const loads = packPurchase(
    Object.entries(bill).map(([item, qty]) => ({ item, qty: qty! })),
    'rail',
  );
  for (const l of loads) assert.ok(orderDeckLength(l.manifest) <= FREIGHT_DECK_LENGTH.rail);
  assert.deepEqual(
    trackOpenPorts(s, true)
      .filter((p) => p.end === 'exit')
      .map((p) => ({ x: p.x, z: p.z })),
    [
      { x: 145, z: 5 },
      { x: 145, z: 10 },
    ],
  );
  assert.equal(S.setTurnoutRoute(s, 'bogus', 'branch'), 'Select the turnout points module.');
});

test('track layouts require an open tangent-matched endpoint and reject blocked beds without mutation', () => {
  const s = S.createState();
  assert.match(S.planRailLayout(s, 'curve', { x: 50, z: 25 }).error, /endpoint/);
  assert.match(S.planRailLayout(s, 'curve', { x: 125, z: 5 }, 1).error, /endpoint/);
  assert.match(S.planRailLayout(s, 'curve', { x: 125, z: 5 }, 0, -1).error, /corridor/);
  s.zones.push({ id: 'ZONE-TEST', name: 'Stock', x: 140, z: 20, w: 6, d: 8 });
  assert.match(S.planRailLayout(s, 'curve', { x: 125, z: 5 }).error, /stockyard/);
  assert.equal(s.jobs.length, 0);
  assert.equal(s.jobGroups, undefined);
});

test('turnout control requires every physically installed panel and saves the selected route', () => {
  const s = S.createState(),
    result = S.planRailLayout(s, 'turnout', { x: 125, z: 5 });
  for (const j of result.jobs) {
    const g = trackGeometry(j);
    s.rails.push({
      id: S.id(s, 'rail'),
      x: g.rect.x,
      z: g.rect.z,
      rotation: j.rotation,
      length: g.length,
      item: j.item,
      track: j.track,
    });
    j.status = 'done';
    j.delivered = true;
  }
  const points = s.rails[0];
  result.jobs[6].status = 'todo';
  assert.match(S.setTurnoutRoute(s, points.id, 'branch'), /Finish/);
  result.jobs[6].status = 'done';
  const detached = s.rails.pop()!;
  assert.match(S.setTurnoutRoute(s, points.id, 'branch'), /Finish/);
  s.rails.push(detached);
  assert.equal(S.setTurnoutRoute(s, points.id, 'branch'), '');
  assert.equal(s.rails[0].selectedRoute, undefined);
  seedHandlingResources(s, 'excavator');
  tickUntil(s, () => s.rails[0].selectedRoute === 'branch', 600);
  assert.equal(S.load(S.save(s)).rails[0].selectedRoute, 'branch');
  assert.equal(S.removeBuilding(s, points.id), '');
  assert(s.jobs.some((j) => j.railRecovery?.railId === points.id && j.status === 'todo'));
  assert.match(S.setTurnoutRoute(s, points.id, 'branch'), /recovery/);
  S.load(S.save(s));
});

test('canceled unbuilt track panels can resume without changing their work order or demand', () => {
  const s = S.createState(),
    r = S.planRailLayout(s, 'curve', { x: 125, z: 5 });
  S.cancelJob(s, r.jobs[0].id);
  assert.equal(r.jobs[0].status, 'canceled');
  assert.equal(
    trackOpenPorts(s, true).some((p) => p.x === 145 && p.z === 25),
    false,
  );
  assert.equal(S.resumeTrackWork(s, r.group!.id), '');
  assert.equal(r.jobs[0].status, 'todo');
  assert.equal(S.missingMaterials(s).railCurve, 6);
  assert.doesNotThrow(() => S.load(S.save(s)));
});

test('new saves reject mismatched custom geometry and preserve old straight panel saves', () => {
  const s = S.createState(),
    r = S.planRailLayout(s, 'curve', { x: 125, z: 5 });
  const altered = JSON.parse(S.save(s));
  altered.jobs[0].item = 'rail';
  assert.throws(() => S.load(JSON.stringify(altered)), /geometry or material/);
  const alteredRect = JSON.parse(S.save(s));
  alteredRect.jobs[0].w = 100;
  assert.throws(() => S.load(JSON.stringify(alteredRect)), /footprint/);
  const old = S.createState();
  old.rails.push({ id: S.id(old, 'rail'), x: 125, z: 4, rotation: 0, length: 5 });
  assert.equal(S.load(S.save(old)).rails[0].length, 5);
  for (const item of ['railCurve', 'railPoints', 'railFrog', 'railClosure', 'railExit'] as Item[])
    assert.equal(S.totals(old, item).installed, 0);
});

test('queue priority cannot skip preceding physical track panels', () => {
  const s = S.createState(),
    r = S.planRailLayout(s, 'curve', { x: 125, z: 5 });
  s.jobs.unshift(s.jobs.pop()!);
  S.tick(s, 0.5);
  assert.match(s.jobs[0].reason, /preceding panel/);
  assert.equal(s.jobs[0].status, 'todo');
});

test('pending plans at a joint and occupied canceled footprints cannot be silently overwritten', () => {
  const s = S.createState();
  s.jobs.push({
    id: 'JOB-TEST',
    kind: 'lamp',
    x: 125,
    z: 4,
    w: 1,
    d: 1,
    rotation: 0,
    qty: 1,
    status: 'todo',
    phase: 'Waiting',
    reason: '',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: 0,
  });
  assert.match(S.planRailLayout(s, 'curve', { x: 125, z: 5 }).error, /plan occupies/);
  s.jobs = [];
  const r = S.planRailLayout(s, 'curve', { x: 125, z: 5 });
  for (const j of r.jobs) S.cancelJob(s, j.id);
  s.zones.push({ id: 'ZONE-OTHER', name: 'New stock', x: 140, z: 20, w: 6, d: 8 });
  assert.match(S.resumeTrackWork(s, r.group!.id), /occupies/);
  assert.ok(r.jobs.every((j) => j.status === 'canceled'));
});

test('a planned chain cannot start a downstream curve before its connecting track exists', () => {
  const s = S.createState(),
    upstream = S.planRailLayout(s, 'straight', { x: 125, z: 5 });
  const downstream = S.planRailLayout(s, 'curve', { x: 130, z: 5 });
  assert.equal(downstream.error, '');
  s.jobs.unshift(...s.jobs.splice(1));
  S.tick(s, 0.5);
  assert.match(downstream.jobs[0].reason, /connecting track work order/);
  assert.equal(upstream.jobs[0].status, 'todo');
});

test('other plans and stockyards use the curved track strip, while paving cannot obstruct queued rail', () => {
  const s = S.createState();
  S.planRailLayout(s, 'curve', { x: 125, z: 5 });
  assert.equal(S.validPlan(s, 'lamp', { x: 127, z: 18, w: 1, d: 1 }), '');
  assert.equal(S.addZone(s, { x: 127, z: 18, w: 3, d: 3 }), '');
  assert.match(S.validPlan(s, 'slab', { x: 144, z: 23, w: 1, d: 1 }), /plan occupies/);
});
