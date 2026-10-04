import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import {
  localPoint,
  deliveryKind,
  sampleRoad,
  roadExitLength,
  ROAD_CENTER_Z,
  ROAD_WIDTH,
  INBOUND_GATE_X,
} from '../src/motion.ts';
import type { Point, Order, Equipment, Worker } from '../src/types.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';
import { walkRoute } from '../src/traffic.ts';

function footprint(p: Point & { yaw?: number }, length: number, width: number) {
  return [
    [-length / 2, -width / 2],
    [length / 2, -width / 2],
    [length / 2, width / 2],
    [-length / 2, width / 2],
  ].map(([x, z]) => localPoint(p, x, z));
}
function intersects(a: Point[], b: Point[]) {
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length];
      const x = p.z - q.z,
        z = q.x - p.x;
      const ap = a.map((p) => p.x * x + p.z * z),
        bp = b.map((p) => p.x * x + p.z * z);
      if (Math.max(...ap) <= Math.min(...bp) + 1e-5 || Math.max(...bp) <= Math.min(...ap) + 1e-5)
        return false;
    }
  return true;
}
function carrier(o: Order) {
  return footprint(
    { ...o.vehicle, yaw: o.drive?.yaw || 0 },
    deliveryKind(o) === 'lowloader' ? 11.5 : 9.3,
    deliveryKind(o) === 'lowloader' ? 2.8 : 2.7,
  );
}
function outsideMachine(e: Equipment, w: Worker) {
  const yaw = e.yaw ?? (e.heading * Math.PI) / 2,
    dx = w.x - e.x,
    dz = w.z - e.z;
  const x = dx * Math.cos(yaw) + dz * Math.sin(yaw);
  const z = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const boxes =
    e.kind === 'excavator'
      ? [{ minX: -1.88, maxX: 1.88, minZ: -1.2, maxZ: 1.2 }]
      : [
          { minX: -1.6, maxX: 1.3, minZ: -0.98, maxZ: 0.98 },
          { minX: 1.1, maxX: 3, minZ: -0.46, maxZ: -0.34 },
          { minX: 1.1, maxX: 3, minZ: 0.34, maxZ: 0.46 },
        ];
  return boxes.every(
    (b) =>
      Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ)) >= 0.22,
  );
}

test('road vehicles fit entirely inside their right-hand lane on both sides of the crossing', () => {
  let eastbound = 0,
    westbound = 0;
  for (const item of ['builder', 'slab', 'forklift', 'power']) {
    const order = { item, mode: 'road' as const };
    for (let distance = 0; distance <= roadExitLength(order); distance += 0.2) {
      const p = sampleRoad(order, distance);
      if (Math.abs(p.x) < 40 || Math.abs(Math.sin(p.yaw)) > 0.01) continue;
      const direction = Math.cos(p.yaw);
      if (direction > 0) eastbound++;
      else westbound++;
      assert.ok(!p.reverse, 'Public-road travel should use forward gear');
      const width = item === 'forklift' ? 2.8 : 2.7;
      const corners = footprint(p, item === 'forklift' ? 11.5 : 9.3, width);
      for (const corner of corners) {
        assert.ok(
          Math.abs(corner.z - ROAD_CENTER_Z) < ROAD_WIDTH / 2 + 0.001,
          `${item} projects beyond the paved road edge`,
        );
        assert.ok(
          (corner.z - ROAD_CENTER_Z) * direction > 0.1,
          `${item} straddles the center line or uses the left-hand lane`,
        );
      }
    }
  }
  assert.ok(eastbound > 100 && westbound > 100, 'Inspect both directions of actual trips');
});

