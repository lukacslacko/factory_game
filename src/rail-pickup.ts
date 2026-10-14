import type {
  Equipment,
  EquipmentKind,
  Point,
  RailWork,
  Rect,
  Stack,
  State,
  Worker,
} from './types';
import { EQUIPMENT, MATERIALS } from './catalog';
import { center, dist, segmentClear } from './path';
import {
  boxOverlap,
  equipmentBoxes,
  equipmentMoveBlocked,
  machineRoute,
  personTouchesBox,
  walkRoute,
  workerMoveBlocked,
} from './traffic';

const PITCH = 0.36;
const add = (p: Point, d: Point, n: number): Point => ({ x: p.x + d.x * n, z: p.z + d.z * n });
const facing = (from: Point, to: Point) => Math.atan2(to.z - from.z, to.x - from.x);
type Source = NonNullable<RailWork['source']>;
export interface RailPickupFace {
  dock: Point;
  approach: Point;
  clear: Point;
  reach: number;
  yaw: number;
  workerPoints: Point[];
}

/** A coarse, bounded aisle witness from a clear pickup approach to a stockyard
 * edge. It screens permanent stock placement, not a live steering maneuver:
 * actual pickup still checks the machine, worker, load and swept route. */
export function staticRailAisle(
  zone: Rect,
  approach: Point,
  obstacles: Rect[],
  clearance = 1.35,
): Point[] | null {
  // A rail-panel approach can lie over six meters beyond a tiny bay.
  const minX = Math.max(-48, Math.floor(zone.x - 8)),
    minZ = Math.max(-30, Math.floor(zone.z - 8)),
    maxX = Math.min(230, Math.ceil(zone.x + zone.w + 8)),
    maxZ = Math.min(115, Math.ceil(zone.z + zone.d + 8));
  const width = maxX - minX,
    depth = maxZ - minZ;
  if (width < 1 || depth < 1 || width * depth > 30000) return null;
  const index = (x: number, z: number) => (z - minZ) * width + x - minX;
  const open = new Uint8Array(width * depth);
  open.fill(1);
  for (const r of obstacles) {
    const left = Math.max(minX, Math.floor(r.x - clearance - 0.5)),
      right = Math.min(maxX - 1, Math.ceil(r.x + r.w + clearance - 0.5)),
      top = Math.max(minZ, Math.floor(r.z - clearance - 0.5)),
      bottom = Math.min(maxZ - 1, Math.ceil(r.z + r.d + clearance - 0.5));
    for (let z = top; z <= bottom; z++)
      for (let x = left; x <= right; x++)
        if (x + 0.5 > r.x - clearance && x + 0.5 < r.x + r.w + clearance &&
            z + 0.5 > r.z - clearance && z + 0.5 < r.z + r.d + clearance)
          open[index(x, z)] = 0;
  }
  const parent = new Int32Array(open.length);
  parent.fill(-2);
  const queue = new Int32Array(open.length);
  let head = 0,
    tail = 0;
  for (let z = Math.floor(approach.z) - 1; z <= Math.floor(approach.z) + 1; z++)
    for (let x = Math.floor(approach.x) - 1; x <= Math.floor(approach.x) + 1; x++) {
      if (x < minX || x >= maxX || z < minZ || z >= maxZ) continue;
      const k = index(x, z),
        point = { x: x + 0.5, z: z + 0.5 };
      if (!open[k] || parent[k] !== -2 ||
          !segmentClear(approach, point, obstacles, clearance)) continue;
      parent[k] = -1;
      queue[tail++] = k;
    }
  while (head < tail) {
    const k = queue[head++],
      x = minX + (k % width),
      z = minZ + Math.floor(k / width),
      point = { x: x + 0.5, z: z + 0.5 };
    if (point.x < zone.x - 1 || point.x > zone.x + zone.w + 1 ||
        point.z < zone.z - 1 || point.z > zone.z + zone.d + 1) {
      const path = [point];
      for (let at = parent[k]; at >= 0; at = parent[at])
        path.push({ x: minX + (at % width) + 0.5,
          z: minZ + Math.floor(at / width) + 0.5 });
      return [approach, ...path.reverse()];
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx,
        nz = z + dz;
      if (nx < minX || nx >= maxX || nz < minZ || nz >= maxZ) continue;
      const next = index(nx, nz);
      if (!open[next] || parent[next] !== -2 ||
          !segmentClear(point, { x: nx + 0.5, z: nz + 0.5 }, obstacles, clearance)) continue;
      parent[next] = k;
      queue[tail++] = next;
    }
  }
  return null;
}

