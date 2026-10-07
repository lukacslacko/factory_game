import type {
  Equipment,
  Job,
  Point,
  RailWorkPose,
  ShedAssembly,
  ShedPartKind,
  State,
  Worker,
} from './types';
import type { RailWorkAPI } from './railwork';
import { shedComponentPose, shedPostPoints, shedPartLimits, shedPartSize } from './shed-geometry';
import { angleDelta, localPoint, mixAngle, smoothstep, turn } from './motion';
import { center, dist, segmentClear } from './path';
import {
  boxOverlap,
  equipmentBoxes,
  equipmentReachBlocked,
  equipmentSweepBlocked,
  machineRoute,
  people,
  personTouchesBox,
  walkRoute,
} from './traffic';

import { requestActionClearance, clearActionClearance } from './action-clearance';
import { engineShedComponentIds, engineShedParkingLocation } from './engine-shed';
const countKey = {
  post: 'posts',
  beam: 'beams',
  roof: 'roofSheets',
  wall: 'wallPanels',
  brace: 'braces',
} as const;
const labels: Record<ShedAssembly['phase'], string> = {
  stage: 'Carry shed kit to assembly supports',
  unpack: 'Lower and unpack shed kit',
  anchor: 'Set and bolt shed base anchors',
  collect: 'Approach unpacked shed components',
  rig: 'Rig shed component with construction worker',
  lift: 'Lift shed component',
  carry: 'Carry shed component to its foundation',
  lower: 'Position shed component',
  fasten: 'Fasten and brace shed component',
  complete: 'Complete',
  withdraw: 'Withdraw and stow shed lifting tools',
};
const copy = (p: RailWorkPose): RailWorkPose => ({ x: p.x, z: p.z, y: p.y, yaw: p.yaw });
const surface = (s: State, p: Point) =>
  s.paving[`${Math.floor(p.x)},${Math.floor(p.z)}`] ? 0.105 : 0;
const travelHeight = (kind: ShedPartKind) =>
  ['post', 'wall', 'brace'].includes(kind) ? 2.35 : 1.25;
const storedHeight = (kind: ShedPartKind) =>
  kind === 'post' ? 2.15 : ['wall', 'brace'].includes(kind) ? 2 : kind === 'beam' ? 0.6 : 0.35;
