import type { ManeuverReservation, Point, Rect, State } from './types';
import { overlap } from './path';

const LEASE_SECONDS = 6;
const MAX_RESERVATIONS = 512;
type ManeuverClaim = Pick<ManeuverReservation,
  'ownerId' | 'equipmentId' | 'kind' | 'area' | 'resourceId' | 'chokeAreas' | 'priority'>;

export const maneuverFootprints = (r: Pick<ManeuverReservation, 'area' | 'chokeAreas'>) =>
  [r.area, ...(r.chokeAreas || [])];

const claimsConflict = (a: ManeuverClaim, b: ManeuverClaim) =>
  !!a.resourceId && a.resourceId === b.resourceId ||
  maneuverFootprints(a).some((one) =>
    maneuverFootprints(b).some((two) => overlap(one, two, 0.1)));

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
  request: ManeuverClaim,
): string {
  reconcileManeuverReservations(s);
  s.maneuverReservations ??= [];
  const conflict = s.maneuverReservations.find((r) =>
    r.ownerId !== request.ownerId && claimsConflict(r, request));
  if (conflict) return conflict.ownerId;
  const existing = s.maneuverReservations.find((r) => r.ownerId === request.ownerId);
  if (existing) {
    // Optional pinch-point geometry belongs to this exact next maneuver;
    // replacing the dock must not retain an earlier route's choke or resource.
    Object.assign(existing, { resourceId: undefined, chokeAreas: undefined,
      priority: undefined }, request, { refreshedAt: s.elapsed,
      expiresAt: s.elapsed + LEASE_SECONDS });
    return '';
  }
  if (s.maneuverReservations.length >= MAX_RESERVATIONS) return 'maneuver capacity';
  s.maneuverReservations.push({ ...request, acquiredAt: s.elapsed,
    refreshedAt: s.elapsed, expiresAt: s.elapsed + LEASE_SECONDS });
  return '';
}

/** Resolve contenders presented in one update in explicit service priority
 * order. A pre-existing live lease is never preempted, even by a high-priority
 * request; that would invalidate a machine already approaching its load. */
export function claimManeuverBatch(s: State, requests: readonly ManeuverClaim[]) {
  const outcomes = new Map<string, string>();
  for (const request of [...requests].sort((a, b) =>
    (b.priority || 0) - (a.priority || 0) || a.ownerId.localeCompare(b.ownerId)))
    outcomes.set(request.ownerId, claimManeuver(s, request));
  return outcomes;
}
