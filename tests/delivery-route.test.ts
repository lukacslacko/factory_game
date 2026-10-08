import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestRailUnloading } from '../src/rail-freight';
import * as S from '../src/sim.ts';
import { route, dist, center } from '../src/path.ts';
import { localPoint } from '../src/motion.ts';
import { MATERIALS } from '../src/catalog.ts';
import { equipmentSweepBlocked } from '../src/traffic.ts';
import { railStagingStackOwned } from '../src/railwork.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';

function partialCurveStack() {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  const e = seedHandlingResources(s, 'excavator');
  const [id] = S.purchase(s, 'railCurve', 8, 'rail');
  const o = s.orders.find((o) => o.id === id)!;
  tickUntil(s, () => o.status === 'unloading');
  assert.equal(requestRailUnloading(s, id), undefined);
  tickUntil(s, () => o.unload?.phase === 'clear' && !!o.unload.mergeId && !e.path.length, 900);
  assert.equal(o.arrived, 6);
  assert.equal(o.unload!.qty, 3);
  assert.equal(s.stacks.find((t) => t.id === o.unload!.mergeId)!.qty, 3);
  return { s, id, eid: e.id };
}

test('receiving protects an unfinished panel staging stack and still tops up reserved public stock', () => {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  seedHandlingResources(s, 'forklift');
  const planned = S.planRailLayout(s, 'curve', { x: 125, z: 5 }, 0, 1);
  assert.equal(planned.error, '');
  const j = planned.jobs[0];
  // Opening save fixture: a supported panel awaits an excavator after handoff.
  // No excavator/builder is present, so its unfinished physical work stays paused.
  j.legacyRailHandoff = 'staged';
  const staged = {
    id: S.id(s, 'stack'),
    item: 'railCurve' as const,
    x: 122,
    z: 19,
    w: 6,
    d: 3,
    qty: 1,
    reserved: 0,
    source: j.id,
    yaw: 0,
  };
  const stock = {
    id: S.id(s, 'stack'),
    item: 'railCurve' as const,
    x: 24,
    z: 47,
    w: 6,
    d: 3,
    qty: 1,
    reserved: 1,
    source: 'opening',
    yaw: 0,
  };
  s.stacks.push(staged, stock);
  assert.ok(railStagingStackOwned(s, staged.id));
  assert.equal(railStagingStackOwned(s, stock.id), false);
  j.cancel = true;
  assert.ok(
    railStagingStackOwned(s, staged.id),
    'A requested cancellation retains physical ownership',
  );
  j.cancel = undefined;
  j.status = 'canceled';
  assert.equal(
    railStagingStackOwned(s, staged.id),
    false,
    'Secured canceled material becomes reusable',
  );
  j.status = 'todo';
  const [id] = S.purchase(s, 'railCurve', 1, 'road');
  const o = s.orders.find((o) => o.id === id)!;
  tickUntil(
    s,
    () => o.status === 'done',
    900,
    () => {
      assert.equal(staged.qty, 1, 'A construction panel cannot receive another panel on top');
      assert.notEqual(
        o.unload?.mergeId,
        staged.id,
        'Receiving cannot reserve the construction supports',
      );
    },
  );
  assert.equal(stock.qty, 2, 'Ordinary reserved inventory still accepts compatible deliveries');
  assert.equal(stock.reserved, 1, 'Receiving retains the existing public stock reservation');
  assert.ok(s.movements.some((m) => m.to === stock.id && m.reason === 'Topped up existing stack'));
});

test('a trainload of eight curved rail panels tops up physical stacks after save/reload', () => {
  const fixture = partialCurveStack();
  let s = fixture.s;
  const before = s.orders.find((o) => o.id === fixture.id)!.unload!;
  const machine = s.equipment.find((e) => e.id === fixture.eid)!;
  assert.equal(
    route(machine, before.drop, S.obstacles(s), MATERIALS.railCurve.w / 2),
    null,
    'The previous circular clearance falsely rejects this real top-up dock',
  );
  const cargo = { ...before.cargo! };
  s = S.load(S.save(s));
  const o = s.orders.find((o) => o.id === fixture.id)!;
  const e = s.equipment.find((e) => e.id === fixture.eid)!;
  assert.deepEqual(o.unload!.cargo, cargo, 'Save preserves the supported physical payload pose');
  let prior = { ...e, path: e.path.slice(), cargo: e.cargo && { ...e.cargo } };
  let previousCargo = { ...o.unload!.cargo! };
  let previousPhase = o.unload!.phase;
  let sawTopUp = false;
  tickUntil(
    s,
    () => o.status === 'done',
    900,
    () => {
      if (dist(prior, e) > 1e-7 || Math.abs((prior.yaw || 0) - (e.yaw || 0)) > 1e-7)
        assert.equal(equipmentSweepBlocked(s, prior, e), '', 'Executed loaded motion stays clear');
      const t = o.unload;
      if (t?.cargo && ['clear', 'carry'].includes(t.phase)) {
        const anchor = localPoint({ ...e, yaw: e.yaw || 0 }, e.reach || 3, 0);
        assert.ok(dist(t.cargo, anchor) < 1e-7, 'Actual payload follows the machine tool');
      }
      if (t?.cargo && t.phase === 'lower') {
        if (t.mergeId) sawTopUp = true;
        assert.ok(dist(t.cargo, center(t.destination)) < 0.025);
        if (previousPhase === 'carry')
          assert.ok(
            dist(previousCargo, t.cargo) < 0.45,
            'Entering lowering does not jump sideways',
          );
      }
      const totals = S.totals(s, 'railCurve');
      assert.equal(totals.delivered, totals.stored + totals.cargo + totals.installed);
      prior = { ...e, path: e.path.slice(), cargo: e.cargo && { ...e.cargo } };
      if (t?.cargo) previousCargo = { ...t.cargo };
      if (t) previousPhase = t.phase;
    },
  );
  assert.ok(sawTopUp);
  assert.equal(o.arrived, 8);
  assert.deepEqual(
    s.stacks.filter((t) => t.item === 'railCurve').map((t) => t.qty),
    [8],
  );
  assert.equal(e.cargo, undefined);
  assert.equal(e.deliveryOrder, undefined);
  assert.equal(
    s.costs.filter((c) => c.entity === o.id && c.category === 'Purchases').length,
    1,
    'One supplier invoice',
  );
  assert.equal(
    s.movements.filter((m) => m.from === o.id && m.to === e.id).reduce((n, m) => n + m.qty, 0),
    8,
    'Every panel moves through the machine exactly once',
  );
});

