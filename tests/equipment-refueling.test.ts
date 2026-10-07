import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { equipmentFuelFiller, equipmentFuelStandingPoint } from '../src/equipment-refueling';
import { equipmentSweepBlocked, workerMoveBlocked } from '../src/traffic';
import { angleDelta } from '../src/motion';
import { equipmentIntent } from '../src/equipment-intent';
import type { EquipmentKind, State } from '../src/types';
import { seedHandlingResources, tickUntil, advance } from './support/yard';

function fixture(kind: EquipmentKind = 'excavator', fuel = 20) {
  const s = S.createState(),
    e = seedHandlingResources(s, kind);
  e.fuel = fuel;
  const drum = {
    id: S.id(s, 'stack'),
    item: 'diesel' as const,
    qty: 1,
    reserved: 0,
    liters: 200,
    x: 32,
    z: 30,
    w: 1,
    d: 1,
    source: 'opening',
  };
  s.stacks.push(drum);
  return { s, e, drum };
}
function fuelTotal(s: State) {
  return (
    s.equipment.reduce((n, e) => n + e.fuel + e.used, 0) +
    s.stacks.filter((t) => t.item === 'diesel').reduce((n, t) => n + (t.liters || 0), 0) +
    s.jobs.reduce((n, j) => n + (j.fuelLiters || 0), 0)
  );
}
function safeTick(s: State, balance: number) {
  const oldMachines = s.equipment.map((e) => ({ ...e, path: e.path.slice() }));
  const oldWorkers = s.workers.map((w) => ({ ...w, path: w.path.slice() }));
  S.tick(s, 0.1);
  assert.ok(
    Math.abs(fuelTotal(s) - balance) < 1e-6,
    'Drums, cans, tanks, and burned fuel remain conserved',
  );
  for (const old of oldMachines) {
    const e = s.equipment.find((e) => e.id === old.id)!;
    assert.ok(Math.hypot(e.x - old.x, e.z - old.z) <= 0.32, 'Equipment does not teleport');
    if (
      Math.hypot(e.x - old.x, e.z - old.z) > 1e-8 ||
      Math.abs(angleDelta(old.yaw || 0, e.yaw || 0)) > 1e-8
    ) {
      assert.equal(
        equipmentSweepBlocked(s, old, e),
        '',
        'Every driven/turning pose passes real swept collision checks',
      );
      const w = s.workers.find((w) => w.id === e.operator);
      assert.equal(w?.vehicle, e.id, 'A real operator is seated during actual machine movement');
    }
  }
  for (const old of oldWorkers) {
    const w = s.workers.find((w) => w.id === old.id)!;
    if (old.vehicle || w.vehicle || old.transition || w.transition) continue;
    assert.ok(Math.hypot(w.x - old.x, w.z - old.z) <= 0.171, 'Workers walk continuously');
    if (Math.hypot(w.x - old.x, w.z - old.z) > 1e-8) assert.equal(workerMoveBlocked(s, old, w), '');
  }
}

