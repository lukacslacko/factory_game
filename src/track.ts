import type { Job, Point, Rail, Rect, State } from './types';

/** Heading 0 points east (+X); headings increase toward +Z. Hand +1 bends
 * toward +Z in this local frame. Origin is the grid-aligned macro entrance,
 * shared by every physical section of that curve or turnout. */
export interface TrackPiece {
  layout: 'straight' | 'curve' | 'turnout';
  origin: Point;
  heading: 0 | 1 | 2 | 3;
  hand: 1 | -1;
  section: number;
  groupId?: string;
  /** Turnout sections 1–3 are separately transported straight/branch rails.
   * Section 0 alone is the combined, narrow points assembly. */
  route?: TrackRoute;
  /** Reverses the construction traversal; the purchased turnout geometry stays unchanged. */
  flow?: 'converging';
}
export type TrackRoute = 'straight' | 'branch';
export interface TrackPoint extends Point {
  yaw: number;
}
/** Ports point OUT of their piece: entrance yaw opposes forward travel;
 * exit yaw follows it. Joining ports must therefore have opposing yaws. */
export interface TrackPort extends TrackPoint {
  route: TrackRoute;
  end: 'entry' | 'exit';
}
export interface TrackPath {
  route: TrackRoute;
  points: TrackPoint[];
  length: number;
}
export interface TrackGeometry {
  paths: TrackPath[];
  entry: TrackPort;
  entries: TrackPort[];
  end: TrackPort;
  ends: TrackPort[];
  ports: TrackPort[];
  pose: TrackPoint;
  rect: Rect;
  cells: Point[];
  /** Sum of route lengths; a turnout module includes both routes. */
  length: number;
}
type TrackAsset = (Rail | Job) & { track?: TrackPiece };
export const CURVE_RADIUS = 20;
export const CURVE_SECTIONS = 6;
export const CURVE_SECTION_ANGLE = Math.PI / 12;
export const TURNOUT_LENGTH = 20;
export const TURNOUT_OFFSET = 5;
export const TURNOUT_SECTIONS = 4;
export const TRACK_HALF_WIDTH = 1;
const EPS = 1e-7;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clean = (v: number) => (Math.abs(v - Math.round(v)) < EPS ? Math.round(v) : v);
const world = (p: TrackPoint, piece: TrackPiece): TrackPoint => {
  const a = (piece.heading * Math.PI) / 2,
    c = Math.cos(a),
    n = Math.sin(a);
  return {
    x: clean(piece.origin.x + p.x * c - p.z * n),
    z: clean(piece.origin.z + p.x * n + p.z * c),
    yaw: angle(p.yaw + a),
  };
};

export function validTrackPiece(value: unknown): value is TrackPiece {
  if (!value || typeof value !== 'object') return false;
  const p = value as TrackPiece;
  const count =
    p.layout === 'curve'
      ? CURVE_SECTIONS
      : p.layout === 'turnout'
        ? TURNOUT_SECTIONS
        : p.layout === 'straight'
          ? 1
          : 0;
  return (
    !!count &&
    !!p.origin &&
    Number.isInteger(p.origin.x) &&
    Number.isInteger(p.origin.z) &&
    Math.abs(p.origin.x) < 10000 &&
    Math.abs(p.origin.z) < 10000 &&
    [0, 1, 2, 3].includes(p.heading) &&
    [1, -1].includes(p.hand) &&
    Number.isInteger(p.section) &&
    p.section >= 0 &&
    p.section < count &&
    (p.groupId === undefined || (typeof p.groupId === 'string' && p.groupId.length > 0)) &&
    (p.flow === undefined || (p.layout === 'turnout' && p.flow === 'converging')) &&
    (p.layout === 'turnout'
      ? p.section === 0
        ? p.route === undefined
        : p.route === 'straight' || p.route === 'branch'
      : p.route === undefined)
  );
}

