import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURVE_RADIUS,
  CURVE_SECTION_ANGLE,
  portsConnect,
  railCells,
  railFootprint,
  snapTrackStart,
  trackGeometry,
  trackLocalPaths,
  trackMacroPorts,
  trackNetwork,
  trackOpenPorts,
  trackSections,
  validTrackPiece,
  type TrackPiece,
  type TrackPort,
} from '../src/track.ts';
import type { Job, Point, Rail, State } from '../src/types.ts';

const near = (a: number, b: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const samePoint = (a: Point, b: Point) => {
  near(a.x, b.x);
  near(a.z, b.z);
};
const delta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const state = (): State => ({ rails: [], jobs: [] }) as unknown as State;
function installed(piece: TrackPiece, id: string): Rail & { track: TrackPiece } {
  const rect = railFootprint(piece);
  return { id, x: rect.x, z: rect.z, rotation: piece.heading % 2, length: 5, track: piece };
}
function planned(piece: TrackPiece, id: string): Job & { track: TrackPiece } {
  return {
    ...railFootprint(piece),
    id,
    kind: 'rail',
    rotation: piece.heading % 2,
    qty: 1,
    status: 'todo',
    phase: 'Waiting',
    reason: '',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: 0,
    track: piece,
  };
}

test('legacy straight panels retain both original two-cell footprints and centerline ports', () => {
  const east: Rail = { id: 'RAIL-E', x: 125, z: 4, rotation: 0, length: 5 };
  const south: Rail = { id: 'RAIL-S', x: 12, z: 20, rotation: 1, length: 5 };
  assert.deepEqual(railFootprint(east), { x: 125, z: 4, w: 5, d: 2 });
  assert.deepEqual(railFootprint(south), { x: 12, z: 20, w: 2, d: 5 });
  samePoint(trackGeometry(east).entry, { x: 125, z: 5 });
  samePoint(trackGeometry(east).end, { x: 130, z: 5 });
  samePoint(trackGeometry(south).entry, { x: 13, z: 20 });
  samePoint(trackGeometry(south).end, { x: 13, z: 25 });
  near(delta(trackGeometry(east).entry.yaw, Math.PI), 0);
  near(delta(trackGeometry(east).end.yaw, 0), 0);
  assert.equal(railCells(east).length, 10);
  assert.equal(railCells(south).length, 10);
});

test('all eight curve orientations meet at analytical joints and finish on cardinal grid ports', () => {
  for (const heading of [0, 1, 2, 3] as const)
    for (const hand of [1, -1] as const) {
      const pieces = trackSections('curve', { x: 125, z: 5 }, heading, hand, 'CURVE-A');
      assert.equal(pieces.length, 6);
      const macro = trackMacroPorts(pieces[2]);
      samePoint(macro[0], { x: 125, z: 5 });
      const a = (heading * Math.PI) / 2;
      samePoint(macro[1], {
        x: 125 + 20 * Math.cos(a) - hand * 20 * Math.sin(a),
        z: 5 + 20 * Math.sin(a) + hand * 20 * Math.cos(a),
      });
      near(delta(macro[1].yaw, a + (hand * Math.PI) / 2), 0);
      for (let i = 0; i < pieces.length; i++) {
        const geometry = trackGeometry(pieces[i]);
        near(geometry.length, CURVE_RADIUS * CURVE_SECTION_ANGLE);
        assert.ok(geometry.paths[0].points.length >= 22);
        assert.ok(geometry.cells.length > 10);
        if (i) assert.ok(portsConnect(trackGeometry(pieces[i - 1]).end, geometry.entry));
        const middle = geometry.pose;
        near(
          Math.abs(delta(middle.yaw, a + hand * (i + 0.5) * CURVE_SECTION_ANGLE)),
          hand < 0 ? Math.PI : 0,
        );
      }
    }
});

test('one physical curve profile fits every section and both hands through rigid transforms', () => {
  const baseline = trackLocalPaths(trackSections('curve', { x: 0, z: 0 }, 0, 1)[0])[0].points;
  const sorted = (points: Point[]) => [...points].sort((a, b) => a.x - b.x);
  for (const heading of [0, 1, 2, 3] as const)
    for (const hand of [1, -1] as const) {
      for (const piece of trackSections('curve', { x: 52, z: 31 }, heading, hand)) {
        const points = sorted(trackLocalPaths(piece)[0].points),
          expected = sorted(baseline);
        for (let i = 0; i < points.length; i++) samePoint(points[i], expected[i]);
        assert.ok(Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) < 6);
        assert.ok(
          Math.max(...points.map((p) => p.z)) - Math.min(...points.map((p) => p.z)) + 2 < 3,
        );
      }
    }
});

