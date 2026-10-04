import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { recordEquipmentTravel, surfaceTravelCost, GROUND_WEAR_LIMIT } from '../src/ground-wear.ts';
import { machineRoute, equipmentMoveBlocked } from '../src/traffic.ts';
import { seedHandlingResources } from './support/yard.ts';
import { dist, segmentClear } from '../src/path.ts';
import { move } from '../src/motion.ts';

test('only actual tire/track travel compacts dirt, with bounded persistent intensity', () => {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  s.workers = [];
  e.x = 30.5;
  e.z = 30.5;
  e.yaw = 0;
  recordEquipmentTravel(s, e, { ...e });
  assert.deepEqual(s.groundWear, {});
  const from = { ...e };
  e.x += 1;
  recordEquipmentTravel(s, e, from);
  assert.ok(Object.keys(s.groundWear!).length > 0);
  assert.equal(
    s.groundWear!['30,30'],
    undefined,
    'Bucket and chassis center do not paint wheel/track marks',
  );
  assert.ok(Object.keys(s.groundWear!).every((k) => ['29', '31'].includes(k.split(',')[1])));
  const opening = Object.values(s.groundWear!).reduce((n, v) => n + v, 0);
  assert.ok(Math.abs(opening - 0.05) < 1e-9, 'Wear is proportional to accepted meters traveled');
  for (let i = 0; i < 200; i++) recordEquipmentTravel(s, e, from);
  assert.ok(Object.values(s.groundWear!).every((v) => v > 0 && v <= 1));
  assert.deepEqual(S.load(S.save(s)).groundWear, s.groundWear, 'Wear survives save/load');
});

test('stationary, transported, and concrete-supported equipment does not create dirt wear', () => {
  const s = S.createState(),
    e = seedHandlingResources(s);
  e.x = 30.5;
  e.z = 30.5;
  e.yaw = 0;
  const from = { ...e };
  e.x = 32.5;
  e.transportOrder = 'PO-TEST';
  recordEquipmentTravel(s, e, from);
  assert.deepEqual(s.groundWear, {});
  e.transportOrder = undefined;
  for (let x = 29; x <= 33; x++) for (let z = 29; z <= 32; z++) s.paving[`${x},${z}`] = 'TEST';
  recordEquipmentTravel(s, e, from);
  assert.deepEqual(s.groundWear, {});
});

test('wear storage stays bounded without dropping the existing established lanes', () => {
  const s = S.createState(),
    e = seedHandlingResources(s);
  s.groundWear = {};
  for (let i = 0; i < GROUND_WEAR_LIMIT; i++) s.groundWear[`${i},100`] = 0.1;
  const old = { ...s.groundWear };
  e.x = 30.5;
  e.z = 30.5;
  e.yaw = 0;
  recordEquipmentTravel(s, e, { x: 29.5, z: 30.5, yaw: 0 });
  assert.equal(Object.keys(s.groundWear).length, GROUND_WEAR_LIMIT);
  assert.deepEqual(s.groundWear, old);
});

test('surface costs order concrete, established dirt, and ordinary dirt', () => {
  const s = S.createState();
  s.paving['1,1'] = 'TEST';
  s.groundWear = { '2,1': 1 };
  assert.ok(surfaceTravelCost(s, { x: 1.5, z: 1.5 }) < surfaceTravelCost(s, { x: 2.5, z: 1.5 }));
  assert.ok(surfaceTravelCost(s, { x: 2.5, z: 1.5 }) < surfaceTravelCost(s, { x: 3.5, z: 1.5 }));
});

test('comparable machine routes prefer concrete then established dirt while preserving chassis clearance', () => {
  const s = S.createState(),
    e = seedHandlingResources(s);
  s.workers = [];
  e.x = 30.5;
  e.z = 42.5;
  e.yaw = Math.PI / 4;
  e.reach = 2;
  const goal = { x: 90.5, z: 92.5 },
    obstacles = [{ x: 34, z: 46, w: 53, d: 42 }];
  const mark = (
    record: Record<string, number | string>,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    value: number | string,
  ) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) record[`${x},${z}`] = value;
  };
  s.groundWear = {};
  mark(s.groundWear, 29, 42, 32, 94, 1);
  mark(s.groundWear, 30, 90, 92, 94, 1);
  const worn = machineRoute(s, e, goal, obstacles, 400, true);
  assert.ok(worn);
  assert.ok(
    worn.some((p) => p.x < 34 && p.z > 85),
    'Use the established western/northern lane rather than fresh eastern dirt',
  );
  mark(s.paving, 30, 40, 92, 44, 'TEST');
  mark(s.paving, 88, 42, 92, 94, 'TEST');
  const paved = machineRoute(s, e, goal, obstacles, 400, true);
  assert.ok(paved);
  assert.ok(
    paved.some((p) => p.x > 85 && p.z < 46),
    'Concrete wins against an equally long worn-dirt alternative',
  );
  for (const path of [worn, paved]) {
    const vehicle = { ...e, path: path.map((p) => ({ ...p })) };
    let ticks = 0;
    while (vehicle.path.length && ticks++ < 3000) {
      const before = { ...vehicle };
      move(vehicle, 0.1, 0.84, true);
      assert.ok(segmentClear(before, vehicle, obstacles, 1));
      // Independently exercise the executed oriented collision checker against
      // a solid obstacle represented by the same physical building footprint.
      s.buildings = [
        {
          id: 'BLD-TEST',
          kind: 'office',
          x: 34,
          z: 46,
          w: 53,
          d: 42,
          rotation: 0,
          name: 'Fixture',
          connected: false,
          source: 'opening',
        },
      ];
      assert.equal(equipmentMoveBlocked(s, before, vehicle), '');
    }
    assert.ok(dist(vehicle, goal) < 0.02);
  }
});

test('public road, crossing, and receiving apron are permanent paved surfaces rather than dirt', () => {
  const s = S.createState(),
    e = seedHandlingResources(s);
  for (const [x, z] of [
    [-40, -13],
    [-8, 0],
    [20, 18],
  ]) {
    e.x = x;
    e.z = z;
    e.yaw = 0;
    assert.equal(surfaceTravelCost(s, e), 1);
    recordEquipmentTravel(s, e, { x: x - 1, z, yaw: 0 });
  }
  assert.deepEqual(
    s.groundWear,
    {},
    'Do not accumulate hidden dirt marks beneath permanent pavement',
  );
  e.x = -20;
  e.z = 38;
  e.yaw = 0;
  assert.equal(
    surfaceTravelCost(s, e),
    1.08,
    'Existing compacted truck turning area has the worn-dirt cost',
  );
  recordEquipmentTravel(s, e, { x: -21, z: 38, yaw: 0 });
  assert.deepEqual(s.groundWear, {});
});
