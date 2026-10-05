import * as THREE from 'three';
import { box, cylinder, beam, material } from './mesh';
import { RAIL_CENTER_OFFSET } from './catalog';
import { RAIL_PANEL_PITCH } from './railwork';
import { trackGeometry, trackLocalPaths, type TrackPiece, type TrackPath } from './track';

export const SPECIAL_TRACK_ITEMS = [
  'railCurve',
  'railPoints',
  'railFrog',
  'railClosure',
  'railExit',
] as const;
export function isRailMaterial(item: string) {
  return (
    item === 'rail' || SPECIAL_TRACK_ITEMS.includes(item as (typeof SPECIAL_TRACK_ITEMS)[number])
  );
}

export function stockTrackPiece(item: string, hand: 1 | -1 = 1): TrackPiece {
  const sections: Record<string, number> = {
    railPoints: 0,
    railFrog: 1,
    railClosure: 2,
    railExit: 3,
  };
  return {
    layout: item === 'railCurve' ? 'curve' : item === 'rail' ? 'straight' : 'turnout',
    origin: { x: 0, z: 0 },
    heading: 0,
    hand,
    section: sections[item] || 0,
    ...(item !== 'railPoints' && item !== 'railCurve' && item !== 'rail'
      ? { route: 'branch' as const }
      : {}),
  };
}

type PathPoint = TrackPath['points'][number];
function railStrip(
  parent: THREE.Object3D,
  path: PathPoint[],
  offset: number,
  name: string,
  gap?: { x: number; z: number },
) {
  // Straight geometry exports only endpoints. Subdivide the rendered profile
  // so a frog can interrupt just the crossing, rather than an entire panel.
  if (path.length === 2) {
    const [a, b] = path;
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
    path = Array.from({ length: count + 1 }, (_, i) => ({
      x: a.x + ((b.x - a.x) * i) / count,
      z: a.z + ((b.z - a.z) * i) / count,
      yaw: a.yaw + ((b.yaw - a.yaw) * i) / count,
    }));
  }
  // A continuous steel profile follows the analytical centerline. Its paired
  // inner head faces stay 1,435 mm apart, including curved sections.
  const profile = [
    [-0.07, 0.155],
    [0.07, 0.155],
    [0.07, 0.176],
    [0.017, 0.185],
    [0.017, 0.255],
    [0.036, 0.255],
    [0.036, 0.325],
    [-0.036, 0.325],
    [-0.036, 0.255],
    [-0.017, 0.255],
    [-0.017, 0.185],
    [-0.07, 0.176],
  ];
  const vertices: number[] = [],
    indices: number[] = [];
  for (const p of path)
    for (const [width, y] of profile)
      vertices.push(
        p.x - Math.sin(p.yaw) * (offset + width),
        y,
        p.z + Math.cos(p.yaw) * (offset + width),
      );
  const ring = profile.length;
  for (let i = 1; i < path.length; i++)
    for (let j = 0; j < ring; j++) {
      if (gap) {
        const p = path[i],
          prev = path[i - 1],
          yaw = (p.yaw + prev.yaw) / 2;
        const x = (p.x + prev.x) / 2 - Math.sin(yaw) * offset;
        const z = (p.z + prev.z) / 2 + Math.cos(yaw) * offset;
        if (Math.hypot(x - gap.x, z - gap.z) < 0.19) continue;
      }
      const a = (i - 1) * ring + j,
        b = (i - 1) * ring + ((j + 1) % ring),
        c = i * ring + j,
        d = i * ring + ((j + 1) % ring);
      indices.push(a, c, b, b, c, d);
    }
  for (let j = 1; j < ring - 1; j++) {
    indices.push(0, j, j + 1);
    const end = (path.length - 1) * ring;
    indices.push(end, end + j + 1, end + j);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const rail = new THREE.Mesh(geometry, material(0x929b9a, 0.43, 0.78));
  rail.name = name;
  rail.castShadow = rail.receiveShadow = true;
  rail.userData = {
    centerOffset: offset,
    gauge: 1.435,
    centerline: path.map((p) => ({ ...p })),
    profile,
  };
  parent.add(rail);
  return rail;
}

function at(path: TrackPath, ratio: number): PathPoint {
  const index = Math.max(0, Math.min(path.points.length - 1, ratio * (path.points.length - 1))),
    a = path.points[Math.floor(index)],
    b = path.points[Math.ceil(index)],
    t = index % 1;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * t,
  };
}

