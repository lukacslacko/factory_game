import type { Job, Rail, Stack, State } from './types';
import { trackGeometry, railCells } from './track';
import { MATERIALS } from './catalog';
import { overlap } from './path';
import { carrierRects } from './delivery';

/** A pickup descriptor, not inventory: installed steel is counted only as rail. */
export function recoverySource(s: State, j: Job): Stack | undefined {
  const rail = s.rails.find((r) => r.id === j.railRecovery?.railId);
  if (!rail || !j.railRecovery) return undefined;
  const pose = trackGeometry(rail).pose,
    m = MATERIALS[j.railRecovery.recoveredItem];
  return {
    id: rail.id,
    item: j.railRecovery.recoveredItem,
    x: pose.x - m.w / 2,
    z: pose.z - m.d / 2,
    w: m.w,
    d: m.d,
    yaw: pose.yaw,
    trackHand: rail.track?.hand ?? 1,
    qty: 1,
    reserved: 1,
    source: rail.id,
  };
}
/** Check again immediately before lifting: a train may have arrived since planning. */
export function railRecoveryConflict(s: State, rail: Rail, ownJobId?: string): string {
  if (rail.id.startsWith('BOOTSTRAP-'))
    return 'The public mainline and original receiving siding are protected.';
  const location = s.railLocations?.find((l) => l.trackId === rail.id);
  if (location)
    return `Remove named rail point ${location.name} (${location.id}) before recovering its track.`;
  const cells = railCells(rail).map((p) => ({ ...p, w: 1, d: 1 }));
  if (carrierRects(s).some((r) => cells.some((c) => overlap(c, r))))
    return 'A delivery vehicle occupies this track; let it leave before recovery.';
  const work = s.jobs.find(
    (j) =>
      j.id !== ownJobId &&
      !['done', 'canceled'].includes(j.status) &&
      ((j.kind === 'throwSwitch' &&
        (j.target === rail.id ||
          (rail.track?.groupId &&
            s.rails.find((r) => r.id === j.target)?.track?.groupId === rail.track.groupId))) ||
        (j.kind === 'rail' &&
          cells.some((c) => railCells(j).some((p) => overlap(c, { ...p, w: 1, d: 1 }))))),
  );
  return work ? `Finish or cancel ${work.id} before recovering this rail.` : '';
}
