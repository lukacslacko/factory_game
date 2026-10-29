import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { createProductionYard } from './support/production';
import { advance, tickUntil, stateSummary } from './support/yard';
import { configureProcessReactor, setProcessReactorRunning } from '../src/process-production';
import {
  configureProcessPump,
  setProcessPumpRunning,
  requestPumpHose,
  disconnectPumpHose,
  processBalance,
  processNetworkRoute,
  processRecoveryConflict,
  requestProcessValve,
} from '../src/process-fluids';
import { detachRailFreight, requestEmptyReturn } from '../src/rail-operations';
import { processValidationProblem } from '../src/process-validation';
import type { State } from '../src/types';

function balanced(s: State) {
  for (const row of processBalance(s))
    assert.ok(Math.abs(row.difference) < 1e-5, JSON.stringify(row));
}

test('received reagent is stored, reacted, stored as product, loaded into its emptied tanker and sold only after physical departure', async () => {
  let { s, order, car, pump, reactor, productTank, loadingPump } = createProductionYard(1000);
  assert.equal(setProcessReactorRunning(s, reactor.id, true), undefined);
  assert.equal(detachRailFreight(s, order.id), undefined);
  let phases = new Set<string>(),
    saved = new Set<string>();
  for (let i = 0; i < 16000; i++) {
    S.tick(s, 0.1);
    balanced(s);
    const r = s.process!.reactors![0];
    phases.add(r.phase);
    if (!saved.has(r.phase) && r.phase !== 'idle') {
      saved.add(r.phase);
      s = S.load(S.save(s));
      order = s.orders.find((o) => o.id === order.id)!;
      car = order.railFreight!.cars[0];
    }
    if (
      car.tank!.liters === 0 &&
      (s.process!.production?.produced || 0) >= 800 &&
      r.phase === 'idle'
    )
      break;
  }
  assert.ok(
    ['filling', 'reacting', 'discharging'].every((p) => phases.has(p)),
    stateSummary(s),
  );
  assert.ok(s.process!.tanks.find((t) => t.id === productTank.id)!.liters > 700);
  assert.equal(setProcessReactorRunning(s, reactor.id, false), undefined);
  assert.equal(setProcessPumpRunning(s, pump.id, false), undefined);
  assert.equal(disconnectPumpHose(s, pump.id), undefined);
  tickUntil(s, () => s.process!.pumps.find((p) => p.id === pump.id)!.hose === 'disconnected', 180);
  assert.equal(
    configureProcessPump(s, loadingPump.id, { tankId: productTank.id, direction: 'load' }),
    undefined,
  );
  assert.equal(requestPumpHose(s, loadingPump.id, car.id), undefined);
  tickUntil(
    s,
    () => s.process!.pumps.find((p) => p.id === loadingPump.id)!.hose === 'connected',
    180,
  );
  assert.equal(setProcessPumpRunning(s, loadingPump.id, true), undefined);
  tickUntil(s, () => s.process!.tanks.find((t) => t.id === productTank.id)!.liters === 0, 600);
  balanced(s);
  assert.equal(s.process!.sales!.length, 1);
  assert.ok(car.tank!.liters > 500);
  assert.equal(s.process!.sales![0].revenue, 0);
  assert.ok(!s.costs.some((c) => c.category === 'Product sales'));
  assert.match(requestEmptyReturn(s, { orderIds: [order.id] }).error!, /Disconnect/);
  assert.equal(setProcessPumpRunning(s, loadingPump.id, false), undefined);
  assert.equal(disconnectPumpHose(s, loadingPump.id), undefined);
  tickUntil(
    s,
    () => s.process!.pumps.find((p) => p.id === loadingPump.id)!.hose === 'disconnected',
    180,
  );
  assert.match(requestEmptyReturn(s, { orderIds: [order.id] }).error!, /Unload every/);
  const shipment = requestEmptyReturn(s, { orderIds: [order.id], sellProducts: true });
  assert.equal(shipment.error, undefined);
  s = S.load(S.save(s));
  assert.equal(s.process!.sales![0].revenue, 0);
  tickUntil(s, () => s.railReturns!.find((r) => r.id === shipment.id)!.phase === 'returning', 300);
  s = S.load(S.save(s));
  assert.equal(s.process!.sales![0].revenue, 0);
  tickUntil(s, () => s.railReturns!.find((r) => r.id === shipment.id)!.phase === 'done', 300);
  balanced(s);
  assert.ok(s.process!.sales![0].revenue > 400);
  assert.equal(s.costs.filter((c) => c.category === 'Product sales').length, 1);
  const revenue = s.process!.sales![0].revenue;
  s = S.load(S.save(s));
  advance(s, 20);
  assert.equal(s.process!.sales![0].revenue, revenue);
  assert.equal(s.costs.filter((c) => c.category === 'Product sales').length, 1);
  assert.equal(processValidationProblem(s), undefined);
});

