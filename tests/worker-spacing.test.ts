import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Sim from '../src/sim.ts';
import { dist } from '../src/path.ts';
import { workerStepBlockedByWorker } from '../src/traffic.ts';
import type { State, Worker } from '../src/types.ts';

function worker(s: State, x: number, z: number): Worker {
  const w: Worker = {
    id: Sim.id(s, 'worker'), name: `Worker #${s.workers.length + 1}`,
    role: 'builder', duty: 'auto', status: 'Available', hours: 0, wage: 28,
    x, z, y: 0, yaw: 0, heading: 0, path: [],
  };
  s.workers.push(w);
  return w;
}

test('workers walking across the same yard route keep pedestrian clearance', () => {
  const s = Sim.createState();
  const a = worker(s, 20, 30), b = worker(s, 30, 30);
  a.path = [{ x: 30, z: 30 }];
  b.path = [{ x: 20, z: 30 }];
  assert.equal(workerStepBlockedByWorker(s, a, { x: 20.2, z: 30 }), '');
  for (let i = 0; i < 160; i++) {
    Sim.tick(s, 0.1);
    assert.ok(dist(a, b) >= 0.72 - 1e-5, `Workers overlap at ${s.elapsed.toFixed(1)} s`);
  }
  assert.ok(a.x > 24 && b.x < 26, 'Both workers make progress through the crossing');
});

test('idle workers imported on the same spot walk apart instead of remaining merged', () => {
  const s = Sim.createState();
  const a = worker(s, 20, 30), b = worker(s, 20, 30);
  for (let i = 0; i < 40; i++) Sim.tick(s, 0.1);
  assert.ok(dist(a, b) >= 0.72, 'At least one worker physically steps to free ground');
  assert.equal(a.vehicle, undefined);
  assert.equal(b.vehicle, undefined);
});
