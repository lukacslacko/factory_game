import type { Job, Point, Rail, Rect, State, Worker } from './types';
import { trackGeometry, trackSections } from './track';
import { dist } from './path';
import { turn } from './motion';
import { walkRoute, workerMoveBlocked, railRollingStockAxles, boxOverlap } from './traffic';
import { workerAvailable } from './workforce';
import { selectWorker, noteWorkerAssignment } from './worker-selection';
import { railRouteReserved } from './rail-operations';

export const TURNOUT_THROW_SECONDS = 4;
export interface TurnoutOperationAPI {
  createJob?(s: State, r: Rect, target: string): Job;
  obstacles(s: State): Rect[];
  event(s: State, type: string, entity: string, text: string): void;
  complete(s: State, j: Job): void;
  release(s: State, j: Job): void;
}

export function turnoutIsComplete(s: State, rail: Rail): boolean {
  const p = rail.track;
  if (!p || p.layout !== 'turnout' || p.section !== 0 || !p.groupId) return false;
  const jobs = s.jobs.filter((j) => j.track?.groupId === p.groupId);
  const installed = s.rails.filter((r) => r.track?.groupId === p.groupId);
  const expected = trackSections('turnout', p.origin, p.heading, p.hand);
  return (
    jobs.length === 7 &&
    jobs.every((j) => j.status === 'done') &&
    installed.length === 7 &&
    expected.every((part) =>
      installed.some(
        (r) =>
          r.track?.section === part.section &&
          r.track.route === part.route &&
          r.track.layout === part.layout &&
          r.track.heading === part.heading &&
          r.track.hand === part.hand &&
          r.track.origin.x === part.origin.x &&
          r.track.origin.z === part.origin.z,
      ),
    )
  );
}

function leverPoint(rail: Rail, offset: number): Point & { yaw: number } {
  const through = trackGeometry(
    rail.track?.flow ? { ...rail.track, flow: undefined } : rail,
  ).paths.find((path) => path.route === 'straight');
  if (!through || rail.track?.layout !== 'turnout' || rail.track.section !== 0)
    throw new Error('A manual lever belongs to an installed turnout points module');
  const start = through.points[0],
    end = through.points[through.points.length - 1];
  const yaw = start.yaw,
    side = -rail.track.hand * offset;
  return {
    x: start.x + (end.x - start.x) * 0.19 - Math.sin(yaw) * side,
    z: start.z + (end.z - start.z) * 0.19 + Math.cos(yaw) * side,
    yaw,
  };
}
/** Matches the rendered lever beside the through route's first throw rod. */
export const turnoutLeverPose = (rail: Rail) => leverPoint(rail, 0.9);
/** The worker stands beyond the sleepers and reaches 65 cm to the handle. */
export const turnoutWorkerPoint = (rail: Rail) => leverPoint(rail, 1.55);

/** No lever is thrown while any wheel remains in the turnout's full
 * twenty-meter crossing envelope, including either tail and both routes. */
