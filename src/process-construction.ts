import type {
  Building,
  Equipment,
  Item,
  Job,
  Point,
  ProcessAssembly,
  RailWorkPose,
  Rect,
  State,
  Worker,
} from './types';
import { requestActionClearance, clearActionClearance } from './action-clearance';
import { reconcileProcessAssets } from './process-fluids';
import type { RailWorkAPI } from './railwork';
import { BUILDINGS, MATERIALS } from './catalog';
import { angleDelta, localPoint, mixAngle, smoothstep, turn } from './motion';
import { center, dist, overlap } from './path';
import {
  boxRect,
  boxOverlap,
  people,
  machineRoute,
  equipmentBoxes,
  equipmentReachBlocked,
  equipmentSweepBlocked,
  personTouchesBox,
  walkRoute,
} from './traffic';

export const PROCESS_KINDS = [
  'processTank',
  'transferPump',
  'processPipe',
  'pipeElbow',
  'pipeTee',
  'processValve',
  'processGauge',
] as const;
export function isProcessKind(kind: string): boolean {
  return (PROCESS_KINDS as readonly string[]).includes(kind);
}
export interface ProcessComponent {
  kind: string;
  pose: RailWorkPose;
  size: [number, number, number];
}
/** Local component origins match the native assembly models, including their real support heights. */
export function processComponentDefinitions(
  j: Rect & { kind: string; rotation: number },
): ProcessComponent[] {
  const local: [string, number, number, number, [number, number, number]][] =
    j.kind === 'processTank'
      ? [
          ['base', 0, 0.11, 0, [3.7, 0.22, 3.7]],
          ['shell0', 0, 0.77, 0, [3.4, 1.1, 3.4]],
          ['shell1', 0, 1.87, 0, [3.4, 1.1, 3.4]],
          ['shell2', 0, 2.97, 0, [3.4, 1.1, 3.4]],
          ['roof', 0, 3.52, 0, [3.5, 0.22, 3.5]],
          ['fittings', 0, 0, 0, [3.7, 4.55, 3.7]],
        ]
      : j.kind === 'transferPump'
        ? [
            ['base', 0, 0.09, 0, [1.8, 0.18, 1.8]],
            ['motor', -0.42, 0.51, -0.5, [0.7, 0.65, 0.65]],
            ['pump', 0.3, 0.47, -0.5, [0.65, 0.6, 0.6]],
            ['manifold', 0, 0, 0, [1.8, 1.1, 1.8]],
          ]
        : [
            ['support', 0, 0, 0, [0.32, 0.85, 0.32]],
            ['fitting', 0, 0.85, 0, [1, 0.22, 1]],
            ['connections', 0, 0.85, 0, [1, 0.24, 1]],
          ];
  const yaw = ((j.kind === 'processTank' ? 0 : j.rotation) * Math.PI) / 2,
    c = center(j);
  return local.map(([kind, x, y, z, size]) => ({
    kind,
    size,
    pose: {
      x: c.x + x * Math.cos(yaw) - z * Math.sin(yaw),
      z: c.z + x * Math.sin(yaw) + z * Math.cos(yaw),
      y,
      yaw,
    },
  }));
}
export function processComponentIds(kind: string, assetId: string): Record<string, string> {
  return Object.fromEntries(
    processComponentDefinitions({ kind, x: 0, z: 0, w: 1, d: 1, rotation: 0 }).map((p) => [
      p.kind,
      `${assetId}/${p.kind}`,
    ]),
  );
}
export function processAssemblyRender(j: Job) {
  const h = j.processAssembly;
  if (!h) return undefined;
  return {
    ...h,
    jobId: j.id,
    assetId: j.assetId,
    kind: j.kind,
    x: j.x,
    z: j.z,
    w: j.w,
    d: j.d,
    rotation: j.rotation,
    components: processComponentDefinitions(j).map((p, index) => ({
      ...p,
      id: h.componentIds[p.kind],
      installed: index < h.completed,
    })),
  };
}
const labels: Record<ProcessAssembly['phase'], string> = {
  unpack: 'Lower and unpack process equipment kit',
  rig: 'Rig process component',
  lift: 'Lift process component',
  lower: 'Position process component',
  fasten: 'Fasten and seal process component',
  inspect: 'Inspect completed process equipment',
  recover: 'Recover installed process components',
  repack: 'Repack process equipment kit',
};
const copy = (p: RailWorkPose): RailWorkPose => ({ ...p });
function transition(s: State, j: Job, phase: ProcessAssembly['phase']) {
  const h = j.processAssembly!;
  h.phase = phase;
  h.clock = 0;
  h.workerPoint = undefined;
  j.phase = labels[phase];
  j.reason = '';
  s.revision++;
}
function interpolate(a: RailWorkPose, b: RailWorkPose, t: number): RailWorkPose {
  const f = smoothstep(t);
  return {
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    y: a.y + (b.y - a.y) * f,
    yaw: mixAngle(a.yaw, b.yaw, f),
  };
}
function surface(s: State, p: Point) {
  return s.paving[`${Math.floor(p.x)},${Math.floor(p.z)}`]?.length ? 0.105 : 0;
}
function tool(s: State, e: Equipment, y: number): RailWorkPose {
  return { ...localPoint(e, e.reach || 2.7, 0), y: surface(s, e) + y, yaw: e.yaw || 0 };
}
function moveHelper(
  s: State,
  j: Job,
  w: Worker,
  e: Equipment,
  target: Point,
  api: RailWorkAPI,
  clearance = 1.1,
): boolean {
  const h = j.processAssembly!;
  if (w.path.length) return false;
  if (h.workerPoint && dist(w, h.workerPoint) < 0.15) return true;
  const toward = Math.atan2(target.z - e.z, target.x - e.x);
  for (const radius of [clearance, clearance + 1, clearance + 2])
    for (const offset of [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI]) {
      const p = {
        x: target.x + Math.cos(toward + offset) * radius,
        z: target.z + Math.sin(toward + offset) * radius,
      };
      if (equipmentBoxes(e).some((b) => personTouchesBox(p, b, 0.65))) continue;
      // The installer never stands inside the tank or pump being erected.
      if (
        h.completed > 0 &&
        p.x > j.x - 0.25 &&
        p.x < j.x + j.w + 0.25 &&
        p.z > j.z - 0.25 &&
        p.z < j.z + j.d + 0.25
      )
        continue;
      const path = walkRoute(s, w, p, api.obstacles(s));
      if (path) {
        h.workerPoint = p;
        w.path = path;
        w.status = 'Walk to process assembly point';
        return !path.length;
      }
    }
  j.reason = 'Need clear pedestrian access to the process assembly';
  return false;
}
function align(
  s: State,
  j: Job,
  e: Equipment,
  w: Worker,
  target: Point,
  dt: number,
  api: RailWorkAPI,
): boolean {
  const desired = Math.atan2(target.z - e.z, target.x - e.x),
    yaw = (e.yaw || 0) + Math.max(-dt * 1.1, Math.min(dt * 1.1, angleDelta(e.yaw || 0, desired)));
  const assembly = j.processAssembly!,
    part = assembly.part,
    definition = part && processComponentDefinitions(j)[part.index];
  const checked: Equipment =
    definition && ['lift', 'lower'].includes(assembly.phase)
      ? {
          ...e,
          assemblyLoad: {
            job: j.id,
            kind: 'roof',
            length: definition.size[0],
            width: definition.size[2],
            yawOffset: angleDelta(e.yaw || 0, part!.pose.yaw),
          },
        }
      : e;
  const blocker = equipmentSweepBlocked(s, checked, { ...e, yaw });
  if (blocker) {
    e.blockedBy = blocker;
    j.reason = requestActionClearance(s, {
      ownerId: j.id,
      requesterEquipmentId: e.id,
      blockerId: blocker,
      action: 'Turn process lifting equipment',
      envelopes: Array.from({ length: 13 }, (_, i) =>
        equipmentBoxes(checked, { ...e, yaw: mixAngle(e.yaw || 0, desired, i / 12) }),
      ).flat(),
    }).reason;
    if (blocker === w.id) {
      j.processAssembly!.workerPoint = undefined;
      moveHelper(s, j, w, e, target, api, Math.max(j.w, j.d) / 2 + 2.2);
    }
    return false;
  }
  e.blockedBy = undefined;
  e.work = 1;
  if (!turn(e, desired, dt, 1.1)) return false;
  const reach = dist(e, target),
    old = e.reach || 2.7,
    next = old + Math.max(-dt, Math.min(dt, reach - old));
  const obstruction = equipmentReachBlocked(s, checked, next);
  if (obstruction && obstruction !== j.id + '-process') {
    j.reason = requestActionClearance(s, {
      ownerId: j.id,
      requesterEquipmentId: e.id,
      blockerId: obstruction,
      action: 'Position process lifting tools',
      envelopes: equipmentBoxes({ ...checked, reach: next }),
    }).reason;
    if (obstruction === w.id) {
      j.processAssembly!.workerPoint = undefined;
      moveHelper(s, j, w, e, target, api, Math.max(j.w, j.d) / 2 + 2.2);
    }
    return false;
  }
  e.reach = next;
  return Math.abs(next - reach) < 0.005;
}
/** The component's real next horizontal footprint is reserved before lifting
 * or lowering. External idle actors yield through the same durable action
 * request used by equipment turns; the installer keeps its explicit work pose. */
