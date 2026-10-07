import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources, tickUntil } from './support/yard';
import { setEquipmentParking } from '../src/workforce';
import { equipmentBoxes, personTouchesBox } from '../src/traffic';
import type { State } from '../src/types';
function shedYard() {
  const s = S.createState();
  seedHandlingResources(s, 'excavator');
  s.stacks.push({
    id: 'SHED-KIT',
    item: 'shed',
    qty: 1,
    reserved: 0,
    x: 24,
    z: 32,
    w: 4,
    d: 2,
    source: 'opening',
  });
  for (let x = 45; x < 53; x++) for (let z = 35; z < 41; z++) s.paving[`${x},${z}`] = 'EXISTING';
  assert.equal(S.plan(s, 'shed', 45, 35).error, '');
  return s;
}
function warningFor(s: State, owner: string, blocker: string) {
  return s.events.some(
    (e) => e.entity === owner && e.severity === 'warning' && e.text.includes(blocker),
  );
}
test('a physically boxed roof blocker receives a persistent linked warning without unsafe movement', () => {
  let s = shedYard();
  const spare = seedHandlingResources(s, 'forklift'),
    driver = s.workers.at(-1)!;
  spare.x = 90;
  spare.z = 80;
  driver.x = 89;
  driver.z = 80;
  let j = s.jobs.find((j) => j.kind === 'shed')!;
  tickUntil(
    s,
    () => j.shedAssembly?.phase === 'lower' && j.shedAssembly.part?.kind === 'roof',
    1500,
  );
  const target = j.shedAssembly!.part!.to;
  spare.x = Math.round(target.x) + 4;
  spare.z = Math.round(target.z) + 3;
  spare.yaw = Math.PI;
  spare.heading = 2;
  spare.parking = { x: spare.x, z: spare.z, rotation: 2 };
  spare.parkingState = 'parked';
  spare.operator = driver.id;
  driver.vehicle = spare.id;
  driver.x = spare.x;
  driver.z = spare.z;
  driver.duty = 'manual';
  driver.path = [];
  const original = { x: spare.x, z: spare.z },
    jid = j.id,
    eid = spare.id,
    wid = driver.id;
  tickUntil(s, () => warningFor(s, jid, eid), 120);
  assert.deepEqual(
    { x: spare.x, z: spare.z },
    original,
    'Manual control is never silently overridden',
  );
  assert.ok(j.reason.includes(eid));
  s = S.load(S.save(s));
  j = s.jobs.find((j) => j.id === jid)!;
  assert.equal(S.releaseWorker(s, wid), '');
  for (let time = 0; time < 30; time += 0.1) S.tick(s, 0.1);
  const blocked = s.equipment.find((e) => e.id === eid)!;
  assert.deepEqual(
    { x: blocked.x, z: blocked.z },
    original,
    'An impossible maneuver is never faked',
  );
  assert.ok(j.reason.includes('no collision-free'));
  assert.equal(
    s.notices.filter((n) => n.entity === jid && n.severity === 'warning').length,
    1,
    'One durable warning survives reload and retries',
  );
  assert.ok(s.actionClearances?.find((r) => r.ownerId === jid)?.blockerIds.includes(eid));
  S.load(S.save(s));
});
test('roof placement asks an idle worker to physically leave the component envelope after manual release', () => {
  const s = shedYard(),
    spare = seedHandlingResources(s, 'forklift'),
    worker = s.workers.at(-1)!;
  spare.x = 90;
  spare.z = 80;
  worker.x = 89;
  worker.z = 80;
  const j = s.jobs.find((j) => j.kind === 'shed')!;
  tickUntil(
    s,
    () => j.shedAssembly?.phase === 'lower' && j.shedAssembly.part?.kind === 'roof',
    1500,
  );
  const target = j.shedAssembly!.part!.to;
  worker.x = target.x;
  worker.z = target.z;
  worker.duty = 'manual';
  worker.path = [];
  tickUntil(s, () => warningFor(s, j.id, worker.id), 120);
  assert.equal(S.releaseWorker(s, worker.id), '');
  let previous = { x: worker.x, z: worker.z },
    moved = false;
  tickUntil(
    s,
    () => j.status === 'done',
    1500,
    () => {
      assert.ok(
        Math.hypot(worker.x - previous.x, worker.z - previous.z) < 0.5,
        'Worker clears on a real walking route',
      );
      moved ||= Math.hypot(worker.x - target.x, worker.z - target.z) > 2;
      previous = { x: worker.x, z: worker.z };
    },
  );
  assert.ok(moved);
  assert.equal(s.buildings.filter((b) => b.kind === 'shed').length, 1);
  assert.ok(
    s.notices
      .filter((n) => n.entity === j.id && n.severity === 'warning')
      .every((n) => n.state === 'done'),
  );
  S.load(S.save(s));
});
test('a saved parking-bay blockage identifies and safely yields an idle worker in the shed entrance', () => {
  let s = S.createState();
  s.creative = true;
  assert.equal(S.plan(s, 'shed', 36, 35).error, '');
  s.creative = false;
  const e = seedHandlingResources(s, 'excavator'),
    worker = s.workers[1];
  assert.equal(setEquipmentParking(s, e.id, 40, 38, 0), '');
  worker.x = 40;
  worker.z = 38;
  worker.duty = 'manual';
  const eid = e.id,
    wid = worker.id;
  tickUntil(s, () => warningFor(s, eid, wid), 180);
  assert.equal(worker.x, 40);
  assert.equal(worker.z, 38);
  assert.ok(e.parkingReason?.includes(wid));
  s = S.load(S.save(s));
  assert.equal(S.releaseWorker(s, wid), '');
  tickUntil(s, () => s.equipment.find((e) => e.id === eid)!.parkingState === 'parked', 600);
  const machine = s.equipment.find((e) => e.id === eid)!,
    person = s.workers.find((w) => w.id === wid)!;
  assert.ok(equipmentBoxes(machine).every((box) => !personTouchesBox(person, box, 0.3)));
  assert.equal(machine.x, 40);
  assert.equal(machine.z, 38);
  S.load(S.save(s));
});

