import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources, tickUntil } from './support/yard';

function driven() {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  const op = s.workers.find((w) => w.role === 'operator')!;
  e.operator = op.id;
  op.vehicle = e.id;
  op.x = e.x;
  op.z = e.z;
  assert.equal(S.moveWorker(s, op.id, { x: 20, z: 45 }), '');
  return { s, e, op };
}

test('release stops an idle manual drive, preserves cab ownership, and makes the same machine available for queued work', () => {
  const { s, e, op } = driven();
  assert.equal(op.duty, 'manual');
  assert(e.path.length);
  e.trafficGoal = { x: 20, z: 45 };
  e.trafficReverse = true;
  const position = { x: e.x, z: e.z };
  assert.equal(S.releaseWorker(s, op.id), '');
  assert.equal(op.duty, 'auto');
  assert.equal(e.path.length, 0);
  assert.equal(e.trafficGoal, undefined);
  assert.equal(e.trafficReverse, undefined);
  assert.equal(e.operator, op.id);
  assert.equal(op.vehicle, e.id);
  assert.deepEqual({ x: e.x, z: e.z }, position);
  s.stacks.push({
    id: S.id(s, 'stack'),
    x: 25,
    z: 30,
    w: 1,
    d: 1,
    item: 'slab',
    qty: 1,
    reserved: 0,
    source: 'opening',
  });
  const job = S.plan(s, 'slab', 38, 36).job!;
  tickUntil(s, () => job.status === 'done', 500);
  assert.equal(S.totals(s, 'slab').installed, 1);
  assert.equal(s.events.filter((v) => v.type === 'Control').length, 1);
});

test('returning to automatic preserves an active physical work assignment and supported cargo', () => {
  const { s, e, op } = driven();
  const job = S.plan(s, 'rail', 125, 4).job!;
  e.job = job.id;
  op.job = job.id;
  e.cargo = { item: 'rail', qty: 1, yaw: 0 };
  const path = e.path,
    cargo = e.cargo;
  assert.equal(S.releaseWorker(s, op.id), '');
  assert.equal(op.duty, 'auto');
  assert.equal(e.job, job.id);
  assert.equal(e.path, path);
  assert.equal(e.cargo, cargo);
});

test('an off-shift manual operator can release control without becoming eligible for off-shift work', () => {
  const { s, e, op } = driven();
  op.schedule = { start: 12, end: 13 };
  assert.equal(S.releaseWorker(s, op.id), '');
  assert.equal(op.duty, 'auto');
  assert.equal(e.path.length, 0);
  assert.equal(op.schedule.start, 12);
  S.load(S.save(s));
});
