import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, load, plan, save, tick } from '../src/sim';
import { reconcileBlockedWorkWarnings } from '../src/logistics-warnings';
import type { Job } from '../src/types';

test('a persistent material blockage creates one warning, updates it, and resolves after progress', () => {
  const s = createState();
  const j: Job = {
    id: 'JOB-TEST', kind: 'lamp', x: 40, z: 40, w: 1, d: 1, rotation: 0,
    qty: 1, status: 'todo', phase: 'Waiting', reason: 'Need 1 × concrete slab',
    progress: 0, delivered: false, elapsed: 0, created: s.time,
  };
  s.jobs.push(j);
  const sync = () => reconcileBlockedWorkWarnings(s, () => `N-${String(s.next++).padStart(4, '0')}`);
  sync();
  s.elapsed = 19;
  sync();
  assert.equal(s.notices.length, 0);
  s.elapsed = 20;
  sync();
  assert.equal(s.notices.length, 1);
  assert.equal(s.notices[0].severity, 'warning');
  assert.equal(s.notices[0].entity, j.id);
  s.elapsed = 80;
  sync();
  assert.equal(s.notices.length, 1, 'A persistent cause does not generate repeated popups');
  s.notices[0].state = 'done';
  s.elapsed = 100;
  sync();
  assert.equal(s.notices.length, 1, 'Manually completed warning stays quiet until the cause changes');
  s.notices[0].state = 'todo';
  s.notices[0].seen = true;
  j.reason = 'Need 1 × cable reel';
  sync();
  assert.equal(s.notices.length, 1);
  assert.match(s.notices[0].detail, /cable reel/);
  assert.equal(s.notices[0].seen, true, 'An updated reason does not repeatedly pop up after being read');
  const loaded = load(save(s));
  assert.equal(loaded.jobs[0].logisticsNoticeId, loaded.notices[0].id);
  loaded.jobs[0].reason = '';
  reconcileBlockedWorkWarnings(loaded, () => 'N-UNUSED');
  assert.equal(loaded.notices[0].state, 'done');
});

test('sibling paving jobs with the same missing supply produce one warning', () => {
  const s = createState();
  s.jobGroups = [{ id: 'WORK-TEST', label: 'Pave yard', x: 40, z: 40,
    w: 2, d: 1, created: s.time }];
  for (let i = 0; i < 2; i++) s.jobs.push({
    id: `JOB-${i}`, kind: 'slab', item: 'slab', x: 40 + i, z: 40,
    w: 1, d: 1, rotation: 0, qty: 1, status: 'todo', phase: 'Waiting',
    reason: 'Need 1 × concrete slab', progress: 0, delivered: false,
    elapsed: 0, created: s.time, parentId: 'WORK-TEST',
  });
  reconcileBlockedWorkWarnings(s, () => `N-${s.next++}`);
  s.elapsed = 21;
  reconcileBlockedWorkWarnings(s, () => `N-${s.next++}`);
  assert.equal(s.notices.length, 1);
});

test('a planned light with no slabs shows the missing supply, not a duplicate foundation wait', () => {
  const s = createState();
  assert.equal(plan(s, 'lamp', 32, 32).error, '');
  for (let i = 0; i < 240; i++) tick(s, 0.1);
  const warnings = s.notices.filter((n) => n.title === 'Work blocked' && n.state !== 'done');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].detail, /concrete slab/i);
  assert.equal(warnings[0].severity, 'warning');
});
