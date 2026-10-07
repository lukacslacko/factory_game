import type { State, Worker, Point } from './types';
import { dist } from './path';
import { localPoint } from './motion';
import { workerAvailable } from './workforce';
import { walkRoute, staticObstacleRects, workerMoveBlocked } from './traffic';

/** A support worker belongs to one machine, while its physical task keeps its own owner. */
export function workerSupportsEquipment(w: Worker, equipmentId?: string): boolean {
  return !w.assistingEquipment || w.assistingEquipment === equipmentId;
}
export function equipmentAssistant(s: State, equipmentId: string): Worker | undefined {
  return s.workers.find((w) => w.assistingEquipment === equipmentId);
}
function busy(w: Worker): boolean {
  return !!(
    w.job ||
    w.processAssignment ||
    w.deliveryOrder ||
    w.transportOrder ||
    w.transition ||
    w.vehicle ||
    w.parkingEquipment ||
    w.yieldingTo
  );
}
export function availableEquipmentAssistant(s: State, equipmentId: string): Worker | undefined {
  const w = equipmentAssistant(s, equipmentId);
  return w &&
    workerAvailable(s, w) &&
    w.duty === 'auto' &&
    !busy(w) &&
    (!w.path.length || ownsFollowPath(s, w))
    ? w
    : undefined;
}
/** Explicit crew assignments wait for their own helper rather than quietly stealing another. */
export function equipmentAssistantReason(s: State, equipmentId: string): string {
  const w = equipmentAssistant(s, equipmentId);
  if (!w || availableEquipmentAssistant(s, equipmentId)) return '';
  if (!workerAvailable(s, w))
    return `Assigned support worker ${w.id} is off shift, commuting, or unavailable`;
  if (w.duty !== 'auto')
    return `Assigned support worker ${w.id} is ${w.duty === 'rest' ? 'resting' : 'under manual control'}`;
  return `Waiting for assigned support worker ${w.id} to finish the current operation`;
}
interface Follow {
  path?: Point[];
  target?: Point;
  retry: number;
}
const following = new WeakMap<State, Map<string, Follow>>();
function records(s: State): Map<string, Follow> {
  let entries = following.get(s);
  if (!entries) following.set(s, (entries = new Map()));
  return entries;
}
function ownsFollowPath(s: State, w: Worker): boolean {
  const prior = records(s).get(w.id);
  return (
    !!w.path.length &&
    !w.yieldingTo &&
    !/^(Walking clear|Clear of lift)/.test(w.status) &&
    (prior?.path === w.path ||
      (prior?.target && dist(w.path.at(-1)!, prior.target) < 0.01) ||
      w.status.startsWith('Supporting '))
  );
}
export function setEquipmentAssistant(s: State, equipmentId: string, workerId?: string): string {
  const e = s.equipment.find((q) => q.id === equipmentId);
  if (!e) return 'Equipment not found.';
  const next = workerId ? s.workers.find((w) => w.id === workerId) : undefined;
  if (workerId && !next) return 'Worker not found.';
  if (next?.role === 'operator')
    return 'Choose a builder or engineer as the support worker; the machine still needs its own operator.';
  if (next?.assistingEquipment && next.assistingEquipment !== equipmentId)
    return `This worker already supports ${next.assistingEquipment}. Release that crew assignment first.`;
  const previous = equipmentAssistant(s, equipmentId);
  if(next?.processAssignment || previous?.processAssignment)return 'Finish the physical process operation before changing this support crew.';
  if (previous === next) return '';
  // Never cancel a lift, carried load, commute, or player command when changing crews.
  for (const w of [previous, next]) {
    if (!w) continue;
    if (!busy(w) && ownsFollowPath(s, w)) w.path = [];
    records(s).delete(w.id);
  }
  if (previous) previous.assistingEquipment = undefined;
  if (next) next.assistingEquipment = equipmentId;
  s.events.push({
    id: `EV-${String(s.next++).padStart(4, '0')}`,
    time: s.time,
    type: 'Crew',
    entity: equipmentId,
    text: next
      ? `${next.id} assigned as the dedicated support worker. Existing physical work finishes before joining the machine.`
      : 'Dedicated support worker released. Existing physical work continues safely.',
  });
  s.revision++;
  return '';
}

// workerMoveBlocked allows escape from an existing overlap. A standing location
// must instead be completely clear, even if an imported worker already touches it.
function clearStandingPoint(s: State, w: Worker, p: Point): boolean {
  return !workerMoveBlocked(s, { id: w.id, x: -10000, z: -10000 }, p);
}

