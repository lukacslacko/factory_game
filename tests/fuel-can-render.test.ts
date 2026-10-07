import test from 'node:test';
import assert from 'node:assert/strict';
import * as Sim from '../src/sim';
import { seedHandlingResources } from './support/yard';
import { workerFuelCan } from '../native-runtime/fuel-can-render';
import { renderState } from '../native-runtime/render';
import type { Job } from '../src/types';
import { equipmentFuelStandingPoint } from '../src/equipment-refueling';

function siteFuelFixture() {
  const state = Sim.createState();
  const machine = seedHandlingResources(state, 'excavator');
  const worker = state.workers[1];
  const barrel = {
    id: 'STK-FUEL',
    item: 'diesel' as const,
    x: 4,
    z: 4,
    w: 1,
    d: 1,
    qty: 1,
    reserved: 0,
    source: 'opening',
    liters: 180,
  };
  state.stacks.push(barrel);
  const job: Job = {
    id: 'JOB-FUEL',
    kind: 'refuel',
    rotation: 0,
    x: machine.x,
    z: machine.z,
    w: 1,
    d: 1,
    status: 'doing',
    phase: 'Collect fuel',
    worker: worker.id,
    equipment: machine.id,
    target: machine.id,
    stack: barrel.id,
    item: 'diesel',
    qty: 1,
    reason: '',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: 0,
  };
  state.jobs.push(job);
  worker.job = job.id;
  Object.assign(worker, { x: 4.5, z: 3.5 });
  return { state, machine, worker, job };
}
test('native fuel presentation retains the empty service can during actual collection and return', () => {
  const { state, worker, job } = siteFuelFixture();
  worker.path = [{ x: 4, z: 3 }];
  const before = JSON.stringify(state);
  const can = workerFuelCan(state, worker, job)!;
  assert.equal(can.phase, 'empty');
  assert.equal(can.liters, 0);
  assert.equal(can.capacity, 20);
  assert.equal(
    JSON.stringify(state),
    before,
    'Render adaptation cannot add fuel, actors or mutate the save',
  );
  job.phase = 'Board equipment';
  assert.equal(workerFuelCan(state, worker, job), undefined);
  job.phase = 'Drive to diesel barrel';
  assert.equal(workerFuelCan(state, worker, job), undefined);
});
test('native fuel DTO distinguishes filling, carried fuel, pouring, and displaced loaded crews', () => {
  const { state, machine, worker, job } = siteFuelFixture();
  job.phase = 'Fill service can';
  job.elapsed = 2;
  let can = workerFuelCan(state, worker, job)!;
  assert.equal(can.phase, 'fill');
  assert.equal(can.clock, 2);
  assert.equal(can.liters, 0);
  assert.equal(can.sourceId, 'STK-FUEL');
  assert.ok(can.target);
  job.phase = 'Carry fuel';
  job.fuelLiters = 17.5;
  job.elapsed = 0;
  worker.path = [{ x: 5, z: 5 }];
  can = workerFuelCan(state, worker, job)!;
  assert.equal(can.phase, 'carry');
  assert.equal(can.liters, 17.5);
  worker.path = [];
  Object.assign(worker, equipmentFuelStandingPoint(machine));
  job.elapsed = 3;
  job.fuelLiters = 8;
  can = workerFuelCan(state, worker, job)!;
  assert.equal(can.phase, 'pour');
  assert.equal(can.liters, 8);
  assert.ok(can.target);
  worker.yieldingTo = 'EQ-BLOCKER';
  assert.equal(
    workerFuelCan(state, worker, job)!.phase,
    'carry',
    'A displaced worker must not show pouring remotely',
  );
  worker.yieldingTo = undefined;
  worker.velocity = 0.3;
  assert.equal(workerFuelCan(state, worker, job)!.phase, 'carry');
  worker.velocity = 0;
  job.phase = 'Collect fuel';
  job.fuelLiters = 0;
  job.elapsed = 0;
  assert.equal(workerFuelCan(state, worker, job)!.phase, 'empty');
});
test('native worker records preserve actual can clock and contents without hiding the zero-liter fill', () => {
  const { state, worker, job } = siteFuelFixture();
  job.phase = 'Fill service can';
  job.elapsed = 2.25;
  const actor = renderState(state).actors.find((a) => a.id === worker.id)! as {
    fuelCan?: ReturnType<typeof workerFuelCan>;
    workClock: number;
  };
  assert.equal(actor.fuelCan?.phase, 'fill');
  assert.equal(actor.fuelCan?.liters, 0);
  assert.equal(actor.workClock, 2.25);
});
test('native shunter can follows real fill/pour/return phases rather than only positive liters', () => {
  const { state, worker } = siteFuelFixture();
  const shunter: any = {
    id: 'SH-FUEL',
    x: 7,
    z: 7,
    yaw: 0,
    refueling: {
      workerId: worker.id,
      barrelId: 'STK-FUEL',
      phase: 'fill-can',
      carried: 0,
      clock: 2,
    },
  };
  state.shunters = [shunter];
  Object.assign(worker, { x: 4.5, z: 3.35 });
  assert.equal(workerFuelCan(state, worker)!.phase, 'fill');
  shunter.refueling.phase = 'to-engine';
  shunter.refueling.carried = 20;
  assert.equal(workerFuelCan(state, worker)!.phase, 'carry');
  Object.assign(worker, { x: 8.8, z: 9 });
  shunter.refueling.phase = 'pour';
  shunter.refueling.carried = 11;
  assert.equal(workerFuelCan(state, worker)!.phase, 'pour');
  shunter.refueling.phase = 'return';
  shunter.refueling.carried = 0;
  assert.equal(workerFuelCan(state, worker)!.phase, 'empty');
  shunter.refueling.phase = 'approach-engine';
  assert.equal(workerFuelCan(state, worker), undefined);
});

test('stationary displaced or climbing fuel crews cannot show remote filling or pouring', () => {
  const { state, machine, worker, job } = siteFuelFixture();
  job.phase = 'Carry fuel';
  job.elapsed = 2;
  job.fuelLiters = 9;
  worker.path = [];
  worker.velocity = 0;
  assert.equal(
    workerFuelCan(state, worker, job)!.phase,
    'carry',
    'Partial pour clock alone cannot create a remote stream',
  );
  Object.assign(worker, equipmentFuelStandingPoint(machine));
  assert.equal(workerFuelCan(state, worker, job)!.phase, 'pour');
  worker.transition = {
    kind: 'exit',
    equipmentId: machine.id,
    clock: 0.5,
    from: { ...worker, y: 1 },
    to: { ...worker, y: 0 },
  };
  assert.equal(workerFuelCan(state, worker, job)!.phase, 'carry');
  worker.transition = undefined;
  job.phase = 'Fill service can';
  job.fuelLiters = 0;
  job.elapsed = 2;
  assert.equal(
    workerFuelCan(state, worker, job)!.phase,
    'empty',
    'Fill clock alone cannot connect a remote drum',
  );
  Object.assign(worker, { x: 4.5, z: 3.5 });
  assert.equal(workerFuelCan(state, worker, job)!.phase, 'fill');
});
