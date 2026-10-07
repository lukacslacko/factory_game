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

export function shedPartLimits(j: Pick<Job, 'kind'>) {
  return j.kind === 'engineShed'
    ? { post: 6, beam: 3, roof: 8, wall: 6, brace: 0 }
    : { post: 6, beam: 3, roof: 4, wall: 2, brace: 1 };
}
export function shedPartSize(
  j: Pick<Job, 'kind' | 'rotation' | 'w' | 'd'>,
  kind: ShedPartKind,
  index: number,
): [number, number] {
  const w = j.rotation % 2 ? j.d : j.w,
    d = j.rotation % 2 ? j.w : j.d;
  if (j.kind === 'engineShed')
    return kind === 'post'
      ? [0.16, 0.16]
      : kind === 'beam'
        ? [w, 0.2]
        : kind === 'roof'
          ? [w / 4, d / 2 + 0.22]
          : kind === 'wall'
            ? index < 4
              ? [d / 2, 0.12]
              : [w, 0.55]
            : [w, 0.1];
  return kind === 'post'
    ? [0.16, 0.16]
    : kind === 'beam'
      ? [w, 0.2]
      : kind === 'roof'
        ? [w / 4, d + 0.45]
        : kind === 'wall'
          ? [w / 2, 0.08]
          : [w, 0.1];
}
export function shedComponentPose(j: Job, kind: ShedPartKind, index: number): RailWorkPose {
  const yaw = ((j.rotation % 2) * Math.PI) / 2;
  const w = j.rotation % 2 ? j.d : j.w;
  const d = j.rotation % 2 ? j.w : j.d;
  const c = { x: j.x + j.w / 2, z: j.z + j.d / 2, yaw };
  if (j.kind === 'engineShed') {
    if (kind === 'post') return { ...shedPostPoints(j)[index], y: 2.855, yaw };
    if (kind === 'beam')
      return { ...localPoint(c, 0, [-d / 2 + 0.18, 0, d / 2 - 0.18][index]), y: 5.605, yaw };
    if (kind === 'wall')
      return index < 4
        ? {
            ...localPoint(c, (index < 2 ? -1 : 1) * (w / 2 - 0.08), ((index % 2 ? 1 : -1) * d) / 4),
            y: 2.655,
            yaw: yaw + Math.PI / 2,
          }
        : { ...localPoint(c, 0, (index === 4 ? -1 : 1) * (d / 2 - 0.12)), y: 5.75, yaw };
    const x = -w / 2 + (((index % 4) + 0.5) * w) / 4;
    return {
      ...localPoint(c, x, ((index < 4 ? -1 : 1) * d) / 4),
      y: 6.055 - (Math.abs(x) / w) * 1.5,
      yaw,
    };
  }
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
