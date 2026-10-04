import type { State, Worker, Equipment, Point } from './types';
import { localPoint, smoothstep } from './motion';
export function machineStep(e: Equipment) {
  return localPoint({ ...e, yaw: e.yaw ?? (e.heading * Math.PI) / 2 }, -0.2, 1.85);
}
export function leaveMachine(s: State, w: Worker): Point {
  const e = s.equipment.find((e) => e.id === w.vehicle);
  if (!e) return w;
  const p = machineStep(e),
    from = { x: e.x, z: e.z, y: (e.y || 0) + 0.7 };
  w.vehicle = undefined;
  e.operator = undefined;
  w.transition = { kind: 'exit', equipmentId: e.id, clock: 0, from, to: { ...p, y: e.y || 0 } };
  w.x = from.x;
  w.z = from.z;
  w.y = from.y;
  w.status = 'Climbing down from machine';
  return p;
}
export function boardMachine(w: Worker, e: Equipment) {
  w.transition = {
    kind: 'enter',
    equipmentId: e.id,
    clock: 0,
    from: { x: w.x, z: w.z, y: w.y || 0 },
    to: { x: e.x, z: e.z, y: (e.y || 0) + 0.7 },
  };
  w.status = 'Climbing into machine';
}
export function tickBoarding(s: State, w: Worker, dt: number) {
  const t = w.transition;
  if (!t) return;
  t.clock += dt;
  const a = smoothstep(t.clock / 1.4);
  w.x = t.from.x + (t.to.x - t.from.x) * a;
  w.z = t.from.z + (t.to.z - t.from.z) * a;
  w.y = t.from.y + (t.to.y - t.from.y) * a;
  if (a < 1) return;
  if (t.kind === 'enter') {
    const e = s.equipment.find((e) => e.id === t.equipmentId);
    if (e) {
      w.vehicle = e.id;
      e.operator = w.id;
      w.status = 'Available in cab';
    }
  } else w.status = w.path.length ? 'Walking' : 'Available';
  w.transition = undefined;
}
