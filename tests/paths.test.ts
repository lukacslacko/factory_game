import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, dist } from '../src/path.ts';
import { angleDelta } from '../src/motion.ts';
import type { Point, Rect } from '../src/types.ts';

function trace(start: Point, path: Point[]) {
  const points = [start, ...path];
  let length = 0,
    turning = 0,
    lastAngle: number | undefined;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      distance = dist(a, b);
    if (distance < 0.00001) continue;
    const angle = Math.atan2(b.z - a.z, b.x - a.x);
    length += distance;
    if (lastAngle !== undefined) turning += Math.abs(angleDelta(lastAngle, angle));
    lastAngle = angle;
  }
  return { points, length, turning };
}

function verifyClearSegments(points: Point[], obstacles: Rect[], clearance: number) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      n = Math.max(1, Math.ceil(dist(a, b) / 0.05));
    for (let step = 0; step <= n; step++) {
      const t = step / n,
        x = a.x + (b.x - a.x) * t,
        z = a.z + (b.z - a.z) * t;
      for (const r of obstacles)
        assert.ok(
          !(
            x > r.x - clearance + 0.001 &&
            x < r.x + r.w + clearance - 0.001 &&
            z > r.z - clearance + 0.001 &&
            z < r.z + r.d + clearance - 0.001
          ),
          `Route segment enters an obstacle: ${JSON.stringify({ a, b, x, z, r })}`,
        );
    }
  }
}

test('an unobstructed trip uses a direct or simple L-shaped route instead of a staircase', () => {
  for (const clearance of [0.15, 1.1]) {
    const start = { x: 0.5, z: 0.5 },
      goal = { x: 25.5, z: 17.5 };
    const path = route(start, goal, [], clearance);
    assert.ok(path);
    const stats = trace(start, path);
    assert.ok(stats.length <= 42.01);
    assert.ok(
      stats.turning <= Math.PI / 2 + 0.1,
      `Empty ground needs at most one deliberate turn, got ${(stats.turning / Math.PI) * 180} degrees`,
    );
    assert.ok(dist(path[path.length - 1], goal) < 0.001);
  }
});

test('a straight clear route keeps one heading and reaches a non-grid-center destination exactly', () => {
  const start = { x: 3.2, z: 20.25 },
    goal = { x: 43.7, z: 20.25 };
  const path = route(start, goal, [], 1.1);
  assert.ok(path);
  const stats = trace(start, path);
  assert.ok(stats.turning < 0.01, `Straight transit should not wobble into cell centers`);
  assert.ok(stats.points.every((p) => Math.abs(p.z - start.z) < 0.001));
  assert.ok(Math.abs(stats.length - dist(start, goal)) < 0.001);
});

test('a detour avoids the complete footprint without repeated zigzags along its edge', () => {
  const start = { x: 0.5, z: 8.5 },
    goal = { x: 22.5, z: 8.5 };
  const obstacle = { x: 8, z: 2, w: 4, d: 16 };
  const path = route(start, goal, [obstacle], 1.1);
  assert.ok(path);
  const stats = trace(start, path);
  verifyClearSegments(stats.points, [obstacle], 1.1);
  assert.ok(stats.length < 42, `Unnecessary detour: ${stats.length} m`);
  assert.ok(
    stats.turning <= Math.PI * 2 + 0.1,
    `A rectangular obstacle should need at most four corners, got ${(stats.turning / Math.PI) * 180} degrees`,
  );
});

test('path simplification cannot cut a narrow wall between otherwise clear grid centers', () => {
  const start = { x: 0.5, z: 10.5 },
    goal = { x: 16.5, z: 10.5 };
  const wall = { x: 8.05, z: 5, w: 0.15, d: 10 };
  const path = route(start, goal, [wall], 0.15);
  assert.ok(path);
  verifyClearSegments(trace(start, path).points, [wall], 0.15);
});
