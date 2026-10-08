import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { SERVICES } from '../src/catalog';
import { electricalConsumerPower, electricalNetwork } from '../src/electrical-network';
import { staticObstacleRects, workerMoveBlocked, equipmentMoveBlocked } from '../src/traffic';
import { seedHandlingResources, tickUntil } from './support/yard';

for (const mode of ['empty', 'starter', 'example'] as const) {
  test(`${mode} new yard includes one connected opening 16 kW cabinet without a utility order`, () => {
    const s = mode === 'example' ? S.demoState() : S.createState();
    if (mode === 'starter') S.starterOrder(s);
    const stations = s.buildings.filter((b) => b.kind === 'power');
    assert.equal(stations.length, 1);
    const source = stations[0];
    assert.deepEqual(
      {
        id: source.id,
        x: source.x,
        z: source.z,
        w: source.w,
        d: source.d,
        connected: source.connected,
        source: source.source,
      },
      { id: 'BLD-0000', x: 3, z: 15, w: 1, d: 1, connected: true, source: 'opening' },
    );
    assert.equal(s.utilities.power, true);
    assert.equal(electricalNetwork(s).sources.length, 1);
    assert.equal(electricalNetwork(s).sources[0].capacityKw, 16);
    assert.ok(
      s.orders.every(
        (o) => o.item !== 'power' && o.manifest?.every((l) => l.item !== 'power') !== false,
      ),
    );
    assert.ok(s.costs.every((c) => c.entity !== source.id));
    if (mode !== 'example') assert.deepEqual(s.electrical, { runs: [], meterLedger: [] });
    else assert.ok(s.electrical!.runs.every((run) => run.sourceId === source.id));
    const restored = S.load(S.save(s));
    assert.deepEqual(
      restored.buildings.find((b) => b.id === source.id),
      source,
    );
    assert.equal(restored.buildings.filter((b) => b.kind === 'power').length, 1);
    if (mode === 'empty') {
      for (const entries of [s.workers, s.equipment, s.stacks, s.orders, s.jobs, s.costs])
        assert.equal(entries.length, 0);
      assert.deepEqual(s.paving, {});
    }
  });
}

test('the opening cabinet reserves a physical footprint and supplies only commissioned circuits', () => {
  let s = S.createState();
  const source = s.buildings.find((b) => b.kind === 'power')!;
  const obstacle = staticObstacleRects(s).find((r) => r.id === source.id)!;
  assert.ok(
    obstacle.w > 0 && obstacle.d > 0,
    'Opening cabinet must remain a solid traffic obstacle',
  );
  assert.equal(obstacle.x + obstacle.w / 2, source.x + source.w / 2);
  assert.equal(obstacle.z + obstacle.d / 2, source.z + source.d / 2);
  assert.equal(workerMoveBlocked(s, { x: 3.5, z: 13 }, { x: 3.5, z: 15.5 }), source.id);
  const machine = seedHandlingResources(s);
  assert.equal(equipmentMoveBlocked(s, machine, { x: 3.5, z: 15.5, yaw: 0 }), source.id);
  assert.ok(S.plan(s, 'lamp', source.x, source.z).error);
  s.creative = true;
  assert.equal(S.plan(s, 'lamp', 3, 19).error, '');
  const lamp = s.buildings.find((b) => b.kind === 'lamp')!;
  assert.equal(electricalConsumerPower(s, lamp.id).powered, false);
  assert.equal(electricalConsumerPower(s, lamp.id).connected, false);
  const circuit = S.planElectrical(s, {
    sourceId: source.id,
    targetId: lamp.id,
    cells: [
      { x: 3, z: 16 },
      { x: 3, z: 17 },
      { x: 3, z: 18 },
    ],
  });
  assert.equal(circuit.error, undefined);
  assert.equal(electricalConsumerPower(s, lamp.id).powered, true);
  s = S.load(S.save(s));
  assert.equal(s.electrical!.runs[0].sourceId, 'BLD-0000');
  assert.equal(electricalConsumerPower(s, lamp.id).rootSourceId, source.id);
  assert.equal(electricalConsumerPower(s, lamp.id).powered, true);
});

test('loading older yards preserves a missing station or disconnected utility state', () => {
  const s = S.createState();
  s.buildings = [];
  s.utilities.power = false;
  const restored = S.load(S.save(s));
  assert.deepEqual(restored.buildings, []);
  assert.equal(restored.utilities.power, false);
  const installed = S.createState();
  installed.utilities.power = false;
  installed.buildings[0].connected = false;
  assert.equal(S.load(S.save(installed)).buildings[0].connected, false);
  assert.equal(S.load(S.save(installed)).utilities.power, false);
});

test('power installation is unavailable in previews and purchases and mixed orders reject atomically', () => {
  assert.equal(SERVICES.power.purchasable, false);
  for (const mode of ['road', 'rail'] as const) {
    const s = S.createState();
    const before = S.save(s);
    const mixed = [
      { item: 'slab', qty: 12 },
      { item: 'power', qty: 1 },
      { item: 'builder', qty: 2 },
    ];
    for (const action of [
      () => S.planPurchaseBatch([{ item: 'power', qty: 1 }], mode),
      () => S.planPurchaseBatch(mixed, mode),
      () => S.purchase(s, 'power', 1, mode),
      () => S.purchaseBatch(s, mixed, mode),
    ]) {
      assert.throws(action, /pre-installed|not.*purchas|includes|included|available/i);
      assert.equal(
        S.save(s),
        before,
        'Rejected station request must not allocate IDs, reserve stock, create orders or charge costs',
      );
    }
  }
});

test('an older pending electrical installation still completes through its saved utility crew', () => {
  let s = S.createState();
  s.buildings = [];
  s.utilities.power = false;
  // A saved electricity order has the same utility carrier structure as water.
  const [orderId] = S.purchase(s, 'water', 1);
  const order = s.orders.find((o) => o.id === orderId)!;
  order.item = 'power';
  order.total = SERVICES.power.price + 90;
  s = S.load(S.save(s));
  assert.equal(s.buildings.length, 0, 'Loading the legacy yard must not insert an extra station');
  tickUntil(s, () => s.orders.find((o) => o.id === orderId)!.status === 'done', 900);
  assert.equal(s.utilities.power, true);
  assert.equal(s.utilities.water, false);
  assert.equal(s.buildings.filter((b) => b.kind === 'power' && b.connected).length, 1);
  assert.equal(s.orders[0].arrived, 1);
  assert.equal(s.costs.filter((c) => c.entity === orderId && c.category === 'Purchases').length, 1);
  assert.doesNotThrow(() => S.load(S.save(s)));
});