test('the worker bus leaves in its forward direction after its passengers step off', () => {
  const s = S.createState();
  S.purchase(s, 'builder', 3);
  let departureSamples = 0;
  tickUntil(s, () => s.orders[0].status === 'departing');
  const order = s.orders[0];
  let previous = { ...order.vehicle, yaw: order.drive?.yaw || 0 };
  tickUntil(
    s,
    () => order.status === 'done',
    180,
    () => {
      const dx = order.vehicle.x - previous.x,
        dz = order.vehicle.z - previous.z;
      if (Math.hypot(dx, dz) > 0.0001) {
        departureSamples++;
        const forward = dx * Math.cos(previous.yaw) + dz * Math.sin(previous.yaw);
        assert.ok(
          forward >= -0.001,
          `Bus reverses away from its stop: ${JSON.stringify({ previous, next: order.vehicle })}`,
        );
      }
      previous = { ...order.vehicle, yaw: order.drive?.yaw || 0 };
    },
  );
  assert.ok(departureSamples > 30);
});

test('mixed arrivals never drive through a stopped worker bus or another carrier', () => {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  S.purchase(s, 'builder', 12);
  S.purchase(s, 'operator', 2);
  S.purchase(s, 'forklift', 1);
  S.purchase(s, 'excavator', 1);
  S.purchase(s, 'slab', 24);
  S.purchase(s, 'power', 1);
  let parkedBusSamples = 0,
    pairedSamples = 0;
  tickUntil(
    s,
    () => s.orders.every((o) => o.status === 'done'),
    1800,
    () => {
      const active = s.orders.filter(
        (o) => o.mode === 'road' && o.status !== 'ordered' && o.status !== 'done',
      );
      if (
        active.some((o) => deliveryKind(o) === 'bus' && o.status === 'unloading') &&
        active.length > 1
      )
        parkedBusSamples++;
      for (let i = 0; i < active.length; i++)
        for (let j = i + 1; j < active.length; j++) {
          pairedSamples++;
          assert.ok(
            !intersects(carrier(active[i]), carrier(active[j])),
            `Carriers overlap: ${JSON.stringify(active.slice(i, j + 1).map((o) => ({ id: o.id, item: o.item, status: o.status, vehicle: o.vehicle })))}`,
          );
        }
      const deployed = s.equipment.filter((e) => !e.transportOrder);
      for (const e of deployed) {
        const body = footprint(
          { ...e, yaw: e.yaw ?? (e.heading * Math.PI) / 2 },
          e.kind === 'excavator' ? 3.76 : 2.9,
          e.kind === 'excavator' ? 2.4 : 1.96,
        );
        for (const o of active)
          assert.ok(!intersects(body, carrier(o)), `${e.id} chassis overlaps carrier ${o.id}`);
      }
    },
  );
  assert.ok(parkedBusSamples > 0, 'Exercise a bus waiting while another carrier is present');
  assert.ok(pairedSamples > 100);
});

test('opposing machines physically yield, preserve their destinations through save, and both finish', () => {
  let s = S.createState();
  const a = seedHandlingResources(s),
    b = seedHandlingResources(s);
  a.x = 10;
  a.z = 30;
  a.yaw = 0;
  b.x = 40;
  b.z = 30;
  b.yaw = Math.PI;
  a.cargo = { item: 'slab', qty: 1 };
  for (const [i, e] of [a, b].entries()) {
    const w = s.workers[i];
    w.vehicle = e.id;
    w.duty = 'manual';
    e.operator = w.id;
    assert.equal(S.moveWorker(s, w.id, { x: i ? 10 : 40, z: 30 }), '');
  }
  const ids = [a.id, b.id];
  let saved = false,
    yielded = false;
  for (let t = 0; t < 150; t += 0.1) {
    S.tick(s, 0.1);
    const [one, two] = ids.map((id) => s.equipment.find((e) => e.id === id)!);
    assert.ok(
      !intersects(footprint(one, 2.9, 1.96), footprint(two, 2.9, 1.96)),
      'Machines physically overlap during a passing maneuver',
    );
    if (Math.abs(one.z - 30) > 1 || Math.abs(two.z - 30) > 1) yielded = true;
    if (!saved && s.equipment.some((e) => e.trafficGoal)) {
      const before = JSON.parse(S.save(s));
      s = S.load(S.save(s));
      assert.deepEqual(s.equipment, before.equipment);
      saved = true;
    }
    if (Math.hypot(one.x - 40, one.z - 30) < 0.1 && Math.hypot(two.x - 10, two.z - 30) < 0.1) break;
  }
  assert.ok(saved && yielded, 'Exercise a real yielding maneuver and its persisted destination');
  const [one, two] = ids.map((id) => s.equipment.find((e) => e.id === id)!);
  assert.ok(
    Math.hypot(one.x - 40, one.z - 30) < 0.1 && Math.hypot(two.x - 10, two.z - 30) < 0.1,
    'Both original trips must complete',
  );
  assert.ok(s.equipment.every((e) => !e.trafficGoal && !e.trafficReverse && !e.reverse));
});

