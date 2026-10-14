import { EQUIPMENT } from './catalog';
import { equipmentAllows } from './equipment-roles';
import { equipmentHasAssignedWork } from './jobs';
import { diagnoseLogisticsDependencies, type DependencyDiagnosis } from './logistics-dependencies';
import { planStorageMove, storageMoveSourceError } from './storage-moves';
import type { Equipment, LogisticsPolicy, State, Worker } from './types';
import { workerAvailable } from './workforce';

/** These are saved preferences, not permission to move material without a crew.
 * Automatic dispatch additionally requires a hired officer actually on shift. */
export const DEFAULT_LOGISTICS_POLICY: Readonly<LogisticsPolicy> = Object.freeze({
  automaticStockRelocation: true,
  automaticIdleClearance: true,
  minimumWaitSeconds: 20,
  maxActiveRelocations: 1,
});

export function logisticsPolicy(s: State): LogisticsPolicy {
  return { ...DEFAULT_LOGISTICS_POLICY, ...s.logisticsPolicy };
}

/** Atomic configuration: invalid edits never partially change a saved game. */
export function configureLogisticsPolicy(
  s: State,
  patch: Partial<LogisticsPolicy>,
): string {
  const allowed = new Set<keyof LogisticsPolicy>([
    'automaticStockRelocation', 'automaticIdleClearance',
    'minimumWaitSeconds', 'maxActiveRelocations',
  ]);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some((key) => !allowed.has(key as keyof LogisticsPolicy)))
    return 'Choose a supported logistics policy setting.';
  const next = { ...logisticsPolicy(s), ...patch };
  if (typeof next.automaticStockRelocation !== 'boolean' ||
      typeof next.automaticIdleClearance !== 'boolean' ||
      !Number.isInteger(next.minimumWaitSeconds) ||
      next.minimumWaitSeconds < 5 || next.minimumWaitSeconds > 600 ||
      !Number.isInteger(next.maxActiveRelocations) ||
      next.maxActiveRelocations < 1 || next.maxActiveRelocations > 3)
    return 'Wait must be 5–600 seconds and active relocations 1–3.';
  s.logisticsPolicy = next;
  s.revision++;
  return '';
}

/** An off-shift or manually held officer cannot silently organize work. */
export function onDutyLogisticsOfficers(s: State): Worker[] {
  return s.workers.filter((w) =>
    w.role === 'logisticsOfficer' && w.duty === 'auto' &&
    workerAvailable(s, w) &&
    !w.job && !w.vehicle && !w.deliveryOrder && !w.transportOrder &&
    !w.commuteOrder && !w.transition);
}

export type LogisticsOfficerAction =
  | {
      kind: 'relocate-stock';
      officerId: string;
      rootId: string;
      sourceId: string;
      equipmentId: string;
      quantity: number;
      zoneId: string;
      reason: string;
    }
  | {
      kind: 'clear-idle-equipment';
      officerId: string;
      rootId: string;
      equipmentId: string;
      reason: string;
    };

/** Call only after the ordinary move request actually created physical jobs.
 * The two-attempt budget is per blocked work/source pair, across save/load. */
export function recordLogisticsOfficerAction(
  s: State,
  action: LogisticsOfficerAction,
): void {
  if (action.kind !== 'relocate-stock') return;
  const history = s.logisticsOfficerAttempts ||= [];
  history.push({ rootId: action.rootId, sourceId: action.sourceId, at: s.elapsed });
  if (history.length > 64) history.splice(0, history.length - 64);
  s.revision++;
}

export interface LogisticsOfficerReview {
  /** Diagnostics are available even in a yard without an officer. */
  diagnoses: DependencyDiagnosis[];
  policy: LogisticsPolicy;
  onDutyOfficerIds: string[];
  /** At most one checked proposal per review; execution must recheck it. */
  action?: LogisticsOfficerAction;
}

const active = (status: string) => status === 'todo' || status === 'doing';
const idle = (e: Equipment) =>
  !e.job && !e.path.length && !e.cargo && !e.deliveryOrder &&
  !e.transportOrder && !e.refueling && e.fuel > 0;

