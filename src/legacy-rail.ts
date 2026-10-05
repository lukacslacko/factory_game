import type { Equipment, Job, Point, Rect, State } from './types';

import { localPoint } from './motion';
import { boxOverlap, equipmentBoxes, equipmentSweepBlocked, machineRoute } from './traffic';

/** Forks must leave their bearing surfaces in a straight line before steering. */
export function forkStagingWithdrawal(
  s: State,
  empty: Equipment,
  obstacles: Rect[],
): Point[] | null {
  const yaw = empty.yaw ?? (empty.heading * Math.PI) / 2,
    clear = localPoint({ ...empty, yaw }, -3.5, 0);
  for (let step = 1; step <= 18; step++) {
    const p = localPoint({ ...empty, yaw }, (-3.5 * step) / 18, 0);
    if (equipmentSweepBlocked(s, empty, { ...p, yaw })) return null;
    const chassis = equipmentBoxes(empty, { ...p, yaw }, false)[0];
    if (
      obstacles.some((r) =>
        boxOverlap(
          chassis,
          { x: r.x + r.w / 2, z: r.z + r.d / 2, length: r.w, width: r.d, yaw: 0 },
          0.06,
        ),
      )
    )
      return null;
  }
  return [clear];
}

/** A legacy forklift only stages its imported load; the excavator handles the rail itself. */
export function legacyStagingAccessible(
  s: State,
  e: Equipment,
  dock: Point,
  stage: Rect,
  parking: Point,
  yaw: number,
  obstacles: Rect[],
): boolean {
  if (!machineRoute(s, e, dock, obstacles, 350, true)) return false;
  const empty = { ...e, ...dock, yaw, cargo: undefined, reach: 4.2, reverse: true };
  const clear = localPoint(empty, -3.5, 0);
  const obs = [...obstacles, stage];
  if (!forkStagingWithdrawal(s, empty, obs)) return false;
  return !!machineRoute(
    s,
    { ...empty, ...clear, reverse: false, reach: 2.7 },
    parking,
    obs,
    450,
    true,
  );
}

interface LegacyRailAPI {
  release(s: State, j: Job): void;
  event(s: State, type: string, entity: string, text: string): void;
}

// Version 3 permitted a forklift to own a rail-laying job. Version 4 requires
// an excavator for rigging and buffer handling, but the old panel still has a
// physical owner and may already have left stock or been installed.
export function migrateLegacyRailJobs(s: State, api: LegacyRailAPI) {
  for (const j of s.jobs) {
    if (j.kind !== 'rail' || j.status !== 'doing' || j.railWork || j.railStageOnly) continue;
    const e = s.equipment.find((e) => e.id === j.equipment);
    if (e?.kind !== 'forklift') continue;
    const installed =
      j.delivered && s.rails.some((r) => r.x === j.x && r.z === j.z && r.rotation === j.rotation);
    if (e.cargo?.item === 'rail' && !installed) {
      j.legacyRailHandoff = 'carried';
      j.phase = 'Carry to site';
      j.reason = 'Imported forklift load will be placed on staging supports for an excavator';
      e.path = [];
      e.trafficGoal = undefined;
      e.velocity = 0;
      const w = s.workers.find((w) => w.id === j.worker);
      if (w) w.path = [];
      api.event(
        s,
        'Work',
        j.id,
        'Imported rail panel remains on its forklift; a physical staging handoff is required.',
      );
      continue;
    }
    api.release(s, j);
    j.legacyRailHandoff = installed ? 'installed' : undefined;
    j.status = 'todo';
    j.phase = installed ? 'Resume buffer placement' : 'Waiting';
    j.reason = installed
      ? 'Installed panel retained; an excavator must secure the existing buffer'
      : 'Imported rail work released its forklift and awaits an excavator';
    j.retryAt = undefined;
    j.retryRevision = undefined;
    api.event(s, 'Work', j.id, j.reason);
  }
}