const toolPoint = (s: State, e: Equipment, kind: ShedPartKind, j?: Job): RailWorkPose => ({
  ...localPoint(e, e.reach || 3.2, 0),
  y:
    surface(s, e) +
    travelHeight(kind) +
    (j?.kind === 'engineShed' && ['post', 'wall'].includes(kind) ? 0.6 : 0),
  yaw: (e.yaw || 0) + (['beam', 'wall', 'brace'].includes(kind) ? Math.PI / 2 : 0),
});
function loadEnvelope(
  j: Job,
  e: Equipment,
  part: NonNullable<ShedAssembly['part']>,
): NonNullable<Equipment['assemblyLoad']> {
  const size = shedPartSize(j, part.kind, part.index);
  return {
    job: j.id,
    kind: part.kind,
    length: size[0],
    width: size[1],
    yawOffset: angleDelta(e.yaw || 0, part.pose.yaw),
  };
}
function transition(s: State, j: Job, phase: ShedAssembly['phase']) {
  const h = j.shedAssembly!;
  h.phase = phase;
  h.clock = 0;
  h.dock = undefined;
  h.workerPoint = undefined;
  if (phase !== 'fasten') h.ladder = undefined;
  j.phase = labels[phase];
  j.reason = '';
  s.revision++;
}
function interpolate(p: RailWorkPose, a: RailWorkPose, b: RailWorkPose, t: number) {
  const f = smoothstep(t);
  p.x = a.x + (b.x - a.x) * f;
  p.z = a.z + (b.z - a.z) * f;
  p.y = a.y + (b.y - a.y) * f;
  p.yaw = mixAngle(a.yaw, b.yaw, f);
}
function requestShedClearance(
  s: State,
  j: Job,
  e: Equipment,
  blockerId: string,
  action: string,
  envelopes: ReturnType<typeof equipmentBoxes>,
) {
  const result = requestActionClearance(s, {
    ownerId: j.id,
    requesterEquipmentId: e.id,
    blockerId,
    action,
    envelopes,
  });
  j.reason = result.reason;
}
function turnEnvelope(e: Equipment, yaw: number) {
  return Array.from({ length: 13 }, (_, i) =>
    equipmentBoxes(e, { ...e, yaw: mixAngle(e.yaw || 0, yaw, i / 12) }),
  ).flat();
}
function yieldWorker(s: State, w: Worker, e: Equipment, api: RailWorkAPI) {
  if (w.path.length || w.transition || w.vehicle || w.duty !== 'auto') return;
  for (const radius of [3.5, 5, 7])
    for (let k = 0; k < 8; k++) {
      const p = {
        x: w.x + Math.cos((k * Math.PI) / 4) * radius,
        z: w.z + Math.sin((k * Math.PI) / 4) * radius,
      };
      if (equipmentBoxes(e).some((b) => personTouchesBox(p, b, 0.8))) continue;
      const path = walkRoute(s, w, p, api.obstacles(s));
      if (path) {
        w.path = path;
        w.status = 'Step clear of shed lifting equipment';
        return;
      }
    }
}
/** Execute a checked route and checked turn; no construction phase can relocate a chassis. */
function approachComponent(
  s: State,
  j: Job,
  e: Equipment,
  w: Worker,
  target: Point,
  api: RailWorkAPI,
): boolean {
  const h = j.shedAssembly!;
  if (e.path.length) return false;
  if (!h.dock) {
    const angles = [Math.PI / 2, -Math.PI / 2, 0, Math.PI];
    const obstacles = api.obstacles(s);
    const candidates = [3.6, 4.5, 5.5]
      .flatMap((radius) =>
        angles.map((a) => ({
          x: target.x + Math.cos(a) * radius,
          z: target.z + Math.sin(a) * radius,
        })),
      )
      .sort((a, b) => dist(e, a) - dist(e, b));
    for (const p of candidates) {
      // Reserve clearance for the whole final chassis turn, rather than
      // accepting a route that parks safely but cannot face the load.
      if (!segmentClear(p, p, obstacles, e.kind === 'excavator' ? 2.4 : 2)) continue;
      for (const reverse of [!!e.reverse, !e.reverse]) {
        const path = machineRoute(s, { ...e, reverse }, p, api.obstacles(s), 350, true);
        if (!path) continue;
        h.dock = p;
        e.path = path;
        e.reverse = reverse;
        break;
      }
      if (h.dock) break;
    }
    if (!h.dock) {
      j.reason = 'Need a clear equipment approach to the shed component';
      return false;
    }
  }
  if (dist(e, h.dock) > 0.12) {
    const path = machineRoute(s, e, h.dock, api.obstacles(s), 350, true);
    if (!path) {
      h.dock = undefined;
      j.reason = 'Shed component approach blocked';
      return false;
    }
    e.path = path;
    return false;
  }
  const desired = Math.atan2(target.z - e.z, target.x - e.x);
  const next = (e.yaw || 0) + Math.max(-0.15, Math.min(0.15, angleDelta(e.yaw || 0, desired)));
  const blocker = equipmentSweepBlocked(s, e, { ...e, yaw: next });
  if (blocker) {
    requestShedClearance(s, j, e, blocker, 'Turn shed lifting equipment', turnEnvelope(e, desired));
    if (blocker === w.id) yieldWorker(s, w, e, api);
    return false;
  }
  // tick uses a fixed 0.1-second step; the caller supplies its actual delta below.
  return Math.abs(angleDelta(e.yaw || 0, desired)) < 0.025;
}
function align(
  s: State,
  j: Job,
  e: Equipment,
  w: Worker,
  target: Point,
  dt: number,
  api: RailWorkAPI,
) {
  if (!approachComponent(s, j, e, w, target, api)) {
    if (!e.path.length && j.shedAssembly!.dock && dist(e, j.shedAssembly!.dock!) < 0.12) {
      const desired = Math.atan2(target.z - e.z, target.x - e.x);
      const pose = {
        ...e,
        yaw:
          (e.yaw || 0) + Math.max(-dt * 1.4, Math.min(dt * 1.4, angleDelta(e.yaw || 0, desired))),
      };
      if (!equipmentSweepBlocked(s, e, pose)) turn(e, desired, dt, 1.4);
    }
    return false;
  }
  const reach = dist(e, target);
  const current = e.reach ?? 2.7;
  const nextReach = current + Math.max(-dt, Math.min(dt, reach - current));
  const blocker = equipmentReachBlocked(s, e, nextReach);
  if (blocker) {
    requestShedClearance(
      s,
      j,
      e,
      blocker,
      'Position shed lifting tools',
      equipmentBoxes({ ...e, reach: nextReach }),
    );
    if (blocker === w.id) yieldWorker(s, w, e, api);
    return false;
  }
  clearActionClearance(s, j.id);
  e.reach = nextReach;
  return Math.abs(nextReach - reach) < 0.001;
}
function walkToWork(
  s: State,
  j: Job,
  w: Worker,
  e: Equipment,
  target: Point,
  api: RailWorkAPI,
): boolean {
  const h = j.shedAssembly!;
  if (w.path.length) return false;
  if (h.workerPoint && dist(w, h.workerPoint) < 0.15) return true;
  const away = Math.atan2(target.z - e.z, target.x - e.x);
  const size = h.part ? loadEnvelope(j, e, h.part) : undefined;
  const safeRadius = size ? Math.hypot(size.length, size.width) / 2 + 0.8 : 1.1;
  const radii =
    h.phase === 'lower' ? [safeRadius, safeRadius + 1.5, safeRadius + 3] : [1.1, 2.6, 3.6];
  for (const radius of radii)
    for (const angle of [
      away + Math.PI / 2,
      away - Math.PI / 2,
      away + Math.PI / 4,
      away - Math.PI / 4,
      away + (3 * Math.PI) / 4,
      away - (3 * Math.PI) / 4,
      away,
      away + Math.PI,
    ]) {
      const point = {
        x: target.x + Math.cos(angle) * radius,
        z: target.z + Math.sin(angle) * radius,
      };
      // Keep the installer outside the wall they are about to fasten; once it
      // becomes solid their standing position must still have an escape route.
      const part = h.part;
      if (
        part?.kind === 'wall' &&
        !h.recovering &&
        dist(target, part.to) < 0.01 &&
        personTouchesBox(
          point,
          { ...part.to, length: shedPartSize(j, 'wall', part.index)[0], width: 0.12 },
          0.65,
        )
      )
        continue;
      if (equipmentBoxes(e).some((b) => personTouchesBox(point, b, 0.5))) continue;
      const path = walkRoute(s, w, point, api.obstacles(s));
      if (path) {
        h.workerPoint = point;
        w.path = path;
        w.status = 'Walk to shed assembly point';
        return !path.length;
      }
    }
  j.reason = 'Need pedestrian access to the shed fastening point';
  return false;
}
function selectPart(s: State, j: Job, api: RailWorkAPI) {
  const h = j.shedAssembly!;
  const kinds: ShedPartKind[] = h.recovering
    ? ['brace', 'wall', 'roof', 'beam', 'post']
    : ['post', 'beam', 'roof', 'wall', 'brace'];
  for (const kind of kinds) {
    const count = h[countKey[kind]];
    if (h.recovering ? count > 0 : count < shedPartLimits(j)[kind]) {
      const index = h.recovering ? count - 1 : count;
      const target = shedComponentPose(j, kind, index);
      const stored = {
        ...h.kitPose,
        y:
          surface(s, h.kitPose) +
          storedHeight(kind) +
          (j.kind === 'engineShed' && ['post', 'wall'].includes(kind) ? 0.6 : 0),
      };
      const from = h.recovering ? target : stored;
      const to = h.recovering ? stored : target;
      h.part = { kind, index, pose: copy(from), from: copy(from), to: copy(to) };
      transition(s, j, 'collect');
      return;
    }
  }
  if (h.recovering) {
    transition(s, j, 'anchor');
    return;
  }
  h.phase = 'complete';
  h.part = undefined;
  s.buildings.push({
    id: j.assetId || api.id(s, 'building'),
    kind: j.kind as 'shed' | 'engineShed',
    x: j.x,
    z: j.z,
    w: j.w,
    d: j.d,
    rotation: j.rotation,
    name: j.kind === 'engineShed' ? 'Engine shed' : 'Equipment shed',
    ...(j.kind === 'engineShed' ? { componentIds: h.componentIds } : {}),
    source: j.id,
    connected: true,
  });
  if (j.kind === 'engineShed') engineShedParkingLocation(s, s.buildings.at(-1)!.id);
  api.event(
    s,
    'Work',
    j.id,
    j.kind === 'engineShed'
      ? 'Engine shed foundations, six columns, three frames, eight roof sections, four side walls and two raised roller doors fastened; connected locomotive bay ready.'
      : 'Shed anchors, six columns, three roof frames, four roof sections, back wall panels and bracing fastened.',
  );
  clearActionClearance(s, j.id);
  api.complete(s, j);
}
function packedCancellation(s: State, j: Job, api: RailWorkAPI) {
  const h = j.shedAssembly!;
  const rotated = Math.abs(Math.sin(h.kitPose.yaw)) > 0.5;
  s.stacks.push({
    id: api.id(s, 'stack'),
    item: j.item || 'shed',
    qty: 1,
    reserved: 0,
    x: h.kitPose.x - (rotated ? (j.kind === 'engineShed' ? 1.5 : 1) : 2),
    z: h.kitPose.z - (rotated ? 2 : j.kind === 'engineShed' ? 1.5 : 1),
    w: rotated ? (j.kind === 'engineShed' ? 3 : 2) : 4,
    d: rotated ? 4 : j.kind === 'engineShed' ? 3 : 2,
    yaw: h.kitPose.yaw,
    source: j.id,
    assetId: j.assetId,
  });
  api.movement(
    s,
    j.item || 'shed',
    1,
    j.id,
    s.stacks.at(-1)!.id,
    'Canceled shed disassembled and packed',
  );
  h.phase = 'complete';
  h.part = undefined;
  clearActionClearance(s, j.id);
  api.release(s, j);
  j.status = 'canceled';
  j.phase = 'Canceled; shed kit packed at site';
  j.reason = '';
  s.revision++;
}

