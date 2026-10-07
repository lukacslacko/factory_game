import type { Equipment, Item, Job, Point, Rect, Stack, State, Worker } from './types';
import { boardMachine, leaveMachine, machineStep } from './boarding';
import { center, dist } from './path';
import { angleDelta, localPoint, turn } from './motion';
import {
  equipmentMoveBlocked,
  equipmentBoxes,
  personTouchesBox,
  machineRoute,
  staticObstacleRects,
  walkRoute,
  workerMoveBlocked,
} from './traffic';
import { noteWorkerAssignment, selectWorker, workerApproachPoints } from './worker-selection';
import { equipmentAssistant, workerSupportsEquipment } from './work-crews';

interface FuelAPI {
  event(s: State, type: string, entity: string, text: string): void;
  notice(s: State, title: string, detail: string, entity: string): void;
  movement(s: State, item: Item, qty: number, from: string, to: string, reason: string): void;
  complete(s: State, job: Job): void;
  release(s: State, job: Job): void;
}
export const equipmentFuelFiller = (e: Equipment) => ({
  ...localPoint(
    { ...e, yaw: e.yaw ?? (e.heading * Math.PI) / 2 },
    -0.2,
    e.kind === 'forklift' ? 0.65 : 1.15,
  ),
  y: (e.y || 0) + (e.kind === 'forklift' ? 0.9 : 1.1),
});
export const equipmentFuelStandingPoint = (e: Equipment) =>
  localPoint(
    { ...e, yaw: e.yaw ?? (e.heading * Math.PI) / 2 },
    -0.2,
    e.kind === 'forklift' ? 1.35 : 1.75,
  );
const canId = (j: Job) => j.id + '/CAN';
const active = (j: Job) => !['done', 'canceled'].includes(j.status);

function blocked(s: State, j: Job, api: FuelAPI, reason: string) {
  j.reason = reason;
  const f = j.fuelWork;
  if (!f) return;
  f.blockedSince ??= s.elapsed;
  if (s.elapsed - f.blockedSince >= 20 && !f.warned) {
    f.warned = true;
    api.notice(
      s,
      'Equipment refueling blocked',
      `${j.target}: ${reason}. Diesel remains accounted in ${f.barrelId}, ${canId(j)}, and the equipment tank.`,
      j.id,
    );
    const n = s.notices.find(
      (n) => n.entity === j.id && n.title === 'Equipment refueling blocked' && n.state !== 'done',
    );
    if (n) n.severity = 'warning';
  }
}
function clearBlocked(s: State, j: Job) {
  const f = j.fuelWork;
  if (f) {
    f.blockedSince = undefined;
    f.warned = undefined;
  }
  for (const n of s.notices)
    if (n.entity === j.id && n.title === 'Equipment refueling blocked') n.state = 'done';
  j.reason = '';
}
function barrelAvailable(s: State, j: Job, t: Stack) {
  return (
    t.item === 'diesel' &&
    (t.liters || 0) > 0 &&
    !s.jobs.some((k) => k.id !== j.id && k.kind === 'refuel' && active(k) && k.stack === t.id) &&
    !s.shunters?.some((e) => e.refueling?.barrelId === t.id)
  );
}
/** A parked pose is usable only if its real chassis/tool fit AND its driver can
 * get from the exterior cab step to a real drum face. Nothing is removed from
 * execution collision checks; this is a future-pose planning preview only. */
