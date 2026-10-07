import {
  requestActionClearance,
  clearActionClearance,
  actionEnvelopeBlockers,
} from './action-clearance';
import {
  bufferAssets,
  bufferSource,
  ensureBuffers,
  bufferRecoveryConflict,
  bufferPlacementConflict,
} from './buffers';
import { MATERIALS } from './catalog';
import { overlap } from './path';
import type {
  ConstructionHandling,
  ConstructionPhase,
  Equipment,
  Job,
  Point,
  RailWorkPose,
  State,
  Worker,
  Stack,
  Item,
} from './types';
import type { RailWorkAPI } from './railwork';
import { center, dist, route } from './path';
import { angleDelta, localPoint, mixAngle, smoothstep, turn } from './motion';
import {
  boxOverlap,
  boxRect,
  machineRoute,
  equipmentBoxes,
  equipmentMoveBlocked,
  equipmentSweepBlocked,
  personTouchesBox,
  walkRoute,
} from './traffic';
import { constructionStorageClearance, parcelPitch } from './delivery';

const handlingItem = (j: Job): Item => (j.item === 'bufferStop' ? 'bufferStop' : 'slab');
const targetPoint = (j: Job) =>
  j.bufferTarget ||
  (j.bufferDestination
    ? localPoint({ ...center(j.bufferDestination), yaw: 0 }, -0.5, 0)
    : center(j));
const stockContact = (t: Stack, j: Job) =>
  j.item === 'bufferStop' ? localPoint({ ...center(t), yaw: t.yaw || 0 }, -0.5, 0) : center(t);
const supportHeight = (j: Job) => (j.item === 'bufferStop' ? 0.2 : 0.08);
const sourceStack = (s: State, j: Job, id?: string): Stack | undefined =>
  s.stacks.find((t) => t.id === id) || bufferSource(s, j);
const recoveryBuffer = (j: Job) => j.kind === 'remove' && j.item === 'bufferStop';
function bufferStorage(s: State, j: Job, e: Equipment, api: RailWorkAPI) {
  const occupied = [
    ...api.obstacles(s),
    ...s.jobs
      .filter(
        (q) => q.id !== j.id && !['done', 'canceled'].includes(q.status) && q.bufferDestination,
      )
      .map((q) => q.bufferDestination!),
  ];
  for (const z of s.zones)
    for (let x = z.x; x + 2 <= z.x + z.w; x++)
      for (let a = z.z; a + 2 <= z.z + z.d; a++) {
        const r = { x, z: a, w: 2, d: 2 };
        if (
          !occupied.some((q) => overlap(q, r)) &&
          dock(s, e, center(r), e.kind === 'forklift' ? 3 : 4, api)
        )
          return r;
      }
}
const surface = (s: State, p: Point) =>
  s.paving[`${Math.floor(p.x)},${Math.floor(p.z)}`] ? 0.105 : 0;
const yaw = (e: Equipment) => e.yaw ?? (e.heading * Math.PI) / 2;
const facing = (a: Point, b: Point) => Math.atan2(b.z - a.z, b.x - a.x);
const offset = (p: Point, angle: number, distance: number): Point => ({
  x: p.x + Math.cos(angle) * distance,
  z: p.z + Math.sin(angle) * distance,
});
const copy = (p: RailWorkPose): RailWorkPose => ({ x: p.x, z: p.z, y: p.y, yaw: p.yaw });
const labels: Record<ConstructionPhase, string> = {
  approach: 'Face slab storage',
  rig: 'Prepare slab pickup',
  engage: 'Insert forks below slab',
  lift: 'Lift slab from stock',
  clear: 'Back clear of slab stack',
  carry: 'Carry slab to paving cell',
  lower: 'Lower slab onto setting runners',
  withdraw: 'Withdraw tools from slab',
  settle: 'Set slab level and remove runners',
  complete: 'Complete',
};
function phase(s: State, j: Job, name: ConstructionPhase) {
  const h = j.handling!;
  h.phase = name;
  h.clock = 0;
  h.from = copy(h.pose);
  j.phase =
    j.item === 'bufferStop'
      ? (
          {
            approach: 'Face buffer stop',
            rig: recoveryBuffer(j)
              ? 'Release buffer clamps and rig lifting tackle'
              : 'Rig buffer stop lifting tackle',
            engage: 'Insert forks under buffer stop',
            lift: 'Lift buffer stop',
            clear: 'Withdraw with buffer stop',
            carry: recoveryBuffer(j)
              ? 'Carry buffer stop to storage'
              : 'Carry buffer stop to track endpoint',
            lower: 'Lower buffer stop',
            withdraw: 'Withdraw lifting tools',
            settle: recoveryBuffer(j) ? 'Release stored buffer stop' : 'Fasten buffer rail clamps',
            complete: 'Complete',
          } as Record<ConstructionPhase, string>
        )[name]
      : labels[name];
  j.reason = '';
  s.revision++;
}
function groundObstacles(s: State, api: RailWorkAPI) {
  return api.obstacles(s);
}

