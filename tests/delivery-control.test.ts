import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { seedHandlingResources, tickUntil, advance } from './support/yard.ts';
import { localPoint } from '../src/motion.ts';
import { dist } from '../src/path.ts';
import {
  deliveryControlState,
  pauseDeliveryHandling,
  resumeDeliveryHandling,
  deliveryBlockageNotice,
  resetDeliveryBlockage,
  isPausedDeliveryOperator,
} from '../src/delivery-control.ts';

function carriedDelivery() {
  const s = S.createState(),
    e = seedHandlingResources(s);
  assert.equal(S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }), '');
  const [oid] = S.purchase(s, 'diesel', 1);
  const o = s.orders.find((q) => q.id === oid)!;
  tickUntil(s, () => o.unload?.phase === 'carry', 300);
  const w = s.workers.find((q) => q.id === o.unload!.operatorId)!;
  return { s, e, o, w };
}

test('paused loaded delivery retains cargo, crew, stock reservation, and carrier departure', () => {
  const { s, e, o, w } = carriedDelivery();
  const task = o.unload!,
    load = { ...e.cargo! },
    allocation = JSON.stringify(o.allocated);
  const arrived = o.arrived,
    clock = task.clock;
  assert.equal(pauseDeliveryHandling(s, e.id), '');
  assert.ok(deliveryControlState(s, e.id)!.paused);
  assert.ok(isPausedDeliveryOperator(s, w));
  assert.equal(w.duty, 'manual');
  assert.equal(w.deliveryOrder, o.id);
  assert.equal(e.deliveryOrder, o.id);
  // The supported load initially occupies the carrier's real turning envelope.
  // Reposition it out of that lane; pausing handling must not pause the carrier.
  assert.equal(S.moveWorker(s, w.id, { x: e.x, z: e.z + 8 }), '');
  advance(s, 60);
  assert.equal(task.clock, clock, 'Paused handling does not keep advancing its transfer clock');
  assert.deepEqual(e.cargo, load);
  assert.equal(o.arrived, arrived);
  assert.equal(o.unload, task);
  assert.equal(JSON.stringify(o.allocated), allocation);
  assert.ok(
    o.carrierDeparted || o.status === 'done',
    'The already emptied carrier leaves while site handling is paused',
  );
  assert.equal(
    s.stacks.filter((k) => k.item === 'diesel').length,
    0,
    'No automatic setdown happens while paused',
  );
});

test('manual recovery moves the same supported load and resumes from its physical position', () => {
  const { s, e, o, w } = carriedDelivery();
  assert.equal(pauseDeliveryHandling(s, e.id), '');
  const old = { x: e.x, z: e.z },
    used = e.used;
  const goal = { x: e.x - 4, z: e.z + 5 };
  assert.equal(S.moveWorker(s, w.id, goal), '');
  let sawMovement = false;
  tickUntil(
    s,
    () => !e.path.length,
    90,
    () => {
      sawMovement ||= dist(old, e) > 0.1;
      const support = localPoint({ ...e, yaw: e.yaw || 0 }, e.reach || 3, 0);
      assert.ok(
        dist(support, o.unload!.cargo!) < 0.025,
        'Load remains on the moving forks rather than its old position',
      );
      assert.equal(e.cargo?.item, 'diesel');
      assert.equal(o.arrived, 1);
    },
  );
  assert.ok(sawMovement);
  assert.ok(e.used > used);
  const manualEnd = { x: e.x, z: e.z };
  assert.equal(resumeDeliveryHandling(s, e.id), '');
  assert.ok(dist(manualEnd, e) < 0.001, 'Resume never teleports the machine or load');
  assert.equal(w.duty, 'auto');
  assert.equal(o.unloadPaused, undefined);
  tickUntil(s, () => !o.unload, 300);
  assert.equal(S.totals(s, 'diesel').stored, 1);
  assert.equal(
    s.costs.filter((c) => c.entity === o.id).length,
    1,
    'Recovery never repeats procurement',
  );
});

