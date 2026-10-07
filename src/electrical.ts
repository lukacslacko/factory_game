import type { Building, Equipment, Job, Point, Rect, Stack, State, Worker } from './types';
import type {
  ElectricalRun,
  ElectricalRequest,
  ElectricalPhase,
  ElectricalCell,
} from './electrical-types';
import {
  electricalPreview,
  electricalTerminalCells,
  electricalObstacles,
  electricalPlannedRects,
  ELECTRICAL_REEL_METERS,
  ELECTRICAL_SOIL_PER_CELL,
} from './electrical-geometry';
import {
  equipmentMoveBlocked,
  equipmentSweepBlocked,
  equipmentReachBlocked,
  machineRoute,
  walkRoute,
  workerMoveBlocked,
  equipmentBoxes,
  people,
  personTouchesBox,
  boxOverlap,
} from './traffic';
import { jobEquipmentAssignment, equipmentReservedForJob } from './jobs';
import { equipmentAllows } from './equipment-roles';
import { workerAvailable } from './workforce';
import { boardMachine, machineStep } from './boarding';
import { angleDelta, localPoint, turn, smoothstep } from './motion';
import { electricalConsumerPower } from './electrical-network';
import { center, dist, overlap } from './path';
import { requestActionClearance, clearActionClearance } from './action-clearance';
export * from './electrical-types';
export * from './electrical-geometry';
export * from './electrical-network';
export { electricalValidationProblem } from './electrical-validation';
export interface ElectricalAPI {
  id(s: State, type: string): string;
  event(s: State, type: string, entity: string, text: string): void;
  notice(s: State, title: string, detail: string, entity: string): void;
  movement(
    s: State,
    item: 'cableReel' | 'slab',
    qty: number,
    from: string,
    to: string,
    reason: string,
  ): void;
  obstacles(s: State): Rect[];
  complete(s: State, j: Job): void;
  cost?(s: State, category: string, entity: string, description: string, amount: number): void;
}
export function electricalOwnsStack(s: State, id: string) {
  return !!s.electrical?.runs.some(
    (r) =>
      r.reservations.some((q) => q.stackId === id && q.meters > 0) ||
      (r.reelId === id && r.status !== 'commissioned' && r.status !== 'canceled'),
  );
}
function setPhase(s: State, r: ElectricalRun, j: Job, phase: ElectricalPhase) {
  r.phase = phase;
  r.clock = 0;
  clearBlocked(s, r, j);
  j.phase = phase;
  j.elapsed = 0;
  j.reason = '';
  s.revision++;
}
function blocked(s: State, r: ElectricalRun, j: Job, api: ElectricalAPI, reason: string) {
  r.reason = j.reason = reason;
  r.blockedSince ??= s.elapsed;
  if (s.elapsed - r.blockedSince >= 20 && !r.warned) {
    r.warned = true;
    api.notice(s, 'Electrical construction blocked', `${r.id}: ${reason}`, j.id);
    const n = s.notices.find(
      (n) =>
        n.entity === j.id && n.title === 'Electrical construction blocked' && n.state !== 'done',
    );
    if (n) n.severity = 'warning';
  }
}
function clearBlocked(s: State, r: ElectricalRun, j: Job) {
  r.reason = j.reason = '';
  r.blockedSince = undefined;
  r.warned = undefined;
  for (const n of s.notices)
    if (n.entity === j.id && n.title === 'Electrical construction blocked') n.state = 'done';
}
function meterMovement(
  s: State,
  r: ElectricalRun,
  api: ElectricalAPI,
  from: string,
  to: string,
  meters: number,
  reason: string,
) {
  s.electrical!.meterLedger.push({
    id: api.id(s, 'WIRE'),
    time: s.time,
    runId: r.id,
    from,
    to,
    meters,
    reason,
  });
  api.event(s, 'Electrical', r.id, `${meters} m cable: ${from} → ${to}; ${reason}.`);
}
export function planElectricalRun(
  s: State,
  request: ElectricalRequest,
  api: ElectricalAPI,
): { runId?: string; jobId?: string; error?: string } {
  const preview = electricalPreview(s, request);
  if (!preview.valid) return { error: preview.error };
  s.electrical ??= { runs: [], meterLedger: [] };
  const id = api.id(s, 'ELEC'),
    jobId = api.id(s, 'job'),
    xs = request.cells.map((p) => p.x),
    zs = request.cells.map((p) => p.z);
  const r: ElectricalRun = {
    id,
    jobId,
    sourceId: request.sourceId,
    targetId: request.targetId,
    sourceRect: { ...s.buildings.find((b) => b.id === request.sourceId)! },
    targetRect: { ...s.buildings.find((b) => b.id === request.targetId)! },
    cells: preview.cells,
    phase: 'reserve',
    status: 'planned',
    cellIndex: 0,
    clock: 0,
    created: s.time,
    reservations: [],
    stagedReels: [],
    cableInHand: 0,
    soilInBucketM3: 0,
    sourceTerminated: false,
    targetTerminated: false,
    tested: false,
    reason: '',
  };
  const j: Job = {
    id: jobId,
    kind: 'cableRun',
    electricalRunId: id,
    x: Math.min(...xs),
    z: Math.min(...zs),
    w: Math.max(...xs) - Math.min(...xs) + 1,
    d: Math.max(...zs) - Math.min(...zs) + 1,
    rotation: 0,
    qty: 0,
    status: 'todo',
    phase: 'reserve',
    reason: '',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: s.time,
    target: request.targetId,
  };
  s.electrical.runs.push(r);
  s.jobs.push(j);
  if (s.creative) {
    r.creative = j.creative = j.delivered = true;
    for (const c of r.cells) {
      c.excavation = c.backfilled = 1;
      c.soilRemovedM3 = ELECTRICAL_SOIL_PER_CELL;
      c.cableInstalled = true;
      c.slabRestored = !!c.originalPaving;
    }
    r.sourceTerminated = r.targetTerminated = r.tested = true;
    r.status = 'commissioned';
    r.phase = 'complete';
    r.finished = s.time;
    api.complete(s, j);
  }
  api.event(
    s,
    'Electrical',
    id,
    `${s.creative ? 'Creative commissioned' : 'Planned'} ${preview.meters} m underground circuit from ${request.sourceId} to ${request.targetId}.`,
  );
  s.revision++;
  return { runId: id, jobId };
}
function releaseReservations(s: State, r: ElectricalRun) {
  for (const q of r.reservations) {
    const t = s.stacks.find((t) => t.id === q.stackId);
    if (t) {
      if (r.recovering)
        t.cableReservedSpaceMeters = Math.max(0, (t.cableReservedSpaceMeters || 0) - q.meters);
      else t.cableReservedMeters = Math.max(0, (t.cableReservedMeters || 0) - q.meters);
      if (!t.cableReservedMeters && !t.cableReservedSpaceMeters) t.reserved = 0;
    }
    q.meters = 0;
  }
}
function releaseCrew(s: State, r: ElectricalRun, j: Job) {
  for (const id of [r.workerId, r.operatorId]) {
    const w = s.workers.find((w) => w.id === id);
    if (w?.job === j.id) {
      w.job = undefined;
      w.path = [];
      w.status = w.vehicle ? 'Available in cab' : 'Available';
    }
  }
  const e = s.equipment.find((e) => e.id === r.equipmentId);
  if (e?.job === j.id) {
    e.job = undefined;
    e.path = [];
    e.work = 0;
    e.trafficGoal = undefined;
  }
  j.worker = j.operator = j.equipment = undefined;
  clearActionClearance(s, j.id);
}
function finishCanceled(s: State, r: ElectricalRun, j: Job, api: ElectricalAPI) {
  releaseReservations(s, r);
  releaseCrew(s, r, j);
  clearBlocked(s, r, j);
  if (
    r.recovering &&
    r.tested &&
    r.sourceTerminated &&
    r.targetTerminated &&
    r.cells.every((c) => c.cableInstalled && c.backfilled === 1)
  ) {
    r.recovering = false;
    r.cancelRequested = false;
    r.status = 'commissioned';
    r.phase = 'complete';
    r.finished = s.time;
    r.reason =
      'Recovery canceled before physical source isolation; the existing commissioned circuit remains in service.';
    j.status = 'done';
    j.phase = 'Recovery canceled';
    j.reason = r.reason;
    j.progress = 1;
    j.cancel = false;
    j.finished = s.time;
    s.revision++;
    api.event(s, 'Electrical', r.id, r.reason);
    return;
  }
  r.status = 'canceled';
  r.phase = 'canceled';
  r.finished = s.time;
  r.reason =
    r.recovering && !r.cells.some((c) => c.cableInstalled)
      ? 'Circuit isolated and all cable recovered onto physical reels; ground and paving restored.'
      : 'Stopped safely; installed cable and restored ground remain recorded. Resume this run to finish it.';
  j.status = 'canceled';
  j.phase = 'canceled';
  j.reason = r.reason;
  j.finished = s.time;
  if (r.recovering && !r.cells.some((c) => c.cableInstalled)) j.progress = 1;
  s.revision++;
  api.event(s, 'Electrical', r.id, r.reason);
}
export function cancelElectricalRun(s: State, id: string): string | undefined {
  const r = s.electrical?.runs.find((r) => r.id === id || r.jobId === id);
  if (!r || ['commissioned', 'canceled'].includes(r.status))
    return 'Choose unfinished electrical work.';
  r.cancelRequested = true;
  r.status = 'canceling';
  const j = s.jobs.find((j) => j.id === r.jobId)!;
  j.cancel = true;
  r.reason = j.reason =
    'Cancel requested; return any cable in hand, lower the reel, backfill the open trench and restore its paving.';
  s.revision++;
}
export function resumeElectricalRun(s: State, id: string): string | undefined {
  const r = s.electrical?.runs.find((r) => r.id === id || r.jobId === id);
  if (!r || r.status !== 'canceled') return 'Choose a safely canceled circuit.';
  if (r.recovering && !r.cells.some((c) => c.cableInstalled))
    return 'This circuit has already been fully recovered.';
  if (
    !s.buildings.some((b) => b.id === r.sourceId && ['power', 'lamp'].includes(b.kind)) ||
    !s.buildings.some((b) => b.id === r.targetId && ['lamp', 'transferPump'].includes(b.kind))
  )
    return 'The circuit endpoint is missing.';
  r.status = 'planned';
  r.phase = 'reserve';
  r.clock = 0;
  r.cancelRequested = false;
  r.finished = undefined;
  r.reason = '';
  r.workerId = r.operatorId = r.equipmentId = undefined;
  r.reelId = undefined;
  r.cellIndex = Math.max(
    0,
    r.cells.findIndex((c) => (r.recovering ? c.cableInstalled : !c.cableInstalled)),
  );
  const j = s.jobs.find((j) => j.id === r.jobId)!;
  j.status = 'todo';
  j.cancel = false;
  j.phase = 'reserve';
  j.finished = undefined;
  j.reason = '';
  s.revision++;
}
export function electricalRecoveryConflict(s: State, id: string): string | undefined {
  const r = s.electrical?.runs.find((r) => r.id === id || r.jobId === id);
  if (!r) return 'Choose an existing circuit.';
  if (!['commissioned', 'canceled'].includes(r.status))
    return 'Finish or safely cancel the current circuit work first.';
  if (!r.cells.some((c) => c.cableInstalled))
    return 'This circuit has no installed cable to recover.';
  const downstream = s.electrical!.runs.find(
    (q) =>
      q.id !== r.id &&
      q.sourceId === r.targetId &&
      (q.status !== 'canceled' || q.cells.some((c) => c.cableInstalled)),
  );
  if (downstream)
    return `Recover downstream circuit ${downstream.id} before isolating this lamp junction.`;
}
export function electricalRemovalConflict(s: State, id: string): string | undefined {
  const r = s.electrical?.runs.find(
    (r) =>
      (r.sourceId === id || r.targetId === id) &&
      (r.status !== 'canceled' || r.cells.some((c) => c.cableInstalled) || r.cableInHand),
  );
  return r ? `Recover electrical circuit ${r.id} before removing this connected asset.` : undefined;
}
export function recoverElectricalRun(s: State, id: string, api: ElectricalAPI): string | undefined {
  const problem = electricalRecoveryConflict(s, id);
  if (problem) return problem;
  const r = s.electrical!.runs.find((r) => r.id === id || r.jobId === id)!;
  let j = s.jobs.find((j) => j.id === r.jobId);
  if (!j) {
    const xs = r.cells.map((c) => c.x),
      zs = r.cells.map((c) => c.z);
    j = {
      id: api.id(s, 'job'),
      kind: 'cableRun',
      electricalRunId: r.id,
      target: r.targetId,
      x: Math.min(...xs),
      z: Math.min(...zs),
      w: Math.max(...xs) - Math.min(...xs) + 1,
      d: Math.max(...zs) - Math.min(...zs) + 1,
      rotation: 0,
      qty: 0,
      status: 'todo',
      phase: 'reserve',
      reason: '',
      progress: 0,
      delivered: false,
      elapsed: 0,
      created: s.time,
    };
    s.jobs.push(j);
    r.jobId = j.id;
  }
  r.opening = undefined;
  j.progress = 0;
  r.recovering = true;
  r.status = 'planned';
  r.phase = 'reserve';
  r.clock = 0;
  r.cancelRequested = false;
  r.finished = undefined;
  r.reason = 'Queued physical isolation and cable recovery to real reels';
  r.reservations = [];
  r.reelId = undefined;
  r.cellIndex = Math.max(
    0,
    r.cells.findIndex((c) => c.cableInstalled),
  );
  r.workerId = r.operatorId = r.equipmentId = undefined;
  r.dock = r.workPoint = r.reelClear = undefined;
  j.status = 'todo';
  j.cancel = false;
  j.creative = undefined;
  j.finished = undefined;
  j.phase = 'reserve';
  j.elapsed = 0;
  j.reason = r.reason;
  api.event(
    s,
    'Electrical',
    r.id,
    'Queued physical source/target isolation, excavation, cable retrieval to finite reels and ground restoration.',
  );
  s.revision++;
}
function reserve(s: State, r: ElectricalRun) {
  const needed =
    r.cells.filter((c) => (r.recovering ? c.cableInstalled : !c.cableInstalled)).length -
    r.cableInHand;
  if (r.reservations.reduce((n, q) => n + q.meters, 0) >= needed) return true;
  const reels = s.stacks.filter(
    (t) =>
      t.item === 'cableReel' &&
      t.qty === 1 &&
      !t.reserved &&
      !electricalOwnsStack(s, t.id) &&
      (r.recovering
        ? ELECTRICAL_REEL_METERS - (t.cableMeters ?? ELECTRICAL_REEL_METERS)
        : (t.cableMeters ?? ELECTRICAL_REEL_METERS)) > 0,
  );
  if (
    reels.reduce(
      (n, t) =>
        n +
        (r.recovering
          ? ELECTRICAL_REEL_METERS - (t.cableMeters ?? ELECTRICAL_REEL_METERS)
          : (t.cableMeters ?? ELECTRICAL_REEL_METERS)),
      0,
    ) < needed
  )
    return false;
  let remaining = needed;
  for (const t of reels) {
    if (!remaining) break;
    t.cableMeters ??= ELECTRICAL_REEL_METERS;
    const meters = Math.min(
      remaining,
      r.recovering ? ELECTRICAL_REEL_METERS - t.cableMeters : t.cableMeters,
    );
    if (r.recovering) t.cableReservedSpaceMeters = (t.cableReservedSpaceMeters || 0) + meters;
    else t.cableReservedMeters = (t.cableReservedMeters || 0) + meters;
    t.reserved = 1;
    r.reservations.push({ stackId: t.id, meters });
    remaining -= meters;
  }
  return true;
}
function assign(s: State, r: ElectricalRun, j: Job, api: ElectricalAPI) {
  if (!reserve(s, r)) {
    blocked(
      s,
      r,
      j,
      api,
      r.recovering
        ? 'Need available physical reels with enough free capacity for recovered cable'
        : `Need ${r.cells.filter((c) => !c.cableInstalled).length} m cable on available delivered 50 m reels`,
    );
    return false;
  }
  const engineers = s.workers.filter(
    (w) =>
      w.role === 'engineer' &&
      w.duty === 'auto' &&
      !w.job &&
      !w.vehicle &&
      !w.deliveryOrder &&
      !w.transition &&
      workerAvailable(s, w),
  );
  const requested = jobEquipmentAssignment(s, j).equipmentId;
  const machines = s.equipment.filter(
    (e) =>
      e.kind === 'excavator' &&
      (!requested || requested === e.id) &&
      equipmentReservedForJob(s, e, j) &&
      (requested === e.id || equipmentAllows(e, 'construction')) &&
      !e.job &&
      !e.deliveryOrder &&
      !e.transportOrder &&
      !e.refueling &&
      !e.path.length &&
      !e.trafficGoal &&
      !e.cargo &&
      !e.assemblyLoad &&
      e.fuel > 0 &&
      (!e.operator || s.workers.find((w) => w.id === e.operator)?.duty === 'auto'),
  );
  for (const e of machines) {
    const operators = s.workers
      .filter(
        (w) =>
          w.role === 'operator' &&
          w.duty === 'auto' &&
          !w.job &&
          !w.deliveryOrder &&
          !w.transition &&
          (!w.vehicle || w.vehicle === e.id) &&
          (!e.operator || e.operator === w.id) &&
          workerAvailable(s, w),
      )
      .sort((a, b) => dist(a, e) - dist(b, e));
    for (const op of operators) {
      const path = op.vehicle === e.id ? [] : walkRoute(s, op, machineStep(e), api.obstacles(s));
      if (!path) continue;
      const engineer = engineers.sort((a, b) => dist(a, e) - dist(b, e))[0];
      if (!engineer) continue;
      r.workerId = j.worker = engineer.id;
      r.operatorId = j.operator = op.id;
      r.equipmentId = j.equipment = e.id;
      engineer.job = op.job = e.job = j.id;
      op.path = path;
      engineer.status = 'Assigned electrical engineer';
      r.status = r.cancelRequested ? 'canceling' : 'working';
      j.status = 'doing';
      clearBlocked(s, r, j);
      setPhase(s, r, j, 'board');
      return true;
    }
  }
  blocked(
    s,
    r,
    j,
    api,
    'Need an available excavator, automatic qualified operator and site engineer with physical cab access',
  );
  return false;
}
function walk(s: State, r: ElectricalRun, j: Job, w: Worker, p: Point, api: ElectricalAPI) {
  if (w.vehicle || w.transition || w.yieldingTo) return false;
  if (!w.path.length && dist(w, p) < 0.16) return true;
  if (w.path.length && !w.blockedBy) return false;
  if (s.elapsed < (r.retryAt || 0)) return false;
  r.retryAt = s.elapsed + 1.5;
  const path = walkRoute(s, w, p, api.obstacles(s));
  if (!path) {
    blocked(s, r, j, api, `${w.id} has no clear walking route to the electrical work point`);
    return false;
  }
  w.path = path;
  clearBlocked(s, r, j);
  return false;
}
function align(
  s: State,
  r: ElectricalRun,
  j: Job,
  e: Equipment,
  p: Point,
  dt: number,
  api: ElectricalAPI,
) {
  const yaw = Math.atan2(p.z - e.z, p.x - e.x),
    pose = { ...e };
  turn(pose, yaw, dt, 1.1);
  const blocker = equipmentSweepBlocked(s, e, pose);
  if (blocker) {
    e.blockedBy = blocker;
    requestActionClearance(s, {
      ownerId: j.id,
      requesterEquipmentId: e.id,
      blockerId: blocker,
      action: 'Electrical excavation tool maneuver',
      envelopes: [...equipmentBoxes(e), ...equipmentBoxes(e, pose)],
    });
    blocked(s, r, j, api, `${blocker} blocks the excavation tool maneuver`);
    return false;
  }
  e.yaw = pose.yaw;
  const next =
    (e.reach || 2.7) + Math.max(-dt * 0.8, Math.min(dt * 0.8, dist(e, p) - (e.reach || 2.7)));
  const reachBlocker = equipmentReachBlocked(s, e, next);
  if (reachBlocker) {
    requestActionClearance(s, {
      ownerId: j.id,
      requesterEquipmentId: e.id,
      blockerId: reachBlocker,
      action: 'Electrical excavation reach',
      envelopes: equipmentBoxes({ ...e, reach: next }),
    });
    blocked(s, r, j, api, `${reachBlocker} blocks the excavation reach`);
    return false;
  }
  e.reach = next;
  r.toolPoint = p;
  return Math.abs(angleDelta(e.yaw || 0, yaw)) < 0.025 && Math.abs(next - dist(e, p)) < 0.03;
}
/** Check the physical patch before changing ground, placing cargo, or picking up
 * a slab. Planned reservations never replace execution-time collision checks. */
