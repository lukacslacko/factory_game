import { storageDestinationReserved } from './storage-locks';
import { angleDelta, localPoint } from './motion';
import type { Equipment, Item, Job, Rect, Stack, State, Worker } from './types';
import { EQUIPMENT, MATERIALS, label, stockUnitMass } from './catalog';
import { center, dist, overlap } from './path';
import { collectionOwnsStack } from './collection';
import { railStagingStackOwned } from './railwork';
import { constructionStorageClearance, createRailStorageAccessCheck } from './delivery';
import { electricalPlannedRects } from './electrical-geometry';
import { planRailPickup } from './rail-pickup';
import {
  equipmentMoveBlocked,
  staticObstacleRects,
  machineRoute,
  storageMoveStockHeight,
  walkRoute,
} from './traffic';

export interface StorageMoveRequest {
  id: string;
  zoneId?: string;
  quantity?: number;
}
export interface StorageMovePreview {
  error: string;
  quantity: number;
  mass: number;
  zoneId?: string;
  destination?: Rect;
  /** A queued order without crew is a space request, not a checked route. */
  readiness?: string;
}
export interface StorageMovePlan extends StorageMovePreview {
  placements?: { destination: Rect; quantity: number; mergeId?: string }[];
}
export { stockUnitMass } from './catalog';
export function storageMoveSourceError(s: State, t: Stack | undefined): string {
  if (!t || t.qty < 1) return 'Select physical material remaining on site.';
  if (
    t.reserved ||
    t.cableReservedMeters ||
    t.cableReservedSpaceMeters ||
    t.electricalCarriedBy ||
    t.storageCarriedBy ||
    collectionOwnsStack(s, t.id) ||
    storageDestinationReserved(s, t.id) ||
    railStagingStackOwned(s, t.id) ||
    s.electrical?.runs.some(
      (r) =>
        !['commissioned', 'canceled'].includes(r.status) &&
        (r.reelId === t.id || r.reservations.some((q) => q.stackId === t.id)),
    ) ||
    s.shunters?.some((e) => e.refueling?.barrelId === t.id) ||
    s.orders.some((o) => o.unload?.mergeId === t.id && o.unload.phase !== 'back-away') ||
    s.jobs.some(
      (j) =>
        !['done', 'canceled'].includes(j.status) &&
        (j.stack === t.id ||
          j.stockMove?.sourceId === t.id ||
          j.recoveryStack?.id === t.id ||
          j.handling?.placedStack === t.id),
    )
  )
    return `${t.id} is reserved by active work. Finish or cancel that work before moving it.`;
  return '';
}
/** Static cardinal lifting face: temporary automatic occupants can yield later.
 * The executing handler checks the real route and swept load again. */
function faces(s: State, t: Stack, r: Rect, kind: Equipment['kind'], excludeId?: string) {
  const virtual: Equipment = {
    id: 'storage-survey',
    kind,
    x: 0,
    z: 0,
    yaw: 0,
    heading: 0,
    path: [],
    fuel: 1,
    tank: 80,
    used: 0,
    work: 0,
    lift: storageMoveStockHeight(t.item, t.qty) + 0.4,
  };
  const survey = {
    ...s,
    workers: [],
    equipment: [],
    orders: [],
    stacks: s.stacks.filter((q) => q.id !== excludeId),
  };
  const target = center(r),
    reach = Math.max(kind === 'forklift' ? 3 : 4, Math.max(r.w, r.d) / 2 + 2.5);
  return [0, Math.PI / 2, Math.PI, -Math.PI / 2]
    .map((yaw) => ({
      x: target.x - Math.cos(yaw) * reach,
      z: target.z - Math.sin(yaw) * reach,
      yaw,
      reach,
    }))
    .filter(
      (p) =>
        !equipmentMoveBlocked(
          survey,
          {
            ...virtual,
            reach,
            cargo: {
              item: t.item,
              qty: 1,
              yaw: t.yaw || 0,
              storageMove: !t.item.startsWith('rail'),
            },
          },
          p,
        ),
    );
}
interface HandlingSource {
  machine: Equipment;
  crew: Worker;
  operatorId?: string;
  clear: { x: number; z: number; yaw: number };
}
interface StorageReach {
  machineId: string;
  crewId: string;
  operatorId?: string;
  withdrawal: { x: number; z: number; yaw: number };
  settle: { x: number; z: number };
}

