import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { trackGeometry, trackNetwork, trackOpenPorts, snapTrackStart } from '../src/track';
import { bufferAssets } from '../src/buffers';
import { renderState } from '../native-runtime/render';
import { seedHandlingResources, tickUntil } from './support/yard';

function retainedTail(cancel = true) {
  const s = S.createState();
  S.setCreativeMode(s, true);
  for (const [layout, origin, heading] of [
    ['curve', { x: 125, z: 5 }, 0],
    ['curve', { x: 145, z: 25 }, 1],
    ['turnout', { x: 125, z: 45 }, 2],
  ] as const)
    assert.equal(S.planRailLayout(s, layout, origin, heading).error, '');
  for (const z of [40, 45])
    for (const x of [105, 100])
      assert.equal(S.planRailLayout(s, 'straight', { x, z }, 2).error, '');
  S.setCreativeMode(s, false);
  const work = S.planRailLayout(s, 'turnout', { x: 95, z: 45 }, 2, 1, 'converging');
  assert.equal(work.error, '');
  const tail = work.jobs[0],
    g = trackGeometry(tail);
  const rail = {
    id: S.id(s, 'rail'),
    ...g.rect,
    rotation: tail.rotation,
    length: g.length,
    item: tail.item,
    track: tail.track,
  };
  s.rails.push(rail);
  Object.assign(tail, {
    status: 'done',
    delivered: true,
    progress: 1,
    phase: 'Complete',
    finished: s.time,
  });
  Object.assign(s.buffers![0], { x: 90, z: 45, yaw: Math.PI });
  s.buffer = { x: 90, z: 45 };
  if (cancel) for (const j of work.jobs.slice(1)) S.cancelJob(s, j.id);
  S.load(S.save(s));
  return { s, work, rail };
}

test('a retained canceled converging tail is a real open endpoint in planning, snapping and native rendering after reload', () => {
  const original = retainedTail(),
    s = S.load(S.save(original.s));
  for (const includePlanned of [false, true]) {
    const tail = trackOpenPorts(s, includePlanned).find((p) => p.assetId === original.rail.id);
    assert.ok(tail);
    assert.equal(tail.x, 90);
    assert.equal(tail.z, 45);
    assert.deepEqual(snapTrackStart(s, { x: 90, z: 45 }, undefined, includePlanned, 8)?.origin, {
      x: 90,
      z: 45,
    });
    assert.equal(snapTrackStart(s, { x: 90, z: 45 }, undefined, includePlanned, 8)?.heading, 2);
    assert.equal(
      trackOpenPorts(s, includePlanned).some((p) => p.x === 75 && p.z === 45),
      false,
      'Unbuilt macro exit does not exist',
    );
  }
  const endpoint = renderState(s).railOpenEndpoints.find(
    (p: any) => p.trackId === original.rail.id,
  );
  assert.ok(endpoint);
  assert.equal(endpoint.occupiedBy, 'BUFFER-001');
  assert.equal(S.validRailLayout(s, 'straight', { x: 90, z: 45 }, 2), '');
  assert.equal(
    S.planBufferStop(s, { x: 90, z: 45 }).error,
    'This endpoint already has a buffer stop.',
  );
});

test('active or canceling assembly work still protects temporary internal joints', () => {
  const { s, work, rail } = retainedTail(false);
  assert.ok(trackNetwork(s).openPorts.some((p) => p.assetId === rail.id));
  assert.equal(
    trackOpenPorts(s, false).some((p) => p.assetId === rail.id),
    false,
  );
  assert.equal(
    trackOpenPorts(s, true).some((p) => p.assetId === rail.id),
    false,
  );
  for (const j of work.jobs.slice(1)) S.cancelJob(s, j.id);
  Object.assign(work.jobs[0], { status: 'doing', cancel: true, railBufferCleanup: true });
  assert.equal(
    trackOpenPorts(s, false).some((p) => p.assetId === rail.id),
    false,
    'Wait for real buffer cleanup',
  );
  work.jobs[0].status = 'done';
  assert.ok(trackOpenPorts(s, false).some((p) => p.assetId === rail.id));
});