export function turnoutOccupant(s: State, rail: Rail): string | undefined {
  const p = rail.track;
  if (!p || p.layout !== 'turnout') return;
  const stock = railRollingStockAxles(s);
  for (const piece of trackSections('turnout', p.origin, p.heading, p.hand, undefined, p.flow))
    for (const path of trackGeometry(piece).paths)
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1],
          b = path.points[i];
        const section = {
          x: (a.x + b.x) / 2,
          z: (a.z + b.z) / 2,
          yaw: Math.atan2(b.z - a.z, b.x - a.x),
          length: Math.hypot(b.x - a.x, b.z - a.z),
          width: 2,
        };
        const actor = stock.find((q) => boxOverlap(section, q, 0.2));
        if (actor) return actor.id;
      }
}
function unsafeTurnout(s: State, rail: Rail): string | undefined {
  const reserved = railRouteReserved(s, rail.id);
  if (reserved) return `Turnout reserved by ${reserved}; wait until the train clears it.`;
  const occupied = turnoutOccupant(s, rail);
  if (occupied)
    return `Turnout occupied by ${occupied}; move the rolling stock clear before throwing the lever.`;
}
export function queueTurnoutOperation(
  s: State,
  rail: Rail,
  route: 'straight' | 'branch',
  api: TurnoutOperationAPI,
): string {
  const unsafe = unsafeTurnout(s, rail);
  if (unsafe) return unsafe;
  if (
    s.jobs.some(
      (j) =>
        j.railRecovery &&
        !['done', 'canceled'].includes(j.status) &&
        j.railRecovery.rail.track?.groupId === rail.track?.groupId,
    )
  )
    return 'Finish or cancel rail recovery before operating this turnout.';
  if (!turnoutIsComplete(s, rail))
    return 'Finish all seven panels and rail joints before changing the turnout.';
  if (!['straight', 'branch'].includes(route)) return 'Choose Straight or Branch.';
  const pending = s.jobs.find(
    (j) =>
      j.kind === 'throwSwitch' && j.target === rail.id && !['done', 'canceled'].includes(j.status),
  );
  if (pending)
    return `Turnout operation ${pending.id} is already queued; finish or cancel it first.`;
  if ((rail.selectedRoute || 'straight') === route) return `Turnout is already set to ${route}.`;
  if (!api.createJob) throw new Error('Turnout operation requires the yard job allocator');
  const foot = turnoutWorkerPoint(rail);
  const job = api.createJob(s, { x: foot.x - 0.5, z: foot.z - 0.5, w: 1, d: 1 }, rail.id);
  job.qty = 0;
  job.item = undefined;
  job.requestedRoute = route;
  job.phase = 'Waiting for turnout crew';
  job.reason = '';
  api.event(
    s,
    'Railway',
    job.id,
    `Queued a worker to walk to ${rail.id} and throw its manual lever to ${route}.`,
  );
  s.revision++;
  return '';
}

function eligible(s: State, w: Worker, j: Job) {
  return (
    w.role !== 'operator' &&
    (!w.assistingEquipment || w.id === j.preferredWorker) &&
    workerAvailable(s, w) &&
    !w.job &&
    !w.vehicle &&
    !w.transition &&
    !w.deliveryOrder &&
    !w.transportOrder &&
    (w.duty === 'auto' || w.id === j.preferredWorker)
  );
}
export function assignTurnoutOperation(s: State, j: Job, api: TurnoutOperationAPI): boolean {
  if (j.kind !== 'throwSwitch') return false;
  const rail = s.rails.find((r) => r.id === j.target);
  if (!rail || !turnoutIsComplete(s, rail)) {
    j.reason = 'Waiting for a complete installed turnout';
    return true;
  }
  const unsafe = unsafeTurnout(s, rail);
  if (unsafe) {
    j.reason = unsafe;
    return true;
  }
  const foot = turnoutWorkerPoint(rail);
  const choice=selectWorker(s,[foot],{preferredId:j.preferredWorker,workId:j.parentId||j.id,allowAssignedSupport:true,eligible:w=>eligible(s,w,j),obstacles:api.obstacles(s)});
  const candidates=choice?[choice.worker]:[];
  if (!candidates.length) {
    j.reason = s.workers.some(w=>eligible(s,w,j)) ? 'No walking access to the manual turnout lever; clear the route and standing area' : 'Need an available worker on foot to operate the turnout lever';
    j.retryAt=s.elapsed+2;j.retryRevision=s.revision;
    return true;
  }
  for (const w of candidates) {
    if (workerMoveBlocked(s, w, foot)) continue;
    const path = walkRoute(s, w, foot, api.obstacles(s));
    if (!path) continue;
    j.worker = w.id;
    j.status = 'doing';
    j.phase = 'Walk to turnout lever';
    j.reason = '';
    j.elapsed = 0;
    j.progress = 0;
    j.retryAt = undefined;
    j.retryRevision = undefined;
    w.job = j.id;
    noteWorkerAssignment(s,w,{workId:j.parentId||j.id});
    w.path = path;
    w.status = j.phase;
    api.event(s, 'Work', j.id, `${w.name} assigned to operate the manual lever at ${rail.id}.`);
    s.revision++;
    return true;
  }
  j.reason = 'No walking access to the manual turnout lever; clear the route and standing area';
  j.retryAt = s.elapsed + 2;
  j.retryRevision = s.revision;
  return true;
}