test('paused recovery survives reload and rejects unsafe transfer takeover', () => {
  const { s, e, o, w } = carriedDelivery();
  const phase = o.unload!.phase;
  o.unload!.phase = 'lower';
  assert.match(pauseDeliveryHandling(s, e.id), /current rigging, lifting, lowering/);
  assert.equal(w.duty, 'auto');
  assert.equal(o.unloadPaused, undefined);
  o.unload!.phase = phase;
  assert.equal(pauseDeliveryHandling(s, e.id), '');
  const loaded = S.load(S.save(s));
  const restored = loaded.equipment.find((q) => q.id === e.id)!;
  const control = deliveryControlState(loaded, e.id)!;
  assert.ok(control.paused);
  assert.ok(isPausedDeliveryOperator(loaded, control.operator));
  assert.equal(control.operator.vehicle, restored.id);
  assert.equal(restored.cargo?.item, 'diesel');
  assert.equal(resumeDeliveryHandling(loaded, e.id), '');
  tickUntil(loaded, () => !loaded.orders.find((q) => q.id === o.id)!.unload, 300);
  assert.equal(S.totals(loaded, 'diesel').stored, 1);
});

test('stationary clear phase can recover only after the supported load and rigger are safe', () => {
  const { s, e, o } = carriedDelivery();
  o.unload!.phase = 'clear';
  e.path = [{ x: e.x, z: e.z + 2 }];
  assert.match(pauseDeliveryHandling(s, e.id), /withdrawing clear/);
  e.path = [];
  o.unload!.riggerId = 'WK-rigging';
  assert.match(pauseDeliveryHandling(s, e.id), /withdrawing clear/);
  o.unload!.riggerId = undefined;
  assert.equal(pauseDeliveryHandling(s, e.id), '');
  assert.equal(resumeDeliveryHandling(s, e.id), '');
  assert.equal(
    o.unload!.phase,
    'carry',
    'Recovery retries the loaded storage route from its new position',
  );
});

test('prolonged blockage creates one warning and actionable todo, preserved through reload', () => {
  const { s, e, o } = carriedDelivery();
  const reason = 'No clear loaded route; blocked by STK-0074';
  deliveryBlockageNotice(s, o, reason, 20);
  assert.equal(s.events.filter((v) => v.severity === 'warning').length, 0);
  s.elapsed += 19;
  deliveryBlockageNotice(s, o, reason, 20);
  assert.equal(s.notices.filter((n) => n.title === 'Delivery handling blocked').length, 0);
  s.elapsed += 1;
  deliveryBlockageNotice(s, o, reason, 20);
  assert.equal(s.events.filter((v) => v.severity === 'warning').length, 1);
  const notice = s.notices.find((n) => n.title === 'Delivery handling blocked')!;
  assert.equal(notice.state, 'todo');
  assert.equal(notice.entity, e.id);
  assert.match(notice.detail, /STK-0074/);
  const loaded = S.load(S.save(s)),
    restored = loaded.orders.find((q) => q.id === o.id)!;
  loaded.elapsed += 30;
  deliveryBlockageNotice(loaded, restored, reason, 20);
  assert.equal(
    loaded.events.filter((v) => v.severity === 'warning').length,
    1,
    'Reload does not spam another copy',
  );
  resetDeliveryBlockage(loaded, restored);
  assert.equal(restored.unloadBlockage, undefined);
  assert.equal(
    loaded.events.filter((v) => v.severity === 'warning').length,
    1,
    'Resolved wait remains in activity history',
  );
});

test('resuming a paused empty forklift still physically withdraws before releasing its delivery', () => {
  const { s, e, o } = carriedDelivery();
  tickUntil(s, () => o.unload?.phase === 'back-away', 300);
  const task = o.unload!,
    original = { x: e.x, z: e.z };
  assert.equal(e.cargo, undefined);
  assert.equal(pauseDeliveryHandling(s, e.id), '');
  assert.equal(resumeDeliveryHandling(s, e.id), '');
  assert.ok(
    e.path.length,
    'Resume restores a real withdrawal route rather than dropping the assignment',
  );
  assert.equal(o.unload, task);
  S.tick(s, 0.1);
  assert.ok(o.unload, 'A single frame cannot bypass the remaining physical withdrawal');
  tickUntil(s, () => !o.unload, 90);
  assert.ok(dist(original, e) > 2, 'Forklift actually drives clear of the placed barrel');
  assert.equal(S.totals(s, 'diesel').stored, 1);
  assert.equal(e.deliveryOrder, undefined);
});
