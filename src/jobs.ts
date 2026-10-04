import type { Equipment, Item, Job, JobGroup, Rect, State } from './types';
import { EQUIPMENT, MATERIALS, label } from './catalog';

export interface Assignment {
  equipmentId?: string;
  sourceId?: string;
  priority?: number;
  inherited: boolean;
  text: string;
}
export interface WorkRow {
  id: string;
  parentId?: string;
  depth: number;
  label: string;
  group: boolean;
  status: Job['status'];
  progress: number;
  reason: string;
  worker?: string;
  operator?: string;
  equipment?: string;
  preferredEquipment?: string;
  assignmentSource?: string;
  leafIds: string[];
  created: number;
  finished?: number;
}
const unfinished = (j: Job) => j.status !== 'done' && j.status !== 'canceled';
export function createJobGroup(s: State, title: string, r: Rect, parentId?: string): JobGroup {
  const group: JobGroup = {
    ...r,
    id: `WORK-${String(s.next++).padStart(4, '0')}`,
    label: title,
    parentId,
    created: s.time,
  };
  (s.jobGroups ??= []).push(group);
  return group;
}
export function workLeaves(s: State, workId: string): Job[] {
  const direct = s.jobs.find((j) => j.id === workId);
  if (direct) return [direct];
  const ids = new Set([workId]);
  // Saves validate acyclic parent links. The bounded set also makes this safe for unsaved callers.
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of s.jobGroups || [])
      if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
        ids.add(g.id);
        changed = true;
      }
  }
  return s.jobs.filter((j) => !!j.parentId && ids.has(j.parentId));
}
export function equipmentAssignment(s: State, workId: string): Assignment {
  return resolveEquipmentAssignment(
    s,
    s.jobs.find((j) => j.id === workId) || s.jobGroups?.find((g) => g.id === workId),
    workId,
  );
}
/** Scheduler already has the job object; avoid searching its entire job list again. */
export function jobEquipmentAssignment(s: State, job: Job): Assignment {
  return resolveEquipmentAssignment(s, job, job.id);
}
function resolveEquipmentAssignment(
  s: State,
  work: Job | JobGroup | undefined,
  workId: string,
): Assignment {
  const visited = new Set<string>();
  while (work && !visited.has(work.id)) {
    visited.add(work.id);
    if (work.preferredEquipment) {
      const e = s.equipment.find((e) => e.id === work!.preferredEquipment);
      const inherited = work.id !== workId;
      const busy = e?.job || e?.deliveryOrder || e?.transportOrder || e?.refueling;
      return {
        equipmentId: work.preferredEquipment,
        sourceId: work.id,
        priority: work.equipmentPriority || 0,
        inherited,
        text: `${inherited ? 'Inherited' : 'Assigned'} ${work.preferredEquipment}${busy ? ` · finishing ${busy}` : ''}`,
      };
    }
    work = work.parentId ? s.jobGroups?.find((g) => g.id === work!.parentId) : undefined;
  }
  return { inherited: false, text: 'Automatic equipment selection' };
}
export function equipmentHasAssignedWork(s: State, e: Equipment): boolean {
  // Automatic yards normally have no explicit assignment to this machine.
  // This exact, uncached scan avoids resolving every job's ancestor chain and
  // remains correct after any mutation, including cancellation and imported saves.
  if (
    !s.jobs.some((j) => j.preferredEquipment === e.id) &&
    !s.jobGroups?.some((g) => g.preferredEquipment === e.id)
  )
    return false;
  return s.jobs.some(
    (j) =>
      unfinished(j) &&
      !j.handling?.equipmentReleased &&
      jobEquipmentAssignment(s, j).equipmentId === e.id,
  );
}
export function equipmentReservedForJob(s: State, e: Equipment, j: Job): boolean {
  const required = jobEquipmentAssignment(s, j).equipmentId;
  return required ? required === e.id : !equipmentHasAssignedWork(s, e);
}
export function equipmentCanDoJob(e: Equipment, j: Job, s?: State): boolean {
  if (j.kind === 'refuel') return e.id === j.target;
  // A freshly queued recovery resolves its item at scheduling time. Manual
  // assignment must inspect that same existing asset before promising a lift.
  const item =
    j.item ||
    (j.kind === 'remove' && s
      ? j.target?.startsWith('pave:')
        ? 'slab'
        : s.rails.some((r) => r.id === j.target)
          ? 'rail'
          : (s.buildings.find((b) => b.id === j.target)?.kind as Item | undefined)
      : undefined);
  return (
    (j.kind !== 'rail' || e.kind === 'excavator') &&
    !(j.kind === 'remove' && s && !item) &&
    EQUIPMENT[e.kind].capacity >= (MATERIALS[item!]?.mass || 1)
  );
}
export function setJobEquipment(s: State, workId: string, equipmentId?: string): string {
  const work = s.jobs.find((j) => j.id === workId) || s.jobGroups?.find((g) => g.id === workId);
  if (!work) return 'Work order no longer exists.';
  const leaves = workLeaves(s, workId).filter(unfinished);
  if (!leaves.length) return 'This work order has already finished.';
  if (equipmentId) {
    const e = s.equipment.find((e) => e.id === equipmentId);
    if (!e) return 'Equipment no longer exists.';
    const old = work.preferredEquipment;
    work.preferredEquipment = equipmentId;
    const impossible = leaves.find(
      (j) => equipmentAssignment(s, j.id).sourceId === workId && !equipmentCanDoJob(e, j, s),
    );
    work.preferredEquipment = old;
    if (impossible)
      return `${equipmentId} cannot perform ${label(impossible.kind)}; rail laying requires an excavator and other loads must fit its lift capacity.`;
  }
  work.preferredEquipment = equipmentId;
  work.equipmentPriority = equipmentId ? s.next : undefined;
  for (const j of leaves) {
    j.retryAt = undefined;
    j.retryRevision = undefined;
  }
  s.events.push({
    id: `EV-${String(s.next++).padStart(4, '0')}`,
    time: s.time,
    type: 'Assignment',
    entity: workId,
    text: equipmentId
      ? `Assigned ${equipmentId}. Current physical work finishes safely before handover; this assignment overrides its automatic role.`
      : 'Cleared equipment assignment; parent assignment or automatic selection applies.',
  });
  s.revision++;
  // A pending delivery retries when its selected machine is released. Never interrupt cargo in flight.
  for (const o of s.orders) if (o.status === 'unloading' && !o.unload) o.retryAt = undefined;
  return '';
}
export function jobRows(s: State): WorkRow[] {
  const rows: WorkRow[] = [];
  const groups = s.jobGroups || [];
  const addJob = (j: Job, depth: number) => {
    const a = equipmentAssignment(s, j.id);
    rows.push({
      id: j.id,
      parentId: j.parentId,
      depth,
      group: false,
      label: label(j.kind),
      status: j.status,
      progress: j.progress,
      reason: j.reason || j.phase,
      worker: j.worker,
      operator: j.operator,
      equipment: j.equipment,
      preferredEquipment: a.equipmentId,
      assignmentSource: a.sourceId,
      leafIds: [j.id],
      created: j.created,
      finished: j.finished,
    });
  };
  const addGroup = (g: JobGroup, depth: number) => {
    const leaves = workLeaves(s, g.id),
      active = leaves.filter(unfinished),
      a = equipmentAssignment(s, g.id);
    const status: Job['status'] = active.some((j) => j.status === 'doing')
      ? 'doing'
      : active.length
        ? 'todo'
        : leaves.length && leaves.every((j) => j.status === 'canceled')
          ? 'canceled'
          : 'done';
    const workers = [...new Set(active.flatMap((j) => (j.worker ? [j.worker] : [])))];
    const operators = [...new Set(active.flatMap((j) => (j.operator ? [j.operator] : [])))];
    const equipment = [...new Set(active.flatMap((j) => (j.equipment ? [j.equipment] : [])))];
    const doing = active.filter((j) => j.status === 'doing');
    const current =
      doing.find((j) => j.reason) || doing[0] || active.find((j) => j.reason) || active[0];
    const activity = current?.reason || current?.phase;
    rows.push({
      id: g.id,
      parentId: g.parentId,
      depth,
      group: true,
      label: g.label,
      status,
      progress: leaves.length
        ? leaves.reduce(
            (n, j) => n + (j.status === 'done' || j.status === 'canceled' ? 1 : j.progress),
            0,
          ) / leaves.length
        : 1,
      reason: `${leaves.filter((j) => j.status === 'done').length}/${leaves.length} complete${activity ? ' · ' + activity : ''}`,
      worker: workers.length === 1 ? workers[0] : undefined,
      operator: operators.length === 1 ? operators[0] : undefined,
      equipment: equipment.length === 1 ? equipment[0] : undefined,
      preferredEquipment: a.equipmentId,
      assignmentSource: a.sourceId,
      leafIds: leaves.map((j) => j.id),
      created: g.created,
      finished: active.length
        ? undefined
        : Math.max(g.created, ...leaves.map((j) => j.finished || g.created)),
    });
    for (const child of groups.filter((c) => c.parentId === g.id)) addGroup(child, depth + 1);
    for (const j of s.jobs.filter((j) => j.parentId === g.id)) addJob(j, depth + 1);
  };
  for (const g of groups.filter((g) => !g.parentId)) addGroup(g, 0);
  for (const j of s.jobs.filter((j) => !j.parentId)) addJob(j, 0);
  return rows;
}

