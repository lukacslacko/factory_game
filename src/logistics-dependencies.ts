import { jobEquipmentAssignment } from './jobs';
import type { Equipment, Job, Point, State, Worker } from './types';

export type DependencyKind =
  | 'recovery-prerequisite' | 'storage-predecessor' | 'action-clearance'
  | 'traffic' | 'assigned-equipment' | 'rail-route' | 'rail-pickup' | 'owns-resource';
export type DependencyEntity =
  | 'job' | 'equipment' | 'worker' | 'stock' | 'building' | 'delivery' | 'unknown';
export type DependencyMobility =
  | 'temporary' | 'physical-relocation' | 'player-action' | 'fixed' | 'unknown';
export type DependencyClass =
  | 'cycle' | 'fixed' | 'player-action' | 'physical-relocation' | 'temporary' | 'unresolved';

export interface DependencyEdge {
  from: string;
  to: string;
  kind: DependencyKind;
  /** The machine or person reporting a traffic obstruction, when different from the work. */
  via?: string;
  since?: number;
  point?: Point;
  entity: DependencyEntity;
  mobility: DependencyMobility;
}
export interface DependencyDiagnosis {
  id: string;
  classification: DependencyClass;
  reason: string;
  waitSeconds: number;
  blockerIds: string[];
  cycle?: string[];
  edges: DependencyEdge[];
}
export interface DependencyReport {
  diagnoses: DependencyDiagnosis[];
  inspected: { jobs: number; clearances: number; actors: number; edges: number };
  truncated: boolean;
}

// Run on explicit inspection or the slow, officer-only coordination cadence,
// never on the movement or 200 ms native snapshot path. Limits keep an
// imported huge yard from monopolizing the service during either review.
const MAX_JOBS = 512;
const MAX_CLEARANCES = 256;
const MAX_ACTORS = 2048;
const MAX_STOCK = 4096;
const MAX_EDGES = 768;
const MAX_ROOTS = 256;
const MAX_DEPTH = 12;
const MAX_VISITS = 96;
const active = (j: Job) => j.status === 'todo' || j.status === 'doing';
// `reason` is also used for routine progress (walking, carrying, rigging).
// Only explanations that explicitly describe a wait enter the blocked-work
// view without a typed dependency edge.
const waitReason = (reason: string) =>
  /^(?:waiting\b|need\b|needs\b|no\b|clear\b|blocked\b|cannot\b|unable\b|reserved\b.*\bunavailable\b|out of fuel\b)/i
    .test(reason.trim()) ||
  /\b(?:blocked|cannot|needs|unavailable|waiting)\b/i
    .test(reason);

/** Read-only, bounded wait-for snapshot. An edge says what a task is waiting
 * on; it does not certify that moving the blocker is safe or dispatch work. */
