import { packPurchase, orderLines, orderDescription } from './procurement';
export { packPurchase as planPurchaseBatch } from './procurement';
import { tickWorkforce, workerAvailable } from './workforce';
import { recordEquipmentTravel } from './ground-wear';
import { tickRailWork } from './railwork';
import { tickShedConstruction } from './shed-construction';
import {
  constructionSourceBusy,
  syncConstructionLoad,
  tickConstructionHandling,
} from './construction-handling';
import { migrateLegacyRailJobs } from './legacy-rail';
import {
  createJobGroup,
  jobEquipmentAssignment,
  equipmentReservedForJob,
  equipmentCanDoJob,
} from './jobs';
import {
  EQUIPMENT_ROLES,
  EQUIPMENT_ACTIVITIES,
  equipmentActivities,
  equipmentWorkSummary,
  equipmentAllows,
  equipmentRole,
  jobActivity,
} from './equipment-roles';
import { leaveMachine, boardMachine, tickBoarding, machineStep } from './boarding';
import {
  staticObstacleRects,
  equipmentTravelSpeed,
  equipmentSweepBlocked,
  equipmentMoveBlocked,
  workerMoveBlocked,
  navigationActors,
  walkRoute,
  machineRoute,
  equipmentBoxes,
  boxOverlap,
  boxRect,
  people,
  personTouchesBox,
} from './traffic';
import { validateState } from './validate';
import type {
  State,
  Item,
  Role,
  EquipmentKind,
  EquipmentWorkRole,
  Point,
  Rect,
  Worker,
  Equipment,
  Job,
  Order,
  BuildKind,
  Stack,
} from './types';
import {
  MATERIALS,
  BUILDINGS,
  EQUIPMENT,
  ROLES,
  SERVICES,
  footprint,
  label,
  bounds,
} from './catalog';
import { key, overlap, dist, center, route, approach } from './path';
import {
  angleDelta,
  move,
  localPoint,
  turn,
  smoothstep,
  RAIL_STOP,
  roadLength,
  berth,
} from './motion';
import {
  tickDelivery,
  carrierRects,
  requestUnloading,
  migrateRoadDrive,
  constructionStorageClearance,
  syncDeliveryCargo,
} from './delivery';
const PREFIX: Record<string, string> = {
  worker: 'WRK',
  equipment: 'EQ',
  stack: 'STK',
  building: 'BLD',
  rail: 'RAIL',
  job: 'JOB',
  order: 'PO',
  zone: 'ZONE',
  event: 'EV',
  cost: 'COST',
  movement: 'MV',
  notice: 'N',
};
export const id = (s: State, type: string) =>
  `${PREFIX[type] || type}-${String(s.next++).padStart(4, '0')}`;
export function event(s: State, type: string, entity: string, text: string) {
  s.events.push({ id: id(s, 'event'), time: s.time, type, entity, text });
}
export function notice(s: State, title: string, detail: string, entity: string) {
  s.notices.unshift({
    id: id(s, 'notice'),
    time: s.time,
    title,
    detail,
    entity,
    state: 'todo',
    seen: false,
  });
}
export function cost(
  s: State,
  category: string,
  entity: string,
  description: string,
  amount: number,
) {
  s.costs.push({ id: id(s, 'cost'), time: s.time, category, entity, description, amount });
}
export function movement(
  s: State,
  item: Item,
  qty: number,
  from: string,
  to: string,
  reason: string,
) {
  s.movements.push({ id: id(s, 'movement'), time: s.time, item, qty, from, to, reason });
}
export function createState(): State {
  return {
    version: 4,
    name: 'Plant 01',
    time: 7 * 3600,
    elapsed: 0,
    speed: 1,
    paused: false,
    next: 1,
    revision: 1,
    workers: [],
    equipment: [],
    stacks: [],
    buildings: [],
    rails: [],
    paving: {},
    groundWear: {},
    zones: [],
    jobs: [],
    orders: [],
    events: [],
    costs: [],
    movements: [],
    notices: [],
    buffer: { x: 125, z: 5 },
    utilities: { power: false, water: false },
    wageClock: 0,
    guide: true,
  };
}
export const obstacles = (s: State) => [...staticObstacleRects(s), ...carrierRects(s)];
// Choose a work approach whose actual chassis and tools fit beside the target.
// Other machines can occupy an otherwise valid grid cell, so a nearest-point
// perimeter search alone is not enough for a live yard.
function machineApproach(
  s: State,
  e: Equipment,
  target: Rect,
  forwardOnly = false,
): Point[] | null {
  const obs = obstacles(s),
    candidates: Point[] = [];
  for (const gap of [2.5, 3.5]) {
    for (let x = Math.floor(target.x); x < target.x + target.w; x++)
      candidates.push(
        { x: x + 0.5, z: target.z - gap },
        { x: x + 0.5, z: target.z + target.d + gap },
      );
    for (let z = Math.floor(target.z); z < target.z + target.d; z++)
      candidates.push(
        { x: target.x - gap, z: z + 0.5 },
        { x: target.x + target.w + gap, z: z + 0.5 },
      );
  }
  candidates.sort((a, b) => dist(e, a) - dist(e, b));
  for (const p of candidates) {
    let reverse = !!e.reverse;
    let path = machineRoute(s, e, p, pedestrianObstacles(s), 350, true);
    if (!path && !forwardOnly) {
      reverse = !reverse;
      path = machineRoute(s, { ...e, reverse }, p, pedestrianObstacles(s), 350, true);
    }
    if (!path) continue;
    const before = path.length > 1 ? path[path.length - 2] : e;
    const yaw =
      dist(before, p) > 0.01
        ? Math.atan2(p.z - before.z, p.x - before.x) + (reverse ? Math.PI : 0)
        : (e.yaw ?? 0);
    if (equipmentMoveBlocked(s, e, { ...p, yaw })) continue;
    const chassis = equipmentBoxes(e, { ...p, yaw }, false)[0];
    if (
      obs.some((o) =>
        boxOverlap(
          chassis,
          { x: o.x + o.w / 2, z: o.z + o.d / 2, length: o.w, width: o.d, yaw: 0 },
          0.055,
        ),
      )
    )
      continue;
    e.reverse = reverse;
    return path;
  }
  return null;
}
export function setEquipmentRole(s: State, eid: string, role: EquipmentWorkRole): string {
  const e = s.equipment.find((e) => e.id === eid);
  if (!e) return 'Equipment not found.';
  if (typeof role !== 'string' || !Object.hasOwn(EQUIPMENT_ROLES, role))
    return 'Choose a valid equipment work role.';
  if (equipmentRole(e) === role && e.allowedWork === undefined) return '';
  e.workRole = role;
  delete e.allowedWork;
  // The current job or unloading batch retains its crew, cargo, and reservation.
  // Only the next assignment is filtered by the new role.
  event(
    s,
    'Equipment',
    e.id,
    `Automatic work set to ${EQUIPMENT_ROLES[role]}. Current work finishes safely before reassignment.`,
  );
  s.revision++;
  for (const o of s.orders) if (o.status === 'unloading' && !o.unload) o.retryAt = undefined;
  return '';
}
export function setEquipmentActivities(
  s: State,
  eid: string,
  activities: import('./types').EquipmentActivity[],
): string {
  const e = s.equipment.find((e) => e.id === eid);
  if (!e) return 'Equipment not found.';
  if (
    !Array.isArray(activities) ||
    activities.length > 5 ||
    new Set(activities).size !== activities.length ||
    !activities.every(
      (activity) => typeof activity === 'string' && Object.hasOwn(EQUIPMENT_ACTIVITIES, activity),
    )
  )
    return 'Choose valid automatic work kinds.';
  const next = (Object.keys(EQUIPMENT_ACTIVITIES) as import('./types').EquipmentActivity[]).filter(
    (activity) => activities.includes(activity),
  );
  if (JSON.stringify(equipmentActivities(e)) === JSON.stringify(next)) return '';
  e.allowedWork = next;
  e.workRole = next.length === 0 ? 'hold' : next.length === 1 ? next[0] : 'all';
  // Retain all crew, load, and material ownership until the existing operation finishes.
  event(
    s,
    'Equipment',
    e.id,
    `Automatic work set to ${equipmentWorkSummary(e)}. Current work finishes safely before reassignment.`,
  );
  s.revision++;
  for (const o of s.orders) if (o.status === 'unloading' && !o.unload) o.retryAt = undefined;
  return '';
}
export function addZone(s: State, r: Rect, name = 'Stockyard') {
  if (r.w < 3 || r.d < 3) return 'Storage zones must be at least 3 × 3 m.';
  if (r.x < bounds.minX || r.x + r.w > bounds.maxX || r.z < 12 || r.z + r.d > bounds.maxZ)
    return 'Keep storage inside the yard, clear of the transport corridor.';
  if (
    s.zones.some((z) => overlap(z, r)) ||
    s.buildings.some((b) => overlap(b, r)) ||
    s.jobs.some((j) => j.status !== 'canceled' && j.status !== 'done' && overlap(j, r))
  )
    return 'That area overlaps another zone, building, or plan.';
  s.zones.push({ ...r, id: id(s, 'zone'), name });
  s.revision++;
  event(s, 'Planning', '', `Designated ${r.w} × ${r.d} m ${name}.`);
  return '';
}
export function removeZone(s: State, zid: string) {
  const zone = s.zones.find((z) => z.id === zid);
  if (!zone) return 'Stockyard not found.';
  if (
    s.stacks.some((t) => (t.qty > 0 || t.item === 'diesel') && overlap(t, zone)) ||
    s.orders.some((o) => o.allocated && overlap(o.allocated, zone)) ||
    s.jobs.some((j) => j.recoveryStack && overlap(j.recoveryStack, zone))
  )
    return 'This stockyard still holds material or has an incoming reserved load.';
  s.zones = s.zones.filter((z) => z.id !== zid);
  s.revision++;
  event(s, 'Planning', zid, 'Removed the empty stockyard designation.');
  return '';
}

