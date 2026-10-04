import * as THREE from 'three';
import type { Job, ShedPartKind } from './types';
import { shedComponentPose } from './shed-geometry';
import { box, beam } from './mesh';

export const SHED_COMPONENT_COUNTS = { post: 6, beam: 3, roof: 4, wall: 2, brace: 1 } as const;
export function shedComponentModel(j: Job, kind: ShedPartKind, index: number) {
  const g = new THREE.Group();
  g.name = `shed-${kind}-${index}`;
  const w = j.rotation % 2 ? j.d : j.w,
    d = j.rotation % 2 ? j.w : j.d;
  if (kind === 'post') box(g, 0, 0, 0, 0.16, 4.3, 0.16, 0x617079, 0.4);
  else if (kind === 'beam') {
    beam(
      g,
      new THREE.Vector3(-w / 2 + 0.18, -0.4, 0),
      new THREE.Vector3(0, 0.4, 0),
      0.12,
      0x73818a,
    );
    beam(g, new THREE.Vector3(w / 2 - 0.18, -0.4, 0), new THREE.Vector3(0, 0.4, 0), 0.12, 0x73818a);
    beam(
      g,
      new THREE.Vector3(-w / 2 + 0.18, -0.4, 0),
      new THREE.Vector3(w / 2 - 0.18, -0.4, 0),
      0.09,
      0x73818a,
    );
  } else if (kind === 'roof') {
    const width = w / 4,
      stripCenter = -w / 2 + (index + 0.5) * width;
    const ridgeHeight = 4.855,
      centerHeight = ridgeHeight - (Math.abs(stripCenter) / w) * 1.5;
    for (let x = -width / 2; x < width / 2 - 0.005; x += 0.23) {
      const ribWidth = Math.min(0.225, width / 2 - x);
      const offset = x + ribWidth / 2;
      const y = ridgeHeight - (Math.abs(stripCenter + offset) / w) * 1.5 - centerHeight;
      box(g, offset, y, 0, ribWidth, 0.09, d + 0.45, 0xaeb8bd, 0.25);
    }
  } else if (kind === 'wall') {
    const width = w / 2;
    box(g, 0, 0, 0, width, 3.8, 0.08, 0xb0bcc0);
    for (let x = -width / 2 + 0.12; x < width / 2; x += 0.23)
      box(g, x, 0, 0.045, 0.025, 3.8, 0.025, 0xa1adb5, 0.3);
  } else {
    beam(
      g,
      new THREE.Vector3(-w / 2 + 0.18, -1.95, 0),
      new THREE.Vector3(w / 2 - 0.18, 1.95, 0),
      0.06,
      0x616b72,
    );
  }
  return g;
}
export function assembledShed(j: Job) {
  const g = new THREE.Group();
  for (const [kind, count] of Object.entries(SHED_COMPONENT_COUNTS))
    for (let i = 0; i < count; i++) {
      const part = shedComponentModel(j, kind as ShedPartKind, i),
        p = shedComponentPose(j, kind as ShedPartKind, i);
      part.position.set(p.x, p.y, p.z);
      part.rotation.y = -p.yaw;
      g.add(part);
    }
  return g;
}
