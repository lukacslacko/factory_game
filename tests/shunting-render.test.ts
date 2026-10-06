import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { renderState } from '../native-runtime/render';
import type { RailMove } from '../src/types';

const motion = (): RailMove => ({
  points: [],
  length: 0,
  tracks: [],
  switches: [],
  segments: [],
  distance: 0,
  end: 0,
  velocity: 0,
  clock: 0,
});

test('native render keeps detached cars, own shunter, and pickup engine independent', () => {
  const s = S.createState();
  S.purchaseBatch(
    s,
    [
      { item: 'rail', qty: 32 },
      { item: 'diesel', qty: 1 },
    ],
    'rail',
  );
  const o = s.orders[0],
    freight = o.railFreight!;
  o.status = 'unloading';
  o.carrierDeparted = true;
  freight.detached = true;
  freight.locomotivePhase = 'gone';
  freight.cars[0].pose = { x: 90, z: 20, yaw: 0.4 };
  freight.cars[0].bogies = [
    { x: 85, z: 18, yaw: 0.3 },
    { x: 95, z: 22, yaw: 0.5 },
  ];
  s.shunters = [
    {
      id: 'SHUNTER-1',
      name: 'Yard shunter',
      x: 110,
      z: 20,
      yaw: 0.4,
      fuel: 300,
      tank: 300,
      used: 0,
      phase: 'parked',
      status: 'Ready',
      eta: 0,
      driverId: 'WRK-1',
    },
  ];
  s.railReturns = [
    {
      id: 'RETURN-1',
      locomotiveId: 'LOCO-RETURN-1',
      x: 150,
      z: 0,
      yaw: 0,
      carIds: [freight.cars[1].id],
      orderIds: [o.id],
      phase: 'collecting',
      status: 'Approaching',
      clock: 0,
      movement: motion(),
      departure: motion(),
    },
  ];
  const rendered = renderState(s);
  assert.equal(rendered.railCars.length, 2);
  assert.equal(rendered.carriers.find((c) => c.id === o.id)?.locomotive, null);
  assert.equal(rendered.railLocomotives.length, 1);
  assert.equal(rendered.railLocomotives[0].id, 'LOCO-RETURN-1');
  assert.equal(rendered.railShunters.length, 1);
  assert.equal(rendered.railShunters[0].id, 'SHUNTER-1');
  assert.deepEqual(
    rendered.railCars[0].bogies,
    freight.cars[0].bogies.map((p) => ({ ...p, y: 0 })),
  );
  assert.equal(rendered.railCars[0].x, 90);
  assert.equal(rendered.railCars[0].z, 20);
  for (const lot of rendered.carriers[0].cargo.filter((l) => l.carId === freight.cars[0].id)) {
    assert.equal(lot.yaw, 0.4);
    assert.ok(Math.abs(lot.x - 90) <= 8);
    assert.ok(Math.abs(lot.z - 20) <= 5);
  }
  freight.cars[1].returned = true;
  const after = renderState(s);
  assert.equal(after.railCars.length, 1);
  assert.ok(!after.carriers[0].cargo.some((l) => l.carId === freight.cars[1].id));
  s.railReturns[0].phase = 'done';
  assert.equal(renderState(s).railLocomotives.length, 0);
  s.shunters[0].phase = 'ordered';
  assert.equal(
    renderState(s).railShunters.length,
    0,
    'Bought engine appears only when physically arriving',
  );
});

test('supplier engine pose and bogies follow the exit movement without dragging stationary cars', () => {
  const s = S.createState();
  S.purchaseBatch(s, [{ item: 'rail', qty: 1 }], 'rail');
  const o = s.orders[0],
    freight = o.railFreight!;
  o.status = 'unloading';
  freight.locomotivePhase = 'leaving';
  freight.locomotivePose = { x: 137, z: 2.5, yaw: -0.35 };
  freight.locomotiveBogies = [
    { x: 134.5, z: 3.5, yaw: -0.4 },
    { x: 139.5, z: 1.5, yaw: -0.3 },
  ];
  freight.cars[0].pose = { x: 80, z: 5, yaw: 0 };
  const render = renderState(s);
  assert.equal(render.railLocomotives[0].x, 137);
  assert.equal(render.railLocomotives[0].z, 2.5);
  assert.deepEqual(render.railLocomotives[0].bogies, freight.locomotiveBogies);
  assert.equal(render.railCars[0].x, 80);
});
