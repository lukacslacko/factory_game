import * as THREE from 'three';
import type { State } from './types';

/** A single ground decal, refreshed at most twice a second, independent of
 * static asset rebuilds. The simulation owns compaction; this only displays it. */
export class WornPaths {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private paint = document.createElement('canvas');
  private paintContext: CanvasRenderingContext2D;
  private elapsed = -1;
  private revision = -1;
  private texture: THREE.CanvasTexture;
  private state?: State;
  private nextUpdate = -Infinity;
  constructor() {
    this.canvas.width = 2048;
    this.canvas.height = 1024;
    this.context = this.canvas.getContext('2d')!;
    this.paint.width = this.canvas.width;
    this.paint.height = this.canvas.height;
    this.paintContext = this.paint.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 190),
      new THREE.MeshStandardMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    this.mesh.name = 'equipment-worn-paths';
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(100, 0.004, 55);
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
  }
  update(s: State) {
    const now = performance.now() / 1000;
    if (this.state === s && now < this.nextUpdate) return false;
    if (this.state === s && this.elapsed === s.elapsed && this.revision === s.revision)
      return false;
    this.state = s;
    this.elapsed = s.elapsed;
    this.revision = s.revision;
    this.nextUpdate = now + 0.5;
    const ctx = this.context,
      sx = this.canvas.width / 300,
      sz = this.canvas.height / 190;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let count = 0;
    // Feather adjacent wheel/track cells into continuous compacted lanes. Marks
    // remain below slabs and are omitted on pavement, rather than painted on it.
    const paint = this.paintContext;
    paint.clearRect(0, 0, this.paint.width, this.paint.height);
    for (const [key, wear] of Object.entries(s.groundWear || {})) {
      if (wear < 0.015 || s.paving[key]) continue;
      const [x, z] = key.split(',').map(Number);
      if (x < -50 || x >= 250 || z < -40 || z >= 150) continue;
      paint.fillStyle = `rgba(100,82,60,${Math.min(0.58, wear * 0.62)})`;
      paint.fillRect((x + 50) * sx, (z + 40) * sz, sx, sz);
      count++;
    }
    // Blur the finished lane mask once. Filtering thousands of individual
    // cells creates thousands of offscreen filter passes in large yards.
    ctx.filter = 'blur(2px)';
    ctx.drawImage(this.paint, 0, 0);
    ctx.filter = 'none';
    // Fine repeated scuffs break up the broad compaction without drawing a
    // grid of identical tire icons or inventing vehicle travel.
    for (const [key, wear] of Object.entries(s.groundWear || {})) {
      if (wear < 0.12 || s.paving[key]) continue;
      const [x, z] = key.split(',').map(Number);
      let seed = ((x * 73856093) ^ (z * 19349663)) >>> 0;
      for (let i = 0; i < 7; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const a = (seed % 1000) / 1000;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const b = (seed % 1000) / 1000;
        ctx.fillStyle = `rgba(71,59,43,${wear * 0.16})`;
        ctx.fillRect((x + 50 + a) * sx, (z + 40 + b) * sz, 1.2, 0.7);
      }
    }
    this.mesh.visible = count > 0;
    this.texture.needsUpdate = true;
    return true;
  }
}