/** Sort siblings while keeping each work order and all descendants together. */
export function sortWorkRows<
  T extends { id: string; parentId?: string; status?: Job['status']; created?: number },
>(rows: T[], compare?: (a: T, b: T) => number): T[] {
  const rank = { doing: 0, todo: 1, done: 2, canceled: 3 };
  const comparator =
    compare ||
    ((a: T, b: T) =>
      rank[a.status || 'todo'] - rank[b.status || 'todo'] || (b.created || 0) - (a.created || 0));
  const ids = new Set(rows.map((r) => r.id));
  const siblings = new Map<string, T[]>();
  for (const row of rows) {
    const parent = row.parentId && ids.has(row.parentId) ? row.parentId : '';
    const list = siblings.get(parent) || [];
    list.push(row);
    siblings.set(parent, list);
  }
  const out: T[] = [],
    visited = new Set<string>();
  const visit = (parent: string) => {
    for (const row of [...(siblings.get(parent) || [])].sort(comparator)) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      out.push(row);
      visit(row.id);
    }
  };
  visit('');
  // Malformed caller-provided cycles cannot cause recursion or silently discard rows.
  for (const row of rows)
    if (!visited.has(row.id)) {
      visited.add(row.id);
      out.push(row);
      visit(row.id);
    }
  return out;
}