export function allocate(
  s: State,
  item: Item,
  from?: Point,
  accessible?: (r: Rect) => boolean,
): Rect | null {
  const m = MATERIALS[item];
  const clearance = constructionStorageClearance(s);
  for (const zone of s.zones) {
    for (let z = zone.z; z + m.d <= zone.z + zone.d; z++) {
      for (let x = zone.x; x + m.w <= zone.x + zone.w; x++) {
        const r = { x, z, w: m.w, d: m.d };
        if (
          !s.stacks.some((t) => (t.qty > 0 || t.item === 'diesel') && overlap(t, r)) &&
          !s.orders.some((o) => o.allocated && overlap(o.allocated, r)) &&
          !clearance.some((area) => overlap(area, r)) &&
          !s.jobs.some(
            (j) => j.status === 'doing' && j.recoveryStack && overlap(j.recoveryStack, r),
          ) &&
          !s.buildings.some((b) => overlap(b, r)) &&
          !s.equipment.some((e) => overlap({ x: e.x - 1.2, z: e.z - 1.2, w: 2.4, d: 2.4 }, r)) &&
          !s.jobs.some((j) => j.status === 'doing' && overlap(j, r)) &&
          (!from || approach(from, r, obstacles(s), 1.1)) &&
          (!accessible || accessible(r))
        )
          return r;
      }
    }
  }
  return null;
}
export function purchase(
  s: State,
  item: string,
  qty: number,
  mode: 'road' | 'rail' = 'road',
): string[] {
  return purchaseBatch(s, [{ item, qty }], mode);
}
export function purchaseBatch(
  s: State,
  lines: { item: string; qty: number }[],
  mode: 'road' | 'rail' = 'road',
): string[] {
  const loads = packPurchase(lines, mode),
    ids: string[] = [];
  for (const load of loads) {
    const manifest = load.manifest,
      first = manifest[0],
      qty = manifest.reduce((n, line) => n + line.qty, 0),
      oid = id(s, 'order'),
      transport = load.mode === 'rail' ? 240 : 90,
      total =
        transport +
        manifest.reduce((sum, line) => {
          const entry =
            (MATERIALS as any)[line.item] ||
            (EQUIPMENT as any)[line.item] ||
            (ROLES as any)[line.item] ||
            (SERVICES as any)[line.item];
          return sum + entry.price * line.qty;
        }, 0);
    const order: Order = {
      id: oid,
      item: first.item,
      qty,
      arrived: 0,
      ...(manifest.length > 1 ? { manifest } : {}),
      mode: load.mode,
      status: 'ordered',
      eta: s.time + 180 + (s.orders.filter((o) => o.status !== 'done').length % 3) * 45,
      total,
      invoiced: false,
      vehicle: { x: -75, z: load.mode === 'road' ? -13 : 0 },
      stage: 0,
      handler: { x: 20, z: 20 },
      handling: 0,
      note:
        first.item in ROLES
          ? 'Crew bus ordered'
          : 'Transport ordered; site equipment and operator required',
    };
    s.orders.push(order);
    ids.push(oid);
    event(s, 'Order', oid, `Ordered ${orderDescription(order)} by ${load.mode} on one carrier.`);
  }
  s.revision++;
  return ids;
}
export function starterOrder(s: State) {
  purchase(s, 'builder', 2);
  purchase(s, 'operator', 1);
  purchase(s, 'excavator', 1);
  purchase(s, 'slab', 96);
  purchase(s, 'rail', 6, 'rail');
  purchase(s, 'office', 1);
  purchase(s, 'sanitary', 1);
  purchase(s, 'shed', 1);
  purchase(s, 'lamp', 3);
  purchase(s, 'diesel', 1);
  notice(
    s,
    'Starter supplies ordered',
    'Crew, excavator, paving, track, office, sanitary container, shed, lamps and fuel are on their way. Use Stockyard to designate a storage area before materials can be unloaded.',
    s.orders[0].id,
  );
}
export function validPlan(s: State, kind: string, r: Rect, ignoreJobs = false): string {
  if (!BUILDINGS[kind]) return 'Choose a construction tool.';
  if (r.x < -12 || r.x + r.w > 220 || r.z < (kind === 'rail' ? 4 : 12) || r.z + r.d > 110)
    return 'Outside the buildable yard or inside the protected road / railway corridor.';
  if (r.x < -3 && r.z < 25) return 'Keep the crossing and receiving access lane clear.';
  if (kind === 'slab' && s.paving[key(r.x, r.z)]) return 'Already paved.';
  if (s.buildings.some((b) => overlap(b, r))) return 'An existing structure occupies this area.';
  if (s.zones.some((z) => overlap(z, r)) && kind !== 'slab')
    return 'This is a storage zone. Place the structure outside its marked boundary.';
  if (s.stacks.some((t) => (t.qty > 0 || t.item === 'diesel') && overlap(t, r)))
    return 'Stored material occupies the construction area.';
  if (
    s.rails.some((t) =>
      overlap(r, { x: t.x, z: t.z, w: t.rotation % 2 ? 2 : 5, d: t.rotation % 2 ? 5 : 2 }),
    )
  )
    return 'Existing track occupies this area.';
  if (
    !ignoreJobs &&
    s.jobs.some(
      (j) =>
        j.status !== 'done' &&
        j.status !== 'canceled' &&
        j.kind !== 'refuel' &&
        overlap(j, r) &&
        !(kind === 'slab' && j.kind !== 'slab'),
    )
  )
    return 'Another plan occupies this area.';
  return '';
}
function newJob(
  s: State,
  kind: BuildKind | 'refuel' | 'remove',
  r: Rect,
  rotation = 0,
  target?: string,
  parentId?: string,
): Job {
  const j: Job = {
    ...r,
    id: id(s, 'job'),
    kind,
    rotation,
    item: kind in MATERIALS ? (kind as Item) : undefined,
    qty: 1,
    status: 'todo',
    phase: 'Waiting',
    reason: '',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: s.time,
    target,
    parentId,
  };
  s.jobs.push(j);
  return j;
}
export function plan(
  s: State,
  kind: BuildKind,
  x: number,
  z: number,
  rotation = 0,
  foundations = true,
): { job?: Job; error: string } {
  const r = footprint(kind, x, z, rotation),
    error = validPlan(s, kind, r);
  if (error) return { error };
  let parentId: string | undefined;
  if (kind !== 'slab') {
    // Adjacent panels form one stretch, while each remains a real physical job.
    const neighbor =
      kind === 'rail'
        ? s.jobs.find(
            (j) =>
              j.kind === 'rail' &&
              j.rotation === rotation &&
              j.status !== 'canceled' &&
              j.parentId &&
              (rotation % 2
                ? j.x === r.x && Math.abs(j.z - r.z) === 5
                : j.z === r.z && Math.abs(j.x - r.x) === 5),
          )
        : undefined;
    parentId =
      neighbor?.parentId ||
      createJobGroup(s, kind === 'rail' ? 'Extend rail' : `Place ${label(kind)}`, r).id;
    const group = s.jobGroups!.find((g) => g.id === parentId)!;
    const maxX = Math.max(group.x + group.w, r.x + r.w),
      maxZ = Math.max(group.z + group.d, r.z + r.d);
    group.x = Math.min(group.x, r.x);
    group.z = Math.min(group.z, r.z);
    group.w = maxX - group.x;
    group.d = maxZ - group.z;
  }
  if (BUILDINGS[kind]?.foundation && foundations) {
    const foundation = createJobGroup(s, 'Pave foundation', r, parentId);
    for (let dz = 0; dz < r.d; dz++)
      for (let dx = 0; dx < r.w; dx++) {
        const px = r.x + dx,
          pz = r.z + dz;
        if (
          !s.paving[key(px, pz)] &&
          !s.jobs.some(
            (j) => j.kind === 'slab' && j.x === px && j.z === pz && j.status !== 'canceled',
          )
        )
          newJob(s, 'slab', { x: px, z: pz, w: 1, d: 1 }, 0, undefined, foundation.id);
      }
  }
  if (kind === 'rail') {
    for (let px = r.x; px < r.x + r.w; px++)
      for (let pz = r.z; pz < r.z + r.d; pz++)
        if (s.paving[key(px, pz)]) {
          const target = 'pave:' + key(px, pz);
          removeBuilding(s, target);
          const recovery = s.jobs.find(
            (j) =>
              j.kind === 'remove' &&
              j.target === target &&
              j.status !== 'done' &&
              j.status !== 'canceled',
          );
          if (recovery && !recovery.parentId) recovery.parentId = parentId;
        }
  }
  const job = newJob(s, kind, r, rotation, undefined, parentId);
  event(s, 'Planning', job.id, `Planned ${label(kind)} at ${r.x}, ${r.z}.`);
  s.revision++;
  return { job, error: '' };
}
export function pave(s: State, r: Rect) {
  let count = 0;
  let parentId: string | undefined;
  for (let z = r.z; z < r.z + r.d; z++)
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!validPlan(s, 'slab', { x, z, w: 1, d: 1 })) {
        parentId ??= createJobGroup(s, `Pave ${r.w} × ${r.d} m area`, r).id;
        newJob(s, 'slab', { x, z, w: 1, d: 1 }, 0, undefined, parentId);
        count++;
      }
    }
  if (count) {
    event(s, 'Planning', '', `Planned ${count} m² of paving.`);
    s.revision++;
  }
  return count;
}
export function missingMaterials(s: State) {
  const result: Partial<Record<Item, number>> = {};
  for (const j of s.jobs) {
    if (j.item && j.status !== 'done' && j.status !== 'canceled' && !j.delivered && !j.equipment)
      result[j.item] = (result[j.item] || 0) + j.qty;
  }
  for (const item of Object.keys(result) as Item[]) {
    const available = s.stacks
      .filter((t) => t.item === item)
      .reduce((n, t) => n + t.qty - t.reserved, 0);
    const incoming = s.orders
      .filter((o) => o.status !== 'done')
      .flatMap(orderLines)
      .filter((line) => line.item === item)
      .reduce((n, line) => n + line.qty - line.arrived, 0);
    result[item] = Math.max(0, result[item]! - available - incoming);
  }
  return result;
}
export function buyMissing(s: State) {
  let n = 0;
  for (const [item, qty] of Object.entries(missingMaterials(s))) {
    if (qty) {
      purchase(s, item, qty);
      n += qty;
    }
  }
  return n;
}
function pedestrianObstacles(s: State) {
  return staticObstacleRects(s);
}
function stepAside(s: State, w: Worker, e: Equipment) {
  if (
    (w.y || 0) > 0.15 ||
    s.jobs.some((j) => j.worker === w.id && j.status === 'doing' && j.shedAssembly?.ladder)
  )
    return;
  if (w.duty !== 'auto' || w.path.length || w.vehicle || w.transition || w.transportOrder) return;
  const destination = e.path[e.path.length - 1];
  if (dist(w, e) > 8 && (!destination || dist(w, destination) > 5)) return;
  const yaw = e.yaw ?? 0,
    side = { x: -Math.sin(yaw), z: Math.cos(yaw) };
  const obs = pedestrianObstacles(s);
  const away = (w.x - e.x) * side.x + (w.z - e.z) * side.z >= 0 ? 1 : -1;
  const candidates = [away, -away].flatMap((sign) =>
    [3, 4.5, 6].map((distance) => ({
      x: w.x + side.x * distance * sign,
      z: w.z + side.z * distance * sign,
    })),
  );
  // A stock row can block both sideways walks. Search around the machine as
  // well, rather than leaving its crew trapped beside a suspended load.
  const next = e.path[0];
  const targetYaw = next ? Math.atan2(next.z - e.z, next.x - e.x) + (e.reverse ? Math.PI : 0) : yaw;
  const turnDelta = angleDelta(yaw, targetYaw);
  const turnBoxes = Array.from({ length: 13 }, (_, i) =>
    equipmentBoxes(e, { ...e, yaw: yaw + (turnDelta * i) / 12 }),
  ).flat();
  const radial = [5.5, 7, 9]
    .flatMap((radius) =>
      Array.from({ length: 8 }, (_, i) => ({
        x: e.x + Math.cos((i * Math.PI) / 4) * radius,
        z: e.z + Math.sin((i * Math.PI) / 4) * radius,
      })),
    )
    .sort((a, b) => dist(w, a) - dist(w, b));
  candidates.push(...radial);
  for (const target of candidates) {
    if (turnBoxes.some((b) => personTouchesBox(target, b, 0.65)) || workerMoveBlocked(s, w, target))
      continue;
    const path = walkRoute(s, w, target, obs);
    if (path) {
      w.yieldTarget ??= { x: w.x, z: w.z };
      w.yieldingTo = e.id;
      w.path = path;
      w.status = 'Stepping clear of moving equipment';
      return;
    }
  }
}
function tickMove(s: State, p: Worker | Equipment, dt: number, speed: number) {
  if (!p.path.length) {
    p.velocity = 0;
    return;
  }
  const vehicle = 'kind' in p;
  // Yielding is governed by actual swept clearance. Freezing every vehicle
  // within 12 m of a detour can trap the yielding machine behind the very
  // vehicle that needs to move straight away and release its turning room.
  const candidate = { ...p, path: p.path.slice() };
  move(candidate, dt, speed, vehicle);
  const blocker = vehicle
    ? equipmentSweepBlocked(s, p, candidate)
    : workerMoveBlocked(s, p, candidate);
  if (!blocker) {
    const previousPose = { x: p.x, z: p.z, yaw: p.yaw };
    Object.assign(p, {
      x: candidate.x,
      z: candidate.z,
      yaw: candidate.yaw,
      heading: candidate.heading,
      travel: candidate.travel,
      velocity: candidate.velocity,
      path: candidate.path,
    });
    if (vehicle) recordEquipmentTravel(s, p, previousPose);
    if (vehicle && !p.path.length && p.trafficReverse) {
      p.reverse = false;
      p.trafficReverse = undefined;
    }
    if (vehicle && !p.path.length && p.trafficGoal) {
      const goal = p.trafficGoal;
      p.trafficGoal = undefined;
      p.path =
        machineRoute(s, p, goal, pedestrianObstacles(s), 450, true) ||
        machineRoute(
          {
            ...s,
            equipment: s.equipment.filter((q) => q.id === p.id || dist(q, goal) > 4),
            workers: s.workers.filter((q) => q.vehicle || dist(q, goal) > 3),
          },
          p,
          goal,
          pedestrianObstacles(s),
          450,
          true,
        ) ||
        [];
      if (!p.path.length && dist(p, goal) > 0.1) p.trafficGoal = goal;
      if (!p.path.length && !p.job && !p.deliveryOrder) {
        const operator = s.workers.find((w) => w.id === p.operator);
        if (operator) operator.status = 'Available in cab';
      }
    }
    p.blockedBy = undefined;
    p.trafficWait = 0;
    return;
  }
  p.velocity = 0;
  p.blockedBy = blocker;
  p.trafficWait = (p.trafficWait || 0) + dt;
  if (vehicle) {
    const worker = s.workers.find((w) => w.id === blocker);
    if (worker) stepAside(s, worker, p);
  }
  if (s.elapsed < (p.trafficRetry || 0)) return;
  p.trafficRetry = s.elapsed + 1.5;
  const otherMachine = vehicle ? s.equipment.find((e) => e.id === blocker) : undefined;
  // A yielding waypoint can become occupied after the other machine completes
  // its trip. Resume the original destination rather than repeatedly routing
  // into an obsolete escape endpoint beside its parked load and forks.
  const resumeGoal =
    vehicle &&
    p.trafficGoal &&
    otherMachine &&
    !otherMachine.path.length &&
    !otherMachine.work &&
    !otherMachine.job &&
    !otherMachine.deliveryOrder &&
    !otherMachine.transportOrder
      ? p.trafficGoal
      : undefined;
  const goal = resumeGoal || p.path[p.path.length - 1];
  // Replan around stationary people or parked machines; a crossing person simply gets right of way.
  const otherWorker = s.workers.find((w) => w.id === blocker);
  if (vehicle && otherWorker?.path.length) return;
  if (vehicle)
    for (const w of s.workers) {
      if (
        !w.vehicle &&
        equipmentBoxes(p, { ...goal, yaw: p.yaw }).some((b) => personTouchesBox(w, b, 0.5))
      )
        stepAside(s, w, p);
    }
  if (
    vehicle &&
    otherMachine &&
    !otherMachine.cargo &&
    !otherMachine.path.length &&
    !otherMachine.job &&
    !otherMachine.deliveryOrder &&
    !otherMachine.transportOrder &&
    !otherMachine.refueling &&
    otherMachine.fuel > 0
  ) {
    const operator = s.workers.find(
      (w) => w.id === otherMachine.operator && w.vehicle === otherMachine.id && w.duty === 'auto',
    );
    if (operator) {
      const away = Math.atan2(otherMachine.z - p.z, otherMachine.x - p.x);
      for (const offset of [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, 0]) {
        const target = {
          x: otherMachine.x + Math.cos(away + offset) * 5,
          z: otherMachine.z + Math.sin(away + offset) * 5,
        };
        if (
          equipmentBoxes(otherMachine, { ...target, yaw: otherMachine.yaw }).some((a) =>
            equipmentBoxes(p, { ...goal, yaw: p.yaw }).some((b) => boxOverlap(a, b, 0.2)),
          )
        )
          continue;
        for (const reverse of [false, true]) {
          const parking = machineRoute(
            s,
            { ...otherMachine, reverse },
            target,
            pedestrianObstacles(s),
            40,
            true,
          );
          if (parking?.length) {
            otherMachine.path = parking;
            otherMachine.trafficGoal = { ...target };
            otherMachine.reverse = reverse;
            otherMachine.trafficReverse = reverse || undefined;
            otherMachine.trafficWait = 0;
            operator.status = 'Parking clear of traffic';
            p.trafficWait = 0;
            return;
          }
        }
      }
    }
  }
  if (
    vehicle &&
    !p.trafficGoal &&
    otherMachine &&
    (otherMachine.path.length ||
      otherMachine.work ||
      otherMachine.deliveryOrder ||
      otherMachine.job) &&
    // Exactly one actor yields. Two empty machines previously both escaped,
    // immediately restored their opposing goals, and repeated the same turn
    // for hundreds of seconds. Keep one stable priority through the encounter
    // and finish an existing escape before considering another one.
    (Number(!!otherMachine.cargo) > Number(!!p.cargo) ||
      (!!otherMachine.cargo === !!p.cargo && otherMachine.id < p.id))
  ) {
    const away = Math.atan2(p.z - otherMachine.z, p.x - otherMachine.x);
    for (const offset of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
      const target = { x: p.x + Math.cos(away + offset) * 4, z: p.z + Math.sin(away + offset) * 4 };
      for (const reverse of [!!p.reverse, !p.reverse]) {
        const escape = machineRoute(s, { ...p, reverse }, target, pedestrianObstacles(s), 40, true);
        if (escape?.length) {
          p.trafficGoal ??= { ...goal };
          p.path = escape;
          p.reverse = reverse;
          p.trafficReverse = reverse || undefined;
          p.trafficWait = 0;
          return;
        }
      }
    }
  }
  let path = vehicle
    ? machineRoute(s, p, goal, pedestrianObstacles(s), 250, true)
    : walkRoute(s, p, goal, pedestrianObstacles(s));
  if (!path && vehicle) {
    const reverse = !p.reverse;
    path = machineRoute(s, { ...p, reverse }, goal, pedestrianObstacles(s), 250, true);
    if (path?.length) {
      p.reverse = reverse;
      p.trafficReverse = reverse || undefined;
    }
  }
  if (!path && !vehicle) {
    const worker = p as Worker;
    for (const d of [1, 2, 3]) {
      const alternatives = [
        { x: goal.x + d, z: goal.z },
        { x: goal.x - d, z: goal.z },
        { x: goal.x, z: goal.z + d },
        { x: goal.x, z: goal.z - d },
      ];
      for (const target of alternatives) {
        if (workerMoveBlocked(s, worker, target)) continue;
        path = walkRoute(s, p, target, pedestrianObstacles(s));
        if (path) break;
      }
      if (path) break;
    }
  }
  if (path?.length) {
    p.path = path;
    if (resumeGoal) p.trafficGoal = undefined;
    p.trafficWait = 0;
  }
}
function restoreYieldingWorkers(s: State) {
  for (const w of s.workers) {
    if (!w.yieldingTo || w.path.length) continue;
    const e = s.equipment.find((e) => e.id === w.yieldingTo);
    const carrier = s.orders.find((o) => o.id === w.yieldingTo);
    if (carrier && carrier.status !== 'done') continue;
    if (e && (e.path.length || e.blockedBy === w.id)) continue;
    w.yieldingTo = undefined;
    const target = w.yieldTarget;
    w.yieldTarget = undefined;
    if (target && !workerMoveBlocked(s, w, target))
      w.path = walkRoute(s, w, target, pedestrianObstacles(s)) || [];
    w.status = w.path.length ? 'Returning to task' : w.job ? 'Ready at work site' : 'Available';
  }
}
export function moveWorker(s: State, wid: string, p: Point): string {
  const w = s.workers.find((w) => w.id === wid);
  if (!w) return 'Worker not found.';
  if (!workerAvailable(s, w))
    return 'This worker is off shift, commuting, or returning equipment to parking.';
  if (w.transition || w.deliveryOrder || w.transportOrder)
    return 'Finish the delivery assignment before taking control.';
  if (w.job) return 'Finish or cancel the current assignment before taking control.';
  if (w.vehicle) {
    const e = s.equipment.find((e) => e.id === w.vehicle)!;
    const path =
      machineRoute(s, e, p, pedestrianObstacles(s), 450, true) ||
      // A requested parking/movement destination may currently contain an
      // automatic machine that will yield. Ignore only actors at that goal
      // in the preview; every executed swept pose still observes them.
      machineRoute(
        {
          ...s,
          equipment: s.equipment.filter((q) => q.id === e.id || dist(q, p) > 4),
          workers: s.workers.filter((q) => q.vehicle || dist(q, p) > 3),
        },
        e,
        p,
        pedestrianObstacles(s),
        450,
        true,
      );
    if (!path) return 'No clear vehicle route. Leave at least 3 m of access.';
    if (e.fuel <= 0) return 'This machine needs fuel.';
    e.path = path;
  } else {
    const path = walkRoute(s, w, p, pedestrianObstacles(s));
    if (!path) return 'No walking route to that cell.';
    w.path = path;
  }
  w.duty = 'manual';
  w.status = w.vehicle ? 'Driving' : 'Walking';
  return '';
}
export function enterVehicle(s: State, wid: string, eid: string): string {
  const w = s.workers.find((w) => w.id === wid),
    e = s.equipment.find((e) => e.id === eid);
  if (!w || !e) return 'Choose a worker and equipment.';
  if (!workerAvailable(s, w))
    return 'This worker is off shift, commuting, or returning equipment to parking.';
  if (w.vehicle === eid) return '';
  if (w.vehicle) return 'Leave the current vehicle before boarding another.';
  if (w.role !== 'operator') return 'Equipment requires a qualified operator.';
  if (e.transportOrder) return requestUnloading(s, e.transportOrder, w.id, deliveryAPI);
  if (w.transition || w.deliveryOrder || w.transportOrder || e.deliveryOrder)
    return 'This worker or machine is unloading a delivery.';
  if (w.job || e.job || e.operator) return 'This worker or machine is already assigned.';
  if (dist(w, e) > 3) {
    const p = route(w, machineStep(e), obstacles(s), 0.1);
    if (!p) return 'No route to the machine.';
    w.path = p;
    w.status = `Board ${e.id}`;
    w.duty = 'manual';
    return '';
  }
  w.duty = 'manual';
  w.path = [];
  boardMachine(w, e);
  return '';
}
export function exitVehicle(s: State, wid: string) {
  const w = s.workers.find((w) => w.id === wid);
  if (!w || !workerAvailable(s, w) || !w.vehicle || w.job || w.deliveryOrder || w.transportOrder)
    return;
  const e = s.equipment.find((e) => e.id === w.vehicle)!;
  if (e.path.length) return;
  if (w.transition) return;
  leaveMachine(s, w);
}
export function releaseWorker(s: State, wid: string) {
  const w = s.workers.find((w) => w.id === wid);
  if (!w || !workerAvailable(s, w) || w.job || w.deliveryOrder || w.transportOrder) return;
  w.path = [];
  w.duty = 'auto';
  w.status = 'Available';
}
export function refuel(s: State, eid: string) {
  const e = s.equipment.find((e) => e.id === eid);
  if (!e) return 'Equipment not found.';
  if (
    s.jobs.some(
      (j) =>
        j.target === eid && j.kind === 'refuel' && j.status !== 'done' && j.status !== 'canceled',
    )
  )
    return 'Refueling already requested.';
  if (e.fuel >= e.tank - 0.1) return 'Tank is already full.';
  newJob(s, 'refuel', { x: e.x, z: e.z, w: 1, d: 1 }, 0, eid);
  s.revision++;
  return '';
}
function recoveryTarget(s: State, target?: string) {
  if (!target) return undefined;
  if (target.startsWith('pave:')) {
    const k = target.slice(5),
      [x, z] = k.split(',').map(Number);
    if (!s.paving[k]) return undefined;
    return {
      id: target,
      kind: 'slab' as BuildKind,
      x,
      z,
      w: 1,
      d: 1,
      rotation: 0,
      source: s.paving[k] === 'EXISTING' ? 'opening' : s.paving[k],
    };
  }
  const rail = s.rails.find((r) => r.id === target);
  if (rail)
    return {
      ...rail,
      kind: 'rail' as BuildKind,
      w: rail.rotation % 2 ? 2 : 5,
      d: rail.rotation % 2 ? 5 : 2,
      source: rail.id,
    };
  return s.buildings.find((b) => b.id === target);
}
export function removeBuilding(s: State, bid: string) {
  const b = recoveryTarget(s, bid);
  if (!b) return 'Structure or paving not found.';
  if (!(b.kind in MATERIALS))
    return 'Utility service connections cannot be removed in this version.';
  if (
    b.kind === 'slab' &&
    (s.buildings.some((t) => overlap(t, b)) ||
      s.rails.some((r) =>
        overlap({ x: r.x, z: r.z, w: r.rotation % 2 ? 2 : 5, d: r.rotation % 2 ? 5 : 2 }, b),
      ))
  )
    return 'Recover the structure above this paving first.';
  if (
    s.jobs.some(
      (j) =>
        j.target === bid && j.kind === 'remove' && j.status !== 'done' && j.status !== 'canceled',
    )
  )
    return 'Recovery already planned.';
  newJob(s, 'remove', b, b.rotation, bid);
  s.revision++;
  return '';
}
export function recoverAt(s: State, p: Point) {
  const cell = { x: Math.floor(p.x), z: Math.floor(p.z), w: 1, d: 1 };
  const b = s.buildings.find((b) => overlap(b, cell));
  if (b) return removeBuilding(s, b.id);
  const rail = s.rails.find((r) =>
    overlap({ x: r.x, z: r.z, w: r.rotation % 2 ? 2 : 5, d: r.rotation % 2 ? 5 : 2 }, cell),
  );
  if (rail) return removeBuilding(s, rail.id);
  if (s.paving[key(p.x, p.z)]) return removeBuilding(s, 'pave:' + key(p.x, p.z));
  return 'There is no recoverable structure, player-built rail, or paving in this cell.';
}