/** Preflight the source with real equipment and a real support worker. A
 * static exposed edge alone does not mean that either can get there. */
function handlingSources(s: State, t: Stack, qty: number): HandlingSource[] {
  const obstacles = staticObstacleRects(s);
  const sourceAfterLift = {
    ...s,
    stacks: s.stacks.map((q) => q.id === t.id ? { ...q, qty: q.qty - qty } : q),
  };
  const afterObstacles = t.qty === qty
    ? obstacles.filter((r) => (r as Rect & { id?: string }).id !== t.id)
    : obstacles;
  const candidates: HandlingSource[] = [];
  const machines = s.equipment.slice()
    .sort((a, b) => dist(a, center(t)) - dist(b, center(t)))
    .slice(0, 8);
  for (const machine of machines) {
    if (!['forklift', 'excavator'].includes(machine.kind) ||
        EQUIPMENT[machine.kind].capacity < stockUnitMass(t) * qty ||
        machine.job || machine.path.length || machine.cargo || machine.fuel <= 0 ||
        machine.transportOrder || machine.deliveryOrder || machine.refueling) continue;
    if (machine.operator && s.workers.some((w) =>
      w.id === machine.operator && w.duty !== 'auto')) continue;
    const cab = localPoint({ ...machine,
      yaw: machine.yaw ?? (machine.heading * Math.PI) / 2 }, -0.2, 1.85);
    const operator = s.workers.find((w) =>
      w.role === 'operator' && w.duty === 'auto' && !w.job &&
      !w.deliveryOrder && !w.transportOrder && !w.transition &&
      (!w.vehicle || w.vehicle === machine.id) &&
      (!machine.operator || machine.operator === w.id) &&
      (w.vehicle === machine.id || !!walkRoute(s, w, cab, obstacles)));
    if (!operator) continue;
    const crews = s.workers.filter((w) =>
      w.role !== 'operator' && w.duty === 'auto' && !w.vehicle && !w.transition &&
      !w.job && !w.deliveryOrder && !w.transportOrder &&
      (!w.assistingEquipment || w.assistingEquipment === machine.id))
      .sort((a, b) => dist(a, center(t)) - dist(b, center(t)))
      .slice(0, 4);
    for (const crew of crews) {
      if (t.item.startsWith('rail')) {
        const pickup = planRailPickup(s, machine, crew, t, qty, obstacles);
        if (pickup.source) candidates.push({
          machine, crew, operatorId: operator.id,
          clear: { ...pickup.source.clear,
            yaw: Math.atan2(pickup.source.pose.z - pickup.source.dock.z,
              pickup.source.pose.x - pickup.source.dock.x) },
        });
        continue;
      }
      const reach = Math.max(machine.kind === 'forklift' ? 3 : 4, Math.max(t.w, t.d) / 2 + 2.5);
      for (const face of faces(s, t, t, machine.kind)) {
        const approach = {
          x: face.x - Math.cos(face.yaw) * (machine.kind === 'forklift' ? 1.1 : 0),
          z: face.z - Math.sin(face.yaw) * (machine.kind === 'forklift' ? 1.1 : 0),
          yaw: face.yaw,
        };
        const route = machineRoute(s, machine, approach, obstacles, 350, true, face.yaw);
        if (!route) continue;
        const parked = { ...machine, ...face, reach };
        const canRig = [1.5, 2, 2.5, 3].some((radius) =>
          [0, Math.PI / 2, Math.PI, -Math.PI / 2].some((angle) => {
            const point = {
              x: center(t).x + Math.cos(angle) * (Math.max(t.w, t.d) / 2 + radius),
              z: center(t).z + Math.sin(angle) * (Math.max(t.w, t.d) / 2 + radius),
            };
            return !!walkRoute({ ...s, equipment: s.equipment.map((e) =>
              e.id === machine.id ? parked : e) }, crew, point, obstacles);
          }));
        if (!canRig) continue;
        const clear = {
          x: face.x - Math.cos(face.yaw) * 1.4,
          z: face.z - Math.sin(face.yaw) * 1.4,
          yaw: face.yaw,
        };
        const loaded = {
          ...parked,
          cargo: { item: t.item, qty, yaw: t.yaw || 0, storageMove: true },
          lift: storageMoveStockHeight(t.item, t.qty) + 0.4,
        };
        if (!machineRoute(sourceAfterLift, { ...loaded, reverse: true }, clear,
          afterObstacles, 250, true, face.yaw)) continue;
        candidates.push({ machine, crew, operatorId: operator.id, clear });
        break;
      }
    }
  }
  return candidates;
}

