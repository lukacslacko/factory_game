import { storageDestinationReserved } from './storage-locks';
import { angleDelta } from './motion';
import type { Equipment, Item, Job, Rect, Stack, State } from './types';
import { EQUIPMENT, MATERIALS, label, stockUnitMass } from './catalog';
import { center, dist, overlap } from './path';
import { collectionOwnsStack } from './collection';
import { railStagingStackOwned } from './railwork';
import { constructionStorageClearance, createRailStorageAccessCheck } from './delivery';
import { electricalPlannedRects } from './electrical-geometry';
import {
  equipmentMoveBlocked,
  staticObstacleRects,
  machineRoute,
  storageMoveStockHeight,
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
function reachableStorage(
  s: State,
  t: Stack,
  r: Rect,
  kinds: Equipment['kind'][],
  qty: number,
  excludeId?: string,
) {
  const survey = { ...s, workers: [], equipment: [], orders: [] };
  const obstacles = staticObstacleRects(survey);
  for (const kind of kinds.filter((k) => EQUIPMENT[k].capacity >= stockUnitMass(t) * qty)) {
    const sources = faces(s, t, t, kind),
      targets = faces(s, t, r, kind, excludeId);
    for (const from of sources)
      for (const target of targets) {
        if (kind === 'forklift' && Math.abs(Math.sin(from.yaw - target.yaw)) > 0.01) continue;
        const probe: Equipment = {
          id: 'storage-survey',
          kind,
          ...from,
          heading: 0,
          path: [],
          fuel: 1,
          tank: 80,
          used: 0,
          work: 0,
          lift:
            Math.max(
              storageMoveStockHeight(t.item, t.qty),
              storageMoveStockHeight(t.item, s.stacks.find((q) => q.id === excludeId)?.qty || 0),
            ) + 0.4,
          cargo: { item: t.item, qty, yaw: t.yaw || 0, storageMove: !t.item.startsWith('rail') },
        };
        const clear = {
          x: from.x - Math.cos(from.yaw) * 1.4,
          z: from.z - Math.sin(from.yaw) * 1.4,
          yaw: from.yaw,
        };
        if (equipmentMoveBlocked(survey, probe, clear)) continue;
        if (machineRoute(survey, { ...probe, ...clear }, target, obstacles, 300, true, target.yaw))
          return true;
      }
  }
  return false;
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
  if (!kinds.some((kind) => faces(s, t, t, kind).length))
    return bad(`${t.id} has no exposed lifting face. Clear its approach before moving it.`);
  const owned = s.equipment.filter((e) => kinds.includes(e.kind));
  const capacity = owned.length ? Math.max(...owned.map((e) => EQUIPMENT[e.kind].capacity)) : 6000;
  const batch = t.item.startsWith('rail')
    ? 1
    : Math.max(1, Math.min(m.max, Math.floor(capacity / stockUnitMass(t))));
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
  const access = createRailStorageAccessCheck(s);
  for (const zone of zones) {
    const placements: NonNullable<StorageMovePlan['placements']> = [];
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
      if (!reachableStorage(s, t, q, kinds, Math.min(batch, remaining, m.max - q.qty), q.id))
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
        !reachableStorage(s, t, r, kinds, Math.min(batch, remaining, m.max))
      )
        continue;
      let space = m.max;
      while (remaining && space) {
        const qty = Math.min(batch, remaining, space);
        placements.push({ destination: r, quantity: qty });
        remaining -= qty;
        space -= qty;
      }
    }
    if (!remaining)
      return {
        error: '',
        quantity,
        mass: stockUnitMass(t) * quantity,
        zoneId: zone.id,
        destination: placements[0].destination,
        placements,
      };
  }
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
