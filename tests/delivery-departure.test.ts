import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { requestRailUnloading } from '../src/rail-freight';
import { route, dist } from '../src/path';
import { equipmentSweepBlocked } from '../src/traffic';
import { seedHandlingResources, tickUntil } from './support/yard';

function stockPocket() {
  const s = S.createState();
  assert.equal(S.addZone(s, { x: 10, z: 32, w: 20, d: 10 }), '');
  const e = seedHandlingResources(s);
  const w = s.workers[0];
  Object.assign(e, { x: 34.5, z: 24.4, yaw: -Math.PI / 2, heading: 3, reach: 3, operator: w.id });
  Object.assign(w, { x: e.x, z: e.z, vehicle: e.id });
  for (const [item, x, z, width, depth] of [
    ['bufferStop', 34, 19, 2, 2],
    ['rail', 36, 19, 5, 3],
    ['rail', 41, 19, 5, 3],
    ['railCurve', 36, 22, 6, 3],
    ['railCurve', 37, 25, 6, 3],
    ['railCurve', 34, 28, 6, 3],
  ] as const)
    s.stacks.push({
      id: S.id(s, 'stack'),
      item,
      x,
      z,
      w: width,
      d: depth,
      qty: 1,
      reserved: 0,
      source: 'opening',
    });
  const [oid] = S.purchase(s, 'slab', 20, 'rail');
  const o = s.orders.find((o) => o.id === oid)!;
  tickUntil(s, () => o.status === 'unloading', 300);
  assert.equal(requestRailUnloading(s, oid), undefined);
  tickUntil(s, () => !!o.unload, 30);
  return { s, e, w, o };
}

for (const existingRoute of [false, true])
  test(`automatic freight escapes a stock pocket${existingRoute ? ' with an old center-only route' : ''} and survives reload`, () => {
    let { s, e, w, o } = stockPocket();
    const eid = e.id,
      oid = o.id,
      start = { ...e },
      pickup = { ...o.unload!.pickup };
    // A previous-version save may already contain the infeasible turning route.
    if (existingRoute) {
      o.unload!.phase = 'approach';
      e.path = route(e, pickup, S.obstacles(s), 1.1)!;
      assert.ok(e.path.length);
    }
    const stock = s.stacks.map((t) => ({ ...t }));
    // Automatic pedestrian behind the forklift must get an actual escape route.
    s.workers.push({
      id: S.id(s, 'worker'),
      name: 'Worker #2',
      role: 'builder',
      duty: 'auto',
      status: 'Available',
      x: 35.7,
      z: 26.5,
      path: [],
      heading: 0,
      yaw: 0,
      hours: 0,
      wage: 28,
    });
    const pedestrian = s.workers.at(-1)!,
      pedestrianStart = { ...pedestrian };
    let sawReverse = false,
      reloaded = false,
      reachedPickup = false,
      pedestrianYielded = false;
    for (let time = 0; time < 600 && (o.unload || o.status !== 'done'); time += 0.1) {
      const previous = { ...e };
      S.tick(s, 0.1);
      pedestrianYielded ||=
        dist(
          s.workers.find((q) => q.id === pedestrian.id)!,
          pedestrianStart,
        ) > 0.2;
      if (dist(previous, e) > 1e-7 || Math.abs((previous.yaw || 0) - (e.yaw || 0)) > 1e-7)
        assert.equal(
          equipmentSweepBlocked(s, previous, e),
          '',
          'Every executed maneuver preserves collision clearance',
        );
      sawReverse ||= !!e.reverse && dist(e, start) > 0.2 && !!e.trafficGoal;
      reachedPickup ||= dist(e, pickup) < 0.15;
      if (!reloaded && e.trafficGoal && e.reverse && dist(e, start) > 0.25) {
        assert.deepEqual(e.trafficGoal, pickup, 'Backing retains the real unloading destination');
        s = S.load(S.save(s));
        e = s.equipment.find((q) => q.id === eid)!;
        o = s.orders.find((q) => q.id === oid)!;
        w = s.workers.find((q) => q.id === w.id)!;
        reloaded = true;
      }
      if (o.unload?.phase === 'rig')
        assert.ok(dist(e, o.unload.pickup) < 0.15, 'A missing route never allows a remote pickup');
    }
    assert.ok(
      sawReverse && reloaded && reachedPickup,
      'Back up, restore the saved maneuver, change gear and actually reach the car',
    );
    assert.ok(pedestrianYielded, 'The pedestrian really yields, even if they later return');
    assert.equal(o.status, 'done', o.note);
    assert.equal(S.totals(s, 'slab').stored, 20);
    for (const stack of stock)
      assert.deepEqual(
        s.stacks.find((t) => t.id === stack.id),
        stack,
        'Existing stock is not moved or removed to manufacture clearance',
      );
  });

test('a lost approach route cannot advance to rigging from across the yard', () => {
  const { s, e, o } = stockPocket();
  o.unload!.phase = 'approach';
  e.path = [];
  e.trafficGoal = undefined;
  e.x = 70;
  e.z = 35;
  S.tick(s, 0.1);
  assert.equal(o.unload!.phase, 'approach');
  assert.equal(o.arrived, 0);
  assert.equal(e.cargo, undefined);
  assert.ok(e.path.length || o.note.includes('No clear machine route'));
});