for (const kind of ['excavator', 'forklift'] as const)
  test(`${kind} operator boards, drives to the drum, alights and pours physical cans through reload`, () => {
    let { s } = fixture(kind),
      e = s.equipment[0];
    const balance = fuelTotal(s),
      eid = e.id,
      drumId = s.stacks[0].id,
      start = { x: e.x, z: e.z };
    assert.equal(S.refuel(s, e.id), '');
    const jid = s.jobs[0].id,
      phases = new Set<string>(),
      reloaded = new Set<string>();
    let lastFuel = e.fuel,
      seenFill = false,
      seenPour = false;
    for (let i = 0; i < 3000 && s.jobs.find((j) => j.id === jid)!.status !== 'done'; i++) {
      const j = s.jobs.find((j) => j.id === jid)!;
      phases.add(j.phase);
      if (j.phase === 'Fill service can' && j.elapsed > 1 && j.elapsed < 3) seenFill = true;
      if (
        j.phase === 'Carry fuel' &&
        (j.fuelLiters || 0) > 0 &&
        (j.fuelWork?.canDelivered || 0) > 0
      )
        seenPour = true;
      if (j.status === 'doing' && !reloaded.has(j.phase)) {
        s = S.load(S.save(s));
        reloaded.add(j.phase);
        e = s.equipment.find((e) => e.id === eid)!;
      }
      const previousPhase = j.phase,
        workerId = j.worker;
      safeTick(s, balance);
      if (e.fuel > lastFuel + 0.000001) {
        assert.equal(previousPhase, 'Carry fuel');
        const w = s.workers.find((w) => w.id === workerId)!;
        assert.ok(
          Math.hypot(w.x - equipmentFuelStandingPoint(e).x, w.z - equipmentFuelStandingPoint(e).z) <
            0.18,
        );
        assert.ok(e.fuel - lastFuel <= 0.334, 'Can pouring is gradual');
        assert.ok(
          Math.hypot(e.x - (s.stacks.find((t) => t.id === drumId)!.x + 0.5), e.z - 30.5) <= 6.5,
        );
      }
      lastFuel = e.fuel;
    }
    const j = s.jobs.find((j) => j.id === jid)!;
    assert.equal(j.status, 'done');
    assert.equal(e.fuel, e.tank);
    assert.equal(j.fuelLiters, 0);
    assert.ok(
      Math.hypot(e.x - start.x, e.z - start.z) > 10,
      'The equipment travels to its selected barrel',
    );
    assert.ok(seenFill && seenPour);
    for (const phase of [
      'Board equipment',
      'Drive to diesel barrel',
      'Alight for fuel',
      'Collect fuel',
      'Fill service can',
      'Carry fuel',
    ])
      assert.ok(phases.has(phase), phase);
    const collected = s.movements.filter((m) => m.to === jid + '/CAN'),
      poured = s.movements.filter((m) => m.from === jid + '/CAN');
    assert.ok(collected.length >= 2);
    assert.equal(collected.length, poured.length);
    assert.ok(
      Math.abs(collected.reduce((n, m) => n + m.qty, 0) - poured.reduce((n, m) => n + m.qty, 0)) <
        1e-7,
    );
    assert.equal(e.refueling, undefined);
  });

test('manual equipment remains under player control until its operator is released', () => {
  const { s, e } = fixture('forklift'),
    w = s.workers[0];
  Object.assign(w, { vehicle: e.id, x: e.x, z: e.z, duty: 'manual' });
  e.operator = w.id;
  const pose = { x: e.x, z: e.z },
    fuel = e.fuel;
  assert.equal(S.refuel(s, e.id), '');
  advance(s, 3);
  assert.equal(s.jobs[0].status, 'todo');
  assert.match(s.jobs[0].reason, /manual control/);
  assert.deepEqual({ x: e.x, z: e.z }, pose);
  assert.equal(e.fuel, fuel);
  assert.equal(e.refueling, undefined);
  assert.equal(S.releaseWorker(s, w.id), '');
  tickUntil(s, () => s.jobs[0].status === 'done', 300);
  assert.equal(e.fuel, e.tank);
  assert.equal(w.duty, 'auto');
});

test('an inaccessible service position waits, warns once, survives reload and resumes after clearance', () => {
  let { s } = fixture('forklift');
  const eid = s.equipment[0].id,
    balance = fuelTotal(s);
  for (const r of [
    { x: 31, z: 29, w: 3, d: 1 },
    { x: 31, z: 31, w: 3, d: 1 },
    { x: 31, z: 30, w: 1, d: 1 },
    { x: 33, z: 30, w: 1, d: 1 },
  ])
    s.buildings.push({
      ...r,
      id: S.id(s, 'building'),
      kind: 'fence',
      rotation: 0,
      name: 'Closed fuel enclosure',
      source: 'opening',
      connected: true,
    });
  S.refuel(s, eid);
  tickUntil(s, () => s.notices.some((n) => n.title === 'Equipment refueling blocked'), 50);
  const j = s.jobs[0],
    e = s.equipment[0];
  assert.equal(j.phase, 'Drive to diesel barrel');
  assert.equal(j.fuelLiters, undefined);
  assert.equal(e.x, 8.5);
  const n = s.notices.find((n) => n.title === 'Equipment refueling blocked')!;
  assert.equal(n.severity, 'warning');
  advance(s, 5);
  assert.equal(s.notices.filter((n) => n.title === 'Equipment refueling blocked').length, 1);
  s = S.load(S.save(s));
  s.buildings = [];
  tickUntil(
    s,
    () => s.jobs[0].status === 'done',
    300,
    () => assert.ok(Math.abs(fuelTotal(s) - balance) < 1e-6),
  );
  assert.equal(s.notices.find((q) => q.id === n.id)?.state, 'done');
});