function patchClear(s: State, r: ElectricalRun, j: Job, e: Equipment, a: Rect, api: ElectricalAPI) {
  const box = { x: a.x + a.w / 2, z: a.z + a.d / 2, yaw: 0, length: a.w, width: a.d };
  const person = people(s).find((p) => personTouchesBox(p, box, 0.35));
  const other = s.equipment.find(
    (q) => q.id !== e.id && equipmentBoxes(q).some((b) => boxOverlap(b, box, 0.08)),
  );
  const obstacle = api
    .obstacles(s)
    .find((q) => !(q as Rect & { id?: string }).id?.startsWith(r.id + '/') && overlap(a, q));
  const id = person?.id || other?.id || (obstacle as (Rect & { id?: string }) | undefined)?.id;
  if (person || other || obstacle) {
    if (id)
      requestActionClearance(s, {
        ownerId: j.id,
        requesterEquipmentId: e.id,
        blockerId: id,
        action: 'Electrical work patch clearance',
        envelopes: [box],
      });
    blocked(s, r, j, api, `${id || 'An obstacle'} occupies the electrical work patch`);
    r.clock = 0;
    return false;
  }
  return true;
}
function moveTo(
  s: State,
  r: ElectricalRun,
  j: Job,
  e: Equipment,
  p: Point,
  api: ElectricalAPI,
  yaw?: number,
) {
  if (e.path.length || e.trafficGoal) return false;
  if (dist(e, p) < 0.08) return true;
  if (s.elapsed < (r.retryAt || 0)) return false;
  r.retryAt = s.elapsed + 1.5;
  let path = machineRoute(s, e, p, api.obstacles(s), 400, true, yaw);
  if (!path) {
    path = machineRoute(s, { ...e, reverse: !e.reverse }, p, api.obstacles(s), 400, true, yaw);
    if (path) e.reverse = !e.reverse;
  }
  if (!path) {
    blocked(s, r, j, api, `${e.id} has no clear driving route to the electrical work dock`);
    return false;
  }
  e.path = path;
  clearBlocked(s, r, j);
  return false;
}
function chooseDock(s: State, e: Equipment, p: Point, api: ElectricalAPI, reelHandling = false) {
  // The assigned engineer is physically sent outside this future envelope before
  // approach. Exclude only that crew member in planning, never in execution.
  const helper = s.electrical?.runs.find(
    (r) => r.equipmentId === e.id && ['working', 'canceling'].includes(r.status),
  )?.workerId;
  const preview = helper ? { ...s, workers: s.workers.filter((w) => w.id !== helper) } : s;
  const cell =
    !reelHandling &&
    s.electrical?.runs
      .flatMap((r) => r.cells)
      .find((c) => dist(center({ ...c, w: 1, d: 1 }), p) < 0.01);
  const planned = (s.electrical?.runs || [])
    .filter((r) => r.status !== 'commissioned' && r.status !== 'canceled')
    .flatMap((r) =>
      r.cells
        .filter(
          (c, i) =>
            i >= r.cellIndex ||
            c.excavation - c.backfilled > 1e-7 ||
            c.spoilM3 > 1e-7 ||
            (c.slabLifted && !c.slabRestored),
        )
        .flatMap((c) => [{ ...c, w: 1, d: 1 }, c.spoilRect, ...(c.slabRect ? [c.slabRect] : [])]),
    );
  const maneuverRects = [...planned, ...api.obstacles(s)];
  for (const radius of [3.5, 4.5, 5.5, 6.5])
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const dock = { x: p.x + dx * radius, z: p.z + dz * radius, yaw: Math.atan2(-dz, -dx) };
      if (
        maneuverRects.some((a) =>
          equipmentBoxes(e, dock, false).some((b) =>
            boxOverlap(
              b,
              { x: a.x + a.w / 2, z: a.z + a.d / 2, yaw: 0, length: a.w, width: a.d },
              0.1,
            ),
          ),
        )
      )
        continue;
      if (cell) {
        let safe = true;
        for (const target of [
          center(cell.spoilRect),
          ...(cell.slabRect ? [center(cell.slabRect)] : []),
        ]) {
          if (dist(dock, target) > 6.5) {
            safe = false;
            break;
          }
          const yaw = Math.atan2(target.z - dock.z, target.x - dock.x),
            delta = angleDelta(dock.yaw, yaw),
            count = Math.max(1, Math.ceil(Math.abs(delta) / 0.025));
          for (let n = 0; n <= count; n++) {
            const pose = { ...dock, yaw: dock.yaw + (delta * n) / count };
            if (
              maneuverRects.some((a) =>
                equipmentBoxes(e, pose, false).some((b) =>
                  boxOverlap(
                    b,
                    { x: a.x + a.w / 2, z: a.z + a.d / 2, yaw: 0, length: a.w, width: a.d },
                    0.1,
                  ),
                ),
              ) ||
              equipmentMoveBlocked(preview, { ...e, ...dock, reach: dist(dock, target) }, pose)
            ) {
              safe = false;
              break;
            }
          }
          if (!safe) break;
        }
        if (!safe) continue;
      }
      if (reelHandling) {
        // Every lifted reel uses a real straight reverse withdrawal. Select its
        // dock before rigging only if the complete loaded sweep is clear.
        let previous: Equipment = {
          ...e,
          ...dock,
          reach: dist(dock, p),
          cargo: { item: 'cableReel', qty: 1 },
          lift: 0.55,
          reverse: true,
        };
        let clear = true;
        for (let distance = 0.1; distance <= 3.50001; distance += 0.1) {
          const next = { ...dock, ...localPoint(dock, -distance, 0) };
          if (equipmentSweepBlocked(preview, previous, next)) {
            clear = false;
            break;
          }
          previous = { ...previous, ...next };
        }
        if (!clear) continue;
      }
      if (equipmentMoveBlocked(preview, e, dock)) continue;
      const route =
        machineRoute(preview, e, dock, api.obstacles(s), 400, true, dock.yaw) ||
        machineRoute(
          preview,
          { ...e, reverse: !e.reverse },
          dock,
          api.obstacles(s),
          400,
          true,
          dock.yaw,
        );
      if (route) return dock;
    }
}
function safeGroundPoint(s: State, e: Equipment, w: Worker, p: Point, current: State = s) {
  for (const distance of [4.5, 6, 8])
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const q = { x: p.x + dx * distance, z: p.z + dz * distance };
      if (dist(q, e) < 3 || workerMoveBlocked(s, w, q) || workerMoveBlocked(current, w, q))
        continue;
      if (
        walkRoute(s, w, q, electricalObstacles(s)) &&
        walkRoute(current, w, q, electricalObstacles(current))
      )
        return q;
    }
}
function chooseStage(s: State, r: ElectricalRun, e: Equipment, api: ElectricalAPI) {
  const p = center({ ...r.cells[0], w: 1, d: 1 });
  const planned = r.cells.flatMap((c) => [
    { ...c, w: 1, d: 1 },
    c.spoilRect,
    ...(c.slabRect ? [c.slabRect] : []),
  ]);
  for (let radius = 3; radius <= 8; radius++)
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = { x: Math.floor(p.x + dx * radius), z: Math.floor(p.z + dz * radius), w: 1, d: 1 };
      if (a.z < 7 || [...planned, ...api.obstacles(s)].some((q) => overlap(a, q))) continue;
      const dock = chooseDock(s, e, center(a), api, true);
      if (dock) return { stage: a, dock };
    }
}
function reelFor(s: State, r: ElectricalRun) {
  return s.stacks.find((t) => t.id === r.reelId);
}
function activeReel(s: State, r: ElectricalRun) {
  return r.reservations.find((q) => q.meters > 0);
}
function finishCell(s: State, r: ElectricalRun, j: Job, api: ElectricalAPI) {
  const c = r.cells[r.cellIndex];
  if (c.originalPaving && c.slabLifted && !c.slabRestored) {
    setPhase(s, r, j, 'restore-paving');
    return;
  }
  if (r.cancelRequested) {
    finishCanceled(s, r, j, api);
    return;
  }
  r.cellIndex++;
  r.dock = undefined;
  r.workPoint = undefined;
  r.reelClear = undefined;
  const requested = jobEquipmentAssignment(s, j).equipmentId;
  if (requested && requested !== r.equipmentId && r.cellIndex < r.cells.length) {
    releaseCrew(s, r, j);
    r.workerId = r.operatorId = r.equipmentId = undefined;
    j.status = 'todo';
    r.status = 'planned';
    setPhase(s, r, j, 'reserve');
    return;
  }
  if (r.cellIndex >= r.cells.length) {
    if (r.recovering) finishCanceled(s, r, j, api);
    else setPhase(s, r, j, 'terminate-source');
  } else setPhase(s, r, j, 'approach');
}
export function tickElectricalJob(s: State, j: Job, dt: number, api: ElectricalAPI): boolean {
  if (j.kind !== 'cableRun') return false;
  const r = s.electrical?.runs.find((r) => r.id === j.electricalRunId);
  if (!r || ['done', 'canceled'].includes(j.status)) return true;
  if (j.cancel) {
    r.cancelRequested = true;
    r.status = 'canceling';
  }
  if (r.cancelRequested && j.status === 'todo') {
    finishCanceled(s, r, j, api);
    return true;
  }
  if (j.status === 'todo' && !assign(s, r, j, api)) return true;
  const e = s.equipment.find((e) => e.id === r.equipmentId),
    op = s.workers.find((w) => w.id === r.operatorId),
    w = s.workers.find((w) => w.id === r.workerId);
  if (!e || !op || !w) {
    blocked(s, r, j, api, 'Assigned electrical crew or excavator is missing');
    return true;
  }
  if (e.refueling || w.job !== j.id || op.job !== j.id) return true;
  if (e.fuel <= 0) {
    blocked(s, r, j, api, `${e.id} needs physical refueling before electrical work can continue`);
    return true;
  }
  if (w.duty !== 'auto' || op.duty !== 'auto') {
    blocked(s, r, j, api, 'Return the assigned electrical crew to automatic duty');
    return true;
  }
  const step = (phase: ElectricalPhase) => setPhase(s, r, j, phase);
  const c = r.cells[r.cellIndex];
  r.clock += dt;
  j.elapsed = r.clock;
  j.progress =
    r.cells.filter((c) =>
      r.recovering
        ? !c.cableInstalled &&
          Math.abs(c.excavation - c.backfilled) < 1e-7 &&
          !c.slabCarried &&
          (!c.slabLifted || c.slabRestored)
        : c.cableInstalled && c.backfilled >= 1,
    ).length / r.cells.length;
  if (r.phase === 'board') {
    if (op.path.length || op.transition) return true;
    if (op.vehicle !== e.id) {
      if (dist(op, machineStep(e)) > 0.2) {
        walk(s, r, j, op, machineStep(e), api);
        return true;
      }
      boardMachine(op, e);
      return true;
    }
    if (r.cancelRequested) {
      finishCanceled(s, r, j, api);
      return true;
    }
    if (r.recovering && (r.sourceTerminated || r.targetTerminated)) {
      step(r.sourceTerminated ? 'isolate-source' : 'isolate-target');
      return true;
    }
    const reservation = activeReel(s, r);
    if (!reservation) {
      step('terminate-source');
      return true;
    }
    r.reelId = reservation.stackId;
    const reel = reelFor(s, r)!;
    if (r.stagedReels.includes(reel.id)) {
      step('approach');
      return true;
    }
    const chosen = chooseStage(s, r, e, api);
    if (!chosen) {
      blocked(
        s,
        r,
        j,
        api,
        'No clear physical reel staging square and machine dock near the cable route',
      );
      return true;
    }
    r.reelStage = chosen.stage;
    r.reelOrigin = { x: reel.x, z: reel.z, w: reel.w, d: reel.d };
    r.reelDock = chooseDock(s, e, center(reel), api, true);
    if (!r.reelDock) {
      blocked(s, r, j, api, 'No accessible lifting face on the reserved cable reel');
      return true;
    }
    step('reel-source');
  } else if (r.phase === 'reel-source') {
    const reel = reelFor(s, r)!;
    if (
      !moveTo(s, r, j, e, r.reelDock!, api, r.reelDock!.yaw) ||
      !align(s, r, j, e, center(reel), dt, api)
    )
      return true;
    const p = electricalTerminalCells(reel)
      .map((p) => ({ x: p.x + 0.5, z: p.z + 0.5 }))
      .find((p) => walkRoute(s, w, p, api.obstacles(s)) !== null);
    if (!p || !walk(s, r, j, w, p, api)) return true;
    r.workPoint = undefined;
    step('reel-rig');
  } else if (r.phase === 'reel-rig') {
    if (r.cancelRequested) {
      finishCanceled(s, r, j, api);
      return true;
    }
    if (r.clock < 3) return true;
    r.workPoint ??= safeGroundPoint(s, e, w, center(reelFor(s, r)!));
    if (!r.workPoint || !walk(s, r, j, w, r.workPoint, api)) return true;
    const reel = reelFor(s, r)!;
    if (reel.qty !== 1) {
      blocked(s, r, j, api, 'Reserved cable reel is not physically in stock');
      return true;
    }
    reel.qty = reel.reserved = 0;
    reel.electricalCarriedBy = j.id;
    e.cargo = { item: 'cableReel', qty: 1 };
    e.lift = 0.15;
    api.movement(s, 'cableReel', 1, reel.id, e.id, 'Lift delivered cable reel');
    step('reel-lift');
  } else if (r.phase === 'reel-lift') {
    e.lift = 0.15 + 0.4 * smoothstep(r.clock / 3);
    if (r.clock < 3) return true;
    r.reelClear = localPoint(e, -3.5, 0);
    e.reverse = true;
    e.path = [r.reelClear];
    step('reel-withdraw');
  } else if (r.phase === 'reel-withdraw') {
    if (e.path.length || e.trafficGoal) return true;
    if (dist(e, r.reelClear!) > 0.08) {
      e.path = [r.reelClear!];
      return true;
    }
    e.reverse = false;
    r.dock = chooseDock(s, e, center(r.reelStage!), api, true);
    if (!r.dock) {
      blocked(s, r, j, api, 'No clear cable reel lowering dock');
      return true;
    }
    step('reel-carry');
  } else if (r.phase === 'reel-carry') {
    if (
      !moveTo(s, r, j, e, r.dock!, api, r.dock!.yaw) ||
      !align(s, r, j, e, center(r.reelStage!), dt, api)
    )
      return true;
    step('reel-lower');
  } else if (r.phase === 'reel-lower') {
    if (!patchClear(s, r, j, e, r.reelStage!, api)) return true;
    const box = equipmentBoxes(e);
    const blocker = people(s).find((p) => box.some((b) => personTouchesBox(p, b, 0.42)));
    if (blocker) {
      blocked(s, r, j, api, `${blocker.id} blocks reel lowering`);
      r.clock -= dt;
      return true;
    }
    e.lift = 0.55 - 0.4 * smoothstep(r.clock / 3);
    if (r.clock < 3) return true;
    const reel = reelFor(s, r)!;
    Object.assign(reel, r.reelStage, { qty: 1, reserved: 1, electricalCarriedBy: undefined });
    e.cargo = undefined;
    api.movement(s, 'cableReel', 1, e.id, reel.id, 'Lower cable reel at trench staging square');
    r.stagedReels.push(reel.id);
    r.reelClear = localPoint(e, -3.5, 0);
    e.reverse = true;
    e.path = [r.reelClear];
    step('reel-clear');
  } else if (r.phase === 'reel-clear') {
    if (e.path.length || e.trafficGoal) return true;
    if (dist(e, r.reelClear!) > 0.08) {
      e.path = [r.reelClear!];
      return true;
    }
    e.reverse = false;
    r.dock = undefined;
    if (r.cancelRequested) {
      finishCanceled(s, r, j, api);
      return true;
    }
    r.reelClear = undefined;
    r.workPoint = undefined;
    step('approach');
  } else if (r.phase === 'approach' || r.phase === 'backfill-approach') {
    if (!c) {
      step('terminate-source');
      return true;
    }
    if ((r.recovering ? !c.cableInstalled : c.cableInstalled) && c.backfilled >= 1) {
      finishCell(s, r, j, api);
      return true;
    }
    if (
      r.phase === 'approach' &&
      c.excavation > 0 &&
      Math.abs(c.excavation - c.backfilled) < 1e-7 &&
      (r.recovering || !c.cableInstalled)
    ) {
      c.excavation = c.backfilled = c.soilRemovedM3 = c.spoilM3 = 0;
      c.slabRestored = false;
      c.slabLifted = false;
    }
    const p = center({ ...c, w: 1, d: 1 });
    r.dock ??= chooseDock(s, e, p, api);
    if (!r.dock) {
      blocked(s, r, j, api, 'No checked excavation dock beside the planned trench cell');
      return true;
    }
    const futureEquipment = { ...e, ...r.dock };
    const future = {
      ...s,
      equipment: s.equipment.map((q) => (q.id === e.id ? futureEquipment : q)),
    };
    if (
      r.workPoint &&
      (dist(r.workPoint, futureEquipment) < 3 ||
        workerMoveBlocked(future, w, r.workPoint) ||
        workerMoveBlocked(s, w, r.workPoint))
    )
      r.workPoint = undefined;
    r.workPoint ??= safeGroundPoint(future, futureEquipment, w, p, s);
    if (!r.workPoint || !walk(s, r, j, w, r.workPoint, api)) return true;
    if (!moveTo(s, r, j, e, r.dock, api, r.dock.yaw) || !align(s, r, j, e, p, dt, api)) return true;
    if (r.phase === 'backfill-approach') {
      step('backfill-pick');
      return true;
    }
    if (r.cancelRequested && c.excavation === 0) {
      finishCanceled(s, r, j, api);
      return true;
    }
    if (c.originalPaving && !c.slabLifted) {
      step('lift-paving');
      return true;
    }
    step(c.excavation >= 1 ? 'crew-clear' : 'dig');
  } else if (r.phase === 'lift-paving' || r.phase === 'restore-paving') {
    const restoring = r.phase === 'restore-paving';
    const from = restoring ? center(c.slabRect!) : center({ ...c, w: 1, d: 1 }),
      to = restoring ? center({ ...c, w: 1, d: 1 }) : center(c.slabRect!);
    if (!r.pavingStep) {
      if (!patchClear(s, r, j, e, restoring ? c.slabRect! : { ...c, w: 1, d: 1 }, api)) return true;
      if (!align(s, r, j, e, from, dt, api)) {
        r.clock = 0;
        return true;
      }
      if (r.clock < 2) return true;
      c.slabLifted = c.slabCarried = true;
      c.slabRestored = false;
      if (!restoring) delete s.paving[`${c.x},${c.z}`];
      e.cargo = { item: 'slab', qty: 1 };
      e.lift = 0.5;
      r.pavingStep = 'carry';
      r.clock = 0;
    }
    if (r.pavingStep === 'carry') {
      if (!align(s, r, j, e, to, dt, api)) return true;
      r.pavingStep = 'lower';
      r.clock = 0;
    }
    if (r.pavingStep === 'lower') {
      if (!patchClear(s, r, j, e, restoring ? { ...c, w: 1, d: 1 } : c.slabRect!, api)) return true;
      e.lift = 0.5 - 0.38 * smoothstep(r.clock / 3);
      if (r.clock < 3) return true;
      e.cargo = undefined;
      c.slabCarried = false;
      r.pavingStep = undefined;
      if (restoring) {
        s.paving[`${c.x},${c.z}`] = c.originalPaving!;
        c.slabRestored = true;
        api.movement(
          s,
          'slab',
          1,
          `${r.id}/slab/${r.cellIndex}`,
          `${c.x},${c.z}`,
          'Restore original paving after cable backfill',
        );
        finishCell(s, r, j, api);
      } else {
        api.movement(
          s,
          'slab',
          1,
          `${c.x},${c.z}`,
          `${r.id}/slab/${r.cellIndex}`,
          'Lift paving before cable excavation',
        );
        step('dig-return');
      }
    }
  } else if (r.phase === 'dig-return') {
    if (!align(s, r, j, e, center({ ...c, w: 1, d: 1 }), dt, api)) return true;
    step('dig');
  } else if (r.phase === 'dig') {
    if (!patchClear(s, r, j, e, { ...c, w: 1, d: 1 }, api)) return true;
    if (r.cancelRequested && r.soilInBucketM3 === 0) {
      step('backfill-pick');
      return true;
    }
    if (!align(s, r, j, e, center({ ...c, w: 1, d: 1 }), dt, api)) {
      r.clock = 0;
      return true;
    }
    e.work = 1;
    e.lift = 0.1 - 0.5 * smoothstep(r.clock / 3);
    if (r.clock < 3) return true;
    const amount = Math.min(0.12, ELECTRICAL_SOIL_PER_CELL - c.soilRemovedM3);
    r.soilInBucketM3 = amount;
    c.soilRemovedM3 += amount;
    c.excavation = c.soilRemovedM3 / ELECTRICAL_SOIL_PER_CELL;
    step('swing-spoil');
  } else if (r.phase === 'swing-spoil') {
    if (!align(s, r, j, e, center(c.spoilRect), dt, api)) return true;
    step('dump-spoil');
  } else if (r.phase === 'dump-spoil') {
    if (!patchClear(s, r, j, e, c.spoilRect, api)) return true;
    e.lift = 0.4;
    if (r.clock < 2) return true;
    c.spoilM3 += r.soilInBucketM3;
    r.soilInBucketM3 = 0;
    if (r.cancelRequested) {
      step('backfill-pick');
      return true;
    }
    step(c.excavation >= 1 - 1e-8 ? 'crew-clear' : 'dig-return');
  } else if (r.phase === 'crew-clear') {
    e.work = 0;
    const next = Math.max(1.8, (e.reach || 3) - dt * 0.8);
    if (equipmentReachBlocked(s, e, next)) {
      r.clock = 0;
      return true;
    }
    e.reach = next;
    if (next > 1.81) return true;
    r.reelClear ??= localPoint(e, -3.5, 0);
    if (!moveTo(s, r, j, e, r.reelClear, api)) return true;
    if (r.cancelRequested) {
      r.dock = undefined;
      step('backfill-approach');
      return true;
    }
    r.workPoint = undefined;
    step('collect-cable');
  } else if (r.phase === 'collect-cable') {
    if (r.cancelRequested) {
      r.dock = undefined;
      step('backfill-approach');
      return true;
    }
    const reservation = activeReel(s, r);
    if (!reservation) {
      blocked(s, r, j, api, 'Reserved cable is exhausted before the circuit was complete');
      return true;
    }
    if (!r.stagedReels.includes(reservation.stackId)) {
      r.reelId = reservation.stackId;
      step('board');
      return true;
    }
    r.reelId = reservation.stackId;
    const reel = reelFor(s, r)!;
    const faces = electricalTerminalCells(reel).map((p) => ({ x: p.x + 0.5, z: p.z + 0.5 }));
    const target = faces.find((p) => walkRoute(s, w, p, api.obstacles(s)) !== null);
    if (!target || !walk(s, r, j, w, target, api)) {
      r.clock = 0;
      return true;
    }
    if (r.recovering) {
      step('recover-cable');
      return true;
    }
    if ((reel.cableMeters || 0) < 1 || reservation.meters < 1) {
      blocked(s, r, j, api, 'The reserved reel has insufficient physical cable');
      return true;
    }
    if (!turn(w, Math.atan2(center(reel).z - w.z, center(reel).x - w.x), dt, 3)) {
      r.clock = 0;
      return true;
    }
    if (r.clock < 2) return true;
    reel.cableMeters! -= 1;
    reel.cableReservedMeters!--;
    reservation.meters--;
    if (!reel.cableReservedMeters) reel.reserved = 0;
    r.cableInHand = 1;
    meterMovement(
      s,
      r,
      api,
      reel.id,
      `${j.id}/HAND`,
      1,
      'Engineer unwinds one meter from the real reel',
    );
    step('lay');
  } else if (r.phase === 'lay' || r.phase === 'recover-cable') {
    const p = center({ ...c, w: 1, d: 1 });
    const point = electricalTerminalCells({ ...c, w: 1, d: 1 })
      .map((p) => ({ x: p.x + 0.5, z: p.z + 0.5 }))
      .find((q) => walkRoute(s, w, q, api.obstacles(s)) !== null);
    if (!point || !walk(s, r, j, w, point, api)) {
      r.clock = 0;
      return true;
    }
    if (!turn(w, Math.atan2(p.z - w.z, p.x - w.x), dt, 3)) {
      r.clock = 0;
      return true;
    }
    if (r.clock < 4) return true;
    if (r.phase === 'recover-cable') {
      if (!r.cancelRequested) {
        c.cableInstalled = false;
        r.cableInHand = 1;
        meterMovement(
          s,
          r,
          api,
          `${r.id}/cell/${r.cellIndex}`,
          `${j.id}/HAND`,
          1,
          'Retrieve isolated cable from the open trench',
        );
        step('return-cable');
        return true;
      }
    } else if (r.cancelRequested) {
      step('return-cable');
      return true;
    } else {
      c.cableInstalled = true;
      r.cableInHand = 0;
      meterMovement(
        s,
        r,
        api,
        `${j.id}/HAND`,
        `${r.id}/cell/${r.cellIndex}`,
        1,
        'Lay finite cable into excavated trench',
      );
    }
    r.dock = undefined;
    r.workPoint = undefined;
    r.reelClear = undefined;
    step('backfill-approach');
  } else if (r.phase === 'return-cable') {
    const reel = reelFor(s, r);
    if (!reel || reel.qty !== 1) {
      blocked(s, r, j, api, 'The physical cable return reel is unavailable');
      return true;
    }
    const point = electricalTerminalCells(reel)
      .map((p) => ({ x: p.x + 0.5, z: p.z + 0.5 }))
      .find((p) => walkRoute(s, w, p, api.obstacles(s)) !== null);
    if (!point || !walk(s, r, j, w, point, api)) {
      r.clock = 0;
      return true;
    }
    if (r.clock < 2) return true;
    if ((reel.cableMeters || 0) + r.cableInHand > ELECTRICAL_REEL_METERS) {
      blocked(s, r, j, api, 'The physical reel has no free capacity for returned cable');
      return true;
    }
    if (
      r.recovering &&
      !r.reservations.some((q) => q.stackId === reel.id && q.meters >= r.cableInHand)
    ) {
      blocked(s, r, j, api, 'Recovery reel capacity reservation is missing');
      return true;
    }
    reel.cableMeters = (reel.cableMeters || 0) + r.cableInHand;
    if (r.recovering) {
      const q = r.reservations.find((q) => q.stackId === reel.id && q.meters > 0);
      if (!q) {
        blocked(s, r, j, api, 'Recovery reel capacity reservation is missing');
        return true;
      }
      q.meters -= r.cableInHand;
      reel.cableReservedSpaceMeters = Math.max(
        0,
        (reel.cableReservedSpaceMeters || 0) - r.cableInHand,
      );
    }
    meterMovement(
      s,
      r,
      api,
      `${j.id}/HAND`,
      reel.id,
      r.cableInHand,
      r.recovering
        ? 'Engineer winds recovered cable onto the staged reel'
        : 'Engineer returns unlaid cable to the staged reel',
    );
    r.cableInHand = 0;
    r.dock = undefined;
    r.workPoint = undefined;
    r.reelClear = undefined;
    step('backfill-approach');
  } else if (r.phase === 'backfill-pick') {
    if (!patchClear(s, r, j, e, c.spoilRect, api)) return true;
    if (c.spoilM3 <= 1e-8) {
      c.backfilled = c.excavation;
      finishCell(s, r, j, api);
      return true;
    }
    if (!align(s, r, j, e, center(c.spoilRect), dt, api)) {
      r.clock = 0;
      return true;
    }
    e.work = 1;
    if (r.clock < 3) return true;
    const amount = Math.min(0.12, c.spoilM3);
    c.spoilM3 = Math.max(0, c.spoilM3 - amount);
    r.soilInBucketM3 = amount;
    step('swing-trench');
  } else if (r.phase === 'swing-trench') {
    if (!align(s, r, j, e, center({ ...c, w: 1, d: 1 }), dt, api)) return true;
    step('backfill');
  } else if (r.phase === 'backfill') {
    if (!patchClear(s, r, j, e, { ...c, w: 1, d: 1 }, api)) return true;
    if (r.clock < 3) return true;
    c.backfilled = Math.min(
      c.excavation,
      c.backfilled + r.soilInBucketM3 / ELECTRICAL_SOIL_PER_CELL,
    );
    r.soilInBucketM3 = 0;
    step('backfill-return');
  } else if (r.phase === 'backfill-return') {
    if (c.spoilM3 > 1e-8) step('backfill-pick');
    else {
      c.spoilM3 = 0;
      c.backfilled = c.excavation;
      finishCell(s, r, j, api);
    }
  } else if (
    r.phase === 'isolate-source' ||
    r.phase === 'isolate-target' ||
    r.phase === 'terminate-source' ||
    r.phase === 'terminate-target'
  ) {
    e.work = 0;
    const b = s.buildings.find(
      (b) => b.id === (r.phase.endsWith('source') ? r.sourceId : r.targetId),
    );
    if (!b) {
      blocked(s, r, j, api, 'Electrical termination endpoint is missing');
      return true;
    }
    const point = electricalTerminalCells(b)
      .map((p) => ({ x: p.x + 0.5, z: p.z + 0.5 }))
      .find((p) => walkRoute(s, w, p, api.obstacles(s)) !== null);
    if (!point || !walk(s, r, j, w, point, api)) {
      r.clock = 0;
      return true;
    }
    if (!turn(w, Math.atan2(center(b).z - w.z, center(b).x - w.x), dt, 3)) {
      r.clock = 0;
      return true;
    }
    if (r.clock < 6) return true;
    if (r.phase === 'isolate-source') {
      r.sourceTerminated = false;
      r.tested = false;
      api.event(
        s,
        'Electrical',
        r.id,
        'Engineer physically isolated the source terminal before underground cable recovery.',
      );
      step('isolate-target');
      return true;
    }
    if (r.phase === 'isolate-target') {
      r.targetTerminated = false;
      step('board');
      return true;
    }
    if (r.cancelRequested) {
      finishCanceled(s, r, j, api);
      return true;
    }
    if (r.phase === 'terminate-source') {
      r.sourceTerminated = true;
      step('terminate-target');
    } else {
      r.targetTerminated = true;
      step('test');
    }
  } else if (r.phase === 'test') {
    if (r.clock < 6) return true;
    if (r.cancelRequested) {
      finishCanceled(s, r, j, api);
      return true;
    }
    if (
      !s.utilities.power ||
      !s.buildings.some(
        (b) =>
          b.id === r.sourceId &&
          ((b.kind === 'power' && b.connected) ||
            (b.kind === 'lamp' && electricalConsumerPower(s, b.id).connected)),
      )
    ) {
      blocked(
        s,
        r,
        j,
        api,
        'Incoming cabinet or upstream lamp junction must be commissioned before the circuit can be tested',
      );
      return true;
    }
    if (
      r.cells.some((c) => !c.cableInstalled || Math.abs(c.backfilled - 1) > 1e-7) ||
      r.soilInBucketM3 ||
      r.cableInHand
    ) {
      blocked(s, r, j, api, 'Physical cable or trench restoration is incomplete');
      return true;
    }
    r.tested = true;
    r.status = 'commissioned';
    r.phase = 'complete';
    r.finished = s.time;
    releaseReservations(s, r);
    releaseCrew(s, r, j);
    api.complete(s, j);
    api.event(
      s,
      'Electrical',
      r.id,
      'Insulation, continuity and protective-device test complete; underground circuit commissioned.',
    );
    s.revision++;
  }
  return true;
}
