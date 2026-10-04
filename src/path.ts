import type { Point, Rect } from './types';
export const key = (x: number, z: number) => `${Math.floor(x)},${Math.floor(z)}`;
export const overlap = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.z < b.z + b.d + pad && a.z + a.d + pad > b.z;
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const center = (a: Rect) => ({ x: a.x + a.w / 2, z: a.z + a.d / 2 });
export class Heap {
  a: { x: number; z: number; f: number; g: number; direction?: number }[] = [];
  push(n: (typeof this.a)[number]) {
    let i = this.a.push(n) - 1;
    while (i > 0) {
      let p = (i - 1) >> 1;
      if (this.a[p].f <= n.f) break;
      this.a[i] = this.a[p];
      i = p;
    }
    this.a[i] = n;
  }
  pop() {
    const top = this.a[0],
      end = this.a.pop()!;
    if (this.a.length) {
      let i = 0;
      while (i * 2 + 1 < this.a.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.a.length && this.a[c + 1].f < this.a[c].f) c++;
        if (this.a[c].f >= end.f) break;
        this.a[i] = this.a[c];
        i = c;
      }
      this.a[i] = end;
    }
    return top;
  }
}
const encode = (x: number, z: number) => (x + 64) * 192 + z + 64;
const decode = (k: number) => ({ x: Math.floor(k / 192) - 64 + 0.5, z: (k % 192) - 64 + 0.5 });
export function segmentClear(a: Point, b: Point, obstacles: Rect[], clearance = 0) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    finiteDelta = Number.isFinite(dx) && Number.isFinite(dz);
  for (const r of obstacles) {
    const minX = r.x - clearance + 1e-7,
      maxX = r.x + r.w + clearance - 1e-7,
      minZ = r.z - clearance + 1e-7,
      maxZ = r.z + r.d + clearance - 1e-7;
    // Most checks are against distant walls. Reject their bounds before
    // clipping, without normalizing extremely thin epsilon-inverted bounds.
    if (
      finiteDelta &&
      ((minX <= maxX && ((a.x < minX && b.x < minX) || (a.x > maxX && b.x > maxX))) ||
        (minZ <= maxZ && ((a.z < minZ && b.z < minZ) || (a.z > maxZ && b.z > maxZ))))
    )
      continue;
    let low = 0,
      high = 1;
    if (Math.abs(dx) < 1e-9) {
      if (a.x < minX || a.x > maxX) continue;
    } else {
      let lo = (minX - a.x) / dx,
        hi = (maxX - a.x) / dx;
      if (lo > hi) {
        const old = lo;
        lo = hi;
        hi = old;
      }
      low = Math.max(low, lo);
      high = Math.min(high, hi);
      if (low > high) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (a.z < minZ || a.z > maxZ) continue;
    } else {
      let lo = (minZ - a.z) / dz,
        hi = (maxZ - a.z) / dz;
      if (lo > hi) {
        const old = lo;
        lo = hi;
        hi = old;
      }
      low = Math.max(low, lo);
      high = Math.min(high, hi);
      if (low > high) continue;
    }
    if (low <= high) return false;
  }
  return true;
}
export type TravelCost = (point: Point, yaw: number) => number;
export function segmentTravelCost(a: Point, b: Point, cost?: TravelCost) {
  const length = dist(a, b);
  if (!cost || length < 1e-7) return length;
  const steps = Math.max(1, Math.ceil(length / 0.5));
  const yaw = Math.atan2(b.z - a.z, b.x - a.x);
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    total += Math.max(1, cost({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, yaw));
  }
  return (length * total) / steps;
}
function directAxisPath(start: Point, goals: Point[], obstacles: Rect[], clearance: number) {
  const yaw = (start as Point & { yaw?: number }).yaw;
  let best: Point[] | null = null,
    score = Infinity;
  for (const goal of goals) {
    for (const bend of [
      { x: goal.x, z: start.z },
      { x: start.x, z: goal.z },
    ]) {
      const path = [bend, goal].filter((p, i, a) => dist(i === 0 ? start : a[i - 1], p) > 0.001);
      let prior = start,
        valid = true,
        cost = 0;
      for (const q of path) {
        if (!segmentClear(prior, q, obstacles, clearance)) {
          valid = false;
          break;
        }
        cost += dist(prior, q);
        prior = q;
      }
      if (!valid) continue;
      cost += Math.max(0, path.length - 1) * 3.5;
      if (yaw !== undefined && path.length) {
        const angle = Math.atan2(path[0].z - start.z, path[0].x - start.x) - yaw;
        cost += Math.acos(Math.cos(angle)) * 0.8;
      }
      if (cost < score) {
        score = cost;
        best = path;
      }
    }
  }
  return best;
}
function search(
  start: Point,
  goals: Point[],
  obstacles: Rect[],
  clearance: number,
  searchLimit = 145000,
  travelCost?: TravelCost,
): Point[] | null {
  if (clearance >= 1 && !travelCost) {
    const direct = directAxisPath(start, goals, obstacles, clearance);
    if (direct) return roundCorners(start, direct, obstacles, clearance);
  }
  const blocked = new Set<number>();
  for (const r of obstacles) {
    for (let x = Math.floor(r.x - clearance); x < Math.ceil(r.x + r.w + clearance); x++)
      for (let z = Math.floor(r.z - clearance); z < Math.ceil(r.z + r.d + clearance); z++) {
        if (
          x + 0.5 > r.x - clearance &&
          x + 0.5 < r.x + r.w + clearance &&
          z + 0.5 > r.z - clearance &&
          z + 0.5 < r.z + r.d + clearance
        )
          blocked.add(encode(x, z));
      }
  }
  const targets = goals
    .map((p) => ({ x: Math.floor(p.x), z: Math.floor(p.z) }))
    .filter(
      (p) => p.x >= -48 && p.x <= 230 && p.z >= -30 && p.z <= 115 && !blocked.has(encode(p.x, p.z)),
    );
  if (!targets.length) return null;
  const targetKeys = new Set(targets.map((p) => encode(p.x, p.z))),
    sx = Math.floor(start.x),
    sz = Math.floor(start.z),
    startKey = encode(sx, sz) * 5 + 4;
  const heuristic = (x: number, z: number) => {
    let d = Infinity;
    for (const p of targets) d = Math.min(d, Math.abs(x - p.x) + Math.abs(z - p.z));
    return d;
  };
  const open = new Heap(),
    scores = new Map<number, number>(),
    parents = new Map<number, number>();
  open.push({ x: sx, z: sz, g: 0, f: heuristic(sx, sz), direction: 4 });
  scores.set(startKey, 0);
  let loops = 0;
  while (open.a.length && loops++ < searchLimit) {
    const p = open.pop(),
      pk = encode(p.x, p.z) * 5 + (p.direction ?? 4);
    if (p.g !== scores.get(pk)) continue;
    if (targetKeys.has(encode(p.x, p.z))) {
      const out: Point[] = [];
      let cur = pk;
      while (cur !== startKey) {
        out.push(decode(Math.floor(cur / 5)));
        cur = parents.get(cur)!;
      }
      const path = out.reverse();
      return clearance >= 1 ? roundCorners(start, path, obstacles, clearance) : path;
    }
    for (const [direction, [dx, dz]] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ].entries()) {
      const x = p.x + dx,
        z = p.z + dz,
        cell = encode(x, z),
        k = cell * 5 + direction;
      if (x < -48 || x > 230 || z < -30 || z > 115 || blocked.has(cell)) continue;
      const from = pk === startKey ? start : { x: p.x + 0.5, z: p.z + 0.5 };
      if (!segmentClear(from, { x: x + 0.5, z: z + 0.5 }, obstacles, clearance)) continue;
      const changed = p.direction !== 4 && p.direction !== direction;
      const g =
        p.g +
        (travelCost ? segmentTravelCost(from, { x: x + 0.5, z: z + 0.5 }, travelCost) : 1) +
        (changed ? (clearance >= 1 ? 3.5 : 0.03) : 0);
      if (g >= (scores.get(k) ?? Infinity)) continue;
      scores.set(k, g);
      parents.set(k, pk);
      open.push({ x, z, g, f: g + heuristic(x, z), direction });
    }
  }
  return null;
}
export function roundCorners(start: Point, path: Point[], obstacles: Rect[], clearance: number) {
  const vertices = [start, ...path].filter(
    (p, i, a) =>
      i === 0 ||
      i === a.length - 1 ||
      Math.abs((p.x - a[i - 1].x) * (a[i + 1].z - p.z) - (p.z - a[i - 1].z) * (a[i + 1].x - p.x)) >
        0.001,
  );
  const out: Point[] = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = vertices[i - 1],
      b = vertices[i],
      c = vertices[i + 1];
    const ab = dist(a, b),
      bc = dist(b, c),
      r = Math.min(1.15, ab * 0.45, bc * 0.45);
    const enter = { x: b.x + ((a.x - b.x) * r) / ab, z: b.z + ((a.z - b.z) * r) / ab };
    const leave = { x: b.x + ((c.x - b.x) * r) / bc, z: b.z + ((c.z - b.z) * r) / bc };
    const curve = Array.from({ length: 9 }, (_, k) => {
      const t = k / 8,
        u = 1 - t;
      return {
        x: u * u * enter.x + 2 * u * t * b.x + t * t * leave.x,
        z: u * u * enter.z + 2 * u * t * b.z + t * t * leave.z,
      };
    });
    const blocked = curve.some(
      (p, i) => i > 0 && !segmentClear(curve[i - 1], p, obstacles, clearance),
    );
    out.push(...(blocked ? [b] : curve));
  }
  if (vertices.length > 1) out.push(vertices[vertices.length - 1]);
  return out;
}
export function route(
  start: Point,
  goal: Point,
  obstacles: Rect[],
  clearance = 0,
  searchLimit = 145000,
  travelCost?: TravelCost,
) {
  const path = search(start, [goal], obstacles, clearance, searchLimit, travelCost);
  if (!path) return null;
  // Grid search is the route skeleton; dock and ramp positions are exact meters.
  if (
    obstacles.some(
      (r) =>
        goal.x > r.x - clearance &&
        goal.x < r.x + r.w + clearance &&
        goal.z > r.z - clearance &&
        goal.z < r.z + r.d + clearance,
    )
  )
    return null;
  if (dist(path[path.length - 1] || start, goal) > 0.001) {
    if (!segmentClear(path[path.length - 1] || start, goal, obstacles, clearance)) return null;
    path.push({ ...goal });
  }
  return path;
}
export function approach(start: Point, r: Rect, obstacles: Rect[], clearance = 0) {
  const pts: Point[] = [];
  const gap = Math.ceil(clearance + 0.5) - 0.5;
  for (let x = Math.floor(r.x); x < r.x + r.w; x++)
    pts.push({ x: x + 0.5, z: r.z - gap }, { x: x + 0.5, z: r.z + r.d + gap });
  for (let z = Math.floor(r.z); z < r.z + r.d; z++)
    pts.push({ x: r.x - gap, z: z + 0.5 }, { x: r.x + r.w + gap, z: z + 0.5 });
  return search(start, pts, obstacles, clearance);
}
