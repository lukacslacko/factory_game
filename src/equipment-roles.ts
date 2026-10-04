import type { Equipment, EquipmentWorkRole, EquipmentActivity, Job } from './types';
export type { EquipmentActivity } from './types';

export const EQUIPMENT_ROLES: Record<EquipmentWorkRole, string> = {
  all: 'All work',
  receiving: 'Receiving only',
  paving: 'Paving only',
  construction: 'Building only',
  rail: 'Rail work only',
  recovery: 'Recovery only',
  hold: 'Hold new work',
};
export const EQUIPMENT_ACTIVITIES: Record<EquipmentActivity, string> = {
  receiving: 'Receiving deliveries',
  paving: 'Paving',
  construction: 'Building',
  rail: 'Rail work',
  recovery: 'Recovery / dismantling',
};
export const equipmentRole = (e: Pick<Equipment, 'workRole'>): EquipmentWorkRole =>
  e.workRole ?? 'all';
export function equipmentActivities(
  e: Pick<Equipment, 'workRole' | 'allowedWork'>,
): EquipmentActivity[] {
  if (e.allowedWork !== undefined) return [...e.allowedWork];
  const role = equipmentRole(e);
  return role === 'all'
    ? (Object.keys(EQUIPMENT_ACTIVITIES) as EquipmentActivity[])
    : role === 'hold'
      ? []
      : [role];
}
export function equipmentWorkSummary(e: Pick<Equipment, 'workRole' | 'allowedWork'>): string {
  const activities = equipmentActivities(e);
  if (!activities.length) return EQUIPMENT_ROLES.hold;
  if (activities.length === Object.keys(EQUIPMENT_ACTIVITIES).length) return EQUIPMENT_ROLES.all;
  return activities.map((activity) => EQUIPMENT_ACTIVITIES[activity]).join(' + ');
}
export const equipmentAllows = (e: Equipment, activity: EquipmentActivity) =>
  e.allowedWork !== undefined
    ? e.allowedWork.includes(activity)
    : equipmentRole(e) === 'all' || equipmentRole(e) === activity;
export function jobActivity(j: Pick<Job, 'kind'>): EquipmentActivity {
  return j.kind === 'slab'
    ? 'paving'
    : j.kind === 'rail'
      ? 'rail'
      : j.kind === 'remove'
        ? 'recovery'
        : 'construction';
}
