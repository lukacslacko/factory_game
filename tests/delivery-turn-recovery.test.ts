import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { pauseDeliveryHandling, resumeDeliveryHandling } from '../src/delivery-control';
import { equipmentMoveBlocked, equipmentSweepBlocked } from '../src/traffic';
import { localPoint } from '../src/motion';
import { dist } from '../src/path';
import { seedHandlingResources, tickUntil, advance } from './support/yard';

function atStorageDock() {
  const s = S.createState(),
    e = seedHandlingResources(s);
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  const [id] = S.purchase(s, 'diesel', 1),
    o = s.orders.find((q) => q.id === id)!;
  tickUntil(s, () => o.unload?.phase === 'carry', 300);
  const t = o.unload!,
    w = s.workers.find((q) => q.id === t.operatorId)!;
  pauseDeliveryHandling(s, e.id);
  // Arrange the reported late-trip state: supported barrel, empty carrier,
  // and a grid-aligned storage dock approached facing the wrong direction.
  Object.assign(e, { x: 29.5, z: 35.5, yaw: -Math.PI / 2, reach: 2, lift: 0.4, path: [] });
  Object.assign(w, { x: e.x, z: e.z });
  t.destination = { x: 29, z: 37, w: 1, d: 1 };
  o.allocated = { ...t.destination };
  t.drop = { x: 29.5, z: 35.5 };
  t.dropYaw = Math.PI / 2;
  t.destinationY = 0;
  t.clock = 3;
  t.cargo = { ...localPoint(e, 2, 0), y: 0.4, yaw: 0 };
  advance(s, 60);
  assert.ok(o.carrierDeparted);
  return { s, e, o, t, w };
}

test('a loaded forklift reapproaches instead of turning through a fixed rail stack', () => {
  const { s, e, o, t } = atStorageDock();
  s.stacks.push({
    id: 'STK-0074',
    item: 'rail',
    qty: 1,
    reserved: 0,
    x: 31,
    z: 36,
    w: 5,
    d: 3,
    source: 'opening',
  });
  assert.equal(equipmentMoveBlocked(s, e, { ...e, yaw: t.dropYaw }), '');
  assert.equal(equipmentSweepBlocked(s, e, { ...e, yaw: t.dropYaw }), 'STK-0074');
  const start = { x: e.x, z: e.z };
  assert.equal(resumeDeliveryHandling(s, e.id), '');
  let reapproached = false,
    movedClear = false,
    previous = { ...e };
  tickUntil(
    s,
    () => !o.unload,
    180,
    () => {
      reapproached ||= o.note.includes('Reapproaching');
      movedClear ||= dist(e, start) > 0.7;
      assert.equal(
        equipmentSweepBlocked(s, previous, e),
        '',
        'Every executed chassis sweep stays clear',
      );
      previous = { ...e };
      if (e.cargo) {
        assert.equal(e.cargo.item, 'diesel');
        assert.ok(
          dist(t.cargo!, localPoint(e, e.reach!, 0)) < 0.01,
          'The same barrel follows its forks',
        );
      }
    },
  );
  assert.ok(
    reapproached && movedClear,
    'The machine physically leaves the cramped turning spot and returns',
  );
  assert.equal(S.totals(s, 'diesel').stored, 1);
  assert.equal(S.totals(s, 'diesel').cargo, 0);
  assert.equal(s.costs.filter((c) => c.category === 'Purchases').length, 1);
  assert.equal(s.stacks.find((q) => q.id === 'STK-0074')!.x, 31);
});

test('an occupied final dock produces one durable warning through actual unloading ticks', () => {
  const { s, e, o, t } = atStorageDock();
  e.yaw = 0;
  t.cargo = { ...localPoint(e, 2, 0), y: 0.4, yaw: Math.PI / 2 };
  s.equipment.push({
    ...e,
    id: 'EQ-0074',
    x: 29.5,
    z: 38.5,
    yaw: Math.PI / 2,
    operator: undefined,
    deliveryOrder: undefined,
    cargo: undefined,
    path: [],
    work: 0,
  });
  assert.equal(resumeDeliveryHandling(s, e.id), '');
  advance(s, 45);
  assert.ok(o.unload && e.cargo, 'A blocked dock never lowers the barrel remotely');
  const warnings = s.events.filter((v) => v.severity === 'warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /EQ-0074/);
  assert.equal(s.notices[0].title, 'Delivery handling blocked');
  assert.equal(s.notices[0].entity, e.id);
  assert.equal(s.notices[0].state, 'todo');
  const restored = S.load(S.save(s));
  advance(restored, 30);
  assert.equal(restored.events.filter((v) => v.severity === 'warning').length, 1);
});

test('save validation rejects unsafe paused transfer state and corrupt warning metadata', () => {
  const { s, e, o } = atStorageDock();
  const check = (edit: (data: any) => void, pattern: RegExp) => {
    const data = JSON.parse(S.save(s));
    edit(data);
    assert.throws(() => S.load(JSON.stringify(data)), pattern);
  };
  check(
    (d) => (d.orders.find((q: any) => q.id === o.id).unload.phase = 'lower'),
    /unsafe paused delivery/,
  );
  check(
    (d) => (d.equipment.find((q: any) => q.id === e.id).cargo = undefined),
    /unsafe paused delivery/,
  );
  check(
    (d) =>
      (d.orders.find((q: any) => q.id === o.id).unloadBlockage = { since: -1, reason: 'blocked' }),
    /saved delivery blockage/,
  );
  check((d) => (d.events[0].severity = 'invalid'), /activity severity/);
});
