import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentClear } from '../src/path.ts';
import type { Point, Rect } from '../src/types.ts';

// Independent frozen reference for the established numerical clipping behavior.
// This deliberately retains the original arrays and clipping loop.
function reference(a: Point, b: Point, obstacles: Rect[], clearance = 0) {
  return !obstacles.some((r) => {
    let low = 0,
      high = 1;
    const min = [r.x - clearance + 1e-7, r.z - clearance + 1e-7],
      max = [r.x + r.w + clearance - 1e-7, r.z + r.d + clearance - 1e-7],
      from = [a.x, a.z],
      delta = [b.x - a.x, b.z - a.z];
    for (let i = 0; i < 2; i++) {
      if (Math.abs(delta[i]) < 1e-9) {
        if (from[i] < min[i] || from[i] > max[i]) return false;
      } else {
        let lo = (min[i] - from[i]) / delta[i],
          hi = (max[i] - from[i]) / delta[i];
        if (lo > hi) [lo, hi] = [hi, lo];
        low = Math.max(low, lo);
        high = Math.min(high, hi);
        if (low > high) return false;
      }
    }
    return low <= high;
  });
}

test('wall crossings, points, tangencies, and expanded clearance keep exact boundary behavior', () => {
  const wall = { x: 0, z: 0, w: 2, d: 2 };
  const cases: [Point, Point, number, boolean][] = [
    [{ x: -1, z: 1 }, { x: 3, z: 1 }, 0, false],
    [{ x: -1, z: 0 }, { x: 3, z: 0 }, 0, true],
    [{ x: -1, z: 1e-7 }, { x: 3, z: 1e-7 }, 0, false],
    [{ x: -1, z: 0.5e-7 }, { x: 3, z: 0.5e-7 }, 0, true],
    [{ x: -1, z: 1 }, { x: 1, z: -1 }, 0, true],
    [{ x: 1, z: 1 }, { x: 1, z: 1 }, 0, false],
    [{ x: 0, z: 1 }, { x: 0, z: 1 }, 0, true],
    [{ x: -1, z: -0.25 }, { x: 3, z: -0.25 }, 0.3, false],
    [{ x: -1, z: -0.3 }, { x: 3, z: -0.3 }, 0.3, true],
  ];
  for (const [a, b, clearance, expected] of cases) {
    assert.equal(reference(a, b, [wall], clearance), expected);
    assert.equal(segmentClear(a, b, [wall], clearance), expected);
    assert.equal(segmentClear(b, a, [wall], clearance), expected);
  }
  assert.equal(segmentClear({ x: 0, z: 0 }, { x: 1, z: 1 }, []), true);
});

test('very thin walls, near-parallel segments, and custom clearances match the numerical oracle', () => {
  for (const width of [0, 1e-12, 1e-8, 2e-7, 0.08])
    for (const depth of [1e-8, 0.08, 2])
      for (const clearance of [-0.02, 0, 0.22, 1.4, 2.35]) {
        const walls = [{ x: -3.25, z: 4.75, w: width, d: depth }];
        for (const delta of [0, 0.999e-9, 1e-9, 1.001e-9, -1e-9])
          for (const x of [-3.25 - clearance, -3.25 + 1e-7, -3.25 + width / 2]) {
            const a = { x, z: 3 },
              b = { x: x + delta, z: 7 };
            assert.equal(segmentClear(a, b, walls, clearance), reference(a, b, walls, clearance));
            assert.equal(segmentClear(b, a, walls, clearance), reference(b, a, walls, clearance));
          }
      }
});

test('seeded segment and point queries over multiple obstacles match the frozen oracle', () => {
  let seed = 0x1935fabc;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < 25000; i++) {
    const scale = [1e-8, 0.08, 1, 50][i % 4],
      a = { x: (random() - 0.5) * scale * 8, z: (random() - 0.5) * scale * 8 },
      b = i % 7 ? { x: (random() - 0.5) * scale * 8, z: (random() - 0.5) * scale * 8 } : a,
      clearance = [0, 0.22, 1.4, 2.35, -0.01][i % 5],
      obstacles = Array.from({ length: 1 + (i % 8) }, () => ({
        x: (random() - 0.5) * scale * 8,
        z: (random() - 0.5) * scale * 8,
        w: random() * scale * 2,
        d: random() * scale * 2,
      }));
    assert.equal(
      segmentClear(a, b, obstacles, clearance),
      reference(a, b, obstacles, clearance),
      `Seeded query ${i}`,
    );
  }
});