/** Corners and intermediate exposed edge positions, never points inside the load. */
export function railCrewStandingPoints(
  stack: Pick<Stack, 'x' | 'z' | 'w' | 'd' | 'item' | 'yaw'>,
): Point[] {
  const p = center(stack),
    m = MATERIALS[stack.item],
    yaw = stack.yaw || 0;
  const f = { x: Math.cos(yaw), z: Math.sin(yaw) },
    n = { x: -Math.sin(yaw), z: Math.cos(yaw) };
  const out = [add(p, f, m.w / 2 + 1), add(p, f, -m.w / 2 - 1)];
  for (const sign of [-1, 1]) {
    for (const along of [-m.w / 2 + 0.55, m.w / 2 - 0.55, -m.w / 4, 0, m.w / 4])
      out.push(add(add(p, f, along), n, sign * (m.d / 2 + 0.6)));
    for (const across of [-m.d / 4, m.d / 4])
      out.push(add(add(p, f, sign * (m.w / 2 + 0.6)), n, across));
  }
  return out;
}

function previewEquipment(kind: EquipmentKind): Equipment {
  return {
    id: 'pickup-preview',
    kind,
    x: -10000,
    z: -10000,
    heading: 0,
    yaw: 0,
    path: [],
    fuel: 1,
    tank: 1,
    used: 0,
    work: 0,
  };
}

/** Cheap static screen for storage placement. It promises an exposed lifting
 * face and crew standing room, not a route from any particular live machine. */
export function staticRailPickupFaces(
  _s: State,
  stack: Stack,
  equipmentKind: EquipmentKind,
  obstacles: Rect[],
): RailPickupFace[] {
  const p = center(stack),
    m = MATERIALS[stack.item],
    yaw = stack.yaw || 0;
  const normal = { x: -Math.sin(yaw), z: Math.cos(yaw) },
    forward = { x: Math.cos(yaw), z: Math.sin(yaw) };
  const e = previewEquipment(equipmentKind),
    points = railCrewStandingPoints(stack);
  const clearBody = (pose: Point & { yaw: number }) => {
    const body = equipmentBoxes(e, pose, false)[0];
    return !obstacles.some((r) =>
      boxOverlap(body, { ...center(r), length: r.w, width: r.d, yaw: 0 }, 0.06),
    );
  };
  const faces: RailPickupFace[] = [];
  for (const { direction, reach } of [
    { direction: normal, reach: 4 },
    { direction: forward, reach: m.w / 2 + 2.5 },
  ])
    for (const sign of [1, -1]) {
      const dock = add(p, direction, reach * sign),
        approach = add(dock, direction, 2.5 * sign),
        faceYaw = facing(dock, p);
      if (!clearBody({ ...dock, yaw: faceYaw }) || !clearBody({ ...approach, yaw: faceYaw }))
        continue;
      const parked = { ...e, ...dock, yaw: faceYaw, reach };
      const workerPoints = points.filter(
        (point) =>
          segmentClear(point, point, obstacles, 0.32) &&
          !equipmentBoxes(parked).some((b) => personTouchesBox(point, b, 0.42)),
      );
      if (workerPoints.length)
        faces.push({ dock, approach, clear: approach, reach, yaw: faceYaw, workerPoints });
    }
  return faces;
}

export interface RailPickupPlan {
  source?: Source;
  reason: string;
  blockers: string[];
}

