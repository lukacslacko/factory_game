import type { State } from './types';
import {
  ELECTRICAL_REEL_METERS,
  ELECTRICAL_SOIL_PER_CELL,
  electricalTerminalCells,
} from './electrical-geometry';
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (p: any) =>
  p && number(p.x) && number(p.z) && Math.abs(p.x) < 10000 && Math.abs(p.z) < 10000;
const rect = (p: any) => point(p) && number(p.w) && number(p.d) && p.w > 0 && p.d > 0;
const phases = [
  'isolate-source',
  'isolate-target',
  'return-cable',
  'recover-cable',
  'reserve',
  'board',
  'reel-source',
  'reel-rig',
  'reel-lift',
  'reel-withdraw',
  'reel-carry',
  'reel-lower',
  'reel-clear',
  'approach',
  'lift-paving',
  'dig',
  'dig-lift',
  'swing-spoil',
  'dump-spoil',
  'dig-return',
  'crew-clear',
  'collect-cable',
  'lay',
  'pull-cable',
  'backfill-approach',
  'backfill-pick',
  'backfill-lift',
  'swing-trench',
  'backfill',
  'backfill-return',
  'restore-paving',
  'terminate-source',
  'terminate-target',
  'test',
  'complete',
  'canceled',
];
export function electricalValidationProblem(s: State): string | undefined {
  for (const t of s.stacks) {
    if (
      t.item !== 'cableReel' &&
      (t.cableMeters !== undefined ||
        t.cableReservedMeters !== undefined ||
        t.cableReservedSpaceMeters !== undefined ||
        t.electricalCarriedBy !== undefined)
    )
      return 'cable quantities on a non-reel stock';
    if (
      t.item === 'cableReel' &&
      ((t.cableMeters !== undefined &&
        (!number(t.cableMeters) || t.cableMeters < 0 || t.cableMeters > ELECTRICAL_REEL_METERS)) ||
        (t.cableReservedMeters !== undefined &&
          (!number(t.cableReservedMeters) ||
            t.cableReservedMeters < 0 ||
            t.cableReservedMeters > (t.cableMeters ?? ELECTRICAL_REEL_METERS))) ||
        (t.cableReservedSpaceMeters !== undefined &&
          (!number(t.cableReservedSpaceMeters) ||
            t.cableReservedSpaceMeters < 0 ||
            t.cableReservedSpaceMeters >
              ELECTRICAL_REEL_METERS - (t.cableMeters ?? ELECTRICAL_REEL_METERS))) ||
        (t.electricalCarriedBy !== undefined &&
          (typeof t.electricalCarriedBy !== 'string' || t.qty !== 0)))
    )
      return 'invalid physical cable reel';
  }
  const data = s.electrical;
  if (data === undefined) return;
  if (
    !data ||
    !Array.isArray(data.runs) ||
    data.runs.length > 20000 ||
    !Array.isArray(data.meterLedger) ||
    data.meterLedger.length > 1000000
  )
    return 'invalid electrical records';
  const ids = new Set<string>(),
    reserved = new Map<string, number>(),
    space = new Map<string, number>(),
    reelOwners = new Map<string, string>(),
    actors = new Set<string>();
  for (const r of data.runs) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !r.id ||
      r.id.length > 100 ||
      typeof r.jobId !== 'string' ||
      typeof r.sourceId !== 'string' ||
      typeof r.targetId !== 'string' ||
      ids.has(r.id) ||
      !['planned', 'working', 'commissioned', 'canceling', 'canceled'].includes(r.status) ||
      !phases.includes(r.phase) ||
      !number(r.clock) ||
      r.clock < 0 ||
      !number(r.created) ||
      r.created > s.time ||
      !Number.isInteger(r.cellIndex) ||
      r.cellIndex < 0 ||
      !Array.isArray(r.cells) ||
      !r.cells.length ||
      r.cells.length > 300 ||
      r.cellIndex > r.cells.length ||
      typeof r.reason !== 'string' ||
      r.reason.length > 2000 ||
      !number(r.cableInHand) ||
      r.cableInHand < 0 ||
      r.cableInHand > 1 ||
      !number(r.soilInBucketM3) ||
      r.soilInBucketM3 < 0 ||
      r.soilInBucketM3 > 0.120001
    )
      return 'invalid electrical run';
    for (const key of ['recovering', 'creative', 'cancelRequested', 'warned'] as const)
      if (r[key] !== undefined && typeof r[key] !== 'boolean')
        return 'invalid electrical control flag';
    for (const value of [r.retryAt, r.blockedSince, r.finished])
      if (value !== undefined && (!number(value) || value < 0)) return 'invalid electrical timing';
    if (r.workStage !== undefined && !['excavate', 'lay', 'restore'].includes(r.workStage))
      return 'invalid electrical construction stage';
    ids.add(r.id);
    const j = s.jobs.find((j) => j.id === r.jobId);
    if (
      r.opening !== undefined &&
      (r.opening !== true || !r.creative || r.status !== 'commissioned' || r.jobId !== 'opening')
    )
      return 'invalid opening electrical assets';
    if (
      !r.opening &&
      (!j ||
        j.kind !== 'cableRun' ||
        j.electricalRunId !== r.id ||
        j.target !== r.targetId ||
        j.qty !== 0 ||
        j.item)
    )
      return 'electrical work ownership mismatch';
    const source = s.buildings.find(
        (b) => b.id === r.sourceId && ['power', 'lamp', 'electricalJunction'].includes(b.kind),
      ),
      target = s.buildings.find(
        (b) =>
          b.id === r.targetId && ['lamp', 'transferPump', 'electricalJunction'].includes(b.kind),
      );
    const historical = r.status === 'canceled' && !r.cells.some((c) => c.cableInstalled);
    if ((!source || !target) && !historical) return 'electrical circuit endpoint missing';
    if (
      (r.sourceRect !== undefined && !rect(r.sourceRect)) ||
      (r.targetRect !== undefined && !rect(r.targetRect))
    )
      return 'invalid electrical endpoint history';
    if ((!source && !rect(r.sourceRect)) || (!target && !rect(r.targetRect)))
      return 'electrical endpoint history missing';
    const keys = new Set<string>();
    for (const [i, c] of r.cells.entries()) {
      if (
        !point(c) ||
        !Number.isInteger(c.x) ||
        !Number.isInteger(c.z) ||
        keys.has(`${c.x},${c.z}`) ||
        !rect(c.spoilRect) ||
        (c.slabRect !== undefined && !rect(c.slabRect)) ||
        ![c.excavation, c.backfilled, c.soilRemovedM3, c.spoilM3].every(number) ||
        c.excavation < 0 ||
        c.excavation > 1.000001 ||
        c.backfilled < 0 ||
        c.backfilled > c.excavation + 1e-7 ||
        c.spoilM3 < -1e-7 ||
        typeof c.cableInstalled !== 'boolean'
      )
        return 'invalid cable trench cell';
      keys.add(`${c.x},${c.z}`);
      if (i && Math.abs(c.x - r.cells[i - 1].x) + Math.abs(c.z - r.cells[i - 1].z) !== 1)
        return 'noncontiguous electrical route';
      if (
        Math.abs(c.soilRemovedM3 - ELECTRICAL_SOIL_PER_CELL * c.excavation) > 1e-7 ||
        Math.abs(
          c.soilRemovedM3 -
            c.spoilM3 -
            c.backfilled * ELECTRICAL_SOIL_PER_CELL -
            (i === r.cellIndex ? r.soilInBucketM3 : 0),
        ) > 1e-7
      )
        return 'electrical trench soil is not conserved';
      if (
        (c.slabCarried && !c.slabLifted) ||
        (c.slabLifted && !c.originalPaving) ||
        (c.slabRestored && !c.originalPaving)
      )
        return 'invalid lifted electrical paving';
    }
    if (
      !electricalTerminalCells(source || r.sourceRect!).some(
        (p) => p.x === r.cells[0].x && p.z === r.cells[0].z,
      ) ||
      !electricalTerminalCells(target || r.targetRect!).some(
        (p) => p.x === r.cells.at(-1)!.x && p.z === r.cells.at(-1)!.z,
      )
    )
      return 'electrical route is not joined to its endpoint terminals';
    if (
      !Array.isArray(r.reservations) ||
      !Array.isArray(r.stagedReels) ||
      r.reservations.length > 300 ||
      r.stagedReels.some((q) => typeof q !== 'string') ||
      [r.sourceTerminated, r.targetTerminated, r.tested].some((q) => typeof q !== 'boolean')
    )
      return 'invalid electrical material ownership';
    for (const q of r.reservations) {
      if (
        !q ||
        typeof q.stackId !== 'string' ||
        !number(q.meters) ||
        q.meters < 0 ||
        !Number.isInteger(q.meters)
      )
        return 'invalid cable reservation';
      if (q.meters) {
        const t = s.stacks.find((t) => t.id === q.stackId);
        if (!t || t.item !== 'cableReel') return 'reserved cable reel missing';
        const map = r.recovering ? space : reserved;
        map.set(t.id, (map.get(t.id) || 0) + q.meters);
      }
    }
    if (
      r.status === 'commissioned' &&
      (!r.tested ||
        !r.sourceTerminated ||
        !r.targetTerminated ||
        r.cells.some((c) => !c.cableInstalled || c.backfilled < 1 - 1e-7) ||
        r.soilInBucketM3 ||
        r.cableInHand ||
        (!r.opening && j?.status !== 'done'))
    )
      return 'electrical circuit commissioned before physical completion';
    if (
      r.status === 'canceled' &&
      (r.cells.some(
        (c) =>
          c.spoilM3 > 1e-7 ||
          c.excavation - c.backfilled > 1e-7 ||
          (c.slabLifted && !c.slabRestored),
      ) ||
        r.soilInBucketM3 ||
        r.cableInHand ||
        j?.status !== 'canceled')
    )
      return 'electrical cancellation discarded physical work';
    for (const p of [r.reelStage, r.reelOrigin])
      if (p !== undefined && !rect(p)) return 'invalid electrical reel pose';
    for (const p of [r.reelDock, r.reelClear, r.dock, r.workPoint, r.toolPoint])
      if (p !== undefined && !point(p)) return 'invalid electrical work pose';
    if (r.pavingStep !== undefined && !['carry', 'lower'].includes(r.pavingStep))
      return 'invalid paving handling phase';
    if (!['commissioned', 'canceled'].includes(r.status)) {
      for (const id of new Set([
        ...r.reservations.filter((q) => q.meters > 0).map((q) => q.stackId),
        ...(r.reelId ? [r.reelId] : []),
      ])) {
        if (reelOwners.has(id) && reelOwners.get(id) !== r.id)
          return 'physical cable reel assigned to multiple circuits';
        reelOwners.set(id, r.id);
      }
    }
    if (j?.status === 'doing') {
      const e = s.equipment.find((e) => e.id === r.equipmentId),
        op = s.workers.find((w) => w.id === r.operatorId),
        w = s.workers.find((w) => w.id === r.workerId);
      if (
        !e ||
        e.kind !== 'excavator' ||
        !op ||
        op.role !== 'operator' ||
        !w ||
        w.role !== 'engineer' ||
        j.equipment !== e.id ||
        j.operator !== op.id ||
        j.worker !== w.id ||
        e.job !== j.id ||
        op.job !== j.id ||
        (w.job !== j.id &&
          !s.jobs.some(
            (q) =>
              q.kind === 'refuel' &&
              q.status === 'doing' &&
              q.worker === w.id &&
              q.resumeJob === j.id,
          ))
      )
        return 'invalid electrical crew assignment';
      for (const actor of [e.id, op.id, w.id]) {
        if (actors.has(actor)) return 'electrical actor assigned twice';
        actors.add(actor);
      }
      if (
        r.reelId !== undefined &&
        !s.stacks.some((t) => t.id === r.reelId && t.item === 'cableReel')
      )
        return 'active electrical reel is missing';
      const carrying =
        r.phase === 'reel-lift' ||
        r.phase === 'reel-withdraw' ||
        r.phase === 'reel-carry' ||
        r.phase === 'reel-lower';
      const reel = s.stacks.find((t) => t.id === r.reelId);
      if (
        carrying &&
        (!reel ||
          reel.qty !== 0 ||
          reel.electricalCarriedBy !== j.id ||
          e.cargo?.item !== 'cableReel' ||
          e.cargo.qty !== 1)
      )
        return 'electrical lifted reel ownership mismatch';
      if (!carrying && reel?.electricalCarriedBy === j.id)
        return 'electrical reel is carried outside its handling phase';
      if (
        r.cells.some((c) => c.slabCarried) &&
        (e.cargo?.item !== 'slab' ||
          e.cargo.qty !== 1 ||
          !['lift-paving', 'restore-paving'].includes(r.phase))
      )
        return 'electrical lifted paving ownership mismatch';
      if (r.phase !== 'board' && (op.vehicle !== e.id || e.operator !== op.id))
        return 'electrical excavator has no seated operator';
    }
  }
  for (const t of s.stacks.filter((t) => t.item === 'cableReel')) {
    if (
      Math.abs((t.cableReservedMeters || 0) - (reserved.get(t.id) || 0)) > 1e-7 ||
      Math.abs((t.cableReservedSpaceMeters || 0) - (space.get(t.id) || 0)) > 1e-7
    )
      return 'electrical reel reservation mismatch';
  }
  for (const t of s.stacks)
    if (
      t.electricalCarriedBy &&
      !data.runs.some(
        (r) =>
          r.jobId === t.electricalCarriedBy &&
          r.reelId === t.id &&
          ['reel-lift', 'reel-withdraw', 'reel-carry', 'reel-lower'].includes(r.phase),
      )
    )
      return 'orphaned lifted cable reel';
  const wireBalance = new Map(data.runs.map((r) => [r.id, r.creative ? r.cells.length : 0]));
  const byRun = new Map(data.runs.map((r) => [r.id, r]));
  const ledgerIds = new Set<string>();
  for (const row of data.meterLedger) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      ledgerIds.has(row.id) ||
      !ids.has(row.runId) ||
      !number(row.time) ||
      row.time > s.time ||
      !number(row.meters) ||
      row.meters <= 0 ||
      typeof row.from !== 'string' ||
      typeof row.to !== 'string' ||
      typeof row.reason !== 'string'
    )
      return 'invalid cable meter ledger';
    ledgerIds.add(row.id);
    const r = byRun.get(row.runId)!;
    const owned = (id: string) => id === r.jobId + '/HAND' || id.startsWith(r.id + '/cell/');
    wireBalance.set(
      r.id,
      wireBalance.get(r.id)! +
        (owned(row.to) ? row.meters : 0) -
        (owned(row.from) ? row.meters : 0),
    );
  }
  for (const r of data.runs) {
    const net = wireBalance.get(r.id)!;
    if (Math.abs(net - r.cableInHand - r.cells.filter((c) => c.cableInstalled).length) > 1e-7)
      return 'electrical cable meters are not conserved';
  }
  for (const j of s.jobs)
    if (
      j.kind === 'cableRun' &&
      !data.runs.some((r) => r.id === j.electricalRunId && r.jobId === j.id)
    )
      return 'orphaned electrical work';
}
