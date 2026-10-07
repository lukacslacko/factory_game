import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { bufferAssets } from '../src/buffers';
import { trackGeometry, trackSections } from '../src/track';
import { railRoute } from '../src/rail-routing';
import { orderShunter } from '../src/rail-operations';
import type { State } from '../src/types';

const siding = (offset: number) => ({
  trackId: 'BOOTSTRAP-SIDING',
  route: 'straight' as const,
  offset,
});
function creativeYard() {
  const s = S.createState();
  S.setCreativeMode(s, true);
  assert.equal(S.addZone(s, { x: 150, z: 35, w: 20, d: 20 }), '');
  return s;
}
function storedStops(s: State) {
  return s.stacks.filter((t) => t.item === 'bufferStop' && t.qty > 0);
}
function installStraight(s: State, x: number, z: number) {
  const track = trackSections('straight', { x, z }, 0)[0],
    g = trackGeometry(track);
  const r = {
    id: S.id(s, 'rail'),
    ...g.rect,
    rotation: 0,
    length: g.length,
    item: 'rail' as const,
    track,
  };
  s.rails.push(r);
  return r;
}

test('Creative stop recovery is immediate and preserves opening inventory identity through reload', () => {
  let s = creativeYard();
  assert.equal(S.removeBufferStop(s, 'BUFFER-001'), '');
  assert.deepEqual(bufferAssets(s), []);
  assert.equal(s.equipment.length, 0);
  assert.equal(s.workers.length, 0);
  assert.ok(s.jobs.every((j) => ['done', 'canceled'].includes(j.status)));
  assert.deepEqual(
    storedStops(s).map((t) => [t.assetId, t.qty, t.reserved]),
    [['BUFFER-001', 1, 0]],
  );
  assert.equal(S.totals(s, 'bufferStop').recovered, 1);
  assert.equal(S.totals(s, 'bufferStop').stored, 1);
  s = S.load(S.save(s));
  assert.equal(bufferAssets(s).length, 0);
  assert.equal(storedStops(s)[0].assetId, 'BUFFER-001');
  assert.match(S.removeBufferStop(s, 'BUFFER-001'), /not found/i);
  assert.equal(storedStops(s).length, 1);
});

test('Creative recovery with no stockyard does not remove or mutate the stop', () => {
  const s = creativeYard();
  s.zones = [];
  const before = S.save(s);
  assert.match(S.removeBufferStop(s, 'BUFFER-001'), /stockyard|storage|space/i);
  assert.equal(S.save(s), before);
});

test('the common recovery tool selects a mounted buffer before its underlying rail', () => {
  const s = creativeYard();
  assert.equal(S.planRailLayout(s, 'straight', { x: 125, z: 5 }).error, '');
  const railIds = s.rails.map((r) => r.id);
  assert.equal(S.recoverAt(s, { x: 129.8, z: 5.2 }), '');
  assert.equal(bufferAssets(s).length, 0);
  assert.deepEqual(
    s.rails.map((r) => r.id),
    railIds,
  );
  assert.equal(storedStops(s)[0].assetId, 'BUFFER-001');
  assert.doesNotThrow(() => S.load(S.save(s)));
});

test('a crossing endpoint with the wrong tangent cannot recover a nearby stop as a turnout connection', () => {
  const s = creativeYard();
  const track = trackSections('straight', { x: 145, z: 10 }, 1)[0],
    g = trackGeometry(track);
  s.rails.push({
    id: S.id(s, 'rail'),
    ...g.rect,
    rotation: 1,
    length: g.length,
    item: 'rail',
    track,
  });
  s.buffers = [
    ...bufferAssets(s),
    {
      id: 'BUFFER-CROSSING',
      x: 145,
      z: 10,
      y: 0.2,
      yaw: -Math.PI / 2,
      secured: true,
      carried: false,
      source: 'opening',
    },
  ];
  const before = S.save(s);
  assert.ok(S.planRailLayout(s, 'turnout', { x: 125, z: 5 }).error);
  assert.equal(S.save(s), before);
});