function fastening(parent: THREE.Object3D, p: PathPoint, offset: number) {
  const plate = box(
    parent,
    p.x - Math.sin(p.yaw) * offset,
    0.169,
    p.z + Math.cos(p.yaw) * offset,
    0.29,
    0.025,
    0.21,
    0x49514f,
    0.7,
  );
  plate.rotation.y = -p.yaw;
  for (const side of [-1, 1]) {
    const z = offset + side * 0.087;
    const bolt = cylinder(
      parent,
      p.x - Math.sin(p.yaw) * z,
      0.188,
      p.z + Math.cos(p.yaw) * z,
      0.026,
      0.025,
      0x626b66,
      6,
    );
    bolt.name = 'rail-fastener';
  }
}

function pointsDetails(
  g: THREE.Group,
  paths: TrackPath[],
  selectedRoute: 'straight' | 'branch',
  hand: 1 | -1,
) {
  const through = paths.find((p) => p.route === 'straight') || paths[0],
    branch = paths.find((p) => p.route === 'branch');
  if (!branch) return;
  const blades = new THREE.Group();
  blades.name = 'turnout-point-blades';
  blades.userData.selectedRoute = selectedRoute;
  g.add(blades);
  // Slender movable blades sit inside the stock rails. The selected pair
  // seats toward the active path; throw rods and the lever share that state.
  for (const side of [-1, 1]) {
    const bladePath = (source: TrackPath) =>
      Array.from({ length: 14 }, (_, i) => {
        const p = at(source, 0.025 + (i / 13) * 0.65);
        const nearTip = 1 - i / 14;
        const inset = side * (RAIL_CENTER_OFFSET - 0.065 * nearTip);
        return { x: p.x - Math.sin(p.yaw) * inset, z: p.z + Math.cos(p.yaw) * inset, yaw: p.yaw };
      });
    const choices = { straight: bladePath(through), branch: bladePath(branch) };
    const points = choices[selectedRoute];
    const blade = railStrip(blades, points, 0, `movable-point-${side}`);
    blade.position.y = 0.004;
    blade.userData.travelPaths = choices;
  }
  const p = at(through, 0.19);
  const rod = box(g, p.x, 0.125, p.z, 0.06, 0.05, 1.68, 0x454e50, 0.8);
  rod.rotation.y = -p.yaw;
  rod.name = 'turnout-throw-rod';
  rod.userData.movable = true;
  rod.userData.throwHand = hand;
  const lever = new THREE.Group();
  lever.name = 'turnout-manual-lever';
  lever.position.set(
    p.x - Math.sin(p.yaw) * -hand * 0.9,
    0.09,
    p.z + Math.cos(p.yaw) * -hand * 0.9,
  );
  cylinder(lever, 0, 0.04, 0, 0.1, 0.08, 0x444c47, 12);
  cylinder(lever, 0, 0.15, 0, 0.065, 0.24, 0x77827c, 10);
  const arm = new THREE.Group();
  arm.name = 'turnout-lever-arm';
  arm.position.y = 0.24;
  arm.rotation.z = selectedRoute === 'branch' ? -0.39 : 0.39;
  lever.add(arm);
  cylinder(arm, 0, 0.3, 0, 0.025, 0.6, 0x788580, 8);
  const grip = cylinder(arm, 0, 0.6, 0, 0.075, 0.16, 0xb34f3b, 10);
  grip.rotation.z = Math.PI / 2;
  lever.userData.selectedRoute = selectedRoute;
  g.add(lever);
}

