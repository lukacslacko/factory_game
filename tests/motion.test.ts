import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  move,
  angleDelta,
  mixAngle,
  carPose,
  trackPose,
  COUPLED_CENTERS,
  RAIL_STOP,
  localPoint,
  roadPath,
  roadLength,
} from '../src/motion.ts';
import { route } from '../src/path.ts';

test('machines accelerate continuously and turn by a bounded angle through a routed corner', () => {
  const path = route({ x: 0.5, z: 0.5 }, { x: 8.5, z: 8.5 }, [], 1.1)!;
  const machine = { x: 0.5, z: 0.5, yaw: 0, velocity: 0, travel: 0, path };
  let turned = 0,
    moved = 0;
  for (let t = 0; t < 30 && machine.path.length; t += 1 / 60) {
    const old = { x: machine.x, z: machine.z, yaw: machine.yaw, velocity: machine.velocity };
    move(machine, 1 / 60, 3.5, true);
    const distance = Math.hypot(machine.x - old.x, machine.z - old.z);
    assert.ok(distance < 3.5 / 60 + 1e-6, 'No cell-to-cell position jump');
    assert.ok(
      Math.abs(angleDelta(old.yaw, machine.yaw)) <= 2.4 / 60 + 1e-6,
      'No instantaneous cardinal turn',
    );
    assert.ok(
      machine.velocity <= old.velocity + 1.4 / 60 + 1e-6,
      'Vehicle should accelerate rather than begin at cruising speed',
    );
    if (Math.abs(angleDelta(old.yaw, machine.yaw)) > 0.001) turned++;
    if (distance > 0.001) moved++;
  }
  assert.ok(turned > 10);
  assert.ok(moved > 60);
  assert.ok(Math.hypot(machine.x - 8.5, machine.z - 8.5) < 0.001);
  assert.equal(machine.path.length, 0);
  assert.equal(machine.velocity, 0);
});

test('reverse travel preserves facing direction and reverses wheel travel', () => {
  const machine = {
    x: 3,
    z: 0,
    yaw: 0,
    velocity: 0,
    travel: 0,
    reverse: true,
    path: [{ x: 0, z: 0 }],
  };
  for (let t = 0; t < 10 && machine.path.length; t += 1 / 60) move(machine, 1 / 60, 2, true);
  assert.ok(Math.abs(angleDelta(machine.yaw, 0)) < 1e-9);
  assert.ok(Math.abs(machine.travel + 3) < 0.001);
  assert.ok(Math.abs(machine.x) < 0.001);
});

test('render interpolation crosses the angle wrap along the short two-degree arc', () => {
  const a = (179 * Math.PI) / 180,
    b = (-179 * Math.PI) / 180;
  const midpoint = mixAngle(a, b, 0.5);
  assert.ok(Math.abs(midpoint - Math.PI) < 1e-12);
  assert.ok(Math.abs(angleDelta(a, b) - (2 * Math.PI) / 180) < 1e-12);
});

test('rail vehicles have separated bodies and individually aligned bogie positions through the turnout', () => {
  for (let distance = 115; distance <= RAIL_STOP; distance += 0.25) {
    const engine = carPose(distance, 5);
    const wagon = carPose(distance - COUPLED_CENTERS, 11);
    const engineRear = localPoint(engine, -3.95, 0);
    const wagonFront = localPoint(wagon, 8, 0);
    assert.ok(
      Math.hypot(engineRear.x - wagonFront.x, engineRear.z - wagonFront.z) > 1.1,
      'Flatcar deck must not pass into the locomotive body',
    );
    for (const [pose, at, wheelbase] of [
      [engine, distance, 5],
      [wagon, distance - COUPLED_CENTERS, 11],
    ] as const) {
      const front = trackPose(at + wheelbase / 2),
        rear = trackPose(at - wheelbase / 2);
      assert.ok(Math.abs(pose.x - (front.x + rear.x) / 2) < 1e-9);
      assert.ok(Math.abs(pose.z - (front.z + rear.z) / 2) < 1e-9);
      assert.ok(
        Math.abs(angleDelta(pose.yaw, Math.atan2(front.z - rear.z, front.x - rear.x))) < 1e-9,
      );
    }
  }
});

test('road arrivals curve through the crossing with finite turn segments', () => {
  for (const item of ['slab', 'forklift']) {
    const order = { item, mode: 'road' as const };
    const fullPath = roadPath(order),
      points = [fullPath[0]];
    let distance = 0;
    for (let i = 1; i < fullPath.length; i++) {
      distance += Math.hypot(fullPath[i].x - fullPath[i - 1].x, fullPath[i].z - fullPath[i - 1].z);
      if (distance > roadLength(order) + 0.001) break;
      points.push(fullPath[i]);
    }
    let intermediate = 0;
    for (let i = 1; i + 1 < points.length; i++) {
      const a = Math.atan2(points[i].z - points[i - 1].z, points[i].x - points[i - 1].x);
      const b = Math.atan2(points[i + 1].z - points[i].z, points[i + 1].x - points[i].x);
      assert.ok(
        Math.abs(angleDelta(a, b)) < Math.PI / 8,
        'Road trucks must not make a ninety-degree turn at a single waypoint',
      );
      if (Math.abs(angleDelta(a, b)) > 0.001) intermediate++;
    }
    assert.ok(intermediate > 10);
  }
});

test('shortest yaw remains stable after many complete turns in either direction', () => {
  for (let turns = -100; turns <= 100; turns++) {
    const a = turns * Math.PI * 2 + 0.25;
    assert(Math.abs(angleDelta(a, 0.4) - 0.15) < 1e-10);
    assert(Math.abs(angleDelta(a, 0.1) + 0.15) < 1e-10);
    assert(Math.abs(mixAngle(a, 0.4, 0.5) - (a + 0.075)) < 1e-10);
  }
});

test('an excavator finishes a short approach leg before steering into the next corner', () => {
  const e = {
    x: 0,
    z: 0,
    yaw: 0,
    velocity: 0,
    path: [
      { x: 0.14, z: 0 },
      { x: 0.14, z: 4 },
    ],
  };
  let priorSign = 0,
    reversals = 0,
    turning = 0,
    ticks = 0;
  while (e.path.length && ticks++ < 200) {
    const before = { x: e.x, z: e.z, yaw: e.yaw };
    move(e, 0.1, 0.84, true);
    const delta = angleDelta(before.yaw, e.yaw),
      sign = Math.abs(delta) > 1e-6 ? Math.sign(delta) : 0;
    turning += Math.abs(delta);
    if (sign && priorSign && sign !== priorSign) reversals++;
    if (sign) priorSign = sign;
    if (e.x < 0.14 - 1e-7) {
      assert.ok(
        Math.abs(e.yaw) < 1e-7,
        'Finish the eastbound leg without steering north prematurely',
      );
      assert.ok(e.x > before.x, 'An aligned, unobstructed short leg must keep making progress');
    }
    assert.ok(Math.abs(delta) <= 0.11 + 1e-7, 'Turning remains bounded by the real machine rate');
  }
  assert.equal(e.path.length, 0);
  assert.equal(reversals, 0, 'One corner must not cause alternating heading corrections');
  assert.ok(turning <= Math.PI / 2 + 1e-7);
  assert.ok(ticks < 100, 'Do not trade flutter for a no-progress pause');
});