export function cancelJob(s: State, jid: string) {
  const j = s.jobs.find((j) => j.id === jid);
  if (!j || j.status === 'done' || j.status === 'canceled') return;
  if (j.handling?.state === 'placed' && j.status === 'doing') {
    j.cancel = true;
    j.reason = 'Cancel requested; leave the supported slab safely in place.';
    return;
  }
  if (j.railWork && j.status === 'doing') {
    j.cancel = true;
    j.reason = 'Cancel requested; securing the panel and buffer before stopping.';
    return;
  }
  if (j.kind === 'refuel' && (j.fuelLiters || 0) > 0) {
    j.cancel = true;
    j.reason = 'Finish pouring this service can, then stop refueling.';
    return;
  }
  if (['Withdraw recovered kit', 'Return recovered kit'].includes(j.phase)) {
    j.reason = 'Recovery is already carrying the kit back to storage.';
    return;
  }
  if (j.delivered || s.equipment.find((e) => e.id === j.equipment)?.cargo) {
    j.cancel = true;
    j.reason = 'Cancel requested. The current load will be placed safely before recovery.';
    return;
  }
  finishRelease(s, j);
  j.status = 'canceled';
  j.phase = 'Canceled';
  event(s, 'Work', j.id, 'Plan canceled; unused stock released.');
  s.revision++;
}
function finishRelease(s: State, j: Job) {
  const stack = s.stacks.find((t) => t.id === j.stack);
  if (stack && stack.reserved > 0) stack.reserved = Math.max(0, stack.reserved - j.qty);
  for (const w of s.workers.filter((w) => w.job === j.id)) {
    w.job = j.resumeJob;
    const resume = s.jobs.find((k) => k.id === j.resumeJob);
    w.path = resume ? approach(w, resume, obstacles(s), 0.1) || [] : [];
    w.status = j.resumeJob ? 'Return to installation' : 'Available';
    if (w.vehicle) w.status = 'Available in cab';
  }
  for (const e of s.equipment) if (e.refueling === j.id) e.refueling = undefined;
  for (const e of s.equipment.filter((e) => e.job === j.id)) {
    e.job = undefined;
    e.path = [];
    e.work = 0;
  }
  j.worker = undefined;
  j.operator = undefined;
  j.equipment = undefined;
  j.stack = undefined;
}
function complete(s: State, j: Job) {
  j.status = 'done';
  j.phase = 'Complete';
  j.progress = 1;
  j.finished = s.time;
  j.reason = '';
  finishRelease(s, j);
  event(s, 'Work', j.id, `${label(j.kind)} complete at ${j.x}, ${j.z}.`);
  s.revision++;
  const related = s.notices.find((n) => n.entity === j.id);
  if (related) related.state = 'done';
  if (j.kind !== 'slab')
    notice(
      s,
      `${label(j.kind)} ready`,
      `${j.id} completed. Select the record to inspect its location.`,
      j.id,
    );
}
const deliveryAPI = { id, event, notice, cost, movement, obstacles, allocate };
function advanceOrder(s: State, o: Order, dt: number) {
  tickDelivery(s, o, dt, deliveryAPI);
}
export function unloadDelivery(s: State, oid: string, wid: string) {
  return requestUnloading(s, oid, wid, deliveryAPI);
}
function foundationReady(s: State, j: Job) {
  if (!BUILDINGS[j.kind]?.foundation) return true;
  for (let x = j.x; x < j.x + j.w; x++)
    for (let z = j.z; z < j.z + j.d; z++) if (!s.paving[key(x, z)]) return false;
  return true;
}
function assign(s: State, j: Job) {
  if (j.status !== 'todo') return;
  if (j.retryRevision === s.revision && (j.retryAt || 0) > s.elapsed) return;
  if (j.kind === 'refuel') {
    const e = s.equipment.find((e) => e.id === j.target);
    if (!e) {
      j.reason = 'Equipment no longer exists';
      return;
    }
    if (e.refueling || (e.job && e.fuel > 0.01) || (e.path.length && e.fuel > 0.01)) {
      j.reason = 'Waiting for equipment to stop';
      return;
    }
    if (e.fuel >= e.tank - 0.1) {
      complete(s, j);
      return;
    }
    const stack = s.stacks.find(
      (t) =>
        t.item === 'diesel' &&
        (t.liters || 0) > 0 &&
        !s.jobs.some((k) => k.id !== j.id && k.stack === t.id && k.status === 'doing'),
    );
    const worker =
      s.workers.find(
        (w) =>
          workerAvailable(s, w) &&
          w.duty === 'auto' &&
          !w.job &&
          !w.transition &&
          !w.vehicle &&
          !w.deliveryOrder &&
          !w.transportOrder,
      ) || s.workers.find((w) => w.id === s.jobs.find((k) => k.id === e.job)?.worker);
    if (!stack) {
      j.reason = 'No diesel in storage';
      return;
    }
    if (!worker) {
      j.reason = 'No available worker';
      return;
    }
    const path = approach(worker, stack, obstacles(s), 0.1);
    if (!path) {
      j.reason = 'No access to the diesel drum';
      return;
    }
    j.stack = stack.id;
    j.worker = worker.id;
    j.equipment = e.id;
    j.resumeJob = worker.job;
    e.refueling = j.id;
    if (!e.job) e.job = j.id;
    worker.job = j.id;
    worker.path = path;
    worker.status = 'Collecting fuel';
    j.status = 'doing';
    j.phase = 'Collect fuel';
    j.reason = '';
    return;
  }
  if (j.kind === 'remove') {
    const b = recoveryTarget(s, j.target);
    if (!b) {
      j.reason = 'Structure no longer exists';
      return;
    }
    j.item = b.kind as Item;
    if (!(j.item in MATERIALS)) {
      j.reason = 'Utility connections cannot be removed in this version';
      return;
    }
    j.qty = 1;
  }
  if (j.kind === 'rail') {
    const previous = s.jobs.find(
      (p) =>
        p.kind === 'rail' &&
        p.id !== j.id &&
        p.rotation === j.rotation &&
        (j.rotation % 2 ? p.x === j.x && p.z + 5 === j.z : p.z === j.z && p.x + 5 === j.x) &&
        p.status !== 'done' &&
        p.status !== 'canceled',
    );
    if (previous) {
      j.reason = 'Waiting for preceding rail panel and buffer relocation';
      return;
    }
  }
  if (
    j.kind === 'rail' &&
    Object.keys(s.paving).some((k) => {
      const [x, z] = k.split(',').map(Number);
      return overlap(j, { x, z, w: 1, d: 1 });
    })
  ) {
    j.reason = 'Waiting for existing paving to be recovered';
    return;
  }
  if (!foundationReady(s, j) && j.kind !== 'remove') {
    j.reason = 'Waiting for paved foundations';
    return;
  }
  const installedLegacyRail =
    j.kind === 'rail' &&
    j.legacyRailHandoff === 'installed' &&
    j.delivered &&
    s.rails.some((r) => r.x === j.x && r.z === j.z && r.rotation === j.rotation);
  let stack =
    j.kind === 'remove' || installedLegacyRail
      ? undefined
      : s.stacks.find(
          (t) =>
            t.item === j.item &&
            (j.kind !== 'slab' || !constructionSourceBusy(s, t.id, j.id)) &&
            t.qty - t.reserved >= j.qty &&
            (j.legacyRailHandoff !== 'staged' || t.source === j.id),
        );
  if (!stack && j.kind !== 'remove' && !installedLegacyRail) {
    j.reason = `Need ${j.qty} × ${label(j.item || 'material')}`;
    return;
  }
  const requestedId = jobEquipmentAssignment(s, j).equipmentId;
  const requested = requestedId ? s.equipment.find((e) => e.id === requestedId) : undefined;
  if (requestedId && !requested) {
    j.reason = `Assigned equipment ${requestedId} no longer exists`;
    return;
  }
  if (
    requested &&
    (requested.job ||
      requested.deliveryOrder ||
      requested.transportOrder ||
      requested.refueling ||
      requested.path.length ||
      ['driving', 'boarding', 'aligning'].includes(requested.parkingState || ''))
  ) {
    j.reason = `Waiting for assigned ${requested.id} to finish ${requested.job || requested.deliveryOrder || requested.transportOrder || requested.refueling || 'travel / parking'}`;
    return;
  }
  if (requested && !equipmentCanDoJob(requested, j)) {
    j.reason =
      j.kind === 'shed'
        ? `Assigned ${requested.id} cannot erect the shed; assign an excavator`
        : `Assigned ${requested.id} cannot lift or handle this load`;
    return;
  }
  const worker =
    s.workers.find(
      (w) =>
        w.id === j.preferredWorker &&
        workerAvailable(s, w) &&
        !w.job &&
        !w.transition &&
        !w.vehicle &&
        !w.deliveryOrder &&
        !w.transportOrder &&
        w.role !== 'operator',
    ) ||
    s.workers.find(
      (w) =>
        !w.job &&
        !w.transition &&
        !w.vehicle &&
        !w.deliveryOrder &&
        !w.transportOrder &&
        w.role !== 'operator' &&
        workerAvailable(s, w) &&
        w.duty === 'auto',
    );
  const prefetch =
    !worker &&
    j.kind === 'slab' &&
    s.workers.some(
      (w) =>
        w.role !== 'operator' &&
        workerAvailable(s, w) &&
        (w.id === j.preferredWorker || w.duty === 'auto') &&
        s.jobs.some(
          (k) =>
            k.id === w.job &&
            k.kind === 'slab' &&
            k.status === 'doing' &&
            k.handling?.equipmentReleased &&
            k.handling.phase === 'settle',
        ),
    );
  if (!worker && !prefetch) {
    j.reason = 'Need an available construction worker';
    return;
  }
  const operators = s.workers
    .filter(
      (w) =>
        !w.job &&
        !w.transition &&
        !w.deliveryOrder &&
        !w.transportOrder &&
        w.role === 'operator' &&
        workerAvailable(s, w) &&
        (w.id === j.preferredWorker || w.duty === 'auto'),
    )
    .sort((a, b) => Number(b.id === j.preferredWorker) - Number(a.id === j.preferredWorker));
  if (!operators.length) {
    j.reason = 'Need an available equipment operator';
    return;
  }
  const explicit = jobEquipmentAssignment(s, j).equipmentId;
  const allowed = (e: Equipment) =>
    equipmentReservedForJob(s, e, j) && (explicit === e.id || equipmentAllows(e, jobActivity(j)));
  const mass = MATERIALS[j.item!]?.mass || 1;
  let operator: Worker | undefined, eq: Equipment | undefined;
  for (const candidate of operators) {
    const machines = s.equipment
      .filter(
        (e) =>
          !e.job &&
          !['driving', 'boarding', 'aligning'].includes(e.parkingState || '') &&
          !e.deliveryOrder &&
          !e.transportOrder &&
          !e.refueling &&
          !e.path.length &&
          allowed(e) &&
          (!e.operator || e.operator === candidate.id) &&
          (!['rail', 'shed'].includes(j.kind) || e.kind === 'excavator') &&
          EQUIPMENT[e.kind].capacity >= mass &&
          e.fuel > 0.2,
      )
      .sort((a, b) => Number(b.id === candidate.vehicle) - Number(a.id === candidate.vehicle));
    if (machines.length) {
      operator = candidate;
      eq = machines[0];
      break;
    }
  }
  if (!eq) {
    j.reason = s.equipment.some(
      (e) =>
        !e.job &&
        allowed(e) &&
        (!['rail', 'shed'].includes(j.kind) || e.kind === 'excavator') &&
        EQUIPMENT[e.kind].capacity >= mass &&
        e.fuel <= 0.2,
    )
      ? 'Equipment needs diesel — request refueling'
      : s.equipment.some(
            (e) =>
              (!['rail', 'shed'].includes(j.kind) || e.kind === 'excavator') &&
              EQUIPMENT[e.kind].capacity >= mass,
          ) &&
          !s.equipment.some(
            (e) =>
              allowed(e) &&
              (!['rail', 'shed'].includes(j.kind) || e.kind === 'excavator') &&
              EQUIPMENT[e.kind].capacity >= mass,
          )
        ? `No suitable machine allows ${EQUIPMENT_ROLES[jobActivity(j)].replace(' only', '').toLowerCase()} — change Automatic work in Equipment`
        : j.kind === 'rail'
          ? 'Need an available excavator for rail laying and buffer handling'
          : j.kind === 'shed'
            ? 'Need an available excavator to erect and lift shed components'
            : 'Need available equipment with enough lift capacity';
    return;
  }
  if (!operator) return;
  const oldVehicle =
    operator.vehicle && operator.vehicle !== eq.id
      ? s.equipment.find((e) => e.id === operator!.vehicle)
      : undefined;
  const operatorFrom = oldVehicle ? machineStep(oldVehicle) : operator;
  const obs = obstacles(s),
    workerPath = worker ? approach(worker, j.kind === 'rail' && stack ? stack : j, obs, 0.1) : [],
    operatorPath = operator.vehicle === eq.id ? [] : route(operatorFrom, machineStep(eq), obs, 0.1);
  // Slabs use physical docking in construction-handling after boarding.
  // A generic stock approach would be discarded immediately, and can search
  // the whole yard twice before a busy placement lane is even checked.
  let loadPath = j.kind === 'slab' ? [] : machineApproach(s, eq, stack || j);
  if (stack && !loadPath) {
    for (const alternative of s.stacks.filter(
      (t) =>
        t.item === j.item &&
        (j.kind !== 'slab' || !constructionSourceBusy(s, t.id, j.id)) &&
        t.qty - t.reserved >= j.qty &&
        (j.legacyRailHandoff !== 'staged' || t.source === j.id),
    )) {
      const path = machineApproach(s, eq, alternative);
      if (path) {
        stack = alternative;
        loadPath = path;
        break;
      }
    }
  }
  if (!workerPath || !operatorPath || !loadPath) {
    j.reason = 'No access — leave a 3 m equipment aisle and a walking route';
    j.retryAt = s.elapsed + 5;
    j.retryRevision = s.revision;
    return;
  }
  // Verify the loaded machine can also reach the destination before reserving anything.
  const loadEnd = loadPath[loadPath.length - 1] || eq,
    loadBefore = loadPath.length > 1 ? loadPath[loadPath.length - 2] : eq,
    loadYaw =
      dist(loadBefore, loadEnd) > 0.01
        ? Math.atan2(loadEnd.z - loadBefore.z, loadEnd.x - loadBefore.x) +
          (eq.reverse ? Math.PI : 0)
        : (eq.yaw ?? (eq.heading * Math.PI) / 2);
  if (j.kind !== 'slab' && stack && !machineApproach(s, { ...eq, ...loadEnd, yaw: loadYaw }, j)) {
    j.reason = 'No equipment access to the construction site';
    j.retryAt = s.elapsed + 5;
    j.retryRevision = s.revision;
    return;
  }
  j.worker = worker?.id;
  j.operator = operator.id;
  j.equipment = eq.id;
  j.stack = stack?.id;
  j.status = 'doing';
  j.phase = 'Board equipment';
  j.reason = '';
  j.elapsed = 0;
  if (worker) worker.job = j.id;
  // Rail rigging starts only after the crane is parked and aligned. Preserve
  // an existing step-aside walk, but do not send the crew into its approach.
  if (worker) {
    if (j.kind !== 'rail' && j.kind !== 'slab') worker.path = workerPath;
    worker.status =
      j.kind === 'rail' || j.kind === 'slab'
        ? 'Waiting for equipment to park'
        : 'Walk to installation';
  }
  if (oldVehicle) leaveMachine(s, operator);
  operator.job = j.id;
  operator.path = operatorPath;
  operator.status = 'Board equipment';
  eq.job = j.id;
  if (stack) stack.reserved += j.qty;
  s.revision++;
}
function recoveryDestination(s: State, j: Job, e: Equipment) {
  const clearance = constructionStorageClearance(s);
  const loaded = { ...e, reverse: false, cargo: { item: j.item!, qty: 1 } };
  const returnRoute = (target: Rect) => {
    const probe = { ...loaded, reverse: false };
    const direct = machineApproach(s, probe, target);
    if (!direct) return undefined;
    if (!probe.reverse) return { path: direct, withdrawal: false };
    // The approach planner can find a reverse route when a wide recovered load
    // cannot turn beside its old site. Execute its straight withdrawal in the
    // same gear it was planned in, then drive forward once there is turning room.
    const candidates = [
      direct[0],
      ...[4, 6, 8, 10].map((distance) =>
        localPoint({ ...loaded, yaw: loaded.yaw ?? (loaded.heading * Math.PI) / 2 }, -distance, 0),
      ),
    ];
    for (const clear of candidates) {
      if (!clear || dist(loaded, clear) < 1) continue;
      const facing = loaded.yaw ?? (loaded.heading * Math.PI) / 2;
      if (
        Math.abs(angleDelta(facing + Math.PI, Math.atan2(clear.z - loaded.z, clear.x - loaded.x))) >
        0.005
      )
        continue;
      const withdrawal = machineRoute(
        s,
        { ...loaded, reverse: true },
        clear,
        pedestrianObstacles(s),
        120,
        true,
      );
      if (
        !withdrawal ||
        withdrawal.some(
          (p) =>
            Math.abs(angleDelta(facing + Math.PI, Math.atan2(p.z - loaded.z, p.x - loaded.x))) >
            0.005,
        )
      )
        continue;
      const after = { ...loaded, ...clear, yaw: facing, reverse: false };
      if (machineApproach(s, after, target, true)) return { path: withdrawal, withdrawal: true };
    }
    return undefined;
  };
  for (const stack of s.stacks.filter(
    (t) =>
      t.item === j.item &&
      t.qty > 0 &&
      !clearance.some((area) => overlap(area, t)) &&
      t.qty +
        s.orders
          .filter((o) => o.unload?.mergeId === t.id && o.unload.phase !== 'back-away')
          .reduce((n, o) => n + o.unload!.qty, 0) +
        s.jobs
          .filter((k) => k.id !== j.id && k.status === 'doing' && k.recoveryStack?.id === t.id)
          .reduce((n, k) => n + (k.recoveryStack?.qty || 0), 0) <
        MATERIALS[t.item].max,
  )) {
    const drive = returnRoute(stack);
    if (drive) return { spot: stack as Rect, merge: stack, ...drive };
  }
  let drive: { path: Point[]; withdrawal: boolean } | undefined;
  const spot = allocate(s, j.item!, e, (r) => !!(drive = returnRoute(r)));
  return spot && drive ? { spot, merge: undefined, ...drive } : undefined;
}
function tickJob(s: State, j: Job, dt: number) {
  if (j.status !== 'doing') return;
  let w = s.workers.find((w) => w.id === j.worker);
  const op = s.workers.find((w) => w.id === j.operator),
    e = s.equipment.find((e) => e.id === j.equipment),
    stack = s.stacks.find((t) => t.id === j.stack);
  if (!w && j.kind === 'slab' && e) {
    w = s.workers.find(
      (q) =>
        q.role !== 'operator' &&
        workerAvailable(s, q) &&
        !q.job &&
        !q.transition &&
        !q.vehicle &&
        !q.deliveryOrder &&
        !q.transportOrder &&
        (q.id === j.preferredWorker || q.duty === 'auto'),
    );
    if (w) {
      j.worker = w.id;
      w.job = j.id;
      w.status = 'Waiting for equipment to park';
      s.revision++;
    }
  }
  if (w && j.kind === 'slab' && j.handling?.phase === 'settle') {
    if (w.yieldingTo?.startsWith('PO-')) {
      j.reason = `Waiting for ${w.yieldingTo} to pass safely`;
      return;
    }
    if (j.reason.startsWith('Waiting for PO-') && j.reason.endsWith('to pass safely'))
      j.reason = '';
    tickConstructionHandling(s, j, dt, {
      id,
      obstacles,
      movement,
      event,
      complete,
      release: finishRelease,
    });
    return;
  }
  if (!w && j.kind === 'slab' && e && op) {
    if (op.yieldingTo?.startsWith('PO-') || e.fuel <= 0 || e.refueling) return;
    if (op.vehicle !== e.id) {
      if (!op.path.length && !op.transition) boardMachine(op, e);
      return;
    }
    if (j.phase === 'Board equipment') j.phase = 'Collect material';
    tickConstructionHandling(s, j, dt, {
      id,
      obstacles,
      movement,
      event,
      complete,
      release: finishRelease,
    });
    return;
  }
  if (!w || !e) return;
  if (w.yieldingTo?.startsWith('PO-') || op?.yieldingTo?.startsWith('PO-')) {
    j.reason = `Waiting for ${w.yieldingTo || op?.yieldingTo} to pass safely`;
    return;
  }
  if (j.reason.startsWith('Waiting for PO-') && j.reason.endsWith('to pass safely')) j.reason = '';
  if (j.kind === 'refuel') {
    if (j.phase === 'Collect fuel' && !w.path.length) {
      if (!stack || (stack.liters || 0) <= 0) {
        j.reason = 'Drum empty';
        finishRelease(s, j);
        j.status = 'todo';
        return;
      }
      const p = route(w, machineStep(e), obstacles(s), 0.1);
      if (!p) {
        j.reason = 'No access to machine';
        return;
      }
      j.fuelLiters = Math.min(20, stack.liters || 0, e.tank - e.fuel);
      stack.liters! -= j.fuelLiters;
      w.path = p;
      j.phase = 'Carry fuel';
      w.status = `Carrying ${j.fuelLiters.toFixed(0)} L service can`;
      event(
        s,
        'Fuel',
        j.id,
        `Collected ${j.fuelLiters.toFixed(1)} L from ${stack.id} into the service can.`,
      );
    } else if (j.phase === 'Carry fuel' && !w.path.length) {
      j.elapsed += dt;
      j.progress = Math.min(1, j.elapsed / 6);
      if (j.elapsed >= 6) {
        const liters = j.fuelLiters || 0;
        e.fuel += liters;
        j.fuelLiters = 0;
        event(
          s,
          'Fuel',
          e.id,
          `Transferred ${liters.toFixed(1)} L from ${stack!.id} using a service can.`,
        );
        if (!j.cancel && e.fuel < e.tank - 0.1 && (stack!.liters || 0) > 0) {
          w.path = approach(w, stack!, obstacles(s), 0.1) || [];
          j.phase = 'Collect fuel';
          j.elapsed = 0;
        } else complete(s, j);
      }
    }
    return;
  }
  if (!op) return;
  syncConstructionLoad(s, j);
  if (e.refueling) {
    j.reason = 'Refueling in progress';
    return;
  }
  if (e.fuel <= 0) {
    j.reason = 'Out of fuel — request refueling in the equipment inspector.';
    return;
  }
  if (
    !j.railWork &&
    !j.handling &&
    !e.trafficGoal &&
    (e.trafficWait || 0) > 2 &&
    e.path.length &&
    ['Collect material', 'Carry to site', 'Return recovered kit'].includes(j.phase) &&
    (s.equipment.some(
      (q) =>
        q.id !== e.id &&
        !q.path.length &&
        !q.job &&
        !q.deliveryOrder &&
        equipmentBoxes(e, { ...e.path[e.path.length - 1], yaw: e.yaw }).some((a) =>
          equipmentBoxes(q).some((b) => boxOverlap(a, b, 0.06)),
        ),
    ) ||
      pedestrianObstacles(s).some((r) =>
        boxOverlap(
          equipmentBoxes(e, { ...e.path[e.path.length - 1], yaw: e.yaw })[0],
          { x: r.x + r.w / 2, z: r.z + r.d / 2, yaw: 0, length: r.w, width: r.d },
          0.06,
        ),
      ))
  ) {
    const target =
      j.phase === 'Collect material'
        ? stack || j
        : j.phase === 'Return recovered kit'
          ? j.recoveryStack
          : j;
    const next = target && machineApproach(s, e, target);
    if (next) {
      e.path = next;
      e.trafficGoal = undefined;
      e.trafficWait = 0;
      e.trafficRetry = s.elapsed + 3;
      j.reason = '';
    }
  }
  if (
    j.kind === 'rail' &&
    tickRailWork(s, j, dt, { id, obstacles, movement, event, complete, release: finishRelease })
  )
    return;
  if (
    j.kind === 'slab' &&
    tickConstructionHandling(s, j, dt, {
      id,
      obstacles,
      movement,
      event,
      complete,
      release: finishRelease,
    })
  )
    return;
  if (
    tickShedConstruction(s, j, dt, {
      id,
      obstacles,
      movement,
      event,
      complete,
      release: finishRelease,
    })
  )
    return;
  if (j.phase === 'Board equipment' && !op.path.length) {
    if (op.transition) return;
    if (op.vehicle !== e.id) {
      boardMachine(op, e);
      return;
    }
    const target = stack || j;
    e.path = j.kind === 'slab' ? [] : machineApproach(s, e, target) || [];
    j.phase = 'Collect material';
    op.status = 'Driving to stock';
  } else if (j.phase === 'Collect material' && !e.path.length) {
    j.elapsed += dt;
    e.work = 1;
    op.status = 'Lifting';
    if (j.elapsed >= 2.5) {
      j.elapsed = 0;
      e.work = 0;
      if (j.kind === 'remove') {
        j.phase = 'Recover structure';
        return;
      }
      if (!stack || stack.qty < j.qty) {
        j.reason = 'Reserved stock unavailable';
        return;
      }
      stack.qty -= j.qty;
      stack.reserved -= j.qty;
      e.cargo = { item: j.item!, qty: j.qty };
      j.assetId = stack.assetId;
      movement(s, j.item!, j.qty, stack.id, e.id, 'Construction pickup');
      j.stack = undefined;
      const p = machineApproach(s, e, j);
      if (!p) {
        j.reason = 'Route blocked after pickup';
        j.phase = 'Route blocked';
        return;
      }
      e.path = p;
      j.phase = 'Carry to site';
      op.status = 'Transporting material';
      s.revision++;
    }
  } else if (j.phase === 'Route blocked') {
    const p = machineApproach(s, e, j);
    if (p) {
      e.path = p;
      j.phase = 'Carry to site';
      j.reason = '';
    }
  } else if (j.phase === 'Carry to site' && !e.path.length) {
    j.phase = 'Install';
    j.elapsed = 0;
    op.status = 'Placing material';
  } else if ((j.phase === 'Install' || j.phase === 'Recover structure') && !w.path.length) {
    e.work = 1;
    w.status = j.kind === 'remove' ? 'Dismantling' : 'Installing';
    j.elapsed += dt;
    const duration = MATERIALS[j.item!]?.work || 8;
    j.progress = Math.min(1, j.elapsed / duration);
    if (j.progress >= 1) {
      e.work = 0;
      if (j.kind === 'remove') {
        const load = equipmentBoxes({ ...e, cargo: { item: j.item!, qty: 1 } }).at(-1)!;
        const nearby = s.workers.find(
          (person) => !person.vehicle && personTouchesBox(person, load, 0.6),
        );
        if (nearby) {
          j.reason = `Waiting for ${nearby.name} to step clear before lifting the recovered kit`;
          if (
            (nearby.duty === 'auto' || nearby.id === j.worker) &&
            !nearby.path.length &&
            !nearby.transition
          ) {
            const away = Math.atan2(nearby.z - load.z, nearby.x - load.x);
            for (const offset of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
              const clear = {
                x: nearby.x + Math.cos(away + offset) * 3.5,
                z: nearby.z + Math.sin(away + offset) * 3.5,
              };
              if (personTouchesBox(clear, load, 0.7)) continue;
              const p = walkRoute(s, nearby, clear, pedestrianObstacles(s));
              if (p) {
                nearby.path = p;
                nearby.status = 'Stepping clear of recovered load';
                break;
              }
            }
          }
          return;
        }
        j.reason = '';
        const destination = recoveryDestination(s, j, e);
        if (!destination) {
          j.reason = 'Recovery needs accessible storage space';
          return;
        }
        const { spot, merge, path, withdrawal } = destination;
        const b = recoveryTarget(s, j.target)!;
        if (b.kind === 'slab') delete s.paving[key(b.x, b.z)];
        else if (b.kind === 'rail') {
          s.rails = s.rails.filter((t) => t.id !== b.id);
          const start = b.rotation % 2 ? { x: b.x + 1, z: b.z } : { x: b.x, z: b.z + 1 };
          const end = {
            x: start.x + (b.rotation % 2 ? 0 : 5),
            z: start.z + (b.rotation % 2 ? 5 : 0),
          };
          if (dist(s.buffer, end) < 0.1) {
            s.buffer = start;
            event(
              s,
              'Asset',
              'BUFFER-001',
              'Recovered the last extension panel and secured the buffer at the shortened siding end.',
            );
          }
        } else s.buildings = s.buildings.filter((t) => t.id !== b.id);
        movement(
          s,
          j.item!,
          1,
          b.id,
          e.id,
          b.source === 'opening' ? 'Opening asset recovered' : 'Dismantled',
        );
        const t: Stack = {
          ...spot,
          id: merge?.id || id(s, 'stack'),
          item: j.item!,
          qty: 1,
          reserved: 0,
          source: j.id,
          assetId: b.kind === 'slab' || b.kind === 'rail' ? undefined : b.id,
        }; // Load the recovered kit, then haul it before it enters stock.
        e.cargo = { item: j.item!, qty: 1 };
        j.phase = withdrawal ? 'Withdraw recovered kit' : 'Return recovered kit';
        j.recoveryStack = t;
        e.reverse = withdrawal;
        e.path = path;
        s.revision++;
        return;
      }
      movement(
        s,
        j.item!,
        j.qty,
        e.id,
        j.cancel ? 'Recovered at site' : j.id,
        j.cancel ? 'Canceled construction' : 'Installed',
      );
      e.cargo = undefined;
      j.delivered = true;
      if (j.cancel) {
        s.stacks.push({
          x: j.x,
          z: j.z,
          w: MATERIALS[j.item!].w,
          d: MATERIALS[j.item!].d,
          id: id(s, 'stack'),
          item: j.item!,
          qty: j.qty,
          reserved: 0,
          source: j.id,
          assetId: j.assetId,
        });
        finishRelease(s, j);
        j.status = 'canceled';
        j.phase = 'Canceled; kit left at site';
        s.revision++;
        return;
      }
      if (j.kind === 'slab') s.paving[key(j.x, j.z)] = j.id;
      else if (j.kind === 'rail') {
        s.rails.push({ id: id(s, 'rail'), x: j.x, z: j.z, rotation: j.rotation, length: 5 });
        const start = j.rotation % 2 ? { x: j.x + 1, z: j.z } : { x: j.x, z: j.z + 1 };
        if (dist(start, s.buffer) < 0.1) {
          j.phase = 'Relocate buffer';
          j.elapsed = 0;
          w.status = 'Unfastening buffer';
          return;
        }
      } else {
        s.buildings.push({
          id: j.assetId || id(s, 'building'),
          kind: j.kind as BuildKind,
          x: j.x,
          z: j.z,
          w: j.w,
          d: j.d,
          rotation: j.rotation,
          name: label(j.kind),
          source: j.id,
          connected:
            j.kind === 'lamp'
              ? s.utilities.power
              : j.kind === 'sanitary'
                ? s.utilities.water
                : true,
        });
      }
      complete(s, j);
    }
  } else if (j.phase === 'Relocate buffer') {
    j.elapsed += dt;
    e.work = 1;
    const start = j.rotation % 2 ? { x: j.x + 1, z: j.z } : { x: j.x, z: j.z + 1 };
    const f = Math.max(0, Math.min(1, (j.elapsed - 2) / 4));
    s.buffer = {
      x: start.x + (j.rotation % 2 ? 0 : 5 * f),
      z: start.z + (j.rotation % 2 ? 5 * f : 0),
    };
    if (j.elapsed >= 8) {
      event(
        s,
        'Asset',
        'BUFFER-001',
        'Relocated and fastened the existing buffer at the extended siding end.',
      );
      complete(s, j);
    }
  } else if (j.phase === 'Withdraw recovered kit' && !e.path.length) {
    e.reverse = false;
    const path = machineApproach(s, e, j.recoveryStack!, true);
    if (!path) {
      j.reason = 'Waiting for a clear forward route from the withdrawal position';
      return;
    }
    e.path = path;
    j.phase = 'Return recovered kit';
    j.reason = '';
  } else if (j.phase === 'Return recovered kit' && !e.path.length) {
    let t = j.recoveryStack!;
    if (dist(e, center(t)) > Math.max(t.w, t.d) / 2 + 3.6) {
      let path = machineApproach(s, e, t, true);
      if (!path) {
        const destination = recoveryDestination(s, j, e);
        if (destination) {
          t = j.recoveryStack = {
            ...t,
            ...destination.spot,
            id: destination.merge?.id || id(s, 'stack'),
            qty: t.qty,
            reserved: 0,
            source: j.id,
          };
          path = destination.path;
          e.reverse = destination.withdrawal;
          if (destination.withdrawal) j.phase = 'Withdraw recovered kit';
          s.revision++;
        }
      }
      e.path = path || [];
      j.reason = e.path.length ? '' : 'Waiting for an accessible return position in storage';
      return;
    }
    const existing = s.stacks.find((k) => k.id === t.id);
    if (existing) existing.qty += t.qty;
    else s.stacks.push(t);
    j.recoveryStack = undefined;
    e.cargo = undefined;
    movement(s, t.item, 1, j.id, t.id, 'Recovered structure');
    complete(s, j);
  }
}
export function tick(s: State, dt: number) {
  if (s.paused) return;
  s.elapsed += dt;
  s.time += dt;
  s.wageClock += dt;
  for (const o of s.orders) advanceOrder(s, o, dt);
  tickWorkforce(s, dt, deliveryAPI);
  for (const w of s.workers) {
    if (w.shiftPhase === 'home' || w.shiftPhase === 'returning' || w.shiftPhase === 'aboard')
      continue;
    w.hours += dt / 3600;
    if (w.transition) tickBoarding(s, w, dt);
    else if (!w.transportOrder && !w.vehicle) tickMove(s, w, dt, 1.7);
    if (w.status.startsWith('Board EQ') && !w.path.length && !w.vehicle) {
      const eid = w.status.slice(6);
      enterVehicle(s, w.id, eid);
    }
    if (w.vehicle) {
      const e = s.equipment.find((e) => e.id === w.vehicle);
      if (e) {
        w.x = e.x;
        w.z = e.z;
      }
    } else if (
      !w.job &&
      !w.deliveryOrder &&
      !w.transportOrder &&
      !w.transition &&
      !w.path.length &&
      !w.status.startsWith('Board') &&
      (!w.shiftPhase || w.shiftPhase === 'working') &&
      !w.parkingEquipment
    )
      w.status = w.duty === 'rest' ? 'Resting' : 'Available';
  }
  for (const e of s.equipment) {
    if (e.fuel < 10 && !e.lowFuelWarned) {
      e.lowFuelWarned = true;
      notice(
        s,
        'Equipment fuel low',
        `${e.id} has ${e.fuel.toFixed(1)} L remaining. Request refueling before its tank runs dry.`,
        e.id,
      );
    }
    if (e.fuel > 15) e.lowFuelWarned = false;
    if (e.blockedBy) {
      const blocker = s.workers.find((w) => w.id === e.blockedBy);
      if (blocker && dist(blocker, e) < 8) stepAside(s, blocker, e);
      else if (blocker) e.blockedBy = undefined;
    }
    if (e.transportOrder) continue;
    const active = e.path.length > 0 || e.work > 0;
    if (active && e.fuel > 0 && !e.refueling) {
      const used = Math.min(e.fuel, dt * (e.work ? 0.014 : 0.008));
      e.fuel -= used;
      e.used += used;
      tickMove(s, e, dt, equipmentTravelSpeed(s, e));
    }
    if (e.operator) {
      const w = s.workers.find((w) => w.id === e.operator);
      if (w) {
        w.x = e.x;
        w.z = e.z;
        w.y = e.y || 0;
        w.yaw = e.yaw;
      }
    }
  }
  syncDeliveryCargo(s);
  for (const o of s.orders) {
    const c = o.contractor;
    if (!c || c.phase === 'seated' || !c.path.length) continue;
    const candidate = { ...c, path: c.path.slice() };
    move(candidate, dt, 1.7);
    const blocker = workerMoveBlocked(s, c, candidate);
    if (!blocker) Object.assign(c, candidate);
    else {
      c.velocity = 0;
      if (s.elapsed >= (c.trafficRetry || 0)) {
        c.trafficRetry = s.elapsed + 1.5;
        c.path = walkRoute(s, c, c.path[c.path.length - 1], pedestrianObstacles(s)) || c.path;
      }
    }
  }
  restoreYieldingWorkers(s);
  for (const j of s.jobs) tickJob(s, j, dt);
  // Scheduling is deliberately slower than movement; pathfinding is only needed when assignments change.
  if (Math.floor((s.elapsed - dt) * 2) !== Math.floor(s.elapsed * 2)) {
    const queued = s.jobs
      .filter((j) => j.status === 'todo')
      .map((job) => ({ job, assignment: jobEquipmentAssignment(s, job) }));
    queued.sort(
      (a, b) =>
        (b.assignment.priority || 0) - (a.assignment.priority || 0) ||
        Number(!!b.assignment.equipmentId) - Number(!!a.assignment.equipmentId),
    );
    for (const { job } of queued) assign(s, job);
  }
  if (s.wageClock >= 900) {
    const intervals = Math.floor(s.wageClock / 900);
    s.wageClock %= 900;
    for (const w of s.workers.filter(
      (w) => !['home', 'returning', 'aboard'].includes(w.shiftPhase || ''),
    ))
      cost(
        s,
        'Labor',
        w.id,
        `${w.name} · ${intervals * 15} min on site`,
        w.wage * 0.25 * intervals,
      );
  }
}
export function totals(s: State, item: Item) {
  return {
    inConstruction: s.jobs.filter(
      (j) => j.status === 'doing' && j.kind === item && j.delivered && j.shedAssembly,
    ).length,
    stored: s.stacks.filter((t) => t.item === item).reduce((n, t) => n + t.qty, 0),
    reserved: s.stacks.filter((t) => t.item === item).reduce((n, t) => n + t.reserved, 0),
    cargo: s.equipment
      .filter((e) => e.cargo?.item === item)
      .reduce((n, e) => n + (e.cargo?.qty || 0), 0),
    incoming: s.orders
      .flatMap(orderLines)
      .filter((line) => line.item === item)
      .reduce((n, line) => n + line.qty - line.arrived, 0),
    delivered: s.orders
      .flatMap(orderLines)
      .filter((line) => line.item === item)
      .reduce((n, line) => n + line.arrived, 0),
    recovered: s.movements
      .filter((m) => m.item === item && m.reason === 'Opening asset recovered')
      .reduce((n, m) => n + m.qty, 0),
    installed:
      item === 'slab'
        ? Object.values(s.paving).filter((v) => v !== 'EXISTING').length
        : item === 'rail'
          ? s.rails.length
          : s.buildings.filter((b) => b.kind === item && b.source !== 'opening').length,
  };
}
export function save(s: State) {
  return JSON.stringify(s);
}
export function load(json: string): State {
  if (json.length > 50_000_000) throw new Error('Save exceeds the 50 MB import limit.');
  let s: unknown;
  try {
    s = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  validateState(s);
  if (s.version === 1) {
    // Version 1 stored the lower corner of a four-cell track envelope.
    // Shrink around the same centerline, including in-progress construction.
    for (const r of s.rails) {
      if (r.rotation % 2) r.x += 1;
      else r.z += 1;
    }
    for (const j of s.jobs) {
      if (
        j.kind !== 'rail' &&
        !(j.kind === 'remove' && (j.item === 'rail' || j.target?.startsWith('RAIL-')))
      )
        continue;
      if (j.rotation % 2) {
        j.x += 1;
        j.w = 2;
      } else {
        j.z += 1;
        j.d = 2;
      }
    }
    if (
      !s.workers.length &&
      !s.equipment.length &&
      !s.buildings.length &&
      !s.stacks.length &&
      !s.orders.length &&
      !s.jobs.length
    )
      s.zones = s.zones.filter((z) => z.id !== 'ZONE-RECEIVING');
    s.version = 2;
  }
  if (s.version < 3) {
    s.workers.forEach((w, i) => {
      w.name = `Worker #${i + 1}`;
      w.y = 0;
      w.yaw ??= (w.heading * Math.PI) / 2;
    });
    s.equipment.forEach((e) => {
      e.y = 0;
      e.yaw ??= (e.heading * Math.PI) / 2;
    });
    for (const o of s.orders) {
      if (o.status === 'done' || o.status === 'ordered') continue;
      if (!(o.item in MATERIALS)) o.mode = 'road';
      const b = berth(o);
      o.vehicle = { x: b.x, z: b.z };
      o.drive = {
        distance: o.mode === 'rail' ? RAIL_STOP : roadLength(o),
        velocity: 0,
        yaw: b.yaw,
        travel: 0,
      };
      if (o.status === 'approaching') o.status = 'unloading';
      o.allocated = undefined;
      o.handlerPath = undefined;
      o.handlingStage = undefined;
      o.cargoQty = undefined;
      o.note = 'Delivery resumed at berth; waiting for site equipment and operator';
    }
    s.version = 3;
  }
  if (s.version < 4) migrateLegacyRailJobs(s, { release: finishRelease, event });
  s.version = 4;
  s.groundWear ??= {};
  for (const order of s.orders) migrateRoadDrive(s, order);
  s.revision++;
  return s;
}

export function demoState(): State {
  const s = createState();
  s.zones.push({ id: 'ZONE-RECEIVING', name: 'Receiving stockyard', x: 24, z: 26, w: 27, d: 24 });
  s.name = 'Birch Junction';
  s.time = 10 * 3600;
  s.guide = true;
  for (const role of ['builder', 'builder', 'operator', 'operator', 'engineer'] as Role[]) {
    s.workers.push({
      id: id(s, 'worker'),
      name: `Worker #${s.workers.length + 1}`,
      role,
      x: 17.5 + s.workers.length,
      z: 23.5,
      path: [],
      duty: 'auto',
      status: 'Available',
      hours: 0,
      wage: ROLES[role].wage,
      heading: 0,
    });
  }
  for (const kind of ['excavator', 'forklift'] as EquipmentKind[])
    s.equipment.push({
      id: id(s, 'equipment'),
      kind,
      x: 16.5,
      z: 29.5 + s.equipment.length * 6,
      path: [],
      fuel: EQUIPMENT[kind].tank,
      tank: EQUIPMENT[kind].tank,
      used: 0,
      heading: 2,
      work: 0,
    });
  for (let x = 4; x < 22; x++) for (let z = 31; z < 51; z++) s.paving[key(x, z)] = 'EXISTING';
  s.buildings.push(
    {
      id: id(s, 'building'),
      kind: 'office',
      x: 5,
      z: 33,
      w: 6,
      d: 3,
      rotation: 0,
      name: 'Site office',
      source: 'opening',
      connected: true,
    },
    {
      id: id(s, 'building'),
      kind: 'sanitary',
      x: 5,
      z: 38,
      w: 3,
      d: 2,
      rotation: 0,
      name: 'WC / showers',
      source: 'opening',
      connected: true,
    },
    {
      id: id(s, 'building'),
      kind: 'shed',
      x: 12,
      z: 43,
      w: 8,
      d: 6,
      rotation: 0,
      name: 'Machine shelter',
      source: 'opening',
      connected: true,
    },
    {
      id: id(s, 'building'),
      kind: 'lamp',
      x: 20,
      z: 33,
      w: 1,
      d: 1,
      rotation: 0,
      name: 'Yard light 01',
      source: 'opening',
      connected: true,
    },
  );
  s.utilities = { power: true, water: true };
  for (const [item, n] of Object.entries({
    slab: 72,
    rail: 8,
    office: 1,
    sanitary: 1,
    shed: 1,
    lamp: 4,
    diesel: 2,
    fence: 8,
  }) as [Item, number][]) {
    let remaining = n;
    const source = id(s, 'order');
    s.orders.push({
      id: source,
      item,
      qty: n,
      arrived: n,
      mode: 'road',
      status: 'done',
      eta: s.time,
      total: MATERIALS[item].price * n + 90,
      invoiced: true,
      vehicle: { x: 300, z: 18 },
      stage: 0,
      handler: { x: 0, z: 0 },
      handling: 0,
      note: 'Example yard opening stock',
    });
    cost(s, 'Opening stock', source, `${n} × ${label(item)}`, MATERIALS[item].price * n + 90);
    while (remaining > 0) {
      const spot = allocate(s, item);
      if (!spot) break;
      const qty = Math.min(remaining, MATERIALS[item].max);
      const t: Stack = { ...spot, id: id(s, 'stack'), item, qty, reserved: 0, source };
      if (item === 'diesel') t.liters = 200;
      s.stacks.push(t);
      movement(s, item, qty, source, t.id, 'Opening stock');
      remaining -= qty;
    }
  }
  cost(s, 'Opening assets', 'SITE', 'Example buildings, utilities, paving and equipment', 113000);
  event(
    s,
    'Site',
    'SITE',
    'Example yard opened. All existing infrastructure is recorded as opening assets.',
  );
  notice(
    s,
    'Welcome to Birch Junction',
    'A working example with crew, equipment and physical stock. Build freely or start an empty yard from the menu.',
    'SITE',
  );
  return s;
}