test('reactor port selection, power loss, pause/resume and saved-state validation preserve the physical batch', () => {
  const { s, reactor, tank, productTank } = createProductionYard();
  assert.ok(processNetworkRoute(s, reactor.id, tank.id, false, 0));
  assert.equal(processNetworkRoute(s, reactor.id, tank.id, false, 1), undefined);
  assert.ok(processNetworkRoute(s, reactor.id, productTank.id, false, 1));
  assert.equal(
    configureProcessReactor(s, reactor.id, { inputTankId: tank.id, outputTankId: tank.id }),
    'Feed and product need separate tanks.',
  );
  assert.equal(setProcessReactorRunning(s, reactor.id, true), undefined);
  tickUntil(s, () => s.process!.reactors![0].phase === 'reacting', 300);
  const r = s.process!.reactors![0];
  assert.equal(setProcessReactorRunning(s, r.id, false), undefined);
  const clock = r.clock;
  advance(s, 10);
  assert.equal(r.clock, clock);
  balanced(s);
  assert.equal(setProcessReactorRunning(s, r.id, true), undefined);
  s.utilities.power = false;
  advance(s, 20);
  assert.equal(r.clock, clock);
  balanced(s);
  assert.equal(
    s.notices.filter((n) => n.title === 'Production blocked' && n.state !== 'done').length,
    1,
  );
  s.utilities.power = true;
  tickUntil(s, () => r.phase === 'discharging', 100);
  balanced(s);
  assert.ok(
    s.notices.filter((n) => n.title === 'Production blocked').every((n) => n.state === 'done'),
  );
  assert.match(processRecoveryConflict(s, reactor.id)!, /Drain/);
  assert.match(S.removeBuilding(s, productTank.id), /Finish the batch/);
  const copy = JSON.parse(S.save(s));
  copy.process.production.produced += 1;
  assert.throws(() => S.load(JSON.stringify(copy)), /production totals/);
  const blocked = JSON.parse(S.save(s));
  blocked.process.reactors[0].liters += 1;
  assert.throws(() => S.load(JSON.stringify(blocked)), /Unbalanced/);
});

test('an isolated feed line does not stall an already filled reaction or its independent product discharge', () => {
  const { s, reactor, inletValve } = createProductionYard(1000, true);
  assert.ok(inletValve);
  assert.equal(setProcessReactorRunning(s, reactor.id, true), undefined);
  tickUntil(s, () => s.process!.reactors![0].phase === 'reacting', 300);
  assert.equal(requestProcessValve(s, inletValve.id, false), undefined);
  tickUntil(s, () => !s.process!.valves.find((v) => v.id === inletValve.id)!.open, 180);
  assert.equal(setProcessReactorRunning(s, reactor.id, false), undefined);
  assert.equal(
    setProcessReactorRunning(s, reactor.id, true),
    undefined,
    'Resume of a filled reactor does not need its feed isolation valve open',
  );
  tickUntil(s, () => s.process!.reactors![0].batches === 1, 100);
  tickUntil(s, () => s.process!.reactors![0].phase === 'idle', 100);
  assert.ok(
    s.process!.tanks.find((t) => t.id === s.process!.reactors![0].outputTankId)!.liters > 0,
  );
  balanced(s);
  S.load(S.save(s));
});
