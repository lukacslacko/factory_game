import type { Equipment, EquipmentWorkRole, Job } from './types';

export const EQUIPMENT_ROLES: Record<EquipmentWorkRole, string> = {
  all: 'All work',
  receiving: 'Receiving only',
  paving: 'Paving only',
  construction: 'Building only',
  rail: 'Rail work only',
  recovery: 'Recovery only',
  hold: 'Hold new work',
};
export type EquipmentActivity = Exclude<EquipmentWorkRole, 'all' | 'hold'>;
export const equipmentRole = (e: Pick<Equipment, 'workRole'>): EquipmentWorkRole =>
  e.workRole ?? 'all';
export const equipmentAllows = (e: Equipment, activity: EquipmentActivity) =>
  equipmentRole(e) === 'all' || equipmentRole(e) === activity;
export function jobActivity(j: Pick<Job, 'kind'>): EquipmentActivity {
  return j.kind === 'slab'
    ? 'paving'
    : j.kind === 'rail'
      ? 'rail'
      : j.kind === 'remove'
        ? 'recovery'
        : 'construction';
}
