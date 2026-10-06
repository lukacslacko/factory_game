import type { State } from './types';
import type { RailLocationAnchor } from './rail-locations';
import {
  sidingAccessSpans,
  mainlineExitCommissioned,
  trackGeometry,
  type TrackPath,
  type TrackPoint,
  type TrackRoute,
} from './track';
import { bufferAssets } from './buffers';

export type RailAnchor = Pick<RailLocationAnchor, 'trackId' | 'route' | 'offset'>;
export interface RailRouteSegment {
  trackId: string;
  route: TrackRoute;
  from: number;
  to: number;
  start: number;
  length: number;
}
export interface RailRoute {
  points: TrackPoint[];
  length: number;
  tracks: string[];
  switches: { id: string; route: TrackRoute }[];
  segments: RailRouteSegment[];
}
interface Edge {
  trackId: string;
  path: TrackPath;
  switchId?: string;
}
const EPS = 1e-4;
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
const gap = (a: TrackPoint, b: TrackPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const key = (p: TrackPoint) => `${Math.round(p.x / EPS)},${Math.round(p.z / EPS)}`;
function stations(points: TrackPoint[]) {
  const result = [0];
  for (let i = 1; i < points.length; i++)
    result.push(result[i - 1] + gap(points[i - 1], points[i]));
  return result;
}
function atPath(path: TrackPath, offset: number): TrackPoint {
  const ds = stations(path.points),
    total = ds.at(-1)!;
  const at = (Math.max(0, Math.min(path.length, offset)) / path.length) * total;
  return sampleRailRoute(path.points, at);
}
/** Sample distance along the actual rendered polyline; angles use the short arc. */
export function sampleRailRoute(points: TrackPoint[], at: number): TrackPoint {
  if (!points.length) throw new Error('Cannot sample an empty railway route');
  let left = Math.max(0, at);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      length = gap(a, b);
    if (left > length + EPS) {
      left -= length;
      continue;
    }
    const t = length ? Math.min(1, left / length) : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: angle(a.yaw + angle(b.yaw - a.yaw) * t),
    };
  }
  return { ...points.at(-1)! };
}
function slice(path: TrackPath, from: number, to: number) {
  const raw = stations(path.points),
    ds = raw.map((d) => (d * path.length) / raw.at(-1)!);
  const inner = path.points.filter(
    (_, i) => ds[i] > Math.min(from, to) + EPS && ds[i] < Math.max(from, to) - EPS,
  );
  const result = [atPath(path, from), ...(from < to ? inner : inner.reverse()), atPath(path, to)];
  return from <= to ? result : result.map((p) => ({ ...p, yaw: angle(p.yaw + Math.PI) }));
}
/** The pre-existing protected switch is real track geometry, rather than a
 * connectivity-only shortcut between the main line and receiving siding. */
