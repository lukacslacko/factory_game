import { commissionExit, commissionAccess, prepareExitSteel } from './support/rail';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { validateState } from '../src/validate';
import {
  detachRailFreight,
  orderShunter,
  requestEmptyReturn,
  shuntRailCars,
} from '../src/rail-operations';
import { saveRailLocation } from '../src/rail-locations';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { State } from '../src/types';
const clone = (s: State): State => JSON.parse(JSON.stringify(s));
function fixtures() {
  const s = S.createState();
  s.creative = true;
  assert.equal(S.addZone(s, { x: 200, z: 100, w: 3, d: 3 }), '');
  assert.equal(commissionExit(s).error, '');
  S.purchaseBatch(s, [{ item: 'slab', qty: 8 }], 'rail');
  tickUntil(s, () => s.orders[0].status === 'unloading');
  assert.equal(detachRailFreight(s, s.orders[0].id), undefined);
  const uncoupling = clone(s);
  tickUntil(s, () => s.orders[0].railFreight!.locomotivePhase === 'gone');
  seedHandlingResources(s);
  s.workers[0].railQualified=true;
  assert.equal(orderShunter(s, { driverId: s.workers[0].id }).error, undefined);
  const ordered = clone(s);
  tickUntil(s, () => s.shunters![0].phase === 'delivering');
  const delivering = clone(s);
  tickUntil(s, () => s.shunters![0].phase === 'parked');
  const parked = clone(s);
  // Use a balanced empty ledger to isolate return-record validation from the
  // unrelated unloading equipment simulation exercised by rail-operations.test.
  s.railServiceCrew=s.railServiceCrew?.filter(c=>!s.shunters?.some(e=>e.id===c.ownerId));
  s.shunters = [];
  const o = s.orders[0];
  o.arrived = o.qty;
  o.manifest!.forEach((l) => (l.arrived = l.qty));
  o.railFreight!.cars.forEach((c) => c.manifest.forEach((l) => (l.arrived = l.qty)));
  assert.equal(requestEmptyReturn(s, { orderIds: [o.id] }).error, undefined);
  const returning = clone(s);
  tickUntil(s, () => s.railReturns![0].phase === 'done');
  return { uncoupling, ordered, delivering, parked, returning, complete: clone(s) };
}
const examples = fixtures();
function rejects(fixture: State, change: (s: any) => void, reason: RegExp) {
  const s = clone(fixture);
  change(s);
  assert.throws(() => validateState(s), reason);
}

