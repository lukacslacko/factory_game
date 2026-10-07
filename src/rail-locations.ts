import type { Point, RailLocation, State } from './types';
import {
  portsConnect,
  sidingAccessSpans,
  trackGeometry,
  trackNetwork,
  type TrackPath,
  type TrackPoint,
  type TrackNetwork,
} from './track';

export const RAIL_LOCATION_KINDS = ['loading', 'unloading', 'transfer', 'parking'] as const;
const EPS = 1e-5;
interface Edge {
  base?: number;
  trackId: string;
  path: TrackPath;
}
export interface RailLocationAnchor {
  trackId: string;
  route: 'straight' | 'branch';
  offset: number;
  point: TrackPoint;
}
function edges(s: State): Edge[] {
  return [
    ...(() => {
      const spans = sidingAccessSpans(s)
          .filter((a) => a.complete)
          .sort((a, b) => a.x - b.x),
        intervals: { from: number; to: number }[] = [];
      let at = 25;
      for (const span of spans) {
        if (span.x > at) intervals.push({ from: at, to: span.x });
        at = span.end;
      }
      if (at < 125) intervals.push({ from: at, to: 125 });
      return intervals.map((v) => ({
        trackId: 'BOOTSTRAP-SIDING',
        base: v.from - 25,
        path: {
          route: 'straight' as const,
          length: v.to - v.from,
          points: [
            { x: v.from, z: 5, yaw: 0 },
            { x: v.to, z: 5, yaw: 0 },
          ],
        },
      }));
    })(),
    ...s.rails.flatMap((r) => trackGeometry(r).paths.map((path) => ({ trackId: r.id, path }))),
  ];
}
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
/** Normalize sampled chord distances to the shared geometry's analytical arc length. */
function stations(path: TrackPath): number[] {
  const raw = [0];
  for (let i = 1; i < path.points.length; i++)
    raw.push(raw[i - 1] + distance(path.points[i - 1], path.points[i]));
  const scale = path.length / raw.at(-1)!;
  return raw.map((d) => d * scale);
}
function pose(path: TrackPath, offset: number): TrackPoint {
  const d = stations(path);
  for (let i = 1; i < d.length; i++) {
    if (offset > d[i] + EPS) continue;
    const t = Math.max(0, Math.min(1, (offset - d[i - 1]) / (d[i] - d[i - 1])));
    const a = path.points[i - 1],
      b = path.points[i];
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: angle(a.yaw + angle(b.yaw - a.yaw) * t),
    };
  }
  return { ...path.points.at(-1)! };
}
function segment(path: TrackPath, from: number, to: number): TrackPoint[] {
  const d = stations(path),
    forward = from <= to;
  const inner = path.points.filter(
    (_, i) => d[i] > Math.min(from, to) + EPS && d[i] < Math.max(from, to) - EPS,
  );
  return [pose(path, from), ...(forward ? inner : inner.reverse()), pose(path, to)];
}
function edgeFor(s: State, l: Pick<RailLocation, 'trackId' | 'route'>) {
  return edges(s).find(
    (e) =>
      e.trackId === l.trackId &&
      e.path.route === l.route &&
      (!('offset' in l) ||
        typeof l.offset !== 'number' ||
        (l.offset >= (e.base || 0) - EPS && l.offset <= (e.base || 0) + e.path.length + EPS)),
  );
}
export function railLocationPose(s: State, l: RailLocation): TrackPoint | undefined {
  const edge = edgeFor(s, l);
  if (
    !edge ||
    !Number.isFinite(l.offset) ||
    l.offset < (edge.base || 0) ||
    l.offset > (edge.base || 0) + edge.path.length + EPS
  )
    return;
  return pose(edge.path, l.offset - (edge.base || 0));
}
export function nearestRailLocationAnchor(
  s: State,
  p: Point,
  maximum = 3,
): RailLocationAnchor | undefined {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(maximum) || maximum < 0)
    return;
  let best: RailLocationAnchor | undefined,
    closest = maximum + EPS;
  for (const e of edges(s)) {
    const d = stations(e.path);
    for (let i = 1; i < e.path.points.length; i++) {
      const a = e.path.points[i - 1],
        b = e.path.points[i],
        dx = b.x - a.x,
        dz = b.z - a.z;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)),
      );
      const offset = d[i - 1] + (d[i] - d[i - 1]) * t,
        point = pose(e.path, offset),
        gap = distance(p, point);
      if (gap >= closest) continue;
      closest = gap;
      best = { trackId: e.trackId, route: e.path.route, offset: offset + (e.base || 0), point };
    }
  }
  return best;
}
function walk(
  all: Edge[],
  start: Edge,
  offset: number,
  direction: 1 | -1,
  length: number,
): TrackPoint[] | undefined {
  let edge = start,
    at = offset,
    remaining = length;
  const visited = new Set<string>(),
    points: TrackPoint[] = [];
  while (remaining > EPS) {
    const key = `${edge.trackId}:${edge.path.route}:${direction}`;
    if (visited.has(key)) return;
    visited.add(key);
    const available = direction > 0 ? edge.path.length - at : at;
    const used = Math.min(remaining, available),
      end = at + direction * used;
    const slice = segment(edge.path, at, end);
    points.push(...(points.length ? slice.slice(1) : slice));
    remaining -= used;
    if (remaining <= EPS) return points;
    const last = pose(edge.path, end);
    const port = {
      ...last,
      yaw: angle(last.yaw + (direction < 0 ? Math.PI : 0)),
      route: edge.path.route,
      end: direction > 0 ? ('exit' as const) : ('entry' as const),
    };
    const candidates = all
      .filter((e) => e.trackId !== edge.trackId)
      .flatMap((e) =>
        ([1, -1] as const).flatMap((dir) => {
          const incoming = dir > 0 ? e.path.points[0] : e.path.points.at(-1)!;
          const opposing = {
            ...incoming,
            yaw: angle(incoming.yaw + (dir > 0 ? Math.PI : 0)),
            route: e.path.route,
            end: dir > 0 ? ('entry' as const) : ('exit' as const),
          };
          return portsConnect(port, opposing) ? [{ edge: e, direction: dir }] : [];
        }),
      );
    // Never guess a route through a fork. Designate a shorter interval on one side.
    if (candidates.length !== 1) return;
    edge = candidates[0].edge;
    direction = candidates[0].direction;
    at = direction > 0 ? 0 : edge.path.length;
  }
  return points;
}
export function railLocationPath(s: State, l: RailLocation): TrackPoint[] | undefined {
  if (!railLocationPose(s, l) || !Number.isFinite(l.length) || l.length < 1 || l.length > 200)
    return;
  const all = edges(s),
    edge = edgeFor(s, l)!;
  const before = walk(all, edge, l.offset - (edge.base || 0), -1, l.length / 2);
  const after = walk(all, edge, l.offset - (edge.base || 0), 1, l.length / 2);
  if (!before || !after) return;
  return [...before.reverse(), ...after.slice(1)];
}
export function railLocationStatus(
  s: State,
  l: RailLocation,
  network?: TrackNetwork,
): { connected: boolean; valid: boolean; reason: string } {
  if (!edgeFor(s, l))
    return {
      connected: false,
      valid: false,
      reason: 'Referenced rail is missing or was recovered. Reposition this location.',
    };
  const connected =
    (network || trackNetwork(s)).panels.find((p) => p.id === l.trackId)?.connected === true;
  if (!railLocationPose(s, l))
    return {
      connected,
      valid: false,
      reason: 'Anchor distance no longer fits its rail path. Reposition this location.',
    };
  if (!railLocationPath(s, l))
    return {
      connected,
      valid: false,
      reason:
        'Usable length crosses an open end, missing panel or ambiguous junction. Shorten or reposition the interval.',
    };
  return {
    connected,
    valid: true,
    reason: connected
      ? ['unloading', 'transfer'].includes(l.kind)
        ? 'Supplier reception is available here when the complete train fits this interval.'
        : 'Designated on connected rail. Shunt cars here when the complete consist fits the interval and its route is clear.'
      : 'Designated rail is disconnected from the starter siding. Complete its physical rail connections.',
  };
}
/** Structural import checks retain genuine orphans after track recovery. */
export function validRailLocation(s: State, value: unknown): value is RailLocation {
  if (!value || typeof value !== 'object') return false;
  const l = value as RailLocation;
  if (
    typeof l.id !== 'string' ||
    !l.id ||
    typeof l.name !== 'string' ||
    l.name !== l.name.trim() ||
    !l.name.length ||
    l.name.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(l.name) ||
    !RAIL_LOCATION_KINDS.includes(l.kind) ||
    typeof l.trackId !== 'string' ||
    !l.trackId ||
    l.trackId === 'BOOTSTRAP-MAINLINE' ||
    !['straight', 'branch'].includes(l.route) ||
    !Number.isFinite(l.offset) ||
    l.offset < 0 ||
    l.offset > 10000 ||
    !Number.isFinite(l.length) ||
    l.length < 1 ||
    l.length > 200
  )
    return false;
  const known = l.trackId === 'BOOTSTRAP-SIDING' || s.rails.some((r) => r.id === l.trackId);
  return !known || !!railLocationPose(s, l);
}
function record(s: State, l: RailLocation, text: string) {
  s.events.push({
    id: `EV-${String(s.next++).padStart(4, '0')}`,
    time: s.time,
    type: 'Railway',
    entity: l.id,
    text,
  });
  s.revision++;
}
export function saveRailLocation(
  s: State,
  input: Omit<RailLocation, 'id'> & { id?: string },
): string | undefined {
  const previous = input.id ? s.railLocations?.find((l) => l.id === input.id) : undefined;
  if (input.id && !previous) return 'Rail location no longer exists.';
  if (
    previous &&
    s.orders.some(
      (o) =>
        o.railFreight?.receptionLocationId === previous.id &&
        !['ordered', 'done'].includes(o.status),
    )
  )
    return 'A train is using this receiving point. Wait until it leaves before editing the interval.';
  const candidate: RailLocation = {
    ...input,
    id: previous?.id || 'new-location',
    name: typeof input.name === 'string' ? input.name.trim() : input.name,
  };
  if (!validRailLocation(s, candidate))
    return 'Use a name of 1–64 characters, a valid rail route/distance and a length of 1–200 m.';
  if (
    (s.railLocations || []).some(
      (l) =>
        l.id !== previous?.id &&
        l.name.toLocaleLowerCase('en-US') === candidate.name.toLocaleLowerCase('en-US'),
    )
  )
    return 'Rail location names must be unique (ignoring case).';
  if (!edgeFor(s, candidate))
    return 'Choose an installed factory rail path, not planned track or the protected main line.';
  if (!railLocationPath(s, candidate))
    return 'Usable length must fit a continuous installed rail interval; it cannot cross an open end, gap or ambiguous junction.';
  if (!previous && (s.railLocations?.length || 0) >= 512)
    return 'The yard supports up to 512 named rail locations.';
  if (previous) Object.assign(previous, candidate);
  else {
    candidate.id = `RLOC-${String(s.next++).padStart(4, '0')}`;
    (s.railLocations ??= []).push(candidate);
  }
  record(
    s,
    candidate,
    `${previous ? 'Updated' : 'Designated'} ${candidate.name}: ${candidate.kind}, ${candidate.length} m centered at ${candidate.trackId}/${candidate.route} +${candidate.offset.toFixed(2)} m.`,
  );
}
export function removeRailLocation(s: State, id: string): string | undefined {
  const l = s.railLocations?.find((l) => l.id === id);
  if (!l) return 'Rail location no longer exists.';
  if (s.shunters?.some((e) => e.locationId === id || e.destinationId === id))
    return 'An owned shunter uses this point. Move or reassign it before removing the designation.';
  if (s.orders.some((o) => o.railFreight?.cars.some((c) => !c.returned && c.locationId === id)))
    return 'Freight cars occupy this point. Move or return them before removing the designation.';
  if (s.orders.some((o) => o.status !== 'done' && o.railFreight?.receptionLocationId === id))
    return 'This point is assigned to an incoming or active freight train. Change its destination or wait until it leaves.';
  s.railLocations = s.railLocations!.filter((l) => l.id !== id);
  record(s, l, `Removed designation ${l.name}; the physical rail is retained.`);
}