test('a diverging turnout recovers a stop on its connected outgoing branch instead of leaving it across running rails', () => {
  const s = creativeYard();
  const downstream = installStraight(s, 145, 10);
  s.buffers = [
    ...bufferAssets(s),
    {
      id: 'BUFFER-DOWNSTREAM',
      x: 145,
      z: 10,
      y: 0.2,
      yaw: Math.PI,
      secured: true,
      carried: false,
      source: 'opening',
    },
  ];
  const result = S.planRailLayout(s, 'turnout', { x: 125, z: 5 });
  assert.equal(result.error, '');
  assert.ok(result.jobs.every((j) => j.status === 'done'));
  assert.deepEqual(
    bufferAssets(s).map((b) => [b.id, b.x, b.z, b.secured]),
    [['BUFFER-001', 145, 5, true]],
  );
  assert.deepEqual(
    storedStops(s).map((t) => [t.assetId, t.qty]),
    [['BUFFER-DOWNSTREAM', 1]],
  );
  assert.ok(railRoute(s, siding(90), { trackId: downstream.id, route: 'straight', offset: 4 }));
  assert.equal(S.totals(s, 'bufferStop').recovered, 1);
  const loaded = S.load(S.save(s));
  assert.deepEqual(bufferAssets(loaded), bufferAssets(s));
  assert.deepEqual(storedStops(loaded), storedStops(s));
});

test('Creative connection recovery fails atomically when the redundant stop cannot be stored', () => {
  const s = creativeYard();
  installStraight(s, 145, 10);
  s.buffers = [
    ...bufferAssets(s),
    {
      id: 'BUFFER-DOWNSTREAM',
      x: 145,
      z: 10,
      y: 0.2,
      yaw: Math.PI,
      secured: true,
      carried: false,
      source: 'opening',
    },
  ];
  s.zones = [];
  const before = S.save(s);
  const result = S.planRailLayout(s, 'turnout', { x: 125, z: 5 });
  assert.match(result.error, /stockyard|storage|space/i);
  assert.equal(S.save(s), before);
});

test('normal divergent connection waits for physical recovery of the downstream stop before installing its final branch panel', () => {
  const s = creativeYard();
  S.setCreativeMode(s, false);
  installStraight(s, 145, 10);
  s.buffers = [
    ...bufferAssets(s),
    {
      id: 'BUFFER-DOWNSTREAM',
      x: 145,
      z: 10,
      y: 0.2,
      yaw: Math.PI,
      secured: true,
      carried: false,
      source: 'opening',
    },
  ];
  const result = S.planRailLayout(s, 'turnout', { x: 125, z: 5 });
  assert.equal(result.error, '');
  const branch = result.jobs.find((j) => j.track?.section === 3 && j.track.route === 'branch')!;
  // Earlier modules are an already completed construction pass. This isolates
  // the safety gate at the existing buffered downstream connection.
  for (const j of result.jobs.filter((j) => j !== branch)) {
    const g = trackGeometry(j);
    s.rails.push({
      id: S.id(s, 'rail'),
      ...g.rect,
      rotation: j.rotation,
      length: g.length,
      item: j.item,
      track: j.track,
    });
    j.status = 'done';
    j.delivered = true;
  }
  Object.assign(s.buffers[0], { x: 145, z: 5 });
  s.buffer = { x: 145, z: 5 };
  for (let n = 0; n < 20; n++) S.tick(s, 0.1);
  const recoveries = s.jobs.filter((j) => j.kind === 'remove' && j.target === 'BUFFER-DOWNSTREAM');
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].item, 'bufferStop');
  assert.equal(recoveries[0].status, 'todo');
  assert.equal(branch.status, 'todo');
  assert.equal(branch.delivered, false);
  assert.match(branch.reason, /BUFFER-DOWNSTREAM.*recovered/);
  assert.equal(bufferAssets(s).find((b) => b.id === 'BUFFER-DOWNSTREAM')?.secured, true);
  assert.equal(storedStops(s).length, 0);
  assert.doesNotThrow(() => S.load(S.save(s)));
});