/** A kit has one owner throughout assembly; every visible component needs travel, rigging, a lift and fastening. */
export function tickShedConstruction(s: State, j: Job, dt: number, api: RailWorkAPI): boolean {
  if (!['shed', 'engineShed'].includes(j.kind)) return false;
  const e = s.equipment.find((q) => q.id === j.equipment);
  const w = s.workers.find((q) => q.id === j.worker);
  const op = s.workers.find((q) => q.id === j.operator);
  if (!e || !w || !op || op.vehicle !== e.id) return !!j.shedAssembly;
  if (!j.shedAssembly) {
    if (j.phase !== 'Install' || !e.cargo || e.path.length) return false;
    const kitPose = {
      ...localPoint(e, e.reach || 2.7, 0),
      y: surface(s, e) + (e.lift || 0.4),
      yaw: (e.yaw || 0) + Math.PI / 2,
    };
    if (j.kind === 'engineShed' && !j.assetId) j.assetId = api.id(s, 'building');
    j.shedAssembly = {
      ...(j.kind === 'engineShed' ? { componentIds: engineShedComponentIds(j.assetId!) } : {}),
      phase: 'stage',
      clock: 0,
      anchors: 0,
      posts: 0,
      beams: 0,
      roofSheets: 0,
      wallPanels: 0,
      braces: 0,
      kitPose,
      recovering: false,
    };
    j.phase = labels.stage;
    s.revision++;
  }
  const h = j.shedAssembly;
  e.work = 0;
  j.reason = '';
  op.status = labels[h.phase];
  if (e.path.length) {
    if (h.part?.carried) h.part.pose = toolPoint(s, e, h.part.kind, j);
    op.status = h.recovering
      ? 'Returning shed components to the bundle'
      : 'Driving shed components';
    return true;
  }
  if (h.phase === 'stage') {
    if (!align(s, j, e, w, center(j), dt, api)) return true;
    h.kitPose = {
      ...localPoint(e, e.reach!, 0),
      y: surface(s, e) + (e.lift || 0.4),
      yaw: (e.yaw || 0) + Math.PI / 2,
    };
    transition(s, j, 'unpack');
    return true;
  }
  if (h.phase === 'unpack') {
    if (!walkToWork(s, j, w, e, h.kitPose, api)) return true;
    h.clock += dt;
    e.work = 1;
    w.status = 'Release straps and unpack shed kit';
    h.kitPose.y += Math.max(
      -dt * 0.3,
      Math.min(dt * 0.3, surface(s, h.kitPose) + 0.15 - h.kitPose.y),
    );
    e.lift = Math.max(0.15, h.kitPose.y - surface(s, e));
    if (h.clock < 4) return true;
    e.cargo = undefined;
    e.work = 0;
    j.delivered = true;
    if (e.kind !== 'excavator') {
      // An older save may already have given the intact kit to a forklift.
      // Preserve that physical trip, but require a crane-capable machine for
      // the new column/frame/roof sequence instead of revealing a building.
      const rotated = Math.abs(Math.sin(h.kitPose.yaw)) > 0.5;
      const stackId = api.id(s, 'stack');
      s.stacks.push({
        id: stackId,
        item: j.item || 'shed',
        qty: 1,
        reserved: 0,
        x: h.kitPose.x - (rotated ? (j.kind === 'engineShed' ? 1.5 : 1) : 2),
        z: h.kitPose.z - (rotated ? 2 : j.kind === 'engineShed' ? 1.5 : 1),
        w: rotated ? (j.kind === 'engineShed' ? 3 : 2) : 4,
        d: rotated ? 4 : j.kind === 'engineShed' ? 3 : 2,
        yaw: h.kitPose.yaw,
        source: j.id,
        assetId: j.assetId,
      });
      api.movement(
        s,
        j.item || 'shed',
        1,
        e.id,
        stackId,
        'Legacy forklift staged shed kit for erection',
      );
      j.delivered = false;
      j.shedAssembly = undefined;
      api.release(s, j);
      j.status = j.cancel ? 'canceled' : 'todo';
      j.phase = j.cancel ? 'Canceled; kit left at site' : 'Waiting for excavator erection';
      j.reason = j.cancel ? '' : 'Need an available excavator to erect and lift shed components';
      s.revision++;
      return true;
    }
    api.movement(s, j.item || 'shed', 1, e.id, j.id, 'Shed kit unpacked at site');
    api.event(
      s,
      'Work',
      j.id,
      'Shed kit lowered onto site supports; worker unstrapped the columns, frames, sheets and wall panels.',
    );
    h.recovering = !!j.cancel;
    transition(s, j, 'anchor');
    return true;
  }
  if (
    j.cancel &&
    !h.recovering &&
    !h.part?.carried &&
    !['lower', 'fasten', 'withdraw', 'lift'].includes(h.phase)
  ) {
    h.recovering = true;
    h.part = undefined;
    selectPart(s, j, api);
    return true;
  }
  if (h.phase === 'anchor') {
    const index = h.recovering ? h.anchors - 1 : h.anchors;
    if (index < 0) {
      packedCancellation(s, j, api);
      return true;
    }
    if (index >= 6) {
      selectPart(s, j, api);
      return true;
    }
    const point = shedPostPoints(j)[index];
    if (!walkToWork(s, j, w, e, point, api)) return true;
    w.status = h.recovering
      ? 'Unbolt and recover shed base anchor'
      : 'Drill and bolt shed base anchor';
    h.clock += dt;
    if (h.clock >= 3) {
      h.anchors += h.recovering ? -1 : 1;
      h.clock = 0;
      h.workerPoint = undefined;
      j.progress =
        (h.anchors + h.posts + h.beams + h.roofSheets + h.wallPanels + h.braces) /
        (j.kind === 'engineShed' ? 29 : 22);
      s.revision++;
    }
    return true;
  }
  if (h.phase === 'withdraw') {
    const reach = (e.reach ?? 2.7) + Math.max(-dt, Math.min(dt, 2.1 - (e.reach ?? 2.7)));
    const blocker = equipmentReachBlocked(s, e, reach);
    if (blocker) {
      requestShedClearance(
        s,
        j,
        e,
        blocker,
        'Retract shed lifting tools',
        equipmentBoxes({ ...e, reach }),
      );
      if (blocker === w.id) yieldWorker(s, w, e, api);
      return true;
    }
    clearActionClearance(s, j.id);
    e.reach = reach;
    e.lift = (e.lift ?? 0.35) + Math.max(-dt, Math.min(dt, 0.35 - (e.lift ?? 0.35)));
    if (Math.abs(e.reach - 2.1) < 0.001 && Math.abs(e.lift - 0.35) < 0.001) {
      if (j.cancel) h.recovering = true;
      selectPart(s, j, api);
    }
    return true;
  }
  const part = h.part!;
  if (h.phase === 'collect') {
    if (!align(s, j, e, w, part.from, dt, api)) return true;
    transition(s, j, 'rig');
    return true;
  }
  if (h.phase === 'rig') {
    if (!walkToWork(s, j, w, e, part.from, api)) return true;
    w.status = h.recovering
      ? `Unfasten and rig shed ${part.kind}`
      : `Rig shed ${part.kind} for lifting`;
    h.clock += dt;
    if (h.clock >= 2) {
      transition(s, j, 'lift');
      part.from = copy(part.pose);
    }
    return true;
  }
  if (h.phase === 'lift') {
    {
      const load = loadEnvelope(j, e, part);
      // The member rotates from its bundled heading onto the lifting rig.
      // Keep everyone outside that entire horizontal swing before advancing.
      const span = Math.hypot(load.length, load.width);
      const future = { ...e, assemblyLoad: { ...load, length: span, width: span } };
      const box = equipmentBoxes(future).at(-1)!;
      const blocker =
        people(s).find((p) => personTouchesBox(p, box, 0.5))?.id ||
        s.equipment.find(
          (q) =>
            q.id !== e.id &&
            !q.transportOrder &&
            equipmentBoxes(q).some((b) => boxOverlap(b, box, 0.1)),
        )?.id;
      if (blocker) {
        requestShedClearance(s, j, e, blocker, `Lift shed ${part.kind}`, [
          box,
          ...equipmentBoxes(e),
        ]);
        const person = s.workers.find((q) => q.id === blocker);
        if (person?.id === w.id) yieldWorker(s, person, future, api);
        return true;
      }
      clearActionClearance(s, j.id);
      e.assemblyLoad = load;
    }
    h.clock += dt;
    e.work = 1;
    e.lift = travelHeight(part.kind);
    interpolate(part.pose, part.from, toolPoint(s, e, part.kind, j), h.clock / 3);
    e.assemblyLoad = loadEnvelope(j, e, part);
    if (h.clock >= 3) {
      if (h.recovering) h[countKey[part.kind]]--;
      part.carried = true;
      transition(s, j, 'carry');
    }
    return true;
  }
  if (h.phase === 'carry') {
    part.pose = toolPoint(s, e, part.kind, j);
    e.assemblyLoad = loadEnvelope(j, e, part);
    if (!align(s, j, e, w, part.to, dt, api)) return true;
    part.pose = toolPoint(s, e, part.kind, j);
    part.from = copy(part.pose);
    transition(s, j, 'lower');
    return true;
  }
  if (h.phase === 'lower') {
    if (!walkToWork(s, j, w, e, part.to, api)) return true;
    const proposed = copy(part.pose);
    interpolate(proposed, part.from, part.to, (h.clock + dt) / 4);
    const future = { ...e, assemblyLoad: loadEnvelope(j, e, { ...part, pose: proposed }) };
    const load = equipmentBoxes(future).at(-1)!;
    const blocker =
      people(s).find((p) => personTouchesBox(p, load, 0.42))?.id ||
      s.equipment.find(
        (q) =>
          q.id !== e.id &&
          !q.transportOrder &&
          equipmentBoxes(q).some((b) => boxOverlap(b, load, 0.08)),
      )?.id;
    if (blocker) {
      requestShedClearance(s, j, e, blocker, `Position shed ${part.kind}`, [
        load,
        ...equipmentBoxes(e),
      ]);
      const person = s.workers.find((q) => q.id === blocker);
      if (person?.id === w.id) yieldWorker(s, person, future, api);
      return true;
    }
    clearActionClearance(s, j.id);
    h.clock += dt;
    e.work = 1;
    interpolate(part.pose, part.from, part.to, h.clock / 4);
    e.assemblyLoad = loadEnvelope(j, e, part);
    e.lift = Math.max(0.2, part.pose.y - surface(s, e));
    if (h.clock >= 4) {
      part.carried = false;
      e.assemblyLoad = undefined;
      transition(s, j, 'fasten');
    }
    return true;
  }
  if (h.phase === 'fasten') {
    if (!walkToWork(s, j, w, e, part.to, api)) return true;
    const height = h.recovering
      ? 0
      : part.kind === 'post'
        ? 0
        : part.kind === 'wall'
          ? j.kind === 'engineShed' && part.index >= 4
            ? 4.5
            : 2.7
          : part.kind === 'brace'
            ? 2.8
            : Math.max(0, part.to.y - 1.1);
    const climb = height / 0.65;
    if (height > 0) h.ladder = { x: w.x, z: w.z, height: height + 1.2 };
    h.clock += dt;
    if (h.clock < climb) {
      w.y = surface(s, w) + height * smoothstep(h.clock / climb);
      w.status = `Climb assembly ladder to shed ${part.kind}`;
    } else if (h.clock < climb + 3) {
      w.y = surface(s, w) + height;
      w.status = h.recovering
        ? `Secure recovered ${part.kind} in shed bundle`
        : `Fasten and brace shed ${part.kind}`;
    } else {
      w.y =
        height > 0 ? surface(s, w) + height * (1 - smoothstep((h.clock - climb - 3) / climb)) : 0;
      w.status =
        height > 0
          ? 'Climb down from shed assembly ladder'
          : h.recovering
            ? `Secure recovered ${part.kind} in shed bundle`
            : `Fasten and brace shed ${part.kind}`;
    }
    if (h.clock >= 2 * climb + 3) {
      w.y = 0;
      if (!h.recovering) h[countKey[part.kind]]++;
      j.progress =
        (h.anchors + h.posts + h.beams + h.roofSheets + h.wallPanels + h.braces) /
        (j.kind === 'engineShed' ? 29 : 22);
      h.part = undefined;
      const top =
        part.kind === 'post'
          ? 2.15
          : part.kind === 'wall'
            ? 1.9
            : part.kind === 'brace'
              ? 1.95
              : 0.4;
      e.lift = part.pose.y - surface(s, e) + top + 0.3;
      api.event(
        s,
        'Work',
        j.id,
        `${h.recovering ? 'Recovered' : 'Fastened'} ${j.kind === 'engineShed' ? 'engine shed' : 'shed'} ${part.kind} ${part.index + 1}${h.componentIds ? ' · ' + h.componentIds[`${part.kind}/${part.index}`] : ''}.`,
      );
      transition(s, j, 'withdraw');
    }
    return true;
  }
  return true;
}
