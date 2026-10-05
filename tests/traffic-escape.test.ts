import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources } from './support/yard';
import { dist } from '../src/path';
import { equipmentSweepBlocked, equipmentTravelSpeed } from '../src/traffic';

// Actual geometry captured during the larger starter-base scenario: an empty
// forklift's first escape was blocked by the other machine's carried shed kit.
function encounter() {
  const s = S.createState(),
    fork = seedHandlingResources(s),
    crane = seedHandlingResources(s, 'excavator');
  Object.assign(fork, {
    x: 17.71213477295936,
    z: 48.41912526155593,
    yaw: 41.890704496667304,
    heading: 3,
    reverse: false,
    reach: 3,
    lift: -0.025,
    path: [{ x: 17.71213477295936, z: 46.13514341212452 }],
    trafficGoal: { x: 29.5, z: 45.4 },
    trafficWait: 20,
    blockedBy: crane.id,
  });
  Object.assign(crane, {
    x: 20.61821700905533,
    z: 44.49814931041091,
    yaw: 27.374333882308147,
    heading: 1,
    reverse: true,
    reach: 2.1,
    lift: 1.18,
    cargo: { item: 'shed', qty: 1 },
    path: [{ x: 16, z: 43.4 }],
    trafficWait: 20,
    blockedBy: fork.id,
  });
  for (const [e, w] of [
    [fork, s.workers[0]],
    [crane, s.workers[1]],
  ] as const) {
    e.operator = w.id;
    w.vehicle = e.id;
    w.x = e.x;
    w.z = e.z;
  }
  return { s, fork, crane };
}

test('a mutually blocked stale escape replans physically while retaining its real work destination', () => {
  const { s, fork, crane } = encounter();
  const destination = { ...fork.trafficGoal! },
    cargo = { ...crane.cargo! };
  let sawRetreat = false;
  for (let t = 0; t < 15 && dist(crane, { x: 16, z: 43.4 }) > 0.1; t += 0.1) {
    const poses = s.equipment.map((e) => ({ ...e }));
    S.tick(s, 0.1);
    for (let i = 0; i < poses.length; i++) {
      assert.ok(
        dist(poses[i], s.equipment[i]) <= equipmentTravelSpeed(s, poses[i]) * 0.1 + 1e-6,
        'Traffic recovery uses normal gradual movement',
      );
      assert.equal(
        equipmentSweepBlocked(s, poses[i], s.equipment[i]),
        '',
        'Retreat respects actual machine and load clearance',
      );
    }
    sawRetreat ||= !!fork.reverse && dist(fork, { x: 17.71213477295936, z: 48.41912526155593 }) > 0.2;
    if (fork.trafficGoal)
      assert.deepEqual(
        fork.trafficGoal,
        destination,
        'Changing an escape keeps the original material destination',
      );
    assert.deepEqual(crane.cargo, cargo);
  }
  assert.ok(
    sawRetreat,
    'The forklift backs away instead of repeatedly turning toward its stale escape',
  );
  assert.ok(dist(crane, { x: 16, z: 43.4 }) < 0.1, 'The loaded machine can continue its real trip');
});

test('a loaded machine can yield to an immobilized empty machine rather than wait on its impossible escape', () => {
  const { s, fork, crane } = encounter();
  fork.fuel = 0;
  const original = { x: crane.x, z: crane.z };
  for (let t = 0; t < 8 && dist(crane, original) < 3; t += 0.1) S.tick(s, 0.1);
  assert.ok(
    dist(crane, original) > 3,
    'A fueled loaded machine physically makes room for the stranded actor',
  );
  assert.equal(fork.fuel, 0, 'No fuel or substitute equipment is invented');
  assert.deepEqual(crane.cargo, { item: 'shed', qty: 1 });
});
