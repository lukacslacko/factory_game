import assert from 'node:assert/strict';
import * as S from '../../src/sim';
import { orderTankers } from '../../src/rail-tankers';
import { railFreightCarPose } from '../../src/rail-freight';
import {
  configureProcessPump,
  requestPumpHose,
  setProcessPumpRunning,
  requestProcessValve,
} from '../../src/process-fluids';
import { configureProcessReactor } from '../../src/process-production';
import { wireOpeningConsumer } from './electrical';
import { commissionExit } from './rail';
import { tickUntil } from './yard';
/** Public placement and operating commands. Only the pre-installed utilities are fixture assets. */
export function createProductionYard(liters = 2000, withInletValve = false) {
  const s = S.createState();
  s.creative = true;
  assert.equal(commissionExit(s).error, '');
  assert.equal(
    orderTankers(s, { product: 'rawReagent', litersPerCar: liters, carCount: 1 }).error,
    undefined,
  );
  tickUntil(s, () => s.orders[0].status === 'unloading', 500);
  const order = s.orders[0],
    car = order.railFreight!.cars[0],
    pose = railFreightCarPose(order, 0);
  const px = Math.ceil(pose.x),
    pz = Math.ceil(pose.z) + 9;
  function place(kind: Parameters<typeof S.plan>[1], x: number, z: number, rotation = 0) {
    const r = S.plan(s, kind, x, z, rotation);
    assert.equal(r.error, '', `${kind} E${x} S${z}: ${r.error}`);
    return s.buildings.at(-1)!;
  }
  const pump = place('transferPump', px, pz),
    tank = place('processTank', px + 8, pz + 4),
    reactor = place('processReactor', px + 16, pz + 4),
    productTank = place('processTank', px + 26, pz + 4);
  const source = s.buildings.find((b) => b.kind === 'power')!;
  source.x = px - 5;
  source.z = pz + 14;
  const rawCable = [];
  for (let z = source.z - 1; z >= pz; z--) rawCable.push({ x: source.x, z });
  for (let x = source.x + 1; x < px; x++) rawCable.push({ x, z: pz });
  wireOpeningConsumer(s, pump, source, rawCable);
  const cable = [];
  for (let x = source.x + 1; x <= reactor.x; x++) cable.push({ x, z: source.z });
  for (let z = source.z - 1; z >= reactor.z + reactor.d; z--) cable.push({ x: reactor.x, z });
  wireOpeningConsumer(s, reactor, source, cable);
  const loadingPump = place('transferPump', px + 3, pz - 2),
    loadingCable = [];
  loadingCable.push({ x: source.x, z: source.z + 1 }, { x: source.x, z: source.z + 2 });
  for (let x = source.x - 1; x >= source.x - 4; x--) loadingCable.push({ x, z: source.z + 2 });
  for (let z = source.z + 1; z >= pz - 2; z--) loadingCable.push({ x: source.x - 4, z });
  for (let x = source.x - 3; x < loadingPump.x; x++) loadingCable.push({ x, z: pz - 2 });
  wireOpeningConsumer(s, loadingPump, source, loadingCable);
  // Raw unloading line turns below the loading station into the feed tank.
  place('pipeElbow', px + 2, pz, 3);
  for (let z = pz + 1; z < pz + 6; z++) place('processPipe', px + 2, z, 1);
  place('pipeElbow', px + 2, pz + 6, 1);
  for (let x = px + 3; x < px + 8; x++) place('processPipe', x, pz + 6);
  let inletValve: typeof pump | undefined;
  for (let x = px + 12; x < px + 16; x++) {
    const b = place(withInletValve && x === px + 14 ? 'processValve' : 'processPipe', x, pz + 6);
    if (b.kind === 'processValve') inletValve = b;
  }
  for (let x = px + 22; x < px + 26; x++) place('processPipe', x, pz + 6);
  // The independent product loading line runs around the north side.
  for (let x = px + 5; x < px + 28; x++) place('processPipe', x, pz - 2);
  place('pipeElbow', px + 28, pz - 2, 3);
  for (let z = pz - 1; z < pz + 4; z++) place('processPipe', px + 28, z, 1);
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
  assert.equal(configureProcessPump(s, pump.id, { tankId: tank.id, rate: 5 }), undefined);
  assert.equal(requestPumpHose(s, pump.id, car.id, worker.id), undefined);
  tickUntil(s, () => s.process!.pumps.find((p) => p.id === pump.id)!.hose === 'connected', 180);
  if (inletValve) {
    assert.equal(requestProcessValve(s, inletValve.id, true, worker.id), undefined);
    tickUntil(s, () => s.process!.valves[0].open, 180);
  }
  assert.equal(setProcessPumpRunning(s, pump.id, true), undefined);
  assert.equal(
    configureProcessReactor(s, reactor.id, {
      inputTankId: tank.id,
      outputTankId: productTank.id,
      batchSize: 100,
    }),
    undefined,
  );
  S.load(S.save(s));
  return { s, order, car, pump, tank, reactor, productTank, loadingPump, worker, inletValve };
}