test('a dry machine receives explicit stationary emergency service without a driver or free diesel', () => {
  const { s, e } = fixture('excavator', 0),
    balance = fuelTotal(s),
    pose = { x: e.x, z: e.z };
  s.workers = s.workers.filter((w) => w.role === 'builder');
  S.refuel(s, e.id);
  tickUntil(
    s,
    () => s.jobs[0].status === 'done',
    300,
    () => {
      assert.deepEqual({ x: e.x, z: e.z }, pose);
      assert.equal(e.operator, undefined);
      assert.ok(Math.abs(fuelTotal(s) - balance) < 1e-6);
    },
  );
  assert.equal(s.jobs[0].fuelWork?.mode, 'emergency');
  assert.match(s.jobs[0].fuelWork?.emergencyReason || '', /Tank empty/);
  assert.ok(s.events.some((v) => v.text.includes('Stationary emergency can service')));
  assert.equal(e.fuel, e.tank);
});

test('an unloaded parked operator can alight and service their own empty tank without another worker', () => {
  const { s, e } = fixture('forklift', 0),
    w = s.workers[0];
  Object.assign(w, { vehicle: e.id, x: e.x, z: e.z });
  e.operator = w.id;
  const balance = fuelTotal(s),
    pose = { x: e.x, z: e.z };
  S.refuel(s, e.id);
  tickUntil(s, () => s.jobs[0].phase === 'Alight for fuel', 10);
  tickUntil(
    s,
    () => s.jobs[0].status === 'done',
    300,
    () => {
      assert.deepEqual({ x: e.x, z: e.z }, pose);
      assert.ok(Math.abs(fuelTotal(s) - balance) < 1e-6);
    },
  );
  assert.equal(e.fuel, e.tank);
  assert.equal(w.vehicle, undefined);
});

test('canceling a carried can pours only that conserved can and leaves subsequent diesel in its drum', () => {
  const { s, e, drum } = fixture('forklift', 5),
    balance = fuelTotal(s);
  S.refuel(s, e.id);
  tickUntil(s, () => s.jobs[0].phase === 'Carry fuel' && (s.jobs[0].fuelLiters || 0) > 0, 120);
  const j = s.jobs[0],
    amount = j.fuelLiters!,
    remaining = drum.liters;
  S.cancelJob(s, j.id);
  assert.equal(j.cancel, true);
  tickUntil(
    s,
    () => j.status === 'done',
    120,
    () => assert.ok(Math.abs(fuelTotal(s) - balance) < 1e-6),
  );
  assert.equal(drum.liters, remaining);
  assert.ok(e.fuel < e.tank);
  assert.ok(Math.abs(j.fuelWork!.delivered - amount) < 1e-6);
  S.load(S.save(s));
});

test('fuel service intent points at the selected drum, service position and actual filler', () => {
  const { s, e, drum } = fixture('forklift');
  S.refuel(s, e.id);
  tickUntil(s, () => !!s.jobs[0].fuelWork?.station, 60);
  const j = s.jobs[0],
    intent = equipmentIntent(s, e);
  assert.equal(intent.targetLabel, 'Fuel service position');
  assert.ok(intent.references.includes(drum.id));
  tickUntil(s, () => j.phase === 'Carry fuel', 120);
  const filler = equipmentFuelFiller(e),
    pour = equipmentIntent(s, e);
  assert.equal(pour.targetLabel, 'Equipment fuel filler');
  assert.deepEqual(pour.target, { x: filler.x, z: filler.z });
});

test('refueling import rejects impossible can balances, missing sources and invented drivers', () => {
  const { s, e } = fixture('forklift');
  S.refuel(s, e.id);
  tickUntil(s, () => s.jobs[0].phase === 'Carry fuel', 120);
  const raw = S.save(s);
  S.load(raw);
  for (const change of [
    (q: State) => (q.jobs[0].fuelLiters = 21),
    (q: State) => (q.jobs[0].fuelWork!.canDelivered = 21),
    (q: State) => (q.jobs[0].fuelWork!.barrelId = 'STK-missing'),
    (q: State) => (q.jobs[0].fuelWork!.station!.x = Infinity),
    (q: State) => (q.jobs[0].operator = 'WRK-missing'),
    (q: State) => (q.jobs[0].fuelWork!.mode = 'remote' as any),
    (q: State) => (q.jobs[0].phase = 'Teleport to barrel'),
  ]) {
    const q = JSON.parse(raw);
    change(q);
    assert.throws(() => S.load(JSON.stringify(q)), /refueling|service-can/);
  }
});