function finishCanceled(s: State, j: Job, api: TurnoutOperationAPI) {
  j.elapsed = 0;
  api.release(s, j);
  j.status = 'canceled';
  j.phase = 'Canceled; turnout retains its original route';
  j.finished = s.time;
  j.reason = '';
  j.progress = 0;
  api.event(
    s,
    'Railway',
    j.target!,
    'The worker returned the manual lever to its original route before canceling.',
  );
  s.revision++;
}
export function tickTurnoutOperation(
  s: State,
  j: Job,
  dt: number,
  api: TurnoutOperationAPI,
): boolean {
  if (j.kind !== 'throwSwitch') return false;
  const rail = s.rails.find((r) => r.id === j.target),
    w = s.workers.find((w) => w.id === j.worker);
  if (!rail || !turnoutIsComplete(s, rail) || !w || w.job !== j.id) {
    j.reason = 'The manual turnout operation needs its installed points and assigned worker';
    return true;
  }
  const unsafe = unsafeTurnout(s, rail);
  if (unsafe) {
    j.reason = unsafe;
    w.status = 'Waiting for turnout clearance';
    return true;
  }
  const foot = turnoutWorkerPoint(rail),
    lever = turnoutLeverPose(rail);
  if (w.path.length || w.transition || w.vehicle || w.yieldingTo) {
    j.reason = w.blockedBy
      ? `Waiting for ${w.blockedBy} to clear the walking route`
      : w.yieldingTo
        ? `Waiting for ${w.yieldingTo} to pass safely`
        : '';
    return true;
  }
  if (dist(w, foot) > 0.12) {
    if ((j.retryAt || 0) > s.elapsed && j.retryRevision === s.revision) return true;
    const path = walkRoute(s, w, foot, api.obstacles(s));
    if (!path || workerMoveBlocked(s, w, foot)) {
      j.reason = 'No walking access to the manual turnout lever; clear the route and standing area';
      j.retryAt = s.elapsed + 2;
      j.retryRevision = s.revision;
      return true;
    }
    w.path = path;
    w.status = 'Walk to turnout lever';
    j.reason = '';
    return true;
  }
  if (workerMoveBlocked(s, w, w)) {
    j.reason = 'Waiting for the turnout standing area to clear';
    return true;
  }
  if (!turn(w, Math.atan2(lever.z - w.z, lever.x - w.x), dt, 3)) return true;
  j.phase = j.cancel ? 'Return lever to original route' : 'Throw manual turnout lever';
  w.status = j.phase;
  j.reason = '';
  j.elapsed = Math.max(0, Math.min(TURNOUT_THROW_SECONDS, j.elapsed + (j.cancel ? -dt : dt)));
  j.progress = j.elapsed / TURNOUT_THROW_SECONDS;
  if (j.cancel && j.elapsed <= 1e-7) finishCanceled(s, j, api);
  else if (!j.cancel && j.elapsed >= TURNOUT_THROW_SECONDS - 1e-7) {
    j.elapsed = TURNOUT_THROW_SECONDS;
    rail.selectedRoute = j.requestedRoute!;
    api.event(
      s,
      'Railway',
      rail.id,
      `${w.name} completed the four-second manual throw and checked the ${rail.selectedRoute} route.`,
    );
    api.complete(s, j);
  }
  return true;
}
