import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS } from '../src/catalog';
import { angleDelta } from '../src/motion';
import { trackGeometry, trackSections } from '../src/track';
import { seedHandlingResources, requestLowFuelService } from './support/yard';
import { machineRoute } from '../src/traffic';
import { tickRailWork } from '../src/railwork';
import type { Item, State, RailWorkPose } from '../src/types';

function fixture(
  layout: 'curve' | 'turnout',
  hand: 1 | -1 = 1,
  origin = { x: 125, z: 5 },
  heading: 0 | 1 | 2 | 3 = 0,
) {
  const s = S.createState();
  seedHandlingResources(s, 'excavator');
  const counts: Partial<Record<Item, number>> = {};
  for (const piece of trackSections(layout, origin, heading, hand)) {
    const item = S.trackItem(piece);
    counts[item] = (counts[item] || 0) + 1;
  }
  let row = 0;
  for (const [item, count] of Object.entries(counts) as [Item, number][]) {
    for (let i = 0; i < count; i++) {
      const m = MATERIALS[item];
      s.stacks.push({
        id: `TRACK-STOCK-${item}-${i}`,
        item,
        qty: 1,
        reserved: 0,
        x: 30 + Math.floor(row / 7) * 9,
        z: 29 + (row % 7) * 4,
        w: m.w,
        d: m.d,
        source: 'opening',
      });
      row++;
    }
  }
  if (origin.z !== 5) {
    for (const piece of trackSections('curve', { x: 125, z: 5 }, 0, 1)) {
      const geometry = trackGeometry(piece);
      s.rails.push({
        id: `OPENING-CURVE-${piece.section}`,
        ...geometry.rect,
        rotation: 0,
        length: geometry.length,
        item: 'railCurve',
        track: piece,
      });
    }
    s.buffer = { ...origin };
  }
  const result = S.planRailLayout(s, layout, origin, heading, hand);
  assert.equal(result.error, '');
  assert.equal(result.jobs.length, layout === 'curve' ? 6 : 7);
  if (origin.z !== 5) counts.railCurve = 6;
  return { s, counts, ids: result.jobs.map((j) => j.id), groupId: result.group!.id };
}
function conserve(s: State, counts: Partial<Record<Item, number>>) {
  for (const [item, count] of Object.entries(counts) as [Item, number][]) {
    const t = S.totals(s, item);
    assert.equal(t.stored + t.cargo + t.installed, count, `${item}: ${JSON.stringify(t)}`);
  }
  for (const stack of s.stacks) assert.ok(stack.qty >= stack.reserved && stack.reserved >= 0);
}
function until(
  s: State,
  done: () => boolean,
  counts: Partial<Record<Item, number>>,
  limit = 4000,
  watch?: () => void,
) {
  let previous = '',
    stuck = 0;
  const poses = new Map<string, RailWorkPose>();
  for (let t = 0; t < limit && !done(); t += 0.1) {
    S.tick(s, 0.1);
    conserve(s, counts);
    watch?.();
    for (const j of s.jobs)
      if (j.railWork)
        for (const [kind, p] of [
          ['panel', j.railWork.panel],
          ['buffer', j.railWork.buffer],
        ] as const) {
          if (!p) continue;
          const key = j.id + kind,
            prior = poses.get(key);
          if (prior) {
            assert.ok(
              Math.hypot(p.x - prior.x, p.z - prior.z, p.y - prior.y) < 1.5,
              `${j.id} ${kind} teleports during ${j.railWork.phase}`,
            );
            assert.ok(Math.abs(p.y - prior.y) < 0.3, `${j.id} ${kind} jumps vertically`);
            assert.ok(
              Math.abs(angleDelta(prior.yaw, p.yaw)) < 0.55,
              `${j.id} ${kind} rotates instantly`,
            );
          }
          poses.set(key, { ...p });
        }
    const signature = JSON.stringify({
      jobs: s.jobs.map((j) => [j.status, j.phase, j.railWork?.clock]),
      orders: s.orders
        .filter((o) => o.status !== 'done')
        .map((o) => [
          o.status,
          o.unload?.phase,
          o.unload?.clock,
          o.vehicle.x,
          o.vehicle.z,
          o.status === 'ordered' ? Math.max(0, o.eta - s.time) : 0,
        ]),
      e: s.equipment.map((e) => [e.x, e.z, e.yaw, e.path.length]),
      w: s.workers.map((w) => [w.x, w.z, w.path.length]),
    });
    stuck = signature === previous ? stuck + 0.1 : 0;
    previous = signature;
    if (stuck > 60) break;
  }
  assert.ok(
    done(),
    JSON.stringify({
      jobs: s.jobs.map((j) => ({
        id: j.id,
        item: j.item,
        phase: j.phase,
        reason: j.reason,
        rail: j.railWork,
      })),
      equipment: s.equipment,
      workers: s.workers,
    }),
  );
}

