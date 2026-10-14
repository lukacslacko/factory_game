import type { State, Equipment, Point, Rect } from './types';
import { key, dist } from './path';
import { mixAngle, ROAD_CENTER_Z, ROAD_WIDTH } from './motion';

export const GROUND_WEAR_LIMIT = 12000;
/** Full wheel-rut recovery takes six quiet game hours. Larger plants return
 * later, after the ground has recovered from repeated traffic. */
export const GROUND_RECOVERY_SECONDS = 6 * 3600;
export const BUSH_RETURN_SECONDS = 18 * 3600;
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
const stockFootprints = new WeakMap<State, Map<string, Rect>>();
/** Stock suppresses plants while it is present. When a pile is first placed,
 * moved, or removed, leave compacted ground behind so lifting it cannot reveal
 * a full-grown patch of grass and bushes on the next frame. Unchanged piles
 * cost only one ID/footprint comparison per update. */
export function recordStockFootprints(s: State) {
  let previous = stockFootprints.get(s);
  if (!previous) {
    previous = new Map();
    stockFootprints.set(s, previous);
  }
  const seen = new Set<string>();
  const changed: Rect[] = [];
  for (const stack of s.stacks) {
    if ((stack.qty <= 0 && stack.item !== 'diesel') || stack.storageCarriedBy || stack.electricalCarriedBy) continue;
    seen.add(stack.id);
    const old = previous.get(stack.id);
    if (old && old.x === stack.x && old.z === stack.z && old.w === stack.w && old.d === stack.d) continue;
    if (old) changed.push(old);
    const footprint = { x: stack.x, z: stack.z, w: stack.w, d: stack.d };
    changed.push(footprint);
    previous.set(stack.id, footprint);
  }
  for (const [id, footprint] of previous) {
    if (seen.has(id)) continue;
    changed.push(footprint);
    previous.delete(id);
  }
  if (!changed.length) return;
  const wear = (s.stockGroundWear ??= {});
  const disturbed = (s.vegetationLastDisturbed ??= {});
  let wearCount = counts.get(wear) ?? Object.keys(wear).length;
  let disturbedCount = counts.get(disturbed) ?? Object.keys(disturbed).length;
  for (const rect of changed) {
    for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.w); x++) {
      for (let z = Math.floor(rect.z); z < Math.ceil(rect.z + rect.d); z++) {
        const point = { x: x + 0.5, z: z + 0.5 };
        const k = `${x},${z}`;
        if (s.paving[k] || fixedTravelCost(point) !== undefined) continue;
        if (wear[k] !== undefined || wearCount < GROUND_WEAR_LIMIT) {
          if (wear[k] === undefined) wearCount++;
          wear[k] = 1;
        }
        if (disturbed[k] !== undefined || disturbedCount < GROUND_WEAR_LIMIT) {
          if (disturbed[k] === undefined) disturbedCount++;
          disturbed[k] = s.elapsed;
        }
      }
    }
  }
  counts.set(wear, wearCount);
  counts.set(disturbed, disturbedCount);
}
/** Dirt compacts under the actual wheel/track strips, never under a parked
 * machine or its bucket. Called only after collision-checked movement commits. */
export function recordEquipmentTravel(s: State, e: Equipment, from: Point & { yaw?: number }) {
  const distance = dist(from, e);
  if (distance <= 1e-7 || e.transportOrder) return;
  const wear = (s.groundWear ??= {});
  const disturbed = (s.vegetationLastDisturbed ??= {});
  let count = counts.get(wear) ?? Object.keys(wear).length;
  let disturbedCount = counts.get(disturbed) ?? Object.keys(disturbed).length;
  const steps = Math.max(1, Math.ceil(distance / 0.2));
  const strip = e.kind === 'excavator' ? 0.94 : 0.68;
  const amount = (distance / steps) * (e.kind === 'excavator' ? 0.025 : 0.016);
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const yaw = mixAngle(from.yaw ?? e.yaw ?? 0, e.yaw ?? from.yaw ?? 0, t);
    const x = from.x + (e.x - from.x) * t,
      z = from.z + (e.z - from.z) * t;
    // The whole chassis brushes through shrubs; compaction itself is limited
    // to the physical track/tire strips below.
    const halfWidth = e.kind === 'excavator' ? 1.4 : 0.95;
    for (const side of [-halfWidth, 0, halfWidth]) {
      const point = { x: x - Math.sin(yaw) * side, z: z + Math.cos(yaw) * side };
      const k = key(point.x, point.z);
      if (s.paving[k] || fixedTravelCost(point) !== undefined) continue;
      if (disturbed[k] === undefined) {
        if (disturbedCount >= GROUND_WEAR_LIMIT) continue;
        disturbedCount++;
      }
      disturbed[k] = s.elapsed;
    }
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
  counts.set(disturbed, disturbedCount);
}
/** Recovery is advanced only at game-minute boundaries. Plant coordinates do
 * not change: the renderer grows the same stable instances back in place. */
export function recoverGround(s: State, previousElapsed: number) {
  const minutes = Math.floor(s.elapsed / 60) - Math.floor(previousElapsed / 60);
  if (minutes <= 0) return;
  for (const wear of [(s.groundWear ??= {}), (s.stockGroundWear ??= {})]) {
    for (const k of Object.keys(wear)) {
      const recovered = Math.max(0, wear[k] - (minutes * 60) / GROUND_RECOVERY_SECONDS);
      if (recovered < 0.001) delete wear[k];
      else wear[k] = recovered;
    }
    counts.set(wear, Object.keys(wear).length);
  }
  const disturbed = (s.vegetationLastDisturbed ??= {});
  for (const k of Object.keys(disturbed))
    if (s.elapsed - disturbed[k] >= BUSH_RETURN_SECONDS && s.groundWear![k] === undefined && s.stockGroundWear![k] === undefined)
      delete disturbed[k];
  counts.set(disturbed, Object.keys(disturbed).length);
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
