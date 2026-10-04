import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world.ts';
import { createState } from '../src/sim.ts';
import { GATE_PADS, groundPad } from '../src/terrain-visuals.ts';

function vegetation(world: World) {
  const result = new Map<string, string>();
  const matrix = new THREE.Matrix4(),
    color = new THREE.Color();
  for (const mesh of world.landscape.children as THREE.InstancedMesh[]) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      if (mesh.instanceColor) mesh.getColorAt(i, color);
      else color.setHex(0xffffff);
      const x = matrix.elements[12],
        z = matrix.elements[14];
      result.set(
        `${mesh.name || mesh.geometry.type}/${x}/${z}`,
        JSON.stringify({ matrix: matrix.elements, color: color.toArray() }),
      );
    }
  }
  return result;
}

test('paving and compacted cells only remove local scenery, never relocate unaffected plants', () => {
  // Exercise the actual landscape builder without a renderer, canvas, GPU, or
  // DOM. Only the constructor is bypassed; geometry and instance colors are real.
  const world = Object.create(World.prototype) as World;
  world.landscape = new THREE.Group();
  const state = createState();
  world.scatterGround(state);
  const before = vegetation(world);
  assert.ok(before.size > 5000);
  for (let x = 40; x < 60; x++)
    for (let z = 32; z < 55; z++) state.paving[`${x},${z}`] = 'test-paving';
  state.groundWear = { '80,70': 0.5, '81,70': 0.5 };
  world.scatterGround(state);
  const after = vegetation(world);
  assert.ok(after.size < before.size, 'Real construction removed scenery in its footprint');
  for (const [key, attributes] of after)
    assert.equal(
      before.get(key),
      attributes,
      'Every surviving instance keeps its position, size, rotation, and color',
    );
  world.scatterGround(state);
  assert.deepEqual(vegetation(world), after, 'Rebuilding an unchanged yard is exactly stable');
  world.disposeGroup(world.landscape);
});

test('gate hardstanding has no coplanar intersections or ground shadow occluders', () => {
  for (let i = 0; i < GATE_PADS.length; i++)
    for (let j = i + 1; j < GATE_PADS.length; j++) {
      const a = GATE_PADS[i],
        b = GATE_PADS[j];
      assert.ok(
        Math.min(a.x + a.w, b.x + b.w) <= Math.max(a.x, b.x) + 1e-9 ||
          Math.min(a.z + a.d, b.z + b.d) <= Math.max(a.z, b.z) + 1e-9,
      );
    }
  const group = new THREE.Group();
  for (const p of GATE_PADS) {
    const mesh = groundPad(group, p.x + p.w / 2, 0.02, p.z + p.d / 2, p.w, 0.1, p.d, 0x797a76);
    assert.equal(mesh.castShadow, false, 'Flat hardstanding never self-shadows against the soil');
    assert.equal(
      mesh.receiveShadow,
      true,
      'Equipment and people still cast shadows onto the surface',
    );
    assert.ok(mesh.position.y + mesh.scale.y / 2 > 0, 'Visible face is above the soil');
  }
});
