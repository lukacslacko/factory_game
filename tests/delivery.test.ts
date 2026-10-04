import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { EQUIPMENT, MATERIALS } from '../src/catalog.ts';
import { carrierRects, shipmentLots } from '../src/delivery.ts';
import { localPoint } from '../src/motion.ts';
import { overlap } from '../src/path.ts';
import { equipmentBoxes, personTouchesBox } from '../src/traffic.ts';
import type { State, Item } from '../src/types.ts';
import { seedHandlingResources, tickUntil, advance } from './support/yard.ts';

function emptyYard() {
  const s = S.createState();
  assert.equal(S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }), '');
  return s;
}

function conserve(s: State, item: Item) {
  const totals = S.totals(s, item);
  assert.equal(
    totals.delivered,
    totals.stored + totals.cargo + totals.installed,
    JSON.stringify(totals),
  );
  for (const order of s.orders.filter((o) => o.item === item)) {
    assert.equal(
      shipmentLots(order).reduce((n, lot) => n + lot.qty, 0),
      order.qty - order.arrived,
      `Carrier inventory changed without a transfer: ${order.id}`,
    );
  }
  const occupied = s.stacks.filter((t) => t.qty > 0);
  for (const stack of occupied) {
    assert.ok(stack.qty <= MATERIALS[stack.item].max, `Overfilled ${stack.id}`);
    assert.ok(stack.reserved <= stack.qty);
    for (const other of occupied)
      if (other.id !== stack.id) assert.ok(!overlap(stack, other), `${stack.id}/${other.id}`);
  }
}

test('freight stays on its carrier until a purchased machine and hired operator exist', () => {
  const s = emptyYard();
  const [id] = S.purchase(s, 'slab', 12);
  tickUntil(s, () => s.orders.find((o) => o.id === id)?.status === 'unloading');
  advance(s, 120);
  assert.equal(S.totals(s, 'slab').stored, 0);
  assert.equal(s.equipment.length, 0, 'Waiting freight must not conjure a forklift');
  assert.equal(s.workers.length, 0);
  assert.match(s.orders.find((o) => o.id === id)!.note, /operator/i);

  // A waiting material truck must not block the lowloader or worker bus.
  const [machineOrderId] = S.purchase(s, 'forklift', 1);
  tickUntil(s, () => s.orders.find((o) => o.id === machineOrderId)?.status === 'unloading');
  const machineOrder = s.orders.find((o) => o.id === machineOrderId)!;
  const machine = s.equipment.find((e) => e.id === machineOrder.equipmentId)!;
  assert.ok(machine);
  assert.equal(machine.transportOrder, machineOrder.id);
  assert.equal(machineOrder.deployment, 'waiting');
  assert.ok((machine.y || 0) > 0.7, 'Purchased forklift remains on the lowloader deck');
  const parked = { x: machine.x, z: machine.z, y: machine.y };
  advance(s, 30);
  assert.deepEqual({ x: machine.x, z: machine.z, y: machine.y }, parked);
  assert.equal(machine.operator, undefined);
  assert.equal(S.totals(s, 'slab').stored, 0);

  S.purchase(s, 'operator', 1);
  const phases = new Set<string>();
  let observedMovingOnRamp = false;
  let previous = { x: machine.x, z: machine.z };
  tickUntil(
    s,
    () => s.orders.every((o) => o.status === 'done'),
    1800,
    () => {
      phases.add(machineOrder.deployment || '');
      assert.equal(s.equipment.length, 1);
      assert.equal(machine.id, machineOrder.equipmentId);
      if (machineOrder.deployment === 'offload') {
        const worker = s.workers.find((w) => w.id === machine.operator);
        assert.ok(worker, 'A hired operator must occupy a machine descending the ramp');
        assert.equal(worker.vehicle, machine.id);
        assert.equal(machine.transportOrder, machineOrder.id);
        const moved = Math.hypot(machine.x - previous.x, machine.z - previous.z);
        assert.ok(moved < 0.2, `Ramp motion jumped ${moved} m in 100 ms`);
        if (moved > 0.001 && (machine.y || 0) > 0.02 && (machine.y || 0) < 0.8)
          observedMovingOnRamp = true;
      }
      if (machine.transportOrder) assert.equal(machine.job, undefined);
      const freight = s.orders.find((o) => o.id === id)!;
      if (freight.unload) {
        assert.equal(freight.unload.equipmentId, machine.id);
        assert.ok(s.workers.some((w) => w.id === freight.unload!.operatorId));
        if (!['boarding'].includes(freight.unload.phase))
          assert.equal(machine.operator, freight.unload.operatorId);
      }
      conserve(s, 'slab');
      previous = { x: machine.x, z: machine.z };
    },
  );
  for (const phase of ['walk', 'climb', 'board', 'offload', 'park', 'complete'])
    assert.ok(phases.has(phase), `Missing deployment phase: ${phase}`);
  assert.ok(observedMovingOnRamp, 'Machine should traverse intermediate ramp heights');
  assert.equal(machine.transportOrder, undefined);
  assert.equal(machine.deliveryOrder, undefined);
  assert.equal(S.totals(s, 'slab').stored, 12);
  assert.deepEqual(
    s.workers.map((w) => w.name),
    ['Worker #1'],
  );
  assert.equal(s.costs.filter((c) => c.entity === machineOrderId).length, 1);
});

