import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { pauseDeliveryHandling, resumeDeliveryHandling } from '../src/delivery-control';
import { parcelPitch } from '../src/delivery';
import { requestRailUnloading } from '../src/rail-freight';
import {
  equipmentMoveBlocked,
  equipmentReachBlocked,
  equipmentSweepBlocked,
  equipmentTravelSpeed,
  machineRetreatRoute,
  machineRoute,
} from '../src/traffic';
import { angleDelta, localPoint, move } from '../src/motion';
import { center, dist } from '../src/path';
import type { Equipment, State } from '../src/types';
import { advance, seedHandlingResources, tickUntil } from './support/yard';

function angledCurveDelivery(yaw = Math.PI) {
  const s = S.createState();
  S.addZone(s, { x: 12, z: 32, w: 36, d: 24 });
  const e = seedHandlingResources(s, 'excavator');
  const [orderId] = S.purchase(s, 'railCurve', 3, 'rail');
  const o = s.orders.find((o) => o.id === orderId)!;
  tickUntil(s, () => o.status === 'unloading', 600);
  assert.equal(requestRailUnloading(s, orderId), undefined);
  tickUntil(s, () => o.unload?.phase === 'carry', 600);
  assert.equal(pauseDeliveryHandling(s, e.id), '');
  const t = o.unload!;
  assert.equal(t.qty, 3, 'The owned 6 t excavator really lifts the purchased bundle');
  // Public geometry fixture: an angled machine has reached its selected dock,
  // but a small reel beside it makes the final loaded turn impossible in place.
  Object.assign(e, {
    x: 15,
    z: 29.5,
    yaw,
    reach: 4,
    lift: 0.4,
    path: [],
    reverse: false,
    trafficGoal: undefined,
    trafficReverse: undefined,
    blockedBy: undefined,
  });
  const operator = s.workers.find((w) => w.id === t.operatorId)!;
  Object.assign(operator, { x: e.x, z: e.z, path: [] });
  for (const w of s.workers.filter((w) => w.id !== operator.id)) {
    Object.assign(w, { x: 25.5, z: 25.5, path: [] });
  }
  t.destination = { x: 12, z: 32, w: 6, d: 3 };
  o.allocated = { ...t.destination };
  t.drop = { x: 15, z: 29.5 };
  t.dropYaw = Math.PI / 2;
  t.destinationY = 0;
  t.clock = 3;
  t.cargo = { ...localPoint(e, e.reach!, 0), y: 0.4, yaw: e.yaw! + Math.PI / 2 };
  s.stacks.push({
    id: S.id(s, 'stack'),
    item: 'cableReel',
    qty: 1,
    reserved: 0,
    cableMeters: 17,
    x: 12,
    z: 30,
    w: 1,
    d: 1,
    source: 'opening',
  });
  const reelId = s.stacks.at(-1)!.id;
  return { s, orderId, equipmentId: e.id, reelId };
}

function pose(e: Equipment): Equipment {
  return { ...e, path: e.path.slice(), cargo: e.cargo && { ...e.cargo } };
}

function assertConserved(s: State, orderId: string, equipmentId: string, reelId: string) {
  const o = s.orders.find((o) => o.id === orderId)!;
  const e = s.equipment.find((e) => e.id === equipmentId)!;
  const total = S.totals(s, 'railCurve');
  assert.equal(total.delivered, 3);
  assert.equal(total.stored + total.cargo + total.installed, 3);
  assert.equal(o.arrived, 3, 'The same delivered bundle remains off the carrier');
  assert.equal(s.orders.length, 1, 'Recovery creates no replacement purchase');
  const reel = s.stacks.find((t) => t.id === reelId)!;
  assert.deepEqual(
    { x: reel.x, z: reel.z, qty: reel.qty, meters: reel.cableMeters },
    { x: 12, z: 30, qty: 1, meters: 17 },
    'The fixed reel is neither moved aside nor consumed by the route planner',
  );
  const t = o.unload;
  if (e.cargo && t?.cargo && ['clear', 'carry'].includes(t.phase)) {
    assert.equal(e.cargo.item, 'railCurve');
    assert.equal(e.cargo.qty, 3);
    assert.ok(dist(t.cargo, localPoint(e, e.reach!, 0)) < 1e-7);
  }
}