export function trackSections(
  layout: TrackPiece['layout'],
  origin: Point,
  heading: TrackPiece['heading'],
  hand: TrackPiece['hand'] = 1,
  groupId?: string,
  flow?: TrackPiece['flow'],
): TrackPiece[] {
  const count = layout === 'curve' ? CURVE_SECTIONS : layout === 'turnout' ? TURNOUT_SECTIONS : 1;
  const pieces: TrackPiece[] = Array.from({ length: count }, (_, section) => ({
    layout,
    origin: { ...origin },
    heading,
    hand,
    section,
    ...(groupId ? { groupId } : {}),
    ...(flow ? { flow } : {}),
  })).flatMap((p) =>
    layout === 'turnout' && p.section > 0
      ? [
          { ...p, route: 'straight' as const },
          { ...p, route: 'branch' as const },
        ]
      : [p],
  );
  if (!pieces.every(validTrackPiece)) throw new Error('Invalid track layout descriptor');
  return flow === 'converging'
    ? pieces.sort((a, b) => b.section - a.section || (a.route === 'straight' ? -1 : 1))
    : pieces;
}

/** Build from the selected incoming endpoint. Convergence uses the same
 * seven physical panels, rotated 180 degrees, with the two exits installed
 * first and the common points module installed last. */
export function railLayoutPieces(
  layout: TrackPiece['layout'],
  origin: Point,
  heading: TrackPiece['heading'],
  hand: TrackPiece['hand'] = 1,
  flow?: TrackPiece['flow'],
): TrackPiece[] {
  if (flow !== 'converging') return trackSections(layout, origin, heading, hand);
  if (layout !== 'turnout') throw new Error('Only turnouts can converge');
  const yaw = (heading * Math.PI) / 2;
  return trackSections(
    layout,
    {
      x: clean(origin.x + TURNOUT_LENGTH * Math.cos(yaw)),
      z: clean(origin.z + TURNOUT_LENGTH * Math.sin(yaw)),
    },
    ((heading + 2) % 4) as TrackPiece['heading'],
    -hand as TrackPiece['hand'],
    undefined,
    flow,
  );
}

/** A legacy rectangular panel keeps its exact old centerline and endpoints. */
export function trackPiece(value: TrackPiece | TrackAsset): TrackPiece {
  if ('layout' in value) {
    if (!validTrackPiece(value)) throw new Error('Invalid track piece');
    return value;
  }
  if (value.track) {
    if (!validTrackPiece(value.track)) throw new Error('Invalid track piece');
    return value.track;
  }
  return {
    layout: 'straight',
    origin: value.rotation % 2 ? { x: value.x + 1, z: value.z } : { x: value.x, z: value.z + 1 },
    heading: value.rotation % 2 ? 1 : 0,
    hand: 1,
    section: 0,
  };
}

