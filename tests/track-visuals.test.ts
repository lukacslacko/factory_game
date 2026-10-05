import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MATERIALS, RAIL_CENTER_OFFSET } from '../src/catalog';
import { trackGeometry, trackSections } from '../src/track';
import {
  animateTurnout,
  stockRailModel,
  trackPanelModel,
  SPECIAL_TRACK_ITEMS,
} from '../src/track-visuals';

test('all special rail kits fit their declared physical transport and storage footprints', () => {
  for (const item of SPECIAL_TRACK_ITEMS)
    for (const hand of [1, -1] as const) {
      const model = stockRailModel(item, 1, hand);
      const box = new THREE.Box3().setFromObject(model);
      const material = MATERIALS[item];
      assert.ok(
        box.min.x >= -material.w / 2 && box.max.x <= material.w / 2,
        `${item}: spills length`,
      );
      assert.ok(
        box.min.z >= -material.d / 2 && box.max.z <= material.d / 2,
        `${item}: spills width ${box.min.z} .. ${box.max.z}`,
      );
    }
});

test('curve profile rail heads preserve gauge and align to every analytical installed segment', () => {
  for (const hand of [1, -1] as const)
    for (const piece of trackSections('curve', { x: 125, z: 5 }, 0, hand)) {
      const model = trackPanelModel(piece),
        pose = trackGeometry(piece).pose;
      model.position.set(pose.x, 0, pose.z);
      model.rotation.y = -pose.yaw;
      model.updateMatrixWorld(true);
      const rails: THREE.Mesh[] = [];
      model.traverse((object) => {
        if (object.name.startsWith('track-rail-')) rails.push(object as THREE.Mesh);
      });
      assert.equal(rails.length, 2);
      const expected = trackGeometry(piece).paths[0].points;
      const negative = rails.find((r) => r.userData.centerOffset < 0)!;
      const positive = rails.find((r) => r.userData.centerOffset > 0)!;
      for (let i = 0; i < expected.length; i++) {
        const a = negative.localToWorld(
          new THREE.Vector3().fromBufferAttribute(
            negative.geometry.getAttribute('position'),
            i * 12 + 6,
          ),
        );
        const b = positive.localToWorld(
          new THREE.Vector3().fromBufferAttribute(
            positive.geometry.getAttribute('position'),
            i * 12 + 7,
          ),
        );
        const p = expected[i],
          gap = b.clone().sub(a);
        const normalGap = -Math.sin(p.yaw) * gap.x + Math.cos(p.yaw) * gap.z;
        assert.ok(
          Math.abs(normalGap - 1.435) < 1e-5,
          'Actual inner rail-head faces must retain gauge in the world normal',
        );
        assert.ok(Math.abs(Math.cos(p.yaw) * gap.x + Math.sin(p.yaw) * gap.z) < 1e-5);
      }
      for (const rail of rails) {
        const positions = rail.geometry.getAttribute('position');
        assert.equal(positions.count, expected.length * 12);
        for (let i = 0; i < expected.length; i++) {
          // Profile vertices 6 and 7 are the two edges of the top rail head.
          const a = rail.localToWorld(
            new THREE.Vector3().fromBufferAttribute(positions, i * 12 + 6),
          );
          const b = rail.localToWorld(
            new THREE.Vector3().fromBufferAttribute(positions, i * 12 + 7),
          );
          assert.ok(Math.abs(a.distanceTo(b) - 0.072) < 1e-6);
          const center = a.clone().lerp(b, 0.5),
            p = expected[i];
          const offset = rail.userData.centerOffset;
          assert.ok(
            Math.hypot(
              center.x - (p.x - Math.sin(p.yaw) * offset),
              center.z - (p.z + Math.cos(p.yaw) * offset),
            ) < 1e-5,
          );
        }
      }
      assert.ok(Math.abs(2 * RAIL_CENTER_OFFSET - 0.072 - 1.435) < 1e-8);
    }
});

test('turnout frog interrupts crossing heads, and manual lever/blades reflect their selected route', () => {
  for (const hand of [1, -1] as const) {
    const pieces = trackSections('turnout', { x: 125, z: 5 }, 0, hand);
    const points = pieces[0];
    for (const route of ['straight', 'branch'] as const) {
      const model = trackPanelModel(points, 1, route);
      assert.equal(model.getObjectByName('turnout-manual-lever')!.userData.selectedRoute, route);
      assert.equal(model.getObjectByName('turnout-point-blades')!.userData.selectedRoute, route);
    }
    const frog = pieces.find((p) => p.section === 1 && p.route === 'branch')!;
    const model = trackPanelModel(frog);
    assert.ok(model.getObjectByName('turnout-crossing-frog'));
    for (const route of ['straight', 'branch'] as const) {
      const panel = pieces.find((p) => p.section === 1 && p.route === route)!;
      const head = trackPanelModel(panel).getObjectByName(
        `track-rail-${route}-${route === 'branch' ? -hand : hand}`,
      ) as THREE.Mesh;
      const maximum = (head.geometry.getAttribute('position').count / 12 - 1) * 12 * 6 + 10 * 6;
      assert.ok(
        head.geometry.index!.count < maximum,
        `${route} crossing head must contain a real frog gap`,
      );
    }
  }
});

test('manual switch throws and returns animate every intermediate lever and blade frame', () => {
  const piece = trackSections('turnout', { x: 125, z: 5 }, 0, 1)[0];
  const model = trackPanelModel(piece),
    arm = model.getObjectByName('turnout-lever-arm')!;
  const blade = model.getObjectByName('movable-point-1') as THREE.Mesh;
  const angles: number[] = [],
    tips: number[] = [];
  for (let frame = 0; frame <= 6; frame++) {
    animateTurnout(model, 'straight', 'branch', frame / 6);
    angles.push(arm.rotation.z);
    tips.push(blade.geometry.getAttribute('position').getZ(12 * 13 + 6));
  }
  assert.equal(new Set(angles.map((v) => v.toFixed(7))).size, 7);
  assert.equal(new Set(tips.map((v) => v.toFixed(7))).size, 7);
  for (let i = 1; i < angles.length; i++) {
    assert.ok(Math.abs(angles[i] - angles[i - 1]) <= 0.131);
    assert.ok(Math.abs(tips[i] - tips[i - 1]) < 0.1);
  }
  for (let frame = 6; frame >= 0; frame--) {
    animateTurnout(model, 'straight', 'branch', frame / 6);
    assert.ok(Math.abs(arm.rotation.z - angles[frame]) < 1e-8);
    assert.ok(
      Math.abs(blade.geometry.getAttribute('position').getZ(12 * 13 + 6) - tips[frame]) < 1e-6,
    );
  }
});
