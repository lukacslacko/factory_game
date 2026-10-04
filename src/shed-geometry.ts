import type { Job, Point, RailWorkPose, ShedPartKind } from './types';
import { localPoint } from './motion';

/** The same six column locations as the finished, cardinally rotated shed. */
export function shedPostPoints(j: Pick<Job, 'x' | 'z' | 'w' | 'd' | 'rotation'>): Point[] {
  const w = j.rotation % 2 ? j.d : j.w;
  const d = j.rotation % 2 ? j.w : j.d;
  const c = { x: j.x + j.w / 2, z: j.z + j.d / 2, yaw: ((j.rotation % 2) * Math.PI) / 2 };
  return [-w / 2 + 0.18, w / 2 - 0.18].flatMap((x) =>
    [-d / 2 + 0.18, 0, d / 2 - 0.18].map((z) => localPoint(c, x, z)),
  );
}

export function shedComponentPose(j: Job, kind: ShedPartKind, index: number): RailWorkPose {
  const yaw = ((j.rotation % 2) * Math.PI) / 2;
  const w = j.rotation % 2 ? j.d : j.w;
  const d = j.rotation % 2 ? j.w : j.d;
  const c = { x: j.x + j.w / 2, z: j.z + j.d / 2, yaw };
  if (kind === 'post') return { ...shedPostPoints(j)[index], y: 2.255, yaw };
  if (kind === 'beam')
    return { ...localPoint(c, 0, [-d / 2 + 0.18, 0, d / 2 - 0.18][index]), y: 4.405, yaw };
  if (kind === 'wall')
    return { ...localPoint(c, ((index ? 1 : -1) * w) / 4, -d / 2), y: 2.105, yaw };
  if (kind === 'brace') return { ...localPoint(c, 0, -d / 2 + 0.1), y: 2.155, yaw };
  return {
    ...localPoint(c, -w / 2 + ((index + 0.5) * w) / 4, 0),
    y: 4.855 - (Math.abs(-w / 2 + ((index + 0.5) * w) / 4) / w) * 1.5,
    yaw,
  };
}
