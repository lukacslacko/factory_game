import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS } from '../src/catalog';
import { shipmentLots } from '../src/delivery';
import { localPoint, trackPose, angleDelta } from '../src/motion';
import {
  aggregateRailManifest,
  makeRailFreight,
  railFreightCarPose,
  railFreightCarBogies,
  railFreightLength,
  railReceptionPlan,
  configureRailFreight,
  requestRailUnloading,
} from '../src/rail-freight';
import { seedHandlingResources, tickUntil } from './support/yard';

test('one batched supplier order has two bounded real flatcars, stable identities, and separate manifests', () => {
  let s = S.createState();
  const ids = S.purchaseBatch(
    s,
    [
      { item: 'rail', qty: 32 },
      { item: 'diesel', qty: 1 },
    ],
    'rail',
  );
  assert.equal(ids.length, 1);
  const o = s.orders[0],
    f = o.railFreight!;
  assert.equal(f.cars.length, 2);
  assert.match(f.locomotiveId, /^LOCO-/);
  assert.equal(new Set([f.locomotiveId, ...f.cars.map((c) => c.id)]).size, 3);
  assert.equal(o.qty, 33);
  assert.equal(
    f.cars.reduce((n, c) => n + c.mass, 0),
    32 * 1450 + 185,
  );
  assert.ok(f.cars.every((c) => c.mass <= 48000 && c.deckLength <= 16));
  for (const car of f.cars) {
    const lots = shipmentLots(o).filter((l) => l.carId === car.id);
    for (let i = 1; i < lots.length; i++)
      assert.ok(
        lots[i - 1].x + MATERIALS[lots[i - 1].item].w / 2 <=
          lots[i].x - MATERIALS[lots[i].item].w / 2 + 1e-6,
      );
    assert.ok(lots.every((l) => Math.abs(l.x) + MATERIALS[l.item].w / 2 <= 8));
  }
  s = S.load(S.save(s));
  assert.deepEqual(s.orders[0].railFreight, JSON.parse(JSON.stringify(f)));
});

test('all flatcar bodies and bogies travel continuously around the surveyed entrance switch', () => {
  const s = S.createState();
  S.purchaseBatch(s, [{ item: 'rail', qty: 48 }], 'rail');
  const o = s.orders[0];
  assert.equal(o.railFreight!.cars.length, 2);
  for (let distance = 100; distance <= 170; distance += 0.1) {
    o.drive = { distance, yaw: 0 };
    for (let i = 0; i < o.railFreight!.cars.length; i++) {
      const body = railFreightCarPose(o, i),
        bogies = railFreightCarBogies(o, i);
      assert.equal(body.x, (bogies[0].x + bogies[1].x) / 2);
      assert.equal(body.z, (bogies[0].z + bogies[1].z) / 2);
      assert.ok(
        Math.abs(
          angleDelta(body.yaw, Math.atan2(bogies[1].z - bogies[0].z, bogies[1].x - bogies[0].x)),
        ) < 1e-6,
      );
      const next = railFreightCarPose({ ...o, drive: { ...o.drive, distance: distance + 0.1 } }, i);
      assert.ok(Math.hypot(next.x - body.x, next.z - body.z) <= 0.101);
      if (i) {
        const front = railFreightCarPose(o, i - 1);
        assert.ok(
          Math.hypot(front.x - body.x, front.z - body.z) > 17.2,
          'Coupled cars cannot overlap',
        );
      }
    }
  }
});

test('train fits entirely behind the mainline switch, or queues with an actionable length message', () => {
  const s = S.createState();
  S.purchaseBatch(s, [{ item: 'office', qty: 12 }], 'rail');
  const o = s.orders[0];
  assert.equal(o.railFreight!.cars.length, 6);
  assert.ok(railFreightLength(o) > 100);
  tickUntil(s, () => o.note.includes('needs'), 400);
  assert.equal(o.status, 'ordered');
  assert.match(o.note, /needs 114.1 m.*98.8 m/);
  assert.equal(o.invoiced, false);
  assert.equal(s.costs.filter((c) => c.entity === o.id).length, 0);
  assert.equal(o.arrived, 0);
  const shorter = S.createState();
  S.purchaseBatch(shorter, [{ item: 'office', qty: 10 }], 'rail');
  const train = shorter.orders[0];
  const plan = railReceptionPlan(shorter, train);
  assert.equal(plan.error, undefined);
  train.drive = { distance: plan.distance!, yaw: 0 };
  const last = railFreightCarPose(train, 4),
    locomotive = trackPose(plan.distance!);
  assert.ok(last.x - 8.4 >= 25.5);
  assert.ok(locomotive.x + 4.3 <= 124.5);
});