test('a site machine without an available operator cannot unload freight', () => {
  const s = emptyYard();
  const machine = seedHandlingResources(s);
  s.workers[0].duty = 'rest';
  S.purchase(s, 'slab', 4);
  tickUntil(s, () => s.orders[0].status === 'unloading');
  advance(s, 180);
  assert.equal(S.totals(s, 'slab').stored, 0);
  assert.equal(machine.cargo, undefined);
  assert.ok(s.orders[0].note.includes('operator'));
  s.workers[0].duty = 'auto';
  tickUntil(s, () => s.orders[0].status === 'done');
  assert.equal(S.totals(s, 'slab').stored, 4);
});

test('delivery cargo and operator assignments survive saves during lift, carry, and placement', () => {
  let s = emptyYard();
  seedHandlingResources(s);
  const [orderId] = S.purchase(s, 'slab', MATERIALS.slab.max + 1);
  const seen = new Set<string>();
  const expected = new Set(['lift', 'carry', 'lower']);
  for (let seconds = 0; seconds < 1800; seconds += 0.1) {
    const order = s.orders.find((o) => o.id === orderId)!;
    if (order.status === 'done') break;
    S.tick(s, 0.1);
    conserve(s, 'slab');
    const phase = order.unload?.phase;
    if (phase && expected.has(phase) && !seen.has(phase)) {
      seen.add(phase);
      const before = {
        cargo: s.equipment.map((e) => e.cargo),
        task: order.unload,
        invoices: s.costs.filter((c) => c.category === 'Purchases'),
        balances: S.totals(s, 'slab'),
      };
      const roundtrip = S.load(S.save(s));
      assert.deepEqual(
        roundtrip.equipment.map((e) => e.cargo),
        before.cargo,
      );
      assert.deepEqual(
        roundtrip.orders.find((o) => o.id === orderId)!.unload,
        JSON.parse(JSON.stringify(before.task)),
      );
      assert.deepEqual(
        roundtrip.costs.filter((c) => c.category === 'Purchases'),
        before.invoices,
      );
      assert.deepEqual(S.totals(roundtrip, 'slab'), before.balances);
      s = roundtrip;
    }
  }
  assert.deepEqual([...seen].sort(), [...expected].sort());
  assert.equal(s.orders.find((o) => o.id === orderId)!.status, 'done');
  assert.equal(s.costs.filter((c) => c.entity === orderId).length, 1);
  assert.equal(S.totals(s, 'slab').stored, MATERIALS.slab.max + 1);
  assert.ok(s.movements.some((m) => m.reason === 'Topped up existing stack'));
});

