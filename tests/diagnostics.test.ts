import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticRecorder } from '../src/diagnostics';
import { createState } from '../src/sim';

test('rolling diagnostics are bounded, exported with checkpoints, and never mutate the yard', () => {
  const s = createState(),
    original = JSON.stringify(s),
    r = new DiagnosticRecorder(12, 4000);
  for (let i = 0; i < 50; i++) r.observe(s, 1000 + i * 501);
  assert.equal(JSON.stringify(s), original);
  assert.ok(r.entries.length <= 12);
  assert.ok(r.size <= 4000);
  assert.ok(r.dropped > 0);
  const a = r.archive(s);
  assert.equal(a.format, 'plant01-diagnostics');
  assert.deepEqual(a.current, s);
  assert.ok(a.checkpoints.length > 0);
  a.current.name = 'independent export';
  assert.equal(s.name, 'Plant 01');
  const restored = new DiagnosticRecorder(12, 4000);
  restored.restore(a);
  assert.ok(restored.entries.length <= 12);
  assert.ok(restored.size <= 4000);
  assert.equal(restored.dropped, r.dropped);
});

test('records phase transitions with assigned actors, cargo state and blocker', () => {
  const s = createState(),
    r = new DiagnosticRecorder();
  s.jobs.push({
    id: 'JOB-1234',
    kind: 'rail',
    x: 0,
    z: 0,
    w: 5,
    d: 2,
    rotation: 0,
    qty: 1,
    status: 'doing',
    phase: 'Approach reserved rail panel in stock',
    reason: 'Waiting for EQ-4',
    progress: 0,
    delivered: false,
    elapsed: 0,
    created: 0,
    equipment: 'EQ-2',
    worker: 'WRK-3',
  });
  r.observe(s, 1000);
  s.jobs[0].phase = 'Rig rail panel';
  r.observe(s, 1100);
  const transitions = r.entries.filter((e) => e.type === 'transition');
  assert.equal(transitions.length, 2);
  assert.equal((transitions[0].data as any).equipment, 'EQ-2');
  assert.equal((transitions[1].data as any).phase, 'Rig rail panel');
});

test('fast-forward keeps simulation movement detail while the rolling size stays bounded', () => {
  const s = createState(),
    r = new DiagnosticRecorder(20, 10000);
  s.equipment.push({
    id: 'EQ-1',
    kind: 'forklift',
    x: 10,
    z: 30,
    heading: 0,
    path: [{ x: 20, z: 30 }],
    fuel: 40,
    tank: 40,
    used: 0,
    work: 0,
  });
  for (let i = 0; i < 10; i++) {
    s.elapsed = i * 0.1;
    s.equipment[0].yaw = i * 0.15;
    r.observe(s, 1000 + i * 10);
  }
  assert.equal(r.entries.filter((e) => e.type === 'positions').length, 5);
  assert(r.size <= 10000);
});