/** Inspect dependencies before requesting any ordinary physical job. This
 * function never changes state, allocates a worker, or teleports stock.
 * Submission must recheck the proposed source/equipment/zone atomically. */
export function reviewLogisticsOfficer(s: State): LogisticsOfficerReview {
  const diagnoses = diagnoseLogisticsDependencies(s).diagnoses;
  const policy = logisticsPolicy(s);
  const officers = onDutyLogisticsOfficers(s);
  const result: LogisticsOfficerReview = {
    diagnoses, policy, onDutyOfficerIds: officers.map((w) => w.id),
  };
  if (!officers.length) return result;
  const relocationCount = s.jobs.filter((j) =>
    j.kind === 'moveStock' && active(j.status)).length;
  for (const diagnosis of diagnoses) {
    if (diagnosis.waitSeconds < policy.minimumWaitSeconds ||
        diagnosis.classification === 'cycle' ||
        diagnosis.classification === 'fixed' ||
        diagnosis.classification === 'player-action') continue;
    const owner = s.jobs.find((j) => j.id === diagnosis.id);
    if (owner && (!active(owner.status) || owner.cancel ||
        owner.railPickupRecovery?.activeJobId)) continue;

    if (policy.automaticStockRelocation &&
        relocationCount < policy.maxActiveRelocations &&
        diagnosis.classification === 'physical-relocation') {
      const blockers = diagnosis.edges
        .filter((edge) => edge.entity === 'stock' &&
          edge.mobility === 'physical-relocation')
        .map((edge) => edge.to);
      for (const id of new Set(blockers)) {
        if ((s.logisticsOfficerAttempts || []).filter((attempt) =>
          attempt.rootId === diagnosis.id && attempt.sourceId === id).length >= 2)
          continue;
        const stock = s.stacks.find((t) => t.id === id);
        if (!stock || stock.qty < 1 || storageMoveSourceError(s, stock) ||
            s.jobs.some((j) => j.kind === 'moveStock' && active(j.status) &&
              j.stockMove?.sourceId === id)) continue;
        // Keep each action finite. For rail stock, clearing a pile's footprint
        // requires moving all its panels; each lift still uses normal jobs.
        const quantity = Math.min(stock.qty, stock.item.startsWith('rail') ? 8 : 12);
        const machines = s.equipment
          .filter((e) => idle(e) && equipmentAllows(e, 'recovery') &&
            !equipmentHasAssignedWork(s, e) &&
            EQUIPMENT[e.kind].capacity >= 1)
          .sort((a, b) =>
            Math.hypot(a.x - stock.x, a.z - stock.z) -
              Math.hypot(b.x - stock.x, b.z - stock.z))
          .slice(0, 4);
        for (const machine of machines) {
          const plan = planStorageMove(s, {
            id, quantity, equipmentId: machine.id,
          });
          // An unverified space reservation is never an automatic promise.
          if (plan.error || !plan.zoneId ||
              !plan.readiness?.includes('checked with site crew')) continue;
          result.action = {
            kind: 'relocate-stock', officerId: officers[0].id,
            rootId: diagnosis.id, sourceId: id, equipmentId: machine.id,
            quantity, zoneId: plan.zoneId,
            reason: `Clear ${id} for ${diagnosis.id} with checked physical stock handling.`,
          };
          return result;
        }
      }
    }

    if (policy.automaticIdleClearance && diagnosis.classification === 'temporary') {
      for (const edge of diagnosis.edges) {
        if (edge.entity !== 'equipment' ||
            !['action-clearance', 'traffic'].includes(edge.kind)) continue;
        const machine = s.equipment.find((e) => e.id === edge.to);
        if (!machine || !idle(machine) ||
            !s.workers.some((w) => w.id === machine.operator &&
              w.vehicle === machine.id && w.duty === 'auto' &&
              w.shiftPhase !== 'home' && w.shiftPhase !== 'aboard')) continue;
        result.action = {
          kind: 'clear-idle-equipment', officerId: officers[0].id,
          rootId: diagnosis.id, equipmentId: machine.id,
          reason: `Move idle ${machine.id} clear of ${diagnosis.id}'s work area.`,
        };
        return result;
      }
    }
  }
  return result;
}
