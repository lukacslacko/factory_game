import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestRailUnloading } from '../src/rail-freight';
import * as S from '../src/sim.ts';
import { equipmentReservedForDelivery } from '../src/delivery.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';
import { setWorkerSchedule } from '../src/workforce.ts';
import { setJobEquipment } from '../src/jobs.ts';

function receivingYard() {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  const excavator = seedHandlingResources(s, 'excavator');
  const forklift = seedHandlingResources(s, 'forklift');
  forklift.x = 57.5;
  forklift.z = 32.5;
  forklift.workRole = 'hold';
  s.workers[2].x = 58.5;
  s.workers[2].z = 35.5;
  const [oid] = S.purchase(s, 'slab', 17);
  return { s, excavator, forklift, oid };
}

test('one receiving machine owns every lift in its delivery after a better-suited machine becomes available', () => {
  let { s, excavator, forklift, oid } = receivingYard();
  tickUntil(s, () => s.orders[0].unload?.phase === 'carry');
  assert.equal(s.orders[0].automaticEquipment, excavator.id);
  assert.ok(equipmentReservedForDelivery(s, excavator));
  forklift.workRole = 'receiving';
  const eid = excavator.id;
  s = S.load(S.save(s));
  const o = s.orders.find((o) => o.id === oid)!;
  const machines = new Set<string>();
  tickUntil(
    s,
    () => o.status === 'done',
    1600,
    () => {
      if (o.unload) machines.add(o.unload.equipmentId);
      assert.equal(s.equipment.find((e) => e.id === forklift.id)!.deliveryOrder, undefined);
    },
  );
  assert.deepEqual([...machines], [eid]);
  assert.equal(o.automaticEquipment, undefined);
  assert.equal(S.totals(s, 'slab').stored, 17);
  assert.equal(s.costs.filter((c) => c.entity === oid).length, 1);
});

for (const unavailable of ['hold', 'fuel', 'assignment', 'operator-rest'] as const) {
  test(`receiving owner hands off future lifts when ${unavailable} makes it unavailable, preserving active cargo`, () => {
    const { s, excavator, forklift, oid } = receivingYard();
    tickUntil(s, () => s.orders[0].unload?.phase === 'carry');
    const o = s.orders[0];
    forklift.workRole = 'receiving';
    if (unavailable === 'hold') S.setEquipmentRole(s, excavator.id, 'hold');
    if (unavailable === 'operator-rest') s.workers[0].duty = 'rest';
    if (unavailable === 'assignment') {
      S.plan(s, 'slab', 75, 70, 0);
      assert.equal(setJobEquipment(s, s.jobs[s.jobs.length - 1].id, excavator.id), '');
    }
    if (unavailable === 'fuel') {
      // Fuel changes only once the supported parcel is placed and old lift releases.
      tickUntil(s, () => !o.unload && o.arrived < o.qty, 1200);
      excavator.fuel = 0;
    } else {
      assert.equal(o.unload!.equipmentId, excavator.id);
      assert.equal(
        excavator.cargo?.qty,
        12,
        'Changing new-work eligibility keeps the actual lift intact',
      );
      tickUntil(s, () => !o.unload && o.arrived < o.qty, 1200);
    }
    assert.equal(S.totals(s, 'slab').stored, 12);
    tickUntil(s, () => !!o.unload, 180);
    assert.equal(o.unload!.equipmentId, forklift.id);
    assert.equal(o.automaticEquipment, forklift.id);
    tickUntil(s, () => o.status === 'done', 1200);
    const balance = S.totals(s, 'slab');
    assert.equal(balance.stored + balance.cargo + balance.installed, 17);
    assert.equal(
      s.movements.filter((m) => m.from === oid).reduce((n, m) => n + m.qty, 0),
      17,
    );
  });
}

