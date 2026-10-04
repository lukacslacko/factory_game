import * as THREE from 'three';

type Surface = 'soil' | 'concrete' | 'asphalt' | 'ballast';
const textures = new Map<Surface, THREE.CanvasTexture>();
const materials = new Map<Surface, THREE.MeshStandardMaterial>();

/** Deterministic, local material detail. These textures never affect the yard state. */
export function surfaceTexture(kind: Surface) {
  const previous = textures.get(kind);
  if (previous) return previous;
  const size = kind === 'soil' ? 1024 : 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  let seed = { soil: 981, concrete: 127, asphalt: 541, ballast: 823 }[kind];
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const base = { soil: '#a5967b', concrete: '#b8b5ab', asphalt: '#51565b', ballast: '#858687' }[
    kind
  ];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  if (kind === 'soil') {
    // Wrapped patches keep the 32 m tile seamless and avoid a tiled speckle pattern.
    for (let i = 0; i < 70; i++) {
      const x = random() * size,
        y = random() * size,
        radius = 40 + random() * 160;
      const green = random() < 0.55;
      for (const dx of [-size, 0, size])
        for (const dy of [-size, 0, size]) {
          const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
          gradient.addColorStop(0, green ? 'rgba(91,109,54,.24)' : 'rgba(105,79,51,.20)');
          gradient.addColorStop(1, 'rgba(105,79,51,0)');
          ctx.fillStyle = gradient;
          ctx.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
        }
    }
  }
  const count = kind === 'soil' ? 90000 : kind === 'ballast' ? 4500 : 14000;
  for (let i = 0; i < count; i++) {
    const shade = random(),
      alpha = kind === 'ballast' ? 0.35 + random() * 0.5 : 0.04 + random() * 0.16;
    ctx.fillStyle = `rgba(${shade > 0.5 ? '239,233,221' : '52,48,43'},${alpha})`;
    const x = random() * size,
      y = random() * size;
    if (kind === 'ballast') {
      const r = 1.1 + random() * 3;
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y - r * 0.7);
      ctx.lineTo(x + r, y + r * 0.25);
      ctx.lineTo(x + r * 0.3, y + r);
      ctx.closePath();
      ctx.fill();
    } else ctx.fillRect(x, y, random() < 0.85 ? 1 : 2, 1 + random() * 1.2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (kind === 'soil') texture.repeat.set(1800 / 32, 1800 / 32);
  if (kind === 'asphalt') texture.repeat.set(200, 2.1);
  textures.set(kind, texture);
  return texture;
}

export function surfaceMaterial(kind: Surface) {
  if (!materials.has(kind)) {
    const texture = surfaceTexture(kind);
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      roughness: kind === 'concrete' ? 0.94 : 1,
      metalness: 0,
      bumpMap: texture,
      bumpScale: kind === 'ballast' ? 0.035 : kind === 'soil' ? 0.025 : 0.008,
    });
    materials.set(kind, m);
  }
  return materials.get(kind)!;
}