test('process assembly yields an idle forklift with its real operator and preserves parking refuge', () => {
  let s = S.createState();
  seedHandlingResources(s, 'excavator');
  s.stacks.push({
    id: 'PUMP-KIT',
    item: 'transferPump',
    qty: 1,
    reserved: 0,
    x: 24,
    z: 32,
    w: 2,
    d: 1,
    source: 'opening',
  });
  for (let x = 40; x < 42; x++) for (let z = 40; z < 42; z++) s.paving[`${x},${z}`] = 'EXISTING';
  assert.equal(S.plan(s, 'transferPump', 40, 40).error, '');
  const spare = seedHandlingResources(s, 'forklift'),
    driver = s.workers.at(-1)!;
  spare.x = 90;
  spare.z = 80;
  driver.x = 89;
  driver.z = 80;
  let j = s.jobs.find((j) => j.kind === 'transferPump')!;
  tickUntil(s, () => j.processAssembly?.phase === 'lower', 1200);
  spare.x = 41;
  spare.z = 41;
  spare.yaw = 0;
  spare.heading = 0;
  spare.parking = { x: 41, z: 41, rotation: 0 };
  spare.parkingState = 'parked';
  spare.operator = driver.id;
  driver.vehicle = spare.id;
  driver.x = 41;
  driver.z = 41;
  driver.duty = 'manual';
  driver.path = [];
  const jid = j.id,
    eid = spare.id,
    wid = driver.id,
    origin = { x: 41, z: 41 };
  tickUntil(s, () => warningFor(s, jid, eid), 120);
  s = S.load(S.save(s));
  j = s.jobs.find((j) => j.id === jid)!;
  assert.equal(S.releaseWorker(s, wid), '');
  let previous = origin,
    moved = false;
  tickUntil(
    s,
    () => j.status === 'done',
    1200,
    () => {
      const e = s.equipment.find((e) => e.id === eid)!;
      assert.ok(
        Math.hypot(e.x - previous.x, e.z - previous.z) < 0.5,
        'Yield uses physical driving',
      );
      moved ||= Math.hypot(e.x - origin.x, e.z - origin.z) > 2;
      previous = { x: e.x, z: e.z };
    },
  );
  assert.ok(moved);
  assert.equal(s.buildings.filter((b) => b.kind === 'transferPump').length, 1);
  assert.ok(
    s.notices
      .filter((n) => n.entity === jid && n.severity === 'warning')
      .every((n) => n.state === 'done'),
  );
  S.load(S.save(s));
});
