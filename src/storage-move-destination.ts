import type { Job, State } from './types';
import { MATERIALS } from './catalog';
import { angleDelta } from './motion';
import { overlap } from './path';
import { staticObstacleRects } from './traffic';
import { electricalPlannedRects } from './electrical-geometry';

/** Recheck the reserved landing footprint before lowering any supported load. */
export function storageMoveDestinationError(s: State, j: Job) {
  const m = j.stockMove;
  if (!m?.toStorage) return '';
  const d = m.destination;
  const zone = s.zones.find((z) => z.id === m.zoneId);
  if (
    !zone ||
    d.x < zone.x ||
    d.z < zone.z ||
    d.x + d.w > zone.x + zone.w ||
    d.z + d.d > zone.z + zone.d
  )
    return 'The selected stockyard is unavailable; restore its reserved landing space.';
  const target = s.stacks.find((t) => t.id === m.mergeId);
  const ownPlaceholder = target?.storageCarriedBy === j.id;
  if (
    target &&
    !ownPlaceholder &&
    (target.item !== j.item ||
      target.x !== d.x ||
      target.z !== d.z ||
      target.w !== d.w ||
      target.d !== d.d ||
      Math.abs(angleDelta(target.yaw || 0, m.yaw)) > 0.01 ||
      (target.trackHand ?? 1) !==
        (m.load?.trackHand ?? s.stacks.find((t) => t.id === m.sourceId)?.trackHand ?? 1))
  )
    return `Reserved destination ${target.id} changed; restore its original material and footprint.`;
  if (target && target.qty + j.qty > MATERIALS[j.item!].max)
    return `Reserved destination ${target.id} has insufficient stack capacity; clear space before lowering.`;
  const obstacle = [...staticObstacleRects(s), ...electricalPlannedRects(s)].find(
    (r) => (r as { id?: string }).id !== target?.id && overlap(r, d, 0.06),
  );
  if (obstacle)
    return `Storage landing space is obstructed by ${(obstacle as { id?: string }).id || 'planned infrastructure'}; clear the footprint before lowering.`;
  return '';
}
