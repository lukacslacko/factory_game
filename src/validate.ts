import { validTrackPiece, trackGeometry } from './track';
import { validRailLocation } from './rail-locations';
import { freightValidationProblem } from './freight-validation';
import {
  FREIGHT_CAPACITY,
  FREIGHT_DECK_LENGTH,
  CREW_BUS_SEATS,
  orderDeckLength,
  freightStackLimits,
  orderMass,
} from './procurement';
import type { State } from './types';
import { EQUIPMENT_ROLES, EQUIPMENT_ACTIVITIES } from './equipment-roles';
import { MATERIALS, EQUIPMENT, ROLES, SERVICES } from './catalog';
import { railWorkGroup } from './rail-work-groups';
const fail = (message: string): never => {
  throw new Error(`Invalid save: ${message}.`);
};
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const point = (p: any) =>
  p && finite(p.x) && finite(p.z) && Math.abs(p.x) < 10000 && Math.abs(p.z) < 10000;
const motion = (p: any) =>
  (p.trafficGoal === undefined || point(p.trafficGoal)) &&
  (p.trafficReverse === undefined || typeof p.trafficReverse === 'boolean') &&
  (p.trafficYieldWorker === undefined || typeof p.trafficYieldWorker === 'string') &&
  (p.trafficYieldEquipment === undefined || typeof p.trafficYieldEquipment === 'string') &&
  (p.trafficBlockedNotice === undefined || typeof p.trafficBlockedNotice === 'boolean') &&
  (p.trafficBlockedSince === undefined ||
    (finite(p.trafficBlockedSince) && p.trafficBlockedSince >= 0)) &&
  ['yaw', 'velocity', 'travel', 'y', 'pitch', 'lift', 'reach', 'trafficWait', 'trafficRetry'].every(
    (k) => p[k] === undefined || finite(p[k]),
  );
const path = (p: any) => Array.isArray(p) && p.length < 50000 && p.every(point);
const trackItem = (t: any) =>
  t.layout === 'curve'
    ? 'railCurve'
    : t.layout === 'turnout' && t.route !== 'straight'
      ? ['railPoints', 'railFrog', 'railClosure', 'railExit'][t.section]
      : 'rail';