export function routingEdges(s: State): Edge[] {
  const starterBranch = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100;
    return {
      x: 25 * t,
      z: 5 * (3 * t * t - 2 * t * t * t),
      yaw: Math.atan2(5 * (6 * t - 6 * t * t), 25),
    };
  });
  return [
    {
      trackId: 'BOOTSTRAP-MAINLINE',
      path: {
        route: 'straight',
        length: 780,
        points: [
          { x: -260, z: 0, yaw: 0 },
          { x: 520, z: 0, yaw: 0 },
        ],
      },
    },
    {
      trackId: 'BOOTSTRAP-SWITCH',
      switchId: 'BOOTSTRAP-SWITCH',
      path: {
        route: 'branch',
        length: stations(starterBranch).at(-1)!,
        points: starterBranch,
      },
    },
    {
      trackId: 'BOOTSTRAP-SIDING',
      path: {
        route: 'straight',
        length: 100,
        points: [
          { x: 25, z: 5, yaw: 0 },
          { x: 125, z: 5, yaw: 0 },
        ],
      },
    },
    ...s.rails.flatMap((r) =>
      trackGeometry(r).paths.map((path) => ({
        trackId: r.id,
        path,
        ...(r.track?.layout === 'turnout' && r.track.section === 0 ? { switchId: r.id } : {}),
      })),
    ),
  ];
}
export function railAnchorPose(s: State, anchor: RailAnchor): TrackPoint | undefined {
  const edge = routingEdges(s).find(
    (e) => e.trackId === anchor.trackId && e.path.route === anchor.route,
  );
  if (
    !edge ||
    !Number.isFinite(anchor.offset) ||
    anchor.offset < -EPS ||
    anchor.offset > edge.path.length + EPS
  )
    return;
  if (
    anchor.trackId === 'BOOTSTRAP-SIDING' &&
    sidingAccessSpans(s).some(
      (a) => a.complete && 25 + anchor.offset > a.x + EPS && 25 + anchor.offset < a.end - EPS,
    )
  )
    return;
  if (
    anchor.trackId === 'BOOTSTRAP-MAINLINE' &&
    mainlineExitCommissioned(s) &&
    anchor.offset > 385 + EPS &&
    anchor.offset < 405 - EPS
  )
    return;
  return atPath(edge.path, anchor.offset);
}
function assembled(steps: { edge: Edge; from: number; to: number }[]): RailRoute {
  const result: RailRoute = { points: [], length: 0, tracks: [], switches: [], segments: [] };
  for (const step of steps) {
    const points = slice(step.edge.path, step.from, step.to),
      length = Math.abs(step.to - step.from);
    result.segments.push({
      trackId: step.edge.trackId,
      route: step.edge.path.route,
      from: step.from,
      to: step.to,
      start: result.length,
      length,
    });
    result.points.push(...(result.points.length ? points.slice(1) : points));
    result.length += length;
    if (!result.tracks.includes(step.edge.trackId)) result.tracks.push(step.edge.trackId);
    if (step.edge.switchId && !result.switches.some((v) => v.id === step.edge.switchId))
      result.switches.push({ id: step.edge.switchId, route: step.edge.path.route });
  }
  return result;
}
export function anchorAtRailRoute(
  s: State,
  route: RailRoute,
  at: number,
): RailLocationAnchor | undefined {
  const clamped = Math.max(0, Math.min(route.length, at));
  const segment =
    route.segments.find((v) => clamped <= v.start + v.length + EPS) || route.segments.at(-1);
  if (!segment) return;
  const offset =
    segment.from +
    Math.sign(segment.to - segment.from) *
      Math.min(segment.length, Math.max(0, clamped - segment.start));
  const anchor = { trackId: segment.trackId, route: segment.route, offset },
    point = railAnchorPose(s, anchor);
  return point ? { ...anchor, point } : undefined;
}
interface Arc {
  edge: Edge;
  from: number;
  to: number;
  a: TrackPoint;
  b: TrackPoint;
}
/** Resolve a continuous route. We can set points for the returned route, but
 * never turn a train around at a joint or infer connectivity from crossings. */