test('an obsolete machine obstruction cannot keep sending a distant worker out of the yard', () => {
  const s = S.createState(),
    e = seedHandlingResources(s),
    w = s.workers[0];
  w.x = 60;
  w.z = 50;
  e.blockedBy = w.id;
  for (let i = 0; i < 1000; i++) S.tick(s, 0.1);
  assert.deepEqual({ x: w.x, z: w.z }, { x: 60, z: 50 });
  assert.equal(w.path.length, 0);
  for (const goal of [
    { x: -60, z: 50 },
    { x: 240, z: 50 },
    { x: 60, z: -40 },
    { x: 60, z: 120 },
  ])
    assert.equal(
      walkRoute(s, w, goal, []),
      null,
      'Even a direct pedestrian escape must respect yard bounds',
    );
});

test('an idle machine moves out of a destination only when its seated operator is on automatic duty', () => {
  for (const duty of ['auto', 'rest'] as const) {
    const s = S.createState(),
      driven = seedHandlingResources(s),
      parked = seedHandlingResources(s, 'excavator');
    driven.x = 10;
    driven.z = 30;
    parked.x = 25;
    parked.z = 30;
    const driver = s.workers[0],
      parkingOperator = s.workers[1];
    driver.vehicle = driven.id;
    driver.duty = 'manual';
    driven.operator = driver.id;
    parkingOperator.vehicle = parked.id;
    parkingOperator.duty = duty;
    parked.operator = parkingOperator.id;
    assert.equal(S.moveWorker(s, driver.id, { x: 25, z: 30 }), '');
    for (let t = 0; t < 90; t += 0.1) {
      const previous = { x: parked.x, z: parked.z };
      S.tick(s, 0.1);
      assert.ok(
        Math.hypot(parked.x - previous.x, parked.z - previous.z) < 0.3,
        'Reparking must drive continuously',
      );
      assert.ok(!intersects(footprint(driven, 2.9, 1.96), footprint(parked, 3.76, 2.4)));
      if (Math.hypot(driven.x - 25, driven.z - 30) < 0.1) break;
    }
    assert.equal(parkingOperator.vehicle, parked.id);
    if (duty === 'auto') {
      assert.ok(
        Math.hypot(driven.x - 25, driven.z - 30) < 0.1,
        'Automatic operator should clear the requested destination',
      );
      assert.ok(Math.hypot(parked.x - 25, parked.z - 30) > 3);
    } else {
      assert.deepEqual({ x: parked.x, z: parked.z }, { x: 25, z: 30 });
      assert.ok(
        Math.hypot(driven.x - 25, driven.z - 30) > 2,
        'A resting operator must not drive an idle machine away',
      );
    }
  }
});