export function validateState(value: any): asserts value is State {
  const s = value;
  if (!s || ![1, 2, 3, 4].includes(s.version)) fail('unsupported format or version');
  if (
    !finite(s.time) ||
    !finite(s.elapsed) ||
    !Number.isInteger(s.next) ||
    s.next < 1 ||
    !finite(s.wageClock)
  )
    fail('invalid simulation clock');
  if (![1, 3, 10].includes(s.speed) || typeof s.paused !== 'boolean' || typeof s.name !== 'string')
    fail('invalid site settings');
  if (s.creative !== undefined && typeof s.creative !== 'boolean') fail('invalid creative mode');
  const lists = [
    'workers',
    'equipment',
    'stacks',
    'buildings',
    'rails',
    'zones',
    'jobs',
    'orders',
    'events',
    'costs',
    'movements',
    'notices',
  ];
  const ids = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(s[list]) || s[list].length > 150000) fail(`missing or oversized ${list}`);
    for (const e of s[list]) {
      if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id))
        fail(`invalid or repeated ID in ${list}`);
      ids.add(e.id);
    }
  }
  for (const e of s.events)
    if (e.severity !== undefined && !['info', 'warning'].includes(e.severity))
      fail('invalid activity severity');
  if (s.jobGroups !== undefined) {
    if (!Array.isArray(s.jobGroups) || s.jobGroups.length > 150000)
      fail('invalid work-order groups');
    for (const g of s.jobGroups) {
      if (
        !g ||
        typeof g.id !== 'string' ||
        !g.id ||
        ids.has(g.id) ||
        !point(g) ||
        !finite(g.w) ||
        !finite(g.d) ||
        g.w <= 0 ||
        g.d <= 0 ||
        typeof g.label !== 'string' ||
        !finite(g.created)
      )
        fail('invalid work-order group');
      ids.add(g.id);
    }
  }
  const pose = (p: any) => point(p) && finite(p.y) && finite(p.yaw);
  const knownBufferId = (id: any) =>
    typeof id === 'string' &&
    !!id &&
    (s.buffers === undefined
      ? id === 'BUFFER-001'
      : s.buffers.some((b: any) => b.id === id) ||
        s.stacks.some((t: any) => t.item === 'bufferStop' && t.assetId === id) ||
        s.jobs.some(
          (j: any) => j.item === 'bufferStop' && j.assetId === id && j.status === 'doing',
        ));
  const belongsToGroup = (j: any, groupId: string) => {
    let id = j.parentId || j.track?.groupId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      if (id === groupId) return true;
      seen.add(id);
      id = (s.jobGroups || []).find((g: any) => g.id === id)?.parentId;
    }
    return false;
  };
  for (const g of s.jobGroups || []) {
    if (g.railCrew) {
      const c = g.railCrew;
      const staging = s.equipment.find((e: any) => e.id === c.stagingEquipment),
        installing = s.equipment.find((e: any) => e.id === c.installingEquipment);
      if (
        !staging ||
        !installing ||
        staging.id === installing.id ||
        installing.kind !== 'excavator' ||
        !s.jobs.some((j: any) => j.kind === 'rail' && belongsToGroup(j, g.id))
      )
        fail('invalid rail work crew');
    }
    if (g.railBuffer) {
      const b = g.railBuffer;
      if (
        !pose(b.pose) ||
        !knownBufferId(b.pose.id) ||
        typeof b.pose.secured !== 'boolean' ||
        typeof b.pose.carried !== 'boolean' ||
        !pose(b.start) ||
        !pose(b.latestEnd) ||
        (b.ownerJob !== undefined &&
          !s.jobs.some(
            (j: any) => j.id === b.ownerJob && j.kind === 'rail' && belongsToGroup(j, g.id),
          ))
      )
        fail('invalid shared rail buffer');
    }
  }
  const looseBufferIds = (s.jobGroups || [])
    .filter((g: any) => g.railBuffer && !g.railBuffer.pose.secured)
    .map((g: any) => g.railBuffer.pose.id);
  if (new Set(looseBufferIds).size !== looseBufferIds.length) fail('duplicate loose shared buffer');
  if (s.buffers !== undefined) {
    if (!Array.isArray(s.buffers) || s.buffers.length > 10000) fail('invalid buffer register');
    for (const b of s.buffers) {
      if (
        !pose(b) ||
        typeof b.id !== 'string' ||
        !b.id ||
        ids.has(b.id) ||
        typeof b.secured !== 'boolean' ||
        typeof b.carried !== 'boolean' ||
        (b.source !== undefined && typeof b.source !== 'string')
      )
        fail('invalid installed buffer stop');
      ids.add(b.id);
    }
  }
  for (const j of s.jobs) {
    if (
      j.bufferTarget !== undefined &&
      (j.kind !== 'bufferStop' || !point(j.bufferTarget) || !finite(j.bufferTarget.yaw))
    )
      fail('invalid buffer target');
    if (
      j.bufferDestination !== undefined &&
      (j.kind !== 'remove' ||
        j.item !== 'bufferStop' ||
        !point(j.bufferDestination) ||
        j.bufferDestination.w !== 2 ||
        j.bufferDestination.d !== 2)
    )
      fail('invalid buffer storage destination');
  }
  for (const j of s.jobs)
    if (
      j.railStageOnly !== undefined &&
      (typeof j.railStageOnly !== 'boolean' ||
        (!j.railRecovery && !['rail', 'moveStock'].includes(j.kind)))
    )
      fail('invalid rail staging pass');
  for (const j of s.jobs)
    if (j.railStagingBatch !== undefined) {
      const leader = s.jobs.find((q: any) => q.id === j.railStagingBatch);
      if (
        j.kind !== 'rail' ||
        typeof j.railStagingBatch !== 'string' ||
        !leader ||
        leader.status !== 'doing' ||
        !leader.railWork?.stagingBatch?.jobIds.includes(j.id)
      )
        fail('invalid reserved rail staging batch');
    }
  for (const j of s.jobs)
    if (
      j.railBufferCleanup !== undefined &&
      (typeof j.railBufferCleanup !== 'boolean' || j.kind !== 'rail' || !j.delivered || !j.railWork)
    )
      fail('invalid buffer cleanup task');
  const groups = new Map<string, any>((s.jobGroups || []).map((g: any) => [g.id, g]));
  for (const work of [...(s.jobGroups || []), ...s.jobs]) {
    if (
      work.automaticEquipment !== undefined &&
      (typeof work.automaticEquipment !== 'string' ||
        !s.equipment.some((e: any) => e.id === work.automaticEquipment))
    )
      fail('invalid automatic work-order equipment');
    if (
      work.equipmentPriority !== undefined &&
      (!Number.isInteger(work.equipmentPriority) || work.equipmentPriority < 0)
    )
      fail('invalid work-order assignment priority');
    if (
      work.preferredEquipment !== undefined &&
      (typeof work.preferredEquipment !== 'string' ||
        !s.equipment.some((e: any) => e.id === work.preferredEquipment))
    )
      fail('invalid work-order equipment assignment');
    if (
      work.parentId !== undefined &&
      (typeof work.parentId !== 'string' || !groups.has(work.parentId))
    )
      fail('invalid work-order parent');
    const seen = new Set<string>([work.id]);
    let parent = work.parentId;
    while (parent) {
      if (seen.has(parent)) fail('cyclic work-order hierarchy');
      seen.add(parent);
      parent = groups.get(parent)?.parentId;
    }
  }
  if (
    !point(s.buffer) ||
    !s.utilities ||
    typeof s.utilities.power !== 'boolean' ||
    typeof s.utilities.water !== 'boolean'
  )
    fail('invalid infrastructure');
  if (!s.paving || typeof s.paving !== 'object' || Array.isArray(s.paving)) fail('invalid paving');
  for (const [k, v] of Object.entries(s.paving))
    if (!/^-?\d+,-?\d+$/.test(k) || typeof v !== 'string') fail('invalid paving cell');
  if (s.groundWear !== undefined) {
    if (
      !s.groundWear ||
      typeof s.groundWear !== 'object' ||
      Array.isArray(s.groundWear) ||
      Object.keys(s.groundWear).length > 12000
    )
      fail('invalid ground wear');
    for (const [key, amount] of Object.entries(s.groundWear)) {
      const coords = key.split(',').map(Number);
      if (
        !/^-?\d+,-?\d+$/.test(key) ||
        coords.some((v) => Math.abs(v) >= 10000) ||
        !finite(amount) ||
        (amount as number) < 0 ||
        (amount as number) > 1
      )
        fail('invalid ground wear cell');
    }
  }
  const helpers = new Set<string>();
  for (const w of s.workers) {
    if (
      !point(w) ||
      !motion(w) ||
      !path(w.path) ||
      !(w.role in ROLES) ||
      !['auto', 'manual', 'rest'].includes(w.duty) ||
      typeof w.status !== 'string' ||
      typeof w.name !== 'string' ||
      !finite(w.hours) ||
      !finite(w.wage) ||
      !finite(w.heading)
    )
      fail('invalid worker');
    if (
      w.schedule &&
      (!finite(w.schedule.start) ||
        !finite(w.schedule.end) ||
        w.schedule.start < 0 ||
        w.schedule.start >= 24 ||
        w.schedule.end < 0 ||
        w.schedule.end >= 24 ||
        w.schedule.start === w.schedule.end)
    )
      fail('invalid worker schedule');
    if (
      w.shiftPhase !== undefined &&
      ![
        'working',
        'finishing',
        'parking',
        'walking-to-bus',
        'aboard',
        'home',
        'returning',
      ].includes(w.shiftPhase)
    )
      fail('invalid shift phase');
    if (
      w.commuteOrder &&
      !s.orders.some((o: any) => o.id === w.commuteOrder && o.commute?.workers?.includes(w.id))
    )
      fail('missing worker commute bus');
    if (w.parkingEquipment && !s.equipment.some((e: any) => e.id === w.parkingEquipment))
      fail('missing parking equipment');
    if (w.assistingEquipment !== undefined) {
      if (
        typeof w.assistingEquipment !== 'string' ||
        w.role === 'operator' ||
        !s.equipment.some((e: any) => e.id === w.assistingEquipment) ||
        helpers.has(w.assistingEquipment)
      )
        fail('invalid dedicated support worker assignment');
      helpers.add(w.assistingEquipment);
    }
    if (w.yieldTarget && !point(w.yieldTarget)) fail('invalid pedestrian yield destination');
  }
  for (const e of s.equipment) {
    if (
      e.parking &&
      (!point(e.parking) ||
        !Number.isInteger(e.parking.x) ||
        !Number.isInteger(e.parking.z) ||
        !Number.isInteger(e.parking.rotation) ||
        e.parking.rotation < 0 ||
        e.parking.rotation > 3)
    )
      fail('invalid parking location');
    if (
      e.parkingState !== undefined &&
      !['waiting-operator', 'boarding', 'driving', 'aligning', 'parked'].includes(e.parkingState)
    )
      fail('invalid parking phase');
    if (
      e.parkingOperator &&
      !s.workers.some((w: any) => w.id === e.parkingOperator && w.role === 'operator')
    )
      fail('missing parking operator');
    if (
      e.workRole !== undefined &&
      (typeof e.workRole !== 'string' || !Object.hasOwn(EQUIPMENT_ROLES, e.workRole))
    )
      fail('invalid equipment work role');
    if (
      e.allowedWork !== undefined &&
      (!Array.isArray(e.allowedWork) ||
        e.allowedWork.length > 5 ||
        new Set(e.allowedWork).size !== e.allowedWork.length ||
        !e.allowedWork.every(
          (activity: unknown) =>
            typeof activity === 'string' && Object.hasOwn(EQUIPMENT_ACTIVITIES, activity),
        ))
    )
      fail('invalid equipment automatic activities');
    if (
      !point(e) ||
      !motion(e) ||
      !path(e.path) ||
      !(e.kind in EQUIPMENT) ||
      !finite(e.fuel) ||
      !finite(e.tank) ||
      !finite(e.used) ||
      !finite(e.heading) ||
      !finite(e.work) ||
      e.fuel < 0 ||
      e.fuel > e.tank ||
      e.tank <= 0
    )
      fail('invalid equipment');
    if (
      e.assemblyLoad &&
      !s.jobs.some(
        (j: any) =>
          j.id === e.assemblyLoad.job &&
          j.status === 'doing' &&
          j.equipment === e.id &&
          j.shedAssembly,
      )
    )
      fail('orphaned shed component load');
    if (
      e.cargo &&
      (!(e.cargo.item in MATERIALS) ||
        !Number.isInteger(e.cargo.qty) ||
        e.cargo.qty < 1 ||
        (e.cargo.yaw !== undefined && !finite(e.cargo.yaw)))
    )
      fail('invalid equipment cargo');
  }
  for (const t of s.stacks) {
    if (
      t.railStagingJobs !== undefined &&
      (!t.item?.startsWith('rail') ||
        !Array.isArray(t.railStagingJobs) ||
        t.railStagingJobs.length > MATERIALS[t.item as keyof typeof MATERIALS].max ||
        new Set(t.railStagingJobs).size !== t.railStagingJobs.length ||
        t.railStagingJobs.some(
          (id: unknown) =>
            typeof id !== 'string' ||
            !s.jobs.some((j: any) => j.id === id && j.kind === 'rail' && j.item === t.item),
        ))
    )
      fail('invalid shared rail staging stock');
    if (
      t.trackHand !== undefined &&
      (![1, -1].includes(t.trackHand) || !t.item?.startsWith('rail'))
    )
      fail('invalid stored track handedness');
    if (
      !point(t) ||
      !(t.item in MATERIALS) ||
      !Number.isInteger(t.qty) ||
      t.qty < 0 ||
      t.qty > MATERIALS[t.item as keyof typeof MATERIALS].max ||
      !Number.isInteger(t.reserved) ||
      t.reserved < 0 ||
      t.reserved > t.qty ||
      !finite(t.w) ||
      !finite(t.d) ||
      t.w <= 0 ||
      t.d <= 0
    )
      fail('invalid physical stock');
    if (
      t.baseHeight !== undefined &&
      (!finite(t.baseHeight) || t.baseHeight < 0 || t.baseHeight > 1)
    )
      fail('invalid stock support height');
    if (t.item === 'diesel' && (!finite(t.liters) || t.liters < 0 || t.liters > 200))
      fail('invalid diesel contents');
  }
  for (const b of [...s.buildings, ...s.zones, ...s.jobs])
    if (!point(b) || !finite(b.w) || !finite(b.d) || b.w <= 0 || b.d <= 0)
      fail('invalid footprint');
  for (const r of s.rails) {
    if (!point(r) || ![0, 1].includes(r.rotation) || !finite(r.length)) fail('invalid track panel');
    if (r.track) {
      if (!validTrackPiece(r.track)) fail('invalid track geometry');
      const g = trackGeometry(r);
      if (
        Math.abs(r.length - g.length) > 1e-5 ||
        Math.abs(r.x - g.rect.x) > 1e-5 ||
        Math.abs(r.z - g.rect.z) > 1e-5 ||
        r.item !== trackItem(r.track) ||
        r.rotation !== r.track.heading % 2
      )
        fail('track panel disagrees with its geometry or material');
      if (r.track.groupId && !groups.has(r.track.groupId)) fail('track work order missing');
    } else if (r.length !== 5 || (r.item !== undefined && r.item !== 'rail'))
      fail('invalid legacy track panel');
    if (
      r.selectedRoute !== undefined &&
      (!['straight', 'branch'].includes(r.selectedRoute) ||
        r.track?.layout !== 'turnout' ||
        r.track?.section !== 0)
    )
      fail('invalid turnout route');
  }
  for (const g of s.jobGroups || [])
    if (
      g.track &&
      (!validTrackPiece({ ...g.track, section: 0 }) ||
        !['straight', 'curve', 'turnout'].includes(g.track.layout))
    )
      fail('invalid track work order layout');
  if (s.railLocations !== undefined) {
    if (!Array.isArray(s.railLocations) || s.railLocations.length > 512)
      fail('invalid or oversized rail locations');
    const names = new Set<string>();
    for (const l of s.railLocations) {
      if (!validRailLocation(s, l) || ids.has(l.id)) fail('invalid or duplicate rail location');
      const name = l.name.toLocaleLowerCase('en-US');
      if (names.has(name)) fail('duplicate rail location name');
      names.add(name);
      ids.add(l.id);
    }
  }
  for (const j of s.jobs) {
    if (j.railRecovery !== undefined) {
      const h = j.railRecovery;
      const active = !['done', 'canceled'].includes(j.status);
      const rail = s.rails.find((t: any) => t.id === h?.railId);
      if (
        !h ||
        j.kind !== 'remove' ||
        typeof h.railId !== 'string' ||
        h.railId.startsWith('BOOTSTRAP-') ||
        j.target !== h.railId ||
        h.recoveredItem !== j.item ||
        !j.item?.startsWith('rail') ||
        (h.rail && (h.rail.item || 'rail') !== h.recoveredItem) ||
        j.qty !== 1 ||
        !h.rail ||
        h.rail.id !== h.railId ||
        !point(h.rail) ||
        !finite(h.rail.length) ||
        h.rail.length <= 0 ||
        (h.rail.track && !validTrackPiece(h.rail.track)) ||
        !Array.isArray(h.buffers) ||
        !h.buffers.every((v: any) => typeof v === 'string') ||
        ['unbolted', 'lifted'].some((k) => h[k] !== undefined && typeof h[k] !== 'boolean') ||
        (h.retightenClock !== undefined && (!finite(h.retightenClock) || h.retightenClock < 0)) ||
        (active && (!h.lifted ? !rail : !!rail)) ||
        (active && rail && JSON.stringify(rail) !== JSON.stringify(h.rail)) ||
        (active && h.lifted && !j.railWork)
      )
        fail('invalid installed rail recovery');
    }
    if (j.kind === 'moveStock' || j.stockMove !== undefined) {
      const m = j.stockMove;
      if (
        (j.kind !== 'moveStock' && !j.railRecovery) ||
        !m ||
        typeof m.sourceId !== 'string' ||
        j.target !== m.sourceId ||
        !j.item?.startsWith('rail') ||
        !MATERIALS[j.item as keyof typeof MATERIALS] ||
        j.qty !== 1 ||
        !finite(m.yaw) ||
        !point(m.destination) ||
        (j.railRecovery &&
          !['done', 'canceled'].includes(j.status) &&
          (!s.zones.some(
            (z: any) =>
              m.destination.x >= z.x &&
              m.destination.z >= z.z &&
              m.destination.x + m.destination.w <= z.x + z.w &&
              m.destination.z + m.destination.d <= z.z + z.d,
          ) ||
            m.destination.w !== MATERIALS[j.item as keyof typeof MATERIALS].w ||
            m.destination.d !== MATERIALS[j.item as keyof typeof MATERIALS].d)) ||
        ![m.destination.w, m.destination.d].every(finite) ||
        (!j.railRecovery && ['x', 'z', 'w', 'd'].some((k) => j[k] !== m.destination[k])) ||
        j.track ||
        j.railStagingBatch ||
        j.railBufferCleanup
      )
        fail('invalid physical stock relocation');
    }
    if (j.kind === 'throwSwitch') {
      const points = s.rails.find((r: any) => r.id === j.target);
      if (
        !['straight', 'branch'].includes(j.requestedRoute) ||
        (!['done', 'canceled'].includes(j.status) && !points?.track) ||
        (points && (points.track?.layout !== 'turnout' || points.track.section !== 0)) ||
        j.qty !== 0 ||
        j.item !== undefined ||
        j.track !== undefined ||
        j.operator !== undefined ||
        j.equipment !== undefined ||
        j.stack !== undefined ||
        j.preferredEquipment !== undefined ||
        !finite(j.elapsed) ||
        j.elapsed < 0 ||
        j.elapsed > 4 ||
        !finite(j.progress) ||
        j.progress < 0 ||
        j.progress > 1
      )
        fail('invalid manual turnout operation');
      if (
        j.status === 'doing' &&
        !s.workers.some((w: any) => w.id === j.worker && w.job === j.id && !w.vehicle)
      )
        fail('manual turnout operation has no worker on foot');
    } else if (j.requestedRoute !== undefined)
      fail('turnout route request belongs to a manual turnout operation');
    if (j.track) {
      if (
        j.kind !== 'rail' ||
        !validTrackPiece(j.track) ||
        j.item !== trackItem(j.track) ||
        j.track.groupId !== j.parentId ||
        j.qty !== 1 ||
        j.rotation !== j.track.heading % 2
      )
        fail('invalid track construction geometry or material');
      const macro = groups.get(j.parentId)?.track;
      if (
        !macro ||
        ['layout', 'heading', 'hand', 'flow'].some((k) => macro[k] !== j.track[k]) ||
        macro.origin.x !== j.track.origin.x ||
        macro.origin.z !== j.track.origin.z
      )
        fail('track panel disagrees with work order layout');
      const g = trackGeometry(j);
      if (
        ['x', 'z', 'w', 'd'].some((k) => Math.abs(j[k] - g.rect[k as keyof typeof g.rect]) > 1e-5)
      )
        fail('track construction footprint disagrees with geometry');
    }
    if (
      j.legacyRailHandoff !== undefined &&
      (j.kind !== 'rail' || !['carried', 'staged', 'installed'].includes(j.legacyRailHandoff))
    )
      fail('invalid legacy rail handoff');
    if (
      !['todo', 'doing', 'done', 'canceled'].includes(j.status) ||
      typeof j.phase !== 'string' ||
      typeof j.reason !== 'string' ||
      !finite(j.elapsed) ||
      !finite(j.progress)
    )
      fail('invalid work order');
    if (
      j.creative !== undefined &&
      (typeof j.creative !== 'boolean' || (j.creative && (j.status !== 'done' || !j.delivered)))
    )
      fail('invalid creative placement record');
    if (
      j.status === 'doing' &&
      ((!s.workers.some((w: any) => w.id === j.worker) &&
        !(
          j.kind === 'slab' &&
          !j.worker &&
          s.workers.some(
            (w: any) => w.id === j.operator && w.job === j.id && w.role === 'operator',
          ) &&
          ((!j.handling && ['Board equipment', 'Collect material'].includes(j.phase)) ||
            (j.handling?.state === 'stored' &&
              ['approach', 'rig'].includes(j.handling.phase) &&
              j.handling.clock === 0))
        )) ||
        (!s.equipment.some((e: any) => e.id === j.equipment) &&
          j.kind !== 'throwSwitch' &&
          !(
            (j.kind === 'slab' || j.item === 'bufferStop') &&
            j.handling?.equipmentReleased === true &&
            j.handling.phase === 'settle' &&
            j.handling.state === 'placed'
          )))
    )
      fail('active job has missing crew or equipment');
    if (j.shedAssembly) {
      const h = j.shedAssembly;
      const pose = (p: any) => point(p) && finite(p.y) && finite(p.yaw);
      if (
        j.kind !== 'shed' ||
        ![
          'stage',
          'unpack',
          'anchor',
          'collect',
          'rig',
          'lift',
          'carry',
          'lower',
          'fasten',
          'withdraw',
          'complete',
        ].includes(h.phase) ||
        !finite(h.clock) ||
        h.clock < 0 ||
        !pose(h.kitPose) ||
        typeof h.recovering !== 'boolean' ||
        ![
          ['anchors', 6],
          ['posts', 6],
          ['beams', 3],
          ['roofSheets', 4],
          ['wallPanels', 2],
          ['braces', 1],
        ].every(([name, max]) => Number.isInteger(h[name]) && h[name] >= 0 && h[name] <= max) ||
        (h.dock && !point(h.dock)) ||
        (h.workerPoint && !point(h.workerPoint)) ||
        (h.ladder &&
          (!point(h.ladder) ||
            !finite(h.ladder.height) ||
            h.ladder.height < 0 ||
            h.ladder.height > 6)) ||
        (h.part &&
          (!['post', 'beam', 'roof', 'wall', 'brace'].includes(h.part.kind) ||
            !Number.isInteger(h.part.index) ||
            h.part.index < 0 ||
            h.part.index >=
              ({ post: 6, beam: 3, roof: 4, wall: 2, brace: 1 } as any)[h.part.kind] ||
            ![h.part.pose, h.part.from, h.part.to].every(pose) ||
            (h.part.carried !== undefined && typeof h.part.carried !== 'boolean')))
      )
        fail('invalid staged shed assembly');
      if (
        j.status === 'doing' &&
        !['stage', 'unpack'].includes(h.phase) &&
        (!j.delivered || s.equipment.some((e: any) => e.id === j.equipment && e.cargo))
      )
        fail('invalid shed kit ownership');
      if (
        j.status === 'doing' &&
        !['stage', 'unpack', 'anchor', 'withdraw', 'complete'].includes(h.phase) &&
        !h.part
      )
        fail('missing active shed component');
    }
    const machine = s.equipment.find((e: any) => e.id === j.equipment);
    if (machine?.assemblyLoad) {
      const a = machine.assemblyLoad;
      if (
        j.status !== 'doing' ||
        !j.shedAssembly?.part ||
        !['lift', 'carry', 'lower'].includes(j.shedAssembly.phase) ||
        a.job !== j.id ||
        a.kind !== j.shedAssembly.part.kind ||
        machine.cargo ||
        ![a.length, a.width, a.yawOffset].every(finite) ||
        a.length <= 0 ||
        a.length > 10 ||
        a.width <= 0 ||
        a.width > 10
      )
        fail('invalid carried shed component');
    }
    if (j.handling) {
      const h = j.handling;
      const pose = (p: any) => point(p) && finite(p.y) && finite(p.yaw);
      if (h.equipmentReleased !== undefined && typeof h.equipmentReleased !== 'boolean')
        fail('invalid construction equipment release');
      if (
        h.equipmentReleased &&
        !(
          (h.phase === 'settle' && h.state === 'placed') ||
          (h.phase === 'complete' && ['stored', 'installed'].includes(h.state))
        )
      )
        fail('invalid construction equipment release phase');
      if (
        h.equipmentReleased &&
        j.status === 'doing' &&
        (j.equipment ||
          j.operator ||
          !s.workers.some((w: any) => w.id === j.worker && w.job === j.id))
      )
        fail('invalid independent slab finishing crew');
      if (
        (j.kind !== 'slab' && j.item !== 'bufferStop') ||
        ![
          'approach',
          'rig',
          'engage',
          'lift',
          'clear',
          'carry',
          'lower',
          'withdraw',
          'settle',
          'complete',
        ].includes(h.phase) ||
        !['stored', 'carried', 'placed', 'installed'].includes(h.state) ||
        !finite(h.clock) ||
        h.clock < 0 ||
        !pose(h.pose) ||
        !pose(h.source) ||
        (h.from && !pose(h.from)) ||
        ![
          h.sourceDock,
          h.sourceApproach,
          h.sourceClear,
          h.destinationDock,
          h.destinationClear,
        ].every(point) ||
        ![h.reach, h.yawOffset, h.toolLift, h.toolReach].every(finite) ||
        h.reach < 0 ||
        h.reach > 8
      )
        fail('invalid construction slab handling');
      if (j.status === 'doing') {
        const e = s.equipment.find((e: any) => e.id === j.equipment);
        if (h.state === 'carried' && (e?.cargo?.item !== j.item || e.cargo.qty !== 1))
          fail('missing carried construction slab');
        if (
          h.state === 'placed' &&
          !s.stacks.some(
            (t: any) =>
              t.id === h.placedStack && t.item === j.item && t.qty === 1 && t.reserved === 1,
          )
        )
          fail('missing placed construction slab');
        if (
          h.state === 'stored' &&
          !(
            j.kind === 'remove' &&
            j.item === 'bufferStop' &&
            (s.buffers || []).some((b: any) => b.id === h.sourceId && !b.carried)
          ) &&
          !s.stacks.some(
            (t: any) => t.id === h.sourceId && t.item === j.item && t.qty > 0 && t.reserved > 0,
          )
        )
          fail('missing reserved construction slab');
      }
    }
    if (j.railWork) {
      const r = j.railWork;
      if (
        r.approach !== undefined &&
        (!r.approach ||
          ![r.approach.preferred, r.approach.target, r.approach.point].every(point) ||
          Math.hypot(
            r.approach.point.x - r.approach.target.x,
            r.approach.point.z - r.approach.target.z,
          ) > 8)
      )
        fail('invalid alternate rail-handling approach');
      if (
        r.routeBlockage !== undefined &&
        (!r.routeBlockage ||
          typeof r.routeBlockage.blocker !== 'string' ||
          !finite(r.routeBlockage.since) ||
          !finite(r.routeBlockage.retryAt) ||
          (r.routeBlockage.warned !== undefined && typeof r.routeBlockage.warned !== 'boolean'))
      )
        fail('invalid rail route blockage');
      if (r.stagingBatch !== undefined) {
        const b = r.stagingBatch,
          material = MATERIALS[(j.item || 'rail') as keyof typeof MATERIALS];
        const machine = s.equipment.find((e: any) => e.id === j.equipment);
        if (
          !j.railStageOnly ||
          !b ||
          !Array.isArray(b.jobIds) ||
          !Number.isInteger(b.qty) ||
          b.qty < 1 ||
          b.qty > material.max ||
          b.jobIds.length !== b.qty ||
          new Set(b.jobIds).size !== b.qty ||
          !b.jobIds.includes(j.id) ||
          !machine ||
          b.qty * material.mass > EQUIPMENT[machine.kind as keyof typeof EQUIPMENT].capacity ||
          b.jobIds.some(
            (id: unknown) =>
              !s.jobs.some(
                (member: any) =>
                  member.id === id &&
                  member.kind === 'rail' &&
                  member.item === j.item &&
                  railWorkGroup(s, member)?.id === railWorkGroup(s, j)?.id,
              ),
          )
        )
          fail('invalid physical rail staging batch');
      }
      const phases = [
        'configure-staged-panel',
        'source-approach',
        'source-rig',
        'source-lift',
        'source-clear',
        'stage-travel',
        'stage-align',
        'stage-lower',
        'legacy-fork-withdraw',
        'unbolt-buffer',
        'buffer-rig',
        'buffer-lift',
        'buffer-carry-aside',
        'buffer-lower-aside',
        'panel-approach',
        'panel-rig',
        'panel-lift',
        'panel-carry',
        'panel-align',
        'panel-lower',
        'join-panel',
        'buffer-retrieve',
        'buffer-rig-return',
        'buffer-lift-return',
        'buffer-carry-end',
        'buffer-align-end',
        'buffer-lower-end',
        'fasten-buffer',
        'cancel-panel-lift',
        'cancel-panel-return',
        'cancel-panel-align',
        'cancel-panel-lower',
        'complete',
      ];
      const pose = (p: any) => point(p) && finite(p.y) && finite(p.yaw);
      if (['entryYaw', 'endYaw', 'stageYaw'].some((k) => r[k] !== undefined && !finite(r[k])))
        fail('invalid track construction orientation');
      if (r.configuredHand !== undefined && ![1, -1].includes(r.configuredHand))
        fail('invalid staged turnout hand');
      if (
        r.configureProgress !== undefined &&
        (!finite(r.configureProgress) || r.configureProgress < 0 || r.configureProgress > 1)
      )
        fail('invalid turnout configuration progress');
      if (r.legacyForkYaw !== undefined && !finite(r.legacyForkYaw))
        fail('invalid imported panel orientation');
      if (
        (!j.railRecovery && !['rail', 'moveStock'].includes(j.kind)) ||
        !phases.includes(r.phase) ||
        !finite(r.clock) ||
        r.clock < 0 ||
        !finite(r.axisYaw) ||
        ![r.start, r.end, r.side, r.stage, r.stageDock, r.railDock, r.bufferAside].every(point) ||
        !finite(r.stage.w) ||
        !finite(r.stage.d) ||
        r.stage.w <= 0 ||
        r.stage.d <= 0 ||
        !pose(r.panel) ||
        !['stored', 'carried', 'staged', 'placed', 'installed'].includes(r.panel.state)
      )
        fail('invalid rail work sequence');
      if (
        r.siteClearance &&
        ((r.siteClearance.area !== undefined && typeof r.siteClearance.area !== 'string') ||
          !Array.isArray(r.siteClearance.blockers) ||
          !r.siteClearance.blockers.every((v: any) => typeof v === 'string') ||
          !Array.isArray(r.siteClearance.requested) ||
          !r.siteClearance.requested.every((v: any) => typeof v === 'string') ||
          !finite(r.siteClearance.since) ||
          r.siteClearance.since < 0 ||
          (r.siteClearance.warned !== undefined && typeof r.siteClearance.warned !== 'boolean') ||
          (r.siteClearance.retryAt !== undefined && !finite(r.siteClearance.retryAt)))
      )
        fail('invalid rail staging clearance request');
      if (r.from && !pose(r.from)) fail('invalid rail lifting origin');
      if (r.lifting !== undefined && !['panel', 'buffer'].includes(r.lifting))
        fail('invalid rail lifting attachment');
      if (
        r.buffer &&
        (!pose(r.buffer) ||
          (j.status === 'doing'
            ? !knownBufferId(r.buffer.id)
            : typeof r.buffer.id !== 'string' || !r.buffer.id) ||
          typeof r.buffer.secured !== 'boolean' ||
          typeof r.buffer.carried !== 'boolean')
      )
        fail('invalid physical buffer pose');
      if (
        r.source &&
        (!pose(r.source.pose) ||
          ![r.source.dock, r.source.clear, r.source.workerPoint].every(point) ||
          (r.source.approach !== undefined && !point(r.source.approach)) ||
          (r.source.entering !== undefined && typeof r.source.entering !== 'boolean') ||
          typeof r.source.stackId !== 'string')
      )
        fail('invalid rail source pickup');
      if (j.status === 'doing') {
        if (
          ['stored', 'staged'].includes(r.panel.state) &&
          !s.stacks.some(
            (t: any) =>
              t.id === (r.panel.state === 'stored' ? r.source?.stackId : r.panel.stackId) &&
              t.item === (j.item || 'rail') &&
              t.qty > 0 &&
              (r.stagingBatch && r.panel.state === 'staged'
                ? t.qty >= r.stagingBatch.qty
                : t.reserved >= (r.stagingBatch?.qty || 1)),
          )
        )
          fail('reserved rail panel is missing');
        if (
          ['carried', 'placed'].includes(r.panel.state) &&
          !s.equipment.some(
            (e: any) =>
              e.id === j.equipment &&
              e.cargo?.item === (j.item || 'rail') &&
              e.cargo.qty === (r.stagingBatch?.qty || 1),
          )
        )
          fail('suspended rail panel is missing');
        if (r.panel.state === 'installed' && !s.rails.some((t: any) => t.id === r.panel.railId))
          fail('installed rail panel is missing');
      }
    }
  }
  for (const o of s.orders) {
    if (
      o.stackLimits !== undefined &&
      (!o.stackLimits ||
        typeof o.stackLimits !== 'object' ||
        Array.isArray(o.stackLimits) ||
        Object.entries(o.stackLimits).some(
          ([item, limit]) =>
            !Object.hasOwn(MATERIALS, item) ||
            !Number.isInteger(limit) ||
            (limit as number) < 1 ||
            (limit as number) > MATERIALS[item as keyof typeof MATERIALS].max,
        ) ||
        !(o.item in MATERIALS) ||
        (Array.isArray(o.manifest) ? o.manifest : [{ item: o.item }]).some(
          (line: any) => !Object.hasOwn(o.stackLimits, line.item),
        ))
    )
      fail('invalid freight stack limits');
    const freightProblem = freightValidationProblem(s, o, ids);
    if (freightProblem) fail(freightProblem);
    if (
      o.automaticEquipment !== undefined &&
      (typeof o.automaticEquipment !== 'string' ||
        !s.equipment.some((e: any) => e.id === o.automaticEquipment))
    )
      fail('invalid automatic delivery equipment');
    if (o.manifest !== undefined) {
      const lines = o.manifest;
      if (
        !Array.isArray(lines) ||
        lines.length < (o.railFreight ? 1 : 2) ||
        lines.length > 20 ||
        o.commute ||
        lines.some(
          (l: any) =>
            !l ||
            typeof l.item !== 'string' ||
            !Number.isInteger(l.qty) ||
            l.qty < 1 ||
            !Number.isInteger(l.arrived) ||
            l.arrived < 0 ||
            l.arrived > l.qty,
        ) ||
        new Set(lines.map((l: any) => l.item)).size !== lines.length ||
        lines[0].item !== o.item ||
        lines.reduce((n: number, l: any) => n + l.qty, 0) !== o.qty ||
        lines.reduce((n: number, l: any) => n + l.arrived, 0) !== o.arrived
      )
        fail('invalid delivery manifest');
      const material = lines.every((l: any) => Object.hasOwn(MATERIALS, l.item)),
        crew = lines.every((l: any) => Object.hasOwn(ROLES, l.item));
      if (!material && !crew) fail('incompatible items on one carrier');
      if (crew && (o.mode !== 'road' || o.qty > CREW_BUS_SEATS)) fail('overfilled crew bus');
      if (
        material &&
        !o.railFreight &&
        (!['road', 'rail'].includes(o.mode) ||
          orderMass(o) > FREIGHT_CAPACITY[o.mode as 'road' | 'rail'] ||
          orderDeckLength(lines, freightStackLimits(o)) >
            FREIGHT_DECK_LENGTH[o.mode as 'road' | 'rail'])
      )
        fail('overfilled freight carrier');
      // Loading order is physical: completed earlier lines, at most one partial line.
      let unfinished = false;
      for (const l of lines) {
        if (unfinished && l.arrived > 0) fail('out-of-order manifest transfer');
        if (l.arrived < l.qty) unfinished = true;
      }
    }
    if (o.carrierDeparted !== undefined && typeof o.carrierDeparted !== 'boolean')
      fail('invalid carrier departure');
    if (o.unloadPaused !== undefined && typeof o.unloadPaused !== 'boolean')
      fail('invalid delivery pause');
    if (
      o.unloadOperatorDuty !== undefined &&
      (!o.unloadPaused || !['auto', 'manual', 'rest'].includes(o.unloadOperatorDuty))
    )
      fail('invalid saved delivery operator duty');
    if (
      o.unloadBlockage &&
      (!finite(o.unloadBlockage.since) ||
        o.unloadBlockage.since < 0 ||
        o.unloadBlockage.since > s.elapsed + 0.1 ||
        typeof o.unloadBlockage.reason !== 'string' ||
        o.unloadBlockage.reason.length > 2000 ||
        (o.unloadBlockage.warned !== undefined && typeof o.unloadBlockage.warned !== 'boolean'))
    )
      fail('invalid saved delivery blockage');
    if (o.unloadPaused) {
      const t = o.unload,
        e = s.equipment.find((q: any) => q.id === t?.equipmentId),
        w = s.workers.find((q: any) => q.id === t?.operatorId);
      if (
        !t ||
        !e ||
        !w ||
        !['clear', 'carry', 'back-away'].includes(t.phase) ||
        e.deliveryOrder !== o.id ||
        w.deliveryOrder !== o.id ||
        e.operator !== w.id ||
        w.vehicle !== e.id ||
        w.duty !== 'manual' ||
        (['clear', 'carry'].includes(t.phase) && (!e.cargo || !t.cargo)) ||
        (t.phase === 'clear' && t.riggerId)
      )
        fail('unsafe paused delivery assignment');
    }
    if (o.carrierDeparted && (!['departing', 'done'].includes(o.status) || o.arrived !== o.qty))
      fail('departed carrier still has an unreceived load');
    if (
      o.commute &&
      (!['outbound', 'inbound'].includes(o.commute.direction) ||
        o.mode !== 'road' ||
        !Array.isArray(o.commute.workers) ||
        o.commute.workers.length !== o.qty ||
        o.qty > 12 ||
        new Set(o.commute.workers).size !== o.qty ||
        o.commute.workers.some((id: any) => !s.workers.some((w: any) => w.id === id)))
    )
      fail('invalid commute passengers');
    if (
      o.commute?.boarding &&
      (!point(o.commute.boarding.from) ||
        !finite(o.commute.boarding.clock) ||
        o.commute.boarding.clock < 0 ||
        !o.commute.workers.includes(o.commute.boarding.worker))
    )
      fail('invalid bus boarding phase');
    if (
      !(o.item in MATERIALS || o.item in ROLES || o.item in EQUIPMENT || o.item in SERVICES) ||
      !Number.isInteger(o.qty) ||
      o.qty < 1 ||
      !Number.isInteger(o.arrived) ||
      o.arrived < 0 ||
      o.arrived > o.qty ||
      !finite(o.eta) ||
      !finite(o.total) ||
      !point(o.vehicle) ||
      !point(o.handler) ||
      !['ordered', 'approaching', 'unloading', 'departing', 'done'].includes(o.status) ||
      !['road', 'rail'].includes(o.mode)
    )
      fail('invalid delivery');
    if (
      o.notifiedBlocks &&
      (!Array.isArray(o.notifiedBlocks) ||
        o.notifiedBlocks.length > 20 ||
        o.notifiedBlocks.some((k: any) => typeof k !== 'string'))
    )
      fail('invalid delivery notices');
    if (o.handlerPath && !path(o.handlerPath)) fail('invalid unloading route');
    if (o.drive && (!motion(o.drive) || !finite(o.drive.distance) || o.drive.distance < 0))
      fail('invalid carrier motion');
    if (
      o.drive &&
      o.drive.gearPause !== undefined &&
      (!finite(o.drive.gearPause) || o.drive.gearPause < 0)
    )
      fail('invalid gear change pause');
    if (
      o.drive?.clearanceRequestedFor !== undefined &&
      typeof o.drive.clearanceRequestedFor !== 'string'
    )
      fail('invalid carrier clearance request');
    if (o.drive?.roadVersion !== undefined && !Number.isInteger(o.drive.roadVersion))
      fail('invalid road route version');
    if (o.drive?.yardPermit !== undefined && typeof o.drive.yardPermit !== 'boolean')
      fail('invalid yard maneuver permit');
    if (o.ramp !== undefined && (!finite(o.ramp) || o.ramp < 0 || o.ramp > 1))
      fail('invalid loading ramp');
    if (o.deploymentClock !== undefined && (!finite(o.deploymentClock) || o.deploymentClock < 0))
      fail('invalid deployment clock');
    if (
      o.deployment &&
      !['waiting', 'walk', 'climb', 'board', 'offload', 'park', 'complete'].includes(o.deployment)
    )
      fail('invalid deployment phase');
    if (o.equipmentId && !s.equipment.some((e: any) => e.id === o.equipmentId))
      fail('delivery machine is missing');
    if (o.operatorId && !s.workers.some((w: any) => w.id === o.operatorId && w.role === 'operator'))
      fail('delivery operator is missing');
    if (
      o.contractor &&
      (!point(o.contractor) ||
        !motion(o.contractor) ||
        !path(o.contractor.path) ||
        !finite(o.contractor.clock))
    )
      fail('invalid utility crew');
    if (o.unload) {
      const t = o.unload;
      if (t.item !== undefined && !Object.hasOwn(MATERIALS, t.item))
        fail('invalid unloading material');
      if (
        o.manifest &&
        (!Number.isInteger(t.lineIndex) ||
          !o.manifest[t.lineIndex] ||
          o.manifest[t.lineIndex].item !== t.item)
      )
        fail('invalid unloading manifest line');
      if (
        !o.manifest &&
        ((t.lineIndex !== undefined && t.lineIndex !== 0) ||
          (t.item !== undefined && t.item !== o.item))
      )
        fail('invalid unloading manifest line');
      if (
        !s.equipment.some((e: any) => e.id === t.equipmentId) ||
        !s.workers.some((w: any) => w.id === t.operatorId && w.role === 'operator') ||
        (t.riggerId && !s.workers.some((w: any) => w.id === t.riggerId))
      )
        fail('unloading task has missing machine or crew');
      if (
        !(o.item in MATERIALS) ||
        !Number.isInteger(t.qty) ||
        t.qty < 1 ||
        t.qty > MATERIALS[(t.item || o.item) as keyof typeof MATERIALS]?.max ||
        !finite(t.clock) ||
        t.clock < 0
      )
        fail('invalid unloading quantity or clock');
      if (
        ![
          'boarding',
          'approach',
          'rig',
          'lift',
          'clear',
          'carry',
          'lower',
          'release',
          'back-away',
        ].includes(t.phase)
      )
        fail('invalid unloading phase');
      if (
        ![t.source, t.pickup, t.destination, t.drop].every(point) ||
        !finite(t.destination.w) ||
        !finite(t.destination.d) ||
        t.destination.w <= 0 ||
        t.destination.d <= 0 ||
        ![t.sourceY, t.sourceYaw, t.dropYaw, t.destinationY].every(finite)
      )
        fail('invalid unloading positions');
      if (t.cargo && (!point(t.cargo) || !finite(t.cargo.y) || !finite(t.cargo.yaw)))
        fail('invalid lifted cargo pose');
      if (
        t.mergeId &&
        !s.stacks.some((q: any) => q.id === t.mergeId && q.item === (t.item || o.item))
      )
        fail('unloading destination stack is missing');
    }
  }
  if (s.version >= 3) {
    for (const w of s.workers) {
      if (w.vehicle && !s.equipment.some((e: any) => e.id === w.vehicle))
        fail('worker vehicle is missing');
      if (
        w.transition &&
        (!['enter', 'exit'].includes(w.transition.kind) ||
          !finite(w.transition.clock) ||
          !point(w.transition.from) ||
          !point(w.transition.to) ||
          !finite(w.transition.from.y) ||
          !finite(w.transition.to.y) ||
          !s.equipment.some((e: any) => e.id === w.transition.equipmentId))
      )
        fail('invalid boarding transition');
    }
    for (const e of [...s.workers, ...s.equipment]) {
      if (e.deliveryOrder && !s.orders.some((o: any) => o.id === e.deliveryOrder))
        fail('assigned delivery is missing');
      if (e.transportOrder && !s.orders.some((o: any) => o.id === e.transportOrder))
        fail('transport carrier is missing');
    }
  }
  for (const c of s.costs) if (!finite(c.amount) || !finite(c.time)) fail('invalid cost entry');
  for (const m of s.movements)
    if (!(m.item in MATERIALS) || !finite(m.qty) || !finite(m.time))
      fail('invalid material movement');
}
