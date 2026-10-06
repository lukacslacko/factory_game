import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { bufferAssets } from '../src/buffers.ts';
import { staticObstacleRects } from '../src/traffic.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';

function yard() {
  const s = S.createState();
  const e = seedHandlingResources(s, 'excavator');
  Object.assign(e, { x: 120, z: 18 });
  s.workers.forEach((w, i) => Object.assign(w, { x: 120 + i * 2, z: 23 }));
  S.addZone(s, { x: 128, z: 22, w: 12, d: 12 });
  return s;
}
test('buffers are physical independently colliding assets and an open endpoint rejects duplicate plans', () => {
  const s = yard();
  assert.equal(
    S.planBufferStop(s, { x: 125, z: 5 }).error,
    'This endpoint already has a buffer stop.',
  );
  assert.ok(S.planBufferStop(s, { x: 126, z: 5 }).error);
  s.buffers = [
    ...bufferAssets(s),
    { id: 'BUFFER-SECOND', x: 130, z: 10, y: 0.2, yaw: Math.PI / 2, secured: true, carried: false },
  ];
  assert.deepEqual(
    staticObstacleRects(s)
      .filter((r) => r.id.startsWith('BUFFER'))
      .map((r) => r.id)
      .sort(),
    ['BUFFER-001', 'BUFFER-SECOND'],
  );
  const roundtrip = S.load(S.save(s));
  assert.equal(roundtrip.buffers?.length, 2);
});
test('a worker unfastens and rigs a buffer, a machine stores it, and the same purchased asset can be reinstalled', () => {
  const s = yard();
  assert.equal(S.removeBufferStop(s, 'BUFFER-001'), '');
  const recovery = s.jobs.at(-1)!;
  let lifted = false,
    carried = false,
    lowered = false;
  tickUntil(
    s,
    () => recovery.status === 'done',
    1600,
    () => {
      const h = recovery.handling;
      if (!h) return;
      if (h.phase === 'lift') {
        lifted = true;
        assert.equal(bufferAssets(s).length, 0);
      }
      if (h.phase === 'carry') carried = true;
      if (h.phase === 'settle') lowered = true;
      S.load(S.save(s));
    },
  );
  assert.ok(lifted && carried && lowered);
  const stored = s.stacks.find((t) => t.item === 'bufferStop' && t.qty)!;
  assert.equal(stored.assetId, 'BUFFER-001');
  assert.equal(stored.reserved, 0);
  assert.equal(bufferAssets(s).length, 0);
  const planned = S.planBufferStop(s, { x: 125, z: 5 });
  assert.equal(planned.error, '');
  assert.ok(S.planBufferStop(s, { x: 125, z: 5 }).error);
  tickUntil(
    s,
    () => planned.job!.status === 'done',
    1600,
    () => S.load(S.save(s)),
  );
  const b = bufferAssets(s).find((b) => b.id === 'BUFFER-001')!;
  assert.ok(b.secured);
  assert.equal(b.x, 125);
  assert.equal(b.z, 5);
  assert.equal(
    s.stacks.filter((t) => t.item === 'bufferStop').reduce((n, t) => n + t.qty, 0),
    0,
  );
});

test('a purchased stop is delivered, installed on an uncapped branch, and stays conserved while its branch extends', async () => {
  const { trackGeometry } = await import('../src/track.ts');
  const s = yard();
  const turnout = S.planRailLayout(s, 'turnout', { x: 125, z: 5 });
  assert.equal(turnout.error, '');
  for (const j of turnout.jobs) {
    const g = trackGeometry(j);
    s.rails.push({
      id: S.id(s, 'rail'),
      ...g.rect,
      length: g.length,
      rotation: j.rotation,
      item: j.item,
      track: j.track,
    });
    j.status = 'done';
    j.delivered = true;
  }
  s.buffer = { x: 145, z: 5 };
  s.zones = [];
  S.addZone(s, { x: 132, z: 28, w: 18, d: 12 });
  const orderId = S.purchase(s, 'bufferStop', 1, 'road')[0];
  tickUntil(s, () => s.orders.find((o) => o.id === orderId)?.status === 'done', 2000);
  const plan = S.planBufferStop(s, { x: 145, z: 10 });
  assert.equal(plan.error, '');
  const balanced = () => {
    const t = S.totals(s, 'bufferStop');
    assert.equal(t.delivered + t.recovered, t.stored + t.cargo + t.installed, JSON.stringify(t));
  };
  tickUntil(s, () => plan.job!.status === 'done', 2000, balanced);
  const installed = bufferAssets(s).find((b) => b.id !== 'BUFFER-001')!;
  assert.ok(installed.id);
  s.stacks.push({
    id: S.id(s, 'stack'),
    item: 'rail',
    qty: 1,
    reserved: 0,
    source: 'opening',
    x: 155,
    z: 32,
    w: 5,
    d: 3,
  });
  const extension = S.planRailLayout(s, 'straight', { x: 145, z: 10 });
  assert.equal(extension.error, '');
  let carried = false;
  tickUntil(
    s,
    () => extension.jobs[0].status === 'done',
    2500,
    () => {
      balanced();
      S.load(S.save(s));
      if (extension.jobs[0].railWork?.buffer?.carried) carried = true;
    },
  );
  assert.ok(carried);
  const moved = bufferAssets(s).find((b) => b.id === installed.id)!;
  assert.equal(moved.x, 150);
  assert.equal(moved.z, 10);
  assert.ok(moved.secured);
});

test('canceling buffer recovery retains its physical stop and permits later reinstallation', () => {
  const s = yard();
  S.removeBufferStop(s, 'BUFFER-001');
  const j = s.jobs.at(-1)!;
  tickUntil(s, () => j.handling?.phase === 'carry', 1600);
  S.cancelJob(s, j.id);
  tickUntil(
    s,
    () => j.status === 'canceled',
    1600,
    () => S.load(S.save(s)),
  );
  const stack = s.stacks.find((t) => t.item === 'bufferStop' && t.qty > 0)!;
  assert.equal(stack.assetId, 'BUFFER-001');
  assert.equal(stack.reserved, 0);
  const t = S.totals(s, 'bufferStop');
  assert.equal(t.recovered, 1);
  assert.equal(t.stored, 1);
  const install = S.planBufferStop(s, { x: 125, z: 5 }).job!;
  tickUntil(s, () => install.handling?.phase === 'carry', 1600);
  S.cancelJob(s, install.id);
  tickUntil(
    s,
    () => install.status === 'canceled',
    1600,
    () => S.load(S.save(s)),
  );
  assert.equal(bufferAssets(s).length, 0);
  assert.equal(
    s.stacks.filter((t) => t.item === 'bufferStop').reduce((n, t) => n + t.qty, 0),
    1,
  );
});
