import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS } from '../src/catalog';
import { bufferAssets } from '../src/buffers';
import {
  railLayoutPieces,
  trackGeometry,
  trackLocalPaths,
  trackMacroPorts,
  trackNetwork,
  trackOpenPorts,
  trackSections,
} from '../src/track';
import { turnoutLeverPose } from '../src/turnout-operation';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { State, Item } from '../src/types';

function install(s: State, result: ReturnType<typeof S.planRailLayout>) {
  assert.equal(result.error, '');
  for (const j of result.jobs) {
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
}
function parallelEndpoints() {
  const s = S.createState();
  install(s, S.planRailLayout(s, 'turnout', { x: 125, z: 5 }));
  for (const z of [5, 10])
    for (const x of [145, 150]) install(s, S.planRailLayout(s, 'straight', { x, z }));
  s.buffer = { x: 155, z: 5 };
  return s;
}

test('convergence rotates existing physical modules and reverses only construction traversal', () => {
  for (const heading of [0, 1, 2, 3] as const)
    for (const hand of [1, -1] as const) {
      const pieces = railLayoutPieces('turnout', { x: 60, z: 50 }, heading, hand, 'converging');
      assert.deepEqual(
        pieces.map((p) => [p.section, p.route]),
        [
          [3, 'straight'],
          [3, 'branch'],
          [2, 'straight'],
          [2, 'branch'],
          [1, 'straight'],
          [1, 'branch'],
          [0, undefined],
        ],
      );
      assert.deepEqual(
        trackMacroPorts(pieces[0]).map((p) => p.end),
        ['entry', 'entry', 'exit'],
      );
      const first = trackGeometry(pieces[0]).entry;
      assert.equal(first.x, 60);
      assert.equal(first.z, 50);
      for (const piece of pieces) {
        const canonical = { ...piece, flow: undefined };
        assert.deepEqual(trackLocalPaths(piece), trackLocalPaths(canonical));
        assert.deepEqual(trackGeometry(piece).pose, trackGeometry(canonical).pose);
      }
      const points = pieces.at(-1)!;
      assert.deepEqual(
        turnoutLeverPose({
          id: 'POINTS',
          ...trackGeometry(points).rect,
          rotation: points.heading % 2,
          length: 5,
          track: points,
        }),
        turnoutLeverPose({
          id: 'POINTS',
          ...trackGeometry(points).rect,
          rotation: points.heading % 2,
          length: 5,
          track: { ...points, flow: undefined },
        }),
      );
    }
});

test('two exact incoming parallel joints become one connected open end and survive save/load', () => {
  const s = parallelEndpoints();
  const r = S.planRailLayout(s, 'turnout', { x: 155, z: 5 }, 0, 1, 'converging');
  assert.equal(r.error, '');
  assert.equal(r.jobs.length, 7);
  assert.deepEqual(
    trackOpenPorts(s, true).map((p) => [p.x, p.z]),
    [[175, 5]],
  );
  const saved = S.load(S.save(s));
  assert.deepEqual(
    saved.jobs.map((j) => j.track),
    s.jobs.map((j) => j.track),
  );
  install(s, r);
  assert.ok(trackNetwork(s).panels.every((p) => p.connected));
  assert.deepEqual(
    trackOpenPorts(s, false).map((p) => [p.x, p.z]),
    [[175, 5]],
  );
  assert.equal(S.planRailLayout(s, 'straight', { x: 175, z: 5 }).error, '');
});

test('convergence rejects absent, offset, or opposing-direction second incoming tracks', () => {
  const s = S.createState();
  assert.match(
    S.planRailLayout(s, 'turnout', { x: 125, z: 5 }, 0, 1, 'converging').error,
    /two parallel/,
  );
  const full = parallelEndpoints();
  assert.match(
    S.planRailLayout(full, 'turnout', { x: 155, z: 5 }, 0, -1, 'converging').error,
    /two parallel/,
  );
  assert.match(
    S.planRailLayout(full, 'turnout', { x: 155, z: 5 }, 2, 1, 'converging').error,
    /two parallel/,
  );
  full.rails.find((r) => r.track?.origin.x === 150 && r.track.origin.z === 10)!.track!.origin.z++;
  assert.match(
    S.planRailLayout(full, 'turnout', { x: 155, z: 5 }, 0, 1, 'converging').error,
    /two parallel/,
  );
});

test('two-buffer convergence stores the surplus, retains the through stop, and resumes during both physical lifts', () => {
  const s = parallelEndpoints();
  s.buffers = [
    ...bufferAssets(s),
    {
      id: 'BUFFER-BRANCH',
      x: 155,
      z: 10,
      y: 0.2,
      yaw: 0,
      secured: true,
      carried: false,
      source: 'opening',
    },
  ];
  assert.equal(S.addZone(s, { x: 145, z: 35, w: 16, d: 16 }), '');
  const e = seedHandlingResources(s, 'excavator');
  e.x = 120;
  e.z = 30;
  s.workers.forEach((w, i) => {
    w.x = 118 + i;
    w.z = 28;
  });
  const r = S.planRailLayout(s, 'turnout', { x: 155, z: 5 }, 0, 1, 'converging');
  assert.equal(r.error, '');
  const counts: Partial<Record<Item, number>> = {};
  for (const piece of trackSections('turnout', { x: 0, z: 0 }, 0))
    counts[S.trackItem(piece)] = (counts[S.trackItem(piece)] || 0) + 1;
  let row = 0;
  for (const [item, qty] of Object.entries(counts) as [Item, number][])
    for (let i = 0; i < qty; i++) {
      const m = MATERIALS[item];
      s.stacks.push({
        id: 'CONVERGING-STOCK-' + row,
        item,
        qty: 1,
        reserved: 0,
        x: 90 + Math.floor(row / 3) * 12,
        z: 35 + (row++ % 3) * 12,
        w: m.w,
        d: m.d,
        source: 'opening',
      });
    }
  const phases = new Set<string>();
  const completed: number[] = [];
  const resumed = new Set<string>();
  tickUntil(
    s,
    () =>
      r.jobs.every((j) => s.jobs.find((q) => q.id === j.id)!.status === 'done') &&
      s.jobs
        .filter((j) => j.kind === 'remove' && j.item === 'bufferStop')
        .every((j) => j.status === 'done'),
    4000,
    () => {
      const physicalBufferIds = [
        ...bufferAssets(s).map((b) => b.id),
        ...s.stacks.filter((t) => t.item === 'bufferStop' && t.qty > 0).map((t) => t.assetId),
        ...s.jobs
          .filter((j) => j.item === 'bufferStop' && j.handling?.state === 'carried')
          .map((j) => j.assetId),
      ];
      assert.equal(physicalBufferIds.length, 2, JSON.stringify(physicalBufferIds));
      assert.equal(new Set(physicalBufferIds).size, 2);
      const moving = s.jobs.find(
        (j) =>
          j.railWork?.buffer?.carried ||
          (j.item === 'bufferStop' && j.handling?.state === 'carried'),
      );
      if (moving) {
        const kind = moving.railWork?.buffer ? 'rail-buffer' : 'buffer-recovery';
        if (!resumed.has(kind)) {
          const saved = S.load(S.save(s));
          Object.assign(s, saved);
          resumed.add(kind);
        }
      }
      for (const original of r.jobs) {
        const j = s.jobs.find((q) => q.id === original.id)!;
        if (j.railWork) phases.add(j.railWork.phase);
        if (j.status === 'done' && !completed.includes(r.jobs.indexOf(original)))
          completed.push(r.jobs.indexOf(original));
      }
    },
  );
  assert.deepEqual(completed, [0, 1, 2, 3, 4, 5, 6]);
  for (const phase of ['source-rig', 'source-lift', 'stage-lower', 'panel-lower', 'join-panel'])
    assert.ok(phases.has(phase), phase);
  assert.deepEqual(
    trackOpenPorts(s, false).map((p) => [p.x, p.z]),
    [[175, 5]],
  );
  for (const [item] of Object.entries(counts) as [Item, number][])
    assert.equal(
      s.stacks.filter((t) => t.item === item).reduce((n, t) => n + t.qty, 0),
      0,
    );
  assert.equal(s.equipment.find((q) => q.id === e.id)!.cargo, undefined);
  assert.deepEqual([...resumed].sort(), ['buffer-recovery', 'rail-buffer']);
  assert.deepEqual(
    bufferAssets(s).map((b) => [b.id, b.x, b.z, b.secured]),
    [['BUFFER-001', 175, 5, true]],
  );
  const storedBuffer = s.stacks.find((t) => t.item === 'bufferStop' && t.qty === 1);
  assert.equal(storedBuffer?.assetId, 'BUFFER-BRANCH');
  assert.equal(
    bufferAssets(s).length +
      s.stacks.filter((t) => t.item === 'bufferStop').reduce((n, t) => n + t.qty, 0),
    2,
  );
  assert.doesNotThrow(() => S.load(S.save(s)));
});