test('queued refueling takes the next safe stop ahead of another slab while retaining the group equipment assignment', () => {
  const s = S.demoState(),
    e = s.equipment.find((e) => e.kind === 'excavator')!;
  for (const q of s.equipment) S.setEquipmentRole(s, q.id, q.id === e.id ? 'paving' : 'hold');
  e.fuel = 20;
  const work = S.pave(s, { x: 56, z: 35, w: 2, d: 1 });
  const first = s.jobs.find((j) => j.kind === 'slab')!;
  tickUntil(s, () => first.handling?.state === 'carried', 500);
  assert.equal(S.refuel(s, e.id), '');
  const fuel = s.jobs.find((j) => j.kind === 'refuel')!,
    other = s.jobs.find((j) => j.kind === 'slab' && j.id !== first.id)!;
  assert.ok(other);
  tickUntil(s, () => fuel.status === 'doing', 500);
  assert.ok(
    first.handling?.equipmentReleased || first.status === 'done',
    'The current physical load is supported before diverting',
  );
  assert.equal(other.equipment, undefined, 'The next slab cannot steal the refueling machine');
  const group = s.jobGroups!.find((g) => g.id === first.parentId)!;
  const automatic = group.automaticEquipment,
    preferred = group.preferredEquipment;
  tickUntil(s, () => fuel.status === 'done', 500);
  assert.equal(group.automaticEquipment, automatic);
  assert.equal(group.preferredEquipment, preferred);
  tickUntil(s, () => other.status === 'done', 500);
  assert.equal(s.equipment.find((q) => q.id === e.id)!.refueling, undefined);
  assert.ok(work);
});

test('emergency service keeps a real carried slab, work ownership and route in place until the tank is filled', () => {
  const s = S.demoState();
  s.equipment = s.equipment.filter((e) => e.kind === 'excavator');
  s.jobs = [];
  const e = s.equipment[0],
    work = S.plan(s, 'slab', 50, 45).job!;
  tickUntil(s, () => work.handling?.phase === 'carry' && e.path.length > 0, 500);
  e.fuel = 0;
  const cargo = { ...e.cargo! },
    pose = { x: e.x, z: e.z, yaw: e.yaw },
    route = e.path.map((p) => ({ ...p })),
    panel = { ...work.handling!.pose };
  const balance = fuelTotal(s);
  S.refuel(s, e.id);
  const service = s.jobs.find((j) => j.kind === 'refuel')!;
  tickUntil(
    s,
    () => service.status === 'done',
    700,
    () => {
      assert.deepEqual({ x: e.x, z: e.z, yaw: e.yaw }, pose);
      assert.deepEqual(e.path, route);
      assert.deepEqual(e.cargo, cargo);
      assert.deepEqual(work.handling!.pose, panel);
      assert.equal(e.job, work.id);
      assert.ok(Math.abs(fuelTotal(s) - balance) < 1e-6);
    },
  );
  assert.equal(service.fuelWork?.mode, 'emergency');
  assert.equal(e.job, work.id);
  tickUntil(s, () => work.status === 'done', 500);
  assert.equal(e.cargo, undefined);
});

test('fuel exhausted during the real drive switches to stationary service without teleporting or inventing an assistant', () => {
  let { s } = fixture('forklift', 0.03);
  const balance = fuelTotal(s),
    eid = s.equipment[0].id;
  S.refuel(s, eid);
  tickUntil(s, () => s.jobs[0].fuelWork?.mode === 'emergency', 80);
  const stopped = { x: s.equipment[0].x, z: s.equipment[0].z };
  assert.ok(stopped.x > 8.5, 'Some actual movement preceded the fuel interruption');
  assert.match(s.jobs[0].fuelWork!.emergencyReason!, /Fuel exhausted/);
  s = S.load(S.save(s));
  tickUntil(
    s,
    () => s.jobs[0].status === 'done',
    300,
    () => {
      assert.deepEqual({ x: s.equipment[0].x, z: s.equipment[0].z }, stopped);
      assert.ok(Math.abs(fuelTotal(s) - balance) < 1e-6);
    },
  );
  assert.equal(s.workers.length, 1);
  assert.equal(s.equipment[0].fuel, s.equipment[0].tank);
});