export interface RailRoutingOptions {
  /** The caller can exclude arcs occupied by rolling stock without coupling
   * rail geometry to traffic or freight ownership. Samples are at most 0.5 m apart. */
  allowArc?: (points: TrackPoint[]) => boolean;
  /** Reserved for recovery planning; ordinary train operations retain stops. */
  noBuffers?: boolean;
}
export function railRoute(
  s: State,
  from: RailAnchor,
  to: RailAnchor,
  options: RailRoutingOptions = {},
): RailRoute | undefined {
  const all = routingEdges(s),
    fromPose = railAnchorPose(s, from),
    toPose = railAnchorPose(s, to);
  if (!fromPose || !toPose) return;
  if (
    from.trackId === to.trackId &&
    from.route === to.route &&
    Math.abs(from.offset - to.offset) < EPS
  ) {
    const edge = all.find((e) => e.trackId === from.trackId && e.path.route === from.route)!;
    if (options.allowArc && !options.allowArc([fromPose])) return;
    return assembled([{ edge, from: from.offset, to: to.offset }]);
  }
  const fromEdge = all.find((e) => e.trackId === from.trackId && e.path.route === from.route)!,
    toEdge = all.find((e) => e.trackId === to.trackId && e.path.route === to.route)!;
  const externalYaw = (edge: Edge, anchor: RailAnchor, point: TrackPoint) =>
    Math.abs(anchor.offset) < EPS
      ? angle(point.yaw + Math.PI)
      : Math.abs(anchor.offset - edge.path.length) < EPS
        ? point.yaw
        : undefined;
  const sidingExternal = (anchor: RailAnchor, p: TrackPoint) =>
    anchor.trackId === 'BOOTSTRAP-SIDING'
      ? sidingAccessSpans(s)
          .filter((a) => a.complete)
          .flatMap((a) =>
            Math.abs(p.x - a.x) < EPS
              ? [p.yaw]
              : Math.abs(p.x - a.end) < EPS
                ? [angle(p.yaw + Math.PI)]
                : [],
          )[0]
      : undefined;
  const fromExternal = externalYaw(fromEdge, from, fromPose) ?? sidingExternal(from, fromPose),
    toExternal = externalYaw(toEdge, to, toPose) ?? sidingExternal(to, toPose);
  const access = sidingAccessSpans(s).filter((a) => a.complete);
  const arcs: Arc[] = [];
  const mainSplits = all
    .flatMap((e) => [e.path.points[0], e.path.points.at(-1)!])
    .filter((p) => Math.abs(p.z) < EPS && Math.abs(Math.sin(p.yaw)) < EPS)
    .map((p) => p.x + 260);
  for (const edge of all) {
    const cuts = [0, edge.path.length];
    if (edge.trackId === 'BOOTSTRAP-MAINLINE') {
      cuts.push(...mainSplits);
      if (mainlineExitCommissioned(s)) cuts.push(385, 405);
    }
    if (edge.trackId === 'BOOTSTRAP-SIDING')
      cuts.push(...access.flatMap((a) => [a.x - 25, a.end - 25]));
    for (const anchor of [from, to])
      if (anchor.trackId === edge.trackId && anchor.route === edge.path.route)
        cuts.push(anchor.offset);
    const sorted = cuts
      .filter((d) => d >= 0 && d <= edge.path.length)
      .sort((a, b) => a - b)
      .filter((v, i, list) => !i || Math.abs(v - list[i - 1]) > EPS);
    for (let i = 1; i < sorted.length; i++)
      for (const reverse of [false, true]) {
        const start = sorted[reverse ? i : i - 1],
          end = sorted[reverse ? i - 1 : i];
        if (
          edge.trackId === 'BOOTSTRAP-SIDING' &&
          access.some((a) => 25 + (start + end) / 2 > a.x && 25 + (start + end) / 2 < a.end)
        )
          continue;
        if (
          edge.trackId === 'BOOTSTRAP-MAINLINE' &&
          mainlineExitCommissioned(s) &&
          (start + end) / 2 > 385 &&
          (start + end) / 2 < 405
        )
          continue;
        const points = slice(edge.path, start, end);
        if (options.allowArc) {
          const dense = [points[0]];
          for (let index = 1; index < points.length; index++) {
            const a = points[index - 1],
              b = points[index],
              steps = Math.max(1, Math.ceil(gap(a, b) / 0.5));
            for (let step = 1; step <= steps; step++) {
              const t = step / steps;
              dense.push({
                x: a.x + (b.x - a.x) * t,
                z: a.z + (b.z - a.z) * t,
                yaw: angle(a.yaw + angle(b.yaw - a.yaw) * t),
              });
            }
          }
          if (!options.allowArc(dense)) continue;
        }
        // A secured stop forbids traversing its position, including a joint.
        if (
          !options.noBuffers &&
          bufferAssets(s).some((b) => {
            if (
              !b.secured ||
              b.carried ||
              Math.hypot(b.x - fromPose.x, b.z - fromPose.z) < EPS ||
              Math.hypot(b.x - toPose.x, b.z - toPose.z) < EPS
            )
              return false;
            return points.slice(1).some((q, i) => {
              const p = points[i],
                dx = q.x - p.x,
                dz = q.z - p.z,
                d2 = dx * dx + dz * dz;
              const t = d2
                ? Math.max(0, Math.min(1, ((b.x - p.x) * dx + (b.z - p.z) * dz) / d2))
                : 0;
              return Math.hypot(p.x + dx * t - b.x, p.z + dz * t - b.z) < 0.12;
            });
          })
        )
          continue;
        arcs.push({ edge, from: start, to: end, a: points[0], b: points.at(-1)! });
      }
  }
  const outgoing = new Map<string, Arc[]>();
  for (const arc of arcs) outgoing.set(key(arc.a), [...(outgoing.get(key(arc.a)) || []), arc]);
  const queue: { point: TrackPoint; yaw?: number; length: number; steps: Arc[] }[] = [
    { point: fromPose, length: 0, steps: [] },
  ];
  const visited = new Map<string, number>();
  while (queue.length) {
    queue.sort((a, b) => a.length - b.length);
    const state = queue.shift()!;
    const last = state.steps.at(-1);
    const onTarget =
      last &&
      ((last.edge === toEdge && Math.abs(last.to - to.offset) < EPS) ||
        (toExternal !== undefined &&
          Math.abs(Math.abs(angle(last.b.yaw - toExternal)) - Math.PI) < 0.02) ||
        (to.trackId === 'BOOTSTRAP-MAINLINE' &&
          Math.abs(Math.sin(last.b.yaw - toPose.yaw)) < 0.02));
    if (gap(state.point, toPose) < EPS && onTarget) return assembled(state.steps);
    const stateKey = `${key(state.point)}:${state.yaw === undefined ? '*' : Math.round(angle(state.yaw) / EPS)}`;
    if ((visited.get(stateKey) ?? Infinity) <= state.length) continue;
    visited.set(stateKey, state.length);
    for (const arc of outgoing.get(key(state.point)) || []) {
      if (
        !state.steps.length &&
        !(
          (arc.edge === fromEdge && Math.abs(arc.from - from.offset) < EPS) ||
          (fromExternal !== undefined && Math.abs(angle(arc.a.yaw - fromExternal)) < 0.02) ||
          (from.trackId === 'BOOTSTRAP-MAINLINE' &&
            Math.abs(Math.sin(arc.a.yaw - fromPose.yaw)) < 0.02)
        )
      )
        continue;
      if (state.yaw !== undefined && Math.abs(angle(arc.a.yaw - state.yaw)) > 0.02) continue;
      queue.push({
        point: arc.b,
        yaw: arc.b.yaw,
        length: state.length + Math.abs(arc.to - arc.from),
        steps: [...state.steps, arc],
      });
    }
  }
}
/** Extend a parked consist through a unique tangent run. Forks need an
 * explicit destination route; this helper intentionally never guesses. */
