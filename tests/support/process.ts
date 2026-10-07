import { wireOpeningConsumer } from './electrical';
import assert from 'node:assert/strict';
import * as S from '../../src/sim';
import { orderTankers } from '../../src/rail-tankers';
import { railFreightCarPose } from '../../src/rail-freight';
import {
  configureProcessPump,
  requestPumpHose,
  requestProcessValve,
  setProcessPumpRunning,
} from '../../src/process-fluids';
import { tickUntil } from './yard';
import { commissionExit } from './rail';
import type { RailCommodity } from '../../src/rail-commodities';
/** Public commands create completed assets and a genuinely received, still-contained tanker. */
export function createProcessYard(
  options: {
    product?: RailCommodity;
    liters?: number;
    carCount?: number;
    connect?: boolean;
    running?: boolean;
  } = {},
) {
  const s = S.createState();
  s.creative = true;
  assert.equal(commissionExit(s).error, '');
  const ordered = orderTankers(s, {
    product: options.product || 'bulkWater',
    litersPerCar: options.liters || 1000,
    carCount: options.carCount || 1,
  });
  assert.equal(ordered.error, undefined);
  tickUntil(s, () => s.orders[0].status === 'unloading', 500);
  const order = s.orders[0],
    car = order.railFreight!.cars[0],
    pose = railFreightCarPose(order, 0);
  const px = Math.ceil(pose.x),
    pz = Math.ceil(pose.z) + 9;
  function place(kind: Parameters<typeof S.plan>[1], x: number, z: number) {
    const result = S.plan(s, kind, x, z, 0);
    assert.equal(result.error, '', `${kind}: ${result.error}`);
    return s.buildings.at(-1)!;
  }
  const pump = place('transferPump', px, pz),
    tank = place('processTank', px + 8, pz - 2);
  const pipes = [];
  for (let x = px + 2; x < px + 8; x++)
    pipes.push(
      place(x === px + 4 ? 'processValve' : x === px + 6 ? 'processGauge' : 'processPipe', x, pz),
    );
  const valve = pipes.find((p) => p.kind === 'processValve')!,
    gauge = pipes.find((p) => p.kind === 'processGauge')!;
  const worker = {
    id: S.id(s, 'worker'),
    name: 'Worker #1',
    role: 'engineer' as const,
    duty: 'auto' as const,
    status: 'Available',
    x: px - 4,
    z: pz + 2,
    y: 0,
    heading: 0,
    yaw: 0,
    path: [],
    hours: 0,
    wage: 30,
  };
  s.workers.push(worker);
  // Public electrical company construction is covered independently; this opening fixture supplies its completed connection.
  wireOpeningConsumer(s,pump);
  assert.equal(configureProcessPump(s, pump.id, { tankId: tank.id, rate: 5 }), undefined);
  if (options.connect || options.running) {
    assert.equal(requestPumpHose(s, pump.id, car.id, worker.id), undefined);
    tickUntil(s, () => s.process!.pumps[0].hose === 'connected', 180);
    assert.equal(requestProcessValve(s, valve.id, true, worker.id), undefined);
    tickUntil(s, () => s.process!.valves[0].open, 180);
  }
  if (options.running) assert.equal(setProcessPumpRunning(s, pump.id, true), undefined);
  S.load(S.save(s));
  return { s, order, car, pump, tank, pipes, valve, gauge, worker };
}
