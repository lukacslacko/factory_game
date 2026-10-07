import type { State, Worker, Equipment, Order, Point, Rect } from './types';
import { dist } from './path';
import { angleDelta, turn, localPoint } from './motion';
import { boardMachine, leaveMachine, machineStep } from './boarding';
import {
  machineRoute,
  walkRoute,
  equipmentMoveBlocked,
  equipmentSweepBlocked,
  staticObstacleRects,
} from './traffic';
import { equipmentHasAssignedWork, automaticEquipmentHasWork } from './jobs';

export interface WorkforceAPI {
  id(s: State, type: string): string;
  event(s: State, type: string, entity: string, text: string): void;
  obstacles(s: State): Rect[];
}
/** Shift hours follow the displayed game clock, including shifts across midnight. */
export function shiftIsActive(s: State, w: Worker) {
  if (!w.schedule) return true;
  const hour = (((s.time / 3600) % 24) + 24) % 24;
  const { start, end } = w.schedule;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
/** Availability for NEW work only. Existing cargo/jobs finish safely after a shift ends. */
export function workerAvailable(s: State, w: Worker) {
  return (
    shiftIsActive(s, w) &&
    !w.railAssignment &&
    !w.processAssignment &&
    !w.commuteOrder &&
    !w.parkingEquipment &&
    !w.yieldingTo &&
    (!w.shiftPhase || w.shiftPhase === 'working') &&
    !w.transportOrder
  );
}
export function setWorkerSchedule(
  s: State,
  workerId: string,
  startHour: number | null,
  endHour?: number,
): string {
  const w = s.workers.find((w) => w.id === workerId);
  if (!w) return 'Worker not found.';
  if (
    startHour !== null &&
    (!Number.isFinite(startHour) ||
      !Number.isFinite(endHour) ||
      startHour < 0 ||
      startHour >= 24 ||
      endHour! < 0 ||
      endHour! >= 24 ||
      startHour === endHour)
  )
    return 'Enter different start and end hours between 0 and 24.';
  w.schedule = startHour === null ? undefined : { start: startHour, end: endHour! };
  s.events.push({
    id: `EV-${String(s.next++).padStart(4, '0')}`,
    time: s.time,
    type: 'Schedule',
    entity: w.id,
    text: w.schedule
      ? `Daily shift ${w.schedule.start}:00–${w.schedule.end}:00; charter bus transport at shift changes.`
      : 'Schedule changed to Always on.',
  });
  s.revision++;
  return '';
}
export function setEquipmentParking(
  s: State,
  equipmentId: string,
  x: number,
  z: number,
  rotation: number,
): string {
  const e = s.equipment.find((e) => e.id === equipmentId);
  if (!e) return 'Equipment not found.';
  if (
    ![x, z, rotation].every(Number.isFinite) ||
    x < -12 ||
    x > 220 ||
    z < 7 ||
    z > 110 ||
    !Number.isInteger(x) ||
    !Number.isInteger(z) ||
    !Number.isInteger(rotation)
  )
    return 'Choose a whole-meter parking position inside the yard and a cardinal direction.';
  const yaw = ((((rotation % 4) + 4) % 4) * Math.PI) / 2;
  const pose = { x, z, yaw };
  const blocked = equipmentMoveBlocked(s, e, pose);
  if (blocked)
    return `Parking space blocked by ${blocked}. Choose a clear bay or the open part of a shed.`;
  if (s.equipment.some((q) => q.id !== e.id && q.parking && dist(q.parking, pose) < 3.5))
    return 'Another machine has a parking bay too close to this position.';
  e.parking = { x, z, rotation: ((rotation % 4) + 4) % 4 };
  e.parkingState = undefined;
  e.parkingReason = undefined;
  s.revision++;
  return '';
}
export function clearEquipmentParking(s: State, equipmentId: string): string {
  const e = s.equipment.find((e) => e.id === equipmentId);
  if (!e) return 'Equipment not found.';
  const w = s.workers.find((w) => w.parkingEquipment === e.id);
  if (w) {
    w.parkingEquipment = undefined;
    if (!w.vehicle) w.path = [];
  }
  e.parkingOperator = undefined;
  e.parking = undefined;
  e.parkingState = undefined;
  e.parkingReason = undefined;
  s.revision++;
  return '';
}
export function parkingStatus(_s: State, e: Equipment) {
  if (!e.parking) return 'No assigned parking bay';
  return (
    e.parkingReason ||
    {
      'waiting-operator': 'Waiting for an operator to park',
      boarding: 'Operator boarding for parking',
      driving: 'Driving to parking bay',
      aligning: 'Aligning in parking bay',
      parked: 'Parked',
    }[e.parkingState || 'waiting-operator']
  );
}
function busy(w: Worker) {
  return !!(w.job || w.deliveryOrder || w.transportOrder || w.transition);
}
function machineBusy(e: Equipment) {
  return !!(e.job || e.deliveryOrder || e.transportOrder || e.refueling || e.cargo || e.work);
}
function parkingTick(s: State, e: Equipment, dt: number, api: WorkforceAPI) {
  if (!e.parking || machineBusy(e)) {
    if (machineBusy(e)) e.parkingState = undefined;
    return;
  }
  if (
    (equipmentHasAssignedWork(s, e) ||
      automaticEquipmentHasWork(s, e) ||
      s.orders.some(
        (o) => o.status === 'unloading' && o.arrived < o.qty && o.automaticEquipment === e.id,
      )) &&
    (!e.operator ||
      shiftIsActive(
        s,
        s.workers.find((w) => w.id === e.operator)!,
      ))
  )
    return;
  const seated = s.workers.find((w) => w.id === e.operator);
  if (seated?.duty === 'manual' && shiftIsActive(s, seated) && !seated.parkingEquipment) return;
  const atBay = dist(e, e.parking) < 0.08;
  const aligned =
    Math.abs(angleDelta(e.yaw ?? (e.heading * Math.PI) / 2, (e.parking.rotation * Math.PI) / 2)) <
    0.025;
  if (atBay && aligned && !e.path.length) {
    if (e.parkingState !== 'parked') {
      e.parkingState = 'parked';
      e.parkingReason = undefined;
      e.parkingOperator = undefined;
      const driver = s.workers.find((w) => w.parkingEquipment === e.id);
      if (driver) driver.parkingEquipment = undefined;
      api.event(s, 'Parking', e.id, 'Parked in the assigned bay.');
      s.revision++;
    }
    return;
  }
  if (e.parkingState === 'parked') e.parkingState = undefined;
  // Do not divert an existing player movement command.
  if (!e.parkingState && e.path.length) return;
  let w = s.workers.find((w) => w.id === (e.operator || e.parkingOperator));
  if (w && w.vehicle !== e.id) {
    if (!w.path.length && !w.transition) {
      if (dist(w, machineStep(e)) < 0.3) boardMachine(w, e);
      else {
        const path = walkRoute(s, w, machineStep(e), staticObstacleRects(s));
        if (path) w.path = path;
      }
    }
    return;
  }
  if (!w) {
    e.parkingState = 'waiting-operator';
    if (s.elapsed < (e.parkingRetry || 0)) return;
    e.parkingRetry = s.elapsed + 2;
    w = s.workers.find(
      (w) =>
        w.role === 'operator' &&
        w.duty === 'auto' &&
        workerAvailable(s, w) &&
        !busy(w) &&
        !w.vehicle &&
        !w.path.length,
    );
    if (!w) return;
    const path = walkRoute(s, w, machineStep(e), staticObstacleRects(s));
    if (!path) {
      e.parkingReason = 'Operator cannot reach machine';
      return;
    }
    w.path = path;
    w.status = `Park ${e.id}`;
    w.parkingEquipment = e.id;
    e.parkingOperator = w.id;
    e.parkingState = 'boarding';
    return;
  }
  if (busy(w)) return;
  w.parkingEquipment = e.id;
  e.parkingOperator = w.id;
  if (e.fuel <= 0.01) {
    e.parkingReason = 'Fuel required before driving to parking';
    return;
  }
  if (e.path.length) return;
  if (!atBay) {
    if (s.elapsed < (e.parkingRetry || 0)) return;
    e.parkingRetry = s.elapsed + 2;
    const path = machineRoute(s, e, e.parking, api.obstacles(s), 2);
    if (!path) {
      e.parkingReason = 'No clear driving route to parking bay';
      return;
    }
    e.path = path;
    e.parkingState = 'driving';
    e.parkingReason = undefined;
    w.status = 'Driving to parking bay';
  } else {
    e.parkingState = 'aligning';
    const next = { ...e };
    turn(next, (e.parking.rotation * Math.PI) / 2, dt, 0.85);
    const blocker = equipmentSweepBlocked(s, e, next);
    if (blocker) {
      e.parkingReason = `Parking turn blocked by ${blocker}`;
      return;
    }
    e.yaw = next.yaw;
    e.heading = Math.round((e.yaw || 0) / (Math.PI / 2));
    e.parkingReason = undefined;
  }
}
function charter(
  s: State,
  workers: Worker[],
  direction: 'outbound' | 'inbound',
  api: WorkforceAPI,
) {
  if (!workers.length) return;
  // One bus has twelve seats. New runs are dispatched if a long operation finishes later.
  const passengers = workers.slice(0, 12),
    id = api.id(s, 'order');
  const o: Order = {
    id,
    item: 'builder',
    qty: passengers.length,
    arrived: 0,
    mode: 'road',
    status: 'ordered',
    eta: s.time,
    total: 180,
    invoiced: false,
    vehicle: { x: -75, z: -13 },
    stage: 0,
    handler: { x: 20, z: 20 },
    handling: 0,
    note: `Chartered shift bus · ${direction}`,
    commute: { direction, workers: passengers.map((w) => w.id) },
  };
  s.orders.push(o);
  for (const w of passengers) {
    w.commuteOrder = id;
    if (direction === 'inbound') w.shiftPhase = 'returning';
  }
  api.event(
    s,
    'Transport',
    id,
    `Chartered ${direction} bus for ${passengers.map((w) => w.id).join(', ')}.`,
  );
  s.revision++;
}
export function tickWorkforce(s: State, dt: number, api: WorkforceAPI) {
  for (const w of s.workers) {
    if (w.railAssignment || w.processAssignment) continue;
    if (w.commuteOrder) {
      const o = s.orders.find((o) => o.id === w.commuteOrder);
      if (o?.status === 'done') {
        if (o.commute?.direction === 'outbound') {
          w.shiftPhase = 'home';
          w.status = 'Home';
          w.transportOrder = undefined;
          w.y = 0;
          w.path = [];
        } else {
          w.shiftPhase = 'working';
          w.status = 'Available';
        }
        w.commuteOrder = undefined;
        s.revision++;
      }
      continue;
    }
    if (w.shiftPhase === 'home' || w.shiftPhase === 'returning') continue;
    if (!shiftIsActive(s, w)) {
      if (!w.shiftPhase || w.shiftPhase === 'working') {
        w.shiftPhase = 'finishing';
        api.event(s, 'Shift', w.id, 'Shift ended; finish current operation, park and go home.');
        s.revision++;
      }
      if (busy(w)) {
        w.status =
          w.job || w.deliveryOrder
            ? `${w.status.replace(/ · shift ending$/, '')} · shift ending`
            : w.status;
        continue;
      }
      if (w.parkingEquipment && !w.vehicle) {
        w.shiftPhase = 'parking';
        continue;
      }
      if (w.vehicle) {
        const e = s.equipment.find((e) => e.id === w.vehicle);
        if (e && (machineBusy(e) || e.path.length)) continue;
        if (e?.parking && e.parkingState !== 'parked') {
          w.shiftPhase = 'parking';
          continue;
        }
        leaveMachine(s, w);
        continue;
      }
      w.shiftPhase = 'walking-to-bus';
    } else if (['finishing', 'parking', 'walking-to-bus'].includes(w.shiftPhase || '')) {
      w.shiftPhase = 'working';
      w.status = 'Available';
      s.revision++;
    }
  }
  for (const e of s.equipment) parkingTick(s, e, dt, api);
  const outbound = s.workers.filter(
    (w) => w.shiftPhase === 'walking-to-bus' && !w.commuteOrder && !busy(w),
  );
  const inbound = s.workers.filter(
    (w) => w.shiftPhase === 'home' && shiftIsActive(s, w) && !w.commuteOrder,
  );
  // A bus already dispatched for a direction accepts no magically added passengers.
  if (!s.orders.some((o) => o.commute?.direction === 'outbound' && o.status !== 'done'))
    charter(s, outbound, 'outbound', api);
  if (!s.orders.some((o) => o.commute?.direction === 'inbound' && o.status !== 'done'))
    charter(s, inbound, 'inbound', api);
}
/** The door's outside foot is two meters clear of the bus centerline. */
export function commuteDoor(o: Order): Point {
  return localPoint({ ...o.vehicle, yaw: o.drive?.yaw || 0 }, 1.35, 2.15);
}
