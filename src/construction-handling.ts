import type {
  ConstructionHandling,
  ConstructionPhase,
  Equipment,
  Job,
  Point,
  RailWorkPose,
  State,
  Worker,
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
  j.phase = labels[name];
  j.reason = '';
  s.revision++;
}
function groundObstacles(s: State, api: RailWorkAPI) {
  return api.obstacles(s);
}

/** Select a cardinal dock with room to turn before reaching into the load. */
function dock(s: State, e: Equipment, target: Point, reach: number, api: RailWorkAPI, insert = 0) {
  const candidates = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
    .map((a) => ({
      point: offset(target, a, reach),
      approach: offset(target, a, reach + insert),
      clear: offset(target, a, reach + 1.4),
      yaw: a + Math.PI,
    }))
    .sort((a, b) => dist(e, a.approach) - dist(e, b.approach));
  for (const c of candidates) {
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
      equipmentMoveBlocked(s, probe, { ...c.point, yaw: c.yaw }) ||
      equipmentMoveBlocked(s, probe, { ...c.clear, yaw: c.yaw })
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
    const future = { ...e, reach, cargo: { item: 'slab' as const, qty: 1 } };
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
      j.kind === 'slab' &&
      j.status === 'doing' &&
      ((j.stack === stackId && !j.handling) ||
        (j.handling?.sourceId === stackId &&
          ['approach', 'rig', 'engage', 'lift', 'clear'].includes(j.handling.phase))),
  );
}
function begin(s: State, j: Job, e: Equipment, api: RailWorkAPI) {
  if (j.phase === 'Board equipment') return false;
  let stack = s.stacks.find((t) => t.id === j.stack);
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
  const dest = dock(s, e, center(j), reach, api);
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
  const loaded = e.cargo?.item === 'slab';
  if (!loaded && !stack) {
    if (s.paving[`${j.x},${j.z}`]) {
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
        ...center(stack),
        y:
          surface(s, center(stack)) +
          (stack.baseHeight || 0) +
          0.08 +
          (stack.qty - 1) * parcelPitch('slab'),
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
          t.item === 'slab' && t.qty - t.reserved >= 1 && !constructionSourceBusy(s, t.id, j.id),
      )
      .sort((a, b) => dist(e, center(a)) - dist(e, center(b)))) {
      const p = {
        ...center(t),
        y: surface(s, center(t)) + (t.baseHeight || 0) + 0.08 + (t.qty - 1) * parcelPitch('slab'),
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
  return true;
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
function parkIdleBlocker(s: State, e: Equipment, blocker: string, target: Point, api: RailWorkAPI) {
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
function at(
  s: State,
  j: Job,
  e: Equipment,
  w: Worker,
  p: Point,
  target: Point,
  dt: number,
  api: RailWorkAPI,
) {
  if (e.path.length) return false;
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
    } else j.reason = 'Clear the slab handling approach';
    return false;
  }
  const angle = facing(e, target);
  if (!clearTurn(s, j, e, w, angle, api)) {
    j.reason = 'Waiting for worker to clear the turn';
    return false;
  }
  e.work = 0.3;
  const candidate = { x: e.x, z: e.z, yaw: yaw(e) };
  const aligned = turn(candidate, angle, dt, 0.85),
    blocker = equipmentSweepBlocked(s, e, candidate);
  if (blocker) {
    e.blockedBy = blocker;
    parkIdleBlocker(s, e, blocker, target, api);
    j.reason = `Waiting for ${blocker} to clear slab handling`;
    return false;
  }
  e.blockedBy = undefined;
  e.yaw = candidate.yaw;
  e.velocity = 0;
  j.reason = '';
  return aligned;
}
function walkToSlab(s: State, j: Job, e: Equipment, w: Worker, p: Point, api: RailWorkAPI) {
  if (w.path.length || w.transition) return false;
  const boxes = equipmentBoxes(e);
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

export function tickConstructionHandling(s: State, j: Job, dt: number, api: RailWorkAPI) {
  if (j.kind !== 'slab') return false;
  const e = s.equipment.find((e) => e.id === j.equipment),
    w = s.workers.find((w) => w.id === j.worker),
    op = s.workers.find((w) => w.id === j.operator);
  if (!e || !w || !op || op.vehicle !== e.id) return false;
  if (!j.handling) {
    const active = begin(s, j, e, api);
    if (!j.handling) return active;
  }
  const h = j.handling!;
  syncConstructionLoad(s, j);
  if (w.yieldingTo === e.id) {
    w.yieldTarget = undefined;
    w.yieldingTo = undefined;
  }
  e.work = ['rig', 'lift', 'lower'].includes(h.phase) ? 1 : 0;
  op.status = labels[h.phase];
  const target = center(j);
  if (h.phase === 'approach') {
    h.toolLift = e.kind === 'excavator' ? 2 : 0.12;
    h.toolReach = e.kind === 'excavator' ? 2.1 : 3;
    e.reach = h.toolReach;
    if (at(s, j, e, w, h.sourceApproach, h.source, dt, api)) phase(s, j, 'rig');
  } else if (h.phase === 'rig') {
    const stack = s.stacks.find((t) => t.id === h.sourceId);
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
      surface(s, h.source) + (stack.baseHeight || 0) + 0.08 + (stack.qty - 1) * parcelPitch('slab');
    h.pose = copy(h.source);
    if (e.kind === 'excavator' && h.clock < 3 && !walkToSlab(s, j, e, w, h.source, api))
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
      e.path = machineRoute(s, { ...e, reverse: true }, h.sourceClear, groundObstacles(s, api), 200, true) || [];
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
    if (!safeWorker(s, j, e, w, api, target)) {
      tools(s, e, h);
      return true;
    }
    h.clock += dt;
    // Every slab lands on the same real 8 cm runners used in storage. The
    // worker subsequently removes them after the machine has withdrawn.
    if (animate(h, { ...target, y: 0.08, yaw: h.pose.yaw }, 2.5)) {
      const stack = {
        x: j.x,
        z: j.z,
        w: 1,
        d: 1,
        id: api.id(s, 'stack'),
        item: 'slab' as const,
        qty: 1,
        reserved: 1,
        source: j.id,
        yaw: h.pose.yaw,
      };
      s.stacks.push(stack);
      h.placedStack = stack.id;
      h.state = 'placed';
      e.cargo = undefined;
      api.movement(s, 'slab', 1, e.id, stack.id, 'Slab set on temporary construction runners');
      phase(s, j, 'withdraw');
    }
  } else if (h.phase === 'withdraw') {
    if (e.path.length) {
      tools(s, e, h);
      return true;
    }
    if (dist(e, h.destinationClear) > 0.05) {
      e.path = machineRoute(s, { ...e, reverse: true }, h.destinationClear, groundObstacles(s, api), 200, true) || [];
      e.reverse = true;
      if (!e.path.length) j.reason = 'Clear the machine withdrawal area';
    } else {
      e.reverse = false;
      phase(s, j, 'settle');
    }
  } else if (h.phase === 'settle') {
    e.work = 0;
    const stow = e.kind === 'excavator' ? 2 : 0.12;
    h.toolLift += Math.max(-dt * 0.8, Math.min(dt * 0.8, stow - h.toolLift));
    const retract = e.kind === 'excavator' ? 2.1 : 3;
    h.toolReach += Math.max(-dt, Math.min(dt, retract - h.toolReach));
    e.reach = h.toolReach;
    if (!walkToSlab(s, j, e, w, target, api)) return true;
    if (!turn(w, facing(w, target), dt, 2)) return true;
    w.status = j.cancel
      ? 'Releasing canceled slab in place'
      : 'Removing setting runners and leveling slab';
    h.clock += dt;
    if (j.cancel) h.pose.y += Math.max(-dt * 0.04, Math.min(dt * 0.04, 0.08 - h.pose.y));
    const done = j.cancel
      ? h.clock >= 3 && Math.abs(h.pose.y - 0.08) < 0.0001
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
        s.paving[`${j.x},${j.z}`] = j.id;
        h.state = 'installed';
        j.delivered = true;
        api.movement(s, 'slab', 1, stack.id, j.id, 'Installed');
        api.complete(s, j);
      }
      h.phase = 'complete';
      return true;
    }
  }
  if (h.phase !== 'settle') tools(s, e, h);
  return true;
}
function pickup(s: State, j: Job, e: Equipment, api: RailWorkAPI) {
  const h = j.handling!,
    stack = s.stacks.find((t) => t.id === h.sourceId)!;
  stack.qty--;
  stack.reserved--;
  j.stack = undefined;
  e.cargo = { item: 'slab', qty: 1, yaw: h.pose.yaw };
  h.state = 'carried';
  h.yawOffset = h.pose.yaw - yaw(e);
  h.reach = dist(e, h.pose);
  h.toolReach = h.reach;
  api.movement(s, 'slab', 1, stack.id, e.id, 'Slab lifted from its actual storage position');
  phase(s, j, 'lift');
}