test('Creative convergence keeps one end stop and immediately stores the surplus stop with its original ID', () => {
  const s = creativeYard();
  assert.equal(S.planRailLayout(s, 'turnout', { x: 125, z: 5 }).error, '');
  for (const z of [5, 10])
    for (const x of [145, 150]) assert.equal(S.planRailLayout(s, 'straight', { x, z }).error, '');
  assert.equal(S.planBufferStop(s, { x: 155, z: 10 }).error, '');
  const beforeIds = bufferAssets(s)
    .map((b) => b.id)
    .sort();
  const result = S.planRailLayout(s, 'turnout', { x: 155, z: 5 }, 0, 1, 'converging');
  assert.equal(result.error, '');
  assert.deepEqual(
    bufferAssets(s).map((b) => [b.x, b.z, b.secured]),
    [[175, 5, true]],
  );
  assert.equal(storedStops(s).length, 1);
  assert.deepEqual(
    [...bufferAssets(s).map((b) => b.id), ...storedStops(s).map((t) => t.assetId)].sort(),
    beforeIds,
  );
  assert.doesNotThrow(() => S.load(S.save(s)));
});

test('a parked locomotive prevents instant Creative buffer recovery under its body', () => {
  const s = creativeYard();
  assert.equal(orderShunter(s).error, undefined);
  const e = s.shunters![0];
  Object.assign(e, { phase: 'parked', x: 124, z: 5, yaw: 0, anchor: siding(99) });
  const before = S.save(s);
  const error = S.removeBufferStop(s, 'BUFFER-001');
  assert.ok(error.includes(e.id), error);
  assert.equal(S.save(s), before);
  assert.ok(S.removeBuilding(s, 'BUFFER-001').includes(e.id));
  assert.equal(S.save(s), before);
});

test('reserved train movement prevents buffer recovery even before the locomotive reaches the stop', () => {
  const s = creativeYard();
  assert.equal(orderShunter(s).error, undefined);
  const e = s.shunters![0];
  const route = railRoute(s, siding(80), siding(100))!;
  assert.ok(route);
  Object.assign(e, {
    phase: 'approaching',
    x: 105,
    z: 5,
    yaw: 0,
    anchor: siding(80),
    movement: { ...route, distance: 0, end: route.length, velocity: 0, clock: 0 },
  });
  const before = S.save(s);
  const error = S.removeBufferStop(s, 'BUFFER-001');
  assert.match(error, /reserved|movement|train|locomotive/i);
  assert.equal(S.save(s), before);
});

for (const creative of [false, true]) {
  const mode = creative ? 'Creative' : 'normal';
  test(`${mode} buffer placement refuses an endpoint occupied by a locomotive without mutating the yard`, () => {
    const s = creativeYard();
    S.setCreativeMode(s, creative);
    s.buffers = [];
    assert.equal(orderShunter(s).error, undefined);
    const e = s.shunters![0];
    Object.assign(e, { phase: 'parked', x: 124, z: 5, yaw: 0, anchor: siding(99) });
    const before = S.save(s);
    const result = S.planBufferStop(s, { x: 125, z: 5 });
    assert.ok(result.error.includes(e.id), result.error);
    assert.equal(result.job, undefined);
    assert.equal(S.save(s), before);
  });

  test(`${mode} buffer placement refuses an endpoint reserved by an approaching locomotive without mutating the yard`, () => {
    const s = creativeYard();
    S.setCreativeMode(s, creative);
    s.buffers = [];
    assert.equal(orderShunter(s).error, undefined);
    const e = s.shunters![0], route = railRoute(s, siding(80), siding(100))!;
    assert.ok(route);
    Object.assign(e, {
      phase: 'approaching', x: 105, z: 5, yaw: 0, anchor: siding(80),
      movement: { ...route, distance: 0, end: route.length, velocity: 0, clock: 0 },
    });
    const before = S.save(s);
    const result = S.planBufferStop(s, { x: 125, z: 5 });
    assert.match(result.error, /reserved|movement|train|locomotive/i);
    assert.equal(result.job, undefined);
    assert.equal(S.save(s), before);
  });
}

test('secured buffer stops still block train routing across their position, including sparse straight paths', () => {
  const s = creativeYard();
  s.buffers = [
    {
      id: 'BUFFER-MID',
      x: 80,
      z: 5,
      y: 0.2,
      yaw: 0,
      secured: true,
      carried: false,
      source: 'opening',
    },
  ];
  assert.equal(railRoute(s, siding(20), siding(80)), undefined);
  assert.ok(railRoute(s, siding(20), siding(80), { noBuffers: true }));
  assert.equal(S.removeBufferStop(s, 'BUFFER-MID'), '');
  assert.ok(railRoute(s, siding(20), siding(80)));
});
