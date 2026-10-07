import type { State, Point, Equipment, ActionClearance } from './types';
import { dist } from './path';
import { shiftIsActive } from './workforce';
import { machineStep, boardMachine } from './boarding';
import { selectWorker, noteWorkerAssignment } from './worker-selection';
import {
  equipmentBoxes,
  workerMoveBlocked,
  staticObstacleRects,
  machineRoute,
  walkRoute,
  boxOverlap,
  personTouchesBox,
  people,
  type TrafficBox,
} from './traffic';

export interface ClearanceRequest {
  ownerId: string;
  requesterEquipmentId?: string;
  blockerId: string;
  action: string;
  envelopes: TrafficBox[];
}
export function actionEnvelopeBlockers(
  s: State,
  requester: Equipment,
  envelopes: TrafficBox[],
  ignore: string[] = [],
) {
  return [
    ...s.equipment
      .filter(
        (e) =>
          e.id !== requester.id &&
          !e.transportOrder &&
          !ignore.includes(e.id) &&
          equipmentBoxes(e).some((a) => envelopes.some((b) => boxOverlap(a, b, 0.06))),
      )
      .map((e) => e.id),
    ...people(s)
      .filter((w) => !ignore.includes(w.id) && envelopes.some((b) => personTouchesBox(w, b, 0.42)))
      .map((w) => w.id),
  ];
}
const nextId = (s: State, prefix: string) => `${prefix}-${String(s.next++).padStart(4, '0')}`;
const ownerActive = (s: State, ownerId: string) => {
  const job = s.jobs.find((j) => j.id === ownerId);
  if (job) return job.status === 'doing' || job.status === 'todo';
  const machine = s.equipment.find((e) => e.id === ownerId);
  if (machine)
    return (
      !!machine.path.length ||
      (!!machine.parking && machine.parkingState !== 'parked') ||
      !!machine.job ||
      !!machine.deliveryOrder
    );
  return (
    s.orders.some((o) => o.id === ownerId && (o.status !== 'done' || !!o.unload)) ||
    s.workers.some((w) => w.id === ownerId && !!w.path.length)
  );
};
/** A short saved lease prevents parking/dispatch from undoing an accepted refuge. */
export function actionClearanceHoldsEquipment(s: State, id: string) {
  const e = s.equipment.find((e) => e.id === id);
  return (
    !!e?.actionYieldFor && s.elapsed < (e.actionYieldUntil || 0) && ownerActive(s, e.actionYieldFor)
  );
}
function candidates(origin: Point, envelope: TrafficBox[], radius: number[]): Point[] {
  return radius
    .flatMap((r) =>
      Array.from({ length: 8 }, (_, i) => ({
        x: origin.x + Math.cos((i * Math.PI) / 4) * r,
        z: origin.z + Math.sin((i * Math.PI) / 4) * r,
      })),
    )
    .filter(
      (p) =>
        p.x >= -48 &&
        p.x <= 230 &&
        p.z >= -30 &&
        p.z <= 115 &&
        envelope.every((b) => !personTouchesBox(p, b, 1)),
    )
    .sort((a, b) => dist(origin, a) - dist(origin, b) || a.x - b.x || a.z - b.z);
}
function releaseYieldOperator(s: State, e: Equipment) {
  const worker = s.workers.find((w) => w.id === e.actionYieldOperator);
  if (worker?.actionClearanceEquipment === e.id) {
    worker.actionClearanceEquipment = undefined;
    if (
      !worker.vehicle &&
      !worker.transition &&
      worker.duty === 'auto' &&
      worker.status.startsWith('Walk to clear ')
    ) {
      worker.path = [];
      worker.status = 'Available';
    }
  }
  e.actionYieldOperator = undefined;
}
/** Explicit player commands revoke an automatic clearance reservation. Boarding
 * transitions finish physically, while a merely walking recruit is released. */