test('explicit controlled unloading safely replaces a delivery owner between lifts', () => {
  const { s, excavator, forklift, oid } = receivingYard();
  const selected = s.workers[2];
  selected.duty = 'manual';
  selected.vehicle = forklift.id;
  forklift.operator = selected.id;
  selected.x = forklift.x;
  selected.z = forklift.z;
  tickUntil(s, () => s.orders[0].unload?.phase === 'carry');
  const o = s.orders[0];
  forklift.workRole = 'receiving';
  assert.match(S.unloadDelivery(s, oid, selected.id), /already assigned/);
  assert.equal(o.unload!.equipmentId, excavator.id);
  tickUntil(s, () => !o.unload && o.arrived < o.qty, 1200);
  assert.equal(S.unloadDelivery(s, oid, selected.id), '');
  assert.equal(o.automaticEquipment, forklift.id);
  assert.equal(o.unload!.equipmentId, forklift.id);
  assert.equal(o.unload!.operatorId, selected.id);
  tickUntil(s, () => o.status === 'done', 1200);
  assert.equal(S.totals(s, 'slab').stored, 17);
});

test('separate road and rail deliveries can use separate receiving machines concurrently', () => {
  const { s, excavator, forklift } = receivingYard();
  const [secondId] = S.purchase(s, 'slab', 8, 'rail');
  const first = s.orders[0],
    second = s.orders.find((o) => o.id === secondId)!;
  tickUntil(s, () => first.unload?.phase === 'carry');
  forklift.workRole = 'receiving';
  tickUntil(s, () => second.status === 'unloading');
  assert.equal(requestRailUnloading(s, second.id), undefined);
  tickUntil(s, () => !!second.unload, 1200);
  assert.equal(first.automaticEquipment, excavator.id);
  assert.equal(second.unload!.equipmentId, forklift.id);
  assert.equal(second.automaticEquipment, forklift.id);
  assert.ok(first.unload, 'The original handling continues alongside the other delivery');
  const firstMachines = new Set<string>(),
    secondMachines = new Set<string>();
  tickUntil(
    s,
    () => s.orders.every((o) => o.status === 'done'),
    1800,
    () => {
      if (first.unload) firstMachines.add(first.unload.equipmentId);
      if (second.unload) secondMachines.add(second.unload.equipmentId);
    },
  );
  assert.deepEqual([...firstMachines], [excavator.id]);
  assert.deepEqual([...secondMachines], [forklift.id]);
  assert.equal(S.totals(s, 'slab').stored, 25);
});

test('an unavailable receiving operator releases future automatic ownership without disrupting the supported parcel', () => {
  const { s, excavator, forklift } = receivingYard();
  tickUntil(s, () => s.orders[0].unload?.phase === 'carry');
  const o = s.orders[0];
  forklift.workRole = 'receiving';
  setWorkerSchedule(s, s.workers[0].id, 20, 21);
  s.workers[2].duty = 'rest';
  assert.equal(o.unload!.equipmentId, excavator.id);
  tickUntil(s, () => !o.unload && o.arrived < o.qty, 1200);
  tickUntil(s, () => o.automaticEquipment === undefined, 60);
  assert.equal(o.unload, undefined);
  assert.equal(S.totals(s, 'slab').stored, 12);
  s.workers[2].duty = 'auto';
  tickUntil(s, () => !!o.unload, 180);
  assert.equal(o.unload!.equipmentId, forklift.id);
  tickUntil(s, () => o.status === 'done', 1200);
  assert.equal(S.totals(s, 'slab').stored, 17);
});

test('a mixed manifest hands off once when its next parcel exceeds the receiving owner capacity', () => {
  const { s, excavator, forklift } = receivingYard();
  s.orders.length = 0;
  excavator.workRole = 'hold';
  forklift.workRole = 'receiving';
  S.purchaseBatch(
    s,
    [
      { item: 'slab', qty: 8 },
      { item: 'office', qty: 1 },
    ],
    'rail',
  );
  const o = s.orders[0];
  tickUntil(s, () => o.status === 'unloading');
  assert.equal(requestRailUnloading(s, o.id), undefined);
  tickUntil(s, () => o.unload?.phase === 'carry');
  assert.equal(o.automaticEquipment, forklift.id);
  assert.equal(o.unload!.item, 'slab');
  excavator.workRole = 'receiving';
  tickUntil(s, () => o.unload?.item === 'office', 1200);
  assert.equal(o.automaticEquipment, excavator.id);
  assert.equal(o.unload!.equipmentId, excavator.id);
  assert.equal(S.totals(s, 'slab').stored, 8);
  tickUntil(s, () => o.status === 'done', 1600);
  assert.equal(S.totals(s, 'office').stored, 1);
});