test('slabs top up existing stacks and fill adjacent cells without phantom storage gaps', () => {
  const s = emptyYard();
  seedHandlingResources(s);
  // A narrow loading face makes actual capacity unambiguous: three adjacent
  // 1 m footprints, each independently reachable from outside the stockyard.
  s.zones = [{ id: 'ZONE-TEST', name: 'Three slab cells', x: 25, z: 30, w: 3, d: 1 }];
  S.purchase(s, 'slab', 3);
  tickUntil(s, () => s.orders.every((o) => o.status === 'done'));
  const firstStack = s.stacks.find((t) => t.qty > 0)!;
  const firstId = firstStack.id;
  S.purchase(s, 'slab', MATERIALS.slab.max * 3 - 3);
  tickUntil(
    s,
    () => s.orders.every((o) => o.status === 'done'),
    2400,
    () => conserve(s, 'slab'),
  );
  const stacks = s.stacks.filter((t) => t.qty > 0).sort((a, b) => a.x - b.x);
  assert.equal(stacks.length, 3);
  assert.ok(
    stacks.some((t) => t.id === firstId),
    'An earlier partial stack is reused',
  );
  assert.deepEqual(
    stacks.map((t) => t.x),
    [25, 26, 27],
  );
  assert.deepEqual(
    stacks.map((t) => t.z),
    [30, 30, 30],
  );
  assert.deepEqual(
    stacks.map((t) => t.qty),
    Array(3).fill(MATERIALS.slab.max),
  );
  assert.equal(S.totals(s, 'slab').stored, 3 * MATERIALS.slab.max);
  assert.ok(s.movements.some((m) => m.to === firstId && m.reason === 'Topped up existing stack'));
});

test('unloading respects lifting capacity, uses occupied equipment, and keeps the chassis outside carriers', () => {
  const s = emptyYard();
  const machine = seedHandlingResources(s);
  S.purchase(s, 'slab', MATERIALS.slab.max * 2);
  let samples = 0;
  const phases = new Set<string>();
  tickUntil(
    s,
    () => s.orders.every((o) => o.status === 'done'),
    1800,
    () => {
      const active = s.orders.find((o) => o.unload);
      if (!active?.unload) return;
      const task = active.unload;
      phases.add(task.phase);
      assert.ok(task.qty * MATERIALS.slab.mass <= EQUIPMENT[machine.kind].capacity);
      if (task.phase !== 'boarding') {
        assert.equal(machine.operator, task.operatorId);
        assert.equal(s.workers.find((w) => w.id === task.operatorId)!.vehicle, machine.id);
        samples++;
        // Test body corners (forks may reach over a deck to lift its freight).
        for (const x of [-1.45, 0.95])
          for (const z of [-0.85, 0.85]) {
            const p = localPoint(machine, x, z);
            for (const r of carrierRects(s))
              assert.ok(
                !(p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d),
                `Forklift chassis intersects carrier during ${task.phase}: ${JSON.stringify({ p, r })}`,
              );
          }
        if (machine.cargo) assert.ok(task.cargo, 'Carried inventory needs a physical cargo pose');
      }
      conserve(s, 'slab');
    },
  );
  assert.ok(samples > 100);
  for (const phase of [
    'approach',
    'rig',
    'lift',
    'clear',
    'carry',
    'lower',
    'release',
    'back-away',
  ])
    assert.ok(phases.has(phase), `Missing unloading phase ${phase}`);
  assert.ok(machine.used > 0);
});

