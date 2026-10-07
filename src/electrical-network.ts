import type { State } from './types';
import { electricalTerminalCells } from './electrical-geometry';
export const ELECTRICAL_CAPACITY_KW = 16;
export function electricalNetwork(s: State) {
  const sources = s.buildings
    .filter((b) => b.kind === 'power')
    .map((b) => ({
      ...b,
      name: b.name || 'Incoming electrical station',
      kind: b.kind,
      energized: !!s.utilities.power && b.connected,
      capacityKw: ELECTRICAL_CAPACITY_KW,
      demandKw: 0,
      availableKw: ELECTRICAL_CAPACITY_KW,
      terminalCells: electricalTerminalCells(b),
    }));
  const runs = (s.electrical?.runs || []).filter(
    (r) =>
      (r.status === 'commissioned' || (r.recovering && r.status !== 'canceled')) &&
      r.tested &&
      r.sourceTerminated &&
      r.targetTerminated &&
      r.cells.every((c) => c.cableInstalled && c.backfilled === 1),
  );
  function resolve(
    id: string,
    seen = new Set<string>(),
  ): { root?: string; runIds: string[]; reason?: string } {
    if (seen.has(id))
      return { runIds: [], reason: 'Electrical junction cycle; circuit cannot be energized' };
    if (sources.some((q) => q.id === id)) return { root: id, runIds: [] };
    if (!s.buildings.some((b) => b.id === id && ['lamp', 'electricalJunction'].includes(b.kind)))
      return { runIds: [], reason: 'Upstream incoming cabinet or electrical junction is missing' };
    const run = runs.find((r) => r.targetId === id);
    if (!run) return { runIds: [], reason: 'Upstream junction has no commissioned supply' };
    const next = new Set(seen);
    next.add(id);
    const up = resolve(run.sourceId, next);
    return { ...up, runIds: [run.id, ...up.runIds] };
  }
  const consumers = s.buildings
    .filter((b) => ['lamp', 'transferPump', 'electricalJunction'].includes(b.kind))
    .sort(
      (a, b) =>
        (a.kind === 'lamp' ? 0 : 1) - (b.kind === 'lamp' ? 0 : 1) || a.id.localeCompare(b.id),
    )
    .map((b) => {
      const run = runs.find((r) => r.targetId === b.id),
        up = run ? resolve(run.sourceId, new Set([b.id])) : undefined;
      const source = sources.find((q) => q.id === up?.root),
        ratedKw = b.kind === 'electricalJunction' ? 0 : b.kind === 'lamp' ? 0.1 : 2,
        pump = s.process?.pumps.find((p) => p.id === b.id);
      const loadKw =
        b.kind === 'lamp' ? ratedKw : pump?.enabled && pump.hose === 'connected' ? ratedKw : 0;
      const connected = !!source && !!run,
        powered = connected && source!.energized && source!.availableKw + 1e-8 >= loadKw;
      const reason = !run
        ? 'No commissioned underground circuit'
        : up?.reason
          ? up.reason
          : !source
            ? 'Upstream circuit or cabinet is missing'
            : !source.energized
              ? 'Incoming electrical service is not commissioned'
              : !powered
                ? '16 kW incoming capacity exhausted'
                : 'Supplied by commissioned underground circuit';
      if (connected) {
        source!.demandKw += loadKw;
        if (powered) source!.availableKw = Math.max(0, source!.availableKw - loadKw);
      }
      return {
        id: b.id,
        name:
          b.name ||
          (b.kind === 'electricalJunction'
            ? 'Electrical junction cabinet'
            : b.kind === 'lamp'
              ? 'Light pole'
              : 'Transfer pump'),
        kind: b.kind,
        x: b.x,
        z: b.z,
        w: b.w,
        d: b.d,
        connected,
        powered,
        sourceId: run?.sourceId,
        rootSourceId: source?.id,
        runIds: run ? [run.id, ...(up?.runIds || [])] : [],
        loadKw,
        ratedKw,
        reason,
        terminalCells: electricalTerminalCells(b),
      };
    });
  const junctions = consumers
    .filter((c) => c.kind === 'electricalJunction' || (c.kind === 'lamp' && c.connected))
    .map((c) => ({
      ...c,
      capacityKw: ELECTRICAL_CAPACITY_KW,
      availableKw: sources.find((q) => q.id === c.rootSourceId)?.availableKw || 0,
    }));
  return {
    sources,
    junctions,
    consumers,
    runs: (s.electrical?.runs || []).map((r) => ({
      ...r,
      length: r.cells.length,
      installedMeters: r.cells.filter((c) => c.cableInstalled).length,
      commissioned: r.status === 'commissioned',
    })),
  };
}
export function electricalConsumerPower(s: State, id: string) {
  return (
    electricalNetwork(s).consumers.find((c) => c.id === id) || {
      id,
      kind: 'unknown',
      name: id,
      connected: false,
      powered: false,
      sourceId: undefined,
      rootSourceId: undefined,
      runIds: [] as string[],
      loadKw: 0,
      ratedKw: 0,
      reason: 'Electrical load not found',
      terminalCells: [],
    }
  );
}
