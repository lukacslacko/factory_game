import type { State, Point, Rect } from '../src/types';
import { electricalNetwork } from '../src/electrical-network';
import type { ElectricalRun } from '../src/electrical-types';
const key = (p: Point) => `${p.x},${p.z}`;
/** Pure visual projection of surveyed cells and conserved soil/cable state. */
export function electricalRender(s: State) {
  const network = electricalNetwork(s);
  const trenches: (Rect & {
    id: string;
    runId: string;
    depth: number;
    cuts: (Rect & { depth: number })[];
    spoilRect: Rect;
    spoilM3: number;
    cableInstalled: boolean;
    cableSegments: { a: Point; b: Point }[];
  })[] = [];
  const restored: {
    id: string;
    runId: string;
    x: number;
    z: number;
    paved: boolean;
    marker: boolean;
  }[] = [];
  const stagedPaving: (Rect & { id: string; runId: string })[] = [];
  const runs = (s.electrical?.runs || []).map((run) => {
    run.cells.forEach((cell, index) => {
      const depth = 0.6 * Math.max(0, cell.excavation - cell.backfilled);
      if (cell.slabLifted && !cell.slabRestored && !cell.slabCarried && cell.slabRect)
        stagedPaving.push({ ...cell.slabRect, id: `${run.id}/paving/${index}`, runId: run.id });
      const neighbors: Point[] = [run.cells[index - 1], run.cells[index + 1]].filter(
        (c): c is typeof cell => !!c,
      );
      for (const endpointId of [
        index === 0 ? run.sourceId : undefined,
        index === run.cells.length - 1 ? run.targetId : undefined,
      ]) {
        const b = s.buildings.find((b) => b.id === endpointId);
        if (!b) continue;
        neighbors.push(
          cell.x < b.x
            ? { x: cell.x + 1, z: cell.z }
            : cell.x >= b.x + b.w
              ? { x: cell.x - 1, z: cell.z }
              : cell.z < b.z
                ? { x: cell.x, z: cell.z + 1 }
                : { x: cell.x, z: cell.z - 1 },
        );
      }
      const xNeighbors = neighbors.filter((c) => c.z === cell.z).map((c) => c.x - cell.x);
      const zNeighbors = neighbors.filter((c) => c.x === cell.x).map((c) => c.z - cell.z);
      const cuts: (Rect & { depth: number })[] = [];
      if (xNeighbors.length || !zNeighbors.length) {
        const corner = xNeighbors.length === 1 && zNeighbors.length === 1;
        cuts.push({
          x: cell.x + (corner && xNeighbors[0] > 0 ? 0.2 : 0),
          z: cell.z + 0.2,
          w: corner ? 0.8 : 1,
          d: 0.6,
          depth,
        });
      }
      if (zNeighbors.length) {
        if (!xNeighbors.length) cuts.push({ x: cell.x + 0.2, z: cell.z, w: 0.6, d: 1, depth });
        else
          for (const dz of zNeighbors)
            cuts.push({ x: cell.x + 0.2, z: cell.z + (dz < 0 ? 0 : 0.8), w: 0.6, d: 0.2, depth });
      }
      const a = { x: cell.x + 0.5, z: cell.z + 0.5 };
      const cableSegments = [
        ...xNeighbors.map((dx) => ({ a, b: { x: a.x + dx * 0.5, z: a.z } })),
        ...zNeighbors.map((dz) => ({ a, b: { x: a.x, z: a.z + dz * 0.5 } })),
      ];
      if (!cableSegments.length)
        cableSegments.push({ a: { x: a.x - 0.5, z: a.z }, b: { x: a.x + 0.5, z: a.z } });
      if (depth > 0.003)
        trenches.push({
          ...cell,
          w: 1,
          d: 1,
          id: `${run.id}/cell/${index}`,
          runId: run.id,
          depth,
          cuts,
          spoilRect: cell.spoilRect,
          spoilM3: cell.spoilM3,
          cableSegments,
        });
      if (cell.excavation > 0 && depth <= 0.003 && cell.backfilled >= 0.999)
        restored.push({
          id: `${run.id}/restored/${index}`,
          runId: run.id,
          x: cell.x,
          z: cell.z,
          paved: !!s.paving[key(cell)],
          marker:
            cell.cableInstalled &&
            (index === 0 || index === run.cells.length - 1 || index % 8 === 0),
        });
    });
    return {
      length: run.cells.length,
      installedMeters: run.cells.filter((c) => c.cableInstalled).length,
      commissioned: run.status === 'commissioned',
      id: run.id,
      jobId: run.jobId,
      sourceId: run.sourceId,
      targetId: run.targetId,
      status: run.status,
      phase: run.phase,
      reason: run.reason,
      points: run.cells.map((c) => ({ x: c.x + 0.5, z: c.z + 0.5 })),
      cellIndex: run.cellIndex,
      clock: run.clock,
      reelId: run.reelId,
      workerId: run.workerId,
      equipmentId: run.equipmentId,
    };
  });
  return {
    ...network,
    runs,
    trenches,
    stagedPaving,
    cuts: trenches.flatMap((c) => c.cuts),
    restored,
  };
}
/** Actual core work drives the excavator bucket; only accepted clock is animated. */
export function electricalToolPose(
  run: ElectricalRun,
  e: { x: number; z: number; y?: number; yaw?: number; lift?: number; reach?: number },
) {
  const point = run.toolPoint;
  if (
    !point ||
    ![
      'dig',
      'dig-lift',
      'swing-spoil',
      'dump-spoil',
      'dig-return',
      'crew-clear',
      'backfill-pick',
      'backfill-lift',
      'swing-trench',
      'backfill',
      'backfill-return',
      'lift-paving',
      'restore-paving',
    ].includes(run.phase)
  )
    return;
  // The simulation already sweeps/aligns its actual tool, and only advances its
  // accepted clock. Reuse that pose instead of playing an independent animation.
  const progress = (seconds: number) => {
    const t = Math.min(1, Math.max(0, run.clock / seconds));
    return t * t * (3 - 2 * t);
  };
  // Curl only follows accepted simulation time: a blocked operation freezes
  // both the physical soil transfer and its bucket motion. lift is the lowest
  // bucket surface, rather than the hinge (which sits above the teeth).
  const bucketPitch =
    run.phase === 'dig' || run.phase === 'backfill-pick'
      ? 0.1 + 0.45 * progress(3)
      : ['dig-lift', 'backfill-lift', 'swing-spoil', 'swing-trench'].includes(run.phase)
        ? 0.55
        : run.phase === 'dump-spoil'
          ? 0.55 - 1.15 * progress(2)
          : run.phase === 'backfill'
            ? 0.55 - 1.15 * progress(3)
            : ['dig-return', 'backfill-return', 'crew-clear'].includes(run.phase)
              ? -0.6 + 0.7 * progress(2)
              : 0.1;
  return {
    reach: e.reach ?? Math.hypot(point.x - e.x, point.z - e.z),
    lift: e.lift ?? 1.1,
    point,
    bucketPitch,
    bucketBottomReference: !['lift-paving', 'restore-paving'].includes(run.phase),
  };
}