test('curve path samples lie exactly on the circle and expose analytical tangents', () => {
  const piece = trackSections('curve', { x: 0, z: 0 }, 0, 1)[3];
  for (const p of trackGeometry(piece).paths[0].points) {
    near(Math.hypot(p.x, p.z - CURVE_RADIUS), CURVE_RADIUS);
    near(p.x, CURVE_RADIUS * Math.sin(p.yaw));
    near(p.z, CURVE_RADIUS * (1 - Math.cos(p.yaw)));
  }
});

test('curve occupied cells follow its strip rather than filling its rectangular enclosure', () => {
  const pieces = trackSections('curve', { x: 0, z: 0 }, 0, 1);
  const cells = new Set(pieces.flatMap(railCells).map((p) => `${p.x},${p.z}`));
  assert.ok(cells.has('0,0'));
  assert.ok(cells.has('19,19'));
  assert.equal(cells.has('0,19'), false);
  assert.equal(cells.has('10,10'), false);
  for (const piece of pieces) {
    const rect = railFootprint(piece);
    for (const p of railCells(piece)) {
      assert.ok(p.x + 1 > rect.x && p.x < rect.x + rect.w);
      assert.ok(p.z + 1 > rect.z && p.z < rect.z + rect.d);
    }
  }
});

test('turnouts have seven bounded physical parts, smooth separated branches, and three external ports', () => {
  for (const heading of [0, 1, 2, 3] as const)
    for (const hand of [1, -1] as const) {
      const pieces = trackSections('turnout', { x: 40, z: 30 }, heading, hand, 'TURNOUT-A');
      assert.deepEqual(
        pieces.map((p) => [p.section, p.route]),
        [
          [0, undefined],
          [1, 'straight'],
          [1, 'branch'],
          [2, 'straight'],
          [2, 'branch'],
          [3, 'straight'],
          [3, 'branch'],
        ],
      );
      const macro = trackMacroPorts(pieces[0]);
      assert.equal(macro.length, 3);
      const a = (heading * Math.PI) / 2;
      samePoint(macro[1], { x: 40 + 20 * Math.cos(a), z: 30 + 20 * Math.sin(a) });
      samePoint(macro[2], {
        x: 40 + 20 * Math.cos(a) - hand * 5 * Math.sin(a),
        z: 30 + 20 * Math.sin(a) + hand * 5 * Math.cos(a),
      });
      near(delta(macro[1].yaw, a), 0);
      near(delta(macro[2].yaw, a), 0);
      assert.equal(trackGeometry(pieces[0]).paths.length, 2);
      for (const piece of pieces.slice(1)) {
        const geometry = trackGeometry(piece);
        assert.equal(geometry.paths.length, 1);
        assert.equal(geometry.paths[0].route, piece.route);
        const local = trackLocalPaths(piece)[0].points;
        // A bounding envelope enlarged by the full sleeper width must fit the
        // separately transported module's 6×3 m slot, never a 5×7 m assembly.
        const edge = local.flatMap((p) =>
          [-1, 1].map((side) => ({
            x: p.x - side * Math.sin(p.yaw),
            z: p.z + side * Math.cos(p.yaw),
          })),
        );
        assert.ok(Math.max(...edge.map((p) => p.x)) - Math.min(...edge.map((p) => p.x)) < 6);
        assert.ok(Math.max(...edge.map((p) => p.z)) - Math.min(...edge.map((p) => p.z)) < 3);
      }
      for (const route of ['straight', 'branch'] as const) {
        let previous = trackGeometry(pieces[0]).ends.find((p) => p.route === route)!;
        for (const piece of pieces.filter((p) => p.route === route)) {
          const geometry = trackGeometry(piece);
          assert.ok(portsConnect(previous, geometry.entry));
          previous = geometry.end;
        }
      }
    }
});

test('descriptor validation rejects invalid sections, ambiguous turnout material, and non-grid macro anchors', () => {
  const curve = trackSections('curve', { x: 0, z: 0 }, 0)[0];
  assert.ok(validTrackPiece(curve));
  for (const changed of [
    { section: 6 },
    { heading: 4 },
    { hand: 0 },
    { route: 'branch' },
    { origin: { x: 0.5, z: 0 } },
    { origin: { x: NaN, z: 0 } },
  ])
    assert.equal(validTrackPiece({ ...curve, ...changed }), false);
  const turnout = trackSections('turnout', { x: 0, z: 0 }, 0);
  assert.equal(validTrackPiece({ ...turnout[1], route: undefined }), false);
  assert.equal(validTrackPiece({ ...turnout[0], route: 'straight' }), false);
});

