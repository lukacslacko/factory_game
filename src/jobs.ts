import type { Equipment, Item, Job, JobGroup, Rect, State } from './types';
import { EQUIPMENT, MATERIALS, label } from './catalog';
import { equipmentAllows, jobActivity } from './equipment-roles';
import { railBatchHeld, stagedRailStackOwnedBy, releaseUnliftedRailBatch } from './rail-staging';

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
/** Ownership applies to the outer work order, including foundation subgroups. */
export function automaticWorkGroup(s: State, work: Job | JobGroup): JobGroup | undefined {
  if ('kind' in work && work.kind === 'throwSwitch') return undefined;
  let group = s.jobGroups?.find((g) => g.id === ('kind' in work ? work.parentId : work.id));
  const seen = new Set<string>();
  while (group?.parentId && !seen.has(group.id)) {
    seen.add(group.id);
    group = s.jobGroups?.find((g) => g.id === group!.parentId) || group;
  }
  return group;
}
export function automaticEquipmentForWork(s: State, work: Job | JobGroup): string | undefined {
  return automaticWorkGroup(s, work)?.automaticEquipment;
}
/** Reconcile saved/legacy ownership without interrupting a loaded or working machine. */
export function refreshAutomaticEquipment(s: State, operatorAvailable: (e: Equipment) => boolean) {
  const groups = new Map<string, { group: JobGroup; jobs: Job[] }>();
  for (const j of s.jobs) {
    if (j.kind === 'refuel' || j.kind === 'throwSwitch') continue;
    const group = automaticWorkGroup(s, j);
    if (!group) continue;
    let entry = groups.get(group.id);
    if (!entry) groups.set(group.id, (entry = { group, jobs: [] }));
    if (unfinished(j)) entry.jobs.push(j);
  }
  for (const { group, jobs } of groups.values()) {
    if (group.railCrew) {
      group.automaticEquipment = undefined;
      continue;
    }
    if (!jobs.length) {
      group.automaticEquipment = undefined;
      continue;
    }
    const active = jobs.filter(
      (j) => j.status === 'doing' && j.equipment && !j.handling?.equipmentReleased,
    );
    if (active.length) {
      // An older save can have several machines already in flight. Drain their
      // real work, then continue with one; never abandon a carried load.
      if (!active.some((j) => j.equipment === group.automaticEquipment))
        group.automaticEquipment = active[0].equipment;
      continue;
    }
    const e = s.equipment.find((e) => e.id === group.automaticEquipment);
    const machineTasks = jobs.filter(
      (j) => !j.handling?.equipmentReleased && !jobEquipmentAssignment(s, j).equipmentId,
    );
    if (
      e &&
      !equipmentHasAssignedWork(s, e) &&
      e.fuel > 0.2 &&
      operatorAvailable(e) &&
      (machineTasks.length === 0 ||
        machineTasks.some((j) => equipmentAllows(e, jobActivity(j)) && equipmentCanDoJob(e, j, s)))
    )
      continue;
    group.automaticEquipment = undefined;
  }
}
export function automaticEquipmentAllowsJob(s: State, e: Equipment, j: Job): boolean {
  const group = automaticWorkGroup(s, j);
  if (!group) return true;
  if (group.railCrew && ['rail', 'remove'].includes(j.kind))
    return jobEquipmentAssignment(s, j).equipmentId === e.id;
  if (group.automaticEquipment && group.automaticEquipment !== e.id) return false;
  return !s.jobs.some(
    (other) =>
      other.id !== j.id &&
      other.kind !== 'refuel' &&
      other.status === 'doing' &&
      other.equipment &&
      other.equipment !== e.id &&
      !other.handling?.equipmentReleased &&
      automaticWorkGroup(s, other)?.id === group.id,
  );
}
export function claimAutomaticEquipment(s: State, j: Job, e: Equipment) {
  if (jobEquipmentAssignment(s, j).equipmentId) return;
  const group = automaticWorkGroup(s, j);
  if (group) group.automaticEquipment = e.id;
}
export function automaticEquipmentHasWork(s: State, e: Equipment): boolean {
  return (
    s.jobGroups?.some(
      (g) =>
        g.automaticEquipment === e.id &&
        workLeaves(s, g.id).some(
          (j) => unfinished(j) && j.kind !== 'throwSwitch' && !j.handling?.equipmentReleased,
        ),
    ) || false
  );
}
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
  if (job.kind === 'throwSwitch')
    return { inherited: false, text: 'Worker on foot · no equipment required' };
  return resolveEquipmentAssignment(s, job, job.id);
}
function resolveEquipmentAssignment(
  s: State,
  work: Job | JobGroup | undefined,
  workId: string,
): Assignment {
  if (work && 'kind' in work && work.preferredEquipment) {
    const equipmentId = work.preferredEquipment;
    const e = s.equipment.find((e) => e.id === equipmentId);
    const busy = e?.job || e?.deliveryOrder || e?.transportOrder || e?.refueling;
    return {
      equipmentId: work.preferredEquipment,
      sourceId: work.id,
      inherited: false,
      priority: work.equipmentPriority || 0,
      text: `Assigned ${work.preferredEquipment}${busy ? ` · finishing ${busy}` : ''}`,
    };
  }
  if (work && 'kind' in work && ['rail', 'remove'].includes(work.kind)) {
    const group = railCrewGroup(s, work);
    const crew = group?.railCrew;
    if (crew?.stagingEquipment && crew.installingEquipment) {
      const workParent = work.parentId;
      let closer = s.jobGroups?.find((g) => g.id === workParent);
      const seen = new Set<string>();
      while (closer && closer.id !== group!.id && !seen.has(closer.id)) {
        if (closer.preferredEquipment)
          return {
            equipmentId: closer.preferredEquipment,
            sourceId: closer.id,
            inherited: true,
            priority: closer.equipmentPriority || 0,
            text: `Inherited ${closer.preferredEquipment}`,
          };
        seen.add(closer.id);
        closer = s.jobGroups?.find((g) => g.id === closer!.parentId);
      }
      const staging = work.kind === 'rail' && railNeedsStaging(work);
      const equipmentId = staging ? crew.stagingEquipment : crew.installingEquipment;
      return {
        equipmentId,
        sourceId: group!.id,
        inherited: true,
        priority: group!.equipmentPriority || 0,
        text: `${staging ? 'Staging' : 'Installation'} crew · ${equipmentId}`,
      };
    }
  }
  const visited = new Set<string>();
  while (work && !visited.has(work.id)) {
    if ('kind' in work && work.kind === 'throwSwitch')
      return { inherited: false, text: 'Worker on foot · no equipment required' };
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
    !s.jobGroups?.some(
      (g) =>
        g.preferredEquipment === e.id ||
        g.railCrew?.stagingEquipment === e.id ||
        g.railCrew?.installingEquipment === e.id,
    )
  )
    return false;
  if (
    s.jobGroups?.some(
      (g) =>
        (g.railCrew?.stagingEquipment === e.id || g.railCrew?.installingEquipment === e.id) &&
        workLeaves(s, g.id).some(unfinished),
    )
  )
    return true;
  return s.jobs.some(
    (j) =>
      unfinished(j) &&
      j.kind !== 'throwSwitch' &&
      !j.handling?.equipmentReleased &&
      jobEquipmentAssignment(s, j).equipmentId === e.id,
  );
}
export function equipmentReservedForJob(s: State, e: Equipment, j: Job): boolean {
  const required = jobEquipmentAssignment(s, j).equipmentId;
  return required ? required === e.id : !equipmentHasAssignedWork(s, e);
}
export function equipmentCanDoJob(e: Equipment, j: Job, s?: State): boolean {
  if (j.kind === 'throwSwitch') return false;
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
    (!j.railRecovery || e.kind === 'excavator') &&
    (!['rail', 'shed', 'engineShed'].includes(j.kind) ||
      (j.kind === 'rail' && j.railStageOnly) ||
      e.kind === 'excavator') &&
    !(j.kind === 'remove' && s && !item) &&
    EQUIPMENT[e.kind].capacity >= (MATERIALS[item!]?.mass || 1)
  );
}
function assignmentGroupIds(s: State, groupId: string): Set<string> {
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of s.jobGroups || [])
      if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
        ids.add(g.id);
        changed = true;
      }
  }
  return ids;
}