test('six physical curve panels are staged, installed and move the same buffer through a smooth quarter turn', () => {
  const fixtureState = fixture('curve');
  let { s } = fixtureState;
  const { counts, ids } = fixtureState;
  let resumed = false;
  const phases = new Set<string>();
  until(
    s,
    () => ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'),
    counts,
    4000,
    () => {
      for (const job of s.jobs) {
        const r = job.railWork;
        if (!r) continue;
        phases.add(r.phase);
        if (r.phase === 'buffer-lower-end' && r.clock > 1 && !resumed) {
          const loaded = S.load(S.save(s));
          Object.assign(s, loaded);
          resumed = true;
        }
      }
    },
  );
  assert.ok(resumed, 'Actual curved buffer placement survives save/reload');
  assert.equal(s.rails.length, 6);
  assert.equal(s.equipment[0].cargo, undefined);
  assert.ok(Math.hypot(s.buffer.x - 145, s.buffer.z - 25) < 0.01);
  const last = s.jobs.find((j) => j.id === ids.at(-1))!;
  assert.ok(Math.abs(angleDelta(last.railWork!.buffer!.yaw, Math.PI / 2)) < 0.01);
  assert.ok(
    Math.abs(angleDelta(last.railWork!.axisYaw, last.railWork!.endYaw!)) > 0.1,
    'Final buffer follows exit tangent, independently of panel midpoint yaw',
  );
  for (const rail of s.rails) {
    assert.equal(rail.item, 'railCurve');
    assert.ok(rail.track);
    assert.ok(Math.abs(rail.length - (20 * Math.PI) / 12) < 0.001);
  }
  for (const phase of [
    'source-rig',
    'stage-lower',
    'buffer-lower-aside',
    'panel-lower',
    'join-panel',
    'fasten-buffer',
  ])
    assert.ok(phases.has(phase));
  conserve(s, counts);
});