/** Preflight one real top load, including worker access and loaded withdrawal. */
export function planRailPickup(
  s: State,
  e: Equipment,
  crew: Worker,
  stack: Stack,
  qty: number,
  obstacles: Rect[],
): RailPickupPlan {
  const m = MATERIALS[stack.item];
  if (
    !Number.isInteger(qty) ||
    qty < 1 ||
    qty > stack.qty ||
    qty * m.mass > EQUIPMENT[e.kind].capacity
  )
    return {
      reason: 'Requested rail load exceeds the available stock or lifting capacity',
      blockers: [],
    };
  const point = center(stack),
    yaw = stack.yaw || 0,
    blockers = new Set<string>();
  const allPoints = railCrewStandingPoints(stack);
  const workerPoint = allPoints
    .slice()
    .sort((a, b) => dist(crew, a) - dist(crew, b))
    .find((p) => {
      const block = workerMoveBlocked(s, crew, p);
      if (block) {
        blockers.add(block);
        return false;
      }
      return !!walkRoute(s, crew, p, obstacles);
    });
  if (!workerPoint)
    return {
      reason: 'Crew needs access to an exposed rail-panel edge for rigging',
      blockers: [...blockers],
    };
  const faces = staticRailPickupFaces(s, stack, e.kind, obstacles);
  const liftedState = {
    ...s,
    stacks: s.stacks.map((t) =>
      t.id === stack.id ? { ...t, qty: t.qty - qty, reserved: Math.max(0, t.reserved - qty) } : t,
    ),
  };
  const liftedObstacles = obstacles.filter(
    (r) => r !== stack && (r as Rect & { id?: string }).id !== stack.id,
  );
  // The source footprint remains solid when lower panels remain beneath the load.
  if (stack.qty > qty) liftedObstacles.push(stack);
  for (const face of faces) {
    const parked = { ...e, ...face.dock, yaw: face.yaw, reach: face.reach },
      alignedApproach = { ...parked, ...face.approach, reach: 2.7, reverse: false },
      loaded = { ...parked, cargo: { item: stack.item, qty, yaw } };
    const parkedState = {
      ...s,
      equipment: s.equipment.map((other) => (other.id === e.id ? parked : other)),
    };
    const rigPoint = face.workerPoints
      .slice()
      .sort((a, b) => dist(crew, a) - dist(crew, b))
      .find(
        (p) =>
          !workerMoveBlocked(parkedState, crew, p) && !!walkRoute(parkedState, crew, p, obstacles),
      );
    if (!rigPoint) continue;
    for (const pose of [parked, alignedApproach]) {
      const block = equipmentMoveBlocked(s, e, pose);
      if (block) blockers.add(block);
    }
    if (equipmentMoveBlocked(s, e, parked) || equipmentMoveBlocked(s, e, alignedApproach)) continue;
    const direction = {
        x: (face.dock.x - point.x) / face.reach,
        z: (face.dock.z - point.z) / face.reach,
      },
      inward = add(face.dock, direction, -2.5);
    const loadedClear = machineRoute(
      liftedState,
      { ...loaded, reverse: true },
      face.clear,
      liftedObstacles,
      350,
      true,
      face.yaw,
    )
      ? face.clear
      : machineRoute(
            liftedState,
            { ...loaded, reverse: false },
            inward,
            liftedObstacles,
            350,
            true,
            face.yaw,
          )
        ? inward
        : undefined;
    if (!loadedClear) continue;
    if (
      !(
        machineRoute(s, e, face.approach, obstacles, 450, true, face.yaw) ||
        machineRoute(
          s,
          { ...e, reverse: !e.reverse },
          face.approach,
          obstacles,
          450,
          true,
          face.yaw,
        )
      ) ||
      !machineRoute(s, alignedApproach, face.dock, obstacles, 250, true, face.yaw)
    )
      continue;
    return {
      source: {
        stackId: stack.id,
        pose: {
          ...point,
          y:
            (s.paving[`${Math.floor(point.x)},${Math.floor(point.z)}`] ? 0.105 : 0) +
            (stack.baseHeight || 0) +
            Math.max(0, stack.qty - qty) * PITCH,
          yaw,
        },
        dock: face.dock,
        clear: loadedClear,
        approach: face.approach,
        entering: false,
        workerPoint: rigPoint,
      },
      reason: '',
      blockers: [],
    };
  }
  // Include the static obstructions covering otherwise plausible parking faces.
  for (const p of allPoints)
    for (const r of obstacles)
      if (!segmentClear(p, p, [r], 0.32)) {
        const id = (r as Rect & { id?: string }).id;
        if (id && id !== stack.id) blockers.add(id);
      }
  return {
    reason: 'Reserved rail panel needs an accessible lifting face and loaded withdrawal',
    blockers: [...blockers],
  };
}