function completeDelivery(f: ReturnType<typeof angledCurveDelivery>, initiallyReversed = false) {
  const { s, orderId, equipmentId, reelId } = f;
  const e = s.equipment.find((e) => e.id === equipmentId)!;
  const o = s.orders.find((o) => o.id === orderId)!;
  const initial = pose(e);
  let previous = pose(e);
  let reversed = initiallyReversed;
  let returnedForward = false;
  let leftDock = false;
  tickUntil(
    s,
    () => o.status === 'done',
    120,
    () => {
      if (dist(previous, e) > 1e-7 || Math.abs((previous.yaw || 0) - (e.yaw || 0)) > 1e-7)
        assert.equal(
          equipmentSweepBlocked(s, previous, e),
          '',
          'Each real loaded chassis sweep is clear',
        );
      if (e.cargo) {
        reversed ||= !!e.reverse && dist(e, initial) > 0.01;
        returnedForward ||= reversed && !e.reverse && !!e.path.length;
        leftDock ||= dist(e, initial) > 1;
      }
      assertConserved(s, orderId, equipmentId, reelId);
      if (o.unload?.phase === 'lower') {
        assert.ok(dist(e, o.unload.drop) < 0.025, 'Lowering begins only at the physical dock');
        assert.ok(dist(o.unload.cargo!, center(o.unload.destination)) < 0.025);
      }
      previous = pose(e);
    },
  );
  assert.ok(
    reversed && returnedForward && leftDock,
    'The bundle retreats and returns under machine control',
  );
  assert.equal(S.totals(s, 'railCurve').stored, 3);
  assert.equal(e.cargo, undefined);
  assert.equal(s.costs.filter((c) => c.category === 'Purchases').length, 1);
}

for (const yaw of [Math.PI, 34.137519189487705]) {
  test(`a loaded delivery retreats and reapproaches its rail-panel dock from yaw ${yaw}`, () => {
    const f = angledCurveDelivery(yaw);
    const { s, orderId, equipmentId, reelId } = f;
    const e = s.equipment.find((e) => e.id === equipmentId)!;
    const t = s.orders.find((o) => o.id === orderId)!.unload!;
    assert.equal(equipmentMoveBlocked(s, e, e), '', 'The initial supported pose is clear');
    assert.equal(equipmentMoveBlocked(s, e, { ...t.drop, yaw: t.dropYaw }), '');
    assert.equal(equipmentSweepBlocked(s, e, { ...t.drop, yaw: t.dropYaw }), reelId);
    for (const reverse of [false, true])
      assert.equal(
        machineRoute(s, { ...e, reverse }, t.drop, S.obstacles(s), 250, true, t.dropYaw),
        null,
      );
    const retreat = machineRetreatRoute(s, e, t.drop, S.obstacles(s), true, t.dropYaw);
    assert.equal(
      retreat?.length,
      1,
      'A checked straight withdrawal enables the opposite-gear return',
    );
    assert.equal(resumeDeliveryHandling(s, e.id), '');
    completeDelivery(f);
  });
}

test('save/reload during a loaded reverse withdrawal retains the path, gear, and three delivered panels', () => {
  const f = angledCurveDelivery(34.137519189487705);
  const e = f.s.equipment.find((e) => e.id === f.equipmentId)!;
  const initial = pose(e);
  assert.equal(resumeDeliveryHandling(f.s, e.id), '');
  tickUntil(f.s, () => !!e.reverse && !!e.path.length && dist(e, initial) > 0.2, 20);
  const before = pose(e);
  const cargo = { ...f.s.orders.find((o) => o.id === f.orderId)!.unload!.cargo! };
  const restored = S.load(S.save(f.s));
  const after = restored.equipment.find((e) => e.id === f.equipmentId)!;
  assert.deepEqual(
    JSON.parse(JSON.stringify(pose(after))),
    JSON.parse(JSON.stringify(before)),
    'The actual midway steering/gear/path survive the save',
  );
  assert.deepEqual(restored.orders.find((o) => o.id === f.orderId)!.unload!.cargo, cargo);
  assertConserved(restored, f.orderId, f.equipmentId, f.reelId);
  completeDelivery({ ...f, s: restored }, true);
});

