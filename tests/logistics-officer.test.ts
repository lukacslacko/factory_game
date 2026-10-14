import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS, ROLES } from '../src/catalog';
import { selectWorker } from '../src/worker-selection';
import {
  configureLogisticsPolicy, logisticsPolicy, onDutyLogisticsOfficers,
  recordLogisticsOfficerAction, reviewLogisticsOfficer,
} from '../src/logistics-officer';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { State, Worker } from '../src/types';

function officer(s: State): Worker {
  const w: Worker = {
    id: S.id(s, 'worker'), name: `Worker #${s.workers.length + 1}`,
    role: 'logisticsOfficer', duty: 'auto', status: 'Coordinating logistics',
    x: 20, z: 32, heading: 0, path: [], hours: 0,
    wage: ROLES.logisticsOfficer.wage,
  };
  s.workers.push(w);
  return w;
}

test('saved officer policy defaults on, validates atomically, and does not affect older saves', () => {
  const s = S.createState();
  const defaults = logisticsPolicy(s);
  assert.equal(defaults.automaticStockRelocation, true);
  assert.equal(defaults.automaticIdleClearance, true);
  assert.equal(reviewLogisticsOfficer(s).action, undefined,
    'No officer means recommendations only, despite on-by-default policy');
  assert.ok(configureLogisticsPolicy(s, { minimumWaitSeconds: 0 }));
  assert.equal(s.logisticsPolicy, undefined, 'Invalid policy does not partially write');
  assert.equal(configureLogisticsPolicy(s, {
    automaticStockRelocation: false, maxActiveRelocations: 2,
  }), '');
  assert.equal(logisticsPolicy(S.load(S.save(s))).automaticStockRelocation, false);
  assert.equal(logisticsPolicy(s).maxActiveRelocations, 2);
  assert.throws(() => S.load(JSON.stringify({ ...JSON.parse(S.save(s)),
    logisticsPolicy: { ...s.logisticsPolicy, maxActiveRelocations: 99 } })),
  /invalid logistics officer policy/);
});

test('officer works only on shift and is never conscripted as a physical helper', () => {
  const s = S.createState();
  const [orderId] = S.purchase(s, 'logisticsOfficer', 1);
  assert.equal(s.orders.find((o) => o.id === orderId)?.item, 'logisticsOfficer',
    'The officer is hireable through normal worker transport');
  const w = officer(s);
  assert.deepEqual(onDutyLogisticsOfficers(s).map((q) => q.id), [w.id]);
  assert.equal(selectWorker(s, [{ x: 21, z: 32 }]), undefined);
  w.shiftPhase = 'home';
  assert.equal(onDutyLogisticsOfficers(s).length, 0);
  w.shiftPhase = 'working';
  w.duty = 'manual';
  assert.equal(onDutyLogisticsOfficers(s).length, 0);
  w.duty = 'auto';
  assert.equal(onDutyLogisticsOfficers(s).length, 1);
  w.schedule = { start: 18, end: 22 };
  assert.equal(onDutyLogisticsOfficers(s).length, 0,
    'A recorded duty does not override an off-shift schedule');
});

test('a hired officer arrives physically by the normal worker bus', () => {
  const s = S.createState();
  const [orderId] = S.purchase(s, 'logisticsOfficer', 1);
  tickUntil(s, () => s.orders.find((o) => o.id === orderId)?.status === 'done', 300);
  const hires = s.workers.filter((w) => w.role === 'logisticsOfficer');
  assert.equal(hires.length, 1);
  assert.equal(onDutyLogisticsOfficers(s).length, 1);
  assert.equal(selectWorker(s, [{ x: 21, z: 32 }]), undefined,
    'Hiring an officer cannot consume that person as an implicit builder');
  assert.equal(S.load(S.save(s)).workers.find((w) => w.id === hires[0].id)?.role,
    'logisticsOfficer');
});

test('officer proposes clearing a checked idle machine, preserving manual control', () => {
  const s = S.createState();
  const e = seedHandlingResources(s, 'excavator');
  const driver = s.workers.find((q) => q.role === 'operator')!;
  e.operator = driver.id;
  Object.assign(driver, { vehicle: e.id, x: e.x, z: e.z });
  const w = officer(s);
  const j = S.plan(s, 'lamp', 40, 40).job!;
  j.reason = 'Waiting for placement area clearance';
  s.elapsed = 50;
  s.actionClearances = [{ ownerId: j.id, action: 'Lower lamp',
    blockerIds: [e.id], since: 15, lastSeen: 50, retryAt: 50,
    point: { x: 40, z: 40 } }];
  const before = S.save(s);
  const reviewed = reviewLogisticsOfficer(s);
  assert.equal(reviewed.action?.kind, 'clear-idle-equipment');
  assert.equal(reviewed.action?.officerId, w.id);
  assert.equal(S.save(s), before, 'Review is pure');
  e.job = 'JOB-MANUALLY-OWNED';
  assert.equal(reviewLogisticsOfficer(s).action, undefined);
  e.job = undefined;
  assert.equal(configureLogisticsPolicy(s, { automaticIdleClearance: false }), '');
  assert.equal(reviewLogisticsOfficer(s).action, undefined);
});

test('verified rail-stock recovery proposal requires officer, available crew, and safe storage', () => {
  const s = S.createState();
  assert.equal(S.addZone(s, { x: 50, z: 38, w: 18, d: 18 }, 'Rail stores'), '');
  const e = seedHandlingResources(s, 'excavator');
  Object.assign(e, { x: 25.5, z: 42.5 });
  Object.assign(s.workers.find((w) => w.role === 'operator')!, { x: 26, z: 42 });
  Object.assign(s.workers.find((w) => w.role === 'builder')!, { x: 33, z: 42 });
  const w = officer(s);
  const material = MATERIALS.rail;
  const stock = { id: S.id(s, 'stack'), item: 'rail' as const,
    x: 36, z: 42, w: material.w, d: material.d,
    qty: 1, reserved: 0, source: 'opening' };
  s.stacks.push(stock);
  const j = S.plan(s, 'lamp', 75, 52).job!;
  j.reason = 'Waiting for rail stock to clear';
  s.elapsed = 60;
  s.actionClearances = [{ ownerId: j.id, action: 'Clear approach',
    blockerIds: [stock.id], since: 20, lastSeen: 60, retryAt: 60,
    point: { x: 37, z: 43 } }];
  const before = S.save(s);
  const action = reviewLogisticsOfficer(s).action;
  assert.equal(action?.kind, 'relocate-stock');
  if (action?.kind === 'relocate-stock') {
    assert.equal(action.sourceId, stock.id);
    assert.equal(action.equipmentId, e.id);
    assert.equal(action.officerId, w.id);
    assert.equal(action.quantity, 1);
  }
  assert.equal(S.save(s), before, 'Preflight never moves physical stock');
  if (action?.kind === 'relocate-stock') {
    recordLogisticsOfficerAction(s, action);
    recordLogisticsOfficerAction(s, action);
    assert.equal(reviewLogisticsOfficer(S.load(S.save(s))).action, undefined,
      'A saved attempt budget prevents repeatedly shuffling the same blocker');
  }
  s.logisticsOfficerAttempts = [];
  e.workRole = 'hold';
  assert.equal(reviewLogisticsOfficer(s).action, undefined,
    'Manual equipment hold is respected');
});