/** Apply manual choices at a real unloaded boundary, never by deleting a load. */
export function reconcileEquipmentAssignments(s: State): void {
  for (const j of s.jobs) {
    if (
      j.status !== 'doing' ||
      !j.equipment ||
      ['refuel', 'throwSwitch'].includes(j.kind) ||
      j.cancel
    )
      continue;
    const desired = jobEquipmentAssignment(s, j).equipmentId;
    if (!desired || desired === j.equipment) continue;
    const e = s.equipment.find((q) => q.id === j.equipment);
    if (!e || j.handling?.equipmentReleased) continue;
    const r = j.railWork;
    if (
      j.kind === 'rail' &&
      railCrewGroup(s, j) &&
      r &&
      ['source-lift', 'source-clear', 'stage-travel', 'stage-align', 'stage-lower'].includes(
        r.phase,
      ) &&
      (!r.buffer || r.buffer.secured)
    ) {
      // An old automatic crane already owns this lifted panel. Let it finish
      // the real staging pass; the newly selected installer gets the supported panel.
      j.railStageOnly = true;
    }
    const railUnloaded =
      !r ||
      ((r.panel.state === 'stored' ||
        (j.railRecovery &&
          r.panel.state === 'installed' &&
          !j.railRecovery.unbolted &&
          !j.railRecovery.lifted)) &&
        ['source-approach', 'source-rig'].includes(r.phase) &&
        (r.phase !== 'source-rig' || r.clock === 0) &&
        (!r.buffer || r.buffer.secured));
    const constructionUnloaded =
      !j.handling ||
      (j.handling.state === 'stored' &&
        ['approach', 'rig'].includes(j.handling.phase) &&
        (j.handling.phase !== 'rig' || j.handling.clock === 0));
    const safe =
      !e.cargo &&
      !e.assemblyLoad &&
      !e.refueling &&
      !j.delivered &&
      railUnloaded &&
      constructionUnloaded &&
      !j.shedAssembly &&
      !j.processAssembly &&
      !j.recoveryStack;
    if (!safe) {
      j.reason = `Manual ${desired} will take over after ${e.id} safely finishes this physical pass`;
      continue;
    }
    releaseUnliftedRailBatch(s, j);
    const stack = s.stacks.find((q) => q.id === j.stack);
    const ownedStaged = !!stack && stagedRailStackOwnedBy(s, stack, j);
    if (stack && !ownedStaged) stack.reserved = Math.max(0, stack.reserved - j.qty);
    for (const w of s.workers.filter((q) => q.job === j.id)) {
      w.job = undefined;
      if (!w.transition && !w.yieldingTo) w.path = [];
      w.status = w.vehicle ? 'Available in cab' : 'Available';
    }
    if (e.job === j.id) e.job = undefined;
    e.path = [];
    e.work = 0;
    e.trafficGoal = undefined;
    e.trafficYieldEquipment = undefined;
    e.trafficReverse = undefined;
    e.blockedBy = undefined;
    e.trafficWait = 0;
    j.worker = undefined;
    j.operator = undefined;
    j.equipment = undefined;
    if (!ownedStaged) j.stack = undefined;
    j.railWork = undefined;
    j.handling = undefined;
    j.railStageOnly = undefined;
    j.status = 'todo';
    j.phase = 'Waiting';
    j.elapsed = 0;
    j.reason = `Manual assignment superseded ${e.id}; waiting for ${desired}`;
    j.retryAt = undefined;
    j.retryRevision = undefined;
    const group = automaticWorkGroup(s, j);
    if (group?.automaticEquipment === e.id) group.automaticEquipment = undefined;
    s.events.push({
      id: `EV-${String(s.next++).padStart(4, '0')}`,
      time: s.time,
      type: 'Assignment',
      entity: j.id,
      text: `Released unloaded ${e.id} before pickup; ${desired} now owns the requested work. Physical stock remains in place.`,
    });
    s.revision++;
  }
}