test('a late filler obstruction retains the carried can, warns and resumes after the real walking route is cleared', () => {
  const { s, e } = fixture('forklift'),
    balance = fuelTotal(s);
  S.refuel(s, e.id);
  tickUntil(s, () => s.jobs[0].phase === 'Carry fuel', 120);
  const j = s.jobs[0],
    fuel = e.fuel,
    carried = j.fuelLiters;
  const point = equipmentFuelStandingPoint(e);
  s.buildings.push({
    id: S.id(s, 'building'),
    kind: 'fence',
    x: point.x - 0.4,
    z: point.z - 0.4,
    w: 0.8,
    d: 0.8,
    rotation: 0,
    name: 'Temporary obstruction',
    source: 'opening',
    connected: true,
  });
  tickUntil(
    s,
    () => s.notices.some((n) => n.title === 'Equipment refueling blocked'),
    50,
    () => {
      assert.equal(e.fuel, fuel);
      assert.equal(j.fuelLiters, carried);
      assert.ok(Math.abs(fuelTotal(s) - balance) < 1e-6);
    },
  );
  advance(s, 5);
  assert.equal(s.notices.filter((n) => n.title === 'Equipment refueling blocked').length, 1);
  S.load(S.save(s));
  s.buildings = [];
  tickUntil(s, () => j.status === 'done', 300);
  assert.equal(e.fuel, e.tank);
});

test('old stationary can-service saves retain their actual can and acquire the new metadata safely', () => {
  let { s } = fixture('forklift');
  const e = s.equipment[0],
    w = s.workers[0],
    barrel = s.stacks[0];
  S.refuel(s, e.id);
  const j = s.jobs[0];
  Object.assign(j, {
    status: 'doing',
    phase: 'Carry fuel',
    worker: w.id,
    equipment: e.id,
    stack: barrel.id,
    fuelLiters: 10,
    qty: 1,
  });
  Object.assign(w, { job: j.id, x: 31.5, z: 30.5 });
  e.job = j.id;
  e.refueling = j.id;
  barrel.liters = 190;
  const balance = fuelTotal(s);
  s = S.load(S.save(s));
  S.tick(s, 0.1);
  assert.equal(s.jobs[0].fuelWork!.mode, 'emergency');
  assert.equal(s.jobs[0].fuelLiters, 10);
  tickUntil(
    s,
    () => s.jobs[0].status === 'done',
    300,
    () => assert.ok(Math.abs(fuelTotal(s) - balance) < 1e-6),
  );
  S.load(S.save(s));
  assert.equal(s.equipment[0].fuel, s.equipment[0].tank);
});