test('named reception interval and storage target are atomic, with no relocation after approach', () => {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 25, d: 18 });
  S.addZone(s, { x: 65, z: 26, w: 20, d: 18 });
  s.railLocations = [
    {
      id: 'RLOC-100',
      name: 'East receiving',
      kind: 'unloading',
      trackId: 'BOOTSTRAP-SIDING',
      route: 'straight',
      offset: 65,
      length: 60,
    },
  ];
  S.purchaseBatch(s, [{ item: 'slab', qty: 8 }], 'rail', {
    railLocationId: 'RLOC-100',
    storageZoneId: s.zones[1].id,
  });
  const o = s.orders[0];
  assert.equal(o.railFreight!.receptionLocationId, 'RLOC-100');
  const before = S.save(s);
  assert.match(configureRailFreight(s, o.id, { storageZoneId: 'missing' })!, /stockyard/);
  assert.equal(S.save(s), before);
  tickUntil(s, () => o.status === 'unloading', 500);
  assert.ok(o.vehicle.x > 75);
  assert.equal(o.arrived, 0);
  assert.match(o.note, /Start unloading|receiving berth|receiving track/);
  assert.equal(configureRailFreight(s, o.id, { storageZoneId: s.zones[0].id }), undefined);
  assert.equal(o.railFreight!.receptionLocationId, 'RLOC-100');
  assert.match(configureRailFreight(s, o.id, { railLocationId: '' })!, /before.*approaching/);
});

test('multi-car unloading conserves every line through source pickup, storage, save/reload, and return', () => {
  let s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 33, d: 26 });
  S.addZone(s, { x: 62, z: 26, w: 14, d: 15 });
  seedHandlingResources(s, 'forklift');
  S.purchaseBatch(s, [{ item: 'bufferStop', qty: 9 }], 'rail', { storageZoneId: s.zones[1].id });
  let o = s.orders[0];
  assert.equal(o.railFreight!.cars.length, 2);
  const identities = o.railFreight!.cars.map((c) => c.id);
  tickUntil(s, () => o.status === 'unloading', 900);
  for (let i = 0; i < 20; i++) S.tick(s, 0.1);
  assert.equal(o.arrived, 0, 'Unloading requires a player request');
  assert.equal(requestRailUnloading(s, o.id), undefined);
  tickUntil(s, () => o.arrived > 0, 900);
  const check = () => {
    assert.equal(
      o.railFreight!.cars.reduce((n, c) => n + c.manifest.reduce((n, l) => n + l.arrived, 0), 0),
      o.arrived,
    );
    const t = S.totals(s, 'bufferStop');
    assert.equal(t.delivered, t.stored + t.cargo + t.installed);
    assert.ok(s.stacks.every((t) => t.x >= 62 && t.z >= 26 && t.x + t.w <= 76 && t.z + t.d <= 41));
  };
  check();
  s = S.load(S.save(s));
  o = s.orders[0];
  tickUntil(s, () => o.status === 'done', 2400, check);
  assert.deepEqual(
    o.railFreight!.cars.map((c) => c.id),
    identities,
  );
  assert.equal(o.arrived, 9);
  assert.ok(o.railFreight!.cars.every((c) => c.manifest.every((l) => l.arrived === l.qty)));
  assert.equal(S.totals(s, 'bufferStop').stored, 9);
  assert.equal(s.costs.filter((c) => c.entity === o.id && c.category === 'Purchases').length, 1);
});

test('freight save validation rejects duplicate assets, overfilled wagons, and mismatched quantities', () => {
  const s = S.createState();
  S.purchaseBatch(s, [{ item: 'rail', qty: 32 }], 'rail');
  const mutate = (change: (state: typeof s) => void) => {
    const copy = JSON.parse(S.save(s)) as typeof s;
    change(copy);
    assert.throws(() => S.load(JSON.stringify(copy)), /freight|manifest|unloading/i);
  };
  mutate((copy) => {
    copy.orders[0].railFreight!.cars[1].id = copy.orders[0].railFreight!.cars[0].id;
  });
  mutate((copy) => {
    copy.orders[0].railFreight!.cars[0].mass = 48001;
  });
  mutate((copy) => {
    copy.orders[0].railFreight!.cars[0].manifest[0].arrived = 1;
  });
  mutate((copy) => {
    copy.orders[0].railFreight!.cars[0].centerOffset = 14;
  });
});

test('manual handling pause cannot be overridden by Start unloading, and empty trains cannot restart', () => {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 20, d: 18 });
  S.purchaseBatch(s, [{ item: 'slab', qty: 2 }], 'rail');
  const o = s.orders[0];
  tickUntil(s, () => o.status === 'unloading', 900);
  o.unloadPaused = true;
  const before = S.save(s);
  assert.match(requestRailUnloading(s, o.id)!, /automatic work/);
  assert.equal(S.save(s), before);
  o.unloadPaused = undefined;
  assert.equal(requestRailUnloading(s, o.id), undefined);
  o.arrived = 2;
  o.manifest![0].arrived = 2;
  o.railFreight!.cars[0].manifest[0].arrived = 2;
  assert.match(requestRailUnloading(s, o.id)!, /no remaining cargo/);
});

test('a newly installed buffer on the receiving route stops an approaching train instead of clipping through it', () => {
  const s = S.createState();
  S.purchaseBatch(s, [{ item: 'slab', qty: 2 }], 'rail');
  const o = s.orders[0];
  tickUntil(s, () => o.status === 'approaching' && o.vehicle.x > 10, 900);
  const prior = { ...o.vehicle };
  s.buffers = [{ id: 'BUFFER-0900', x: 50, z: 5, y: 0, yaw: 0, secured: true, carried: false }];
  S.tick(s, 0.1);
  assert.deepEqual(o.vehicle, prior);
  assert.equal(o.drive!.velocity, 0);
  assert.match(o.note, /BUFFER-0900.*remove and store/);
  s.buffers = [];
  tickUntil(s, () => o.status === 'unloading', 900);
  assert.equal(o.arrived, 0);
});
