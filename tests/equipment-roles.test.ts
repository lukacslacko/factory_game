import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { equipmentAllows } from '../src/equipment-roles.ts';
import type { Item, State } from '../src/types.ts';
import { seedHandlingResources, tickUntil, advance } from './support/yard.ts';

function emptyYard() {
  const s = S.createState();
  assert.equal(S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }), '');
  return s;
}

function conserved(s: State, item: Item) {
  const t = S.totals(s, item);
  assert.equal(t.delivered + t.recovered, t.stored + t.cargo + t.installed, JSON.stringify(t));
  for (const stack of s.stacks) assert.ok(stack.qty >= stack.reserved && stack.reserved >= 0);
}

test('a receiving forklift and paving excavator keep their separate jobs while freight arrives', () => {
  const s = S.demoState();
  const excavator = s.equipment.find((e) => e.kind === 'excavator')!;
  const forklift = s.equipment.find((e) => e.kind === 'forklift')!;
  assert.equal(S.setEquipmentRole(s, excavator.id, 'paving'), '');
  assert.equal(S.setEquipmentRole(s, forklift.id, 'receiving'), '');
  S.pave(s, { x: 56, z: 35, w: 4, d: 3 });
  const [orderId] = S.purchase(s, 'slab', 12);
  const order = s.orders.find((o) => o.id === orderId)!;
  let simultaneous = false;
  tickUntil(
    s,
    () => order.status === 'done' && s.jobs.every((j) => j.status === 'done'),
    2400,
    () => {
      for (const job of s.jobs) if (job.equipment) assert.equal(job.equipment, excavator.id);
      if (order.unload) assert.equal(order.unload.equipmentId, forklift.id);
      if (order.unload && s.jobs.some((j) => j.status === 'doing' && j.equipment === excavator.id))
        simultaneous = true;
      assert.equal(excavator.deliveryOrder, undefined);
      assert.equal(forklift.job, undefined);
      conserved(s, 'slab');
    },
  );
  assert.ok(
    simultaneous,
    'Both dedicated machines must actually work during overlapping delivery and paving',
  );
  assert.equal(
    Object.keys(s.paving).filter(
      (key) =>
        key.startsWith('56,') ||
        key.startsWith('57,') ||
        key.startsWith('58,') ||
        key.startsWith('59,'),
    ).length,
    12,
  );
  assert.equal(order.arrived, 12);
});

test('changing a paving machine to hold finishes its carried job but does not claim the next cell', () => {
  let s = S.demoState();
  let excavator = s.equipment.find((e) => e.kind === 'excavator')!;
  const forklift = s.equipment.find((e) => e.kind === 'forklift')!;
  S.setEquipmentRole(s, excavator.id, 'paving');
  S.setEquipmentRole(s, forklift.id, 'hold');
  S.pave(s, { x: 56, z: 35, w: 2, d: 1 });
  tickUntil(s, () => !!excavator.cargo && !!excavator.job);
  const activeId = excavator.job!;
  const cargo = { ...excavator.cargo! };
  const position = { x: excavator.x, z: excavator.z };
  assert.equal(S.setEquipmentRole(s, excavator.id, 'hold'), '');
  assert.deepEqual(excavator.cargo, cargo);
  assert.deepEqual({ x: excavator.x, z: excavator.z }, position);
  assert.equal(excavator.job, activeId);
  s = S.load(S.save(s));
  excavator = s.equipment.find((e) => e.kind === 'excavator')!;
  assert.equal(excavator.workRole, 'hold');
  assert.deepEqual(excavator.cargo, cargo);
  assert.equal(excavator.job, activeId);
  tickUntil(
    s,
    () => s.jobs.find((j) => j.id === activeId)!.status === 'done',
    1200,
    () => conserved(s, 'slab'),
  );
  advance(s, 30);
  const next = s.jobs.find((j) => j.id !== activeId)!;
  assert.notEqual(next.status, 'done');
  assert.equal(next.equipment, undefined);
  assert.equal(excavator.cargo, undefined);
  assert.equal(excavator.job, undefined);
  assert.equal(S.setEquipmentRole(s, excavator.id, 'paving'), '');
  tickUntil(s, () => s.jobs.every((j) => j.status === 'done'));
  conserved(s, 'slab');
});

test('a receiving role change retains the lifted batch, places it safely, and leaves later freight on the truck', () => {
  let s = emptyYard();
  let forklift = seedHandlingResources(s);
  S.setEquipmentRole(s, forklift.id, 'receiving');
  const [orderId] = S.purchase(s, 'slab', 24);
  let order = s.orders.find((o) => o.id === orderId)!;
  tickUntil(s, () => order.unload?.phase === 'carry' && !!forklift.cargo);
  const carried = forklift.cargo!.qty;
  const deliveredBefore = order.arrived - carried;
  const cargo = { ...forklift.cargo! };
  const operator = forklift.operator;
  assert.ok(carried > 0 && carried < order.qty);
  assert.equal(S.setEquipmentRole(s, forklift.id, 'hold'), '');
  assert.deepEqual(forklift.cargo, cargo);
  assert.equal(forklift.operator, operator);
  const machineId = forklift.id;
  s = S.load(S.save(s));
  forklift = s.equipment.find((e) => e.id === machineId)!;
  order = s.orders.find((o) => o.id === orderId)!;
  assert.equal(forklift.workRole, 'hold');
  assert.deepEqual(forklift.cargo, cargo);
  tickUntil(
    s,
    () => !forklift.deliveryOrder && !forklift.cargo,
    1200,
    () => conserved(s, 'slab'),
  );
  assert.equal(order.arrived, deliveredBefore + carried);
  advance(s, 90);
  assert.equal(
    order.arrived,
    deliveredBefore + carried,
    'A held forklift must not lift the next batch',
  );
  assert.notEqual(order.status, 'done');
  assert.equal(S.totals(s, 'slab').stored, carried);
  assert.equal(S.setEquipmentRole(s, forklift.id, 'receiving'), '');
  tickUntil(s, () => order.status === 'done');
  assert.equal(order.arrived, 24);
  assert.equal(s.equipment.length, 1);
  conserved(s, 'slab');
});