const curveAt = (p: TrackPiece, t: number): TrackPoint => {
  const a = (p.section + t) * CURVE_SECTION_ANGLE;
  return {
    x: CURVE_RADIUS * Math.sin(a),
    z: p.hand * CURVE_RADIUS * (1 - Math.cos(a)),
    yaw: p.hand * a,
  };
};
const branchAt = (p: TrackPiece, t: number): TrackPoint => {
  const u = (p.section + t) / TURNOUT_SECTIONS;
  return {
    x: TURNOUT_LENGTH * u,
    z: p.hand * TURNOUT_OFFSET * (3 * u * u - 2 * u * u * u),
    yaw: Math.atan2(p.hand * TURNOUT_OFFSET * (6 * u - 6 * u * u), TURNOUT_LENGTH),
  };
};
function branchLength(section: number) {
  // Simpson integration of the analytical cubic derivative, independent of
  // render sample density. These small modules need no mutable spline cache.
  const n = 128,
    a = section / TURNOUT_SECTIONS,
    h = 1 / (TURNOUT_SECTIONS * n);
  const speed = (t: number) => Math.hypot(TURNOUT_LENGTH, TURNOUT_OFFSET * (6 * t - 6 * t * t));
  let sum = speed(a) + speed(a + n * h);
  for (let i = 1; i < n; i++) sum += speed(a + i * h) * (i % 2 ? 4 : 2);
  return (sum * h) / 3;
}
function localPaths(p: TrackPiece): TrackPath[] {
  if (p.layout === 'curve') {
    const length = CURVE_RADIUS * CURVE_SECTION_ANGLE;
    const samples = Math.ceil(length / 0.25);
    return [
      {
        route: 'straight',
        length,
        points: Array.from({ length: samples + 1 }, (_, i) => curveAt(p, i / samples)),
      },
    ];
  }
  const start = p.layout === 'turnout' ? p.section * 5 : 0;
  const straight: TrackPath = {
    route: 'straight',
    length: 5,
    points: [
      { x: start, z: 0, yaw: 0 },
      { x: start + 5, z: 0, yaw: 0 },
    ],
  };
  if (p.layout === 'straight') return [straight];
  const length = branchLength(p.section),
    samples = Math.ceil(length / 0.25);
  const branch: TrackPath = {
    route: 'branch',
    length,
    points: Array.from({ length: samples + 1 }, (_, i) => branchAt(p, i / samples)),
  };
  return p.route === 'straight' ? [straight] : p.route === 'branch' ? [branch] : [straight, branch];
}
const edgePoint = (p: TrackPoint, side: number): Point => ({
  x: p.x - Math.sin(p.yaw) * TRACK_HALF_WIDTH * side,
  z: p.z + Math.cos(p.yaw) * TRACK_HALF_WIDTH * side,
});
function bounds(points: Point[]): Rect {
  const minX = clean(Math.min(...points.map((p) => p.x))),
    minZ = clean(Math.min(...points.map((p) => p.z)));
  return {
    x: minX,
    z: minZ,
    w: clean(Math.max(...points.map((p) => p.x)) - minX),
    d: clean(Math.max(...points.map((p) => p.z)) - minZ),
  };
}
function footprintPolygons(paths: TrackPath[]): Point[][] {
  return paths.flatMap((path) =>
    path.points.slice(1).map((p, i) => {
      const prev = path.points[i];
      return [edgePoint(prev, 1), edgePoint(p, 1), edgePoint(p, -1), edgePoint(prev, -1)];
    }),
  );
}
function polygonTouchesCell(polygon: Point[], cell: Point): boolean {
  const square = [
    cell,
    { x: cell.x + 1, z: cell.z },
    { x: cell.x + 1, z: cell.z + 1 },
    { x: cell.x, z: cell.z + 1 },
  ];
  const axes: Point[] = [
    { x: 1, z: 0 },
    { x: 0, z: 1 },
  ];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const d = distance(a, b);
    if (d > EPS) axes.push({ x: -(b.z - a.z) / d, z: (b.x - a.x) / d });
  }
  return axes.every((a) => {
    const p = polygon.map((v) => v.x * a.x + v.z * a.z),
      q = square.map((v) => v.x * a.x + v.z * a.z);
    return (
      Math.min(Math.max(...p), Math.max(...q)) - Math.max(Math.min(...p), Math.min(...q)) > EPS
    );
  });
}
function occupied(paths: TrackPath[], rect: Rect): Point[] {
  const polygons = footprintPolygons(paths),
    cells: Point[] = [];
  for (let z = Math.floor(rect.z + EPS); z < Math.ceil(rect.z + rect.d - EPS); z++)
    for (let x = Math.floor(rect.x + EPS); x < Math.ceil(rect.x + rect.w - EPS); x++)
      if (polygons.some((polygon) => polygonTouchesCell(polygon, { x, z }))) cells.push({ x, z });
  return cells;
}

/** A circle section is anchored at its mid-arc point and tangent. A left
 * section rotates the same physical, symmetric curve profile 180 degrees:
 * it traverses the profile in reverse rather than reflecting purchased rails. */
const geometryCache = new Map<string, TrackGeometry>();
function immutableGeometry(g: TrackGeometry): TrackGeometry {
  for (const path of g.paths) {
    for (const point of path.points) Object.freeze(point);
    Object.freeze(path.points);
    Object.freeze(path);
  }
  for (const point of [...g.ports, ...g.entries, ...g.ends, ...g.cells]) Object.freeze(point);
  for (const array of [g.paths, g.ports, g.entries, g.ends, g.cells]) Object.freeze(array);
  Object.freeze(g.pose);
  Object.freeze(g.rect);
  return Object.freeze(g);
}
/** Geometry is immutable and shared in a bounded 512-entry descriptor cache.
 * Copy its poses/ports before storing mutable physical animation state. */