test('a machine stopped during a turn creates clearance along its current heading before steering away', () => {
  const s = S.createState(),
    excavator = seedHandlingResources(s, 'excavator'),
    forklift = seedHandlingResources(s);
  excavator.x = 9.5;
  excavator.z = 39.542;
  excavator.yaw = Math.PI - 0.3;
  forklift.x = 10.5;
  forklift.z = 44.09618;
  forklift.yaw = -Math.PI / 2;
  forklift.cargo = { item: 'slab', qty: 1 };
  const operators = s.workers.filter((w) => w.role === 'operator');
  for (const [i, e] of [excavator, forklift].entries()) {
    operators[i].vehicle = e.id;
    e.operator = operators[i].id;
    assert.equal(
      S.moveWorker(s, operators[i].id, i ? { x: 10.5, z: 39.5 } : { x: 26.5, z: 45.5 }),
      '',
    );
  }
  tickUntil(
    s,
    () => !excavator.path.length && !forklift.path.length,
    150,
    () => {
      assert.ok(!intersects(footprint(excavator, 3.76, 2.4), footprint(forklift, 2.9, 1.96)));
    },
  );
  assert.ok(Math.hypot(excavator.x - 26.5, excavator.z - 45.5) < 0.1);
  assert.ok(Math.hypot(forklift.x - 10.5, forklift.z - 39.5) < 0.1);
});

test('a machine reroutes around newly placed stock instead of sweeping its tracks through it', () => {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator'),
    operator = s.workers.find((w) => w.role === 'operator')!;
  operator.vehicle = e.id;
  e.operator = operator.id;
  const goal = { x: 40.5, z: 40.5 };
  assert.equal(S.moveWorker(s, operator.id, goal), '');
  // This appears after the route was issued, directly inside its rounded turn.
  s.stacks.push({
    id: S.id(s, 'stack'),
    item: 'slab',
    qty: 5,
    reserved: 0,
    source: 'opening',
    x: 40,
    z: 30,
    w: 1,
    d: 1,
  });
  const pile = footprint({ x: 40.5, z: 30.5, yaw: 0 }, 1, 1);
  tickUntil(
    s,
    () => Math.hypot(e.x - goal.x, e.z - goal.z) < 0.1,
    150,
    () => {
      assert.ok(
        !intersects(footprint(e, 3.76, 2.4), pile),
        'An excavator track corner entered the physical stock footprint',
      );
    },
  );
  assert.equal(s.stacks[0].qty, 5);
});

test('a work order chooses another loading face when new stock occupies its former approach', () => {
  const s = S.demoState();
  const job = S.plan(s, 'lamp', 68, 29).job!;
  tickUntil(
    s,
    () =>
      job.phase === 'Collect material' &&
      !!job.equipment &&
      s.equipment.find((e) => e.id === job.equipment)!.path.length > 0,
  );
  const machine = s.equipment.find((e) => e.id === job.equipment)!;
  const formerGoal = { ...machine.path[machine.path.length - 1] };
  const stock = s.stacks.find((t) => t.item === 'slab')!;
  // Another delivery uses this previously empty cell while the machine is
  // still driving to stock. The existing material keeps its quantity and ID.
  stock.x = Math.floor(formerGoal.x);
  stock.z = Math.floor(formerGoal.z);
  const qty = stock.qty;
  const pile = footprint({ x: stock.x + 0.5, z: stock.z + 0.5, yaw: 0 }, 1, 1);
  tickUntil(
    s,
    () => job.status === 'done',
    600,
    () => {
      assert.ok(
        !intersects(
          footprint(
            machine,
            machine.kind === 'excavator' ? 3.76 : 3.15,
            machine.kind === 'excavator' ? 2.4 : 1.96,
          ),
          pile,
        ),
        'Changing an occupied approach must never drive through the newly staged stock',
      );
    },
  );
  assert.equal(stock.qty, qty);
  assert.equal(s.buildings.filter((b) => b.kind === 'lamp' && b.x === 68 && b.z === 29).length, 1);
});