test('multiple hired workers keep numbered names after save and later arrivals', () => {
  let s = emptyYard();
  S.purchase(s, 'builder', 2);
  tickUntil(s, () => s.orders.every((o) => o.status === 'done'));
  s = S.load(S.save(s));
  S.purchase(s, 'operator', 2);
  tickUntil(s, () => s.orders.every((o) => o.status === 'done'));
  assert.deepEqual(
    s.workers.map((w) => w.name),
    ['Worker #1', 'Worker #2', 'Worker #3', 'Worker #4'],
  );
  assert.equal(new Set(s.workers.map((w) => w.id)).size, 4);
});

test('a small square stockyard fills all nine slab cells before asking for more area', () => {
  const s = emptyYard();
  seedHandlingResources(s);
  s.zones = [{ id: 'ZONE-TEST', name: 'Nine slab cells', x: 25, z: 30, w: 3, d: 3 }];
  S.purchase(s, 'slab', 9 * MATERIALS.slab.max);
  tickUntil(
    s,
    () => s.orders.every((o) => o.status === 'done'),
    3000,
    () => conserve(s, 'slab'),
  );
  const occupied = s.stacks.filter((t) => t.qty > 0);
  assert.equal(occupied.length, 9);
  for (let x = 25; x < 28; x++)
    for (let z = 30; z < 33; z++)
      assert.equal(occupied.find((t) => t.x === x && t.z === z)?.qty, MATERIALS.slab.max);
});

test('a lowloader descent resumes from its saved pose with the same machine and operator', () => {
  let s = emptyYard();
  S.purchase(s, 'operator', 1);
  const [orderId] = S.purchase(s, 'forklift', 1);
  tickUntil(s, () =>
    s.orders.some(
      (o) => o.id === orderId && o.deployment === 'offload' && (o.deploymentClock || 0) > 6,
    ),
  );
  const order = s.orders.find((o) => o.id === orderId)!;
  const machine = s.equipment.find((e) => e.id === order.equipmentId)!;
  const snapshot = JSON.parse(JSON.stringify({ machine, order, workers: s.workers }));
  s = S.load(S.save(s));
  assert.deepEqual(s.equipment[0], snapshot.machine);
  assert.deepEqual(
    s.orders.find((o) => o.id === orderId),
    snapshot.order,
  );
  assert.deepEqual(s.workers, snapshot.workers);
  tickUntil(s, () => s.orders.every((o) => o.status === 'done'));
  assert.equal(s.equipment.length, 1);
  assert.equal(s.equipment[0].id, machine.id);
  assert.equal(s.equipment[0].operator, machine.operator);
  assert.equal(s.equipment[0].transportOrder, undefined);
  assert.ok(Math.abs(s.equipment[0].y || 0) < 0.001);
  assert.equal(s.costs.filter((c) => c.entity === orderId).length, 1);
});

test('legacy carrier handling migrates to waiting freight without inventing player equipment', () => {
  const s = emptyYard();
  S.purchase(s, 'slab', 12);
  tickUntil(s, () => s.orders[0].status === 'unloading');
  const legacy = JSON.parse(S.save(s));
  legacy.version = 2;
  delete legacy.orders[0].drive;
  legacy.orders[0].handler = { x: 26, z: 28 };
  legacy.orders[0].handlerPath = [{ x: 27, z: 28 }];
  legacy.orders[0].handlingStage = 'carry';
  legacy.orders[0].cargoQty = 6;
  legacy.orders[0].allocated = { x: 28, z: 28, w: 1, d: 1 };
  const restored = S.load(JSON.stringify(legacy));
  advance(restored, 60);
  assert.equal(restored.version, 4);
  assert.equal(restored.equipment.length, 0);
  assert.equal(restored.workers.length, 0);
  assert.equal(restored.orders[0].arrived, 0);
  assert.equal(restored.orders[0].handlerPath, undefined);
  assert.equal(restored.orders[0].cargoQty, undefined);
  assert.equal(restored.orders[0].allocated, undefined);
  assert.equal(
    shipmentLots(restored.orders[0]).reduce((n, t) => n + t.qty, 0),
    12,
  );
  assert.equal(restored.costs.filter((c) => c.entity === restored.orders[0].id).length, 1);
});