test('a genuinely blocked loaded storage dock retains cargo and reports its stack, location, and asset', () => {
  const { s, id, eid } = partialCurveStack();
  const o = s.orders.find((o) => o.id === id)!;
  const e = s.equipment.find((e) => e.id === eid)!;
  const t = o.unload!;
  // Both handling faces are enclosed. A single obstructed face can now be
  // recovered by a checked approach to the opposite side of the same stack.
  const blocker = S.id(s, 'building');
  const otherBlocker = S.id(s, 'building');
  s.buildings.push({
    id: blocker,
    kind: 'office',
    x: t.drop.x - 2,
    z: t.drop.z - 1.5,
    w: 4,
    d: 3,
    rotation: 0,
    connected: false,
    name: 'Blocked dock fixture',
    source: 'opening',
  });
  s.buildings.push({
    ...s.buildings[s.buildings.length - 1],
    id: otherBlocker,
    z: 2 * center(t.destination).z - t.drop.z - 1.5,
  });
  const cargo = { ...e.cargo! };
  const pose = { ...t.cargo! };
  tickUntil(s, () => e.blockedBy === blocker, 5);
  assert.equal(t.phase, 'clear');
  assert.equal(e.path.length, 0);
  assert.equal(e.blockedBy, blocker);
  assert.ok(o.note.includes(t.mergeId!));
  assert.ok(o.note.includes(`(${t.drop.x.toFixed(1)}, ${t.drop.z.toFixed(1)})`));
  assert.ok(o.note.includes(blocker));
  assert.deepEqual(e.cargo, cargo);
  assert.deepEqual(t.cargo, pose);
  assert.equal(S.totals(s, 'railCurve').stored, 3);
  assert.equal(S.totals(s, 'railCurve').cargo, 3);
  const retry = e.trafficRetry;
  const note = o.note;
  for (let i = 0; i < 10; i++) S.tick(s, 0.1);
  assert.equal(e.trafficRetry, retry, 'A blocked route is not searched again during cooldown');
  assert.equal(o.note, note, 'Cooldown keeps the actual obstruction visible');
  assert.deepEqual(t.cargo, pose, 'Waiting does not relocate a supported panel');
  s.buildings = s.buildings.filter((b) => b.id !== blocker && b.id !== otherBlocker);
  tickUntil(s, () => t.phase === 'carry', 5);
  assert.ok(e.path.length > 0);
  assert.match(o.note, /hauling to storage/);
  assert.doesNotMatch(
    o.note,
    /No clear loaded route/,
    'Accepting a route clears the old blockage note immediately',
  );
});

test('a saved loaded machine with an empty traffic escape path physically returns to its storage dock', () => {
  let { s, id, eid } = partialCurveStack();
  let o = s.orders.find((o) => o.id === id)!;
  let e = s.equipment.find((e) => e.id === eid)!;
  tickUntil(s, () => o.unload?.phase === 'carry', 5);
  const drop = { ...o.unload!.drop };
  assert.ok(dist(e, drop) > 20);
  // Exact persisted state of a completed escape whose return route failed:
  // cargo remains supported in the existing pose, with the old goal retained.
  e.path = [];
  e.trafficGoal = { ...drop };
  s = S.load(S.save(s));
  o = s.orders.find((o) => o.id === id)!;
  e = s.equipment.find((e) => e.id === eid)!;
  const initialPose = { x: e.x, z: e.z };
  const initialCargo = { ...o.unload!.cargo! };
  tickUntil(s, () => e.path.length > 0, 5);
  assert.equal(e.trafficGoal, undefined, 'A real accepted return path replaces the stale goal');
  assert.ok(dist(e, initialPose) < 0.5, 'Resuming cannot teleport the machine');
  assert.ok(
    dist(o.unload!.cargo!, initialCargo) < 1,
    'Only one real steering step may move the supported cargo; it cannot jump to storage',
  );
  let sawActualDock = false;
  tickUntil(
    s,
    () => o.status === 'done',
    900,
    () => {
      if (o.unload?.phase === 'lower') {
        sawActualDock = true;
        assert.ok(dist(e, o.unload.drop) < 0.025, 'The chassis actually reaches its dock');
        assert.ok(dist(o.unload.cargo!, center(o.unload.destination)) < 0.025);
      }
      const totals = S.totals(s, 'railCurve');
      assert.equal(totals.delivered, totals.stored + totals.cargo + totals.installed);
    },
  );
  assert.ok(sawActualDock);
  assert.equal(S.totals(s, 'railCurve').stored, 8);
});