test('a real extension from a retained tail gets built and moves the same buffer with conserved rails', () => {
  const { s, rail } = retainedTail();
  const equipment = seedHandlingResources(s, 'excavator');
  Object.assign(equipment, { x: 103, z: 58.5, yaw: Math.PI, heading: 2 });
  s.workers.forEach((w, i) => Object.assign(w, { x: 104 + i, z: 58.5 }));
  s.stacks.push({
    id: S.id(s, 'stack'),
    item: 'rail',
    x: 80,
    z: 57,
    w: 5,
    d: 2,
    qty: 1,
    reserved: 0,
    source: 'opening',
    yaw: 0,
  });
  const beforeRails = s.rails.map((r) => r.id),
    bufferId = bufferAssets(s)[0].id;
  const planned = S.planRailLayout(s, 'straight', { x: 90, z: 45 }, 2);
  assert.equal(planned.error, '');
  tickUntil(s, () => planned.jobs[0].status === 'done', 1500);
  assert.ok(s.rails.some((r) => r.id === rail.id));
  assert.deepEqual(
    s.rails.filter((r) => beforeRails.includes(r.id)).map((r) => r.id),
    beforeRails,
  );
  assert.equal(s.rails.length, beforeRails.length + 1);
  assert.equal(bufferAssets(s)[0].id, bufferId);
  assert.equal(bufferAssets(s)[0].x, 85);
  assert.equal(bufferAssets(s)[0].z, 45);
  assert.equal(bufferAssets(s)[0].secured, true);
  assert.equal(s.stacks[0].qty, 0);
  assert.doesNotThrow(() => S.load(S.save(s)));
});

test('retained tails can start a new convergence after the two real ends are aligned', () => {
  const { s } = retainedTail();
  S.setCreativeMode(s, true);
  assert.equal(S.planRailLayout(s, 'straight', { x: 90, z: 45 }, 2).error, '');
  assert.equal(S.planRailLayout(s, 'straight', { x: 95, z: 40 }, 2).error, '');
  assert.equal(S.planRailLayout(s, 'straight', { x: 90, z: 40 }, 2).error, '');
  const convergence = S.planRailLayout(s, 'turnout', { x: 85, z: 45 }, 2, 1, 'converging');
  assert.equal(convergence.error, '');
  assert.equal(convergence.jobs.length, 7);
  assert.ok(trackOpenPorts(s, false).some((p) => p.x === 65 && p.z === 45));
  assert.equal(bufferAssets(s)[0].x, 65);
  assert.equal(bufferAssets(s)[0].secured, true);
  assert.doesNotThrow(() => S.load(S.save(s)));
});

test('unbuilt canceled assemblies do not invent endpoints and disconnected retained stock cannot become a building anchor', () => {
  const s = S.createState(),
    unbuilt = S.planRailLayout(s, 'curve', { x: 125, z: 5 });
  for (const j of unbuilt.jobs) S.cancelJob(s, j.id);
  assert.deepEqual(
    trackOpenPorts(s, false).map((p) => [p.x, p.z]),
    [[125, 5]],
  );
  const retained = retainedTail();
  retained.s.rails = retained.s.rails.filter((r) => r.id === retained.rail.id);
  assert.equal(
    trackOpenPorts(retained.s, false).some((p) => p.assetId === retained.rail.id),
    false,
  );
  assert.match(
    S.validRailLayout(retained.s, 'straight', { x: 90, z: 45 }, 2),
    /open track endpoint/,
  );
});

test('exposing a canceled curved panel does not force a non-grid tangent into a straight connection', () => {
  const s = S.createState(),
    work = S.planRailLayout(s, 'curve', { x: 125, z: 5 });
  const j = work.jobs[0],
    g = trackGeometry(j);
  s.rails.push({
    id: S.id(s, 'rail'),
    ...g.rect,
    rotation: j.rotation,
    length: g.length,
    item: j.item,
    track: j.track,
  });
  Object.assign(j, { status: 'done', delivered: true });
  for (const other of work.jobs.slice(1)) S.cancelJob(s, other.id);
  assert.ok(trackOpenPorts(s, false).some((p) => Math.hypot(p.x - g.end.x, p.z - g.end.z) < 0.01));
  assert.equal(
    snapTrackStart(s, g.end, undefined, false),
    undefined,
    'Fractional or noncardinal joints cannot snap to the meter grid',
  );
  assert.match(
    S.validRailLayout(s, 'straight', { x: Math.round(g.end.x), z: Math.round(g.end.z) }, 0),
    /open track endpoint/,
  );
});
