import type { Point, Motion, Order } from './types';
export const TAU = Math.PI * 2;
export const angleDelta = (a: number, b: number) =>
  ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
export const mixAngle = (a: number, b: number, t: number) => a + angleDelta(a, b) * t;
export const smoothstep = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
export function turn(p: Motion, yaw: number, dt: number, rate = 2.1) {
  p.yaw ??= yaw;
  p.yaw += Math.max(-rate * dt, Math.min(rate * dt, angleDelta(p.yaw, yaw)));
  return Math.abs(angleDelta(p.yaw, yaw)) < 0.025;
}
export function move(
  p: Point & Motion & { path: Point[]; heading?: number; reverse?: boolean },
  dt: number,
  maximum: number,
  vehicle = false,
) {
  p.yaw ??= ((p.heading || 0) * Math.PI) / 2;
  const old = { x: p.x, z: p.z };
  let total = 0,
    last: Point = p;
  for (const point of p.path) {
    total += Math.hypot(point.x - last.x, point.z - last.z);
    last = point;
  }
  if (total < 0.001) {
    p.path = [];
    p.velocity = 0;
    return;
  }
  const next = p.path.find((q) => Math.hypot(q.x - p.x, q.z - p.z) > 0.15) || p.path[0];
  const targetYaw = Math.atan2(next.z - p.z, next.x - p.x) + (p.reverse ? Math.PI : 0);
  const angle = Math.abs(angleDelta(p.yaw, targetYaw));
  if (vehicle && angle > 0.38) {
    turn(p, targetYaw, dt, maximum <= 1.1 ? 1.1 : 1.5);
    p.velocity = 0;
    if (p.heading !== undefined) p.heading = ((Math.round(p.yaw / (Math.PI / 2)) % 4) + 4) % 4;
    return;
  }
  const limit = vehicle
    ? Math.min(maximum, Math.sqrt(2 * 1.5 * total), maximum * Math.max(0.16, 1 - angle / Math.PI))
    : maximum;
  p.velocity = vehicle ? Math.min(limit, (p.velocity || 0) + dt * 1.4) : maximum;
  let remaining = p.velocity * dt;
  while (p.path.length && remaining > 0) {
    const q = p.path[0],
      d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d <= remaining + 1e-7) {
      p.x = q.x;
      p.z = q.z;
      p.path.shift();
      remaining -= d;
    } else {
      p.x += ((q.x - p.x) / d) * remaining;
      p.z += ((q.z - p.z) / d) * remaining;
      remaining = 0;
    }
  }
  const distance = Math.hypot(p.x - old.x, p.z - old.z);
  p.travel = (p.travel || 0) + distance * (p.reverse ? -1 : 1);
  if (distance > 1e-5)
    turn(
      p,
      Math.atan2(p.z - old.z, p.x - old.x) + (p.reverse ? Math.PI : 0),
      dt,
      vehicle ? (maximum <= 1.1 ? 1.1 : 1.5) : 5,
    );
  if (p.heading !== undefined) p.heading = ((Math.round(p.yaw / (Math.PI / 2)) % 4) + 4) % 4;
  if (!p.path.length) p.velocity = 0;
}

