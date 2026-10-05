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