test('a worker beside a crane finds a long cross-yard route without exhausting the local detour search', () => {
  const s = S.createState();
  const crane = seedHandlingResources(s, 'excavator');
  Object.assign(crane, { x: 145, z: 9, yaw: -Math.PI / 2, reach: 4 });
  const operator = s.workers[0],
    worker = s.workers[1];
  operator.vehicle = crane.id;
  operator.duty = 'rest';
  crane.operator = operator.id;
  Object.assign(worker, { x: 145.893, z: 6.544, duty: 'manual' });
  const goal = { x: 31.5, z: 47.5 };
  const path = walkRoute(s, worker, goal, []);
  assert.ok(
    path?.length,
    'A short detour around the boom must not prevent a 120 m walk across clear ground',
  );
  worker.path = path;
  tickUntil(
    s,
    () => Math.hypot(worker.x - goal.x, worker.z - goal.z) < 0.1,
    120,
    () => {
      assert.ok(outsideMachine(crane, worker));
      const dx = worker.x - crane.x,
        dz = worker.z - crane.z;
      const forward = dx * Math.cos(crane.yaw!) + dz * Math.sin(crane.yaw!);
      const lateral = -dx * Math.sin(crane.yaw!) + dz * Math.cos(crane.yaw!);
      assert.ok(
        Math.hypot(
          Math.max(1.1 - forward, 0, forward - 4.45),
          Math.max(0, Math.abs(lateral) - 0.425),
        ) >= 0.3,
        'The rigger must walk around the boom, not through it',
      );
    },
  );
});

test('a driven forklift yields to a worker who enters an already planned route, then proceeds', () => {
  const s = S.createState();
  const e = seedHandlingResources(s);
  const operator = s.workers[0];
  operator.vehicle = e.id;
  operator.duty = 'manual';
  e.operator = operator.id;
  const goal = { x: 40.5, z: e.z };
  assert.equal(S.moveWorker(s, operator.id, goal), '');
  const pedestrian: Worker = {
    ...operator,
    id: S.id(s, 'worker'),
    name: 'Worker #2',
    role: 'builder',
    duty: 'rest',
    vehicle: undefined,
    x: 20.5,
    z: e.z,
    path: [],
  };
  s.workers.push(pedestrian);
  let yielded = false;
  for (let t = 0; t < 15; t += 0.1) {
    S.tick(s, 0.1);
    assert.ok(
      outsideMachine(e, pedestrian),
      `Machine entered worker's body at ${JSON.stringify({ e, pedestrian })}`,
    );
    if (e.x > 12 && e.x < 25 && ((!e.velocity && e.path.length > 0) || Math.abs(e.z - goal.z) > 1))
      yielded = true;
  }
  assert.ok(yielded, 'The machine must wait or steer clear of a new pedestrian obstruction');
  assert.equal(S.moveWorker(s, pedestrian.id, { x: pedestrian.x, z: pedestrian.z + 7 }), '');
  tickUntil(
    s,
    () => Math.hypot(e.x - goal.x, e.z - goal.z) < 0.1,
    60,
    () => assert.ok(outsideMachine(e, pedestrian)),
  );
});

test('crossing pedestrian and forklift routes resolve without either passing through the other', () => {
  const s = S.createState();
  const e = seedHandlingResources(s),
    operator = s.workers[0];
  operator.vehicle = e.id;
  operator.duty = 'manual';
  e.operator = operator.id;
  const pedestrian: Worker = {
    ...operator,
    id: S.id(s, 'worker'),
    name: 'Worker #2',
    role: 'builder',
    vehicle: undefined,
    x: 20.5,
    z: 20,
    path: [],
  };
  s.workers.push(pedestrian);
  const machineGoal = { x: 40.5, z: 28.5 },
    workerGoal = { x: 20.5, z: 36 };
  assert.equal(S.moveWorker(s, operator.id, machineGoal), '');
  assert.equal(S.moveWorker(s, pedestrian.id, workerGoal), '');
  let closeSamples = 0;
  tickUntil(
    s,
    () =>
      Math.hypot(e.x - machineGoal.x, e.z - machineGoal.z) < 0.1 &&
      Math.hypot(pedestrian.x - workerGoal.x, pedestrian.z - workerGoal.z) < 0.1,
    90,
    () => {
      if (Math.hypot(e.x - pedestrian.x, e.z - pedestrian.z) < 7) closeSamples++;
      assert.ok(
        outsideMachine(e, pedestrian),
        `Crossing routes collide: ${JSON.stringify({ machine: { x: e.x, z: e.z, yaw: e.yaw }, worker: { x: pedestrian.x, z: pedestrian.z } })}`,
      );
    },
  );
  assert.ok(closeSamples > 0, 'The routes must cross near the same time');
});