/** A helper can shadow its own machine's transit, between physical rigging operations. */
function accompanyingTransit(s: State, w: Worker, equipmentId: string): boolean {
  const e = s.equipment.find((q) => q.id === equipmentId);
  if (
    !e?.path.length ||
    w.transition ||
    w.vehicle ||
    w.transportOrder ||
    w.parkingEquipment ||
    w.yieldingTo
  )
    return false;
  const job = w.job ? s.jobs.find((j) => j.id === w.job) : undefined;
  if (
    job?.equipment === equipmentId &&
    job.worker === w.id &&
    job.status === 'doing' &&
    ['rail', 'moveStock'].includes(job.kind)
  ) {
    // The initial collection route starts before the detailed rail handling
    // sequence is initialized. It already belongs to this equipment and crew.
    if (!job.railWork) return true;
    return [
      // Approaches are travel too: the dedicated rigger must accompany the
      // machine before it parks, rather than starting a long walk after arrival.
      // Once parked, this hook stops and railwork owns the exact rigging walk.
      'source-approach',
      'source-clear',
      'stage-travel',
      'legacy-fork-withdraw',
      'unbolt-buffer',
      'buffer-rig',
      'panel-carry',
      'panel-approach',
      'buffer-carry-aside',
      'buffer-retrieve',
      'buffer-rig-return',
      'buffer-carry-end',
      'cancel-panel-return',
    ].includes(job.railWork.phase);
  }
  const order = w.deliveryOrder ? s.orders.find((o) => o.id === w.deliveryOrder) : undefined;
  return (
    !!order?.unload &&
    order.unload.equipmentId === equipmentId &&
    order.unload.riggerId === w.id &&
    ['approach', 'carry'].includes(order.unload.phase)
  );
}

/** Helpers walk to clear nearby ground, idle or accompanying their own machine's travel. */
export function updateEquipmentAssistants(s: State, _dt: number): void {
  for (const w of s.workers) {
    if (!w.assistingEquipment || w.role === 'operator') continue;
    const e = s.equipment.find((q) => q.id === w.assistingEquipment);
    const own = ownsFollowPath(s, w);
    const transit = !!e && accompanyingTransit(s, w, e.id);
    const transitAllowed =
      transit && w.duty === 'auto' && (workerAvailable(s, w) || w.shiftPhase === 'finishing');
    if (!e || e.transportOrder || (!availableEquipmentAssistant(s, e.id) && !transitAllowed)) {
      // Returning to rigging/fastening gives the operation immediate control of
      // its helper. Explicit clearance, yielding, and operation paths are untouched.
      if (own) w.path = [];
      continue;
    }
    if (w.path.length && !own) continue;
    const prior = records(s).get(w.id) || { retry: 0 };
    if (s.elapsed < prior.retry) continue;
    prior.retry = s.elapsed + 2;
    records(s).set(w.id, prior);
    // Staying put near the machine avoids needless circling and keeps access clear.
    if (dist(w, e) <= 6.5 && clearStandingPoint(s, w, w)) {
      if (own) w.path = [];
      w.status = `Supporting ${e.id} · ready nearby`;
      prior.path = undefined;
      prior.target = undefined;
      continue;
    }
    const yaw = e.yaw ?? (e.heading * Math.PI) / 2;
    const candidates = [
      [0, 4.5],
      [0, -4.5],
      [-4.5, 3.5],
      [-4.5, -3.5],
      [-6, 0],
      [0, 6.5],
      [0, -6.5],
    ]
      .map(([forward, side]) => localPoint({ ...e, yaw }, forward, side))
      .filter((p) => clearStandingPoint(s, w, p) && !e.path.some((q) => dist(q, p) < 2))
      .sort((a, b) => dist(w, a) - dist(w, b));
    if (own && prior.target && candidates.some((p) => dist(p, prior.target!) < 2)) continue;
    let path: Point[] | null = null;
    for (const target of candidates) {
      path = walkRoute(s, w, target, staticObstacleRects(s));
      if (path) {
        prior.target = target;
        break;
      }
    }
    if (path) {
      w.path = path;
      prior.path = path;
      w.status = `Supporting ${e.id} · walking nearby`;
    } else {
      if (own) w.path = [];
      prior.path = undefined;
      w.status = `Supporting ${e.id} · no clear walking route nearby`;
    }
  }
}