/** Select a cardinal dock with room to turn before reaching into the load. */
function dock(
  s: State,
  e: Equipment,
  target: Point,
  reach: number,
  api: RailWorkAPI,
  insert = 0,
  loadedReapproach?: Point,
) {
  // Match machineRoute's planning policy: stationary automatic pedestrians
  // can walk clear. Manual workers, transitions, and existing walks still
  // constrain the preview; actual movement always checks every person.
  const preview = {
    ...s,
    workers: s.workers.filter((w) => w.duty !== 'auto' || w.path.length || w.transition),
  };
  const candidates = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
    .map((a) => ({
      point: offset(target, a, reach),
      approach: offset(target, a, reach + insert),
      clear: offset(target, a, reach + 1.4),
      yaw: a + Math.PI,
    }))
    .sort((a, b) => dist(e, a.approach) - dist(e, b.approach));
  for (const c of candidates) {
    if (loadedReapproach && dist(c.point, loadedReapproach) < 0.1) continue;
    const probe = { ...e, reach: Math.min(2.7, reach), cargo: undefined };
    const bodyRadius = e.kind === 'excavator' ? 2.36 : 1.94;
    if (
      groundObstacles(s, api).some((r) =>
        personTouchesBox(
          c.approach,
          { x: r.x + r.w / 2, z: r.z + r.d / 2, yaw: 0, length: r.w, width: r.d },
          bodyRadius,
        ),
      )
    )
      continue;
    if (
      equipmentMoveBlocked(preview, probe, { ...c.point, yaw: c.yaw }) ||
      equipmentMoveBlocked(preview, probe, { ...c.clear, yaw: c.yaw })
    )
      continue;
    const lanes = constructionStorageClearance(s);
    for (const order of s.orders) {
      const t = order.unload,
        m = s.equipment.find((e) => e.id === t?.equipmentId);
      if (!t || !m) continue;
      const reach = dist(t.drop, center(t.destination));
      for (const p of [t.drop, localPoint({ ...t.drop, yaw: t.dropYaw }, -2.8, 0)])
        lanes.push(
          ...equipmentBoxes({ ...m, reach }, { ...p, yaw: t.dropYaw }).map((b) => boxRect(b, 0.18)),
        );
    }
    const future = { ...e, reach, cargo: { item: (e.cargo?.item || 'slab') as Item, qty: 1 } };
    if (
      [c.point, c.clear].some((p) =>
        equipmentBoxes(future, { ...p, yaw: c.yaw }).some((b) =>
          lanes.some((r) =>
            boxOverlap(
              b,
              { x: r.x + r.w / 2, z: r.z + r.d / 2, yaw: 0, length: r.w, width: r.d },
              0.12,
            ),
          ),
        ),
      )
    )
      continue;
    const turnRadius = insert ? 2.4 : Math.max(2.4, reach + 0.6);
    if (
      lanes.some((r) =>
        boxOverlap(
          { ...c.approach, yaw: 0, length: turnRadius * 2, width: turnRadius * 2 },
          { x: r.x + r.w / 2, z: r.z + r.d / 2, yaw: 0, length: r.w, width: r.d },
          0.1,
        ),
      )
    )
      continue;
    const pending = [
      ...lanes,
      ...s.orders
        .filter((o) => o.status !== 'done')
        .flatMap((o) =>
          o.unload?.destination ? [o.unload.destination] : o.allocated ? [o.allocated] : [],
        ),
      ...s.jobs.filter((j) => j.status === 'doing' && j.recoveryStack).map((j) => j.recoveryStack!),
    ];
    if (
      [c.point, c.approach, c.clear].some((p) =>
        pending.some((r) =>
          boxOverlap(
            equipmentBoxes(probe, { ...p, yaw: c.yaw }, false)[0],
            { x: r.x + r.w / 2, z: r.z + r.d / 2, yaw: 0, length: r.w, width: r.d },
            0.18,
          ),
        ),
      )
    )
      continue;
    if (loadedReapproach) {
      // The probe only screens the surveyed standing area. An accepted
      // reapproach must also carry the actual supported payload through every
      // steering pose and the complete final alignment at the new dock.
      for (const reverse of [!!e.reverse, !e.reverse]) {
        const path = machineRoute(
          s,
          { ...e, reverse },
          c.point,
          groundObstacles(s, api),
          250,
          true,
          c.yaw,
        );
        if (path?.length) return { ...c, path, reverse };
      }
      continue;
    }
    // A source approach can turn through 90 degrees without scraping its stock.
    const path = machineRoute(s, e, c.approach, groundObstacles(s, api), 180, true);
    if (path) return c;
  }
}
/** Only one machine may enter a stack's pickup/withdrawal lane at a time. */
export function constructionSourceBusy(s: State, stackId: string, except?: string) {
  const stack = s.stacks.find((t) => t.id === stackId);
  if (
    s.orders.some(
      (o) =>
        o.unload &&
        (o.unload.mergeId === stackId ||
          (stack?.source === o.id &&
            o.unload.destination.x === stack.x &&
            o.unload.destination.z === stack.z)),
    )
  )
    return true;
  return s.jobs.some(
    (j) =>
      j.id !== except &&
      ['slab', 'bufferStop'].includes(j.item || '') &&
      j.status === 'doing' &&
      ((j.stack === stackId && !j.handling) ||
        (j.handling?.sourceId === stackId &&
          ['approach', 'rig', 'engage', 'lift', 'clear'].includes(j.handling.phase))),
  );
}
function begin(s: State, j: Job, e: Equipment, api: RailWorkAPI) {
  if (j.phase === 'Board equipment') return false;
  let stack = sourceStack(s, j, j.stack);
  if (recoveryBuffer(j) && !j.bufferDestination) {
    j.bufferDestination = bufferStorage(s, j, e, api);
    if (!j.bufferDestination) {
      j.reason = 'Buffer recovery needs a clear 2 × 2 m stockyard slot';
      return true;
    }
  }
  if (!e.cargo && stack && constructionSourceBusy(s, stack.id, j.id)) {
    api.release(s, j);
    j.status = 'todo';
    j.phase = 'Waiting';
    j.reason = 'Waiting for the other machine to clear the slab stack';
    j.retryAt = s.elapsed + 2;
    j.retryRevision = s.revision;
    return true;
  }
  const reach = e.kind === 'forklift' ? 3 : 4;
  const dest = dock(s, e, targetPoint(j), reach, api);
  if (!dest) {
    if (!e.cargo) {
      api.release(s, j);
      j.status = 'todo';
      j.phase = 'Waiting';
      j.retryAt = s.elapsed + 3;
      j.retryRevision = s.revision;
    }
    j.reason = 'Slab placement needs a clear machine approach';
    return true;
  }
  const loaded = e.cargo?.item === handlingItem(j);
  if (!loaded && !stack) {
    if (j.kind === 'slab' && s.paving[`${j.x},${j.z}`]) {
      api.complete(s, j);
      return true;
    }
    api.release(s, j);
    j.status = 'todo';
    j.phase = 'Waiting';
    j.reason = 'Reassigning slab stock';
    return true;
  }
  let source = stack
    ? {
        ...stockContact(stack, j),
        y:
          surface(s, center(stack)) +
          (stack.baseHeight || 0) +
          supportHeight(j) +
          (stack.qty - 1) * parcelPitch(handlingItem(j)),
        yaw: stack.yaw || 0,
      }
    : {
        ...localPoint({ ...e, yaw: yaw(e) }, e.reach || 2.7, 0),
        y: surface(s, e) + Math.max(0.12, e.lift || 0.12) + 0.08,
        yaw: e.cargo?.yaw ?? yaw(e),
      };
  let from = loaded
    ? {
        point: { x: e.x, z: e.z },
        approach: { x: e.x, z: e.z },
        clear: { x: e.x, z: e.z },
        yaw: yaw(e),
      }
    : dock(s, e, source, reach, api, e.kind === 'forklift' ? 1.1 : 0);
  if (!from && !loaded) {
    for (const t of s.stacks
      .filter(
        (t) =>
          t.item === handlingItem(j) &&
          t.qty - t.reserved >= 1 &&
          !constructionSourceBusy(s, t.id, j.id),
      )
      .sort((a, b) => dist(e, center(a)) - dist(e, center(b)))) {
      const p = {
        ...stockContact(t, j),
        y:
          surface(s, center(t)) +
          (t.baseHeight || 0) +
          supportHeight(j) +
          (t.qty - 1) * parcelPitch(handlingItem(j)),
        yaw: t.yaw || 0,
      };
      const candidate = dock(s, e, p, reach, api, e.kind === 'forklift' ? 1.1 : 0);
      if (candidate) {
        if (stack) stack.reserved--;
        t.reserved++;
        stack = t;
        j.stack = t.id;
        source = p;
        from = candidate;
        break;
      }
    }
  }
  if (!from) {
    if (!e.cargo) {
      api.release(s, j);
      j.status = 'todo';
      j.phase = 'Waiting';
      j.retryAt = s.elapsed + 3;
      j.retryRevision = s.revision;
    }
    j.reason = 'Slab stock needs an accessible face and a turning area';
    return true;
  }
  const h: ConstructionHandling = {
    phase: loaded ? 'carry' : 'approach',
    clock: 0,
    state: loaded ? 'carried' : 'stored',
    pose: copy(source),
    source: copy(source),
    sourceId: stack?.id,
    sourceDock: from.point,
    sourceApproach: from.approach,
    sourceClear: from.clear,
    destinationDock: dest.point,
    destinationClear: dest.clear,
    reach: loaded ? e.reach || 2.7 : reach,
    yawOffset: source.yaw - (loaded ? yaw(e) : facing(from.point, source)),
    toolLift: loaded ? source.y : 0.12,
    toolReach: loaded ? e.reach || 2.7 : 2.1,
  };
  j.handling = h;
  e.path = [];
  e.reverse = false;
  e.work = 0;
  if (loaded) e.cargo!.yaw = h.pose.yaw;
  const worker = s.workers.find((w) => w.id === j.worker);
  if (worker && !worker.yieldingTo) worker.path = [];
  phase(s, j, h.phase);
  clearPlannedDestination(s, j, e, api);
  return true;
}
/** Prepare the destination in parallel with the pickup approach. Relocation
 * is a real walk, with no automatic return into the reserved handling area. */
