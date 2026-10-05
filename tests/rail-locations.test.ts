import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, load, save } from '../src/sim.ts';
import {
  nearestRailLocationAnchor,
  railLocationPath,
  railLocationPose,
  railLocationStatus,
  removeRailLocation,
  saveRailLocation,
} from '../src/rail-locations.ts';
import { railFootprint, trackGeometry, trackSections, type TrackPiece } from '../src/track.ts';
import type { Rail, RailLocation, State } from '../src/types.ts';

const input = (changes: Partial<RailLocation> = {}) => ({
  name: 'Concrete receiving',
  kind: 'unloading' as const,
  trackId: 'BOOTSTRAP-SIDING',
  route: 'straight' as const,
  offset: 35,
  length: 20,
  ...changes,
});
function create(s: State, changes: Partial<RailLocation> = {}) {
  assert.equal(saveRailLocation(s, input(changes)), undefined);
  return s.railLocations!.at(-1)!;
}
function install(s: State, track: TrackPiece, id: string): Rail {
  const rect = railFootprint(track),
    geometry = trackGeometry({ ...rect, id, rotation: 0, length: 5, track });
  const rail: Rail = { ...rect, id, rotation: track.heading % 2, length: geometry.length, track };
  s.rails.push(rail);
  return rail;
}
const close = (a: number, b: number, tolerance = 0.003) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} must be close to ${b}`);

test('named siding location has a centered interval on the actual rail centerline without logistics side effects', () => {
  const s = createState();
  const before = {
    orders: JSON.stringify(s.orders),
    jobs: JSON.stringify(s.jobs),
    costs: JSON.stringify(s.costs),
    stacks: JSON.stringify(s.stacks),
  };
  const loc = create(s);
  assert.ok(loc.id);
  assert.deepEqual(railLocationPose(s, loc), { x: 60, z: 5, yaw: 0 });
  assert.equal(railLocationStatus(s, loc).connected, true);
  const path = railLocationPath(s, loc)!;
  close(path[0].x, 50);
  close(path.at(-1)!.x, 70);
  assert.ok(path.every((p) => p.z === 5));
  assert.deepEqual(
    {
      orders: JSON.stringify(s.orders),
      jobs: JSON.stringify(s.jobs),
      costs: JSON.stringify(s.costs),
      stacks: JSON.stringify(s.stacks),
    },
    before,
  );
});

test('projection uses installed rail geometry, excludes the protected main line and rejects clicks beyond the search radius', () => {
  const s = createState();
  assert.equal(nearestRailLocationAnchor(s, { x: 75, z: 0 }, 1), undefined);
  assert.equal(nearestRailLocationAnchor(s, { x: 75, z: 20 }, 3), undefined);
  const anchor = nearestRailLocationAnchor(s, { x: 75, z: 6 }, 3)!;
  assert.equal(anchor.trackId, 'BOOTSTRAP-SIDING');
  assert.equal(anchor.route, 'straight');
  close(anchor.offset, 50);
  assert.deepEqual(anchor.point, { x: 75, z: 5, yaw: 0 });
  assert.equal(nearestRailLocationAnchor(s, { x: NaN, z: 5 }), undefined);
});

test('length spans a unique continuous installed run instead of being limited to a single five-meter panel', () => {
  const s = createState();
  s.rails.push(
    { id: 'RAIL-A', x: 125, z: 4, rotation: 0, length: 5 },
    { id: 'RAIL-B', x: 130, z: 4, rotation: 0, length: 5 },
  );
  const loc = create(s, { trackId: 'RAIL-A', offset: 2.5, length: 12 });
  assert.equal(railLocationStatus(s, loc).connected, true);
  const path = railLocationPath(s, loc)!;
  close(path[0].x, 121.5);
  close(path.at(-1)!.x, 133.5);
  assert.ok(path.every((p) => p.z === 5));
  assert.match(
    saveRailLocation(s, input({ name: 'Past buffer', trackId: 'RAIL-B', offset: 4, length: 5 }))!,
    /length|end|fit|span|interval/i,
  );
});

test('an unbuilt plan cannot be named or extend a location interval through a physical gap', () => {
  const s = createState();
  s.jobs.push({
    id: 'JOB-PLANNED',
    kind: 'rail',
    x: 125,
    z: 4,
    w: 5,
    d: 2,
    rotation: 0,
    qty: 1,
    status: 'todo',
    phase: '',
    reason: '',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: 0,
  });
  assert.ok(saveRailLocation(s, input({ trackId: 'JOB-PLANNED', offset: 2, length: 1 })));
  assert.equal(nearestRailLocationAnchor(s, { x: 128, z: 5 }, 1), undefined);
  assert.ok(saveRailLocation(s, input({ offset: 99, length: 6 })));
  assert.equal(s.railLocations?.length || 0, 0);
});

test('curved and branching rail locations project onto their selected real route with its tangent', () => {
  const s = createState();
  const curve = install(s, trackSections('curve', { x: 125, z: 5 }, 0, 1)[2], 'RAIL-CURVE');
  const cp = trackGeometry(curve).paths[0].points[12];
  const anchor = nearestRailLocationAnchor(s, cp, 0.1)!;
  assert.equal(anchor.trackId, curve.id);
  const loc = create(s, { trackId: curve.id, offset: anchor.offset, length: 1 });
  const pose = railLocationPose(s, loc)!;
  close(pose.x, cp.x);
  close(pose.z, cp.z);
  close(pose.yaw, cp.yaw);
  assert.equal(railLocationStatus(s, loc).connected, false);
  const turnout = install(s, trackSections('turnout', { x: 50, z: 40 }, 0, 1)[0], 'RAIL-POINTS');
  const bp = trackGeometry(turnout)
    .paths.find((p) => p.route === 'branch')!
    .points.at(-5)!;
  const branch = nearestRailLocationAnchor(s, bp, 0.1)!;
  assert.equal(branch.route, 'branch');
  const branchLoc = create(s, {
    name: 'Branch parking',
    trackId: turnout.id,
    route: 'branch',
    offset: branch.offset,
    length: 1,
  });
  close(railLocationPose(s, branchLoc)!.z, bp.z);
  assert.ok(
    saveRailLocation(
      s,
      input({ name: 'Missing branch', trackId: curve.id, route: 'branch', offset: 2, length: 1 }),
    ),
  );
});

test('names and finite bounds are validated transactionally and trimmed names are unique ignoring case', () => {
  const s = createState();
  const loc = create(s, { name: '  Concrete receiving  ' });
  assert.equal(loc.name, 'Concrete receiving');
  const before = save(s);
  for (const change of [
    { name: 'CONCRETE RECEIVING' },
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(65) },
    { name: 'Bad\nname' },
    { kind: 'secret' },
    { trackId: 'BOOTSTRAP-MAINLINE' },
    { trackId: 'MISSING' },
    { route: 'wrong' },
    { offset: NaN },
    { offset: Infinity },
    { offset: -1 },
    { offset: 101 },
    { offset: 10001 },
    { length: 0 },
    { length: 201 },
    { length: NaN },
    { length: Infinity },
  ]) {
    assert.ok(saveRailLocation(s, input(change as Partial<RailLocation>)), JSON.stringify(change));
    assert.equal(save(s), before, 'Failed edits must not consume IDs, add records or events');
  }
});

test('editing preserves a location ID, links and record count; deleting a marker does not recover track', () => {
  const s = createState(),
    loc = create(s);
  assert.equal(
    saveRailLocation(
      s,
      input({ id: loc.id, name: 'Fuel transfer', kind: 'transfer', offset: 60, length: 12 }),
    ),
    undefined,
  );
  assert.equal(s.railLocations!.length, 1);
  assert.equal(s.railLocations![0].id, loc.id);
  assert.deepEqual(railLocationPose(s, s.railLocations![0]), { x: 85, z: 5, yaw: 0 });
  assert.ok(saveRailLocation(s, input({ id: 'MISSING-EDIT', name: 'No such marker' })));
  assert.equal(removeRailLocation(s, loc.id), undefined);
  assert.equal(s.railLocations!.length, 0);
  assert.ok(removeRailLocation(s, loc.id));
  assert.equal(s.jobs.length, 0);
  assert.deepEqual(s.buffer, { x: 125, z: 5 });
});

test('save reload preserves named locations and a legacy yard imports without invented locations', () => {
  const s = createState(),
    loc = create(s);
  const restored = load(save(s));
  assert.deepEqual(restored.railLocations, s.railLocations);
  assert.deepEqual(
    railLocationPose(restored, restored.railLocations![0]),
    railLocationPose(s, loc),
  );
  const legacy = JSON.parse(save(createState()));
  delete legacy.railLocations;
  assert.deepEqual(load(JSON.stringify(legacy)).railLocations, []);
});

test('recovering a referenced panel leaves an explicit orphan rather than silently moving the marker', () => {
  const s = createState();
  s.rails.push({ id: 'RAIL-ORPHAN', x: 125, z: 4, rotation: 0, length: 5 });
  const loc = create(s, { trackId: 'RAIL-ORPHAN', offset: 2.5, length: 2 });
  s.rails = [];
  assert.equal(railLocationPose(s, loc), undefined);
  assert.equal(railLocationStatus(s, loc).connected, false);
  assert.match(railLocationStatus(s, loc).reason, /missing|recover|removed/i);
  const restored = load(save(s));
  assert.equal(restored.railLocations![0].trackId, 'RAIL-ORPHAN');
  assert.equal(railLocationPose(restored, restored.railLocations![0]), undefined);
});

test('recovering a neighboring span panel keeps the anchor but explicitly reports the now-incomplete interval', () => {
  const s = createState();
  s.rails.push(
    { id: 'RAIL-A', x: 125, z: 4, rotation: 0, length: 5 },
    { id: 'RAIL-B', x: 130, z: 4, rotation: 0, length: 5 },
  );
  const loc = create(s, { trackId: 'RAIL-A', offset: 2.5, length: 12 });
  s.rails.pop();
  assert.ok(railLocationPose(s, loc));
  assert.equal(railLocationPath(s, loc), undefined);
  assert.match(railLocationStatus(s, loc).reason, /length|end|fit|span|interval/i);
  assert.equal(load(save(s)).railLocations![0].id, loc.id);
});

test('malformed imported location records and duplicate IDs or names fail before the yard loads', () => {
  const s = createState();
  create(s);
  for (const change of [
    { name: 'Bad\u0000name' },
    { id: '' },
    { kind: 'bogus' },
    { route: 'bogus' },
    { offset: -1 },
    { offset: 101 },
    { length: 0 },
    { length: 201 },
  ]) {
    const raw = JSON.parse(save(s));
    Object.assign(raw.railLocations[0], change);
    assert.throws(() => load(JSON.stringify(raw)), /location|rail|save/i);
  }
  const raw = JSON.parse(save(s));
  raw.railLocations.push({ ...raw.railLocations[0], name: 'Other name' });
  assert.throws(() => load(JSON.stringify(raw)), /duplicate|location|identifier/i);
  raw.railLocations[1].id = 'RLOC-OTHER';
  raw.railLocations[1].name = 'concrete RECEIVING';
  assert.throws(() => load(JSON.stringify(raw)), /duplicate|location|name/i);
});

test('usable length does not guess a route across an ambiguous turnout junction', () => {
  const s = createState();
  install(s, trackSections('turnout', { x: 125, z: 5 }, 0, 1)[0], 'RAIL-POINTS');
  assert.ok(saveRailLocation(s, input({ offset: 99, length: 4 })));
  assert.equal(s.railLocations?.length || 0, 0);
  const within = create(s, { offset: 96, length: 4 });
  assert.ok(railLocationPath(s, within));
});

test('a centered span follows a matching reversed panel and never bridges a merely crossing track', () => {
  const s = createState();
  s.rails.push({ id: 'RAIL-A', x: 125, z: 4, rotation: 0, length: 5 });
  install(s, trackSections('straight', { x: 135, z: 5 }, 2, 1)[0], 'RAIL-REVERSED');
  const loc = create(s, { trackId: 'RAIL-A', offset: 2.5, length: 12 });
  close(railLocationPath(s, loc)!.at(-1)!.x, 133.5);
  s.rails.pop();
  s.rails.push({ id: 'RAIL-CROSSING', x: 129, z: 1, rotation: 1, length: 10 });
  assert.equal(railLocationPath(s, loc), undefined);
});
