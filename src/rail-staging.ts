import type { Equipment, Job, RailWork, Stack, State } from './types';
import { EQUIPMENT, MATERIALS } from './catalog';
import { railCrewGroup, workLeaves } from './jobs';

export function railBatchHeld(s: State, j: Job): boolean {
  return (
    !!j.railStagingBatch &&
    j.railStagingBatch !== j.id &&
    s.jobs.some(
      (leader) =>
        leader.id === j.railStagingBatch &&
        leader.status === 'doing' &&
        leader.railWork?.stagingBatch?.jobIds.includes(j.id),
    )
  );
}

export function stagedRailStackOwnedBy(_s: State, stack: Stack, j: Job): boolean {
  return (
    j.legacyRailHandoff === 'staged' &&
    j.stack === stack.id &&
    (stack.source === j.id || !!stack.railStagingJobs?.includes(j.id))
  );
}

/** Preview one real source stack; separate storage stacks are never combined remotely. */
export function planRailStagingBatch(
  s: State,
  j: Job,
  e: Equipment,
  stack: Stack,
): RailWork['stagingBatch'] {
  const group = railCrewGroup(s, j);
  if (!j.railStageOnly || !group?.railCrew || group.railCrew.stagingEquipment !== e.id || !j.item)
    return undefined;
  const capacity = Math.floor(EQUIPMENT[e.kind].capacity / MATERIALS[j.item].mass);
  const max = Math.min(capacity, MATERIALS[j.item].max, stack.qty - stack.reserved + 1);
  const siblings = workLeaves(s, group.id).filter(
    (other) =>
      other.id !== j.id &&
      other.kind === 'rail' &&
      other.item === j.item &&
      other.status === 'todo' &&
      !other.cancel &&
      !other.delivered &&
      !other.stack &&
      !other.railStagingBatch &&
      !['staged', 'installed'].includes(other.legacyRailHandoff || ''),
  );
  const jobIds = [j.id, ...siblings.slice(0, Math.max(0, max - 1)).map((other) => other.id)];
  return jobIds.length > 1 ? { jobIds, qty: jobIds.length } : undefined;
}

export function reserveRailStagingBatch(s: State, j: Job, stack: Stack): void {
  const batch = j.railWork?.stagingBatch;
  if (!batch) return;
  for (const jobId of batch.jobIds) {
    const member = s.jobs.find((other) => other.id === jobId)!;
    member.railStagingBatch = j.id;
    if (member.id !== j.id) {
      member.stack = stack.id;
      stack.reserved++;
      member.reason = `Reserved in ${j.id}'s ${batch.qty}-panel staging load`;
    }
  }
}

/** Caller releases the leader's original reservation separately. */
export function releaseUnliftedRailBatch(s: State, j: Job): void {
  const batch = j.railWork?.stagingBatch;
  if (!batch || j.railWork?.panel.state !== 'stored') return;
  for (const jobId of batch.jobIds) {
    const member = s.jobs.find((other) => other.id === jobId);
    if (!member) continue;
    if (member.id !== j.id && member.railStagingBatch === j.id) {
      const stack = s.stacks.find((t) => t.id === member.stack);
      if (stack && member.status !== 'canceled') stack.reserved = Math.max(0, stack.reserved - 1);
      member.stack = undefined;
      member.reason = '';
      member.retryAt = undefined;
      member.retryRevision = undefined;
    }
    member.railStagingBatch = undefined;
  }
  j.railWork!.stagingBatch = undefined;
}

/** Cancellation before lift only releases a reservation; it cannot remove carried steel. */
export function reconcileRailStagingBatch(s: State, j: Job): number {
  const r = j.railWork!,
    batch = r.stagingBatch;
  if (!batch) return 1;
  if (r.panel.state === 'stored') {
    for (const id of batch.jobIds) {
      const other = s.jobs.find((member) => member.id === id);
      if (other && other.id !== j.id && (other.status === 'canceled' || other.cancel))
        other.railStagingBatch = undefined;
    }
    batch.jobIds = batch.jobIds.filter(
      (id) =>
        id === j.id ||
        s.jobs.some((other) => other.id === id && other.status !== 'canceled' && !other.cancel),
    );
    batch.qty = batch.jobIds.length;
    const stack = s.stacks.find((t) => t.id === r.source?.stackId);
    if (stack)
      r.panel.y = r.source!.pose.y =
        (s.paving[`${Math.floor(stack.x + stack.w / 2)},${Math.floor(stack.z + stack.d / 2)}`]
          ? 0.105
          : 0) +
        (stack.baseHeight || 0) +
        Math.max(0, stack.qty - batch.qty) * 0.36;
  }
  return batch.qty;
}

export function handOffRailStagingBatch(s: State, j: Job, stack: Stack): void {
  const batch = j.railWork?.stagingBatch;
  if (!batch) return;
  for (const id of batch.jobIds) {
    const member = s.jobs.find((other) => other.id === id);
    if (!member) continue;
    member.railStagingBatch = undefined;
    if (member.status !== 'canceled' && !member.cancel) {
      member.legacyRailHandoff = 'staged';
      member.stack = stack.id;
      member.reason = `Panel in shared staging stack ${stack.id}; waiting for the installation crew`;
      member.retryAt = undefined;
      member.retryRevision = undefined;
    }
  }
}