test('topology connects only opposing matching endpoints, never track intersections', () => {
  const s = state();
  s.rails.push({ id: 'RAIL-A', x: 125, z: 4, rotation: 0, length: 5 });
  s.rails.push({ id: 'RAIL-B', x: 130, z: 4, rotation: 0, length: 5 });
  s.rails.push({ id: 'CROSSING', x: 127, z: 3, rotation: 1, length: 5 });
  const network = trackNetwork(s);
  assert.ok(network.panels.find((p) => p.id === 'RAIL-B')!.connected);
  assert.equal(network.panels.find((p) => p.id === 'CROSSING')!.connected, false);
  const seedPort = network.panels[0].ports[0];
  const wrongEntrance = trackGeometry(trackSections('straight', { x: 125, z: 5 }, 2)[0]).entry;
  assert.equal(portsConnect(seedPort, wrongEntrance), false);
  assert.equal(network.joints.length, 2);
  const ports = trackOpenPorts(s, false);
  assert.equal(ports.length, 1);
  samePoint(ports[0], { x: 135, z: 5 });
  assert.equal(snapTrackStart(s, { x: 135.2, z: 5.1 }, 2, false), undefined);
  samePoint(snapTrackStart(s, { x: 135.2, z: 5.1 }, 0, false)!.origin, { x: 135, z: 5 });
});

test('macro snapping supports planned chains and hides unfinished internal construction ports', () => {
  const s = state();
  const curve = trackSections('curve', { x: 125, z: 5 }, 0, 1, 'CURVE-A');
  s.jobs.push(...curve.map((p, i) => planned(p, `CURVE-${i}`)));
  samePoint(snapTrackStart(s, { x: 145, z: 25 }, 1)!.origin, { x: 145, z: 25 });
  assert.equal(snapTrackStart(s, { x: 145, z: 25 }, 1, false), undefined);
  s.rails.push(installed(curve[0], 'INSTALLED-CURVE-0'));
  s.jobs.shift();
  assert.equal(trackOpenPorts(s, false).length, 0);
  const turnout = trackSections('turnout', { x: 145, z: 25 }, 1, 1, 'TURNOUT-A');
  s.jobs.push(...turnout.map((p, i) => planned(p, `TURNOUT-${i}`)));
  const ends = trackOpenPorts(s, true);
  assert.equal(ends.length, 2);
  assert.ok(ends.some((p) => p.x === 145 && p.z === 45));
  assert.ok(ends.some((p) => p.x === 140 && p.z === 45));
  assert.equal(snapTrackStart(s, { x: 145, z: 35 }, 1), undefined);
});

test('ports use configurable tolerances without joining aligned outward headings', () => {
  const a: TrackPort = { x: 1, z: 2, yaw: 0, end: 'exit', route: 'straight' };
  assert.ok(portsConnect(a, { ...a, yaw: Math.PI, x: 1.00001, end: 'entry' }));
  assert.equal(portsConnect(a, { ...a, yaw: Math.PI, x: 1.01, end: 'entry' }), false);
  assert.equal(portsConnect(a, { ...a, yaw: 0, end: 'entry' }), false);
  assert.equal(portsConnect(a, { ...a, yaw: Math.PI - 0.01, end: 'entry' }), false);
});

test('geometry and topology queries do not mutate descriptors or saves', () => {
  const s = state(),
    pieces = trackSections('turnout', { x: 125, z: 5 }, 0, -1, 'TURNOUT-A');
  s.jobs.push(...pieces.map((p, i) => planned(p, `TURNOUT-${i}`)));
  const before = JSON.stringify(s);
  for (const p of pieces) {
    trackGeometry(p);
    trackLocalPaths(p);
    railCells(p);
  }
  trackNetwork(s, true);
  snapTrackStart(s, { x: 145, z: 0 });
  assert.equal(JSON.stringify(s), before);
  const a = trackGeometry(pieces[0]),
    b = trackGeometry({ ...pieces[0], origin: { ...pieces[0].origin } });
  assert.equal(a, b, 'Equal descriptors share the bounded immutable geometry cache');
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.pose) && Object.isFrozen(a.cells));
  assert.throws(() => {
    a.pose.x = -99;
  }, TypeError);
});