export function animateTurnout(
  model: THREE.Object3D,
  from: 'straight' | 'branch',
  to: 'straight' | 'branch',
  fraction: number,
) {
  const f = Math.max(0, Math.min(1, fraction));
  const arm = model.getObjectByName('turnout-lever-arm');
  if (arm)
    arm.rotation.z =
      (from === 'branch' ? -0.39 : 0.39) * (1 - f) + (to === 'branch' ? -0.39 : 0.39) * f;
  const rod = model.getObjectByName('turnout-throw-rod');
  if (rod) {
    rod.userData.restZ ??= rod.position.z;
    rod.position.z =
      rod.userData.restZ +
      ((from === 'branch' ? 1 : 0) * (1 - f) + (to === 'branch' ? 1 : 0) * f) *
        0.055 *
        rod.userData.throwHand;
  }
  model.getObjectByName('turnout-point-blades')?.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.travelPaths) return;
    const a = object.userData.travelPaths[from] as PathPoint[],
      b = object.userData.travelPaths[to] as PathPoint[];
    const vertices = object.geometry.getAttribute('position');
    const profile = object.userData.profile as number[][];
    for (let i = 0; i < a.length; i++) {
      const x = a[i].x * (1 - f) + b[i].x * f,
        z = a[i].z * (1 - f) + b[i].z * f;
      const yaw =
        a[i].yaw + Math.atan2(Math.sin(b[i].yaw - a[i].yaw), Math.cos(b[i].yaw - a[i].yaw)) * f;
      for (let j = 0; j < profile.length; j++) {
        const [width, y] = profile[j];
        vertices.setXYZ(
          i * profile.length + j,
          x - Math.sin(yaw) * width,
          y,
          z + Math.cos(yaw) * width,
        );
      }
    }
    vertices.needsUpdate = true;
    object.geometry.computeVertexNormals();
    object.geometry.computeBoundingSphere();
  });
}

function toLocal(p: PathPoint, pose: PathPoint): PathPoint {
  const dx = p.x - pose.x,
    dz = p.z - pose.z,
    c = Math.cos(pose.yaw),
    n = Math.sin(pose.yaw);
  return { x: dx * c + dz * n, z: -dx * n + dz * c, yaw: p.yaw - pose.yaw };
}

function frogLocation(piece: TrackPiece) {
  if (piece.layout !== 'turnout' || piece.section !== 1) return undefined;
  const pose = trackGeometry(piece).pose;
  const branch = trackGeometry({ ...piece, route: 'branch' }).paths[0];
  const through = trackGeometry({ ...piece, route: 'straight' }).paths[0];
  const offset = (p: PathPoint, side: number) => ({
    ...p,
    x: p.x - Math.sin(p.yaw) * side * RAIL_CENTER_OFFSET,
    z: p.z + Math.cos(p.yaw) * side * RAIL_CENTER_OFFSET,
  });
  const a = offset(through.points[0], piece.hand),
    b = offset(through.points.at(-1)!, piece.hand);
  for (let i = 1; i < branch.points.length; i++) {
    const c = offset(branch.points[i - 1], -piece.hand),
      d = offset(branch.points[i], -piece.hand);
    const ax = b.x - a.x,
      az = b.z - a.z,
      bx = d.x - c.x,
      bz = d.z - c.z;
    const determinant = ax * bz - az * bx;
    if (Math.abs(determinant) < 1e-9) continue;
    const t = ((c.x - a.x) * bz - (c.z - a.z) * bx) / determinant;
    const u = ((c.x - a.x) * az - (c.z - a.z) * ax) / determinant;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    return toLocal({ x: a.x + ax * t, z: a.z + az * t, yaw: through.points[0].yaw }, pose);
  }
  return undefined;
}

function frogDetails(g: THREE.Group, path: TrackPath, crossing: PathPoint) {
  // Machined crossing insert and inner check rails are part of the frog kit.
  const p = crossing;
  const frog = new THREE.Group();
  frog.name = 'turnout-crossing-frog';
  frog.position.set(p.x, 0, p.z);
  frog.rotation.y = -p.yaw;
  box(frog, 0, 0.166, 0, 0.95, 0.035, 0.72, 0x535d57, 0.8);
  for (const side of [-1, 1]) {
    const nose = box(frog, 0.05, 0.285, side * 0.06, 0.78, 0.075, 0.046, 0xabb2aa, 0.85);
    nose.rotation.y = side * 0.15;
  }
  g.add(frog);
  for (const offset of [-RAIL_CENTER_OFFSET + 0.14, RAIL_CENTER_OFFSET - 0.14]) {
    const guard = railStrip(g, path.points.slice(4, -3), offset, 'frog-check-rail');
    guard.position.y = -0.018;
  }
}

