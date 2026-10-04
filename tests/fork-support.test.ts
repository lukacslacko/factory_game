import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { forklift, animateMachine } from '../src/models';
import {
  FORK_HEEL,
  FORK_LENGTH,
  FORK_LOAD_CENTER,
  forkCarriageOffset,
  forkTip,
} from '../src/fork-geometry';

function model() {
  // Only the non-rendered specification plate needs a canvas in this geometry test.
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        getContext: () => ({
          fillRect() {},
          strokeRect() {},
          fillText() {},
          measureText: () => ({ width: 100 }),
        }),
      }),
    },
  });
  try {
    const g = new THREE.Group();
    forklift(g);
    return g;
  } finally {
    if (prior) Object.defineProperty(globalThis, 'document', prior);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('rail-panel bearings rest on both fixed-length forks, away from the tapered tips at every reach', () => {
  const g = model();
  for (const reach of [FORK_LOAD_CENTER, 3.85, 4, 4.8]) {
    const lift = 0.65;
    animateMachine(g, 'forklift', true, 0, lift, reach);
    g.updateMatrixWorld(true);
    const carriage = g.getObjectByName('fork-carriage')!;
    const contact = g.getObjectByName('cargo-contact')!.getWorldPosition(new THREE.Vector3());
    near(contact.x, reach);
    near(contact.y, lift);
    near(carriage.position.x, forkCarriageOffset(reach));
    // A 1.95 m panel clears the front of the backrest instead of intersecting it.
    assert.ok(reach - 1.95 / 2 > carriage.position.x + 1.25 + 0.14 / 2);
    const heel = FORK_HEEL + carriage.position.x;
    const flatEnd = heel + FORK_LENGTH * 0.81;
    const tines = carriage.children.filter((o) => o.name === 'fork-tine') as THREE.Mesh[];
    assert.equal(tines.length, 2);
    for (const tine of tines) {
      near(tine.scale.x, FORK_LENGTH);
      const bounds = new THREE.Box3().setFromObject(tine);
      near(bounds.min.x, heel);
      near(bounds.max.x, forkTip(reach));
      for (const bearingX of [reach - 0.82, reach + 0.82]) {
        assert.ok(bearingX > heel && bearingX < flatEnd);
        const ray = new THREE.Raycaster(
          new THREE.Vector3(bearingX, lift + 1, tine.position.z),
          new THREE.Vector3(0, -1, 0),
        );
        const hits = ray.intersectObject(tine);
        assert.ok(hits.length > 0, 'The actual tine geometry must support each rail bearing');
        near(hits[0].point.y, lift);
      }
    }
    const links = g
      .getObjectByName('fork-reach-frame')!
      .children.filter((o) => o.name === 'fork-reach-link');
    assert.equal(links.length, 8);
    for (const link of links) near(link.scale.y, 1.6);
  }
});

test('reach carriage stays attached during lift and preserves physical dimensions for imported reach values', () => {
  const g = model();
  for (const [lift, reach] of [
    [0.1, 4.8],
    [1.7, 3.85],
    [3.2, FORK_LOAD_CENTER],
  ]) {
    animateMachine(g, 'forklift', false, 0, lift, reach);
    g.updateMatrixWorld(true);
    const frame = g.getObjectByName('fork-reach-frame')!;
    near(frame.position.y, lift);
    const links = frame.children.filter((o) => o.name === 'fork-reach-link');
    for (const link of links) {
      const a = link.localToWorld(new THREE.Vector3(0, -0.5, 0));
      const b = link.localToWorld(new THREE.Vector3(0, 0.5, 0));
      near(a.distanceTo(b), 1.6);
      const stage = link.userData.stage;
      const half = (1.25 + forkCarriageOffset(reach) - 1.16) / 2;
      near(a.x, 1.16 + stage * half);
      near(b.x, 1.16 + (stage + 1) * half);
    }
  }
  near(forkTip(Number.NaN), FORK_HEEL + FORK_LENGTH);
});
