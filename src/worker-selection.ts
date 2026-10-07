import type { Point, Rect, State, Worker } from './types';
import { workerAvailable } from './workforce';
import { walkRoute, staticObstacleRects } from './traffic';
import { machineStep } from './boarding';
import { dist } from './path';
import { actionClearanceHoldsEquipment } from './action-clearance';

export interface WorkerChoice {
  worker: Worker;
  point: Point;
  path: Point[];
  distance: number;
  score: number;
}
export interface WorkerSelectionOptions {
  candidates?: Worker[];
  eligible?: (w: Worker) => boolean;
  preferredId?: string;
  equipmentId?: string;
  workId?: string;
  allowVehicle?: boolean;
  allowJobId?: string;
  allowAssignedSupport?: boolean;
  obstacles?: Rect[];
  /** A caller may supply the exact collision checks used by its physical action. */
  route?: (w: Worker, point: Point, origin: Point) => Point[] | null;
}
const continuity = new WeakMap<
  State,
  Map<string, { equipmentId?: string; workId?: string; time: number }>
>();
export function noteWorkerAssignment(
  s: State,
  w: Worker,
  context: Pick<WorkerSelectionOptions, 'equipmentId' | 'workId'>,
) {
  let records = continuity.get(s);
  if (!records) continuity.set(s, (records = new Map()));
  records.set(w.id, { ...context, time: s.elapsed });
}
/** Matches the actual half-meter standing positions used by ordinary construction/fuel approaches. */
export function workerApproachPoints(r: Rect): Point[] {
  const out: Point[] = [];
  for (let x = Math.floor(r.x); x < r.x + r.w; x++)
    out.push({ x: x + 0.5, z: r.z - 0.5 }, { x: x + 0.5, z: r.z + r.d + 0.5 });
  for (let z = Math.floor(r.z); z < r.z + r.d; z++)
    out.push({ x: r.x - 0.5, z: z + 0.5 }, { x: r.x + r.w + 0.5, z: z + 0.5 });
  return out;
}
export function workerCanStart(s: State, w: Worker, o: WorkerSelectionOptions = {}) {
  const seated = w.vehicle ? s.equipment.find((e) => e.id === w.vehicle) : undefined;
  if (seated && (seated.path.length || seated.trafficGoal)) return false;
  return (
    (!w.vehicle || !actionClearanceHoldsEquipment(s, w.vehicle)) &&
    workerAvailable(s, w) &&
    (!w.job || w.job === o.allowJobId) &&
    !w.transition &&
    !w.deliveryOrder &&
    !w.transportOrder &&
    (!w.vehicle || !!o.allowVehicle) &&
    (w.duty === 'auto' || (w.duty === 'manual' && w.id === o.preferredId)) &&
    (!w.assistingEquipment || w.assistingEquipment === o.equipmentId || o.allowAssignedSupport) &&
    (!o.eligible || o.eligible(w))
  );
}
/** Only NEW assignments are scored. Active physical work is never reconsidered or stolen.
 * Euclidean lower bounds prune route searches, but the winner uses its real reachable path length.
 * A two-meter, thirty-second continuity credit only breaks nearby choices; task FIFO is unchanged. */
export function selectWorker(
  s: State,
  goals: Point[] | ((w: Worker) => Point[]),
  o: WorkerSelectionOptions = {},
): WorkerChoice | undefined {
  if (o.equipmentId && actionClearanceHoldsEquipment(s, o.equipmentId)) return;
  const obstacles = o.obstacles || staticObstacleRects(s),
    records = continuity.get(s);
  const candidates = (o.candidates || s.workers)
    .filter((w) => workerCanStart(s, w, o))
    .map((w) => {
      const e = w.vehicle ? s.equipment.find((e) => e.id === w.vehicle) : undefined,
        origin = e ? machineStep(e) : w;
      const points = (typeof goals === 'function' ? goals(w) : goals)
        .map((point) => ({ point, lower: dist(origin, point) }))
        .sort((a, b) => a.lower - b.lower || a.point.x - b.point.x || a.point.z - b.point.z);
      const recent = records?.get(w.id),
        credit =
          recent &&
          s.elapsed - recent.time >= 0 &&
          s.elapsed - recent.time < 30 &&
          ((o.equipmentId && o.equipmentId === recent.equipmentId) ||
            (o.workId && o.workId === recent.workId))
            ? 2
            : 0;
      return {
        w,
        origin,
        points,
        credit,
        lower: (points[0]?.lower ?? Infinity) - credit,
        preferred: w.id === o.preferredId,
      };
    })
    .sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        a.lower - b.lower ||
        a.w.id.localeCompare(b.w.id),
    );
  let best: WorkerChoice | undefined,
    preferred = false;
  for (const c of candidates) {
    if (best && preferred && !c.preferred) break;
    if (best && !c.preferred && !preferred && c.lower > best.score + 1e-8) continue;
    for (const { point, lower } of c.points) {
      if (best && (!c.preferred || preferred) && lower - c.credit > best.score + 1e-8) break;
      // A seated operator does not step out and walk back into their own cab.
      // The exterior boarding point may currently be obstructed by nearby stock.
      const alreadyAboard =
        o.allowVehicle &&
        !!o.equipmentId &&
        o.equipmentId === c.w.vehicle &&
        dist(c.origin, point) < 1e-8;
      const path = alreadyAboard
        ? []
        : o.route
          ? o.route(c.w, point, c.origin)
          : walkRoute(s, { ...c.w, ...c.origin }, point, obstacles);
      if (!path) continue;
      let length = 0,
        at = c.origin;
      for (const p of path) {
        length += dist(at, p);
        at = p;
      }
      const score = length - c.credit;
      if (
        !best ||
        (c.preferred && !preferred) ||
        (c.preferred === preferred &&
          (score < best.score - 1e-8 ||
            (Math.abs(score - best.score) < 1e-8 && c.w.id.localeCompare(best.worker.id) < 0)))
      ) {
        best = { worker: c.w, point, path, distance: length, score };
        preferred = c.preferred;
      }
    }
  }
  return best;
}