test('a legacy approaching delivery receives exactly one invoice when restored at its berth', () => {
  const original = emptyYard();
  const [orderId] = S.purchase(original, 'slab', 12);
  tickUntil(original, () => original.orders[0].status === 'approaching');
  assert.equal(original.orders[0].invoiced, false);
  assert.equal(original.costs.length, 0);
  const legacy = JSON.parse(S.save(original));
  legacy.version = 2;
  delete legacy.orders[0].drive;
  let restored = S.load(JSON.stringify(legacy));
  assert.equal(restored.orders[0].status, 'unloading');
  advance(restored, 1);
  assert.equal(restored.orders[0].invoiced, true);
  assert.equal(restored.costs.filter((c) => c.entity === orderId).length, 1);
  assert.equal(restored.costs.find((c) => c.entity === orderId)!.amount, original.orders[0].total);
  restored = S.load(S.save(restored));
  advance(restored, 60);
  assert.equal(restored.costs.filter((c) => c.entity === orderId).length, 1);
  assert.equal(restored.orders[0].arrived, 0);
  assert.equal(S.totals(restored, 'slab').incoming, 12);
});

test('save validation rejects broken delivery assignments and impossible cargo poses', () => {
  const s = emptyYard();
  seedHandlingResources(s);
  S.purchase(s, 'slab', 12);
  tickUntil(s, () => s.orders[0].unload?.phase === 'carry');
  for (const mutate of [
    (save: State) => {
      save.orders[0].unload!.equipmentId = 'MISSING-MACHINE';
    },
    (save: State) => {
      save.orders[0].unload!.operatorId = 'MISSING-WORKER';
    },
    (save: State) => {
      save.orders[0].unload!.qty = -1;
    },
    (save: State) => {
      (save.orders[0].unload!.cargo as any).y = 'above';
    },
    (save: State) => {
      (save.orders[0].drive as any).distance = 'soon';
    },
  ]) {
    const saved = JSON.parse(S.save(s)) as State;
    mutate(saved);
    assert.throws(() => S.load(JSON.stringify(saved)), /Invalid save/);
  }
});

test('a controlled operator unloads the whole assigned delivery, including multiple lifts', () => {
  const s = emptyYard();
  const e = seedHandlingResources(s);
  const operator = s.workers[0];
  operator.duty = 'manual';
  const [orderId] = S.purchase(s, 'slab', MATERIALS.slab.max + 5);
  tickUntil(s, () => s.orders[0].status === 'unloading');
  assert.equal(s.orders[0].unload, undefined);
  assert.equal(S.unloadDelivery(s, orderId, operator.id), '');
  const liftQuantities: number[] = [];
  let hadCargo = false;
  tickUntil(
    s,
    () => s.orders[0].status === 'done',
    1200,
    () => {
      if (e.cargo && !hadCargo) liftQuantities.push(e.cargo.qty);
      hadCargo = !!e.cargo;
      if (s.orders[0].unload) assert.equal(s.orders[0].unload!.operatorId, operator.id);
      assert.equal(operator.duty, 'manual');
      conserve(s, 'slab');
    },
  );
  assert.ok(liftQuantities.length >= 3);
  assert.equal(
    liftQuantities.reduce((n, q) => n + q, 0),
    MATERIALS.slab.max + 5,
  );
  assert.equal(operator.vehicle, e.id);
});

