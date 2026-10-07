import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { advanceRailCoupling, initializeRailCouplers, tickRailPickupBilling } from '../src/rail-coupling';
import { railCouplingValidationProblem } from '../src/rail-coupling-validation';
import { railFreightCarPose } from '../src/rail-freight';
import { renderState } from '../native-runtime/render';
import { people } from '../src/traffic';
import { tickUntil } from './support/yard';
import type { State, RailReturn } from '../src/types';

function received() {
  const s = S.createState();
  S.purchaseBatch(s, [{ item: 'slab', qty: 8 }], 'rail');
  tickUntil(s, () => s.orders[0].status === 'unloading');
  initializeRailCouplers(s);
  return s;
}
function options(s: State, mode: 'couple' | 'uncouple') {
  const o = s.orders[0], f = o.railFreight!;
  return { ownerId: o.id, locomotiveId: f.locomotiveId, locomotivePose: { ...o.vehicle, yaw: o.drive?.yaw || 0 }, carIds: f.cars.map(c => c.id), mode };
}
function step(s: State, mode: 'couple' | 'uncouple', dt = 0.1) {
  s.elapsed += dt; s.time += dt;
  return advanceRailCoupling(s, s.orders[0].railFreight!, dt, options(s, mode));
}
function finish(s: State, mode: 'couple' | 'uncouple') {
  for (let n = 0; n < 4000; n++) if (step(s, mode)) return;
  assert.fail(JSON.stringify(s.orders[0].railFreight!.coupling));
}
test('rail release uses visible walking crew, physical brake-before-coupler work and clear boarding', () => {
  const s = received(), o = s.orders[0], f = o.railFreight!, c = f.cars[0];
  const pose = railFreightCarPose(o, 0);
  assert.deepEqual(c.coupledTo, [f.locomotiveId]);
  assert.equal(c.handbrake, false);
  step(s, 'uncouple');
  const crew = s.railServiceCrew![0], start = { x: crew.x, z: crew.z };
  assert.equal(crew.phase, 'alighting');
  assert.ok(people(s).some(p => p.id === crew.id));
  assert.ok(renderState(s).actors.some(a => a.id === crew.id && a.visible));
  let walked = false, securedBeforeDisconnected = false;
  for (let n = 0; n < 4000; n++) {
    const done = step(s, 'uncouple');
    walked ||= Math.hypot(crew.x - start.x, crew.z - start.z) > 2;
    securedBeforeDisconnected ||= !!c.handbrake && !!c.coupledTo?.includes(f.locomotiveId);
    assert.deepEqual(railFreightCarPose(o, 0), pose, 'No cargo/car teleport while ground work progresses');
    if (done) break;
  }
  assert.ok(walked); assert.ok(securedBeforeDisconnected);
  assert.equal(f.coupling!.phase, 'done');
  assert.equal(c.handbrake, true); assert.deepEqual(c.coupledTo, []);
  assert.equal(c.brakeHoseConnected, false); assert.equal(crew.phase, 'aboard');
  assert.equal(people(s).some(p => p.id === crew.id), false);
  assert.equal(s.costs.filter(c => c.description.startsWith('Railway ground crew')).length, 1);
});
test('interrupted coupling survives reload without duplicate crew, links, brake actions or service costs', () => {
  let s = received();
  finish(s, 'uncouple');
  for (let n = 0; n < 50; n++) step(s, 'couple');
  const before = JSON.parse(JSON.stringify(s.orders[0].railFreight!.coupling));
  const crewId = s.railServiceCrew![0].id;
  s = S.load(S.save(s));
  assert.deepEqual(s.orders[0].railFreight!.coupling, before);
  assert.equal(s.railServiceCrew![0].id, crewId);
  finish(s, 'couple');
  const f = s.orders[0].railFreight!, c = f.cars[0];
  assert.deepEqual(c.coupledTo, [f.locomotiveId]);
  assert.equal(c.brakeHoseConnected, true); assert.equal(c.handbrake, false);
  assert.equal(s.railServiceCrew!.length, 1);
  assert.equal(s.costs.filter(c => c.description.startsWith('Railway ground crew')).length, 1);
  assert.doesNotThrow(() => S.load(S.save(s)));
});
test('ground work stops and issues a warning if a walking approach becomes inaccessible', () => {
  const s = received(), f = s.orders[0].railFreight!;
  step(s, 'uncouple');
  for (let n = 0; n < 25; n++) step(s, 'uncouple');
  const a = f.coupling!.actions[0];
  s.buildings.push({ id: S.id(s, 'building'), kind: 'office', x: a.point.x - 1, z: a.point.z - 1, w: 2, d: 2, rotation: 0 } as any);
  for (let n = 0; n < 350; n++) step(s, 'uncouple');
  assert.notEqual(f.coupling!.phase, 'done');
  assert.equal(f.cars[0].handbrake, false, 'No invisible brake action without standing beside the car');
  assert.ok(s.notices.some(n => n.title === 'Rail ground work blocked'));
});
test('explicit links preserve internal car connections and reject asymmetric/cyclic/unknown imports', () => {
  const s = received(), f = s.orders[0].railFreight!, first = f.cars[0];
  const second = { ...first, id: S.id(s, 'CAR'), coupledTo: [first.id], centerOffset: first.centerOffset + 17.6 };
  first.coupledTo!.push(second.id); f.cars.push(second);
  assert.equal(railCouplingValidationProblem(s, new Set()), undefined);
  second.coupledTo = [];
  assert.match(railCouplingValidationProblem(s, new Set())!, /asymmetric/);
  second.coupledTo = [first.id]; first.coupledTo!.push(first.id);
  assert.match(railCouplingValidationProblem(s, new Set())!, /coupler state/);
});
test('pickup waiting is charged once per actual minute with exact fractional settlement', () => {
  const s = S.createState();
  const r = { id: 'RETURN-999', phase: 'coupling', movement: { velocity: 0 }, waitingClock: 0 } as RailReturn;
  tickRailPickupBilling(s, r, 125.5);
  assert.equal(r.waitingSeconds, 125.5); assert.equal(r.waitingClock, 5.5);
  assert.equal(r.waitingCost, 6);
  assert.equal(s.costs.length, 2);
  r.phase = 'returning'; r.movement.velocity = 3;
  tickRailPickupBilling(s, r, 200);
  assert.equal(r.waitingSeconds, 125.5);
  r.movement.blockedBy = 'CAR-1';
  tickRailPickupBilling(s, r, 10);
  r.phase = 'done';
  tickRailPickupBilling(s, r, 0);
  assert.equal(r.waitingSeconds, 135.5); assert.equal(r.waitingClock, 0);
  assert.equal(r.waitingCost, 6.775);
  tickRailPickupBilling(s, r, 0);
  assert.equal(s.costs.length, 3, 'Completed pickup never bills twice');
});