function clearPlannedDestination(s: State, j: Job, e: Equipment, api: RailWorkAPI) {
  const h = j.handling!,
    target = targetPoint(j);
  const angle = facing(h.destinationDock, target);
  const future = {
    ...e,
    reach: e.kind === 'forklift' ? 3 : 4,
    cargo: { item: handlingItem(j), qty: 1 },
  };
  const boxes = [h.destinationDock, h.destinationClear].flatMap((p) =>
    equipmentBoxes(future, { ...p, yaw: angle }),
  );
  for (const w of s.workers) {
    if (
      w.duty !== 'auto' ||
      w.vehicle ||
      w.transition ||
      w.path.length ||
      w.deliveryOrder ||
      w.transportOrder ||
      (w.job && w.job !== j.id)
    )
      continue;
    if (!boxes.some((b) => personTouchesBox(w, b, 0.7))) continue;
    const candidates = [5, 7, 9]
      .flatMap((radius) =>
        Array.from({ length: 8 }, (_, i) => offset(target, (i * Math.PI) / 4, radius)),
      )
      .filter((p) => boxes.every((b) => !personTouchesBox(p, b, 0.8)))
      .sort((a, b) => dist(w, a) - dist(w, b));
    for (const p of candidates) {
      const path = walkRoute(s, w, p, groundObstacles(s, api));
      if (!path?.length) continue;
      w.path = path;
      w.yieldTarget = undefined;
      w.yieldingTo = undefined;
      w.status = 'Clearing planned slab handling area';
      api.event(s, 'Work', w.id, `Walking clear of ${j.id}'s planned loading and withdrawal area.`);
      break;
    }
  }
}
function safeWorker(s: State, j: Job, e: Equipment, w: Worker, api: RailWorkAPI, target?: Point) {
  if (w.transition) return false;
  const envelope = equipmentBoxes({ ...e, reach: Math.max(e.reach || 2.7, j.handling!.reach) });
  const point = target || { x: e.x, z: e.z };
  const isSafe = (p: Point) =>
    envelope.every((b) => !personTouchesBox(p, b, 0.7)) && (!target || dist(p, target) > 1.2);
  if (isSafe(w) && !w.path.length) {
    w.yieldTarget = undefined;
    w.yieldingTo = undefined;
    return true;
  }
  if (w.path.length) return false;
  const candidates: Point[] = [];
  for (const r of [2, 3, 5, 7])
    for (let k = 0; k < 8; k++) candidates.push(offset(point, (k * Math.PI) / 4, r));
  for (const p of candidates.filter(isSafe).sort((a, b) => dist(w, a) - dist(w, b))) {
    const path = walkRoute(s, w, p, groundObstacles(s, api));
    if (path) {
      w.path = path;
      w.yieldTarget = undefined;
      w.yieldingTo = undefined;
      w.status = 'Walk clear of slab and machine';
      return false;
    }
  }
  j.reason = 'Waiting for a clear walking route beside the slab';
  return false;
}
function clearTurn(s: State, j: Job, e: Equipment, w: Worker, angle: number, api: RailWorkAPI) {
  const delta = angleDelta(yaw(e), angle);
  if (Math.abs(delta) < 0.025) return true;
  const boxes = Array.from({ length: 13 }, (_, i) =>
    equipmentBoxes(e, { ...e, yaw: yaw(e) + (delta * i) / 12 }),
  ).flat();
  if (!boxes.some((b) => personTouchesBox(w, b, 0.65)) && !w.path.length) return true;
  if (w.path.length) return false;
  for (const r of [5.5, 7, 9])
    for (let k = 0; k < 8; k++) {
      const p = offset(e, (k * Math.PI) / 4, r);
      if (boxes.some((b) => personTouchesBox(p, b, 0.7))) continue;
      const path = walkRoute(s, w, p, groundObstacles(s, api));
      if (path) {
        w.path = path;
        w.yieldTarget = undefined;
        w.yieldingTo = undefined;
        w.status = 'Walk clear of machine turn';
        return false;
      }
    }
  return false;
}
function parkIdleBlocker(
  s: State,
  e: Equipment,
  blocker: string,
  target: Point,
  api: RailWorkAPI,
  destination?: Point,
) {
  const other = s.equipment.find((q) => q.id === blocker);
  if (
    !other ||
    other.path.length ||
    other.job ||
    other.deliveryOrder ||
    other.transportOrder ||
    other.refueling ||
    other.cargo ||
    other.fuel <= 0
  )
    return;
  const operator = s.workers.find(
    (w) => w.id === other.operator && w.vehicle === other.id && w.duty === 'auto',
  );
  if (!operator) return;
  const from = yaw(e),
    change = angleDelta(from, facing(e, target));
  const sweep = Array.from({ length: 17 }, (_, i) =>
    equipmentBoxes(e, { ...e, yaw: from + (change * i) / 16 }),
  ).flat();
  if (destination)
    sweep.push(...equipmentBoxes(e, { ...destination, yaw: facing(destination, target) }));
  const away = facing(e, other);
  for (const distance of [5, 8, 11])
    for (const a of [away, away + Math.PI / 2, away - Math.PI / 2, away + Math.PI]) {
      const p = offset(other, a, distance);
      if (
        equipmentBoxes(other, { ...p, yaw: yaw(other) }).some((b) =>
          sweep.some((q) => boxOverlap(b, q, 0.35)),
        )
      )
        continue;
      for (const reverse of [false, true]) {
        const path = machineRoute(s, { ...other, reverse }, p, groundObstacles(s, api), 120, true);
        if (path?.length) {
          other.path = path;
          other.reverse = reverse;
          other.trafficReverse = reverse || undefined;
          other.trafficGoal = { ...p };
          operator.status = 'Parking clear of slab handling';
          return;
        }
      }
    }
}
function reapproachCarriedLoad(
  s: State,
  j: Job,
  e: Equipment,
  target: Point,
  api: RailWorkAPI,
  blockerId: string,
) {
  const h = j.handling;
  if (
    h?.phase !== 'carry' ||
    j.item !== 'slab' ||
    !e.cargo ||
    !s.equipment.some((q) => q.id === blockerId) ||
    s.elapsed < (e.trafficRetry || 0)
  )
    return false;
  e.trafficRetry = s.elapsed + 1.5;
  const alternative = dock(
    { ...s, jobs: s.jobs.filter((other) => other.id !== j.id) },
    e,
    target,
    h.reach,
    api,
    0,
    h.destinationDock,
  );
  if (!alternative || !('path' in alternative) || !alternative.path?.length) return false;
  h.destinationDock = { ...alternative.point };
  h.destinationClear = { ...alternative.clear };
  e.path = alternative.path;
  e.reverse = alternative.reverse;
  e.blockedBy = undefined;
  e.work = 0;
  j.reason = 'Reapproaching from a clear side while keeping the supported load';
  clearActionClearance(s, j.id);
  api.event(
    s,
    'Traffic',
    e.id,
    `Reapproaching ${j.id} from another setting dock; the original load and placement target are unchanged.`,
  );
  s.revision++;
  return true;
}
function at(
  s: State,
  j: Job,
  e: Equipment,
  w: Worker | undefined,
  p: Point,
  target: Point,
  dt: number,
  api: RailWorkAPI,
) {
  if (e.path.length || e.trafficGoal) return false;
  const h = j.handling;
  if (
    h?.phase === 'carry' &&
    equipmentMoveBlocked({ ...s, workers: [], equipment: [e], orders: [] }, e, {
      ...p,
      yaw: facing(p, target),
    })
  ) {
    // Construction can complete beside a previously planned setting dock.
    // Refresh an invalid dock around fixed geometry, keeping the same slab,
    // site and supported payload; never mistake a stale route for arrival.
    if (s.elapsed < (e.trafficRetry || 0)) return false;
    e.trafficRetry = s.elapsed + 1.5;
    const alternative = dock(
      { ...s, jobs: s.jobs.filter((q) => q.id !== j.id) },
      e,
      target,
      h.reach,
      api,
    );
    if (alternative) {
      h.destinationDock = { ...alternative.point };
      h.destinationClear = { ...alternative.clear };
      p = h.destinationDock;
      s.revision++;
      api.event(
        s,
        'Traffic',
        e.id,
        `Updated ${j.id}'s handling dock around newly occupied space; keeping its original placement target.`,
      );
    } else {
      j.reason =
        'Planned handling dock is occupied; waiting for another reachable setting position';
      return false;
    }
  }
  if (dist(e, p) > 0.045) {
    let reverse = !!e.reverse;
    let path = machineRoute(s, e, p, groundObstacles(s, api), 200, true);
    if (!path) {
      reverse = !reverse;
      path = machineRoute(s, { ...e, reverse }, p, groundObstacles(s, api), 200, true);
    }
    if (path) {
      e.path = path;
      e.reverse = reverse;
    } else {
      // A dock can be blocked by an unladen machine whose previous job just
      // released it. With no route yet, the normal movement yield loop cannot
      // start. Ask only an eligible idle, seated automatic operator to drive
      // clear of the planned dock through the same checked routing API.
      const dockBoxes = equipmentBoxes(e, { ...p, yaw: facing(p, target) });
      for (const other of s.equipment) {
        if (other.id === e.id) continue;
        if (!dockBoxes.some((a) => equipmentBoxes(other).some((b) => boxOverlap(a, b, 0.35))))
          continue;
        requestActionClearance(s, {
          ownerId: j.id,
          requesterEquipmentId: e.id,
          blockerId: other.id,
          action: 'Approach slab handling dock',
          envelopes: dockBoxes,
        });
      }
      for (const blockerId of actionEnvelopeBlockers(s, e, dockBoxes))
        requestActionClearance(s, {
          ownerId: j.id,
          requesterEquipmentId: e.id,
          blockerId,
          action: 'Approach slab handling dock',
          envelopes: dockBoxes,
        });
      j.reason = 'Clear the slab handling approach';
    }
    return false;
  }
  const angle = facing(e, target);
  if (w && !clearTurn(s, j, e, w, angle, api)) {
    j.reason = 'Waiting for worker to clear the turn';
    return false;
  }
  e.work = 0.3;
  const candidate = { x: e.x, z: e.z, yaw: yaw(e) };
  const aligned = turn(candidate, angle, dt, 0.85),
    blocker = equipmentSweepBlocked(s, e, candidate);
  if (blocker) {
    e.blockedBy = blocker;
    if (reapproachCarriedLoad(s, j, e, target, api, blocker)) return false;
    requestActionClearance(s, {
      ownerId: j.id,
      requesterEquipmentId: e.id,
      blockerId: blocker,
      action: 'Align slab handling equipment',
      envelopes: [...equipmentBoxes(e), ...equipmentBoxes(e, candidate)],
    });
    j.reason = `Waiting for ${blocker} to clear slab handling`;
    return false;
  }
  e.blockedBy = undefined;
  clearActionClearance(s, j.id);
  e.yaw = candidate.yaw;
  e.velocity = 0;
  j.reason = '';
  return aligned;
}
function walkToSlab(
  s: State,
  j: Job,
  e: Equipment | undefined,
  w: Worker,
  p: Point,
  api: RailWorkAPI,
) {
  if (w.path.length || w.transition) return false;
  const boxes = e
    ? equipmentBoxes(e)
    : s.equipment.filter((e) => !e.transportOrder).flatMap((e) => equipmentBoxes(e));
  const candidates = [1.15, 1.5, 1.9].flatMap((r) =>
    Array.from({ length: 8 }, (_, i) => offset(p, (i * Math.PI) / 4, r)),
  );
  const safe = candidates.filter((q) => boxes.every((b) => !personTouchesBox(q, b, 0.5)));
  if (safe.some((q) => dist(w, q) < 0.12)) return true;
  for (const q of safe.sort((a, b) => dist(w, a) - dist(w, b))) {
    const path = walkRoute(s, w, q, groundObstacles(s, api));
    if (path) {
      w.path = path;
      w.yieldTarget = undefined;
      w.yieldingTo = undefined;
      return false;
    }
  }
  j.reason = 'Construction worker needs access beside the slab';
  return false;
}
function animate(h: ConstructionHandling, to: RailWorkPose, duration: number) {
  const t = smoothstep(h.clock / duration),
    a = h.from!;
  Object.assign(h.pose, {
    x: a.x + (to.x - a.x) * t,
    z: a.z + (to.z - a.z) * t,
    y: a.y + (to.y - a.y) * t,
    yaw: mixAngle(a.yaw, to.yaw, t),
  });
  return h.clock >= duration;
}
/** Called even when fuel runs out after the machine's last movement step. */
export function syncConstructionLoad(s: State, j: Job) {
  const h = j.handling,
    e = s.equipment.find((e) => e.id === j.equipment);
  if (!h || !e || h.state !== 'carried' || !['clear', 'carry'].includes(h.phase)) return;
  const p = localPoint({ ...e, yaw: yaw(e) }, h.reach, 0);
  h.pose.x = p.x;
  h.pose.z = p.z;
  h.pose.yaw = yaw(e) + h.yawOffset;
  if (e.cargo) e.cargo.yaw = h.pose.yaw;
}
function tools(s: State, e: Equipment, h: ConstructionHandling) {
  if (h.state === 'carried' || h.state === 'placed') {
    h.toolLift = h.pose.y + (e.kind === 'excavator' ? 0.82 : 0) - surface(s, e);
    if (h.state === 'carried') h.toolReach = dist(e, h.pose);
  }
  e.lift = h.pose.y - surface(s, e);
  e.reach = h.toolReach;
}

