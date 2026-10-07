import type { State } from './types';
import type { Collection, RetiredEquipment } from './collection-types';
import { MATERIALS, EQUIPMENT } from './catalog';
import { COLLECTION_FEES } from './collection';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (v: any) =>
  v && finite(v.x) && finite(v.z) && Math.abs(v.x) < 10000 && Math.abs(v.z) < 10000;
const whole = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const phases = [
  'boarding',
  'source',
  'rig',
  'lift',
  'clear-source',
  'carry',
  'lower',
  'secure-exit',
  'secure-walk',
  'secure',
  'secure-return',
  'secure-board',
  'clear-deck',
  'return',
  'return-lower',
  'equipment-approach',
  'ramps',
  'equipment-ramp',
  'equipment-exit',
  'equipment-unload',
  'equipment-clear',
];
export function collectionValidationProblem(
  value: State,
  knownIds?: Set<string>,
): string | undefined {
  const s = value as State & { collections?: Collection[]; retiredEquipment?: RetiredEquipment[] };
  if (
    s.collections !== undefined &&
    (!Array.isArray(s.collections) || s.collections.length > 20000)
  )
    return 'invalid collection records';
  if (
    s.retiredEquipment !== undefined &&
    (!Array.isArray(s.retiredEquipment) || s.retiredEquipment.length > 20000)
  )
    return 'invalid retired equipment records';
  const ids = new Set(
    knownIds ||
      [...s.orders, ...s.jobs, ...s.workers, ...s.equipment, ...s.stacks].map((q) => q.id),
  );
  for (const e of s.retiredEquipment || []) {
    if (
      !e ||
      typeof e.id !== 'string' ||
      ids.has(e.id) ||
      !Object.hasOwn(EQUIPMENT, e.kind) ||
      !point(e) ||
      ![e.fuel, e.used, e.tank, e.retiredAt].every(finite) ||
      e.fuel < 0 ||
      e.tank !== EQUIPMENT[e.kind].tank ||
      e.fuel > e.tank ||
      e.used < 0 ||
      e.retiredAt > s.time ||
      e.retirementReason !== 'paid collection' ||
      !Array.isArray(e.path) ||
      e.path.length ||
      e.cargo ||
      e.job ||
      e.operator ||
      e.deliveryOrder ||
      e.transportOrder ||
      e.refueling ||
      !(s.collections || []).some(
        (c) => c.id === e.collectionId && c.equipmentId === e.id && c.status === 'done',
      )
    )
      return 'invalid retired equipment asset';
    ids.add(e.id);
  }
  const sourceReserved = new Map<string, number>(),
    owners = new Set<string>(),
    actors = new Set<string>(),
    machineOwners = new Set<string>();
  for (const c of s.collections || []) {
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id))
      return 'invalid or repeated collection ID';
    ids.add(c.id);
    const o: any = s.orders.find((o) => o.id === c.carrierOrderId);
    if (
      !o ||
      o.collectionId !== c.id ||
      o.mode !== 'road' ||
      o.railFreight ||
      o.unload ||
      o.commute
    )
      return 'collection carrier ownership mismatch';
    if (
      !['materials', 'equipment'].includes(c.kind) ||
      !['ordered', 'loading', 'departing', 'done', 'canceling', 'canceled', 'paused'].includes(
        c.status,
      ) ||
      typeof c.phase !== 'string' ||
      c.phase.length > 200 ||
      typeof c.note !== 'string' ||
      c.note.length > 2000 ||
      !finite(c.created) ||
      c.created > s.time ||
      (c.finished !== undefined && (!finite(c.finished) || c.finished > s.time)) ||
      !finite(c.massKg) ||
      c.massKg <= 0 ||
      c.massKg > 15000 ||
      !c.fees ||
      ![c.fees.transport, c.fees.disposal, c.fees.total, c.fees.charged].every(finite) ||
      c.fees.transport < 0 ||
      c.fees.charged < 0 ||
      c.fees.charged > c.fees.total ||
      c.fees.disposal !==
        Math.ceil(
          c.massKg *
            (c.kind === 'equipment'
              ? COLLECTION_FEES.equipmentPerKg
              : COLLECTION_FEES.materialPerKg),
        ) ||
      o.total !== c.fees.total ||
      o.invoiced !== c.fees.invoiced ||
      c.fees.disposal < 0 ||
      c.fees.total !== c.fees.transport + c.fees.disposal ||
      typeof c.fees.invoiced !== 'boolean' ||
      c.fees.transport !==
        (c.kind === 'equipment' ? COLLECTION_FEES.lowloader : COLLECTION_FEES.truck) ||
      (c.cancelRequested !== undefined && typeof c.cancelRequested !== 'boolean') ||
      (c.retryAt !== undefined && (!finite(c.retryAt) || c.retryAt < 0)) ||
      (c.warned !== undefined &&
        (!Array.isArray(c.warned) ||
          c.warned.length > 32 ||
          c.warned.some((w) => typeof w !== 'string' || w.length > 2000)))
    )
      return 'invalid collection state or quote';
    if (
      !Array.isArray(c.lines) ||
      c.lines.length > 100 ||
      (c.kind === 'materials'
        ? !c.lines.length || c.equipmentId
        : c.lines.length || typeof c.equipmentId !== 'string')
    )
      return 'invalid collection selection';
    if (
      o.collectionId &&
      (o.manifest ||
        o.automaticEquipment ||
        o.stackLimits ||
        o.item !==
          (c.equipmentId
            ? [...s.equipment, ...(s.retiredEquipment || [])].find((e) => e.id === c.equipmentId)
                ?.kind
            : c.lines[0]?.item) ||
        o.qty !== (c.kind === 'equipment' ? 1 : c.lines.reduce((n, l) => n + l.qty, 0)))
    )
      return 'invalid collection carrier ledger';
    if (
      c.kind === 'equipment' &&
      ![...s.equipment, ...(s.retiredEquipment || [])].some((e) => e.id === c.equipmentId)
    )
      return 'collected equipment identity missing';
    if (c.kind === 'materials' && c.massKg > 12000) return 'overloaded collection truck';
    if (
      c.status === 'paused' &&
      !['ordered', 'loading', 'canceling'].includes(c.pausedStatus || '')
    )
      return 'invalid paused collection';
    let loaded = 0,
      width = 0;
    for (const [index, l] of c.lines.entries()) {
      if (
        !l ||
        typeof l.stackId !== 'string' ||
        !Object.hasOwn(MATERIALS, l.item) ||
        !whole(l.qty) ||
        l.qty < 1 ||
        !whole(l.reserved) ||
        !whole(l.loaded) ||
        !whole(l.collected) ||
        l.collected > l.loaded ||
        l.loaded + l.reserved > l.qty ||
        !finite(l.yaw) ||
        !finite(l.massKg) ||
        l.massKg <= 0 ||
        (l.trackHand !== undefined && ![1, -1].includes(l.trackHand)) ||
        l.qty > MATERIALS[l.item].max ||
        l.massKg !== l.qty * (l.item === 'diesel' ? 20 : MATERIALS[l.item].mass) ||
        (l.assetIds !== undefined &&
          (!Array.isArray(l.assetIds) ||
            l.assetIds.length !== l.loaded ||
            l.assetIds.some((id) => id !== null && (typeof id !== 'string' || !id))))
      )
        return 'invalid collection line';
      const inTask = c.task?.lifted && c.task.lineIndex === index ? c.task.qty : 0;
      if (!c.cancelRequested && l.reserved + l.loaded + inTask !== l.qty)
        return 'collection line lost material ownership';
      const source = s.stacks.find((t) => t.id === l.stackId);
      if (l.reserved && (!source || source.item !== l.item || source.reserved < l.reserved))
        return 'collection source reservation missing';
      sourceReserved.set(l.stackId, (sourceReserved.get(l.stackId) || 0) + l.reserved);
      if (l.item === 'diesel' && source && (source.liters || 0) > 0.000001)
        return 'fuel-bearing drum accepted for collection';
      loaded += l.loaded;
      width += MATERIALS[l.item].w;
    }
    if (
      c.automaticEquipment !== undefined &&
      (typeof c.automaticEquipment !== 'string' ||
        !s.equipment.some((e) => e.id === c.automaticEquipment))
    )
      return 'invalid automatic collection owner';
    if (
      c.lines.some(
        (l) =>
          l.sourceSnapshot &&
          (l.sourceSnapshot.id !== l.stackId ||
            l.sourceSnapshot.item !== l.item ||
            !point(l.sourceSnapshot) ||
            !finite(l.sourceSnapshot.w) ||
            !finite(l.sourceSnapshot.d) ||
            l.sourceSnapshot.w <= 0 ||
            l.sourceSnapshot.d <= 0),
      )
    )
      return 'invalid collection source history';
    if (
      width > 6 ||
      (c.kind === 'materials' &&
        (loaded !== o.arrived || c.massKg !== c.lines.reduce((n, l) => n + l.massKg, 0)))
    )
      return 'invalid collection deck or loaded total';
    if (
      c.status === 'done' &&
      (!o.carrierDeparted || c.lines.some((l) => l.loaded !== l.collected || l.reserved))
    )
      return 'collection completed before physical departure';
    if (!['done', 'canceled'].includes(c.status)) {
      const selected = c.equipmentId || c.automaticEquipment;
      if (selected) {
        if (machineOwners.has(selected)) return 'machine reserved by multiple collections';
        machineOwners.add(selected);
      }
    }
    if (c.task) {
      const t = c.task,
        e = s.equipment.find((e) => e.id === t.equipmentId),
        w = s.workers.find((w) => w.id === t.operatorId);
      if (
        !e ||
        !w ||
        e.deliveryOrder !== o.id ||
        w.deliveryOrder !== o.id ||
        (t.helperId && !s.workers.some((w) => w.id === t.helperId && w.deliveryOrder === o.id)) ||
        typeof t.phase !== 'string' ||
        (c.kind === 'materials'
          ? t.phase.startsWith('equipment-') || t.phase === 'ramps'
          : ![
              'boarding',
              'clear-deck',
              'ramps',
              'equipment-approach',
              'equipment-ramp',
              'equipment-unload',
              'equipment-clear',
              'equipment-exit',
            ].includes(t.phase)) ||
        (t.lifted !== undefined && typeof t.lifted !== 'boolean') ||
        (t.rigged !== undefined && typeof t.rigged !== 'boolean') ||
        (t.withdrawalPoint !== undefined && !point(t.withdrawalPoint)) ||
        (t.securingPoint !== undefined && !point(t.securingPoint)) ||
        (t.returnQty !== undefined &&
          (!finite(t.returnQty) || t.returnQty < 0 || t.returnQty > 1)) ||
        (t.originalEquipmentPose !== undefined &&
          (!point(t.originalEquipmentPose) || !finite(t.originalEquipmentPose.yaw))) ||
        (t.operatorRampOrigin !== undefined &&
          (!point(t.operatorRampOrigin) || !finite(t.operatorRampOrigin.y))) ||
        (t.originalSource !== undefined &&
          (!point(t.originalSource) ||
            !finite(t.originalSource.w) ||
            !finite(t.originalSource.d) ||
            t.originalSource.w <= 0 ||
            t.originalSource.d <= 0)) ||
        w.role !== 'operator' ||
        !phases.includes(t.phase) ||
        !finite(t.clock) ||
        t.clock < 0 ||
        !whole(t.qty) ||
        t.qty < 1 ||
        ![t.source, t.sourceDock, t.sourceClear, t.deck, t.deckDock, t.deckClear].every(point) ||
        ![t.source.y, t.source.yaw, t.deck.y, t.deck.yaw, t.sourceYaw, t.deckYaw].every(finite) ||
        (t.helperId && !s.workers.some((w) => w.id === t.helperId && w.role !== 'operator')) ||
        (t.cargo && (!point(t.cargo) || !finite(t.cargo.y) || !finite(t.cargo.yaw))) ||
        (t.lifted &&
          (c.kind !== 'materials' ||
            !e.cargo ||
            e.cargo.item !== c.lines[t.lineIndex!]?.item ||
            e.cargo.qty !== t.qty ||
            !t.cargo))
      )
        return 'invalid physical collection task';
      if (
        c.kind === 'materials' &&
        (!whole(t.lineIndex) || !c.lines[t.lineIndex!] || t.qty > c.lines[t.lineIndex!].qty)
      )
        return 'invalid collection task line';
      for (const wid of [t.operatorId, t.helperId].filter(Boolean) as string[]) {
        if (actors.has(wid)) return 'worker assigned to multiple collections';
        actors.add(wid);
      }
      if (owners.has(e.id)) return 'equipment assigned to multiple active collections';
      owners.add(e.id);
    }
  }
  for (const [id, qty] of sourceReserved)
    if (qty > (s.stacks.find((t) => t.id === id)?.reserved || 0))
      return 'overcommitted collection source';
  for (const o of s.orders as any[])
    if (
      o.collectionId &&
      !(s.collections || []).some((c) => c.id === o.collectionId && c.carrierOrderId === o.id)
    )
      return 'orphaned collection carrier';
}