test('an arriving truck yields to a worker at the rail crossing and resumes when the worker walks clear', () => {
  const s = S.createState();
  seedHandlingResources(s);
  const pedestrian = s.workers[0];
  pedestrian.x = INBOUND_GATE_X;
  pedestrian.z = -2.5;
  pedestrian.duty = 'rest';
  S.purchase(s, 'slab', 1);
  const order = s.orders[0];
  // Observe the actual approach, independently of the purchase lead time.
  // The game clock now advances in real seconds at1x.
  tickUntil(s, () => order.status === 'approaching', 300);
  let yielded = false;
  for (let t = 0; t < 75; t += 0.1) {
    S.tick(s, 0.1);
    if (order.status !== 'approaching') continue;
    assert.ok(
      !intersects(carrier(order), footprint(pedestrian, 0.44, 0.44)),
      `Truck enters the crossing worker: ${JSON.stringify({ truck: order.vehicle, worker: pedestrian })}`,
    );
    if (
      Math.hypot(order.vehicle.x - pedestrian.x, order.vehicle.z - pedestrian.z) < 15 &&
      (order.drive?.velocity || 0) < 0.01
    )
      yielded = true;
  }
  assert.ok(yielded, 'The truck should stop for the occupied crossing');
  assert.equal(order.status, 'approaching');
  assert.equal(S.moveWorker(s, pedestrian.id, { x: -17, z: pedestrian.z }), '');
  tickUntil(
    s,
    () => order.status === 'unloading',
    90,
    () => {
      if (order.status !== 'ordered' && order.status !== 'done')
        assert.ok(!intersects(carrier(order), footprint(pedestrian, 0.44, 0.44)));
    },
  );
});

test('a worker trapped beside a stock row walks around a loaded machine turn instead of blocking it forever', () => {
  const s = S.createState();
  const e = seedHandlingResources(s, 'excavator');
  const op = s.workers.find((w) => w.role === 'operator')!;
  const builder = s.workers.find((w) => w.role === 'builder')!;
  Object.assign(e, {
    x: 37.5,
    z: 44.1,
    yaw: Math.PI / 2,
    heading: 1,
    reach: 4,
    lift: 0.45,
    cargo: { item: 'slab', qty: 1 },
    operator: op.id,
  });
  Object.assign(op, { x: e.x, z: e.z, vehicle: e.id, path: [] });
  Object.assign(builder, { x: 38.8435, z: 48.1565, path: [] });
  // Opening supported stock and one suspended slab reproduce the cramped
  // loading-side geometry. This test exercises public driving and real walking.
  for (let x = 29; x < 47; x++)
    s.stacks.push({
      id: `STK-ROW-${x}`,
      source: 'opening',
      item: 'slab',
      qty: 6,
      reserved: 0,
      x,
      z: 49,
      w: 1,
      d: 1,
    });
  assert.equal(S.moveWorker(s, op.id, { x: 63.5, z: 44.1 }), '');
  const before = { x: builder.x, z: builder.z };
  let walked = false;
  tickUntil(
    s,
    () => !e.path.length,
    120,
    () => {
      if (Math.hypot(builder.x - before.x, builder.z - before.z) > 1) walked = true;
      assert.ok(outsideMachine(e, builder), 'worker never crosses the chassis');
    },
  );
  assert.ok(walked, 'worker physically escaped the stock-side turn');
  assert.ok(Math.hypot(e.x - 63.5, e.z - 44.1) < 0.05);
  assert.equal(e.cargo?.qty, 1);
});
