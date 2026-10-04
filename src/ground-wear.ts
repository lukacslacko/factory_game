import type { State, Equipment, Point, Rect } from './types';
import { key, dist } from './path';
import { mixAngle, ROAD_CENTER_Z, ROAD_WIDTH } from './motion';

export const GROUND_WEAR_LIMIT = 12000;
// Permanent public access/service surfaces match the starter site's rendered
// dimensions. They exist before player paving and do not compact like dirt.
export const FIXED_TRAVEL_SURFACES: (Rect & { cost: number })[] = [
  { x: -280, z: ROAD_CENTER_Z - ROAD_WIDTH / 2, w: 800, d: ROAD_WIDTH, cost: 1 },
  { x: -12.2, z: -12.9, w: 8.4, d: 28.8, cost: 1 },
  { x: -19.4, z: -11.3, w: 14.2, d: 10.4, cost: 1 },
  { x: -13, z: 14, w: 39, d: 8, cost: 1 },
  { x: -33, z: 17, w: 30, d: 38, cost: 1.08 },
];
function fixedTravelCost(p: Point) {
  let cost: number | undefined;
  for (const r of FIXED_TRAVEL_SURFACES)
    if (p.x >= r.x && p.x < r.x + r.w && p.z >= r.z && p.z < r.z + r.d)
      cost = Math.min(cost ?? Infinity, r.cost);
  return cost;
}
const counts = new WeakMap<Record<string, number>, number>();
/** Dirt compacts under the actual wheel/track strips, never under a parked
 * machine or its bucket. Called only after collision-checked movement commits. */
export function recordEquipmentTravel(s: State, e: Equipment, from: Point & { yaw?: number }) {
  const distance = dist(from, e);
  if (distance <= 1e-7 || e.transportOrder) return;
  const wear = (s.groundWear ??= {});
  let count = counts.get(wear) ?? Object.keys(wear).length;
  const steps = Math.max(1, Math.ceil(distance / 0.2));
  const strip = e.kind === 'excavator' ? 0.94 : 0.68;
  const amount = (distance / steps) * (e.kind === 'excavator' ? 0.025 : 0.016);
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const yaw = mixAngle(from.yaw ?? e.yaw ?? 0, e.yaw ?? from.yaw ?? 0, t);
    const x = from.x + (e.x - from.x) * t,
      z = from.z + (e.z - from.z) * t;
    for (const side of [-strip, strip]) {
      const point = { x: x - Math.sin(yaw) * side, z: z + Math.cos(yaw) * side };
      const k = key(point.x, point.z);
      if (s.paving[k] || fixedTravelCost(point) !== undefined) continue;
      if (wear[k] === undefined) {
        if (count >= GROUND_WEAR_LIMIT) continue;
        wear[k] = 0;
        count++;
      }
      wear[k] = Math.min(1, wear[k] + amount);
    }
  }
  counts.set(wear, count);
}
/** Surface preference is modest: established lanes win between comparable
 * trips, while a large detour still costs more than a direct dirt crossing. */
export function surfaceTravelCost(s: State, p: Point) {
  const k = key(p.x, p.z);
  if (s.paving[k]) return 1;
  const fixed = fixedTravelCost(p);
  if (fixed !== undefined) return fixed;
  const established = Math.min(1, (s.groundWear?.[k] ?? 0) / 0.4);
  return 1.22 - 0.14 * established;
}