function reachableStorage(
  s: State,
  t: Stack,
  r: Rect,
  sources: HandlingSource[],
  qty: number,
  excludeId?: string,
  projected: readonly Stack[] = [],
) {
  const survey = {
    ...s,
    stacks: [
      ...s.stacks.map((q) => q.id === t.id ? { ...q, qty: q.qty - qty } : q),
      ...projected,
    ],
  };
  const obstacles = staticObstacleRects(survey);
  for (const source of sources) {
    const { machine, clear } = source;
    if (EQUIPMENT[machine.kind].capacity < stockUnitMass(t) * qty) continue;
    const targets = faces(s, t, r, machine.kind, excludeId);
    for (const target of targets) {
      if (machine.kind === 'forklift' && Math.abs(Math.sin(clear.yaw - target.yaw)) > 0.01)
        continue;
      const probe: Equipment = {
        ...machine,
        ...clear,
        reach: Math.max(machine.kind === 'forklift' ? 3 : 4, Math.max(t.w, t.d) / 2 + 2.5),
        lift: Math.max(storageMoveStockHeight(t.item, t.qty),
          storageMoveStockHeight(t.item, s.stacks.find((q) => q.id === excludeId)?.qty || 0)) + 0.4,
        cargo: { item: t.item, qty, yaw: t.yaw || 0, storageMove: !t.item.startsWith('rail') },
      };
      if (equipmentMoveBlocked(survey, probe, clear)) continue;
      if (!machineRoute(survey, probe, target, obstacles, 300, true, target.yaw)) continue;
      const landed = {
        ...survey,
        stacks: excludeId
          ? survey.stacks.map((q) => q.id === excludeId ? { ...q, qty: q.qty + qty } : q)
          : [...survey.stacks, { ...r, id: 'storage-preview-landing',
              item: t.item, qty, reserved: 0, source: 'preview' } as Stack],
      };
      const parked = { ...machine, ...target, reach: 2.7, cargo: undefined };
      const withdrawal = {
        x: target.x - Math.cos(target.yaw) * 1.4,
        z: target.z - Math.sin(target.yaw) * 1.4,
      };
      if (!machineRoute(landed, parked, withdrawal,
        staticObstacleRects(landed), 150, true, target.yaw)) continue;
      const destCenter = center(r);
      const settle = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
        .map((angle) => ({
          x: destCenter.x + Math.cos(angle) * (Math.max(r.w, r.d) / 2 + 1),
          z: destCenter.z + Math.sin(angle) * (Math.max(r.w, r.d) / 2 + 1),
        }))
        .find((point) => !!walkRoute({ ...landed,
          equipment: landed.equipment.map((e) => e.id === machine.id ? parked : e) },
          source.crew, point, staticObstacleRects(landed)));
      if (settle) return {
        machineId: machine.id,
        crewId: source.crew.id,
        operatorId: source.operatorId,
        withdrawal: { ...withdrawal, yaw: target.yaw },
        settle,
      } satisfies StorageReach;
    }
  }
  return null;
}

const MAX_VERIFIED_LIFTS = 32;
/** Replay the proposed lifts against their own resulting stock and crew poses.
 * Candidate enumeration stays cheap; only a complete plan receives this bounded
 * physical survey. Beyond the bound, the quote remains explicitly unverified. */
