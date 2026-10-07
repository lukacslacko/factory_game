import type { Building, Point, Rect, State } from './types';
import type { ElectricalCell, ElectricalPreview, ElectricalRequest } from './electrical-types';
import { overlap } from './path';
import { railFootprints } from './track';
export const ELECTRICAL_REEL_METERS = 50;
export const ELECTRICAL_SOIL_PER_CELL = 0.36;
export function electricalTerminalCells(b: Pick<Building, 'x' | 'z' | 'w' | 'd'>): Point[] {
  const cells: Point[] = [];
  for (let x = b.x; x < b.x + b.w; x++) cells.push({ x, z: b.z - 1 }, { x, z: b.z + b.d });
  for (let z = b.z; z < b.z + b.d; z++) cells.push({ x: b.x - 1, z }, { x: b.x + b.w, z });
  return cells;
}
const rect = (p: Point, id: string) => ({ ...p, w: 1, d: 1, id });
export function electricalObstacles(s: State): (Rect & { id: string })[] {
  const out: (Rect & { id: string })[] = [];
  for (const run of s.electrical?.runs || [])
    for (const [i, c] of run.cells.entries()) {
      if (c.excavation - c.backfilled > 1e-6) out.push(rect(c, `${run.id}/trench/${i}`));
      if (c.spoilM3 > 1e-6) out.push({ ...c.spoilRect, id: `${run.id}/spoil/${i}` });
      if (c.slabLifted && !c.slabCarried && !c.slabRestored && c.slabRect)
        out.push({ ...c.slabRect, id: `${run.id}/slab/${i}` });
    }
  return out;
}
export function electricalPlannedRects(s: State): (Rect & { id: string })[] {
  return (s.electrical?.runs || [])
    .filter((r) => !['commissioned', 'canceled'].includes(r.status))
    .flatMap((r) => [
      ...r.cells.flatMap((c, i) => [
        rect(c, `${r.id}/trench/${i}`),
        { ...c.spoilRect, id: `${r.id}/spoil/${i}` },
        ...(c.slabRect ? [{ ...c.slabRect, id: `${r.id}/slab/${i}` }] : []),
      ]),
      ...(r.reelStage ? [{ ...r.reelStage, id: `${r.id}/reel-stage` }] : []),
    ]);
}
export function electricalRootedSource(s: State, id: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  const b = s.buildings.find((b) => b.id === id);
  if (!b) return false;
  if (b.kind === 'power') return true;
  if (b.kind !== 'lamp') return false;
  const r = (s.electrical?.runs || []).find(
    (r) =>
      r.targetId === id &&
      r.status === 'commissioned' &&
      r.tested &&
      r.sourceTerminated &&
      r.targetTerminated &&
      r.cells.every((c) => c.cableInstalled && c.backfilled === 1),
  );
  const next = new Set(seen);
  next.add(id);
  return !!r && electricalRootedSource(s, r.sourceId, next);
}
export function electricalPreview(s: State, request: ElectricalRequest): ElectricalPreview {
  const source = s.buildings.find((b) => b.id === request?.sourceId),
    target = s.buildings.find((b) => b.id === request?.targetId);
  const terminals = {
    source: source ? electricalTerminalCells(source) : [],
    target: target ? electricalTerminalCells(target) : [],
  };
  const base = {
    sourceId: request?.sourceId || '',
    targetId: request?.targetId || '',
    terminals,
    cells: [] as ElectricalCell[],
    meters: 0,
  };
  const bad = (error: string) => ({ ...base, valid: false, error });
  if (!source || !['power', 'lamp'].includes(source.kind))
    return bad('Choose an installed 16 kW incoming cabinet or commissioned lamp junction.');
  if (source.kind === 'lamp' && !electricalRootedSource(s, source.id))
    return bad('The source lamp junction needs a commissioned incoming circuit first.');
  if (!target || !['lamp', 'transferPump'].includes(target.kind))
    return bad('Choose an installed light or transfer pump.');
  if (source.id === target.id) return bad('A circuit cannot feed its own source.');
  if (
    (s.electrical?.runs || []).some(
      (r) =>
        r.targetId === target.id &&
        (r.status !== 'canceled' || r.cells.some((c) => c.cableInstalled)),
    )
  )
    return bad('This load already has a circuit; inspect or resume its existing work.');
  if (!Array.isArray(request.cells) || !request.cells.length || request.cells.length > 300)
    return bad('A direct circuit needs 1–300 meter cells.');
  const seen = new Set<string>();
  for (const [i, p] of request.cells.entries()) {
    if (
      !p ||
      !Number.isInteger(p.x) ||
      !Number.isInteger(p.z) ||
      p.x < -12 ||
      p.x > 220 ||
      p.z < 7 ||
      p.z > 110
    )
      return bad('Cable trenches follow whole-meter cells inside the site.');
    const key = `${p.x},${p.z}`;
    if (seen.has(key)) return bad('A direct circuit cannot revisit a cell.');
    seen.add(key);
    if (i && Math.abs(p.x - request.cells[i - 1].x) + Math.abs(p.z - request.cells[i - 1].z) !== 1)
      return bad(
        'Adjacent cable cells must share an edge; diagonal proximity does not connect them.',
      );
  }
  const first = request.cells[0],
    last = request.cells.at(-1)!;
  if (
    !terminals.source.some((p) => p.x === first.x && p.z === first.z) ||
    !terminals.target.some((p) => p.x === last.x && p.z === last.z)
  )
    return bad(
      'The first and last trench cells must touch the selected cabinet and load boundaries.',
    );
  const occupied: Rect[] = [
    ...s.buildings,
    ...s.stacks.filter((t) => t.qty > 0),
    ...railFootprints(s),
    ...electricalPlannedRects(s),
    ...(s.electrical?.runs || []).flatMap((r) =>
      r.cells.filter((c) => c.cableInstalled).map((c) => ({ ...c, w: 1, d: 1 })),
    ),
  ];
  for (const p of request.cells)
    if (occupied.some((r) => overlap({ ...p, w: 1, d: 1 }, r)))
      return bad(
        `Trench cell ${p.x},${p.z} intersects a building, stock, track, or another direct circuit. Shared ducts and crossings are not supported yet.`,
      );
  const used: Rect[] = [];
  for (const p of request.cells) {
    const square = { ...p, w: 1, d: 1 };
    const candidates = [
      { x: p.x - 1, z: p.z },
      { x: p.x + 1, z: p.z },
      { x: p.x, z: p.z - 1 },
      { x: p.x, z: p.z + 1 },
    ];
    let spoil: Rect | undefined, slab: Rect | undefined;
    const paving = s.paving[`${p.x},${p.z}`];
    for (const q of candidates) {
      const dx = q.x - p.x,
        dz = q.z - p.z;
      const a = {
          x: q.x + Math.min(0, dx),
          z: q.z + Math.min(0, dz),
          w: dx ? 2 : 1,
          d: dz ? 2 : 1,
        },
        b = { x: p.x + dx * 3, z: p.z + dz * 3, w: 1, d: 1 };
      const free = (r: Rect) =>
        r.x >= -12 &&
        r.x <= 220 &&
        r.z >= 7 &&
        r.z <= 110 &&
        !request.cells.some((k) => overlap(r, { ...k, w: 1, d: 1 })) &&
        ![...occupied, ...used].some((k) => overlap(r, k));
      if (free(a) && (!paving || free(b))) {
        spoil = a;
        if (paving) slab = b;
        break;
      }
    }
    if (!spoil)
      return bad(
        `Cell ${p.x},${p.z} needs a free neighboring 2 × 1 m spoil strip${paving ? ' and another square for its lifted paving slab' : ''}.`,
      );
    used.push(spoil, ...(slab ? [slab] : []));
    base.cells.push({
      ...square,
      excavation: 0,
      backfilled: 0,
      soilRemovedM3: 0,
      spoilM3: 0,
      spoilRect: spoil,
      ...(slab ? { slabRect: slab } : {}),
      ...(paving ? { originalPaving: paving } : {}),
      cableInstalled: false,
    });
  }
  return { ...base, valid: true, meters: request.cells.length };
}
export function electricalPlanProblem(s: State, request: ElectricalRequest) {
  return electricalPreview(s, request).error;
}
