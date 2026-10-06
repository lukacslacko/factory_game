import type { State, Equipment, Order, Worker } from './types';
import { localPoint } from './motion';
import { dist } from './path';
import { machineRoute, staticObstacleRects } from './traffic';

export interface DeliveryControlState {
  order: Order;
  operator: Worker;
  paused: boolean;
  canPause: boolean;
  reason: string;
}

function control(
  s: State,
  equipmentId: string,
): { order: Order; equipment: Equipment; operator: Worker } | undefined {
  const equipment = s.equipment.find((e) => e.id === equipmentId);
  const order = s.orders.find((o) => o.unload?.equipmentId === equipmentId);
  const operator = s.workers.find((w) => w.id === order?.unload?.operatorId);
  return equipment && order && operator ? { equipment, order, operator } : undefined;
}
function pauseReason(s: State, equipmentId: string): string {
  const c = control(s, equipmentId);
  if (!c) return 'This machine has no active delivery handling assignment.';
  const { equipment: e, order: o, operator: w } = c;
  if (
    w.vehicle !== e.id ||
    e.operator !== w.id ||
    w.deliveryOrder !== o.id ||
    e.deliveryOrder !== o.id
  )
    return 'The assigned delivery operator must be seated in the machine before taking control.';
  if (w.transition || w.transportOrder || w.commuteOrder || w.parkingEquipment)
    return 'Finish boarding or transport before taking control.';
  const t = o.unload!;
  if (!['clear', 'carry', 'back-away'].includes(t.phase))
    return 'Finish the current rigging, lifting, lowering, or release step before taking control.';
  if (t.phase === 'clear' && (t.riggerId || (!o.unloadPaused && e.path.length)))
    return 'Finish withdrawing clear of the carrier before taking control.';
  if (['clear', 'carry'].includes(t.phase) && (!e.cargo || !t.cargo))
    return 'The delivery load must be supported by the assigned machine before taking control.';
  return '';
}
export function deliveryControlState(
  s: State,
  equipmentId: string,
): DeliveryControlState | undefined {
  const c = control(s, equipmentId);
  if (!c) return undefined;
  const reason = pauseReason(s, equipmentId);
  return {
    order: c.order,
    operator: c.operator,
    paused: !!c.order.unloadPaused,
    canPause: !reason,
    reason,
  };
}
export function isPausedDeliveryOperator(s: State, w: Worker): boolean {
  if (!w.vehicle || !w.deliveryOrder) return false;
  const c = control(s, w.vehicle);
  return !!c?.order.unloadPaused && c.operator.id === w.id && !pauseReason(s, w.vehicle);
}
function activity(s: State, o: Order, text: string, severity: 'info' | 'warning' = 'info'): void {
  s.events.push({
    id: `EV-${String(s.next++).padStart(4, '0')}`,
    time: s.time,
    type: 'Delivery',
    entity: o.id,
    text,
    severity,
  });
}
export function pauseDeliveryHandling(s: State, equipmentId: string): string {
  const reason = pauseReason(s, equipmentId);
  if (reason) return reason;
  const { equipment: e, order: o, operator: w } = control(s, equipmentId)!;
  if (o.unloadPaused) return '';
  o.unloadPaused = true;
  o.unloadOperatorDuty = w.duty;
  w.duty = 'manual';
  w.status = 'Manual delivery recovery';
  e.path = [];
  e.velocity = 0;
  e.work = 0;
  e.trafficGoal = undefined;
  e.trafficYieldEquipment = undefined;
  e.trafficReverse = undefined;
  e.trafficWait = 0;
  o.note = `Unloading paused for manual repositioning of ${e.id}; ${w.id} retains the load and assignment`;
  activity(
    s,
    o,
    `Paused unloading with ${e.id}. ${w.id} retains the supported load, destination, and delivery assignment.`,
  );
  s.revision++;
  return '';
}
export function resumeDeliveryHandling(s: State, equipmentId: string): string {
  const c = control(s, equipmentId);
  if (!c) return 'This machine has no active delivery handling assignment.';
  const { equipment: e, order: o, operator: w } = c;
  if (!o.unloadPaused) return 'Delivery handling is not paused.';
  const reason = pauseReason(s, equipmentId);
  if (reason) return reason;
  const t = o.unload!;
  let withdrawal: { path: Equipment['path']; reverse: boolean } | undefined;
  if (t.phase === 'back-away') {
    const target = localPoint({ ...t.drop, yaw: t.dropYaw }, -2.8, 0);
    if (dist(e, target) > 0.04) {
      for (const reverse of [true, false]) {
        const path = machineRoute(s, { ...e, reverse }, target, staticObstacleRects(s), 350, true);
        if (path) {
          withdrawal = { path, reverse };
          break;
        }
      }
      if (!withdrawal)
        return 'No clear route to finish withdrawing the forks. Reposition the machine or clear the storage aisle, then resume.';
    }
  }
  o.unloadPaused = undefined;
  w.duty = o.unloadOperatorDuty || 'auto';
  o.unloadOperatorDuty = undefined;
  e.path = [];
  e.velocity = 0;
  e.work = 0;
  e.trafficGoal = undefined;
  e.trafficYieldEquipment = undefined;
  e.trafficReverse = undefined;
  e.trafficRetry = undefined;
  e.trafficWait = 0;
  e.blockedBy = undefined;
  if (withdrawal) {
    e.path = withdrawal.path;
    e.reverse = withdrawal.reverse;
  }
  if (o.unload!.phase === 'clear') {
    o.unload!.phase = 'carry';
    o.unload!.clock = 0;
  }
  // The ordinary handler replans the same physical delivery from the current
  // loaded pose. No stock, invoice, destination, or carrier cargo is recreated.
  o.note = `Resuming unloading from ${e.id}'s current position`;
  w.status = 'Resuming delivery';
  activity(s, o, `Resumed unloading from ${e.id}'s current physical position.`);
  resetDeliveryBlockage(s, o);
  s.revision++;
  return '';
}

/** A persistent blockage becomes one actionable warning, rather than a silent wait. */
export function deliveryBlockageNotice(s: State, o: Order, reason: string, timeout = 20): void {
  if (o.unloadPaused) return;
  if (!o.unloadBlockage) o.unloadBlockage = { since: s.elapsed, reason };
  const b = o.unloadBlockage;
  b.reason = reason;
  if (b.warned || s.elapsed - b.since + 1e-7 < timeout) return;
  b.warned = true;
  const equipment = o.unload?.equipmentId || o.automaticEquipment;
  const detail = `${equipment ? `${equipment} handling ${o.id}: ` : `${o.id}: `}${reason}. Select the machine to inspect its route. Pause unloading for manual repositioning once the load is safely supported, then resume to retry.`;
  s.notices.unshift({
    id: `N-${String(s.next++).padStart(4, '0')}`,
    time: s.time,
    title: 'Delivery handling blocked',
    detail,
    entity: equipment || o.id,
    state: 'todo',
    seen: false,
  });
  activity(s, o, detail, 'warning');
  s.revision++;
}
export function resetDeliveryBlockage(s: State, o: Order): void {
  o.unloadBlockage = undefined;
}