export function trackGeometry(value: TrackPiece | TrackAsset): TrackGeometry {
  const p = trackPiece(value);
  const key = `${p.layout}:${p.origin.x},${p.origin.z}:${p.heading}:${p.hand}:${p.section}:${p.route || ''}:${p.flow || ''}`;
  const cached = geometryCache.get(key);
  if (cached) {
    geometryCache.delete(key);
    geometryCache.set(key, cached);
    return cached;
  }
  const raw = localPaths(p);
  const localEdges = raw.flatMap((path) =>
    path.points.flatMap((q) => [edgePoint(q, -1), edgePoint(q, 1)]),
  );
  const localRect = bounds(localEdges);
  const localPose =
    p.layout === 'curve'
      ? { ...curveAt(p, 0.5), yaw: curveAt(p, 0.5).yaw + (p.hand < 0 ? Math.PI : 0) }
      : p.layout === 'turnout' && p.route === 'branch'
        ? branchAt(p, 0.5)
        : { x: localRect.x + localRect.w / 2, z: localRect.z + localRect.d / 2, yaw: 0 };
  const paths = raw.map((path) => {
    const points = path.points.map((q) => world(q, p));
    return {
      ...path,
      points:
        p.flow === 'converging'
          ? points.reverse().map((q) => ({ ...q, yaw: angle(q.yaw + Math.PI) }))
          : points,
    };
  });
  const entries = paths.map((path): TrackPort => ({
    ...path.points[0],
    yaw: angle(path.points[0].yaw + Math.PI),
    route: path.route,
    end: 'entry',
  }));
  const ends = paths.map((path): TrackPort => ({
    ...path.points[path.points.length - 1],
    route: path.route,
    end: 'exit',
  }));
  const ports = [...entries, ...ends].filter(
    (q, i, list) =>
      !list.slice(0, i).some((r) => distance(q, r) < EPS && Math.abs(angle(q.yaw - r.yaw)) < EPS),
  );
  const rect = bounds(
    paths.flatMap((path) => path.points.flatMap((q) => [edgePoint(q, -1), edgePoint(q, 1)])),
  );
  const geometry = immutableGeometry({
    paths,
    entry: entries[0],
    entries,
    end: ends[0],
    ends,
    ports,
    pose: world(localPose, p),
    rect,
    cells: occupied(paths, rect),
    length: paths.reduce((n, path) => n + path.length, 0),
  });
  geometryCache.set(key, geometry);
  if (geometryCache.size > 512) geometryCache.delete(geometryCache.keys().next().value!);
  return geometry;
}
export function trackLocalPaths(value: TrackPiece | TrackAsset): TrackPath[] {
  // Manufacturing geometry and lever placement must not change when the
  // crew approaches the same purchased module from its opposite end.
  const descriptor = trackPiece(value);
  const g = trackGeometry(descriptor.flow ? { ...descriptor, flow: undefined } : descriptor),
    c = Math.cos(g.pose.yaw),
    n = Math.sin(g.pose.yaw);
  return g.paths.map((path) => ({
    ...path,
    points: path.points.map((q) => {
      const dx = q.x - g.pose.x,
        dz = q.z - g.pose.z;
      return { x: dx * c + dz * n, z: -dx * n + dz * c, yaw: angle(q.yaw - g.pose.yaw) };
    }),
  }));
}
export const railFootprint = (r: TrackPiece | TrackAsset): Rect => trackGeometry(r).rect;
export const railCells = (r: TrackPiece | TrackAsset): Point[] => trackGeometry(r).cells;
export const railPorts = (r: TrackPiece | TrackAsset): TrackPort[] => trackGeometry(r).ports;
export const railFootprints = (s: State): (Rect & { id: string })[] =>
  s.rails.map((r) => ({ ...railFootprint(r), id: r.id }));

/** The three external turnout ports, or the two curve/straight ports. Macro
 * internal joints are deliberately absent from placement snapping. */
