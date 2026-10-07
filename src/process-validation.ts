import type { State } from './types';
import { isRailCommodity } from './rail-commodities';
import {
  processLineCapacity,
  processBalance,
  processPumpHosePoints,
  processCarStationary,
} from './process-fluids';
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
/** Fluid totals are independent of the bounded display ledger and survive save/reload. */
export function processValidationProblem(s: State): string | undefined {
  const p = s.process;
  if (p === undefined) return;
  if (
    !p ||
    !['tanks', 'lines', 'pumps', 'valves', 'operations', 'sources', 'ledger'].every((k) =>
      Array.isArray((p as any)[k]),
    )
  )
    return 'Malformed process state.';
  if (
    [p.tanks, p.lines, p.pumps, p.valves, p.operations, p.sources, p.ledger].some((rows) =>
      rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)),
    )
  )
    return 'Malformed process record.';
  if (
    p.ledger.length > 50000 ||
    p.operations.length > 5000 ||
    p.tanks.length > 20000 ||
    p.lines.length > 50000 ||
    p.pumps.length > 20000 ||
    p.valves.length > 50000 ||
    p.sources.length > 20000
  )
    return 'Process state exceeds its bounded record limits.';
  const unique = (xs: { id: string }[]) =>
    xs.every((q) => typeof q.id === 'string' && q.id.length > 0) &&
    new Set(xs.map((q) => q.id)).size === xs.length;
  if (![p.tanks, p.lines, p.pumps, p.valves, p.operations, p.ledger].every(unique))
    return 'Duplicate or invalid process record IDs.';
  const buildings = new Map(s.buildings.map((b) => [b.id, b])),
    b = (id: string) => buildings.get(id);
  const lineKinds = ['processPipe', 'pipeElbow', 'pipeTee', 'processValve', 'processGauge'];
  for (const t of [...p.tanks, ...p.lines]) {
    if (
      !b(t.id) ||
      !finite(t.liters) ||
      t.liters < 0 ||
      !finite(t.capacity) ||
      t.capacity <= 0 ||
      t.liters > t.capacity + 1e-6 ||
      (t.product !== undefined && !isRailCommodity(t.product)) ||
      (t.liters > 1e-8 && !t.product)
    )
      return 'Invalid process vessel contents.';
    if (
      p.tanks.includes(t as any)
        ? b(t.id)!.kind !== 'processTank' || t.capacity !== 30000
        : !lineKinds.includes(b(t.id)!.kind) ||
          !near(t.capacity, processLineCapacity(b(t.id)!.kind))
    )
      return 'Process vessel capacity or installed asset mismatch.';
  }
  for (const l of p.lines) if (!finite(l.flow) || l.flow < 0) return 'Invalid measured pipe flow.';
  const car = (id: string) => {
    for (const o of s.orders) {
      const c = o.railFreight?.cars.find((c) => c.id === id);
      if (c) return { o, c };
    }
  };
  const active = p.operations.filter((o) => o.finished === undefined);
  for (const pump of p.pumps) {
    if (
      b(pump.id)?.kind !== 'transferPump' ||
      typeof pump.enabled !== 'boolean' ||
      !finite(pump.rate) ||
      pump.rate < 0.1 ||
      pump.rate > 5 ||
      !finite(pump.flow) ||
      pump.flow < 0 ||
      !finite(pump.transferred) ||
      pump.transferred < 0 ||
      typeof pump.status !== 'string' ||
      !['disconnected', 'connecting', 'connected', 'disconnecting'].includes(pump.hose)
    )
      return 'Invalid process pump.';
    if (pump.tankId && !p.tanks.some((t) => t.id === pump.tankId))
      return 'Unknown process destination tank.';
    if (
      pump.operation &&
      !active.some((o) => o.id === pump.operation && o.buildingId === pump.id && o.kind !== 'valve')
    )
      return 'Orphan hose operation.';
    if (pump.hose === 'disconnected' && (pump.carId || pump.operation || pump.enabled))
      return 'Disconnected pump has an active source or operation.';
    if (pump.hose !== 'disconnected') {
      const q = pump.carId && car(pump.carId);
      if (
        !q ||
        !q.c.tank ||
        q.c.returned ||
        q.o.status !== 'unloading' ||
        !processCarStationary(s, q.c.id)
      )
        return 'Hose is attached to an unavailable tanker.';
      const points = processPumpHosePoints(s, pump.id);
      if (
        points.length !== 4 ||
        Math.hypot(points[0].x - points[3].x, points[0].z - points[3].z) > 8.000001
      )
        return 'Tanker hose exceeds its physical reach.';
      if (p.pumps.some((v) => v !== pump && v.carId === pump.carId && v.hose !== 'disconnected'))
        return 'Tanker discharge fitting is double connected.';
      if (['connecting', 'disconnecting'].includes(pump.hose) && !pump.operation)
        return 'Hose transition has no physical operation.';
      if (
        pump.hose === 'connected' &&
        (pump.operation || !p.sources.some((q) => q.carId === pump.carId))
      )
        return 'Connected hose has an unfinished operation or missing source accounting.';
      if (
        pump.operation &&
        !active.some(
          (o) =>
            o.id === pump.operation &&
            o.carId === pump.carId &&
            o.kind === (pump.hose === 'connecting' ? 'connect' : 'disconnect'),
        )
      )
        return 'Hose operation does not match its physical connection.';
    }
  }
  for (const v of p.valves)
    if (
      b(v.id)?.kind !== 'processValve' ||
      typeof v.open !== 'boolean' ||
      (v.operation &&
        !active.some((o) => o.id === v.operation && o.kind === 'valve' && o.buildingId === v.id))
    )
      return 'Invalid valve or valve operation.';
  for (const o of p.operations) {
    const w = s.workers.find((w) => w.id === o.workerId);
    if (
      !w ||
      !['builder', 'engineer'].includes(w.role) ||
      !['connect', 'disconnect', 'valve'].includes(o.kind) ||
      !finite(o.started) ||
      !finite(o.clock) ||
      o.clock < 0 ||
      !Number.isInteger(o.phase) ||
      o.phase < 0 ||
      o.phase > 3 ||
      typeof o.status !== 'string' ||
      (o.finished !== undefined && (!finite(o.finished) || o.finished < o.started))
    )
      return 'Invalid process ground work.';
    if (
      o.finished === undefined &&
      (!b(o.buildingId) ||
        w.processAssignment !== o.id ||
        w.vehicle ||
        w.job ||
        w.railAssignment ||
        w.deliveryOrder ||
        w.transportOrder)
    )
      return 'Process worker is not exclusively reserved for physical ground work.';
    if (
      o.finished === undefined &&
      (o.kind === 'valve'
        ? !p.valves.some((v) => v.id === o.buildingId && v.operation === o.id)
        : !p.pumps.some((v) => v.id === o.buildingId && v.operation === o.id))
    )
      return 'Unclaimed physical process operation.';
    if (
      (o.kind === 'valve' && (typeof o.open !== 'boolean' || o.phase > 1)) ||
      (o.kind === 'disconnect' && o.phase > 2) ||
      (o.lastPoint !== undefined && (!finite(o.lastPoint.x) || !finite(o.lastPoint.z))) ||
      (o.lastProgress !== undefined && !finite(o.lastProgress))
    )
      return 'Valve operation has no requested position.';
    if (o.kind !== 'valve' && !car(o.carId || '')?.c.tank)
      return 'Hose operation refers to an unknown tanker.';
  }
  for (const w of s.workers)
    if (
      w.processAssignment &&
      !active.some((o) => o.id === w.processAssignment && o.workerId === w.id)
    )
      return 'Worker has an orphan process assignment.';
  if (new Set(p.sources.map((v) => v.carId)).size !== p.sources.length)
    return 'Duplicate process source baseline.';
  for (const source of p.sources) {
    const q = car(source.carId);
    if (
      !q?.c.tank ||
      source.product !== q.c.tank.product ||
      !finite(source.initialLiters) ||
      source.initialLiters < 0 ||
      !finite(source.initialArrived) ||
      source.initialArrived < 0 ||
      !near(source.initialLiters + source.initialArrived, q.c.manifest[0].qty)
    )
      return 'Invalid process liquid source baseline.';
  }
  for (const row of p.ledger)
    if (
      !finite(row.liters) ||
      row.liters <= 0 ||
      !finite(row.time) ||
      !finite(row.updated) ||
      row.updated < row.time ||
      !isRailCommodity(row.product) ||
      typeof row.from !== 'string' ||
      typeof row.to !== 'string' ||
      typeof row.runId !== 'string'
    )
      return 'Invalid process transfer ledger.';
  for (const row of processBalance(s))
    if (Math.abs(row.difference) > Math.max(1e-5, row.initial * 1e-10))
      return `Unbalanced ${row.product} process inventory.`;
  return undefined;
}
export const validateProcess = processValidationProblem;