export function diagnoseLogisticsDependencies(s: State): DependencyReport {
  const jobs = s.jobs.filter(active).slice(-MAX_JOBS);
  const clearances = (s.actionClearances || []).slice(-MAX_CLEARANCES);
  const equipment = s.equipment.slice(-MAX_ACTORS);
  const workers = s.workers.slice(-MAX_ACTORS);
  const stocks = s.stacks.slice(-MAX_STOCK);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const equipmentById = new Map(equipment.map((e) => [e.id, e]));
  const workerById = new Map(workers.map((w) => [w.id, w]));
  const stockIds = new Set(stocks.map((t) => t.id));
  const buildingIds = new Set(s.buildings.slice(-MAX_STOCK).map((b) => b.id));
  const deliveryIds = new Set(s.orders.slice(-MAX_STOCK).map((o) => o.id));
  const edges: DependencyEdge[] = [];
  const adjacency = new Map<string, DependencyEdge[]>();
  const roots = new Set<string>();
  let truncated = s.jobs.filter(active).length > MAX_JOBS ||
    (s.actionClearances?.length || 0) > MAX_CLEARANCES ||
    s.equipment.length > MAX_ACTORS || s.workers.length > MAX_ACTORS ||
    s.stacks.length > MAX_STOCK || s.buildings.length > MAX_STOCK ||
    s.orders.length > MAX_STOCK;
  const entity = (id: string): DependencyEntity =>
    jobById.has(id) ? 'job' : equipmentById.has(id) ? 'equipment' :
      workerById.has(id) ? 'worker' : stockIds.has(id) ? 'stock' :
        buildingIds.has(id) ? 'building' : deliveryIds.has(id) ? 'delivery' : 'unknown';
  const mobility = (id: string): DependencyMobility => {
    const kind = entity(id);
    if (kind === 'job' || kind === 'delivery') return 'temporary';
    if (kind === 'stock') return 'physical-relocation';
    if (kind === 'building') return 'fixed';
    const w = workerById.get(id);
    if (w) return w.duty === 'auto' && !['home', 'aboard'].includes(w.shiftPhase || '')
      ? 'temporary' : 'player-action';
    const e = equipmentById.get(id);
    if (e) {
      const op = workers.find((q) => q.id === e.operator);
      return e.fuel <= 0 || op?.duty === 'manual' || op?.duty === 'rest'
        ? 'player-action' : 'temporary';
    }
    return 'unknown';
  };
  const add = (from: string, to: string, kind: DependencyKind,
    via?: string, since?: number, point?: Point) => {
    if (!from || !to || from === to) return;
    const prior = adjacency.get(from) || [];
    if (prior.some((e) => e.to === to && e.kind === kind && e.via === via)) return;
    if (edges.length >= MAX_EDGES) { truncated = true; return; }
    const edge: DependencyEdge = {
      from, to, kind, via, since, point: point && { ...point },
      entity: entity(to), mobility: mobility(to),
    };
    edges.push(edge);
    prior.push(edge);
    adjacency.set(from, prior);
  };
  const workOwner = (id: string) =>
    jobById.has(id) ? id : equipmentById.get(id)?.job &&
      jobById.has(equipmentById.get(id)!.job!)
      ? equipmentById.get(id)!.job! :
      workerById.get(id)?.job && jobById.has(workerById.get(id)!.job!)
        ? workerById.get(id)!.job! : id;

  for (const j of jobs) {
    const recovery = j.railPickupRecovery;
    if (recovery?.activeJobId && jobById.has(recovery.activeJobId))
      add(j.id, recovery.activeJobId, 'recovery-prerequisite');
    for (const blocker of recovery?.blockerIds || [])
      if (stockIds.has(blocker)) add(j.id, blocker, 'rail-pickup');
    const predecessor = j.stockMove?.afterJobId;
    if (predecessor && jobById.has(predecessor))
      add(j.id, predecessor, 'storage-predecessor');
    const railBlocker = j.railWork?.routeBlockage?.blocker;
    if (railBlocker && entity(railBlocker) !== 'unknown')
      add(j.id, railBlocker, 'rail-route', j.equipment, j.railWork?.routeBlockage?.since);
    if (j.reason.startsWith('Waiting for assigned ')) {
      const requested = jobEquipmentAssignment(s, j).equipmentId;
      if (requested && equipmentById.has(requested))
        add(j.id, requested, 'assigned-equipment');
    }
    if (waitReason(j.reason) ||
      (recovery?.activeJobId && jobById.has(recovery.activeJobId)) ||
      (predecessor && jobById.has(predecessor)) ||
      (railBlocker && entity(railBlocker) !== 'unknown')) roots.add(j.id);
  }
  for (const r of clearances) {
    const owner = workOwner(r.ownerId);
    roots.add(owner);
    for (const blocker of r.blockerIds.slice(0, 24))
      add(owner, blocker, 'action-clearance', r.requesterEquipmentId,
        r.since, r.point);
    if (r.blockerIds.length > 24) truncated = true;
  }
  const actorBlock = (actor: Equipment | Worker) => {
    if (!actor.blockedBy) return;
    const owner = workOwner(actor.id);
    roots.add(owner);
    add(owner, actor.blockedBy, 'traffic', actor.id, actor.trafficBlockedSince);
  };
  for (const e of equipment) actorBlock(e);
  for (const w of workers) actorBlock(w);
  // A blocked machine or person is controlled by its active work. This reverse
  // ownership edge lets the graph recognize A → B → A without inventing a
  // spurious A → its own machine → A cycle.
  const referenced = new Set(edges.map((e) => e.to));
  for (const id of referenced) {
    const owner = equipmentById.get(id)?.job || workerById.get(id)?.job;
    if (owner && jobById.has(owner)) add(id, owner, 'owns-resource');
  }

  const cycleFrom = (start: string) => {
    const seen = new Set<string>();
    const chain: string[] = [];
    const inChain = new Map<string, number>();
    let visits = 0;
    const visit = (id: string, depth: number): string[] | undefined => {
      if (depth > MAX_DEPTH || ++visits > MAX_VISITS) { truncated = true; return; }
      const at = inChain.get(id);
      if (at !== undefined) return [...chain.slice(at), id];
      if (seen.has(id)) return;
      seen.add(id);
      inChain.set(id, chain.length);
      chain.push(id);
      for (const edge of adjacency.get(id) || []) {
        const cycle = visit(edge.to, depth + 1);
        if (cycle) return cycle;
      }
      chain.pop();
      inChain.delete(id);
    };
    return visit(start, 0);
  };
  const reachableMobilities = (start: string) => {
    const queue = [start], seen = new Set<string>([start]);
    const found: DependencyMobility[] = [];
    for (let at = 0; at < queue.length; at++) {
      if (at >= MAX_VISITS) { truncated = true; break; }
      for (const edge of adjacency.get(queue[at]) || []) {
        found.push(edge.mobility);
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          if (queue.length < MAX_VISITS) queue.push(edge.to);
          else truncated = true;
        }
      }
    }
    return found;
  };
  const diagnoses: DependencyDiagnosis[] = [];
  // A busy yard can have more than MAX_ROOTS waiting rows. Keep the rows with
  // checked dependency edges before reason-only rows, so actionable blocker
  // links are not crowded out by generic resource waits.
  const orderedRoots = [...roots].sort((a, b) =>
    Number((adjacency.get(b)?.length || 0) > 0) -
    Number((adjacency.get(a)?.length || 0) > 0));
  for (const root of orderedRoots) {
    if (diagnoses.length >= MAX_ROOTS) { truncated = true; break; }
    const outgoing = adjacency.get(root) || [];
    if (outgoing.length > 24) truncated = true;
    const cycle = cycleFrom(root);
    const mobilities = reachableMobilities(root);
    const classification: DependencyClass = cycle ? 'cycle' :
      mobilities.includes('fixed') ? 'fixed' :
        mobilities.includes('player-action') ? 'player-action' :
          mobilities.includes('physical-relocation') ? 'physical-relocation' :
            mobilities.includes('temporary') ? 'temporary' : 'unresolved';
    const j = jobById.get(root);
    const clearance = clearances.find((r) => workOwner(r.ownerId) === root);
    const actor = equipmentById.get(root) || workerById.get(root);
    const since = [j?.logisticsWaitSince, j?.railWork?.routeBlockage?.since,
      clearance?.since, actor?.trafficBlockedSince].filter((n): n is number => n !== undefined);
    diagnoses.push({
      id: root,
      classification,
      reason: clearance?.reason || clearance?.action || j?.reason ||
        actor?.blockedBy && `Traffic blocked by ${actor.blockedBy}` || 'Waiting for work to progress',
      waitSeconds: since.length ? Math.max(0, s.elapsed - Math.min(...since)) : 0,
      blockerIds: [...new Set(outgoing.map((e) => e.to))],
      ...(cycle ? { cycle } : {}),
      edges: outgoing.slice(0, 24),
    });
  }
  diagnoses.sort((a, b) =>
    b.waitSeconds - a.waitSeconds || a.id.localeCompare(b.id));
  return {
    diagnoses, truncated,
    inspected: { jobs: jobs.length, clearances: clearances.length,
      actors: equipment.length + workers.length, edges: edges.length },
  };
}