test('rail operation saves validate at release, delivery, parked, collection and completed stages', () => {
  for (const [phase, fixture] of Object.entries(examples))
    assert.doesNotThrow(() => validateState(clone(fixture)), phase);
  const complete = clone(examples.complete);
  complete.rails = [];
  assert.doesNotThrow(
    () => validateState(complete),
    'Historical completed departure route tolerates later recovered rail',
  );
});
test('shunter IDs, register, fuel, locations, anchors, and driver ownership reject malformed saves', () => {
  rejects(examples.parked, (s) => (s.shunters = {}), /shunter register/);
  rejects(examples.parked, (s) => (s.shunters = null), /shunter register/);
  rejects(examples.parked, (s) => (s.shunters[0].id = s.orders[0].id), /owned shunter/);
  rejects(examples.parked, (s) => (s.shunters[0].fuel = 361), /owned shunter/);
  rejects(examples.parked, (s) => (s.shunters[0].used = -1), /owned shunter/);
  rejects(examples.parked, (s) => (s.shunters[0].x = Infinity), /owned shunter/);
  rejects(examples.parked, (s) => (s.shunters[0].destinationId = 'RLOC-missing'), /named location/);
  rejects(examples.parked, (s) => (s.shunters[0].anchor.offset = 1000), /track anchor/);
  rejects(examples.parked, (s) => (s.shunters[0].anchor.trackId = 'RAIL-missing'), /track anchor/);
  rejects(examples.parked, (s) => (s.shunters[0].driverId = 'WRK-missing'), /shunter driver/);
  rejects(
    examples.parked,
    (s) => {
      const e = { ...s.shunters[0], id: 'SHUNTER-9999' };
      s.shunters.push(e);
    },
    /duplicate shunter driver/,
  );
  rejects(
    examples.parked,
    (s) => (s.workers[0].railAssignment = 'SHUNTER-missing'),
    /rail assignment|shunter driver/,
  );
});
test('active route validation rejects nonfinite points, unknown rail, invalid bounds, mismatched geometry and switches', () => {
  rejects(
    examples.delivering,
    (s) => (s.shunters[0].movement.points[0].yaw = NaN),
    /shunter movement/,
  );
  rejects(examples.delivering, (s) => (s.shunters[0].movement.distance = -1), /shunter movement/);
  rejects(examples.delivering, (s) => (s.shunters[0].movement.end = 100000), /shunter movement/);
  rejects(
    examples.delivering,
    (s) => (s.shunters[0].movement.segments[0].trackId = 'RAIL-missing'),
    /shunter movement/,
  );
  rejects(
    examples.delivering,
    (s) => (s.shunters[0].movement.segments[0].from = 10000),
    /shunter movement/,
  );
  rejects(
    examples.delivering,
    (s) => (s.shunters[0].movement.points[1].z += 8),
    /shunter movement/,
  );
  rejects(
    examples.delivering,
    (s) => s.shunters[0].movement.switches.push({ id: 'RAIL-missing', route: 'branch' }),
    /shunter movement/,
  );
  rejects(examples.delivering, (s) => delete s.shunters[0].movement, /no reserved movement/);
});
test('detached car, locomotive phases and unloading selections preserve physical references', () => {
  rejects(
    examples.uncoupling,
    (s) => (s.orders[0].railFreight.detached = 'true'),
    /detached freight locomotive/,
  );
  rejects(
    examples.uncoupling,
    (s) => (s.orders[0].railFreight.locomotivePhase = 'gone'),
    /still reserves rail|inconsistent freight locomotive release/,
  );
  rejects(
    examples.parked,
    (s) => delete s.orders[0].railFreight.cars[0].anchor,
    /no physical track/,
  );
  rejects(
    examples.uncoupling,
    (s) => (s.orders[0].railFreight.cars[0].pose.z += 5),
    /inconsistent with rail position/,
  );
  rejects(
    examples.uncoupling,
    (s) => (s.orders[0].railFreight.cars[0].pose.z = NaN),
    /physical pose/,
  );
  rejects(
    examples.uncoupling,
    (s) => (s.orders[0].railFreight.cars[0].anchor.trackId = 'RAIL-missing'),
    /physical pose/,
  );
  rejects(
    examples.uncoupling,
    (s) => (s.orders[0].railFreight.cars[0].bogies = []),
    /physical pose/,
  );
  rejects(
    examples.uncoupling,
    (s) => (s.orders[0].railFreight.cars[0].returned = true),
    /loaded or attached/,
  );
  rejects(
    examples.uncoupling,
    (s) => (s.orders[0].railFreight.unloadCarIds = ['CAR-missing']),
    /selected unloading cars/,
  );
});
test('return records reject loaded, missing, reused or unbound cars and missing departure routes', () => {
  rejects(
    examples.returning,
    (s) => (s.railReturns[0].locomotiveId = s.orders[0].railFreight.locomotiveId),
    /empty return train/,
  );
  rejects(
    examples.returning,
    (s) => (s.railReturns[0].carIds = ['CAR-missing']),
    /missing or duplicate return car/,
  );
  rejects(
    examples.returning,
    (s) => (s.railReturns[0].orderIds = ['ORD-missing']),
    /unbound return train/,
  );
  rejects(
    examples.returning,
    (s) => {
      s.orders[0].arrived = 7;
      s.orders[0].manifest[0].arrived = 7;
      s.orders[0].railFreight.cars[0].manifest[0].arrived = 7;
    },
    /loaded, missing/,
  );
  rejects(examples.returning, (s) => delete s.railReturns[0].departure, /empty return train/);
  rejects(
    examples.returning,
    (s) => delete s.orders[0].railFreight.returnId,
    /unbound return train/,
  );
  rejects(
    examples.returning,
    (s) => {
      s.railReturns.push({ ...s.railReturns[0], id: 'RETURN-9998', locomotiveId: 'LOCO-9999' });
    },
    /unbound return train/,
  );
  rejects(
    examples.complete,
    (s) => (s.orders[0].railFreight.cars[0].returned = false),
    /unreturned car/,
  );
});

test('driver boarding, coupling, hauling and uncoupling saves retain consistent movement and ownership', () => {
  const s = clone(examples.parked),
    o = s.orders[0],
    e = s.shunters![0];
  assert.equal(
    saveRailLocation(s, {
      name: 'Validation dock',
      kind: 'unloading',
      trackId: 'BOOTSTRAP-SIDING',
      route: 'straight',
      offset: 45,
      length: 40,
    }),
    undefined,
  );
  assert.equal(
    shuntRailCars(s, {
      orderId: o.id,
      carIds: o.railFreight!.cars.map((c) => c.id),
      shunterId: e.id,
      railLocationId: s.railLocations!.at(-1)!.id,
    }),
    undefined,
  );
  const phases = new Set<string>();
  let ticks = 0;
  tickUntil(
    s,
    () => e.phase === 'parked',
    1200,
    () => {
      ticks++;
      if (!phases.has(e.phase) || ticks % 50 === 0) validateState(clone(s));
      phases.add(e.phase);
    },
  );
  for (const phase of ['boarding', 'approaching', 'coupling', 'hauling', 'uncoupling', 'parked'])
    assert.ok(phases.has(phase), phase);
});