export function trackMacroPorts(value: TrackPiece | TrackAsset): TrackPort[] {
  const p = trackPiece(value),
    sections = trackSections(p.layout, p.origin, p.heading, p.hand, p.groupId, p.flow);
  if (p.flow === 'converging')
    return [
      ...sections
        .filter((section) => section.section === TURNOUT_SECTIONS - 1)
        .flatMap((section) => trackGeometry(section).entries),
      trackGeometry(sections.find((section) => section.section === 0)!).end,
    ];
  const first = trackGeometry(sections[0]);
  const lastSection = Math.max(...sections.map((section) => section.section));
  return [
    first.entry,
    ...sections
      .filter((section) => section.section === lastSection)
      .flatMap((section) => trackGeometry(section).ends),
  ];
}

export function portsConnect(
  a: TrackPort,
  b: TrackPort,
  positionTolerance = 1e-4,
  angleTolerance = 1e-4,
): boolean {
  return (
    distance(a, b) <= positionTolerance &&
    Math.abs(Math.abs(angle(a.yaw - b.yaw)) - Math.PI) <= angleTolerance
  );
}
export interface TrackNetworkPort extends TrackPort {
  assetId: string;
  portIndex: number;
  connected: boolean;
}
export interface TrackNetworkPanel {
  id: string;
  source: 'bootstrap' | 'installed' | 'planned';
  paths: TrackPath[];
  ports: TrackNetworkPort[];
  connected: boolean;
}
export interface TrackJoint {
  a: { assetId: string; portIndex: number };
  b: { assetId: string; portIndex: number };
  point: Point;
}
export interface TrackNetwork {
  panels: TrackNetworkPanel[];
  joints: TrackJoint[];
  openPorts: TrackNetworkPort[];
}

/** The starter siding is already connected to the protected main line. Its
 * only buildable connection is the exposed end at (125,5). Main-line ends
 * stand outside the yard and intentionally cannot become planning snaps. */