function releaseMachine(
  s: State,
  j: Job,
  e: Equipment | undefined,
  op: Worker | undefined,
  api: RailWorkAPI,
) {
  const machine = j.equipment,
    operator = j.operator;
  if (e?.job === j.id) {
    e.job = undefined;
    e.path = [];
    e.work = 0;
    e.reverse = false;
  }
  if (op?.job === j.id) {
    op.job = undefined;
    op.path = [];
    op.status = op.vehicle ? 'Available in cab' : 'Available';
  }
  j.equipment = undefined;
  j.operator = undefined;
  // Pickup already consumed this reservation; do not release a later job's
  // reservation against the same source stack when finishing completes.
  j.stack = undefined;
  j.handling!.equipmentReleased = true;
  s.revision++;
  api.event(
    s,
    'Work',
    j.id,
    `${machine || 'Machine'} and ${operator || 'operator'} released after safe withdrawal; ${j.worker} finishes the placed ${j.item === 'bufferStop' ? 'buffer stop' : 'slab'} independently.`,
  );
}
function settle(s: State, j: Job, w: Worker, dt: number, api: RailWorkAPI) {
  const h = j.handling!,
    target = targetPoint(j);
  if (j.kind === 'bufferStop' && !j.cancel) {
    const conflict = bufferPlacementConflict(s, j.bufferTarget!);
    if (conflict) {
      j.reason = conflict;
      return true;
    }
  }
  if (!walkToSlab(s, j, undefined, w, target, api)) return true;
  if (!turn(w, facing(w, target), dt, 2)) return true;
  w.status =
    j.item === 'bufferStop'
      ? j.cancel
        ? 'Releasing buffer stop safely'
        : recoveryBuffer(j)
          ? 'Checking stored buffer stop supports'
          : 'Tightening buffer rail clamps'
      : j.cancel
        ? 'Releasing canceled slab in place'
        : 'Removing setting runners and leveling slab';
  h.clock += dt;
  if (j.cancel) h.pose.y += Math.max(-dt * 0.04, Math.min(dt * 0.04, supportHeight(j) - h.pose.y));
  const done = j.cancel
    ? h.clock >= 3 && Math.abs(h.pose.y - supportHeight(j)) < 0.0001
    : j.item === 'bufferStop'
      ? h.clock >= 5
      : animate(h, { ...target, y: -0.015, yaw: h.pose.yaw }, 3);
  if (done) {
    const stack = s.stacks.find((t) => t.id === h.placedStack)!;
    if (j.cancel) {
      stack.reserved = 0;
      h.state = 'stored';
      api.release(s, j);
      j.status = 'canceled';
      j.phase = 'Canceled; slab stored at site';
      j.reason = '';
      s.revision++;
    } else {
      stack.qty = 0;
      stack.reserved = 0;
      if (j.item === 'bufferStop') {
        if (recoveryBuffer(j)) {
          stack.qty = 1;
          stack.reserved = 0;
        } else {
          const id = j.assetId || api.id(s, 'buffer');
          ensureBuffers(s).push({
            id,
            ...target,
            y: 0.2,
            yaw: j.bufferTarget!.yaw,
            secured: true,
            carried: false,
            source: j.id,
          });
        }
      } else s.paving[`${j.x},${j.z}`] = j.id;
      h.state = 'installed';
      j.delivered = true;
      api.movement(
        s,
        handlingItem(j),
        1,
        stack.id,
        recoveryBuffer(j) ? stack.id : j.id,
        recoveryBuffer(j) ? 'Recovered buffer stored' : 'Installed',
      );
      api.complete(s, j);
    }
    h.phase = 'complete';
    return true;
  }

  return true;
}