test('seven separately handled turnout pieces conserve each material and retain the buffer on the through line', () => {
  const { s, counts, ids } = fixture('turnout');
  until(s, () => ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'), counts);
  assert.equal(s.rails.length, 7);
  assert.deepEqual(s.buffer, { x: 145, z: 5 });
  assert.equal(s.rails.filter((r) => r.item === 'rail').length, 3);
  for (const item of ['railPoints', 'railFrog', 'railClosure', 'railExit'])
    assert.equal(s.rails.filter((r) => r.item === item).length, 1);
  const branch = s.rails.find((r) => r.track?.section === 3 && r.track.route === 'branch')!;
  assert.ok(
    Math.hypot(trackGeometry(branch).end.x - 145, trackGeometry(branch).end.z - 10) < 0.001,
  );
  assert.equal(
    s.jobs.filter((j) => j.railWork?.buffer).length,
    4,
    'Only points and three through panels handle the one buffer',
  );
  conserve(s, counts);
});

test('left-hand turnout pieces are physically reconfigured while supported and keep their handedness on cancellation', () => {
  // A northward source endpoint keeps a left bend inside the buildable yard.
  const f = fixture('turnout', -1, { x: 145, z: 25 }, 1),
    { s, counts, ids } = f;
  until(
    s,
    () => s.jobs[0].railWork?.phase === 'configure-staged-panel' && s.jobs[0].railWork!.clock > 2,
    counts,
  );
  const current = s.jobs[0],
    r = current.railWork!;
  assert.equal(r.panel.state, 'staged');
  assert.equal(s.equipment[0].cargo, undefined);
  assert.ok((r.configureProgress || 0) > 0 && (r.configureProgress || 0) < 1);
  assert.equal(s.stacks.find((t) => t.id === r.panel.stackId)!.reserved, 1);
  for (const id of ids) S.cancelJob(s, id);
  until(s, () => s.jobs.every((j) => j.status === 'canceled'), counts);
  const stored = s.stacks.find((t) => t.id === r.panel.stackId)!;
  assert.equal(stored.qty, 1);
  assert.equal(stored.reserved, 0);
  assert.equal(stored.trackHand, -1);
  assert.equal(s.rails.length, 6);
  assert.deepEqual(s.buffer, { x: 145, z: 25 });
  assert.ok(s.events.some((e) => /reconfigured and bolted/.test(e.text)));
  conserve(s, counts);
});

test('canceling a suspended curve panel stages it safely and allows the complete curve to be replanned', () => {
  let { s, counts, ids } = fixture('curve');
  until(s, () => s.jobs[0].railWork?.phase === 'panel-carry', counts);
  for (const id of ids) S.cancelJob(s, id);
  s = S.load(S.save(s));
  until(s, () => s.jobs.every((j) => j.status === 'canceled'), counts);
  assert.equal(s.rails.length, 0);
  assert.deepEqual(s.buffer, { x: 125, z: 5 });
  conserve(s, counts);
  const next = S.planRailLayout(s, 'curve', { x: 125, z: 5 }, 0, 1);
  assert.equal(next.error, '');
  until(s, () => next.jobs.every((j) => j.status === 'done'), counts);
  assert.equal(s.rails.length, 6);
  conserve(s, counts);
});

test('canceling after the first curve is installed can resume the same physical layout without duplicating track', () => {
  let { s, counts, ids, groupId } = fixture('curve');
  until(s, () => s.jobs.find((j) => j.id === ids[0])!.status === 'done', counts);
  for (const id of ids.slice(1)) S.cancelJob(s, id);
  until(
    s,
    () => ids.slice(1).every((id) => s.jobs.find((j) => j.id === id)!.status === 'canceled'),
    counts,
  );
  assert.equal(s.rails.length, 1);
  const retainedId = s.rails[0].id;
  s = S.load(S.save(s));
  assert.equal(S.resumeTrackWork(s, groupId), '');
  until(s, () => ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'), counts);
  assert.equal(s.rails.length, 6);
  assert.equal(s.rails[0].id, retainedId);
  assert.ok(Math.hypot(s.buffer.x - 145, s.buffer.z - 25) < 0.01);
  conserve(s, counts);
});

test('resuming a safely canceled suspended panel reuses its actual supported stock', () => {
  let { s, counts, ids, groupId } = fixture('curve');
  until(s, () => s.jobs[0].railWork?.phase === 'panel-carry', counts);
  for (const id of ids) S.cancelJob(s, id);
  until(s, () => s.jobs.every((j) => j.status === 'canceled'), counts);
  const stackId = s.jobs[0].railWork!.panel.stackId!;
  s = S.load(S.save(s));
  assert.equal(S.resumeTrackWork(s, groupId), '');
  until(s, () => s.jobs.every((j) => j.status === 'done'), counts);
  assert.equal(s.stacks.find((t) => t.id === stackId)!.qty, 0);
  assert.equal(s.rails.length, 6);
  conserve(s, counts);
});

test('storage-face preflight checks the loaded turnout panel against a parked receiving forklift', () => {
  const { s, counts } = fixture('turnout');
  const stock = s.stacks.find((t) => t.item === 'railPoints')!;
  Object.assign(stock, { x: 24, z: 47, yaw: Math.PI });
  s.equipment.push({
    id: 'OPENING-RECEIVING-FORK',
    kind: 'forklift',
    x: 33,
    z: 44.5,
    yaw: -Math.PI - 0.12,
    heading: 2,
    path: [],
    fuel: 45,
    tank: 45,
    used: 0,
    work: 0,
    reach: 2.77,
    lift: 0.4,
    cargo: { item: 'railFrog', qty: 1, yaw: -Math.PI / 2 - 0.12 },
  });
  counts.railFrog = (counts.railFrog || 0) + 1;
  until(s, () => s.jobs[0].railWork?.phase === 'source-rig', counts);
  const j = s.jobs[0],
    r = j.railWork!,
    e = s.equipment.find((e) => e.id === j.equipment)!;
  const preview = {
    ...s,
    stacks: s.stacks.map((t) =>
      t.id === stock.id ? { ...t, qty: t.qty - 1, reserved: t.reserved - 1 } : t,
    ),
  };
  const loaded = { ...e, cargo: { item: 'railPoints' as const, qty: 1, yaw: stock.yaw } };
  assert.ok(
    machineRoute(
      preview,
      { ...loaded, reverse: true },
      r.source!.clear,
      S.obstacles(preview),
      450,
      true,
    ) ||
      machineRoute(
        preview,
        { ...loaded, reverse: false },
        r.source!.clear,
        S.obstacles(preview),
        450,
        true,
      ),
    'The selected face must have a legal route with the actual panel attached',
  );
  until(s, () => j.status === 'done', counts);
  assert.equal(s.equipment.find((e) => e.id === 'OPENING-RECEIVING-FORK')!.cargo!.qty, 1);
});

test('rail pickup changes gear to reach a clear lifting face and throttles blocked initialization', () => {
  const { s } = fixture('curve');
  const j = s.jobs[0],
    e = s.equipment[0];
  const stock = s.stacks.find((t) => t.item === 'railCurve')!;
  Object.assign(stock, { x: 24, z: 47, yaw: Math.PI, reserved: 1 });
  for (const [i, other] of s.stacks.filter((t) => t !== stock).entries())
    Object.assign(other, i === 0 ? { x: 30, z: 47 } : { x: 50, z: 60 + i * 4 });
  Object.assign(e, {
    x: 29.5,
    z: 43.5,
    yaw: -1.554286699891982,
    heading: 3,
    reverse: true,
    reach: 4.8,
    job: j.id,
  });
  s.equipment.push({
    id: 'OPENING-RECEIVING-FORK',
    kind: 'forklift',
    x: 33,
    z: 41.7,
    yaw: Math.PI / 2,
    heading: 1,
    path: [],
    fuel: 45,
    tank: 45,
    used: 0,
    work: 0,
    reach: 2.7,
  });
  const worker = s.workers.find((w) => w.role === 'builder')!;
  const operator = s.workers.find((w) => w.role === 'operator')!;
  Object.assign(j, {
    status: 'doing',
    phase: 'Collect material',
    stack: stock.id,
    worker: worker.id,
    operator: operator.id,
    equipment: e.id,
  });
  worker.job = j.id;
  Object.assign(operator, { job: j.id, vehicle: e.id, x: e.x, z: e.z });
  e.operator = operator.id;
  const dock = { x: 27, z: 44.5 };
  assert.equal(machineRoute(s, e, dock, S.obstacles(s), 450, true), null);
  assert.ok(machineRoute(s, { ...e, reverse: false }, dock, S.obstacles(s), 450, true));
  const api = {
    id: S.id,
    obstacles: S.obstacles,
    event: () => {},
    movement: () => {},
    complete: () => {},
    release: () => {},
  };
  const blockedAPI = { ...api, obstacles: () => [{ x: -12, z: 7, w: 232, d: 103 }] };
  tickRailWork(s, j, 0.1, blockedAPI);
  assert.equal(j.railWork, undefined);
  assert.equal(e.trafficRetry, s.elapsed + 1.5);
  j.reason = 'Waiting for the next bounded retry';
  tickRailWork(s, j, 0.1, api);
  assert.equal(j.reason, 'Waiting for the next bounded retry');
  assert.equal(j.railWork, undefined);
  s.elapsed += 1.5;
  tickRailWork(s, j, 0.1, api);
  const initialized = s.jobs.find((q) => q.id === j.id)!.railWork;
  assert.ok(initialized?.source, 'The physically accessible face initializes using forward gear');
  assert.deepEqual(initialized.source.dock, dock);
});

test('demo curve then turnout procurement and construction completes while receiving equipment shares the stockyard', () => {
  const s = S.demoState();
  const audit = () => {
    requestLowFuelService(s);
    for (const j of s.jobs.filter((j) => j.railWork?.panel.state === 'staged')) {
      const staged = s.stacks.find((t) => t.id === j.railWork!.panel.stackId)!;
      assert.equal(staged.qty, 1, `${j.id}: staging supports must hold exactly its one panel`);
      assert.equal(staged.reserved, 1, `${j.id}: the staged panel retains its job reservation`);
      assert.ok(
        s.orders.every((o) => o.unload?.mergeId !== staged.id),
        `${j.id}: receiving must not select the construction staging stack`,
      );
    }
    for (const item of [
      'rail',
      'railCurve',
      'railPoints',
      'railFrog',
      'railClosure',
      'railExit',
    ] as const) {
      const total = S.totals(s, item);
      assert.equal(
        total.delivered,
        total.stored + total.cargo + total.installed,
        `${item}: ${JSON.stringify(total)}`,
      );
    }
  };
  const curve = S.planRailLayout(s, 'curve', { x: 125, z: 5 }, 0, 1);
  assert.equal(curve.error, '');
  assert.equal(S.buyMissing(s), 6);
  until(s, () => curve.jobs.every((j) => j.status === 'done'), {}, 6500, audit);
  const turnout = S.planRailLayout(s, 'turnout', { x: 145, z: 25 }, 1, 1);
  assert.equal(turnout.error, '');
  assert.equal(
    S.buyMissing(s),
    4,
    'Existing straight-panel stock is used; four specialized modules are procured',
  );
  until(s, () => turnout.jobs.every((j) => j.status === 'done'), {}, 8000, audit);
  assert.equal(s.rails.length, 13);
  assert.ok(s.orders.every((o) => o.status === 'done'));
  assert.deepEqual(s.buffer, { x: 145, z: 45 });
  audit();
});
