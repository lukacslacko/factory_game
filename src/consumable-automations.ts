import { quoteCollection } from './collection';
import { orderLines } from './procurement';
import type { State } from './types';

export type ConsumableAutomations = NonNullable<State['automations']>;
export const DEFAULT_CONSUMABLE_AUTOMATIONS: ConsumableAutomations = {
  vehicleRefueling: true,
  fuelOrdering: true,
  emptyBarrelCollection: true,
  refuelAtPercent: 25,
  fuelReserveLiters: 200,
  fuelTargetLiters: 400,
  fuelDemandSeen: false,
};

export function consumableAutomations(s: State): ConsumableAutomations {
  return s.automations ?? DEFAULT_CONSUMABLE_AUTOMATIONS;
}

export function configureConsumableAutomations(
  s: State,
  changes: Partial<Omit<ConsumableAutomations, 'fuelDemandSeen'>>,
): string {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes))
    return 'Choose automation settings to change.';
  const allowed = ['vehicleRefueling', 'fuelOrdering', 'emptyBarrelCollection',
    'refuelAtPercent', 'fuelReserveLiters', 'fuelTargetLiters'];
  const entries = Object.entries(changes);
  if (!entries.length || entries.some(([key]) => !allowed.includes(key)))
    return 'Choose a known consumable automation setting.';
  const next = { ...consumableAutomations(s), ...changes };
  if (['vehicleRefueling', 'fuelOrdering', 'emptyBarrelCollection'].some(
    (key) => typeof next[key as keyof ConsumableAutomations] !== 'boolean'))
    return 'Automation switches must be on or off.';
  if (!Number.isInteger(next.refuelAtPercent) || next.refuelAtPercent < 1 ||
      next.refuelAtPercent > 90)
    return 'Set the refueling threshold between 1% and 90%.';
  if (!Number.isInteger(next.fuelReserveLiters) || next.fuelReserveLiters < 0 ||
      next.fuelReserveLiters > 20000 ||
      !Number.isInteger(next.fuelTargetLiters) || next.fuelTargetLiters < 200 ||
      next.fuelTargetLiters > 20000 || next.fuelTargetLiters <= next.fuelReserveLiters)
    return 'Set a reserve from 0 to 20,000 L and a higher target from 200 to 20,000 L.';
  s.automations = next;
  if (!next.vehicleRefueling)
    for (const shunter of s.shunters || []) {
      shunter.autoRefuelRequested = undefined;
      shunter.autoRefuelReason = undefined;
    }
  s.revision++;
  return '';
}

/** Diesel in vehicle tanks is reported separately: it cannot refill another vehicle. */
export function consumableAutomationStatus(s: State) {
  const config = consumableAutomations(s);
  const lowEquipment = s.equipment.filter((e) => e.fuel <= e.tank * config.refuelAtPercent / 100);
  const lowShunters = (s.shunters || []).filter((e) => e.phase !== 'ordered' &&
    e.phase !== 'delivering' && e.fuel <= e.tank * config.refuelAtPercent / 100);
  const storedLiters = s.stacks.filter((t) => t.item === 'diesel' && t.qty > 0)
    .reduce((sum, t) => sum + Math.max(0, t.liters || 0), 0);
  const incomingLiters = s.orders.filter((o) => !o.collectionId &&
    !['done', 'canceled'].includes(o.status)).flatMap(orderLines)
    .filter((line) => line.item === 'diesel')
    .reduce((sum, line) => sum + Math.max(0, line.qty - line.arrived) * 200, 0);
  const tankLiters = s.equipment.reduce((sum, e) => sum + Math.max(0, e.fuel), 0) +
    (s.shunters || []).reduce((sum, e) => sum + Math.max(0, e.fuel), 0);
  const emptyBarrels = s.stacks.filter((t) => t.item === 'diesel' && t.qty > 0 &&
    (t.liters || 0) <= 0.000001).length;
  return { settings: { ...config }, lowEquipment: lowEquipment.map((e) => e.id),
    lowShunters: lowShunters.map((e) => e.id), storedLiters, incomingLiters,
    tankLiters, emptyBarrels,
    shunterRequests: (s.shunters || []).filter((e) => e.autoRefuelRequested)
      .map((e) => ({ id: e.id, reason: e.autoRefuelReason || 'Waiting for a safe stop' })) };
}

interface AutomationAPI {
  refuelEquipment(s: State, equipmentId: string): string;
  refuelShunter(s: State, shunterId: string): string | undefined;
  purchaseDiesel(s: State, barrels: number): string[];
  collectBarrels(s: State, lines: { stackId: string; qty: number }[]):
    { ids: string[]; error?: string };
  event(s: State, type: string, entity: string, text: string): void;
}

/** Called at a bounded 10-second cadence; every action uses the manual physical workflow. */
export function tickConsumableAutomations(s: State, api: AutomationAPI) {
  const settings = consumableAutomations(s);
  const status = consumableAutomationStatus(s);
  const demand = status.lowEquipment.length + status.lowShunters.length > 0;
  if (demand && !settings.fuelDemandSeen) {
    s.automations = { ...settings, fuelDemandSeen: true };
    s.revision++;
  }
  if (settings.vehicleRefueling) {
    for (const equipmentId of status.lowEquipment) api.refuelEquipment(s, equipmentId);
    for (const shunter of s.shunters || []) {
      if (status.lowShunters.includes(shunter.id) && !shunter.refueling &&
          !shunter.autoRefuelRequested) {
        shunter.autoRefuelRequested = true;
        shunter.autoRefuelReason = 'Waiting for a safe stop';
        s.revision++;
      }
      if (!shunter.autoRefuelRequested || shunter.refueling || shunter.manualControl) continue;
      if (shunter.phase !== 'parked' || shunter.carIds?.length) continue;
      const reason = api.refuelShunter(s, shunter.id);
      if (!reason) {
        shunter.autoRefuelRequested = undefined;
        shunter.autoRefuelReason = undefined;
        s.revision++;
      } else if (shunter.autoRefuelReason !== reason) {
        shunter.autoRefuelReason = reason;
        s.revision++;
      }
    }
  }
  if (!consumableAutomations(s).fuelDemandSeen) return;
  if (settings.fuelOrdering &&
      status.storedLiters + status.incomingLiters < settings.fuelReserveLiters) {
    const barrels = Math.max(1, Math.ceil((settings.fuelTargetLiters -
      status.storedLiters - status.incomingLiters) / 200));
    const orders = api.purchaseDiesel(s, barrels);
    api.event(s, 'Automation', orders[0] || 'SITE',
      `Ordered ${barrels} diesel drum${barrels === 1 ? '' : 's'} to restore the refueling reserve.`);
  }
  if (!settings.emptyBarrelCollection ||
      s.collections?.some((c) => !['done', 'canceled'].includes(c.status) &&
        c.lines.some((line) => line.item === 'diesel'))) return;
  const lines: { stackId: string; qty: number }[] = [];
  for (const stack of s.stacks) {
    if (stack.item !== 'diesel' || stack.qty < 1 || (stack.liters || 0) > 0.000001)
      continue;
    const line = { stackId: stack.id, qty: 1 };
    if (quoteCollection(s, { lines: [line] }).valid) lines.push(line);
    if (lines.length >= 100) break;
  }
  if (!lines.length) return;
  const collected = api.collectBarrels(s, lines);
  if (!collected.error && collected.ids.length)
    api.event(s, 'Automation', collected.ids[0],
      `Requested physical collection of ${lines.length} empty diesel drum${lines.length === 1 ? '' : 's'}.`);
}