function verifyLiftSequence(
  s: State,
  source: Stack,
  placements: NonNullable<StorageMovePlan['placements']>,
): { blocked?: string; unverified?: boolean } {
  const projected: State = {
    ...s,
    stacks: s.stacks.map((t) => ({ ...t })),
    equipment: s.equipment.map((e) => ({ ...e })),
    workers: s.workers.map((w) => ({ ...w })),
  };
  const created = new Map<string, string>();
  let lift = 0;
  for (const placement of placements) {
    if (++lift > MAX_VERIFIED_LIFTS) return { unverified: true };
    const from = projected.stacks.find((t) => t.id === source.id)!;
    const key = JSON.stringify(placement.destination);
    const targetId = placement.mergeId || created.get(key);
    const target = targetId ? projected.stacks.find((t) => t.id === targetId) : undefined;
    if (from.qty < placement.quantity ||
        (target?.qty || 0) + placement.quantity > MATERIALS[source.item].max)
      return { blocked: `Lift ${lift} exceeds the remaining source or finite destination stack capacity.` };
    const sources = handlingSources(projected, from, placement.quantity);
    if (!sources.length)
      return { blocked: `Lift ${lift} has no complete pickup and loaded withdrawal from ${source.id} after the earlier placements.` };
    const reach = reachableStorage(projected, from, placement.destination,
      sources, placement.quantity, targetId);
    if (!reach)
      return { blocked: `Lift ${lift} cannot reach, set down, or withdraw from its storage landing after the earlier placements.` };
    from.qty -= placement.quantity;
    if (target) target.qty += placement.quantity;
    else {
      const id = `storage-preview-${lift}`;
      created.set(key, id);
      projected.stacks.push({ ...placement.destination, id, item: source.item,
        yaw: source.yaw, trackHand: source.trackHand, qty: placement.quantity,
        reserved: 0, source: 'preview' });
    }
    const machine = projected.equipment.find((e) => e.id === reach.machineId)!;
    Object.assign(machine, reach.withdrawal, { path: [], cargo: undefined,
      operator: reach.operatorId });
    const crew = projected.workers.find((w) => w.id === reach.crewId)!;
    Object.assign(crew, reach.settle, { path: [] });
    const operator = projected.workers.find((w) => w.id === reach.operatorId);
    if (operator) Object.assign(operator, reach.withdrawal, { path: [], vehicle: machine.id });
  }
  return {};
}
/** Read-only finite-space allocation; submission recomputes it atomically. */
export function planStorageMove(s: State, request: StorageMoveRequest): StorageMovePlan {
  const source = s.stacks.find((t) => t.id === request.id),
    quantity = request.quantity ?? source?.qty ?? 0;
  const bad = (error: string): StorageMovePlan => ({
    error,
    quantity,
    mass: source ? stockUnitMass(source) * quantity : 0,
  });
  const error = storageMoveSourceError(s, source);
  if (error) return bad(error);
  const t = source!,
    m = MATERIALS[t.item];
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > t.qty)
    return bad(`Choose a whole quantity from 1 to ${t.qty}.`);
  const zones = s.zones
    .filter((z) => !request.zoneId || z.id === request.zoneId)
    .sort(
      (a, b) => dist(center(a), center(t)) - dist(center(b), center(t)) || a.id.localeCompare(b.id),
    );
  if (!zones.length)
    return bad(
      request.zoneId ? 'The selected stockyard no longer exists.' : 'Designate a stockyard first.',
    );
  const kinds = (['forklift', 'excavator'] as const).filter(
    (kind) => EQUIPMENT[kind].capacity >= stockUnitMass(t),
  );
  const owned = s.equipment.filter((e) => kinds.includes(e.kind));
  const ready = owned.filter((e) => !e.job && !e.path.length && !e.cargo &&
    !e.deliveryOrder && !e.transportOrder && !e.refueling && e.fuel > 0);
  const capacityPool = ready.length ? ready : owned;
  const capacity = capacityPool.length
    ? Math.max(...capacityPool.map((e) => EQUIPMENT[e.kind].capacity)) : 6000;
  const batch = t.item.startsWith('rail')
    ? 1
    : Math.max(1, Math.min(m.max, Math.floor(capacity / stockUnitMass(t))));
  const sources = handlingSources(s, t, Math.min(batch, quantity));
  const availableMachine = ready.some((e) =>
    EQUIPMENT[e.kind].capacity >= stockUnitMass(t) * Math.min(batch, quantity));
  const availableSupport = s.workers.some((w) => w.role !== 'operator' &&
    w.duty === 'auto' && !w.job && !w.vehicle && !w.deliveryOrder &&
    !w.transportOrder && !w.transition);
  const availableOperator = s.workers.some((w) => w.role === 'operator' &&
    w.duty === 'auto' && !w.job && !w.deliveryOrder && !w.transportOrder &&
    !w.transition);
  const surveyLimited = s.equipment.length > 8 ||
    s.workers.filter((w) => w.role !== 'operator' && w.duty === 'auto').length > 4;
  const unverified = !availableMachine || !availableSupport || !availableOperator ||
    (!sources.length && surveyLimited);
  if (!sources.length && !unverified) {
    const blockers = new Set<string>();
    if (t.item.startsWith('rail')) {
      const obstacles = staticObstacleRects(s);
      for (const machine of owned.slice(0, 4))
        for (const crew of s.workers.filter((w) => w.role !== 'operator' &&
          w.duty === 'auto' && !w.job).slice(0, 4))
          for (const id of planRailPickup(s, machine, crew, t,
            Math.min(batch, quantity), obstacles).blockers) blockers.add(id);
    }
    return bad(`${t.id} has no complete pickup plan for an available machine and support worker${blockers.size ? `; blocked by ${[...blockers].slice(0, 8).join(', ')}` : ''}. Check its exposed edge, approach, rigging access, and loaded withdrawal; clear nearby stock or assign a crew.`);
  }
  if (!sources.length) {
    // Preserve the ability to queue work before hiring. This is explicitly
    // marked unverified; it never certifies that a future machine can lift it.
    const kind = kinds.find((k) =>
      EQUIPMENT[k].capacity >= stockUnitMass(t) * Math.min(batch, quantity) &&
      faces(s, t, t, k).length);
    if (!kind) return bad(`${t.id} has no exposed lifting face. Clear its approach before moving it.`);
    const face = faces(s, t, t, kind)[0];
    sources.push({
      machine: {
        id: 'storage-survey', kind, ...face, heading: 0, path: [], fuel: 1,
        tank: 80, used: 0, work: 0,
      },
      crew: { id: 'storage-survey-crew', name: 'Unassigned', role: 'builder',
        duty: 'auto', status: 'Unassigned', x: face.x, z: face.z, heading: 0,
        path: [], wage: 0, hours: 0 } as Worker,
      clear: { x: face.x - Math.cos(face.yaw) * 1.4,
        z: face.z - Math.sin(face.yaw) * 1.4, yaw: face.yaw },
    });
  }
  const occupied = [
    ...staticObstacleRects(s),
    ...constructionStorageClearance(s),
    ...electricalPlannedRects(s),
    ...s.jobs
      .filter((j) => !['done', 'canceled'].includes(j.status) && j.kind !== 'cableRun')
      .map((j) => j.stockMove?.destination || j),
    ...s.orders.flatMap((o) =>
      o.unload ? [o.unload.destination] : o.allocated ? [o.allocated] : [],
    ),
  ];
  let lastSequenceBlocker = '';
  for (const zone of zones) {
    const placements: NonNullable<StorageMovePlan['placements']> = [];
    const projected: Stack[] = [];
    let access = createRailStorageAccessCheck(s);
    let remaining = quantity;
    // Merge only ordinary, unreserved like stock. Reels and drums keep their own contents and identity.
    const merges = s.stacks.filter(
      (q) =>
        q.id !== t.id &&
        q.item === t.item &&
        q.qty > 0 &&
        q.qty < m.max &&
        !storageMoveSourceError(s, q) &&
        !['diesel', 'cableReel'].includes(t.item) &&
        q.w === t.w &&
        q.d === t.d &&
        Math.abs(angleDelta(q.yaw || 0, t.yaw || 0)) < 0.01 &&
        (q.trackHand ?? 1) === (t.trackHand ?? 1) &&
        q.x >= zone.x &&
        q.z >= zone.z &&
        q.x + q.w <= zone.x + zone.w &&
        q.z + q.d <= zone.z + zone.d,
    );
    for (const q of merges) {
      if (!reachableStorage(s, t, q, sources, Math.min(batch, remaining, m.max - q.qty), q.id,
        projected))
        continue;
      let space = m.max - q.qty;
      while (remaining && space) {
        const qty = Math.min(batch, remaining, space);
        placements.push({
          destination: { x: q.x, z: q.z, w: q.w, d: q.d },
          quantity: qty,
          mergeId: q.id,
        });
        remaining -= qty;
        space -= qty;
      }
    }
    const candidates: Rect[] = [];
    for (let z = zone.z; z + t.d <= zone.z + zone.d; z++)
      for (let x = zone.x; x + t.w <= zone.x + zone.w; x++) {
        const r = { x, z, w: t.w, d: t.d };
        if (
          !occupied.some((q) => overlap(q, r, 0.12)) &&
          !placements.some((q) => overlap(q.destination, r))
        )
          candidates.push(r);
      }
    candidates.sort(
      (a, b) => dist(center(a), center(t)) - dist(center(b), center(t)) || a.z - b.z || a.x - b.x,
    );
    for (const r of candidates) {
      if (!remaining) break;
      if (
        placements.some((q) => overlap(q.destination, r, 0.12)) ||
        !access(t.item, r, t.yaw) ||
        !reachableStorage(s, t, r, sources, Math.min(batch, remaining, m.max), undefined,
          projected)
      )
        continue;
      let space = m.max;
      while (remaining && space) {
        const qty = Math.min(batch, remaining, space);
        placements.push({ destination: r, quantity: qty });
        remaining -= qty;
        space -= qty;
      }
      projected.push({ ...r, id: `storage-preview-${projected.length}`, item: t.item,
        yaw: t.yaw, qty: m.max - space, reserved: 0, source: 'preview' });
      access = createRailStorageAccessCheck(s, projected);
    }
    if (!remaining) {
      const sequence = unverified ? { unverified: true } : verifyLiftSequence(s, t, placements);
      if (sequence.blocked) {
        lastSequenceBlocker = sequence.blocked;
        continue;
      }
      return {
        error: '',
        quantity,
        mass: stockUnitMass(t) * quantity,
        zoneId: zone.id,
        destination: placements[0].destination,
        placements,
        readiness: unverified
          ? 'Route not verified yet: crew may be unavailable or outside the bounded nearby survey.'
          : sequence.unverified
            ? `Route not verified yet: the preview checks at most ${MAX_VERIFIED_LIFTS} sequential lifts; later lifts are checked during execution.`
          : 'Pickup, crew access, loaded route, setdown, and empty withdrawal checked with site crew.',
      };
    }
  }
  if (lastSequenceBlocker) return bad(lastSequenceBlocker);
  return bad(
    request.zoneId
      ? 'The selected stockyard has insufficient clear, accessible storage space.'
      : 'No stockyard has enough clear, accessible space for this move.',
  );
}
export interface StorageMoveAPI {
  id(s: State, type: string): string;
  createGroup(s: State, label: string, rect: Rect): { id: string };
  createJob(
    s: State,
    kind: Job['kind'],
    rect: Rect,
    rotation: number,
    target: string,
    parent: string,
  ): Job;
  event(s: State, type: string, id: string, text: string): void;
}
export function requestStorageMove(s: State, request: StorageMoveRequest, api: StorageMoveAPI) {
  const plan = planStorageMove(s, request);
  if (plan.error) return { error: plan.error };
  const source = s.stacks.find((t) => t.id === request.id)!;
  const zone = s.zones.find((z) => z.id === plan.zoneId)!;
  const group = api.createGroup(
    s,
    `Move ${plan.quantity} × ${label(source.item)} to ${zone.name}`,
    plan.destination!,
  );
  const destinations = new Map<string, string>();
  let preceding: string | undefined;
  const jobs = plan.placements!.map((p) => {
    const key = JSON.stringify(p.destination);
    const targetId =
      p.mergeId ||
      destinations.get(key) ||
      (plan.placements!.length === 1 &&
      plan.quantity === source.qty &&
      !source.item.startsWith('rail')
        ? source.id
        : api.id(s, 'stack'));
    destinations.set(key, targetId);
    const j = api.createJob(
      s,
      'moveStock',
      p.destination,
      Math.abs(Math.sin(source.yaw || 0)) > 0.5 ? 1 : 0,
      source.id,
      group.id,
    );
    j.item = source.item;
    j.qty = p.quantity;
    j.railStageOnly = source.item.startsWith('rail') || undefined;
    j.stockMove = {
      sourceId: source.id,
      destination: { ...p.destination },
      yaw: source.yaw || 0,
      mergeId: targetId,
      toStorage: true,
      zoneId: zone.id,
      queuedReservation: true,
      afterJobId: preceding,
    };
    preceding = j.id;
    return j;
  });
  source.reserved += plan.quantity;
  api.event(
    s,
    'Planning',
    group.id,
    `Move ${plan.quantity} × ${label(source.item)} from ${source.id} to ${zone.name} (${zone.id}); ${plan.mass.toFixed(1)} kg, physical equipment and crew required.`,
  );
  s.revision++;
  return { error: '', job: jobs[0], groupId: group.id, jobIds: jobs.map((j) => j.id) };
}