function serviceRoute(s: State, e: Equipment, w: Worker, barrel: Stack) {
  const c = center(barrel),
    obs = staticObstacleRects(s);
  // A sealed drum cannot become accessible by testing more parking poses.
  // Exclude only this machine in the early preview, since it will relocate;
  // every accepted future pose below reinstates its complete physical boxes.
  const clearCurrentMachine = { ...s, equipment: s.equipment.filter((q) => q.id !== e.id) };
  if (
    !workerApproachPoints(barrel).some(
      (p) => !workerMoveBlocked(clearCurrentMachine, { id: w.id, x: -10000, z: -10000 }, p),
    )
  )
    return;
  const goals: Point[] = [];
  if (dist(e, c) <= 6.5) goals.push({ x: e.x, z: e.z });
  for (const radius of [3.5, 4.5, 6])
    for (const [dx, dz] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      goals.push({ x: c.x + dx * radius, z: c.z + dz * radius });
  goals.sort((a, b) => dist(e, a) - dist(e, b));
  for (const goal of goals) {
    for (const reverse of [!!e.reverse, !e.reverse]) {
      const route =
        dist(e, goal) < 0.05 ? [] : machineRoute(s, { ...e, reverse }, goal, obs, 250, true);
      if (!route) continue;
      const before = route.length > 1 ? route[route.length - 2] : e;
      const yaw =
        dist(before, goal) > 0.01
          ? Math.atan2(goal.z - before.z, goal.x - before.x) + (reverse ? Math.PI : 0)
          : (e.yaw ?? (e.heading * Math.PI) / 2);
      const pose = { ...e, ...goal, yaw, reverse, path: [] };
      if (equipmentMoveBlocked(s, e, pose)) continue;
      const future = { ...s, equipment: s.equipment.map((q) => (q.id === e.id ? pose : q)) };
      const step = machineStep(pose);
      if (workerMoveBlocked(future, { id: w.id, x: -10000, z: -10000 }, step)) continue;
      if (
        workerMoveBlocked(
          future,
          { id: w.id, x: -10000, z: -10000 },
          equipmentFuelStandingPoint(pose),
        )
      )
        continue;
      if (!walkRoute(future, { id: w.id, ...step }, equipmentFuelStandingPoint(pose), obs))
        continue;
      if (
        !workerApproachPoints(barrel).some(
          (p) => walkRoute(future, { id: w.id, ...step }, p, obs) !== null,
        )
      )
        continue;
      return { path: route, station: { ...goal, yaw, reverse } };
    }
  }
}

export function assignEquipmentRefueling(s: State, j: Job, api: FuelAPI): boolean {
  if (j.kind !== 'refuel') return false;
  const e = s.equipment.find((e) => e.id === j.target);
  if (!e) {
    j.reason = 'Equipment no longer exists';
    return true;
  }
  if (e.refueling || e.transportOrder) {
    j.reason = 'Waiting for equipment to stop or finish transport';
    return true;
  }
  if ((e.job || e.deliveryOrder || e.path.length || e.trafficGoal || e.work) && e.fuel > 0.01) {
    j.reason = 'Waiting for the current work or movement to stop safely';
    return true;
  }
  if (e.fuel >= e.tank - 0.1) {
    api.complete(s, j);
    return true;
  }
  const barrels = s.stacks
    .filter((t) => barrelAvailable(s, j, t))
    .sort((a, b) => dist(e, center(a)) - dist(e, center(b)) || a.id.localeCompare(b.id));
  if (!barrels.length) {
    j.reason = 'No available diesel in storage';
    return true;
  }
  const seated = s.workers.find((w) => w.id === e.operator);
  if (seated && seated.duty !== 'auto') {
    j.reason = `Waiting for ${seated.id} to release manual control or return to automatic duty`;
    return true;
  }
  const emergency = e.fuel <= 0.01 || !!e.cargo || !!e.assemblyLoad;
  let barrel: Stack | undefined, worker: Worker | undefined, path: Point[] | undefined;
  if (emergency) {
    // A parked, unloaded driver's own dry machine can be secured and serviced
    // by that driver. Suspended work still needs a separate ground worker.
    const safeAlighting =
      !e.cargo && !e.assemblyLoad && !e.job && !e.deliveryOrder && !e.path.length && !e.trafficGoal;
    const picks = barrels
      .map((stack) => ({
        stack,
        choice: selectWorker(s, workerApproachPoints(stack), {
          equipmentId: e.id,
          workId: j.parentId || j.id,
          preferredId: equipmentAssistant(s, e.id)?.id,
          allowJobId: e.job,
          allowVehicle: safeAlighting,
          eligible: (w) =>
            w.duty === 'auto' &&
            (!w.vehicle || (safeAlighting && w.vehicle === e.id)) &&
            workerSupportsEquipment(w, e.id),
        }),
      }))
      .filter((p) => p.choice)
      .sort((a, b) => a.choice!.score - b.choice!.score);
    barrel = picks[0]?.stack;
    worker = picks[0]?.choice?.worker;
    path = picks[0]?.choice?.path;
  } else {
    const choice = selectWorker(s, [machineStep(e)], {
      equipmentId: e.id,
      workId: j.parentId || j.id,
      preferredId: e.operator,
      allowVehicle: true,
      eligible: (w) =>
        w.duty === 'auto' &&
        w.role === 'operator' &&
        (!w.vehicle || w.vehicle === e.id) &&
        (!e.operator || w.id === e.operator),
    });
    barrel = barrels[0];
    worker = choice?.worker;
    path = choice?.path;
  }
  if (!barrel || !worker || !path) {
    j.reason = emergency
      ? 'No available worker with walking access for stationary emergency can service'
      : 'No available automatic operator with access to the equipment cab';
    return true;
  }
  j.stack = barrel.id;
  j.worker = worker.id;
  j.equipment = e.id;
  j.resumeJob = worker.job;
  j.fuelWork = { mode: emergency ? 'emergency' : 'station', barrelId: barrel.id, delivered: 0 };
  if (emergency)
    j.fuelWork.emergencyReason =
      e.fuel <= 0.01
        ? 'Tank empty or too low to drive safely'
        : 'Current load must remain supported; do not divert the machine';
  e.refueling = j.id;
  if (!e.job) e.job = j.id;
  worker.job = j.id;
  worker.path = path;
  noteWorkerAssignment(s, worker, { equipmentId: e.id, workId: j.parentId || j.id });
  j.operator = emergency ? undefined : worker.id;
  j.status = 'doing';
  j.elapsed = 0;
  j.progress = 0;
  j.reason = '';
  j.phase = emergency
    ? worker.vehicle === e.id
      ? 'Alight for fuel'
      : 'Collect fuel'
    : worker.vehicle === e.id
      ? 'Drive to diesel barrel'
      : 'Board equipment';
  worker.status = emergency
    ? 'Collecting emergency service can'
    : worker.vehicle === e.id
      ? 'Driving to diesel barrel'
      : 'Board equipment for refueling';
  api.event(
    s,
    'Fuel',
    j.id,
    emergency
      ? `Stationary emergency can service for ${e.id}: ${j.fuelWork.emergencyReason}; original work and supported load retained.`
      : `${worker.id} will drive ${e.id} to an accessible service position near ${barrel.id}.`,
  );
  s.revision++;
  return true;
}

function walkTo(s: State, j: Job, w: Worker, target: Point | undefined, api: FuelAPI) {
  if (w.transition || w.vehicle || w.yieldingTo) return false;
  if (!target) {
    if (j.fuelWork) j.fuelWork.retryAt = s.elapsed + 1.5;
    blocked(s, j, api, 'No walking access to the selected diesel drum');
    return false;
  }
  if (dist(w, target) < 0.18 && !w.path.length) return true;
  const f = j.fuelWork;
  if (w.path.length && !w.blockedBy) return false;
  if (f && s.elapsed < (f.retryAt || 0)) return false;
  const route = walkRoute(s, w, target, staticObstacleRects(s));
  if (f) f.retryAt = s.elapsed + 1.5;
  if (!route) {
    blocked(s, j, api, 'No clear walking route between the diesel drum and the equipment filler');
    return false;
  }
  w.path = route;
  clearBlocked(s, j);
  return false;
}
function barrelPoint(s: State, w: Worker, barrel: Stack) {
  return workerApproachPoints(barrel)
    .sort((a, b) => dist(w, a) - dist(w, b))
    .find((p) => walkRoute(s, w, p, staticObstacleRects(s)) !== null);
}
/** A completed pedestrian escape need not wait for a vehicle's whole job.
 * Resume only by a real walking route outside that vehicle's remaining swept
 * chassis, tool and cargo corridor, including its turns. Never return blindly
 * to the work point which triggered the clearance request. */
function resumeAfterYield(s: State, j: Job, w: Worker, e: Equipment, barrel?: Stack) {
  if (!w.yieldingTo || w.path.length || w.transition || w.vehicle) return false;
  const requester = s.equipment.find((q) => q.id === w.yieldingTo);
  if (!requester || !['Collect fuel', 'Fill service can', 'Carry fuel'].includes(j.phase))
    return false;
  const f = j.fuelWork!;
  if (s.elapsed < (f.retryAt || 0)) return false;
  f.retryAt = s.elapsed + 1.5;
  const corridor = equipmentBoxes(requester);
  let from = { x: requester.x, z: requester.z },
    yaw = requester.yaw || 0;
  for (const to of [...requester.path, ...(requester.trafficGoal ? [requester.trafficGoal] : [])]) {
    const length = dist(from, to);
    if (length < 1e-6) continue;
    const nextYaw = Math.atan2(to.z - from.z, to.x - from.x) + (requester.reverse ? Math.PI : 0);
    const turnCount = Math.max(1, Math.ceil(Math.abs(angleDelta(yaw, nextYaw)) / 0.15));
    const count = Math.max(1, Math.ceil(length / 0.5));
    // An oversized imported route must not allocate an unbounded sweep.
    // Retain its clearance lease when this bounded preview cannot prove safety.
    if (corridor.length + (turnCount + count) * equipmentBoxes(requester).length > 4096)
      return false;
    for (let n = 1; n <= turnCount; n++)
      corridor.push(
        ...equipmentBoxes(requester, {
          ...from,
          yaw: yaw + (angleDelta(yaw, nextYaw) * n) / turnCount,
        }),
      );
    for (let n = 1; n <= count; n++)
      corridor.push(
        ...equipmentBoxes(requester, {
          x: from.x + ((to.x - from.x) * n) / count,
          z: from.z + ((to.z - from.z) * n) / count,
          yaw: nextYaw,
        }),
      );
    from = to;
    yaw = nextYaw;
  }
  const targets =
    j.phase === 'Carry fuel'
      ? [equipmentFuelStandingPoint(e)]
      : barrel
        ? workerApproachPoints(barrel).sort((a, b) => dist(w, a) - dist(w, b))
        : [];
  for (const target of targets) {
    if (corridor.some((box) => personTouchesBox(target, box, 0.5))) continue;
    const route = walkRoute(s, w, target, staticObstacleRects(s));
    if (!route) continue;
    let prior: Point = w,
      safe = true;
    for (const next of route) {
      const count = Math.max(1, Math.ceil(dist(prior, next) / 0.2));
      for (let n = 1; n <= count; n++) {
        const pose = {
          x: prior.x + ((next.x - prior.x) * n) / count,
          z: prior.z + ((next.z - prior.z) * n) / count,
        };
        if (corridor.some((box) => personTouchesBox(pose, box, 0.5))) {
          safe = false;
          break;
        }
      }
      if (!safe) break;
      prior = next;
    }
    if (!safe) continue;
    w.yieldingTo = undefined;
    w.yieldTarget = undefined;
    w.path = route;
    w.status = 'Returning to fuel service by a clear approach';
    if (requester.trafficYieldWorker === w.id) requester.trafficYieldWorker = undefined;
    if (requester.blockedBy === w.id) requester.blockedBy = undefined;
    f.retryAt = undefined;
    j.elapsed = 0;
    clearBlocked(s, j);
    return true;
  }
  return false;
}
function finishFuel(s: State, j: Job, api: FuelAPI) {
  clearBlocked(s, j);
  api.event(
    s,
    'Fuel',
    j.target!,
    `Refueling complete: ${(j.fuelWork?.delivered || 0).toFixed(1)} L from ${j.fuelWork?.barrelId || j.stack} using a service can.`,
  );
  api.complete(s, j);
}

/** Only this explicit travel phase permits the normal guarded movement loop
 * to drive a machine whose refueling reservation is active. */
export function equipmentRefuelingCanDrive(s: State, e: Equipment) {
  const j = s.jobs.find((j) => j.id === e.refueling),
    w = s.workers.find((w) => w.id === j?.worker);
  return (
    j?.status === 'doing' &&
    j.fuelWork?.mode === 'station' &&
    j.phase === 'Drive to diesel barrel' &&
    w?.vehicle === e.id &&
    e.operator === w.id &&
    w.duty === 'auto'
  );
}

export function equipmentRefuelingProblem(s: State, j: Job): string | undefined {
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (
    j.fuelLiters !== undefined &&
    (j.kind !== 'refuel' || !finite(j.fuelLiters) || j.fuelLiters < 0 || j.fuelLiters > 20.000001)
  )
    return 'invalid equipment service-can quantity';
  const f = j.fuelWork;
  if (!f) return;
  if (
    j.kind !== 'refuel' ||
    !['station', 'emergency'].includes(f.mode) ||
    typeof f.barrelId !== 'string' ||
    !f.barrelId ||
    !finite(f.delivered) ||
    f.delivered < 0 ||
    ['retryAt', 'blockedSince', 'canAmount', 'canDelivered'].some(
      (k) => (f as any)[k] !== undefined && (!finite((f as any)[k]) || (f as any)[k] < 0),
    ) ||
    (f.warned !== undefined && typeof f.warned !== 'boolean') ||
    (f.emergencyReason !== undefined &&
      (typeof f.emergencyReason !== 'string' || !f.emergencyReason)) ||
    (f.mode === 'emergency' && !f.emergencyReason) ||
    (f.station !== undefined &&
      (!finite(f.station.x) ||
        !finite(f.station.z) ||
        Math.abs(f.station.x) >= 10000 ||
        Math.abs(f.station.z) >= 10000 ||
        !finite(f.station.yaw) ||
        typeof f.station.reverse !== 'boolean')) ||
    (f.canAmount || 0) > 20.000001 ||
    (f.canDelivered || 0) > (f.canAmount || 0) + 0.000001 ||
    Math.abs((j.fuelLiters || 0) + (f.canDelivered || 0) - (f.canAmount || 0)) > 0.000001 ||
    (f.canDelivered || 0) > f.delivered + 0.000001
  )
    return 'invalid equipment refueling state';
  if (!active(j))
    return (j.fuelLiters || 0) > 0
      ? 'completed equipment refueling retains fuel in its can'
      : undefined;
  const e = s.equipment.find((e) => e.id === j.target),
    w = s.workers.find((w) => w.id === j.worker),
    barrel = s.stacks.find((t) => t.id === f.barrelId);
  if (
    j.status !== 'doing' ||
    j.qty !== 0 ||
    j.item !== undefined ||
    !e ||
    j.equipment !== e.id ||
    e.refueling !== j.id ||
    !w ||
    w.job !== j.id ||
    !barrel ||
    barrel.item !== 'diesel' ||
    j.stack !== barrel.id ||
    ![
      'Board equipment',
      'Drive to diesel barrel',
      'Alight for fuel',
      'Collect fuel',
      'Fill service can',
      'Carry fuel',
    ].includes(j.phase) ||
    (f.mode === 'station' &&
      (j.operator !== w.id ||
        w.role !== 'operator' ||
        e.job !== j.id ||
        !!e.cargo ||
        !!e.assemblyLoad)) ||
    ((j.fuelLiters || 0) > 0 && (j.phase !== 'Carry fuel' || !!w.vehicle || !!w.transition)) ||
    (j.phase === 'Drive to diesel barrel' && (w.vehicle !== e.id || e.operator !== w.id)) ||
    (['Collect fuel', 'Fill service can', 'Carry fuel'].includes(j.phase) && !!w.vehicle)
  )
    return 'invalid equipment refueling assignment or phase';
}

export function tickEquipmentRefueling(s: State, j: Job, dt: number, api: FuelAPI): boolean {
  if (j.kind !== 'refuel') return false;
  const e = s.equipment.find((e) => e.id === j.equipment),
    w = s.workers.find((w) => w.id === j.worker);
  if (!e || !w) {
    j.reason = 'Refueling equipment or worker no longer exists';
    return true;
  }
  const barrel = s.stacks.find((t) => t.id === (j.fuelWork?.barrelId || j.stack));
  // Existing saves with a physical can retain that can and stationary service.
  j.fuelWork ??= {
    mode: 'emergency',
    barrelId: j.stack!,
    emergencyReason: 'Existing saved stationary can service',
    delivered: 0,
    canAmount: j.fuelLiters || 0,
    canDelivered: 0,
  };
  j.qty = 0;
  const f = j.fuelWork;
  if (w.yieldingTo && !w.path.length && w.duty === 'auto') resumeAfterYield(s, j, w, e, barrel);
  if (w.duty !== 'auto' || w.yieldingTo || w.transition) {
    if (j.phase === 'Fill service can') j.elapsed = 0;
    if (w.duty !== 'auto')
      blocked(s, j, api, 'Assigned refueling worker is under manual control or resting');
    else if (w.yieldingTo && !w.path.length)
      blocked(
        s,
        j,
        api,
        `Waiting for a safe fuel-service approach outside ${w.yieldingTo}'s driving corridor`,
      );
    return true;
  }
  if (j.phase === 'Board equipment') {
    if (w.vehicle === e.id) {
      j.phase = 'Drive to diesel barrel';
      j.elapsed = 0;
    } else if (walkTo(s, j, w, machineStep(e), api)) {
      clearBlocked(s, j);
      boardMachine(w, e);
    }
    return true;
  }
  if (j.phase === 'Drive to diesel barrel') {
    if (w.vehicle !== e.id || e.operator !== w.id) {
      blocked(s, j, api, 'The assigned operator must be seated before equipment can drive');
      return true;
    }
    if (e.fuel <= 0.01) {
      f.mode = 'emergency';
      f.emergencyReason = 'Fuel exhausted on the physical drive to the drum';
      e.path = [];
      e.trafficGoal = undefined;
      api.event(
        s,
        'Fuel',
        j.id,
        `${e.id}: ${f.emergencyReason}; switching to stationary emergency can service without relocating the equipment.`,
      );
      j.phase = 'Alight for fuel';
    } else if (e.path.length || e.trafficGoal) {
      if (e.blockedBy) blocked(s, j, api, `Driving route blocked by ${e.blockedBy}`);
      return true;
    } else if (f.station && dist(e, f.station) < 0.15) {
      clearBlocked(s, j);
      j.phase = 'Alight for fuel';
      api.event(
        s,
        'Fuel',
        e.id,
        `Parked near ${f.barrelId}; ${w.id} will alight and carry the refueling can.`,
      );
    } else {
      if (s.elapsed < (f.retryAt || 0)) return true;
      f.retryAt = s.elapsed + 2;
      let selected = barrel;
      let chosen = selected && serviceRoute(s, e, w, selected);
      if (!chosen) {
        for (const candidate of s.stacks
          .filter((t) => t.id !== barrel?.id && barrelAvailable(s, j, t))
          .sort((a, b) => dist(e, center(a)) - dist(e, center(b)))) {
          chosen = serviceRoute(s, e, w, candidate);
          if (chosen) {
            selected = candidate;
            break;
          }
        }
      }
      if (!chosen) {
        blocked(
          s,
          j,
          api,
          'No accessible equipment service position at the diesel drum; clear a driving and walking route',
        );
        return true;
      }
      if (selected!.id !== f.barrelId) {
        api.event(
          s,
          'Fuel',
          j.id,
          `Selected accessible ${selected!.id} instead of obstructed ${f.barrelId} before driving or collecting any diesel.`,
        );
        j.stack = selected!.id;
        f.barrelId = selected!.id;
      }
      f.station = chosen.station;
      e.reverse = chosen.station.reverse;
      e.path = chosen.path;
      clearBlocked(s, j);
      w.status = `Driving ${e.id} to ${selected!.id}`;
    }
    return true;
  }
  if (j.phase === 'Alight for fuel') {
    if (w.vehicle === e.id) {
      const step = machineStep(e);
      if (workerMoveBlocked(s, { id: w.id, x: -10000, z: -10000 }, step)) {
        blocked(s, j, api, 'The equipment cab step is obstructed; clear space before alighting');
        return true;
      }
      leaveMachine(s, w);
      return true;
    }
    j.phase = 'Collect fuel';
    w.status = 'Collecting fuel';
    clearBlocked(s, j);
    return true;
  }
  if (j.phase === 'Collect fuel' || j.phase === 'Fill service can') {
    if (j.cancel || e.fuel >= e.tank - 0.001 || !barrel || (barrel.liters || 0) <= 0.001) {
      finishFuel(s, j, api);
      return true;
    }
    // Walking already has an accepted route. Do not solve four long drum-face
    // routes every animation tick, or replace a traffic escape mid-walk.
    if (w.path.length && !w.blockedBy) {
      if (j.phase === 'Fill service can') j.elapsed = 0;
      return true;
    }
    if (j.phase === 'Collect fuel' && s.elapsed < (f.retryAt || 0)) return true;
    const target = barrelPoint(s, w, barrel);
    if (!walkTo(s, j, w, target, api)) {
      if (j.phase === 'Fill service can') j.elapsed = 0;
      return true;
    }
    if (!turn(w, Math.atan2(center(barrel).z - w.z, center(barrel).x - w.x), dt, 3)) return true;
    if (j.phase === 'Collect fuel') {
      clearBlocked(s, j);
      j.phase = 'Fill service can';
      j.elapsed = 0;
      w.status = `Filling service can at ${barrel.id}`;
      return true;
    }
    j.elapsed = Math.min(4, j.elapsed + dt);
    j.progress = Math.min(1, j.elapsed / 4);
    if (j.elapsed < 4) return true;
    if (s.elapsed < (f.retryAt || 0)) return true;
    f.retryAt = s.elapsed + 1.5;
    // Verify the actual filler is reachable before withdrawing conserved fuel.
    const route = walkRoute(s, w, equipmentFuelStandingPoint(e), staticObstacleRects(s));
    if (!route) {
      blocked(s, j, api, 'No walking access to the equipment filler');
      return true;
    }
    clearBlocked(s, j);
    j.fuelLiters = Math.min(20, barrel.liters || 0, e.tank - e.fuel);
    f.canAmount = j.fuelLiters;
    f.canDelivered = 0;
    barrel.liters! -= j.fuelLiters;
    api.movement(
      s,
      'diesel',
      j.fuelLiters,
      barrel.id,
      canId(j),
      'Diesel collected in service can (liters)',
    );
    api.event(
      s,
      'Fuel',
      j.id,
      `Collected ${j.fuelLiters.toFixed(1)} L from ${barrel.id} into the service can.`,
    );
    w.path = route;
    f.retryAt = undefined;
    j.phase = 'Carry fuel';
    j.elapsed = 0;
    j.progress = 0;
    w.status = `Carrying ${j.fuelLiters.toFixed(1)} L service can`;
    s.revision++;
    return true;
  }
  if (j.phase === 'Carry fuel') {
    if (!walkTo(s, j, w, equipmentFuelStandingPoint(e), api)) return true;
    const filler = equipmentFuelFiller(e);
    if (!turn(w, Math.atan2(filler.z - w.z, filler.x - w.x), dt, 3)) return true;
    clearBlocked(s, j);
    j.elapsed += dt;
    j.progress = Math.min(1, j.elapsed / 6);
    w.status = `Pouring service can into ${e.id}`;
    const carried = j.fuelLiters || 0;
    const liters = Math.min(carried, e.tank - e.fuel, ((f.canAmount || carried) * dt) / 6);
    e.fuel += liters;
    j.fuelLiters = Math.max(0, carried - liters);
    f.canDelivered = (f.canDelivered || 0) + liters;
    f.delivered += liters;
    if (Math.abs(e.tank - e.fuel) < 1e-7) e.fuel = e.tank;
    if ((j.fuelLiters || 0) > 0.000001) return true;
    j.fuelLiters = 0;
    api.movement(
      s,
      'diesel',
      f.canDelivered || 0,
      canId(j),
      e.id,
      'Diesel poured into equipment tank (liters)',
    );
    api.event(
      s,
      'Fuel',
      e.id,
      `Transferred ${(f.canDelivered || 0).toFixed(1)} L from ${f.barrelId} using a service can.`,
    );
    f.canAmount = 0;
    f.canDelivered = 0;
    if (!j.cancel && e.fuel < e.tank - 0.001 && barrel && (barrel.liters || 0) > 0.001) {
      j.phase = 'Collect fuel';
      j.elapsed = 0;
      j.progress = 0;
      w.status = 'Returning empty service can';
    } else finishFuel(s, j, api);
    s.revision++;
  }
  return true;
}
