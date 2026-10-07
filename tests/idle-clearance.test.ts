import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources, tickUntil } from './support/yard';
import { equipmentSweepBlocked, workerMoveBlocked } from '../src/traffic';
import { workerAvailable } from '../src/workforce';
import { dist } from '../src/path';

function fixture() {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  s.elapsed = 100;
  s.time += 100;
  const operator = s.workers.find((w) => w.role === 'operator')!;
  const worker = s.workers.find((w) => w.role === 'builder')!;
  Object.assign(e, {
    x: 36,
    z: 39.5,
    yaw: 0,
    reach: 3.52,
    lift: 1.1,
    operator: operator.id,
    blockedBy: worker.id,
    trafficWait: 0,
    trafficBlockedSince: s.elapsed - 30,
    trafficBlockedNotice: true,
  });
  Object.assign(operator, { x: e.x, z: e.z, yaw: 0, vehicle: e.id, status: 'Available in cab' });
  Object.assign(worker, { x: 40.914, z: 42.914, yieldingTo: e.id, status: 'Available', path: [] });
  s.notices.push({
    id: S.id(s, 'notice'),
    time: s.time,
    title: 'Equipment movement blocked',
    detail: `${e.id} waits for ${worker.id}`,
    entity: e.id,
    state: 'todo',
    seen: false,
    severity: 'warning',
  });
  return { s, e, worker, operator };
}

test('an idle saved machine releases a completed pedestrian escape and obsolete warning without moving either actor', () => {
  const f = fixture();
  const s = S.load(S.save(f.s)),
    e = s.equipment[0],
    worker = s.workers.find((w) => w.id === f.worker.id)!;
  const poses = [e, worker].map((p) => ({ x: p.x, z: p.z, yaw: p.yaw }));
  assert.equal(workerAvailable(s, worker), false);
  S.tick(s, 0.1);
  assert.equal(e.blockedBy, undefined, 'A historical collision is not an idle movement request');
  assert.equal(
    worker.yieldingTo,
    undefined,
    'An already clear pedestrian is available for later work',
  );
  assert.equal(workerAvailable(s, worker), true);
  assert.equal(s.notices.find((n) => n.title === 'Equipment movement blocked')!.state, 'done');
  assert.deepEqual(
    [e, worker].map((p) => ({ x: p.x, z: p.z, yaw: p.yaw })),
    poses,
    'No actor is teleported or turned',
  );
  assert.equal(e.trafficBlockedSince, undefined);
  assert.equal(e.trafficBlockedNotice, undefined);
});

test('a completed idle escape cannot reserve the only builder away from the next real paving job', () => {
  const { s, e, worker } = fixture();
  s.stacks.push({
    id: S.id(s, 'stack'),
    item: 'slab',
    x: 48,
    z: 49,
    w: 1,
    d: 1,
    qty: 1,
    reserved: 0,
    source: 'opening',
  });
  const jobs = S.pave(s, { x: 42, z: 51, w: 1, d: 1 });
  assert.equal(jobs, 1);
  tickUntil(s, () => s.jobs.some((j) => j.kind === 'slab' && j.status === 'done'), 180);
  assert.equal(worker.yieldingTo, undefined);
  assert.equal(e.cargo, undefined);
  assert.ok(s.paving['42,51']);
  assert.equal(
    s.movements
      .filter((m) => m.item === 'slab' && m.reason === 'Installed')
      .reduce((n, m) => n + m.qty, 0),
    1,
  );
});

test('active driving still asks the actual pedestrian to yield and checks every movement sweep', () => {
  const { s, e, worker } = fixture();
  Object.assign(worker, { x: 39.8, z: 39.5, yieldingTo: undefined });
  e.path = [{ x: 46, z: 39.5 }];
  let walked = false;
  for (let n = 0; n < 600 && e.path.length; n++) {
    const oldMachine = { ...e, path: e.path.slice() },
      oldWorker = { ...worker, path: worker.path.slice() };
    S.tick(s, 0.1);
    assert.ok(dist(oldMachine, e) <= 0.32);
    assert.ok(dist(oldWorker, worker) <= 0.171);
    if (dist(oldMachine, e) > 1e-7) assert.equal(equipmentSweepBlocked(s, oldMachine, e), '');
    if (dist(oldWorker, worker) > 1e-7) {
      walked = true;
      assert.equal(workerMoveBlocked(s, oldWorker, worker), '');
    }
  }
  assert.ok(walked, 'The worker physically walks out of the approaching machine corridor');
  assert.equal(e.path.length, 0);
  assert.ok(dist(e, { x: 46, z: 39.5 }) < 0.1);
  S.tick(s, 0.1);
  assert.equal(e.blockedBy, undefined);
  assert.equal(worker.yieldingTo, undefined);
});
