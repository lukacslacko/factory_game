/** Two compact, deterministic captures from real procurement and transport ticks.
 * Kept separate from the larger construction-fixture index. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as Sim from '../src/sim';
import { saveRailLocation } from '../src/rail-locations';
import { renderState } from './render';
const directory = path.resolve(import.meta.dirname, '../native/tests/fixtures');
const s = Sim.createState();
assert.equal(Sim.addZone(s, { x: 32, z: 15, w: 55, d: 22 }, 'North rail stockyard'), '');
assert.equal(
  saveRailLocation(s, {
    name: 'Receiving 01',
    trackId: 'BOOTSTRAP-SIDING',
    route: 'straight',
    offset: 50,
    length: 98,
    kind: 'unloading',
  }),
  undefined,
);
const orderId = Sim.purchaseBatch(s, [{ item: 'slab', qty: 400 }], 'rail', {
  railLocationId: s.railLocations![0].id,
  storageZoneId: s.zones[0].id,
})[0];
const order = s.orders.find((o) => o.id === orderId)!;
assert.equal(order.railFreight!.cars.length, 3);
const shots: any[] = [];
function capture(name: string, focus: { x: number; z: number }, description: string) {
  const paused = Sim.load(Sim.save({ ...s, paused: true }));
  const render = renderState(paused);
  const carrier = render.carriers.find((c) => c.id === orderId)!;
  assert.equal(carrier.cars!.length, 3);
  assert.equal(
    carrier.cargo.reduce((sum, lot) => sum + lot.qty, 0),
    400,
  );
  const message = {
    state: paused,
    render,
    freightCars: carrier.cars!.map((car) => ({ ...car, orderId, status: order.status })),
    locomotives: [
      { id: order.railFreight!.locomotiveId, orderId, status: order.status, ownership: 'Supplier' },
    ],
  };
  const filename = `freight-${name}.json`;
  fs.writeFileSync(path.join(directory, filename), JSON.stringify(message));
  shots.push({
    name,
    filename,
    focus,
    orderId,
    description,
    status: order.status,
    cars: carrier.cars!.map((car) => ({ id: car.id, x: car.x, z: car.z, yaw: car.yaw })),
    elapsed: s.elapsed,
  });
}
let approach = false;
for (let i = 0; i < 12000; i++) {
  Sim.tick(s, 0.1);
  const carrier = renderState(s).carriers.find((c) => c.id === orderId);
  if (!approach && order.status === 'approaching' && carrier && carrier.x > 37 && carrier.x < 39) {
    capture(
      'approach',
      { x: 16, z: 3 },
      'Real three-car supplier train following the curved siding entrance; body and bogies use separate track samples.',
    );
    approach = true;
  }
  if (order.status === 'unloading') {
    assert.ok(approach, 'Observed curved approach before reception');
    assert.equal(
      order.railFreight!.unloadRequested,
      false,
      'Train awaits explicit player authorization',
    );
    capture(
      'received',
      { x: 75, z: 8 },
      'Whole three-car supplier train stopped at the named receiving interval, awaiting explicit unload to North rail stockyard.',
    );
    break;
  }
}
assert.equal(shots.length, 2);
fs.writeFileSync(
  path.join(directory, 'freight-index.json'),
  JSON.stringify({ shots }, null, 2) + '\n',
);
console.log(JSON.stringify({ passed: true, shots, ticks: s.elapsed / 0.1 }, null, 2));