export function trackPanelModel(
  piece: TrackPiece,
  qty = 1,
  selectedRoute: 'straight' | 'branch' = 'straight',
  pairedInstalled = false,
) {
  const g = new THREE.Group();
  g.name = piece.layout === 'curve' ? 'physical-curved-rail-panel' : 'physical-track-panel';
  const paths = trackLocalPaths(piece);
  const crossing = frogLocation(piece);
  const throughGlobal =
    piece.layout === 'turnout' && piece.section === 1
      ? trackGeometry({ ...piece, route: 'straight' }).paths[0]
      : undefined;
  const branchGlobal =
    piece.layout === 'turnout' && piece.section === 1
      ? trackGeometry({ ...piece, route: 'branch' }).paths[0]
      : undefined;
  const pose = trackGeometry(piece).pose;
  g.userData.track = { ...piece };
  for (let layer = 0; layer < qty; layer++) {
    const panel = new THREE.Group();
    panel.position.y = layer * RAIL_PANEL_PITCH;
    g.add(panel);
    const primary = paths.find((p) => p.route === 'straight') || paths[0];
    const count = Math.max(
      2,
      Math.ceil((pairedInstalled && throughGlobal ? throughGlobal.length : primary.length) / 0.625),
    );
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count,
        p = at(primary, t);
      const secondary = paths.length > 1 ? at(paths[1], t) : undefined;
      let tiePoint = p;
      let width = 1.95 + (secondary ? Math.abs(secondary.z - p.z) : 0);
      if (pairedInstalled && throughGlobal && branchGlobal) {
        const main = at(throughGlobal, t),
          branch = at(branchGlobal, t),
          separation = Math.hypot(branch.x - main.x, branch.z - main.z);
        if (separation < 1.95) {
          if (piece.route === 'straight') continue;
          tiePoint = toLocal(
            { x: (main.x + branch.x) / 2, z: (main.z + branch.z) / 2, yaw: main.yaw },
            pose,
          );
          width = 1.95 + separation;
        }
      }
      const tie = box(
        panel,
        tiePoint.x,
        0.09,
        secondary ? (p.z + secondary.z) / 2 : tiePoint.z,
        0.22,
        0.15,
        width,
        0x736d59,
      );
      tie.rotation.y = -tiePoint.yaw;
      tie.name = 'rail-sleeper';
      for (const path of paths) {
        const point = at(path, t);
        for (const side of [-1, 1]) fastening(panel, point, side * RAIL_CENTER_OFFSET);
      }
    }
    for (const path of paths)
      for (const side of [-1, 1]) {
        let points = path.points;
        if (paths.length > 1 && path.route === 'branch') {
          const main = paths.find((p) => p.route === 'straight')!;
          const first = points.findIndex((p) => {
            const head = {
              x: p.x - Math.sin(p.yaw) * side * RAIL_CENTER_OFFSET,
              z: p.z + Math.cos(p.yaw) * side * RAIL_CENTER_OFFSET,
            };
            return (
              Math.min(
                ...main.points.map((q) =>
                  Math.hypot(
                    head.x - q.x + Math.sin(q.yaw) * side * RAIL_CENTER_OFFSET,
                    head.z - q.z - Math.cos(q.yaw) * side * RAIL_CENTER_OFFSET,
                  ),
                ),
              ) > 0.08
            );
          });
          points = points.slice(Math.max(0, first));
        }
        const cut =
          crossing && side === (path.route === 'branch' ? -piece.hand : piece.hand)
            ? crossing
            : undefined;
        railStrip(
          panel,
          points,
          side * RAIL_CENTER_OFFSET,
          `track-rail-${path.route}-${side}`,
          cut,
        );
      }
    if (piece.layout === 'turnout' && piece.section === 0)
      pointsDetails(panel, paths, selectedRoute, piece.hand);
    if (piece.layout === 'turnout' && piece.section === 1 && piece.route === 'branch' && crossing)
      frogDetails(panel, primary, crossing);
    if (layer > 0)
      for (const t of [0.2, 0.8]) {
        const p = at(primary, t);
        const runner = box(panel, p.x, 0.0025, p.z, 0.12, 0.025, 1.92, 0x766b50);
        runner.rotation.y = -p.yaw;
      }
  }
  return g;
}

export function stockRailModel(item: string, qty: number, hand: 1 | -1 = 1) {
  return trackPanelModel(stockTrackPiece(item, hand), qty);
}

export function trackLiftPoints(item: string, hand: 1 | -1 = 1) {
  const paths = trackLocalPaths(stockTrackPiece(item, hand));
  return [0.2, 0.8].flatMap((t) =>
    [-1, 1].map((side) => {
      const path =
        paths.length > 1
          ? paths.find((p) => p.route === (side === hand ? 'branch' : 'straight'))!
          : paths[0];
      const p = at(path, t),
        offset = side * RAIL_CENTER_OFFSET;
      return { x: p.x - Math.sin(p.yaw) * offset, y: 0.325, z: p.z + Math.cos(p.yaw) * offset };
    }),
  );
}