// Arc-length sampling gives every axle and car its own location on the same track.
const rail: (Point & { distance: number })[] = [];
let distance = 0;
for (let x = -120; x <= 280; x += 0.125) {
  const t = Math.max(0, Math.min(1, x / 25));
  const p = { x, z: 5 * (3 * t * t - 2 * t * t * t), distance };
  if (rail.length)
    distance += Math.hypot(p.x - rail[rail.length - 1].x, p.z - rail[rail.length - 1].z);
  p.distance = distance;
  rail.push(p);
}
export function trackPose(at: number): Point & { yaw: number } {
  if (at < 0) return { x: -120 + at, z: 0, yaw: 0 };
  if (at > distance) return { x: 280 + at - distance, z: 5, yaw: 0 };
  let lo = 0,
    hi = rail.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rail[mid].distance < at) lo = mid;
    else hi = mid;
  }
  const a = rail[lo],
    b = rail[hi],
    t = (at - a.distance) / (b.distance - a.distance);
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: Math.atan2(b.z - a.z, b.x - a.x),
  };
}
export const RAIL_STOP = rail.find((p) => p.x === 56)!.distance;
export const COUPLED_CENTERS = 13.4;
export function carPose(at: number, wheelbase: number) {
  const a = trackPose(at - wheelbase / 2),
    b = trackPose(at + wheelbase / 2);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: Math.atan2(b.z - a.z, b.x - a.x) };
}
export function localPoint(p: Point & { yaw?: number }, x: number, z: number): Point {
  const c = Math.cos(p.yaw || 0),
    s = Math.sin(p.yaw || 0);
  return { x: p.x + c * x - s * z, z: p.z + s * x + c * z };
}
export function deliveryKind(o: Pick<Order, 'item' | 'mode'> & { commute?: Order['commute'] }) {
  if (o.commute) return 'bus';
  if (o.mode === 'rail') return 'rail';
  if (['builder', 'operator', 'engineer'].includes(o.item)) return 'bus';
  if (['excavator', 'forklift'].includes(o.item)) return 'lowloader';
  if (['power', 'water'].includes(o.item)) return 'service';
  return 'truck';
}
// Right-hand public-road lanes and the two-way crossing remain separate from
// the freight berths. A stopped material delivery cannot block a worker bus.
export const ROAD_CENTER_Z = -13;
export const ROAD_WIDTH = 8.4;
export const EASTBOUND_LANE_Z = -10.9;
export const WESTBOUND_LANE_Z = -15.1;
export const INBOUND_GATE_X = -10.1;
export const OUTBOUND_GATE_X = -5.9;
export const ROAD_ROUTE_VERSION = 4;
export const berth = (o: Pick<Order, 'item' | 'mode'>) => {
  const k = deliveryKind(o);
  return k === 'rail'
    ? { x: 56, z: 5, yaw: 0 }
    : k === 'bus'
      ? { x: -30, z: EASTBOUND_LANE_Z, yaw: 0 }
      : k === 'lowloader'
        ? { x: INBOUND_GATE_X, z: 38, yaw: Math.PI / 2 }
        : k === 'service'
          ? { x: 5, z: 22, yaw: 0 }
          : { x: 20, z: 18, yaw: 0 };
};
type RoadPoint = Point & { reverse?: boolean };
type RoadSegment = {
  a: RoadPoint;
  b: RoadPoint;
  start: number;
  end: number;
  reverse: boolean;
  yaw: number;
  wheelStart: number;
};
type RoadRoute = {
  points: RoadPoint[];
  segments: RoadSegment[];
  berth: number;
  end: number;
  stops: number[];
};
const roadRoutes = new Map<string, RoadRoute>();
function roadRoute(o: Pick<Order, 'item' | 'mode'>): RoadRoute {
  const kind = deliveryKind(o),
    cached = roadRoutes.get(kind);
  if (cached) return cached;
  const points: RoadPoint[] = [{ x: -100, z: EASTBOUND_LANE_Z }],
    segments: RoadSegment[] = [],
    stops: number[] = [];
  let total = 0,
    wheels = 0;
  const add = (x: number, z: number, reverse = false) => {
    const a = points[points.length - 1],
      b = { x, z, reverse },
      length = Math.hypot(x - a.x, z - a.z);
    if (length < 1e-7) return;
    segments.push({
      a,
      b,
      start: total,
      end: total + length,
      reverse,
      yaw: Math.atan2(z - a.z, x - a.x) + (reverse ? Math.PI : 0),
      wheelStart: wheels,
    });
    total += length;
    wheels += length * (reverse ? -1 : 1);
    points.push(b);
  };
  const arc = (cx: number, cz: number, r: number, start: number, end: number, reverse = false) => {
    const count = Math.max(24, Math.ceil((Math.abs(end - start) * r) / 0.35));
    for (let i = 1; i <= count; i++) {
      const a = start + ((end - start) * i) / count;
      add(cx + r * Math.cos(a), cz + r * Math.sin(a), reverse);
    }
  };
  if (kind === 'bus') add(-30, EASTBOUND_LANE_Z);
  else {
    // An eight-meter turn enters the inbound (west) half of the crossing.
    add(-18.1, EASTBOUND_LANE_Z);
    arc(-18.1, -2.9, 8, -Math.PI / 2, 0);
    if (kind === 'lowloader') add(INBOUND_GATE_X, berth(o).z);
    else {
      const bay = berth(o);
      add(INBOUND_GATE_X, bay.z - 8);
      arc(-2.1, bay.z - 8, 8, Math.PI, Math.PI / 2);
      add(bay.x, bay.z);
    }
  }
  const atBerth = total;
  stops.push(atBerth);
  if (kind === 'bus') {
    // Passengers alight on the curb side; the bus keeps its forward direction.
    add(280, EASTBOUND_LANE_Z);
  } else {
    if (kind === 'lowloader') {
      // The empty carrier makes a forward loop in the western maneuver area.
      add(INBOUND_GATE_X, 42);
      arc(-18.1, 42, 8, 0, Math.PI);
      add(-26.1, 34);
      arc(-18.1, 34, 8, Math.PI, Math.PI * 1.5);
      add(-13.9, 26);
      arc(-13.9, 18, 8, Math.PI / 2, 0);
    } else {
      // Back only within the receiving apron, into the north-facing exit aisle.
      // A full stop follows this maneuver before selecting forward gear.
      const bay = berth(o);
      let departureZ = bay.z;
      if (kind === 'truck') {
        // Ease two meters toward the open yard before turning. The nose of a
        // long truck otherwise sweeps across the utility cabinets north of the
        // unloading apron even though its centerline clears them.
        const angle = Math.acos(1 - 2 / 16),
          endX = 12 - 16 * Math.sin(angle);
        add(12, bay.z, true);
        arc(12, bay.z + 8, 8, -Math.PI / 2, -Math.PI / 2 - angle, true);
        arc(endX, bay.z - 6, 8, Math.PI / 2 - angle, Math.PI / 2, true);
        departureZ += 2;
      }
      add(2.1, departureZ, true);
      arc(2.1, departureZ + 8, 8, -Math.PI / 2, -Math.PI, true);
      stops.push(total);
    }
    add(OUTBOUND_GATE_X, -7.1);
    arc(-13.9, -7.1, 8, 0, -Math.PI / 2);
    add(-100, WESTBOUND_LANE_Z);
  }
  const result = { points, segments, berth: atBerth, end: total, stops };
  roadRoutes.set(kind, result);
  return result;
}
export function roadPath(o: Pick<Order, 'item' | 'mode'>): Point[] {
  return roadRoute(o).points.map((p) => ({ ...p }));
}
function roadSegment(o: Pick<Order, 'item' | 'mode'>, at: number) {
  const r = roadRoute(o),
    distance = Math.max(0, Math.min(r.end, at));
  return {
    segment: r.segments.find((s) => distance < s.end - 1e-8) || r.segments[r.segments.length - 1],
    distance,
  };
}
export function roadSurfaceHeight(p: Point) {
  if (p.x < -12.25 || p.x > -3.75 || p.z < -5 || p.z > 10) return 0;
  const ramp = p.z < -2 ? smoothstep((p.z + 5) / 3) : p.z > 7 ? 1 - smoothstep((p.z - 7) / 3) : 1;
  return 0.325 * ramp;
}
export function deckPose(
  p: Point & { yaw: number; y?: number; pitch?: number },
  x = -1.5,
  y = 0.82,
) {
  const pitch = p.pitch || 0,
    position = localPoint(p, x * Math.cos(pitch) - y * Math.sin(pitch), 0);
  return {
    ...position,
    y: (p.y || 0) + x * Math.sin(pitch) + y * Math.cos(pitch),
    yaw: p.yaw,
    pitch,
  };
}
export function sampleRoad(o: Pick<Order, 'item' | 'mode'>, at: number) {
  const { segment: s, distance } = roadSegment(o, at),
    t = Math.max(0, Math.min(1, (distance - s.start) / (s.end - s.start)));
  const p = {
    x: s.a.x + (s.b.x - s.a.x) * t,
    z: s.a.z + (s.b.z - s.a.z) * t,
    yaw: s.yaw,
    reverse: s.reverse,
  };
  const low = deliveryKind(o) === 'lowloader',
    front = low ? 4.3 : 3.2,
    rear = low ? -4.1 : -3.05;
  const f = roadSurfaceHeight(localPoint(p, front, 0)),
    r = roadSurfaceHeight(localPoint(p, rear, 0));
  const pitch = Math.atan2(f - r, front - rear),
    y = f + 0.5 * (1 - Math.cos(pitch)) - front * Math.sin(pitch);
  return { ...p, y, pitch };
}
/** Arrival distance is kept separate from the complete route for old callers. */
export function roadLength(o: Pick<Order, 'item' | 'mode'>) {
  return roadRoute(o).berth;
}
export function roadExitLength(o: Pick<Order, 'item' | 'mode'>) {
  return roadRoute(o).end;
}
export function roadStopDistances(o: Pick<Order, 'item' | 'mode'>) {
  return [...roadRoute(o).stops];
}
export function roadWheelTravel(o: Pick<Order, 'item' | 'mode'>, at: number) {
  const { segment: s, distance } = roadSegment(o, at);
  return s.wheelStart + (distance - s.start) * (s.reverse ? -1 : 1);
}