export function setJobEquipment(s: State, workId: string, equipmentId?: string): string {
  const work = s.jobs.find((j) => j.id === workId) || s.jobGroups?.find((g) => g.id === workId);
  if (!work) return 'Work order no longer exists.';
  if ('kind' in work && work.kind === 'throwSwitch')
    return equipmentId ? 'The manual turnout lever needs a worker on foot, not equipment.' : '';
  const leaves = workLeaves(s, workId).filter(unfinished);
  if (!leaves.length) return 'This work order has already finished.';
  if (equipmentId) {
    const e = s.equipment.find((e) => e.id === equipmentId);
    if (!e) return 'Equipment no longer exists.';
    const impossible = leaves.find((j) => !equipmentCanDoJob(e, { ...j, railStageOnly: false }, s));
    if (impossible)
      return `${equipmentId} cannot perform ${label(impossible.kind)}; ${['shed', 'engineShed'].includes(impossible.kind) ? 'shed erection requires an excavator' : impossible.kind === 'rail' ? 'rail laying requires an excavator' : 'the load must fit its lift capacity'}.`;
  }
  work.preferredEquipment = equipmentId;
  if (!('kind' in work) && equipmentId) {
    // A new group Apply explicitly replaces older group and child choices.
    for (const group of s.jobGroups || [])
      if (assignmentGroupIds(s, workId).has(group.id)) {
        group.railCrew = undefined;
        if (group.id !== workId) group.preferredEquipment = undefined;
      }
    for (const j of leaves) {
      j.preferredEquipment = undefined;
      j.equipmentPriority = undefined;
    }
  }
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
  reconcileEquipmentAssignments(s);
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
      label: j.track
        ? `${label(j.item || 'rail')} · ${j.track.layout === 'turnout' ? 'station ' : 'panel '}${j.track.section + 1}${j.track.route ? ' · ' + j.track.route : ''}`
        : label(j.kind),
      status: j.status,
      progress: j.progress,
      reason: j.reason || j.phase,
      worker: j.worker,
      operator: j.operator,
      equipment: j.equipment || (unfinished(j) ? automaticEquipmentForWork(s, j) : undefined),
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
      equipment:
        equipment.length === 1
          ? equipment[0]
          : !equipment.length && active.length
            ? automaticEquipmentForWork(s, g)
            : undefined,
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

export function railCrewGroup(s: State, j: Job): JobGroup | undefined {
  let group = s.jobGroups?.find((g) => g.id === (j.parentId || j.track?.groupId));
  const seen = new Set<string>();
  while (group && !seen.has(group.id)) {
    if (group.railCrew) return group;
    seen.add(group.id);
    group = s.jobGroups?.find((g) => g.id === group!.parentId);
  }
  return undefined;
}
export function railNeedsStaging(j: Job): boolean {
  return !j.delivered && j.legacyRailHandoff !== 'staged' && j.legacyRailHandoff !== 'installed';
}
/** One real panel record passes through two machines; no duplicate material demand. */
export function railStagingAllowed(s: State, j: Job): boolean {
  const group = railCrewGroup(s, j);
  if (!group || !railNeedsStaging(j) || railBatchHeld(s, j)) return false;
  const jobs = workLeaves(s, group.id).filter((k) => k.kind === 'rail' && unfinished(k));
  // A real staging batch owns held siblings. Further batches may prepare while
  // the installer uses existing stock, but one staging machine works at a time.
  return (
    !jobs.some((k) => k.id !== j.id && k.railStageOnly && k.status === 'doing') &&
    jobs.find((k) => railNeedsStaging(k))?.id === j.id
  );
}
export function setRailCrew(
  s: State,
  groupId: string,
  stagingEquipment?: string,
  installingEquipment?: string,
): string {
  const group = s.jobGroups?.find((g) => g.id === groupId);
  if (!group || !workLeaves(s, groupId).some((j) => j.kind === 'rail'))
    return 'Select a rail construction work order.';
  const jobs = workLeaves(s, groupId).filter(unfinished);
  if (!jobs.length) return 'This work order has already finished.';
  if (!!stagingEquipment !== !!installingEquipment)
    return 'Choose both a staging machine and an installation excavator, or leave both blank.';
  if (stagingEquipment && stagingEquipment === installingEquipment)
    return 'Choose two different machines; single-machine work uses the normal assignment.';
  if (stagingEquipment && installingEquipment) {
    const staging = s.equipment.find((e) => e.id === stagingEquipment),
      installing = s.equipment.find((e) => e.id === installingEquipment);
    if (!staging || !installing) return 'Equipment no longer exists.';
    if (installing.kind !== 'excavator')
      return 'Installation and buffer handling require an excavator.';
    if (jobs.some((j) => EQUIPMENT[staging.kind].capacity < (MATERIALS[j.item!]?.mass || 1)))
      return 'The staging machine cannot lift every panel in this work order.';
  }
  group.railCrew = stagingEquipment ? { stagingEquipment, installingEquipment } : undefined;
  if (stagingEquipment) {
    for (const child of s.jobGroups || [])
      if (assignmentGroupIds(s, groupId).has(child.id)) {
        child.preferredEquipment = undefined;
        if (child.id !== groupId) child.railCrew = undefined;
      }
    for (const j of jobs) {
      j.preferredEquipment = undefined;
      j.equipmentPriority = undefined;
    }
  }
  group.automaticEquipment = undefined;
  group.equipmentPriority = stagingEquipment ? s.next : undefined;
  s.events.push({
    id: `EV-${String(s.next++).padStart(4, '0')}`,
    time: s.time,
    type: 'Assignment',
    entity: groupId,
    text: stagingEquipment
      ? `Rail crew: ${stagingEquipment} stages panels; ${installingEquipment} installs. Active physical work finishes safely before reassignment.`
      : 'Rail crew cleared; active work finishes safely before normal assignment resumes.',
  });
  for (const j of jobs) {
    j.retryAt = undefined;
    j.retryRevision = undefined;
  }
  s.revision++;
  reconcileEquipmentAssignments(s);
  return '';
}

/** The staging machine may receive its own missing panels before carrying them to the work. */
export function equipmentCanReceiveRailSupply(s: State, e: Equipment, item: Item): boolean {
  return !!s.jobGroups?.some(
    (g) =>
      g.railCrew?.stagingEquipment === e.id &&
      (() => {
        const need = workLeaves(s, g.id).filter(
          (j) => unfinished(j) && j.kind === 'rail' && j.item === item && railNeedsStaging(j),
        ).length;
        const ready = s.stacks
          .filter((t) => t.item === item)
          .reduce((n, t) => n + t.qty - t.reserved, 0);
        return need > ready;
      })(),
  );
}
