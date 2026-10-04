import type * as THREE from 'three';
import { box } from './mesh';

/** Local candidate streams make scenery independent of construction filtering.
 * A removed plant never changes the coordinates or shape of its neighbors. */
export function sceneryRandom(seed: number, candidate: number) {
  let value = (seed ^ Math.imul(candidate + 1, 0x9e3779b9)) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Nonoverlapping rectangles for the two gate lanes and their westward approach.
 * The previous complete rectangles had identical tops in their intersection. */
export const GATE_PADS = [
  { x: -12.2, z: -12.9, w: 8.4, d: 28.8 },
  { x: -19.4, z: -11.3, w: 7.2, d: 10.4 },
] as const;

/** Thin hardstanding is a receiving surface, never a shadow occluder. Casting
 * shadows from faces almost touching soil produces broad self-shadow acne. */
export function groundPad(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
) {
  const mesh = box(parent, x, y, z, w, h, d, color);
  mesh.castShadow = false;
  mesh.name = 'hardstanding-surface';
  return mesh;
}
