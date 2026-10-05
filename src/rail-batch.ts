import type { Job, JobGroup, RailWork, RailWorkPose, State } from './types';
import { dist } from './path';
import { trackGeometry } from './track';

/** One physical buffer belongs to the continuous installed route, not each panel. */
export function railBatchGroup(s: State, j: Job): JobGroup | undefined {
  if (j.railStageOnly || j.track?.route === 'branch') return undefined;
  const id = j.track?.groupId || j.parentId;
  return s.jobGroups?.find((g) => g.id === id);
}

function batchMembers(s: State, j: Job) {
  const group = railBatchGroup(s, j);
  return group
    ? s.jobs.filter(
        (other) =>
          other.kind === 'rail' &&
          other.track?.route !== 'branch' &&
          (other.track?.groupId || other.parentId) === group.id,
      )
    : [];
}

/** A later panel must really connect to this end; canceled gaps end the batch. */
export function railBatchContinues(s: State, j: Job) {
  const end = trackGeometry(j).end;
  return batchMembers(s, j).some(
    (other) =>
      other.id !== j.id &&
      !other.cancel &&
      !['done', 'canceled'].includes(other.status) &&
      dist(trackGeometry(other).entry, end) < 0.02,
  );
}

/** Adopt the stationary buffer left by the preceding crew, including after load. */
export function claimRailBatchBuffer(s: State, j: Job, r: RailWork) {
  const group = railBatchGroup(s, j);
  if (!group) return;
  const shared = group.railBuffer;
  if (shared && !shared.pose.secured) {
    // A different route must never steal the loose buffer from its real endpoint.
    if (dist(shared.latestEnd, r.start) > 0.02) return;
    r.buffer = { ...shared.pose };
    shared.ownerJob = j.id;
    return;
  }
  if (!r.buffer || !railBatchContinues(s, j)) return;
  group.railBuffer = {
    pose: { ...r.buffer },
    start: { ...r.start, y: r.buffer.y, yaw: r.entryYaw ?? r.axisYaw },
    latestEnd: { ...r.start, y: r.buffer.y, yaw: r.entryYaw ?? r.axisYaw },
    ownerJob: j.id,
  };
}

/** Called during motion and before releasing the owning equipment/worker. */
export function syncRailBatchBuffer(s: State, j: Job) {
  const group = railBatchGroup(s, j),
    r = j.railWork,
    shared = group?.railBuffer;
  if (!r?.buffer || !shared || (shared.ownerJob && shared.ownerJob !== j.id)) return;
  shared.pose = { ...r.buffer };
  shared.ownerJob = j.status === 'doing' ? j.id : undefined;
  if (r.panel.state === 'installed')
    shared.latestEnd = { ...r.end, y: 0.2, yaw: r.endYaw ?? r.axisYaw };
}

/** Cancellation restores the latest installed end, never the initial batch start. */
export function railBatchSafeEnd(s: State, j: Job): RailWorkPose | undefined {
  return railBatchGroup(s, j)?.railBuffer?.latestEnd;
}

/** Between panels the group remains the authoritative resting asset. */
export function releaseRailBatchBuffer(s: State, j: Job) {
  syncRailBatchBuffer(s, j);
  const group = railBatchGroup(s, j);
  if (group?.railBuffer?.ownerJob === j.id) group.railBuffer.ownerJob = undefined;
}
