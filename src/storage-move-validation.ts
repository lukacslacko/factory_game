import type { Job, Stack, State } from './types';
import { MATERIALS } from './catalog';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 200;
const active = (j: Job) => !['done', 'canceled'].includes(j.status);
const rect = (r: Stack | undefined) =>
  !!r &&
  finite(r.x) &&
  finite(r.z) &&
  Math.abs(r.x) < 10000 &&
  Math.abs(r.z) < 10000 &&
  finite(r.w) &&
  finite(r.d) &&
  r.w > 0 &&
  r.d > 0;

/** Validate saved ownership, rather than recomputing routes or changing physical stock. */
export function storageMoveValidationProblem(s: State): string | undefined {
  const jobs = new Map(s.jobs.map((j, index) => [j.id, { j, index }]));
  const stocks = new Map(s.stacks.map((t) => [t.id, t]));
  const queued = new Map<string, number>();
  for (const [index, j] of s.jobs.entries()) {
    const m = j.stockMove;
    if (!m?.toStorage) {
      if (
        m &&
        (m.load !== undefined ||
          m.queuedReservation !== undefined ||
          m.zoneId !== undefined ||
          m.afterJobId !== undefined)
      )
        return 'storage movement metadata on non-storage work';
      continue;
    }
    const material = j.item && MATERIALS[j.item];
    if (
      j.kind !== 'moveStock' ||
      !material ||
      !text(m.sourceId) ||
      !text(m.mergeId) ||
      !text(m.zoneId) ||
      typeof m.queuedReservation !== 'boolean' ||
      !Number.isInteger(j.qty) ||
      j.qty < 1 ||
      j.qty > material.max ||
      (j.item!.startsWith('rail') && j.qty !== 1) ||
      !rect(m.destination as Stack) ||
      !Number.isInteger(m.destination.x) ||
      !Number.isInteger(m.destination.z)
    )
      return 'invalid storage movement material or destination';
    if (active(j)) {
      const zone = s.zones.find((z) => z.id === m.zoneId);
      const d = m.destination;
      if (
        !zone ||
        d.x < zone.x ||
        d.z < zone.z ||
        d.x + d.w > zone.x + zone.w ||
        d.z + d.d > zone.z + zone.d
      )
        return 'active storage movement destination is outside its stockyard';
    }
    if (m.afterJobId !== undefined) {
      const prior = jobs.get(m.afterJobId);
      // A predecessor must already occur in the saved work sequence. This
      // makes cycles impossible and rejects links to unrelated work groups.
      if (
        !text(m.afterJobId) ||
        !prior ||
        prior.index >= index ||
        prior.j.kind !== 'moveStock' ||
        !prior.j.stockMove?.toStorage ||
        !text(j.parentId) ||
        prior.j.parentId !== j.parentId ||
        prior.j.stockMove.sourceId !== m.sourceId
      )
        return 'invalid storage movement predecessor or cycle';
    }
    if (m.load !== undefined) {
      const load = m.load;
      if (
        !load ||
        !rect(load) ||
        load.id !== m.sourceId ||
        load.item !== j.item ||
        load.qty !== j.qty ||
        load.reserved !== 0 ||
        load.w !== m.destination.w ||
        load.d !== m.destination.d ||
        (load.yaw !== undefined && !finite(load.yaw)) ||
        (load.baseHeight !== undefined &&
          (!finite(load.baseHeight) || load.baseHeight < 0 || load.baseHeight > 1)) ||
        load.storageCarriedBy !== undefined ||
        load.electricalCarriedBy !== undefined ||
        (load.cableReservedMeters !== undefined && load.cableReservedMeters !== 0) ||
        (load.cableReservedSpaceMeters !== undefined && load.cableReservedSpaceMeters !== 0)
      )
        return 'invalid storage carried material snapshot';
      if (
        load.item === 'cableReel'
          ? !finite(load.cableMeters) || load.cableMeters < 0 || load.cableMeters > 50
          : load.cableMeters !== undefined
      )
        return 'invalid storage carried cable contents';
      if (
        load.item === 'diesel'
          ? !finite(load.liters) || load.liters < 0 || load.liters > 200
          : load.liters !== undefined
      )
        return 'invalid storage carried diesel contents';
    }
    if (m.queuedReservation) {
      if (!active(j) || m.load || (j.handling && j.handling.state !== 'stored'))
        return 'invalid queued storage material ownership';
      const source = stocks.get(m.sourceId);
      if (!source || source.item !== j.item) return 'queued storage source is missing';
      queued.set(source.id, (queued.get(source.id) || 0) + j.qty);
    }
    if (active(j) && !j.item!.startsWith('rail')) {
      if (j.handling?.state === 'carried') {
        const e = s.equipment.find((e) => e.id === j.equipment && e.job === j.id);
        if (
          !m.load ||
          m.queuedReservation ||
          !e ||
          e.cargo?.item !== j.item ||
          e.cargo?.qty !== j.qty
        )
          return 'storage carried material ownership does not match equipment cargo';
        const source = stocks.get(m.sourceId);
        if (!source || (source.qty === 0 && source.storageCarriedBy !== j.id))
          return 'storage carried source placeholder is missing';
      } else if (!m.queuedReservation && j.handling?.state !== 'placed') {
        return 'storage movement has no queued or physical material ownership';
      }
      if (j.handling?.state === 'placed' && !m.load)
        return 'placed storage material has no conserved contents snapshot';
    }
  }
  for (const [id, qty] of queued) {
    const t = stocks.get(id)!;
    if (qty > t.qty || qty > t.reserved)
      return 'queued storage reservations exceed physical source material';
  }
  for (const t of s.stacks) {
    if (t.storageCarriedBy === undefined) continue;
    const j = jobs.get(t.storageCarriedBy)?.j;
    if (
      !text(t.storageCarriedBy) ||
      t.qty !== 0 ||
      t.reserved !== 0 ||
      !j ||
      !active(j) ||
      j.kind !== 'moveStock' ||
      !j.stockMove?.toStorage ||
      j.stockMove.sourceId !== t.id ||
      j.item?.startsWith('rail') ||
      j.handling?.state !== 'carried' ||
      !j.stockMove.load ||
      !s.equipment.some(
        (e) =>
          e.id === j.equipment &&
          e.job === j.id &&
          e.cargo?.item === t.item &&
          e.cargo.qty === j.qty,
      ) ||
      (t.item === 'cableReel' && t.cableMeters !== 0) ||
      (t.item === 'diesel' && t.liters !== 0)
    )
      return 'orphan storage carried material placeholder';
  }
}
