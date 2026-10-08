import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { setJobEquipment } from '../src/jobs';
import { equipmentBoxes, personTouchesBox } from '../src/traffic';
import { checkScenarioFuel, seedHandlingResources } from './support/yard';

function fixture() {
  const s = S.createState();
  const forklift = seedHandlingResources(s, 'forklift');
  const excavator = seedHandlingResources(s, 'excavator');
  const [driver, idleDriver, builder] = s.workers;
  Object.assign(forklift, {
    x: 64.9, z: 38.5, yaw: Math.PI, reach: 3, lift: .12, operator: driver.id,
  });
  Object.assign(driver, { x: forklift.x, z: forklift.z, vehicle: forklift.id });
  Object.assign(excavator, { x: 31.5, z: 49.5, yaw: -Math.PI / 2, reach: 4, lift: .2 });
  Object.assign(idleDriver, { x: 33.25, z: 49.7 });
  Object.assign(builder, { x: 58.6, z: 38.5 });
  // Empty drums occupy the west face; the idle excavator blocks the other
  // pickup faces after its operator has finished a physical fuel service.
  for (const x of [24, 25]) s.stacks.push({
    id: S.id(s, 'stack'), item: 'diesel', qty: 1, liters: 0,
    reserved: 0, x, z: 49, w: 1, d: 1, source: 'opening', yaw: Math.PI,
  });
  s.stacks.push({
    id: S.id(s, 'stack'), item: 'slab', qty: 3, reserved: 0,
    x: 29, z: 49, w: 1, d: 1, source: 'opening', yaw: Math.PI,
  });
  assert.equal(S.pave(s, { x: 61, z: 38, w: 3, d: 1 }), 3);
  const work = s.jobGroups![0];
  assert.equal(setJobEquipment(s, work.id, forklift.id), '');
  return { s, forkliftId: forklift.id, excavatorId: excavator.id, idleDriverId: idleDriver.id };
}

function checkSlabs(s: ReturnType<typeof S.createState>, total = 3) {
  const stock = S.totals(s, 'slab');
  assert.equal(stock.stored + stock.cargo + stock.installed, total);
  checkScenarioFuel(s);
}

test('a blocked source recruits its idle excavator operator and physically clears all three slabs across reload', () => {
  const f = fixture();
  let s = S.load(S.save(f.s));
  let boarded = false, walkedToBoard = false, droveClear = false, reloaded = false;
  for (let t = 0; t < 600 && s.jobs.some((j) => j.status !== 'done'); t += .1) {
    const e = s.equipment.find((e) => e.id === f.excavatorId)!;
    const driver = s.workers.find((w) => w.id === f.idleDriverId)!;
    const before = { x: e.x, z: e.z };
    S.tick(s, .1);
    assert.ok(Math.hypot(e.x - before.x, e.z - before.z) < .3, 'The excavator must drive continuously');
    if (driver.transition?.equipmentId === e.id) walkedToBoard = true;
    if (driver.vehicle === e.id) boarded = true;
    if (Math.hypot(e.x - 31.5, e.z - 49.5) > 2) droveClear = true;
    for (const worker of s.workers.filter((w) => !w.vehicle && !w.transition))
      assert.ok(s.equipment.every((q) => equipmentBoxes(q).every((box) => !personTouchesBox(worker, box, .2))), 'Workers stay outside both machines and their loads');
    checkSlabs(s);
    if (!reloaded && e.actionYieldFor) {
      s = S.load(S.save(s));
      reloaded = true;
    }
  }
  assert.ok(walkedToBoard && boarded && droveClear && reloaded, 'Clearance must recruit, board, drive and survive reload');
  assert.ok(s.jobs.every((j) => j.status === 'done'));
  assert.equal(S.totals(s, 'slab').installed, 3);
  assert.equal(S.totals(s, 'slab').reserved, 0);
});

test('a manual source blocker remains controlled by its operator and receives a linked clearance warning', () => {
  const f = fixture(), s = f.s;
  const e = s.equipment.find((e) => e.id === f.excavatorId)!;
  const driver = s.workers.find((w) => w.id === f.idleDriverId)!;
  e.operator = driver.id;
  Object.assign(driver, { x: e.x, z: e.z, vehicle: e.id, duty: 'manual' });
  for (let t = 0; t < 35; t += .1) { S.tick(s, .1); checkSlabs(s); }
  assert.deepEqual({ x: e.x, z: e.z }, { x: 31.5, z: 49.5 });
  assert.equal(e.actionYieldFor, undefined);
  assert.equal(driver.duty, 'manual');
  assert.ok(s.jobs.some((j) => j.handling?.phase === 'approach'), 'The reserved work waits for real clearance');
  assert.ok(s.notices.some((n) => s.jobs.some((j) => j.id === n.entity) && n.title === 'Action blocked' && n.detail.includes(e.id) && /manual control/.test(n.detail)));
  assert.equal(S.totals(s, 'slab').installed, 0);
});

test('a loaded source blocker retains its supported load and is not automatically driven', () => {
  const f = fixture(), s = f.s;
  const e = s.equipment.find((e) => e.id === f.excavatorId)!;
  e.cargo = { item: 'slab', qty: 1, yaw: 0 };
  for (let t = 0; t < 20; t += .1) { S.tick(s, .1); checkSlabs(s, 4); }
  assert.deepEqual({ x: e.x, z: e.z }, { x: 31.5, z: 49.5 });
  assert.deepEqual(e.cargo, { item: 'slab', qty: 1, yaw: 0 });
  assert.equal(e.actionYieldFor, undefined);
  assert.equal(e.operator, undefined);
  assert.ok(s.jobs.every((j) => !j.handling), 'Active equipment remains in the real source survey');
  assert.equal(S.totals(s, 'slab').installed, 0);
});
