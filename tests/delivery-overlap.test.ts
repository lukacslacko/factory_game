import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { requestRailUnloading } from '../src/rail-freight';
import { carrierRects, shipmentLots } from '../src/delivery.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';
import { dist } from '../src/path.ts';
import { sampleRoad, roadLength, ROAD_ROUTE_VERSION } from '../src/motion.ts';
import { carrierBoxes, boxOverlap } from '../src/traffic.ts';

for (const mode of ['road', 'rail'] as const) {
  test(`${mode} empty carrier departs while its last slab is carried and placement survives an exited-carrier save`, () => {
    let s = S.createState();
    S.addZone(s, { x: 180, z: 90, w: 12, d: 12 });
    const e = seedHandlingResources(s, 'forklift'),
      [oid] = S.purchase(s, 'slab', 8, mode);
    const eid = e.id;
    if (mode === 'rail') {
      tickUntil(s, () => s.orders[0].status === 'unloading');
      assert.equal(requestRailUnloading(s, oid), undefined);
    }
    tickUntil(
      s,
      () =>
        s.orders.find((o) => o.id === oid)?.status === 'departing' &&
        !!s.equipment.find((e) => e.id === eid)?.cargo,
      900,
    );
    let o = s.orders.find((o) => o.id === oid)!;
    assert.equal(o.arrived, 8);
    assert.equal(
      shipmentLots(o).reduce((n, t) => n + t.qty, 0),
      0,
    );
    assert.equal(
      S.totals(s, 'slab').stored,
      0,
      'Carrier release does not magically create storage',
    );
    assert.ok(
      s.equipment.find((e) => e.id === eid)!.deliveryOrder === oid,
      'Site machine stays assigned to its parcel',
    );
    const distance = o.drive!.distance;
    tickUntil(s, () => !!s.orders.find((o) => o.id === oid)?.carrierDeparted, 900);
    o = s.orders.find((o) => o.id === oid)!;
    assert.ok(
      o.unload && o.status === 'departing',
      'Exited transport still retains the unfinished site placement',
    );
    assert.ok(
      mode === 'rail' ? o.drive!.distance < distance : o.drive!.distance > distance,
      'Actual carrier moves independently',
    );
    assert.ok(carrierRects(s).length === 0, 'Exited carrier no longer occupies physical ground');
    const total = S.totals(s, 'slab');
    assert.equal(total.delivered, total.stored + total.cargo + total.installed);
    s = S.load(S.save(s));
    o = s.orders.find((o) => o.id === oid)!;
    assert.ok(
      o.carrierDeparted && o.unload,
      'Save retains departed transport and actual remaining handling task',
    );
    tickUntil(s, () => o.status === 'done', 900);
    assert.equal(o.unload, undefined);
    assert.equal(s.equipment.find((e) => e.id === eid)!.deliveryOrder, undefined);
    assert.equal(S.totals(s, 'slab').stored, 8);
    assert.equal(s.costs.filter((c) => c.entity === oid && c.category === 'Purchases').length, 1);
    assert.equal(
      s.movements.filter((m) => m.from === oid && m.to === eid).reduce((n, m) => n + m.qty, 0),
      8,
    );
  });
}
test('unloading assistant starts walking while operator boards and receiving machine approaches', () => {
  let s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  seedHandlingResources(s, 'excavator');
  const [oid] = S.purchase(s, 'slab', 8);
  tickUntil(s, () => !!s.orders.find((o) => o.id === oid)?.unload, 900);
  let o = s.orders.find((o) => o.id === oid)!,
    r = s.workers.find((w) => w.id === o.unload!.riggerId)!;
  assert.equal(o.unload!.phase, 'boarding');
  assert.ok(r.path.length > 0, 'Assistant route is dispatched immediately');
  assert.equal(r.deliveryOrder, oid);
  assert.equal(r.status, 'Walking to rig lift');
  const start = { x: r.x, z: r.z };
  tickUntil(s, () => o.unload!.phase === 'approach', 120);
  assert.ok(dist(r, start) > 0.5, 'Assistant moves while the operator handles boarding');
  s = S.load(S.save(s));
  o = s.orders.find((o) => o.id === oid)!;
  r = s.workers.find((w) => w.id === o.unload!.riggerId)!;
  assert.equal(r.deliveryOrder, oid);
  tickUntil(s, () => o.status === 'done', 900);
  assert.equal(S.totals(s, 'slab').stored, 8);
  assert.equal(r.deliveryOrder, undefined);
  assert.equal(s.events.filter((e) => e.type === 'Dispatch' && e.entity === r.id).length, 1);
});
test('a carrier yields its yard permit to the departing van that physically blocks its exit', () => {
  let s = S.createState();
  const [truckId] = S.purchase(s, 'diesel', 1),
    [vanId] = S.purchase(s, 'water', 1);
  for (const o of s.orders) {
    const distance = roadLength(o) + (o.id === truckId ? 8.351 : 0),
      p = sampleRoad(o, distance);
    Object.assign(o, {
      status: 'departing',
      arrived: 1,
      invoiced: true,
      vehicle: { x: p.x, z: p.z },
      drive: {
        distance,
        roadVersion: ROAD_ROUTE_VERSION,
        yaw: p.yaw,
        reverse: p.reverse,
        velocity: 0,
        yardPermit: o.id === truckId,
      },
    });
  }
  s.stacks.push({
    id: S.id(s, 'stack'),
    item: 'diesel',
    qty: 1,
    reserved: 0,
    liters: 200,
    source: truckId,
    x: 30,
    z: 30,
    w: 1,
    d: 1,
  });
  S.tick(s, 0.1);
  assert.ok(
    s.orders.find((o) => o.id === vanId)!.drive!.yardPermit,
    'Departing blocker receives the permit to clear its own safe exit',
  );
  assert.equal(s.orders.find((o) => o.id === truckId)!.drive!.yardPermit, undefined);
  assert.ok(s.events.some((e) => e.text.includes(`departing blocker ${vanId}`)));
  s = S.load(S.save(s));
  tickUntil(
    s,
    () => s.orders.every((o) => o.status === 'done'),
    180,
    () => {
      const active = s.orders.filter((o) => o.status !== 'done' && !o.carrierDeparted);
      assert.ok(active.filter((o) => o.drive?.yardPermit).length <= 1);
      if (active.length === 2)
        assert.ok(
          !carrierBoxes(active[0]).some((a) =>
            carrierBoxes(active[1]).some((b) => boxOverlap(a, b)),
          ),
        );
    },
  );
  assert.equal(S.totals(s, 'diesel').stored, 1);
});
