import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function material(color: number, roughness = 0.85, metalness = 0) {
  const key = `${color}/${roughness}/${metalness}`;
  if (!matCache.has(key))
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return matCache.get(key)!;
}
export const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export function bevelBox(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
  radius = 0.04,
  metalness = 0,
) {
  const m = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 4, h / 4, d / 4)),
    material(color, 0.78, metalness),
  );
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function box(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
  metal = 0,
) {
  const m = new THREE.Mesh(boxGeo, material(color, 0.8, metal));
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function cylinder(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  color: number,
  sides = 12,
) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, sides), material(color, 0.65, 0.15));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function beam(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  width: number,
  color: number,
) {
  const m = box(parent, 0, 0, 0, width, a.distanceTo(b), width, color, 0.4);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
export function wheel(parent: THREE.Object3D, x: number, y: number, z: number, r = 0.46) {
  const t = cylinder(parent, x, y, z, r, 0.24, 0x252d2b);
  t.rotation.x = Math.PI / 2;
  const hub = cylinder(parent, x, y, z + (z > 0 ? 0.14 : -0.14), r * 0.42, 0.04, 0xb7b9aa);
  hub.rotation.x = Math.PI / 2;
}
export function sign(
  parent: THREE.Object3D,
  text: string,
  x: number,
  y: number,
  z: number,
  w = 1.5,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f1e9d5';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#384d45';
  ctx.lineWidth = 5;
  ctx.strokeRect(2, 2, 252, 60);
  ctx.fillStyle = '#243c35';
  let fontSize = 29;
  ctx.font = `bold ${fontSize}px monospace`;
  while (ctx.measureText(text).width > 232 && fontSize > 8)
    ctx.font = `bold ${--fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 43);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, w / 4),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
  );
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
