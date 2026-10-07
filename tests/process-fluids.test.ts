import { wireOpeningConsumer } from './support/electrical';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { orderTankers } from '../src/rail-tankers';
import {
  PROCESS_LINE_CAPACITY,
  reconcileProcessAssets,
  tickProcessFluids,
  configureProcessPump,
  requestPumpHose,
  disconnectPumpHose,
  requestProcessValve,
  setProcessPumpRunning,
  processRows,
  processNetworkRoute,
  processRailCarLocked,
  processRecoveryConflict,
  processPorts,
  processHosePaths,
} from '../src/process-fluids';
import { processValidationProblem } from '../src/process-validation';
import { workerAvailable } from '../src/workforce';
import type { State, BuildKind, Worker } from '../src/types';
function building(s: State, kind: BuildKind, x: number, z: number, w = 1, d = 1, rotation = 0) {
  const b = { id: S.id(s, 'building'), kind, x, z, w, d, rotation, connected: false, name: kind };
  s.buildings.push(b);
  return b;
}
function fixture(product: 'bulkWater' | 'bulkDiesel' = 'bulkWater', liters = 1000) {
  const s = S.createState();
  s.utilities.power = true;
  assert.equal(orderTankers(s, { product, litersPerCar: liters, carCount: 1 }).error, undefined);
  const o = s.orders[0],
    c = o.railFreight!.cars[0];
  o.status = 'unloading';
  o.vehicle = { x: 37, z: 20 };
  c.pose = { x: 24, z: 20, yaw: 0 };
  const pump = building(s, 'transferPump', 24, 24, 2, 2),
    tank = building(s, 'processTank', 30, 22, 4, 4);
  for (let x = 26; x < 30; x++) building(s, 'processPipe', x, 24);
  wireOpeningConsumer(s,pump);
  reconcileProcessAssets(s);
  assert.equal(configureProcessPump(s, pump.id, { tankId: tank.id }), undefined);
  const p = s.process!.pumps[0];
  p.carId = c.id;
  p.hose = 'connected';
  s.process!.sources.push({ carId: c.id, product, initialLiters: liters, initialArrived: 0 });
  return { s, o, c, p, pump, tank };
}
function start(f: ReturnType<typeof fixture>) {
  assert.equal(setProcessPumpRunning(f.s, f.p.id, true), undefined);
}
function worker(s: State, x = 20, z = 25) {
  const w: Worker = {
    id: S.id(s, 'worker'),
    name: 'Worker #1',
    role: 'engineer' as const,
    duty: 'auto' as const,
    status: 'Available',
    x,
    z,
    path: [],
    heading: 0,
    hours: 0,
    wage: 30,
  };
  s.workers.push(w);
  return w;
}
function advanceWalking(s: State, dt = 0.1) {
  s.time += dt;
  tickProcessFluids(s, dt);
  for (const w of s.workers) {
    let movement = dt * 1.7;
    while (movement > 0 && w.path.length) {
      const p = w.path[0],
        d = Math.hypot(p.x - w.x, p.z - w.z),
        step = Math.min(d, movement);
      if (d) {
        w.x += ((p.x - w.x) * step) / d;
        w.z += ((p.z - w.z) * step) / d;
      }
      movement -= step;
      if (d <= step + 1e-8) w.path.shift();
      else break;
    }
  }
}
test('finite DN100 lines fill in sequence before tank receives fluid, conserving every fractional liter', () => {
  const f = fixture();
  start(f);
  tickProcessFluids(f.s, 1);
  assert.equal(f.s.process!.tanks[0].liters, 0);
  assert.equal(f.s.process!.lines[0].liters, 5);
  assert.equal(f.s.process!.lines[1].liters, 0);
  tickProcessFluids(f.s, 10);
  assert.ok(Math.abs(f.s.process!.tanks[0].liters - (55 - 4 * PROCESS_LINE_CAPACITY)) < 1e-8);
  assert.equal(f.c.tank!.liters, 945);
  assert.equal(f.c.manifest[0].arrived, 55);
  assert.equal(f.o.arrived, 55);
  assert.equal(processValidationProblem(f.s), undefined);
  assert.ok(Math.abs(processRows(f.s).balance[0].difference) < 1e-8);
  const reloaded = structuredClone(f.s);
  tickProcessFluids(reloaded, 1);
  assert.equal(processValidationProblem(reloaded), undefined);
});
test('closed valves isolate actual pipe graph; workers physically approach and turn handwheel', () => {
  const f = fixture();
  const b = f.s.buildings.find((b) => b.x === 28 && b.kind === 'processPipe')!;
  b.kind = 'processValve';
  reconcileProcessAssets(f.s);
  assert.equal(processNetworkRoute(f.s, f.p.id, f.tank.id), undefined);
  assert.match(setProcessPumpRunning(f.s, f.p.id, true)!, /open/);
  const w = worker(f.s);
  assert.equal(requestProcessValve(f.s, b.id, true, w.id), undefined);
  assert.equal(workerAvailable(f.s, w), false);
  assert.equal(f.s.process!.valves[0].open, false);
  for (let i = 0; i < 300 && !f.s.process!.valves[0].open; i++) advanceWalking(f.s);
  assert.equal(f.s.process!.valves[0].open, true);
  assert.equal(w.processAssignment, undefined);
  assert.equal(processValidationProblem(f.s), undefined);
  start(f);
  tickProcessFluids(f.s, 10);
  assert.ok(f.c.tank!.liters < 1000);
});
test('connected hose locks physical tanker, crew connect and disconnect through walked work points', () => {
  const f = fixture();
  f.p.hose = 'disconnected';
  f.p.carId = undefined;
  f.s.process!.sources = [];
  const w = worker(f.s);
  assert.equal(requestPumpHose(f.s, f.p.id, f.c.id, w.id), undefined);
  assert.equal(f.p.hose, 'connecting');
  assert.equal(processRailCarLocked(f.s, f.c.id), f.p.id);
  assert.match(setProcessPumpRunning(f.s, f.p.id, true)!, /Connect/);
  tickProcessFluids(f.s, 0.1);
  assert.equal(f.p.hose, 'connecting');
  for (let i = 0; i < 600 && f.s.process!.pumps[0].hose !== 'connected'; i++) advanceWalking(f.s);
  assert.equal(f.p.hose, 'connected');
  assert.equal(processValidationProblem(f.s), undefined);
  assert.equal(processHosePaths(f.s)[0].points.at(-1)!.y, 1.66);
  assert.equal(disconnectPumpHose(f.s, f.p.id, w.id), undefined);
  assert.equal(processRailCarLocked(f.s, f.c.id), f.p.id);
  for (let i = 0; i < 600 && f.s.process!.pumps[0].hose !== 'disconnected'; i++)
    advanceWalking(f.s);
  assert.equal(f.p.hose, 'disconnected');
  assert.equal(processRailCarLocked(f.s, f.c.id), undefined);
  assert.equal(processValidationProblem(f.s), undefined);
});
test('unfinished gaps, incompatible liquids, dry sources and supply loss stop transfer without losing contents', () => {
  const f = fixture();
  start(f);
  const removed = f.s.buildings.splice(
    f.s.buildings.findIndex((b) => b.kind === 'processPipe'),
    1,
  )[0];
  tickProcessFluids(f.s, 1);
  assert.match(f.p.status, /continuous/);
  assert.equal(f.c.tank!.liters, 1000);
  f.s.buildings.push(removed);
  reconcileProcessAssets(f.s);
  f.s.process!.tanks[0].product = 'bulkDiesel';
  tickProcessFluids(f.s, 1);
  assert.match(f.p.status, /Incompatible/);
  assert.equal(f.c.tank!.liters, 1000);
  f.s.process!.tanks[0].product = undefined;
  f.s.utilities.power = false;
  tickProcessFluids(f.s, 1);
  assert.match(f.p.status, /electrical/);
  assert.equal(f.c.tank!.liters, 1000);
  f.s.utilities.power = true;
  tickProcessFluids(f.s, 250);
  assert.equal(f.c.tank!.liters, 0);
  assert.equal(processValidationProblem(f.s), undefined);
  assert.match(f.p.status, /empty/);
});
test('pipe ports rotate cardinals and connect only opposing coincident nozzles', () => {
  const s = S.createState(),
    elbow = building(s, 'pipeElbow', 10, 10, 1, 1, 1);
  const ports = processPorts(elbow);
  assert.deepEqual(
    ports.map((p) => [p.x, p.z, p.dx, p.dz]),
    [
      [10.5, 10, 0, -1],
      [11, 10.5, 1, 0],
    ],
  );
  const f = fixture();
  const middle = f.s.buildings.find((b) => b.x === 27 && b.kind === 'processPipe')!;
  middle.rotation = 1;
  assert.equal(processNetworkRoute(f.s, f.p.id, f.tank.id), undefined);
});
test('inventory validation rejects corruption and recovery forbids deleting contained liquid or live hose', () => {
  const f = fixture();
  start(f);
  tickProcessFluids(f.s, 20);
  assert.match(processRecoveryConflict(f.s, f.tank.id)!, /Drain/);
  assert.match(processRecoveryConflict(f.s, f.p.id)!, /disconnect/);
  const clone = structuredClone(f.s);
  clone.process!.tanks[0].liters += 1;
  assert.match(processValidationProblem(clone)!, /Unbalanced/);
  const bad = structuredClone(f.s);
  bad.process!.lines[0].capacity = 999;
  assert.match(processValidationProblem(bad)!, /capacity/);
  const orphan = structuredClone(f.s);
  orphan.workers.push({ ...worker(S.createState()), processAssignment: 'NONEXISTENT' });
  assert.match(processValidationProblem(orphan)!, /orphan/);
});
test('gauge measures actual flow and connected tank level without inventing pressure', () => {
  const f = fixture();
  f.s.buildings.find((b) => b.x === 28 && b.kind === 'processPipe')!.kind = 'processGauge';
  f.s.buildings.find((b) => b.x === 26 && b.kind === 'processPipe')!.kind = 'processValve';
  reconcileProcessAssets(f.s);
  f.s.process!.valves[0].open = true;
  start(f);
  tickProcessFluids(f.s, 20);
  tickProcessFluids(f.s, 1);
  const gauge = processRows(f.s).gauges[0];
  assert.equal(gauge.reading, 5);
  assert.equal(gauge.tankId, f.tank.id);
  assert.equal(gauge.level, f.s.process!.tanks[0].liters);
  assert.equal(gauge.calibrated, true);
  assert.equal('pressure' in gauge, false);
  const rows = processRows(f.s);
  assert.equal(gauge.connectedTo.length, 2);
  assert.ok(rows.pumps[0].route.includes(gauge.id));
  assert.equal(rows.pumps[0].route.at(-1), f.tank.id);
  assert.ok(rows.tanks[0].connectedTo.includes(rows.pumps[0].route.at(-2)!));
  const beforeReport = JSON.stringify(f.s);
  processRows(f.s);
  assert.equal(JSON.stringify(f.s), beforeReport, 'connection reports are read-only');
  f.s.process!.valves[0].open = false;
  assert.deepEqual(processRows(f.s).pumps[0].route, []);
  assert.ok(processRows(f.s).pumps[0].installedRoute.includes(gauge.id));
  f.s.process!.valves[0].open = true;
  setProcessPumpRunning(f.s, f.p.id, false);
  tickProcessFluids(f.s, 1);
  assert.equal(processRows(f.s).gauges[0].reading, 0);
});
test('transfer ledger aggregates whole runs rather than allocating one row per tick', () => {
  const f = fixture('bulkDiesel', 10000);
  start(f);
  for (let i = 0; i < 3000; i++) tickProcessFluids(f.s, 0.1);
  assert.equal(f.s.process!.ledger.length, 5);
  assert.equal(processValidationProblem(f.s), undefined);
  assert.ok(Math.abs(f.p.transferred - 1500) < 1e-7);
});
test('full tank stops precisely and restart after power restoration preserves transfer accounting', () => {
  const f = fixture('bulkWater', 30000);
  start(f);
  tickProcessFluids(f.s, 6001);
  assert.equal(f.c.tank!.liters, 0);
  assert.ok(Math.abs(f.s.process!.tanks[0].liters - (30000 - 4 * PROCESS_LINE_CAPACITY)) < 1e-7);
  assert.equal(processValidationProblem(f.s), undefined);
  assert.equal(f.p.transferred, 30000);
  const g = fixture();
  start(g);
  tickProcessFluids(g.s, 5);
  g.s.utilities.power = false;
  tickProcessFluids(g.s, 5);
  assert.equal(g.c.tank!.liters, 975);
  g.s.utilities.power = true;
  tickProcessFluids(g.s, 5);
  assert.equal(g.c.tank!.liters, 950);
  assert.equal(processValidationProblem(g.s), undefined);
});
test('real public commands receive, connect, transfer, reload mid-run and preserve fractional tanker inventory', async () => {
  const { createProcessYard } = await import('./support/process');
  let { s, car, pump, tank } = createProcessYard({ running: true });
  S.tick(s, 0.1);
  assert.equal(s.orders[0].railFreight!.cars[0].tank!.liters, 999.5);
  s = S.load(S.save(s));
  for (let i = 0; i < 300; i++) S.tick(s, 0.1);
  assert.equal(processValidationProblem(s), undefined);
  assert.ok(s.process!.tanks.find((t) => t.id === tank.id)!.liters > 0);
  assert.equal(s.process!.pumps.find((p) => p.id === pump.id)!.carId, car.id);
  S.load(S.save(s));
});
test('hose approach and valve work are persistent, exclusive reservations across mid-operation reload', async () => {
  const { createProcessYard } = await import('./support/process');
  let { s, pump, car, worker: w } = createProcessYard();
  assert.equal(requestPumpHose(s, pump.id, car.id, w.id), undefined);
  S.tick(s, 0.1);
  assert.equal(s.process!.pumps[0].hose, 'connecting');
  s = S.load(S.save(s));
  for (let i = 0; i < 900 && String(s.process!.pumps[0].hose) !== 'connected'; i++) S.tick(s, 0.1);
  assert.equal(s.process!.pumps[0].hose, 'connected');
  assert.equal(s.workers[0].processAssignment, undefined);
  S.load(S.save(s));
});
test('two pumps share final tank capacity fairly through a real tee without overfilling', () => {
  const f = fixture('bulkWater', 30000),
    s = f.s;
  const junction = s.buildings.find((b) => b.kind === 'processPipe' && b.x === 28)!;
  junction.kind = 'pipeTee';
  junction.rotation = 2;
  const pump2 = building(s, 'transferPump', 26, 28, 2, 2);
  const source=s.buildings.find(b=>b.kind==='power')!;
  wireOpeningConsumer(s,pump2,source,[...Array.from({length:4},(_,i)=>({x:source.x,z:source.z+1+i})),...Array.from({length:6},(_,i)=>({x:source.x+1+i,z:28}))]);
  building(s, 'pipeElbow', 28, 28);
  for (let z = 25; z < 28; z++) building(s, 'processPipe', 28, z, 1, 1, 1);
  assert.equal(
    orderTankers(s, { product: 'bulkWater', litersPerCar: 30000, carCount: 1 }).error,
    undefined,
  );
  const o2 = s.orders[1],
    c2 = o2.railFreight!.cars[0];
  o2.status = 'unloading';
  c2.pose = { x: 26, z: 24, yaw: 0 };
  reconcileProcessAssets(s);
  const p2 = s.process!.pumps.find((p) => p.id === pump2.id)!;
  p2.carId = c2.id;
  p2.hose = 'connected';
  p2.tankId = f.tank.id;
  s.process!.sources.push({
    carId: c2.id,
    product: 'bulkWater',
    initialLiters: 30000,
    initialArrived: 0,
  });
  const tank = s.process!.tanks[0];
  tank.product = 'bulkWater';
  tank.liters = 29999;
  for (const l of s.process!.lines) {
    l.product = 'bulkWater';
    l.liters = l.capacity;
  }
  const stored = tank.liters + s.process!.lines.reduce((n, l) => n + l.liters, 0),
    half = stored / 2;
  for (const [o, c] of [
    [f.o, f.c],
    [o2, c2],
  ] as const) {
    c.tank!.liters -= half;
    c.manifest[0].arrived = half;
    o.manifest![0].arrived = half;
    o.arrived = half;
  }
  start(f);
  assert.equal(setProcessPumpRunning(s, p2.id, true), undefined);
  tickProcessFluids(s, 0.25);
  assert.ok(Math.abs(f.p.transferred - 0.5) < 1e-7);
  assert.ok(Math.abs(p2.transferred - 0.5) < 1e-7);
  assert.equal(tank.liters, 30000);
  assert.equal(processValidationProblem(s), undefined);
});
test('hose end follows the actual worker while carried, instead of appearing at tanker immediately', () => {
  const f = fixture();
  f.p.hose = 'disconnected';
  f.p.carId = undefined;
  f.s.process!.sources = [];
  const w = worker(f.s);
  assert.equal(requestPumpHose(f.s, f.p.id, f.c.id, w.id), undefined);
  let hose = processHosePaths(f.s)[0];
  assert.ok(
    Math.hypot(hose.points.at(-1)!.x - f.c.pose!.x, hose.points.at(-1)!.z - f.c.pose!.z) > 2,
  );
  for (let i = 0; i < 300 && f.s.process!.operations[0].phase !== 1; i++) advanceWalking(f.s);
  assert.equal(f.s.process!.operations[0].phase, 1);
  hose = processHosePaths(f.s)[0];
  assert.equal(hose.points.at(-1)!.x, w.x);
  assert.equal(hose.points.at(-1)!.z, w.z);
});
test('reserved process work warns once when a worker cannot make walking progress', () => {
  const f = fixture();
  f.p.hose = 'disconnected';
  f.p.carId = undefined;
  f.s.process!.sources = [];
  const w = worker(f.s);
  assert.equal(requestPumpHose(f.s, f.p.id, f.c.id, w.id), undefined);
  for (let i = 0; i < 200; i++) {
    f.s.time += 0.1;
    tickProcessFluids(f.s, 0.1);
  }
  assert.equal(f.s.notices.filter((n) => n.entity === w.processAssignment).length, 1);
  assert.equal(
    f.s.events.filter((e) => e.entity === w.processAssignment && e.severity === 'warning').length,
    1,
  );
});
test('fully drained fractional tanker disconnects and qualifies for a real empty return', async () => {
  const { createProcessYard } = await import('./support/process'),
    { tickUntil } = await import('./support/yard'),
    { detachRailFreight, requestEmptyReturn } = await import('../src/rail-operations');
  const f = createProcessYard({ liters: 11, running: true });
  tickUntil(f.s, () => f.car.tank!.liters === 0, 30);
  assert.equal(f.car.manifest[0].arrived, 11);
  assert.equal(f.order.arrived, 11);
  setProcessPumpRunning(f.s, f.pump.id, false);
  assert.equal(disconnectPumpHose(f.s, f.pump.id, f.worker.id), undefined);
  tickUntil(f.s, () => f.s.process!.pumps[0].hose === 'disconnected', 180);
  assert.equal(detachRailFreight(f.s, f.order.id), undefined);
  tickUntil(f.s, () => f.order.railFreight!.locomotivePhase === 'gone', 1000);
  assert.equal(requestEmptyReturn(f.s, { orderIds: [f.order.id] }).error, undefined);
  S.load(S.save(f.s));
});
test('two cars transferred fractionally in the same train maintain exact grouped manifest totals on reload', async () => {
  const { createProcessYard } = await import('./support/process'),
    { tickUntil } = await import('./support/yard'),
    { railFreightCarPose } = await import('../src/rail-freight');
  const f = createProcessYard({ carCount: 2, connect: true }),
    s = f.s,
    c = s.orders[0].railFreight!.cars[1],
    pose = railFreightCarPose(s.orders[0], 1),
    x = Math.ceil(pose.x),
    z = 14;
  function place(kind: BuildKind, px: number, pz: number) {
    const r = S.plan(s, kind, px, pz, 0);
    assert.equal(r.error, '');
    return s.buildings.at(-1)!;
  }
  const pump = place('transferPump', x, z),
    tank = place('processTank', x + 8, z - 2);
  for (let i = 2; i < 8; i++) place('processPipe', x + i, z);
  wireOpeningConsumer(s,pump);
  assert.equal(configureProcessPump(s, pump.id, { tankId: tank.id }), undefined);
  assert.equal(requestPumpHose(s, pump.id, c.id, f.worker.id), undefined);
  tickUntil(s, () => s.process!.pumps.find((p) => p.id === pump.id)!.hose === 'connected', 180);
  assert.equal(setProcessPumpRunning(s, f.pump.id, true), undefined);
  assert.equal(setProcessPumpRunning(s, pump.id, true), undefined);
  S.tick(s, 0.13);
  assert.ok(Math.abs(f.order.arrived - 1.3) < 1e-9);
  assert.equal(
    f.order.arrived,
    f.order.railFreight!.cars.reduce((n, c) => n + c.manifest[0].arrived, 0),
  );
  S.load(S.save(s));
  assert.equal(processValidationProblem(s), undefined);
});
test('hose requests cannot capture a car already reserved for pickup or queued shunting', () => {
  const f = fixture();
  f.p.hose = 'disconnected';
  f.p.carId = undefined;
  f.s.process!.sources = [];
  worker(f.s);
  f.o.railFreight!.returnId = 'PICKUP-PENDING';
  assert.match(requestPumpHose(f.s, f.p.id, f.c.id)!, /stationary/);
  assert.equal(f.p.hose, 'disconnected');
  f.o.railFreight!.returnId = undefined;
  f.s.shunters = [
    {
      id: 'TEST-SHUNTER',
      name: 'Test shunter',
      x: 0,
      z: 0,
      yaw: 0,
      fuel: 50,
      tank: 360,
      used: 0,
      status: 'Approaching reserved cars',
      phase: 'approaching',
      eta: 0,
      carIds: [f.c.id],
    },
  ];
  assert.match(requestPumpHose(f.s, f.p.id, f.c.id)!, /stationary/);
  assert.equal(f.s.process!.operations.length, 0);
});
