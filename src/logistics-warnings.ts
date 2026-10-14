import type { Job, Notice, State } from './types';

const DEPENDENCY = /^(Waiting for (preceding|the preceding|the staging machine|the connecting track|existing paving|paved foundations)|Reserved in )/i;

/** Persistent work warnings are attached to their job, so changing the
 * explanation updates one notice rather than filling the inbox every tick. */
export function reconcileBlockedWorkWarnings(s: State, nextId: () => string): void {
  const parent = new Map((s.jobGroups || []).map((g) => [g.id, g.parentId]));
  const root = (j: Job) => {
    let id = j.parentId || j.id;
    const seen = new Set<string>();
    while (parent.get(id) && !seen.has(id)) {
      seen.add(id);
      id = parent.get(id)!;
    }
    return id;
  };
  const reported = new Set<string>();
  for (const j of s.jobs) {
    const active = j.status === 'todo' || j.status === 'doing';
    // Rail pickup, electrical trenches, and live action-clearance already
    // own detailed persistent warnings with linked blockers. Do not compete
    // with those records or replace their diagnostic text.
    const externallyTracked = j.kind === 'rail' || j.kind === 'cableRun' ||
      (j.kind === 'moveStock' && !!j.item?.startsWith('rail')) ||
      s.actionClearances?.some((r) => r.ownerId === j.id ||
        (!!j.equipment && r.requesterEquipmentId === j.equipment));
    if (externallyTracked) {
      const prior = s.notices.find((n) => n.id === j.logisticsNoticeId);
      if (prior?.title === 'Work blocked') prior.state = 'done';
      continue;
    }
    if (!j.logisticsNoticeId) {
      const existing = s.notices.find((n) => n.entity === j.id && n.state !== 'done' &&
        (n.severity === 'warning' || /blocked|deadlock/i.test(n.title)));
      if (existing) j.logisticsNoticeId = existing.id;
    }
    let current = j.logisticsNoticeId
      ? s.notices.find((n) => n.id === j.logisticsNoticeId)
      : undefined;
    let reason = active && !j.cancel && !DEPENDENCY.test(j.reason)
      ? j.reason.trim() : '';
    const key = `${root(j)}\u0000${reason}`;
    if (reason && reported.has(key)) reason = '';
    if (reason) reported.add(key);
    if (!reason) {
      if (current && current.state !== 'done') current.state = 'done';
      j.logisticsWaitSince = undefined;
      j.logisticsWaitReason = undefined;
      continue;
    }
    const changed = j.logisticsWaitReason !== reason;
    if (changed) {
      j.logisticsWaitReason = reason;
      j.logisticsWaitSince = s.elapsed;
      if (current?.state === 'done') {
        j.logisticsNoticeId = undefined;
        current = undefined;
      }
      if (current && current.state !== 'done') {
        current.detail = `${j.id}: ${reason}`;
      }
    }
    if (current && current.state !== 'done') continue;
    if (current?.state === 'done') continue;
    if (s.elapsed - (j.logisticsWaitSince ?? s.elapsed) < 20) continue;
    const notice: Notice = {
      id: nextId(), time: s.time, title: 'Work blocked',
      detail: `${j.id}: ${reason}`, entity: j.id,
      state: 'todo', seen: false, severity: 'warning',
    };
    s.notices.unshift(notice);
    j.logisticsNoticeId = notice.id;
  }
}