function yieldedFuelFixture() {
  const { s, e, drum } = fixture('forklift', 27);
  Object.assign(e, { x: 25.5, z: 43.5, yaw: Math.PI / 2, heading: 1, reach: 3 });
  Object.assign(drum, { x: 25, z: 49 });
  s.stacks.push({ ...drum, id: S.id(s, 'stack'), x: 24 });
  const worker = s.workers[0],
    loaded = seedHandlingResources(s, 'excavator');
  const driver = s.workers[s.workers.length - 2];
  const orderId = S.id(s, 'order');
  Object.assign(loaded, {
    x: 27.5,
    z: 37.5,
    yaw: Math.PI / 2,
    heading: 1,
    reach: 3,
    lift: 0.4,
    cargo: { item: 'sanitary', qty: 1 },
    operator: driver.id,
    deliveryOrder: orderId,
    work: 1,
    path: [{ x: 27.5, z: 46 }],
  });
  Object.assign(driver, { x: loaded.x, z: loaded.z, vehicle: loaded.id, deliveryOrder: orderId });
  s.orders.push({
    id: orderId,
    item: 'sanitary',
    qty: 1,
    arrived: 1,
    mode: 'road',
    status: 'departing',
    eta: s.time,
    total: 0,
    invoiced: true,
    vehicle: { x: -100, z: -15.1 },
    stage: 0,
    handler: { x: 20, z: 20 },
    handling: 0,
    note: 'Hauling real opening cargo',
    carrierDeparted: true,
    allocated: { x: 26, z: 48, w: 3, d: 2 },
    unload: {
      item: 'sanitary',
      lineIndex: 0,
      equipmentId: loaded.id,
      operatorId: driver.id,
      phase: 'carry',
      clock: 0,
      qty: 1,
      source: { x: 18.6, z: 18 },
      sourceY: 1.15,
      sourceYaw: 0,
      pickup: { x: 18.6, z: 22 },
      destination: { x: 26, z: 48, w: 3, d: 2 },
      drop: { x: 27.5, z: 46 },
      dropYaw: Math.PI / 2,
      destinationY: 0,
      rigged: true,
      cargo: { x: 27.5, z: 40.5, y: 0.4, yaw: Math.PI },
    },
  });
  S.refuel(s, e.id);
  const j = s.jobs[0];
  Object.assign(j, {
    status: 'doing',
    phase: 'Fill service can',
    elapsed: 1,
    worker: worker.id,
    operator: worker.id,
    equipment: e.id,
    stack: drum.id,
    fuelWork: {
      mode: 'station',
      barrelId: drum.id,
      delivered: 0,
      station: { x: e.x, z: e.z, yaw: e.yaw!, reverse: false },
    },
  });
  e.job = j.id;
  e.refueling = j.id;
  Object.assign(worker, {
    x: 22.5,
    z: 48.5,
    yaw: Math.PI,
    job: j.id,
    yieldingTo: loaded.id,
    yieldTarget: { x: 25.5, z: 48.5 },
    status: 'Stepping clear of moving equipment',
    path: [],
  });
  return { s, e, drum, worker, loaded, j };
}

test('a refueling operator resumes safely after a completed escape while a loaded neighbor waits for the parked machine', () => {
  let { s, e, worker, loaded, j } = yieldedFuelFixture();
  s = S.load(S.save(s));
  e = s.equipment.find((q) => q.id === e.id)!;
  worker = s.workers.find((q) => q.id === worker.id)!;
  loaded = s.equipment.find((q) => q.id === loaded.id)!;
  j = s.jobs.find((q) => q.id === j.id)!;
  const balance = fuelTotal(s),
    start = { x: worker.x, z: worker.z };
  let resumedBeforeNeighborFinished = false;
  for (let n = 0; n < 600 && j.status !== 'done'; n++) {
    safeTick(s, balance);
    resumedBeforeNeighborFinished ||= !worker.yieldingTo && loaded.path.length > 0;
  }
  assert.ok(
    resumedBeforeNeighborFinished,
    'Safe fuel work can resume before the blocked vehicle finishes its trip',
  );
  assert.equal(
    j.status,
    'done',
    'A completed escape must not wait for the entire blocked neighbor trip',
  );
  assert.equal(e.fuel, e.tank);
  assert.ok(Math.hypot(worker.x - start.x, worker.z - start.z) > 1);
  assert.equal(worker.yieldingTo, undefined);
  assert.equal(loaded.cargo?.item, 'sanitary', 'The waiting neighbor retains its physical load');
});

test('a completed fuel escape retains clearance when every return approach crosses the loaded corridor or a wall', () => {
  const { s, worker, j } = yieldedFuelFixture();
  s.buildings.push({
    id: S.id(s, 'building'),
    kind: 'fence',
    x: 20,
    z: 50,
    w: 10,
    d: 1,
    rotation: 0,
    connected: false,
    name: 'No north approach',
  });
  // The south and east faces are within this wider actual carried load sweep.
  const loaded = s.equipment[1];
  loaded.cargo = { item: 'office', qty: 1 };
  loaded.fuel = 0;
  s.orders[0].item = 'office';
  s.orders[0].unload!.item = 'office';
  const start = { x: worker.x, z: worker.z },
    liters = s.stacks.reduce((n, t) => n + (t.liters || 0), 0);
  advance(s, 25);
  assert.equal(j.phase, 'Fill service can');
  assert.equal(j.fuelLiters || 0, 0);
  assert.equal(
    s.stacks.reduce((n, t) => n + (t.liters || 0), 0),
    liters,
  );
  assert.deepEqual({ x: worker.x, z: worker.z }, start);
  assert.ok(worker.yieldingTo, 'An unsafe return must retain its clearance owner');
  assert.equal(
    s.notices.filter((n) => n.title === 'Equipment refueling blocked' && n.state !== 'done').length,
    1,
  );
});