test('the initial loaded storage trip plans a clear final heading before entering the narrow dock', () => {
  const f = angledCurveDelivery();
  const { s, orderId, equipmentId } = f;
  const e = s.equipment.find((e) => e.id === equipmentId)!;
  const o = s.orders.find((o) => o.id === orderId)!;
  const t = o.unload!;
  Object.assign(e, { x: 25, z: 29.5, yaw: Math.PI, reach: 4, path: [], reverse: false });
  Object.assign(
    s.workers.find((w) => w.id === t.operatorId)!,
    { x: e.x, z: e.z },
  );
  t.cargo = { ...localPoint(e, e.reach!, 0), y: 0.4, yaw: e.yaw! + Math.PI / 2 };
  assert.equal(resumeDeliveryHandling(s, e.id), '');
  // Reenter the normal transition out of the carrier-clearance phase, after
  // the purchased bundle has already been lifted and its rigger released.
  t.phase = 'clear';
  S.tick(s, 0.1);
  assert.equal(t.phase, 'carry');
  assert.ok(e.path.length, 'The first storage journey has a physical planned route');
  const replay = pose(e);
  const replayPath = () => {
    for (let i = 0; replay.path.length && i < 1200; i++) {
      const before = pose(replay);
      move(replay, 0.1, equipmentTravelSpeed(s, replay), true);
      assert.equal(
        equipmentSweepBlocked(s, before, replay),
        '',
        'The planned initial route can be executed',
      );
    }
    assert.equal(replay.path.length, 0);
  };
  replayPath();
  if (dist(replay, t.drop) > 0.025) {
    assert.ok(replay.reverse, 'A partial accepted route is a real checked reverse withdrawal');
    replay.reverse = false;
    const continuation = machineRoute(s, replay, t.drop, S.obstacles(s), 250, true, t.dropYaw);
    assert.ok(continuation, 'Withdrawing has a verified forward continuation to the final heading');
    replay.path = continuation;
    replayPath();
  }
  assert.ok(dist(replay, t.drop) < 0.025);
  assert.equal(
    equipmentSweepBlocked(s, replay, { ...t.drop, yaw: t.dropYaw }),
    '',
    'Its arrival heading permits the entire final alignment turn',
  );
  let previous = pose(e);
  tickUntil(
    s,
    () => o.status === 'done',
    120,
    () => {
      if (dist(previous, e) > 1e-7 || Math.abs((previous.yaw || 0) - (e.yaw || 0)) > 1e-7)
        assert.equal(equipmentSweepBlocked(s, previous, e), '');
      assertConserved(s, orderId, equipmentId, f.reelId);
      previous = pose(e);
    },
  );
  assert.equal(S.totals(s, 'railCurve').stored, 3);
});

function blockedShapedTopUp(stackYaw: number) {
  const f = angledCurveDelivery();
  const { s, orderId, equipmentId } = f;
  const o = s.orders.find((o) => o.id === orderId)!;
  const e = s.equipment.find((e) => e.id === equipmentId)!;
  const t = o.unload!;
  const stack = {
    ...t.destination,
    id: S.id(s, 'stack'),
    item: 'railCurve' as const,
    qty: 1,
    reserved: 0,
    source: 'opening',
    yaw: stackYaw,
  };
  s.stacks.push(stack);
  t.mergeId = stack.id;
  t.destinationY = parcelPitch('railCurve');
  const correctNorthFace = stackYaw === Math.PI;
  t.drop = { x: 15, z: correctNorthFace ? 29.5 : 37.5 };
  t.dropYaw = correctNorthFace ? Math.PI / 2 : -Math.PI / 2;
  // The machine waits on the opposite, perfectly reachable face. A curved
  // panel cannot be rotated 180 degrees and still nest on this existing stack.
  Object.assign(e, {
    x: 15,
    z: correctNorthFace ? 37.5 : 29.5,
    yaw: correctNorthFace ? -Math.PI / 2 : Math.PI / 2,
    reach: 4,
    path: [],
    reverse: false,
  });
  Object.assign(
    s.workers.find((w) => w.id === t.operatorId)!,
    { x: e.x, z: e.z },
  );
  t.cargo = { ...localPoint(e, e.reach!, 0), y: 0.4, yaw: e.yaw! + Math.PI / 2 };
  const building = {
    id: S.id(s, 'building'),
    kind: 'office' as const,
    rotation: 0,
    connected: false,
    name: 'Synthetic dock obstruction',
    x: 13,
    z: t.drop.z - 2,
    w: 4,
    d: 4,
  };
  s.buildings.push(building);
  assert.equal(equipmentMoveBlocked(s, e, e), '', 'The opposite face is physically clear');
  assert.equal(equipmentMoveBlocked(s, e, { ...t.drop, yaw: t.dropYaw }), building.id);
  assert.equal(resumeDeliveryHandling(s, e.id), '');
  return { ...f, stack, building, e, o, t };
}