function tickHandling(s: State, j: Job, dt: number, api: RailWorkAPI) {
  if (j.kind !== 'slab' && j.item !== 'bufferStop') return false;
  const e = s.equipment.find((e) => e.id === j.equipment),
    w = s.workers.find((w) => w.id === j.worker),
    op = s.workers.find((w) => w.id === j.operator);
  if (j.handling?.phase === 'settle') {
    if (!w) {
      j.reason = 'The placed slab needs its assigned finishing worker';
      return true;
    }
    // Older saves retained the machine through settlement. Its withdrawal is
    // already complete; detach only its matching assignment, never new work.
    if (!j.handling.equipmentReleased) releaseMachine(s, j, e, op, api);
    return settle(s, j, w, dt, api);
  }
  if (!e || !op || op.vehicle !== e.id) return false;
  if (!j.handling) {
    const active = begin(s, j, e, api);
    if (!j.handling) return active;
  }
  const h = j.handling!;
  syncConstructionLoad(s, j);
  if (w?.yieldingTo === e.id) {
    w.yieldTarget = undefined;
    w.yieldingTo = undefined;
  }
  e.work = ['rig', 'lift', 'lower'].includes(h.phase) ? 1 : 0;
  op.status = labels[h.phase];
  const target = targetPoint(j);
  if (h.phase === 'approach') {
    h.toolLift = e.kind === 'excavator' ? 2 : 0.12;
    h.toolReach = e.kind === 'excavator' ? 2.1 : 3;
    e.reach = h.toolReach;
    if (at(s, j, e, w, h.sourceApproach, h.source, dt, api)) phase(s, j, 'rig');
  } else if (h.phase === 'rig') {
    if (!w) {
      j.reason = 'Waiting for the finishing worker before preparing the next slab';
      return true;
    }
    const stack = sourceStack(s, j, h.sourceId);
    if (!stack || stack.qty < 1 || stack.reserved < 1) {
      j.reason = 'Reserved slab unavailable';
      return true;
    }
    if (
      s.jobs.some(
        (k) =>
          k.id !== j.id &&
          k.status === 'doing' &&
          k.handling?.sourceId === stack.id &&
          ['rig', 'engage', 'lift', 'clear'].includes(k.handling.phase) &&
          k.id < j.id,
      )
    ) {
      j.reason = 'Waiting for the other machine to clear this slab stack';
      return true;
    }
    // Re-read the real top after a previous reservation has finished taking its slab.
    h.source.y =
      surface(s, h.source) +
      (stack.baseHeight || 0) +
      supportHeight(j) +
      (stack.qty - 1) * parcelPitch(handlingItem(j));
    h.pose = copy(h.source);
    if (
      (e.kind === 'excavator' || j.item === 'bufferStop') &&
      h.clock < 3 &&
      !walkToSlab(s, j, e, w, h.source, api)
    )
      return true;
    h.clock += dt;
    const tip = h.pose.y + (e.kind === 'excavator' ? 0.82 : 0) - surface(s, e);
    const initial = e.kind === 'excavator' ? 2 : 0.12;
    h.toolLift = initial + (tip - initial) * smoothstep(h.clock / 1.5);
    h.toolReach =
      e.kind === 'excavator' ? 2.1 + (h.reach - 2.1) * smoothstep((h.clock - 1.5) / 1.5) : 3;
    if (h.clock >= 3) {
      if (!safeWorker(s, j, e, w, api, h.source)) return true;
      if (e.kind === 'forklift') {
        phase(s, j, 'engage');
      } else pickup(s, j, e, api);
    }
  } else if (!w) {
    j.reason = 'Waiting for the construction worker';
    return true;
  } else if (h.phase === 'engage') {
    if (at(s, j, e, w, h.sourceDock, h.source, dt, api) && safeWorker(s, j, e, w, api, h.source))
      pickup(s, j, e, api);
  } else if (h.phase === 'lift') {
    h.clock += dt;
    if (animate(h, { ...h.from!, y: h.source.y + 0.35 }, 2)) phase(s, j, 'clear');
  } else if (h.phase === 'clear') {
    if (e.path.length) {
      tools(s, e, h);
      return true;
    }
    if (dist(e, h.sourceClear) > 0.05) {
      e.path =
        machineRoute(
          s,
          { ...e, reverse: true },
          h.sourceClear,
          groundObstacles(s, api),
          200,
          true,
        ) || [];
      e.reverse = true;
      if (!e.path.length) j.reason = 'Clear the slab withdrawal aisle';
    } else {
      e.reverse = false;
      phase(s, j, 'carry');
    }
  } else if (h.phase === 'carry') {
    // Imported v4 cargo starts at its old physical location. Reach changes
    // gradually so it cannot jump from an old 2.7 m tool to a new 3/4 m dock.
    const preferred = e.kind === 'forklift' ? 3 : 4;
    if (Math.abs(h.reach - preferred) > 0.005) {
      h.reach += Math.max(-dt * 0.65, Math.min(dt * 0.65, preferred - h.reach));
      syncConstructionLoad(s, j);
    }
    h.toolReach = h.reach;
    e.reach = h.reach;
    const travelY = Math.max(0.45, surface(s, e) + 0.4);
    h.pose.y += Math.max(-dt * 0.35, Math.min(dt * 0.35, travelY - h.pose.y));
    const arrived = at(s, j, e, w, h.destinationDock, target, dt, api);
    syncConstructionLoad(s, j);
    if (
      arrived &&
      Math.abs(h.reach - preferred) < 0.01 &&
      dist(h.pose, target) < 0.025 &&
      safeWorker(s, j, e, w, api, target)
    ) {
      phase(s, j, 'lower');
    }
  } else if (h.phase === 'lower') {
    if (j.kind === 'bufferStop') {
      const conflict = bufferPlacementConflict(s, j.bufferTarget!);
      if (conflict) {
        j.reason = conflict;
        return true;
      }
    }
    if (!safeWorker(s, j, e, w, api, target)) {
      tools(s, e, h);
      return true;
    }
    h.clock += dt;
    // Every slab lands on the same real 8 cm runners used in storage. The
    // worker subsequently removes them after the machine has withdrawn.
    if (
      animate(
        h,
        {
          ...target,
          y: j.item === 'bufferStop' ? 0.2 : 0.08,
          yaw: j.bufferTarget?.yaw ?? h.pose.yaw,
        },
        2.5,
      )
    ) {
      const stack = {
        x:
          j.bufferDestination?.x ??
          (j.bufferTarget ? target.x + Math.cos(h.pose.yaw) * 0.5 - 1 : j.x),
        z:
          j.bufferDestination?.z ??
          (j.bufferTarget ? target.z + Math.sin(h.pose.yaw) * 0.5 - 1 : j.z),
        w: MATERIALS[handlingItem(j)].w,
        d: MATERIALS[handlingItem(j)].d,
        id: api.id(s, 'stack'),
        item: handlingItem(j),
        assetId: j.assetId,
        qty: 1,
        reserved: 1,
        source: j.id,
        yaw: h.pose.yaw,
      };
      s.stacks.push(stack);
      h.placedStack = stack.id;
      h.state = 'placed';
      e.cargo = undefined;
      api.movement(
        s,
        handlingItem(j),
        1,
        e.id,
        stack.id,
        j.item === 'bufferStop'
          ? 'Buffer stop lowered onto supports'
          : 'Slab set on temporary construction runners',
      );
      phase(s, j, 'withdraw');
    }
  } else if (h.phase === 'withdraw') {
    if (e.path.length) {
      tools(s, e, h);
      return true;
    }
    if (dist(e, h.destinationClear) > 0.05) {
      e.path =
        machineRoute(
          s,
          { ...e, reverse: true },
          h.destinationClear,
          groundObstacles(s, api),
          200,
          true,
        ) || [];
      e.reverse = true;
      if (!e.path.length) j.reason = 'Clear the machine withdrawal area';
    } else {
      e.reverse = false;
      // Stow hydraulics/forks smoothly after the chassis has backed clear.
      // The finishing worker will continue alone once the machine is ready
      // to leave; no return-to-stock movement waits for leveling afterward.
      const stow = e.kind === 'excavator' ? 2 : 0.12,
        retract = e.kind === 'excavator' ? 2.1 : 3;
      h.toolLift += Math.max(-dt * 0.8, Math.min(dt * 0.8, stow - h.toolLift));
      h.toolReach += Math.max(-dt, Math.min(dt, retract - h.toolReach));
      e.lift = h.toolLift - (e.kind === 'excavator' ? 0.82 : 0);
      e.reach = h.toolReach;
      if (Math.abs(h.toolLift - stow) > 0.001 || Math.abs(h.toolReach - retract) > 0.001)
        return true;
      phase(s, j, 'settle');
      releaseMachine(s, j, e, op, api);
      return true;
    }
  }
  if (h.phase !== 'settle') tools(s, e, h);
  return true;
}
function pickup(s: State, j: Job, e: Equipment, api: RailWorkAPI) {
  const h = j.handling!,
    stack = sourceStack(s, j, h.sourceId)!;
  if (recoveryBuffer(j)) {
    // A locomotive may have entered/reserved the rail since this crew was
    // assigned. The mounted stop remains a real train barrier until safe lift.
    const conflict = bufferRecoveryConflict(s, j.target!, j.id);
    if (conflict) {
      j.reason = conflict;
      return;
    }
    const b = bufferAssets(s).find((b) => b.id === j.target)!;
    j.assetId = b.id;
    s.buffers = ensureBuffers(s).filter((b) => b.id !== j.target);
  } else {
    stack.qty--;
    stack.reserved--;
    j.assetId = stack.assetId;
  }
  j.stack = undefined;
  e.cargo = { item: handlingItem(j), qty: 1, yaw: h.pose.yaw };
  h.state = 'carried';
  h.yawOffset = h.pose.yaw - yaw(e);
  h.reach = dist(e, h.pose);
  h.toolReach = h.reach;
  api.movement(
    s,
    handlingItem(j),
    1,
    stack.id,
    e.id,
    recoveryBuffer(j) && stack.source === 'opening'
      ? 'Opening asset recovered'
      : j.item === 'bufferStop'
        ? 'Rigged buffer lifted from actual source'
        : 'Slab lifted from its actual storage position',
  );
  phase(s, j, 'lift');
}

/** Keep the shared physical pipeline's equipment diagnostics specific to its load. */
export function tickConstructionHandling(s: State, j: Job, dt: number, api: RailWorkAPI) {
  const active = tickHandling(s, j, dt, api);
  if (j.item === 'bufferStop') {
    const noun = (text: string) =>
      text.replace(/\bslabs?\b/gi, (word) => (word[0] === 'S' ? 'Buffer stop' : 'buffer stop'));
    j.reason = noun(j.reason);
    j.phase = noun(j.phase);
    for (const worker of s.workers.filter((w) => w.job === j.id)) {
      worker.status = noun(worker.status);
      if (worker.id === j.operator && j.handling) worker.status = j.phase;
    }
  }
  return active;
}