export function releaseActionYield(s: State, equipmentId: string) {
  const e = s.equipment.find((e) => e.id === equipmentId);
  if (!e) return;
  releaseYieldOperator(s, e);
  if (e.actionYieldFor) {
    e.path = [];
    e.velocity = 0;
  }
  e.actionYieldFor = undefined;
  e.actionYieldUntil = undefined;
}
function yieldActor(s: State, request: ClearanceRequest): { requested: boolean; reason: string } {
  const { blockerId: id, envelopes, requesterEquipmentId, ownerId } = request;
  const w = s.workers.find((w) => w.id === id);
  if (w) {
    if (w.duty !== 'auto')
      return {
        requested: false,
        reason: `${id} is under ${w.duty === 'manual' ? 'manual control; move it yourself or release control' : 'rest duty; release it to automatic work'}.`,
      };
    if (w.path.length)
      return {
        requested: false,
        reason: `${id} is already walking; waiting for its checked route to clear the action.`,
      };
    if (
      w.job ||
      w.processAssignment ||
      w.railAssignment ||
      w.deliveryOrder ||
      w.vehicle ||
      w.transition ||
      w.transportOrder ||
      w.commuteOrder ||
      w.parkingEquipment ||
      w.actionClearanceEquipment ||
      (w.y || 0) > 0.15 ||
      (w.assistingEquipment && w.assistingEquipment !== requesterEquipmentId)
    )
      return {
        requested: false,
        reason: `${id} must finish its current physical work safely before yielding.`,
      };
    if (!shiftIsActive(s, w) || (w.shiftPhase && w.shiftPhase !== 'working'))
      return { requested: false, reason: `${id} is off duty or commuting.` };
    for (const target of candidates(w, envelopes, [2, 4, 6, 9])) {
      if (workerMoveBlocked(s, w, target)) continue;
      const path = walkRoute(s, w, target, staticObstacleRects(s));
      if (!path?.length) continue;
      w.path = path;
      w.yieldingTo = requesterEquipmentId || ownerId;
      w.yieldTarget = undefined;
      w.status = `Walking clear for ${ownerId}`;
      return { requested: true, reason: `${id} is walking to checked clear ground.` };
    }
    return {
      requested: false,
      reason: `${id} has no collision-free walking refuge; clear nearby space.`,
    };
  }
  const e = s.equipment.find((e) => e.id === id);
  if (e) {
    let operator = s.workers.find((w) => w.id === e.operator && w.vehicle === e.id);
    if (operator?.duty === 'manual')
      return {
        requested: false,
        reason: `${id} is under manual control; move it yourself or release control.`,
      };
    if (e.path.length)
      return {
        requested: false,
        reason: `${id} is already moving; waiting for its checked route to clear the action.`,
      };
    if (
      e.job ||
      e.deliveryOrder ||
      e.transportOrder ||
      e.cargo ||
      e.assemblyLoad ||
      e.refueling ||
      e.work
    )
      return {
        requested: false,
        reason: `${id} must finish its current physical work or secure its load before yielding.`,
      };
    if (e.fuel <= 0.01)
      return { requested: false, reason: `${id} needs fuel before it can yield.` };
    if (actionClearanceHoldsEquipment(s, e.id) && e.actionYieldFor !== ownerId)
      return {
        requested: false,
        reason: `${id} is already clearing ${e.actionYieldFor}; the accepted maneuver keeps priority.`,
      };
    if (!operator) {
      let recruited = s.workers.find((w) => w.id === e.actionYieldOperator);
      if (
        recruited &&
        (recruited.duty !== 'auto' || (recruited.vehicle && recruited.vehicle !== e.id))
      ) {
        releaseYieldOperator(s, e);
        return {
          requested: false,
          reason: `${id}'s reserved operator is no longer available for automatic clearance.`,
        };
      }
      if (!recruited) {
        // An explicit automatic operator already walking to this machine keeps
        // priority. Otherwise select a genuinely reachable idle operator.
        const existing = s.workers.find(
          (w) =>
            w.id === e.operator &&
            !w.vehicle &&
            w.duty === 'auto' &&
            !w.path.length &&
            !w.transition &&
            !w.yieldingTo &&
            !w.job &&
            !w.deliveryOrder &&
            !w.transportOrder &&
            !w.processAssignment &&
            !w.railAssignment &&
            !w.parkingEquipment &&
            !w.commuteOrder &&
            !w.actionClearanceEquipment &&
            (!w.shiftPhase || w.shiftPhase === 'working') &&
            shiftIsActive(s, w),
        );
        const choice = selectWorker(s, [machineStep(e)], {
          preferredId: existing?.id,
          eligible: (w) => w.role === 'operator' && !w.path.length && !w.assistingEquipment,
        });
        if (!choice || !choice.path)
          return {
            requested: false,
            reason: `${id} needs an available reachable automatic operator before it can move.`,
          };
        recruited = choice.worker;
        e.actionYieldOperator = recruited.id;
        recruited.actionClearanceEquipment = e.id;
        recruited.path = choice.path;
        recruited.status = `Walk to clear ${id}`;
        noteWorkerAssignment(s, recruited, { equipmentId: e.id, workId: ownerId });
      }
      e.actionYieldFor = ownerId;
      e.actionYieldUntil = s.elapsed + 30;
      if (recruited.transition || recruited.path.length)
        return {
          requested: true,
          reason: `${recruited.id} is walking or boarding to clear ${id}.`,
        };
      if (dist(recruited, machineStep(e)) > 0.3) {
        const path = walkRoute(s, recruited, machineStep(e), staticObstacleRects(s));
        if (!path)
          return {
            requested: false,
            reason: `${recruited.id} cannot reach ${id}'s boarding step.`,
          };
        recruited.path = path;
        recruited.status = `Walk to clear ${id}`;
        return { requested: true, reason: `${recruited.id} is walking to clear ${id}.` };
      }
      boardMachine(recruited, e);
      return {
        requested: true,
        reason: `${recruited.id} is physically boarding ${id} to clear the action.`,
      };
    }
    if (
      operator.duty !== 'auto' ||
      (!shiftIsActive(s, operator) && !operator.actionClearanceEquipment) ||
      (operator.shiftPhase &&
        operator.shiftPhase !== 'working' &&
        !operator.actionClearanceEquipment)
    )
      return {
        requested: false,
        reason: `${id}'s operator is off duty or unavailable for automatic clearance.`,
      };
    const obstacles = staticObstacleRects(s);
    for (const target of candidates(e, envelopes, [5, 8, 11])) {
      const possible = Array.from({ length: 8 }, (_, i) =>
        equipmentBoxes(e, { ...target, yaw: (i * Math.PI) / 4 }),
      ).flat();
      if (possible.some((a) => envelopes.some((b) => boxOverlap(a, b, 0.3)))) continue;
      for (const reverse of [false, true]) {
        const path = machineRoute(s, { ...e, reverse }, target, obstacles, 60, false);
        if (!path?.length) continue;
        e.path = path;
        e.reverse = reverse;
        e.trafficReverse = reverse || undefined;
        e.actionYieldFor = ownerId;
        e.actionYieldUntil = s.elapsed + 30;
        e.blockedBy = undefined;
        operator.status = `Driving ${id} clear for ${ownerId}`;
        return {
          requested: true,
          reason: `${id} is driving to a checked refuge with ${operator.id}.`,
        };
      }
    }
    return {
      requested: false,
      reason: `${id} has no collision-free driving refuge; clear nearby space.`,
    };
  }
  if (people(s).some((w) => w.id === id))
    return {
      requested: false,
      reason: `${id} is a service crew member completing protected physical work; wait or clear its work corridor.`,
    };
  return {
    requested: false,
    reason: `${id} is fixed infrastructure or stored material; choose another route or relocate/recover it.`,
  };
}
function detail(record: ActionClearance, reason: string) {
  return `${record.requesterEquipmentId || record.ownerId} is blocked during ${record.action} for ${record.ownerId} by ${record.blockerIds.join(', ')} at E${record.point.x.toFixed(1)}, S${record.point.z.toFixed(1)}. ${reason}`;
}
/** One durable owner record, timer and warning across retries and changing blockers. */
export function requestActionClearance(
  s: State,
  request: ClearanceRequest,
): { requested: boolean; reason: string } {
  const records = (s.actionClearances ??= []);
  let record = records.find((r) => r.ownerId === request.ownerId);
  const point = request.envelopes[0] ||
    s.equipment.find((e) => e.id === request.requesterEquipmentId) || { x: 0, z: 0 };
  if (!record) {
    record = {
      ownerId: request.ownerId,
      requesterEquipmentId: request.requesterEquipmentId,
      action: request.action,
      blockerIds: [],
      since: s.elapsed,
      lastSeen: s.elapsed,
      retryAt: 0,
      point: { x: point.x, z: point.z },
    };
    records.push(record);
  }
  if (record.lastSeen !== s.elapsed) record.blockerIds = [];
  if (!record.blockerIds.includes(request.blockerId)) record.blockerIds.push(request.blockerId);
  record.lastSeen = s.elapsed;
  record.action = request.action;
  record.point = { x: point.x, z: point.z };
  record.requesterEquipmentId = request.requesterEquipmentId;
  let result = {
    requested: false,
    reason: `Waiting for ${request.blockerId} to clear ${request.action}.`,
  };
  const retries = (record.blockerRetry ??= {});
  const reasons = (record.blockerReasons ??= {});
  if (s.elapsed >= (retries[request.blockerId] || 0)) {
    retries[request.blockerId] = s.elapsed + 1.5;
    record.retryAt = Math.min(...Object.values(retries));
    result = yieldActor(s, request);
    reasons[request.blockerId] = result.reason;
    if (result.requested)
      s.events.push({
        id: nextId(s, 'EV'),
        time: s.time,
        type: 'Traffic',
        entity: record.ownerId,
        text: detail(record, result.reason),
      });
  } else if (reasons[request.blockerId]) result.reason = reasons[request.blockerId];
  record.reason = record.blockerIds.map((id) => reasons[id] || `Waiting for ${id}.`).join(' ');
  for (const e of s.equipment)
    if (e.actionYieldFor === request.ownerId) e.actionYieldUntil = s.elapsed + 30;
  if (s.elapsed - record.since >= 20) {
    const delivery = s.orders.find((o) => o.id === record!.ownerId);
    let notice = s.notices.find((n) => n.id === record!.noticeId);
    if (!notice && delivery?.unloadBlockage?.warned) {
      notice = s.notices.find(
        (n) =>
          n.title === 'Delivery handling blocked' &&
          n.state !== 'done' &&
          n.entity === (record!.requesterEquipmentId || record!.ownerId) &&
          n.detail.includes(record!.ownerId),
      );
      if (notice) record.noticeId = notice.id;
    }
    const text = detail(record, record.reason);
    if (!notice) {
      notice = {
        id: nextId(s, 'N'),
        time: s.time,
        title: delivery ? 'Delivery handling blocked' : 'Action blocked',
        detail: text,
        entity: delivery ? record.requesterEquipmentId || record.ownerId : record.ownerId,
        state: 'todo',
        seen: false,
        severity: 'warning',
      };
      record.noticeId = notice.id;
      s.notices.unshift(notice);
      s.events.push({
        id: nextId(s, 'EV'),
        time: s.time,
        type: 'Traffic',
        entity: record.ownerId,
        text,
        severity: 'warning',
      });
    } else notice.detail = text;
  }
  return result;
}
export function clearActionClearance(s: State, ownerId: string) {
  const record = s.actionClearances?.find((r) => r.ownerId === ownerId);
  if (record?.noticeId) {
    const notice = s.notices.find((n) => n.id === record.noticeId);
    if (notice) notice.state = 'done';
  }
  if (s.actionClearances)
    s.actionClearances = s.actionClearances.filter((r) => r.ownerId !== ownerId);
}
/** Inactive actions and canceled owners cannot leave stale warnings or refuge leases. */
export function tickActionClearances(s: State) {
  for (const record of [...(s.actionClearances || [])]) {
    if (s.elapsed - record.lastSeen > 3 || !ownerActive(s, record.ownerId)) {
      clearActionClearance(s, record.ownerId);
      continue;
    }
    for (const map of [record.blockerRetry, record.blockerReasons])
      if (map)
        for (const key of Object.keys(map)) if (!record.blockerIds.includes(key)) delete map[key];
  }
  for (const e of s.equipment) {
    const reserved = s.workers.find((w) => w.id === e.actionYieldOperator);
    if (
      e.actionYieldFor &&
      (!actionClearanceHoldsEquipment(s, e.id) ||
        reserved?.duty === 'manual' ||
        reserved?.duty === 'rest')
    ) {
      releaseYieldOperator(s, e);
      e.actionYieldFor = undefined;
      e.actionYieldUntil = undefined;
    }
  }
}
