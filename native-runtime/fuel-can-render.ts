/** Read-only presentation of the actual held service can, including empty trips. */
import type { Job, State, Worker } from '../src/types';
import { localPoint } from '../src/motion';
import { equipmentFuelFiller, equipmentFuelStandingPoint } from '../src/equipment-refueling';
import { workerApproachPoints } from '../src/worker-selection';

export function workerFuelCan(s: State, w: Worker, job?: Job) {
  const moving =
    !!w.path.length || !!w.yieldingTo || !!w.transition || Math.abs(w.velocity || 0) > 0.01;
  const near = (point: { x: number; z: number }, tolerance: number) =>
    Math.hypot(w.x - point.x, w.z - point.z) < tolerance;
  const barrelPort = (barrel: State['stacks'][number]) => ({
    ...localPoint(
      { x: barrel.x + barrel.w / 2, z: barrel.z + barrel.d / 2, yaw: barrel.yaw || 0 },
      0.13,
      0.06,
    ),
    y:
      0.94 +
      (barrel.baseHeight || 0) +
      (s.paving[`${Math.floor(barrel.x)},${Math.floor(barrel.z)}`] ? 0.105 : 0),
  });
  const shunter = (s.shunters || []).find((e) => e.refueling?.workerId === w.id);
  const refueling = shunter?.refueling;
  if (shunter && refueling) {
    if (['approach-engine'].includes(refueling.phase) || w.vehicle) return undefined;
    const barrel = s.stacks.find((t) => t.id === refueling.barrelId);
    const atBarrel =
      barrel &&
      [
        { x: barrel.x - 0.65, z: barrel.z + barrel.d / 2 },
        { x: barrel.x + barrel.w + 0.65, z: barrel.z + barrel.d / 2 },
        { x: barrel.x + barrel.w / 2, z: barrel.z - 0.65 },
        { x: barrel.x + barrel.w / 2, z: barrel.z + barrel.d + 0.65 },
      ].some((p) => near(p, 0.4));
    const phase =
      refueling.phase === 'fill-can' && !moving && atBarrel && refueling.clock > 0
        ? 'fill'
        : refueling.phase === 'pour' && !moving && near(localPoint(shunter, 1.8, 2), 0.4)
          ? 'pour'
          : refueling.carried > 0
            ? 'carry'
            : 'empty';
    return {
      capacity: 20,
      liters: refueling.carried,
      phase,
      clock: refueling.clock,
      sourceId: refueling.barrelId,
      targetId: shunter.id,
      target:
        phase === 'fill' && barrel
          ? barrelPort(barrel)
          : phase === 'pour'
            ? { ...localPoint(shunter, 1.8, 1.55), y: 1.1 }
            : undefined,
    };
  }
  if (
    job?.kind !== 'refuel' ||
    job.status !== 'doing' ||
    w.vehicle ||
    ['Board equipment', 'Drive to diesel barrel'].includes(job.phase)
  )
    return undefined;
  const machine = s.equipment.find((e) => e.id === job.target);
  const barrel = s.stacks.find((t) => t.id === job.stack);
  const phase =
    job.phase === 'Fill service can' &&
    !moving &&
    job.elapsed > 0 &&
    barrel &&
    workerApproachPoints(barrel).some((p) => near(p, 0.18))
      ? 'fill'
      : job.phase === 'Carry fuel' &&
          !moving &&
          job.elapsed > 0 &&
          machine &&
          near(equipmentFuelStandingPoint(machine), 0.18)
        ? 'pour'
        : (job.fuelLiters || 0) > 0
          ? 'carry'
          : 'empty';
  return {
    capacity: 20,
    liters: job.fuelLiters || 0,
    phase,
    clock: job.elapsed,
    sourceId: job.stack,
    targetId: job.target,
    target:
      phase === 'fill' && barrel
        ? barrelPort(barrel)
        : phase === 'pour' && machine
          ? equipmentFuelFiller(machine)
          : undefined,
  };
}