for (const yaw of [0, Math.PI]) {
  test(`a shaped-rail top-up preserves stack bearing ${yaw} when only its opposite face is clear`, () => {
    const f = blockedShapedTopUp(yaw);
    const { s, e, o, t, stack, building } = f;
    const correctDrop = { ...t.drop };
    advance(s, yaw === 0 ? 25 : 3);
    assert.ok(o.unload && e.cargo, 'Blocked compatible access retains the supported bundle');
    assert.equal(stack.qty, 1, 'The clear wrong-facing dock cannot silently top up the stack');
    assert.equal(stack.yaw, yaw);
    assert.deepEqual(t.drop, correctDrop, 'The incompatible opposite face is never committed');
    assert.equal(e.cargo.qty, 3);
    assert.equal(S.totals(s, 'railCurve').stored + S.totals(s, 'railCurve').cargo, 4);
    if (yaw === Math.PI) return;
    assert.ok(
      s.events.some((v) => v.severity === 'warning'),
      'Waiting produces an actionable warning',
    );
    // Remove only the synthetic fixed obstruction; ordinary delivery work
    // must retry and complete without another purchase or cargo recreation.
    s.buildings = s.buildings.filter((b) => b.id !== building.id);
    let previous = pose(e);
    tickUntil(
      s,
      () => o.status === 'done',
      120,
      () => {
        if (dist(previous, e) > 1e-7 || Math.abs((previous.yaw || 0) - (e.yaw || 0)) > 1e-7)
          assert.equal(equipmentSweepBlocked(s, previous, e), '');
        const totals = S.totals(s, 'railCurve');
        assert.equal(
          totals.stored + totals.cargo,
          4,
          'Every original and delivered panel is retained',
        );
        if (o.unload?.phase === 'lower')
          assert.ok(Math.abs(angleDelta(stack.yaw, o.unload.cargo!.yaw)) < 0.01);
        previous = pose(e);
      },
    );
    assert.equal(stack.qty, 4);
    assert.equal(stack.yaw, yaw, 'A successful top-up preserves the physical stack orientation');
    assert.equal(s.stacks.filter((t) => t.item === 'railCurve').length, 1);
    assert.equal(e.cargo, undefined);
    assert.equal(s.costs.filter((c) => c.category === 'Purchases').length, 1);
  });
}

test('a stalled delivery retries blocked storage approaches independently at bounded intervals', () => {
  const { s, e, o, t, stack } = blockedShapedTopUp(0);
  e.path = [{ ...t.drop }];
  const start = s.elapsed;
  // Traffic movement may keep deferring its own route retry. The delivery
  // dock check must still run, without running its expensive searches each tick.
  const tickStalled = () => {
    e.trafficWait = 3;
    e.trafficRetry = s.elapsed + 100;
    S.tick(s, 0.1);
  };
  tickStalled();
  const firstDeadline = o.retryAt!;
  assert.ok(firstDeadline > start + 1.4 && firstDeadline < start + 1.7);
  for (let i = 0; i < 10; i++) {
    tickStalled();
    assert.equal(o.retryAt, firstDeadline, 'The storage approach search has a real cooldown');
  }
  for (let i = 0; o.retryAt === firstDeadline && i < 10; i++) tickStalled();
  assert.ok(
    o.retryAt! > firstDeadline + 1.4,
    'The next retry is not starved by movement trafficRetry',
  );
  assert.ok(e.cargo && o.unload);
  assert.equal(stack.qty, 1);
  assert.equal(S.totals(s, 'railCurve').stored + S.totals(s, 'railCurve').cargo, 4);
});

