import type { ManeuverReservation, Point, Rect, State } from './types';
import { overlap } from './path';

const LEASE_SECONDS = 6;
const MAX_RESERVATIONS = 512;

/** A short maneuver envelope around the parked machine and its next motion.
 * Long travel corridors remain open to other work and normal traffic control. */
export function maneuverArea(points: readonly Point[], radius: number): Rect {
  const x = Math.min(...points.map((p) => p.x)) - radius;
  const z = Math.min(...points.map((p) => p.z)) - radius;
  return {
    x,
    z,
    w: Math.max(...points.map((p) => p.x)) + radius - x,
    d: Math.max(...points.map((p) => p.z)) + radius - z,
  };
}

function stillOwned(s: State, r: ManeuverReservation) {
  const order = s.orders.find((o) => o.id === r.ownerId);
  if (order) {
    const t = order.unload;
    return !!t && t.equipmentId === r.equipmentId &&
      (r.kind === 'pickup'
        ? ['boarding', 'approach', 'rig', 'lift', 'clear'].includes(t.phase)
        : ['carry', 'lower', 'release', 'back-away'].includes(t.phase));
  }
  const job = s.jobs.find((j) => j.id === r.ownerId);
  if (!job || job.status !== 'doing' || !job.stockMove?.toStorage ||
      job.equipment !== r.equipmentId || !job.handling) return false;
  return r.kind === 'pickup'
    ? ['approach', 'rig', 'engage', 'lift', 'clear'].includes(job.handling.phase)
    : ['carry', 'lower', 'withdraw'].includes(job.handling.phase);
}

/** Revalidate a saved lease before other work can claim its face or bay. */
export function reconcileManeuverReservations(s: State): void {
  if (!s.maneuverReservations?.length) return;
  s.maneuverReservations = s.maneuverReservations.filter((r) =>
    r.expiresAt > s.elapsed && stillOwned(s, r));
}

export function releaseManeuvers(s: State, ownerId: string): void {
  if (!s.maneuverReservations?.length) return;
  s.maneuverReservations = s.maneuverReservations.filter((r) => r.ownerId !== ownerId);
}

/** First valid owner wins until safe release or expiry. Changing docks replaces
 * only the caller's lease; an unavailable new dock never evicts another crew. */
export function claimManeuver(
  s: State,
  request: Pick<ManeuverReservation,
    'ownerId' | 'equipmentId' | 'kind' | 'area' | 'resourceId'>,
): string {
  reconcileManeuverReservations(s);
  s.maneuverReservations ??= [];
  const conflict = s.maneuverReservations.find((r) =>
    r.ownerId !== request.ownerId &&
    (overlap(r.area, request.area, 0.1) ||
      !!request.resourceId && request.resourceId === r.resourceId));
  if (conflict) return conflict.ownerId;
  const existing = s.maneuverReservations.find((r) => r.ownerId === request.ownerId);
  if (existing) {
    Object.assign(existing, request, { refreshedAt: s.elapsed,
      expiresAt: s.elapsed + LEASE_SECONDS });
    return '';
  }
  if (s.maneuverReservations.length >= MAX_RESERVATIONS) return 'maneuver capacity';
  s.maneuverReservations.push({ ...request, acquiredAt: s.elapsed,
    refreshedAt: s.elapsed, expiresAt: s.elapsed + LEASE_SECONDS });
  return '';
}