test('manual deployment uses the chosen operator even with automatic operators on site', () => {
  const s = emptyYard();
  seedHandlingResources(s);
  const selected = s.workers[0];
  selected.duty = 'manual';
  s.workers.push({
    ...selected,
    id: S.id(s, 'worker'),
    name: 'Worker #2',
    duty: 'auto',
    x: selected.x + 2,
    path: [],
  });
  const [id] = S.purchase(s, 'excavator', 1);
  tickUntil(s, () => s.orders.find((o) => o.id === id)?.status === 'unloading');
  const order = s.orders.find((o) => o.id === id)!;
  assert.equal(order.deployment, 'waiting');
  const machine = s.equipment.find((e) => e.id === order.equipmentId)!;
  assert.equal(S.enterVehicle(s, selected.id, machine.id), '');
  tickUntil(s, () => order.status === 'done');
  assert.equal(machine.operator, selected.id);
  assert.equal(selected.vehicle, machine.id);
  assert.equal(selected.duty, 'manual');
});

test('utility crews wait for a pedestrian, then depart and free the service berth', () => {
  const s = emptyYard();
  const [powerId] = S.purchase(s, 'power', 1);
  const [waterId] = S.purchase(s, 'water', 1);
  const power = s.orders.find((o) => o.id === powerId)!;
  tickUntil(s, () => power.contractor?.phase === 'seated');
  const pedestrian = {
    ...S.demoState().workers[0],
    id: S.id(s, 'worker'),
    name: 'Worker #1',
    duty: 'rest' as const,
    x: power.vehicle.x - 6,
    z: power.vehicle.z,
    path: [],
  };
  s.workers.push(pedestrian);
  tickUntil(s, () => power.note.includes(pedestrian.id), 30);
  assert.equal(power.status, 'departing');
  const stopped = { ...power.vehicle };
  advance(s, 2);
  assert.deepEqual(power.vehicle, stopped, 'A seated utility crew must keep waiting for clearance');
  assert.equal(S.moveWorker(s, pedestrian.id, { x: pedestrian.x, z: pedestrian.z + 8 }), '');
  tickUntil(s, () => s.orders.every((o) => o.status === 'done'), 900);
  assert.equal(s.orders.find((o) => o.id === waterId)!.status, 'done');
  assert.deepEqual(s.utilities, { power: true, water: true });
  assert.equal(s.buildings.filter((b) => b.kind === 'power').length, 1);
  assert.equal(s.buildings.filter((b) => b.kind === 'water').length, 1);
});

test('assigning a controlled operator never displaces another worker from an occupied machine', () => {
  const s = emptyYard();
  const occupied = seedHandlingResources(s);
  const available = seedHandlingResources(s);
  available.x = 14.5;
  const [resting, selected] = s.workers;
  resting.vehicle = occupied.id;
  resting.duty = 'rest';
  occupied.operator = resting.id;
  selected.duty = 'manual';
  const [orderId] = S.purchase(s, 'slab', 4);
  tickUntil(s, () => s.orders[0].status === 'unloading');
  assert.equal(S.unloadDelivery(s, orderId, selected.id), '');
  assert.equal(s.orders[0].unload?.equipmentId, available.id);
  tickUntil(
    s,
    () => s.orders[0].status === 'done',
    900,
    () => {
      assert.equal(resting.vehicle, occupied.id);
      assert.equal(occupied.operator, resting.id);
      for (const worker of s.workers)
        if (worker.vehicle)
          assert.equal(s.equipment.find((e) => e.id === worker.vehicle)!.operator, worker.id);
    },
  );
});