test('a withdrawn excavator retracts its real load before planning a compact storage approach', () => {
  const s = S.createState();
  S.addZone(s, { x: 18, z: 32, w: 18, d: 18 });
  const e = seedHandlingResources(s, 'excavator');
  const [orderId] = S.purchase(s, 'slab', 1, 'rail');
  const o = s.orders.find((o) => o.id === orderId)!;
  tickUntil(s, () => o.status === 'unloading', 600);
  assert.equal(requestRailUnloading(s, orderId), undefined);
  tickUntil(s, () => o.unload?.phase === 'carry', 600);
  assert.equal(pauseDeliveryHandling(s, e.id), '');
  const t = o.unload!;
  Object.assign(e, {
    x: 20.5,
    z: 25.5,
    yaw: Math.PI / 2,
    reach: 4.6,
    path: [],
    reverse: false,
    trafficGoal: undefined,
    trafficReverse: undefined,
    trafficRetry: undefined,
    blockedBy: undefined,
  });
  Object.assign(
    s.workers.find((w) => w.id === t.operatorId)!,
    { x: e.x, z: e.z },
  );
  for (const w of s.workers.filter((w) => w.id !== t.operatorId))
    Object.assign(w, { x: 13.5, z: 23.5, path: [] });
  t.destination = { x: 20, z: 32, w: 1, d: 1 };
  o.allocated = { ...t.destination };
  t.drop = { x: 20.5, z: 29.5 };
  t.dropYaw = Math.PI / 2;
  t.destinationY = 0;
  t.cargo = { ...localPoint(e, 4.6, 0), y: t.sourceY + 0.42, yaw: Math.PI };
  e.lift = t.cargo.y;
  const parked: Equipment = {
    id: S.id(s, 'equipment'),
    kind: 'forklift',
    x: 20.5,
    z: 35.5,
    y: 0,
    heading: 1,
    yaw: Math.PI / 2,
    path: [],
    fuel: 45,
    tank: 45,
    used: 0,
    work: 0,
  };
  s.equipment.push(parked);
  assert.equal(equipmentMoveBlocked(s, e, e), '', 'The fully withdrawn long-reach pose is clear');
  assert.equal(equipmentMoveBlocked(s, e, { ...t.drop, yaw: t.dropYaw }), parked.id);
  assert.equal(equipmentMoveBlocked(s, { ...e, reach: 3 }, { ...t.drop, yaw: t.dropYaw }), '');
  assert.equal(resumeDeliveryHandling(s, e.id), '');
  // A checked storage trip must become possible while still in carrier-clear
  // work, rather than requiring the unreachable carry phase to retract first.
  t.phase = 'clear';
  t.clock = 0;
  let previous = pose(e);
  let previousCargo = { ...t.cargo! };
  let retractionTicks = 0;
  tickUntil(
    s,
    () => t.phase === 'carry',
    10,
    () => {
      const change = previous.reach! - e.reach!;
      if (change > 1e-7) {
        retractionTicks++;
        assert.ok(change <= 0.080001, 'The supported carriage retracts at 0.8 m/s');
        assert.equal(equipmentReachBlocked(s, previous, e.reach!), '');
        assert.ok(
          dist(previousCargo, t.cargo!) <= 0.080001,
          'Cargo moves continuously with the tool',
        );
      }
      assert.ok(dist(t.cargo!, localPoint(e, e.reach!, 0)) < 1e-7);
      assert.equal(S.totals(s, 'slab').cargo, 1);
      assert.equal(S.totals(s, 'slab').stored, 0, 'Retraction does not invent a stored slab');
      previous = pose(e);
      previousCargo = { ...t.cargo! };
    },
  );
  assert.ok(retractionTicks >= 19, 'The arm physically retracts across many simulation ticks');
  assert.ok(Math.abs(e.reach! - 3) < 1e-7);
  previous = pose(e);
  tickUntil(
    s,
    () => o.status === 'done',
    120,
    () => {
      if (dist(previous, e) > 1e-7 || Math.abs((previous.yaw || 0) - (e.yaw || 0)) > 1e-7)
        assert.equal(equipmentSweepBlocked(s, previous, e), '');
      const totals = S.totals(s, 'slab');
      assert.equal(totals.delivered, 1);
      assert.equal(totals.stored + totals.cargo, 1);
      previous = pose(e);
    },
  );
  assert.equal(S.totals(s, 'slab').stored, 1);
  assert.equal(s.orders.length, 1);
  assert.equal(s.costs.filter((c) => c.category === 'Purchases').length, 1);
  assert.deepEqual({ x: parked.x, z: parked.z }, { x: 20.5, z: 35.5 });
});