test('purchased shunter has a visible supplier inspection and signed handover before its driver walks out', async () => {
  const { commissionExit } = await import('./support/rail');
  const { orderShunter } = await import('../src/rail-operations');
  let s = S.createState(); s.creative = true; commissionExit(s);
  assert.equal(orderShunter(s).error, undefined);
  let e = s.shunters![0];
  tickUntil(s, () => e.handover?.phase === 'working', 1200);
  assert.equal(e.phase, 'delivering', 'Ownership is not handed over by an arrival timer');
  const crewId = e.handover!.workerId;
  assert.ok(renderState(s).actors.some(a => a.id === crewId && a.visible));
  s = S.load(S.save(s)); e = s.shunters![0];
  tickUntil(s, () => e.phase === 'parked', 1200);
  const w = s.railServiceCrew!.find(w => w.id === crewId)!;
  assert.equal(w.phase, 'left-site');
  assert.ok(Math.hypot(w.x + 40, w.z + 15) < 0.25);
  assert.equal(e.handover!.phase, 'done');
  assert.equal(e.mass, 32000); assert.equal(e.purchasePrice, 68000); assert.equal(e.deliveryService, 'rail');
  assert.equal(s.costs.filter(c => c.entity === e.id && c.description.includes('Owned diesel')).length, 1);
  assert.ok(s.events.some(a => a.entity === e.id && a.text.includes('signed handover')));
  assert.doesNotThrow(() => S.load(S.save(s)));
});