test('equipment roles persist, absent legacy roles allow all work, and invalid saved roles are rejected', () => {
  for (const role of [
    'all',
    'receiving',
    'paving',
    'construction',
    'rail',
    'recovery',
    'hold',
  ] as const) {
    const s = S.demoState();
    const e = s.equipment[0];
    assert.equal(S.setEquipmentRole(s, e.id, role), '');
    const restored = S.load(S.save(s));
    assert.equal(restored.equipment[0].workRole ?? 'all', role);
  }
  const legacy = JSON.parse(S.save(S.demoState()));
  legacy.version = 3;
  for (const e of legacy.equipment) delete e.workRole;
  const restored = S.load(JSON.stringify(legacy));
  for (const e of restored.equipment)
    for (const activity of ['receiving', 'paving', 'construction', 'rail', 'recovery'] as const)
      assert.ok(
        equipmentAllows(e, activity),
        `An unrestricted older machine must still permit ${activity}`,
      );
  for (const role of ['teleporting', 7, null, {}]) {
    const invalid = JSON.parse(S.save(S.demoState()));
    invalid.equipment[0].workRole = role;
    assert.throws(() => S.load(JSON.stringify(invalid)), /Invalid save/);
  }
});

test('hold prevents automatic work while preserving real refueling and direct operator driving', () => {
  const s = S.demoState();
  for (const e of s.equipment) S.setEquipmentRole(s, e.id, 'hold');
  const machine = s.equipment[0];
  machine.fuel = 0;
  const fuelBefore = s.stacks
    .filter((t) => t.item === 'diesel')
    .reduce((n, t) => n + (t.liters || 0), 0);
  assert.equal(S.refuel(s, machine.id), '');
  tickUntil(s, () => machine.fuel === machine.tank);
  assert.equal(
    fuelBefore -
      s.stacks.filter((t) => t.item === 'diesel').reduce((n, t) => n + (t.liters || 0), 0),
    machine.tank,
  );
  const operator = s.workers.find((w) => w.role === 'operator')!;
  assert.equal(S.enterVehicle(s, operator.id, machine.id), '');
  tickUntil(s, () => operator.vehicle === machine.id && !operator.transition);
  const goal = { x: 40.5, z: 18.5 };
  assert.equal(S.moveWorker(s, operator.id, goal), '');
  tickUntil(s, () => Math.hypot(machine.x - goal.x, machine.z - goal.z) < 0.1, 120);
  assert.equal(machine.workRole, 'hold');
  assert.ok(machine.fuel < machine.tank && machine.fuel > 0);
});

test('a held purchased forklift still arrives with its operator and drives off its lowloader', () => {
  const s = emptyYard();
  const [orderId] = S.purchase(s, 'forklift', 1);
  tickUntil(s, () => !!s.orders.find((o) => o.id === orderId)!.equipmentId);
  const order = s.orders.find((o) => o.id === orderId)!;
  const machine = s.equipment.find((e) => e.id === order.equipmentId)!;
  assert.equal(machine.transportOrder, orderId);
  assert.equal(S.setEquipmentRole(s, machine.id, 'hold'), '');
  S.purchase(s, 'operator', 1);
  let droveDown = false;
  tickUntil(
    s,
    () => s.orders.every((o) => o.status === 'done'),
    1800,
    () => {
      if (order.deployment === 'offload' && machine.operator && (machine.y || 0) > 0.02)
        droveDown = true;
    },
  );
  assert.ok(droveDown);
  assert.equal(machine.transportOrder, undefined);
  assert.equal(machine.workRole, 'hold');
  assert.equal(s.equipment.length, 1);
});

test('construction, rail, recovery, and paving roles gate their actual work independently', () => {
  const s = S.demoState();
  const excavator = s.equipment.find((e) => e.kind === 'excavator')!;
  const forklift = s.equipment.find((e) => e.kind === 'forklift')!;
  S.setEquipmentRole(s, forklift.id, 'hold');
  S.setEquipmentRole(s, excavator.id, 'construction');
  const building = S.plan(s, 'sanitary', 15, 33).job!;
  const rail = S.plan(s, 'rail', 125, 4).job!;
  const paving = S.plan(s, 'slab', 56, 35).job!;
  const office = s.buildings.find((b) => b.kind === 'office')!;
  assert.equal(S.removeBuilding(s, office.id), '');
  const recovery = s.jobs.find((j) => j.kind === 'remove' && j.target === office.id)!;
  for (const [role, job] of [
    ['construction', building],
    ['rail', rail],
    ['recovery', recovery],
    ['paving', paving],
  ] as const) {
    assert.equal(S.setEquipmentRole(s, excavator.id, role), '');
    tickUntil(
      s,
      () => job.status === 'done',
      1800,
      () => {
        for (const other of [building, rail, recovery, paving])
          if (other.status === 'doing')
            assert.equal(other.id, job.id, `The ${role} machine claimed ${other.kind}`);
      },
    );
    assert.equal(forklift.job, undefined);
  }
  assert.equal(s.buffer.x, 130);
  assert.ok(!s.buildings.some((b) => b.id === office.id));
  assert.ok(s.paving['56,35']);
  for (const item of ['slab', 'rail', 'sanitary', 'office'] as const) conserved(s, item);
});