function componentClearance(s: State, j: Job, e: Equipment, pose: RailWorkPose) {
  const part = j.processAssembly!.part!,
    definition = processComponentDefinitions(j)[part.index];
  const envelope = { ...pose, length: definition.size[0], width: definition.size[2] };
  const blocker =
    people(s).find((p) => personTouchesBox(p, envelope, 0.42))?.id ||
    s.equipment.find(
      (other) =>
        other.id !== e.id &&
        !other.transportOrder &&
        equipmentBoxes(other).some((box) => boxOverlap(box, envelope, 0.08)),
    )?.id;
  if (!blocker) {
    clearActionClearance(s, j.id);
    return true;
  }
  j.reason = requestActionClearance(s, {
    ownerId: j.id,
    requesterEquipmentId: e.id,
    blockerId: blocker,
    action: `Position process ${part.kind}`,
    envelopes: [envelope, ...equipmentBoxes(e)],
  }).reason;
  return false;
}
function selectPart(s: State, j: Job) {
  const h = j.processAssembly!,
    parts = processComponentDefinitions(j),
    index = h.recovering ? h.completed - 1 : h.completed,
    p = parts[index];
  if (!p) {
    transition(s, j, h.recovering ? 'repack' : 'inspect');
    return;
  }
  const stored = { ...h.kitPose, y: h.kitPose.y + 0.15 };
  h.part = {
    index,
    kind: p.kind,
    pose: copy(h.recovering ? p.pose : stored),
    from: copy(h.recovering ? p.pose : stored),
    to: copy(h.recovering ? stored : p.pose),
  };
  transition(s, j, h.recovering ? 'recover' : 'rig');
}
function finishCanceled(s: State, j: Job, api: RailWorkAPI) {
  const h = j.processAssembly!,
    m = MATERIALS[j.item!],
    yaw = h.kitPose.yaw,
    rotated = Math.abs(Math.sin(yaw)) > 0.5;
  const w = rotated ? m.d : m.w,
    d = rotated ? m.w : m.d,
    id = api.id(s, 'stack');
  s.stacks.push({
    id,
    item: j.item!,
    qty: 1,
    reserved: 0,
    x: h.kitPose.x - w / 2,
    z: h.kitPose.z - d / 2,
    w,
    d,
    yaw,
    source: j.id,
    assetId: j.assetId,
  });
  api.movement(s, j.item!, 1, j.id, id, 'Canceled process assembly repacked into its original kit');
  h.part = undefined;
  h.completed = 0;
  j.delivered = false;
  clearActionClearance(s, j.id);
  api.release(s, j);
  j.status = 'canceled';
  j.phase = 'Canceled; process kit repacked at site';
  j.finished = s.time;
  j.reason = '';
  s.revision++;
}
/** The existing scheduler physically collects and carries the intact kit before this takes ownership. */
export function tickProcessConstruction(s: State, j: Job, dt: number, api: RailWorkAPI): boolean {
  if (!isProcessKind(j.kind)) return false;
  const e = s.equipment.find((q) => q.id === j.equipment),
    w = s.workers.find((q) => q.id === j.worker),
    op = s.workers.find((q) => q.id === j.operator);
  if (!e || !w || !op || op.vehicle !== e.id) return !!j.processAssembly;
  if (!j.processAssembly) {
    if (j.phase !== 'Install' || !e.cargo || e.path.length) return false;
    j.assetId ||= api.id(s, 'building');
    j.processAssembly = {
      phase: 'unpack',
      clock: 0,
      completed: 0,
      recovering: false,
      kitPose: tool(s, e, e.lift || 1.1),
      componentIds: processComponentIds(j.kind, j.assetId),
    };
    j.phase = labels.unpack;
    s.revision++;
  }
  const h = j.processAssembly!;
  e.work = 0;
  j.reason = '';
  op.status = labels[h.phase];
  if (e.path.length) {
    if (h.phase === 'unpack') h.kitPose = tool(s, e, h.kitPose.y);
    j.reason = 'Waiting for process assembly equipment to stop safely';
    return true;
  }
  if (h.phase === 'unpack') {
    const c = center(j),
      material = MATERIALS[j.item!];
    const stageReach = Math.hypot(3.76, 2.6) / 2 + Math.hypot(material.w, material.d) / 2 + 0.6;
    if (!h.dock) {
      const candidates = [Math.max(j.w, j.d) / 2 + 3.5, Math.max(j.w, j.d) / 2 + 5]
        .flatMap((radius) =>
          [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((angle) => ({
            x: c.x + Math.cos(angle) * radius,
            z: c.z + Math.sin(angle) * radius,
          })),
        )
        .sort((a, b) => dist(e, a) - dist(e, b));
      for (const dock of candidates) {
        const yaw = Math.atan2(c.z - dock.z, c.x - dock.x),
          kit = localPoint({ ...dock, yaw }, stageReach, 0),
          rect = boxRect({ ...kit, yaw, length: material.w, width: material.d }, 0);
        if (api.obstacles(s).some((o) => overlap(rect, o))) continue;
        const path = machineRoute(s, e, dock, api.obstacles(s), 350, true, yaw);
        if (!path) continue;
        h.dock = dock;
        e.path = path;
        break;
      }
      if (!h.dock) {
        j.reason = 'Need a clear process assembly dock with room to turn and unpack';
        return true;
      }
    }
    if (dist(e, h.dock) > 0.12) {
      const path = machineRoute(s, e, h.dock, api.obstacles(s), 350, true);
      if (path) e.path = path;
      else h.dock = undefined;
      return true;
    }
    if (
      Math.abs(angleDelta(e.yaw || 0, Math.atan2(c.z - e.z, c.x - e.x))) > 0.025 &&
      !align(s, j, e, w, c, dt, api)
    ) {
      h.kitPose = tool(s, e, h.kitPose.y);
      return true;
    }
    // Keep the unpacked bundle outside the full chassis turning sweep.
    const stagePoint = localPoint(e, stageReach, 0);
    const aligned = align(s, j, e, w, stagePoint, dt, api);
    h.kitPose = { ...tool(s, e, h.kitPose.y), y: h.kitPose.y };
    if (!aligned) return true;
    if (!moveHelper(s, j, w, e, h.kitPose, api)) return true;
    h.clock += dt;
    e.work = 1;
    w.status = 'Release transport straps and unpack process kit';
    h.kitPose.y = Math.max(surface(s, h.kitPose) + 0.15, h.kitPose.y - dt * 0.3);
    e.lift = h.kitPose.y;
    if (h.clock < 4) return true;
    e.cargo = undefined;
    j.delivered = true;
    api.movement(s, j.item!, 1, e.id, j.id, 'Process kit unpacked at the actual construction site');
    if (j.cancel) {
      h.recovering = true;
      transition(s, j, 'repack');
    } else selectPart(s, j);
    return true;
  }
  if (j.cancel && !h.recovering && h.phase !== 'repack') {
    // Finish an airborne placement before unbolting; never lose a component on cancel.
    if (!['lift', 'lower', 'fasten'].includes(h.phase)) {
      h.recovering = true;
      h.part = undefined;
      selectPart(s, j);
      return true;
    }
  }
  if (h.phase === 'inspect') {
    if (!moveHelper(s, j, w, e, center(j), api, Math.max(j.w, j.d) / 2 + 0.8)) return true;
    h.clock += dt;
    w.status = 'Inspect seals, anchors and identification plate';
    if (h.clock < 6) return true;
    const b: Building = {
      id: j.assetId!,
      kind: j.kind as Item,
      x: j.x,
      z: j.z,
      w: j.w,
      d: j.d,
      rotation: j.rotation,
      connected: true,
      name: MATERIALS[j.item!].name.replace(' kit', ''),
      source: j.id,
      componentIds: { ...h.componentIds },
    };
    s.buildings.push(b);
    reconcileProcessAssets(s);
    api.event(s, 'Asset', b.id, 'Process equipment assembled, fastened and inspected by the crew.');
    clearActionClearance(s, j.id);
    api.complete(s, j);
    return true;
  }
  if (h.phase === 'repack') {
    if (!moveHelper(s, j, w, e, h.kitPose, api)) return true;
    h.clock += dt;
    w.status = 'Repack and strap recovered process components';
    if (h.clock >= 5) finishCanceled(s, j, api);
    return true;
  }
  const part = h.part!;
  if (h.phase === 'recover') {
    if (!moveHelper(s, j, w, e, part.from, api, Math.max(j.w, j.d) / 2 + 0.8)) return true;
    h.clock += dt;
    e.work = 1;
    const height = Math.max(0, part.from.y - 1.15),
      climb = height / 0.7;
    if (height > 0) h.ladder = { x: w.x, z: w.z, height: height + 1.2 };
    w.y =
      height > 0
        ? height * smoothstep(Math.min(h.clock / climb, (2 * climb + 4 - h.clock) / climb))
        : 0;
    w.status =
      h.clock < climb
        ? 'Climb process assembly ladder'
        : h.clock > climb + 4
          ? 'Climb down from process assembly ladder'
          : 'Unbolt and rig installed process component';
    if (h.clock < 2 * climb + 4) return true;
    w.y = 0;
    h.ladder = undefined;
    h.completed--;
    part.from = copy(part.pose);
    transition(s, j, 'lift');
    return true;
  }
  if (h.phase === 'rig') {
    if (h.clock < 3) {
      if (!moveHelper(s, j, w, e, h.kitPose, api, 1.3)) return true;
      h.clock += dt;
      w.status = 'Rig process component and release packing';
      return true;
    }
    const clearance = Math.hypot(j.w, j.d) / 2 + 0.9;
    if (h.workerPoint && dist(h.workerPoint, part.from) < clearance - 0.01)
      h.workerPoint = undefined;
    if (!moveHelper(s, j, w, e, part.from, api, clearance)) return true;
    transition(s, j, 'lift');
    return true;
  }
  const travelY = Math.max(part.from.y, part.to.y, 1.3) + 0.6;
  if (h.phase === 'lift') {
    if (!align(s, j, e, w, part.from, dt, api)) return true;
    const proposed = interpolate(part.from, { ...part.from, y: travelY }, (h.clock + dt) / 3);
    if (!componentClearance(s, j, e, proposed)) return true;
    h.clock += dt;
    e.work = 1;
    part.pose = proposed;
    e.lift = part.pose.y;
    if (h.clock >= 3) {
      part.from = copy(part.pose);
      transition(s, j, 'lower');
    }
    return true;
  }
  if (h.phase === 'lower') {
    const desired = Math.atan2(part.to.z - e.z, part.to.x - e.x);
    if (h.clock === 0 && Math.abs(angleDelta(e.yaw || 0, desired)) > 0.025) {
      const clearance =
        Math.max(dist(e, part.from), dist(e, part.to)) + Math.hypot(j.w, j.d) / 2 + 1;
      if (h.workerPoint && dist(h.workerPoint, e) < clearance - 0.05) h.workerPoint = undefined;
      if (!moveHelper(s, j, w, e, e, api, clearance)) return true;
    }
    // The carried component follows the actual turning tool continuously.
    const old = copy(part.pose);
    if (!align(s, j, e, w, part.to, dt, api)) {
      const p = tool(s, e, travelY);
      part.pose = { ...p, yaw: mixAngle(old.yaw, part.to.yaw, Math.min(1, dt)) };
      return true;
    }
    if (
      h.clock === 0 &&
      h.workerPoint &&
      dist(h.workerPoint, part.to) > Math.max(j.w, j.d) / 2 + 1.8
    )
      h.workerPoint = undefined;
    if (!moveHelper(s, j, w, e, part.to, api, Math.max(j.w, j.d) / 2 + 0.8)) return true;
    if (h.clock === 0) part.from = copy(part.pose);
    const proposed = interpolate(part.from, part.to, (h.clock + dt) / 3);
    if (!componentClearance(s, j, e, proposed)) return true;
    h.clock += dt;
    e.work = 1;
    part.pose = proposed;
    e.lift = part.pose.y;
    if (h.clock >= 3) transition(s, j, 'fasten');
    return true;
  }
  if (h.phase === 'fasten') {
    if (!moveHelper(s, j, w, e, part.to, api, Math.max(j.w, j.d) / 2 + 0.8)) return true;
    h.clock += dt;
    const height = h.recovering ? 0 : Math.max(0, part.to.y - 1.15),
      climb = height / 0.7,
      fasten = 4;
    if (height > 0) h.ladder = { x: w.x, z: w.z, height: height + 1.2 };
    w.y = height * smoothstep(Math.min(h.clock / climb, (2 * climb + fasten - h.clock) / climb));
    if (height === 0) w.y = 0;
    w.status =
      h.clock < climb
        ? 'Climb process assembly ladder'
        : h.clock > climb + fasten
          ? 'Climb down from process assembly ladder'
          : h.recovering
            ? 'Secure recovered process component in bundle'
            : 'Tighten process anchors and flange bolts';
    w.yaw = Math.atan2(part.to.z - w.z, part.to.x - w.x);
    if (h.clock < 2 * climb + fasten) return true;
    w.y = 0;
    h.ladder = undefined;
    if (!h.recovering) h.completed++;
    api.event(
      s,
      'Work',
      j.id,
      `${h.recovering ? 'Recovered' : 'Fastened'} ${h.componentIds[part.kind]}.`,
    );
    h.part = undefined;
    j.progress = h.completed / processComponentDefinitions(j).length;
    if (j.cancel) h.recovering = true;
    selectPart(s, j);
    return true;
  }
  return true;
}
export function processConstructionProblem(s: State): string | undefined {
  const pose = (p: any) =>
    p &&
    ['x', 'z', 'y', 'yaw'].every(
      (k) => typeof p[k] === 'number' && Number.isFinite(p[k]) && Math.abs(p[k]) < 10000,
    );
  for (const b of s.buildings.filter((b) => isProcessKind(b.kind))) {
    const definition = BUILDINGS[b.kind];
    if (
      !Number.isInteger(b.rotation) ||
      b.rotation < 0 ||
      b.rotation > 3 ||
      b.w !== definition.w ||
      b.d !== definition.d
    )
      return 'invalid process equipment footprint or orientation';
    const expected = processComponentIds(b.kind, b.id);
    if (
      !b.componentIds ||
      JSON.stringify(Object.keys(expected).sort()) !==
        JSON.stringify(Object.keys(b.componentIds).sort()) ||
      Object.entries(expected).some(([k, id]) => b.componentIds![k] !== id)
    )
      return 'invalid process component identities';
  }
  for (const j of s.jobs)
    if (j.processAssembly) {
      const h = j.processAssembly,
        parts = processComponentDefinitions(j),
        ids = processComponentIds(j.kind, j.assetId || '');
      if (
        !isProcessKind(j.kind) ||
        !j.assetId ||
        !(h.phase in labels) ||
        typeof h.recovering !== 'boolean' ||
        !Number.isFinite(h.clock) ||
        h.clock < 0 ||
        !Number.isInteger(h.completed) ||
        h.completed < 0 ||
        h.completed > parts.length ||
        !pose(h.kitPose) ||
        !h.componentIds ||
        Object.keys(ids).length !== Object.keys(h.componentIds).length ||
        Object.entries(ids).some(([k, id]) => h.componentIds[k] !== id)
      )
        return 'invalid process assembly';
      if (
        (h.phase === 'inspect' && h.completed !== parts.length) ||
        (h.phase === 'repack' && h.completed !== 0) ||
        (h.phase === 'unpack' && (h.completed !== 0 || h.part))
      )
        return 'invalid process assembly sequence';
      if (
        h.part &&
        (!Number.isInteger(h.part.index) ||
          !parts[h.part.index] ||
          parts[h.part.index].kind !== h.part.kind ||
          ![h.part.pose, h.part.from, h.part.to].every(pose))
      )
        return 'invalid process assembly component';
      if (
        h.ladder &&
        (!pose({ ...h.ladder, y: h.ladder.height, yaw: 0 }) ||
          h.ladder.height < 0 ||
          h.ladder.height > 6)
      )
        return 'invalid process assembly ladder';
      if (h.part && h.part.index !== (h.phase === 'recover' ? h.completed - 1 : h.completed))
        return 'invalid process component sequence';
      if (h.dock && (!Number.isFinite(h.dock.x) || !Number.isFinite(h.dock.z)))
        return 'invalid process assembly dock';
      if (h.workerPoint && (!Number.isFinite(h.workerPoint.x) || !Number.isFinite(h.workerPoint.z)))
        return 'invalid process crew position';
      if (
        j.status === 'doing' &&
        h.phase !== 'unpack' &&
        (!j.delivered || s.equipment.some((e) => e.id === j.equipment && !!e.cargo))
      )
        return 'invalid process kit ownership';
      if (
        j.status === 'doing' &&
        ['rig', 'lift', 'lower', 'fasten', 'recover'].includes(h.phase) &&
        !h.part
      )
        return 'missing active process component';
    }
}