export function trackNetwork(s: State, includePlanned = false): TrackNetwork {
  const starterPath: TrackPath = {
    route: 'straight',
    length: 100,
    points: [
      { x: 25, z: 5, yaw: 0 },
      { x: 125, z: 5, yaw: 0 },
    ],
  };
  const seed: TrackNetworkPanel = {
    id: 'BOOTSTRAP-SIDING',
    source: 'bootstrap',
    paths: [starterPath],
    connected: true,
    ports: [
      {
        x: 125,
        z: 5,
        yaw: 0,
        route: 'straight',
        end: 'exit',
        assetId: 'BOOTSTRAP-SIDING',
        portIndex: 0,
        connected: false,
      },
    ],
  };
  const mainline: TrackNetworkPanel = {
    id: 'BOOTSTRAP-MAINLINE',
    source: 'bootstrap',
    connected: true,
    ports: [],
    paths: [
      {
        route: 'straight',
        length: 780,
        points: [
          { x: -260, z: 0, yaw: 0 },
          { x: 520, z: 0, yaw: 0 },
        ],
      },
    ],
  };
  const assets: { asset: TrackAsset; source: 'installed' | 'planned' }[] = s.rails.map((asset) => ({
    asset,
    source: 'installed',
  }));
  if (includePlanned) {
    for (const j of s.jobs) {
      if (j.kind !== 'rail' || j.status === 'canceled' || j.status === 'done') continue;
      if (s.rails.some((r) => j.railWork?.panel.railId === r.id)) continue;
      assets.push({ asset: j, source: 'planned' });
    }
  }
  const panels: TrackNetworkPanel[] = [
    seed,
    mainline,
    ...assets.map(({ asset, source }) => {
      const geometry = trackGeometry(asset);
      return {
        id: asset.id,
        source,
        paths: geometry.paths,
        connected: false,
        ports: geometry.ports.map((p, portIndex) => ({
          ...p,
          assetId: asset.id,
          portIndex,
          connected: false,
        })),
      };
    }),
  ];
  const joints: TrackJoint[] = [];
  const neighbors = new Map<string, Set<string>>();
  for (let i = 0; i < panels.length; i++)
    for (let k = i + 1; k < panels.length; k++) {
      const a = panels[i],
        b = panels[k];
      for (const pa of a.ports)
        for (const pb of b.ports) {
          if (!portsConnect(pa, pb)) continue;
          pa.connected = pb.connected = true;
          joints.push({
            a: { assetId: a.id, portIndex: pa.portIndex },
            b: { assetId: b.id, portIndex: pb.portIndex },
            point: { x: pa.x, z: pa.z },
          });
          if (!neighbors.has(a.id)) neighbors.set(a.id, new Set());
          if (!neighbors.has(b.id)) neighbors.set(b.id, new Set());
          neighbors.get(a.id)!.add(b.id);
          neighbors.get(b.id)!.add(a.id);
        }
    }
  // The existing protected switch couples these two bootstrap assets. It
  // exposes no additional build port inside the main-line right of way.
  const reached = new Set([seed.id, mainline.id]),
    queue = [seed.id, mainline.id];
  for (let i = 0; i < queue.length; i++)
    for (const id of neighbors.get(queue[i]) ?? []) {
      if (reached.has(id)) continue;
      reached.add(id);
      queue.push(id);
    }
  for (const panel of panels) panel.connected = reached.has(panel.id);
  return {
    panels,
    joints,
    openPorts: panels.flatMap((p) => p.ports.filter((port) => !port.connected)),
  };
}
export function trackOpenPorts(
  s: State,
  includePlanned = true,
  connectedOnly = true,
): TrackNetworkPort[] {
  const network = trackNetwork(s, includePlanned);
  const assets: TrackAsset[] = [
    ...s.rails,
    ...(includePlanned
      ? s.jobs.filter(
          (j) =>
            j.kind === 'rail' &&
            j.status !== 'canceled' &&
            j.status !== 'done' &&
            !s.rails.some((r) => j.railWork?.panel.railId === r.id),
        )
      : []),
  ];
  return network.openPorts.filter((port) => {
    if (connectedOnly && !network.panels.find((p) => p.id === port.assetId)!.connected)
      return false;
    const asset = assets.find((asset) => asset.id === port.assetId);
    if (!asset?.track || asset.track.layout === 'straight') return true;
    const piece = asset.track;
    const expected = trackSections(
      piece.layout,
      piece.origin,
      piece.heading,
      piece.hand,
      piece.groupId,
      piece.flow,
    );
    const sameMacro = (candidate: TrackPiece) =>
      candidate.layout === piece.layout &&
      candidate.origin.x === piece.origin.x &&
      candidate.origin.z === piece.origin.z &&
      candidate.heading === piece.heading &&
      candidate.hand === piece.hand &&
      candidate.flow === piece.flow &&
      candidate.groupId === piece.groupId;
    if (
      !expected.every((part) =>
        assets.some(
          (candidate) =>
            candidate.track &&
            sameMacro(candidate.track) &&
            candidate.track.section === part.section &&
            candidate.track.route === part.route,
        ),
      )
    )
      return false;
    return trackMacroPorts(piece).some(
      (external) =>
        external.end === port.end &&
        distance(external, port) < EPS &&
        Math.abs(angle(external.yaw - port.yaw)) < EPS,
    );
  });
}
export function snapTrackStart(
  s: State,
  p: Point,
  requestedHeading?: TrackPiece['heading'],
  includePlanned = true,
  maximum = 3,
): { origin: Point; heading: TrackPiece['heading']; port: TrackNetworkPort } | undefined {
  const candidates = trackOpenPorts(s, includePlanned).flatMap((port) => {
    const rounded = Math.round(port.yaw / (Math.PI / 2));
    const heading = (((rounded % 4) + 4) % 4) as TrackPiece['heading'];
    if (
      (requestedHeading !== undefined && requestedHeading !== heading) ||
      Math.abs(angle(port.yaw - (heading * Math.PI) / 2)) > EPS ||
      Math.abs(port.x - Math.round(port.x)) > EPS ||
      Math.abs(port.z - Math.round(port.z)) > EPS ||
      distance(p, port) > maximum
    )
      return [];
    return [{ origin: { x: Math.round(port.x), z: Math.round(port.z) }, heading, port }];
  });
  return candidates.sort((a, b) => distance(p, a.origin) - distance(p, b.origin))[0];
}