test('an excavator keeps its tracks outside a truck while reaching over the bed to lift slabs', () => {
  const s = emptyYard();
  const e = seedHandlingResources(s, 'excavator');
  const rigger = s.workers.find((w) => w.role === 'builder')!;
  S.purchase(s, 'slab', 6);
  let rigged = false,
    alignedBeforeRigging = false,
    crewClearBeforeLift = false;
  let previousPhase: string | undefined;
  tickUntil(
    s,
    () => s.orders[0].status === 'done',
    900,
    () => {
      const task = s.orders[0].unload;
      if (!task) return;
      if (task.phase === 'approach')
        assert.ok(
          !equipmentBoxes(e).some((b) => personTouchesBox(rigger, b, 0.25)),
          'Early dispatched rigger stays outside the moving excavator',
        );
      if (task.phase === 'rig' && previousPhase === 'approach') {
        assert.ok(Math.abs(Math.cos((e.yaw || 0) + Math.PI / 2) - 1) < 0.001);
        assert.equal(e.path.length, 0);
        alignedBeforeRigging = true;
      }
      if (task.phase === 'lift' && previousPhase === 'rig') {
        assert.equal(rigger.path.length, 0, 'Finish walking clear before lifting the load');
        assert.ok(Math.hypot(rigger.x - task.source.x, rigger.z - task.source.z) > 4);
        crewClearBeforeLift = true;
      }
      previousPhase = task.phase;
      const dx = rigger.x - e.x,
        dz = rigger.z - e.z,
        c = Math.cos(e.yaw || 0),
        n = Math.sin(e.yaw || 0);
      assert.ok(
        Math.hypot(
          Math.max(Math.abs(dx * c + dz * n) - 1.88, 0),
          Math.max(Math.abs(-dx * n + dz * c) - 1.2, 0),
        ) >= 0.22,
        'The rigging worker must remain outside the excavator tracks',
      );
      if (!task || !['rig', 'lift', 'clear'].includes(task.phase)) return;
      rigged = true;
      for (const x of [-1.88, 1.88])
        for (const z of [-1.2, 1.2]) {
          const p = localPoint(e, x, z);
          for (const r of carrierRects(s))
            assert.ok(
              !(p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d),
              `Excavator track intersects truck during ${task.phase}: ${JSON.stringify({ p, r })}`,
            );
        }
    },
  );
  assert.ok(rigged && alignedBeforeRigging && crewClearBeforeLift);
});

test('a six-meter office load clears the entire truck before the excavator turns toward storage', () => {
  const s = emptyYard();
  S.purchase(s, 'builder', 1);
  S.purchase(s, 'operator', 1);
  S.purchase(s, 'excavator', 1);
  const [orderId] = S.purchase(s, 'office', 1);
  let samples = 0;
  const headings = new Set<number>();
  tickUntil(
    s,
    () => s.orders.every((o) => o.status === 'done'),
    1800,
    () => {
      const order = s.orders.find((o) => o.id === orderId)!;
      const task = order.unload;
      if (task?.phase !== 'carry' || !task.cargo) return;
      samples++;
      headings.add(Math.round(task.cargo.yaw * 10));
      const load = task.cargo;
      const { w, d } = MATERIALS.office;
      const corners = [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ].map(([x, z]) => localPoint(load, x, z));
      for (const carrier of carrierRects({ ...s, orders: [order] })) {
        const box = [
          { x: carrier.x, z: carrier.z },
          { x: carrier.x + carrier.w, z: carrier.z },
          { x: carrier.x + carrier.w, z: carrier.z + carrier.d },
          { x: carrier.x, z: carrier.z + carrier.d },
        ];
        // Separating-axis test detects edge crossings as well as contained corners.
        const axes = [
          [1, 0],
          [0, 1],
          [Math.cos(load.yaw), Math.sin(load.yaw)],
          [-Math.sin(load.yaw), Math.cos(load.yaw)],
        ];
        const separated = axes.some(([x, z]) => {
          const a = corners.map((p) => p.x * x + p.z * z);
          const b = box.map((p) => p.x * x + p.z * z);
          return (
            Math.max(...a) <= Math.min(...b) + 0.00001 || Math.max(...b) <= Math.min(...a) + 0.00001
          );
        });
        assert.ok(
          separated,
          `Office load sweeps through carrier: ${JSON.stringify({ load, carrier })}`,
        );
      }
    },
  );
  assert.ok(samples > 30, 'Inspect the loaded travel, not just one stationary pose');
  assert.ok(headings.size > 3, 'The load must actually turn while the regression observes it');
  assert.equal(S.totals(s, 'office').stored, 1);
  conserve(s, 'office');
});