export function railInterval(
  s: State,
  anchor: RailAnchor,
  before: number,
  after: number,
): RailRoute | undefined {
  const all = routingEdges(s),
    initial = all.find((e) => e.trackId === anchor.trackId && e.path.route === anchor.route);
  if (!initial || !railAnchorPose(s, anchor) || before < 0 || after < 0) return;
  const access = sidingAccessSpans(s).filter((a) => a.complete);
  function walk(direction: 1 | -1, amount: number) {
    let edge = initial!,
      at = anchor.offset,
      remaining = amount;
    const steps: { edge: Edge; from: number; to: number }[] = [],
      seen = new Set<string>();
    while (remaining > EPS) {
      const id = `${edge.trackId}:${edge.path.route}:${direction}:${at.toFixed(4)}`;
      if (seen.has(id)) return;
      seen.add(id);
      let available = direction > 0 ? edge.path.length - at : at;
      if (edge.trackId === 'BOOTSTRAP-SIDING') {
        const boundary = access
          .flatMap((a) => [a.x - 25, a.end - 25])
          .filter((v) => (direction > 0 ? v >= at - EPS : v <= at + EPS))
          .sort((a, b) => direction * (a - b))
          .find((v) =>
            access.some((a) =>
              direction > 0 ? Math.abs(v - (a.x - 25)) < EPS : Math.abs(v - (a.end - 25)) < EPS,
            ),
          );
        if (boundary !== undefined)
          available = Math.min(available, Math.max(0, direction * (boundary - at)));
      }
      if (edge.trackId === 'BOOTSTRAP-MAINLINE' && mainlineExitCommissioned(s)) {
        const boundary = direction > 0 ? 385 : 405;
        if (direction * (boundary - at) >= -EPS)
          available = Math.min(available, Math.max(0, direction * (boundary - at)));
      }
      const use = Math.min(remaining, available),
        end = at + direction * use;
      if (use > EPS) steps.push({ edge, from: at, to: end });
      remaining -= use;
      if (remaining <= EPS) return steps;
      const p = atPath(edge.path, end),
        yaw = angle(p.yaw + (direction < 0 ? Math.PI : 0));
      const candidates = all
        .filter((e) => e !== edge)
        .flatMap((e) =>
          ([1, -1] as const).flatMap((dir) => {
            const offset =
              e.trackId === 'BOOTSTRAP-MAINLINE' && Math.abs(p.z) < EPS
                ? p.x + 260
                : e.trackId === 'BOOTSTRAP-SIDING' &&
                    Math.abs(p.z - 5) < EPS &&
                    access.some((a) =>
                      dir < 0 ? Math.abs(p.x - a.x) < EPS : Math.abs(p.x - a.end) < EPS,
                    )
                  ? p.x - 25
                  : dir > 0
                    ? 0
                    : e.path.length;
            if (
              e.trackId === 'BOOTSTRAP-MAINLINE' &&
              mainlineExitCommissioned(s) &&
              ((offset >= 385 - EPS && offset < 405 - EPS && dir > 0) ||
                (offset > 385 + EPS && offset <= 405 + EPS && dir < 0))
            )
              return [];
            const q = atPath(e.path, offset),
              travelYaw = angle(q.yaw + (dir < 0 ? Math.PI : 0));
            return gap(p, q) < EPS && Math.abs(angle(yaw - travelYaw)) < 0.02
              ? [{ edge: e, dir, offset }]
              : [];
          }),
        );
      if (candidates.length !== 1) return;
      edge = candidates[0].edge;
      direction = candidates[0].dir;
      at = candidates[0].offset;
    }
    return steps;
  }
  const left = walk(-1, before),
    right = walk(1, after);
  if (!left || !right) return;
  return assembled([...left.reverse().map((v) => ({ ...v, from: v.to, to: v.from })), ...right]);
}
