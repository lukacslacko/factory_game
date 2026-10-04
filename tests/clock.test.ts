import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Sim from '../src/sim.ts';
import { clock } from '../src/catalog.ts';
import { seedHandlingResources } from './support/yard.ts';

test('calendar, attendance, and wages use the same seconds as physical operations', () => {
  const s = Sim.createState();
  seedHandlingResources(s);
  const start = s.time;
  Sim.tick(s, 899);
  assert.equal(s.time - start, 899);
  assert.equal(s.elapsed, 899);
  assert.ok(Math.abs(s.workers[0].hours - 899 / 3600) < 1e-10);
  assert.equal(s.costs.filter((c) => c.category === 'Labor').length, 0);
  Sim.tick(s, 1);
  assert.equal(s.time - start, 900);
  assert.equal(s.workers[0].hours, 0.25);
  const wages = s.costs.filter((c) => c.category === 'Labor');
  assert.equal(wages.length, s.workers.length);
  assert.equal(wages[0].amount, s.workers[0].wage / 4);
  assert.match(wages[0].description, /15 min/);
});

test('pause freezes every clock and resuming a save preserves calendar history', () => {
  const s = Sim.createState();
  Sim.tick(s, 12.5);
  s.paused = true;
  Sim.tick(s, 20);
  assert.equal(s.elapsed, 12.5);
  const restored = Sim.load(Sim.save(s));
  const before = restored.time;
  restored.paused = false;
  Sim.tick(restored, 1);
  assert.equal(restored.time, before + 1);
  assert.equal(restored.elapsed, 13.5);
});

test('supplier ETA is a three-minute real-time lead, and seconds display wraps at midnight', () => {
  const s = Sim.createState();
  Sim.purchase(s, 'slab', 1);
  assert.equal(s.orders[0].eta - s.time, 180);
  assert.equal(clock(7 * 3600 + 8 * 60 + 9, true), '07:08:09');
  assert.equal(clock(86400 + 2, true), '00:00:02');
  assert.equal(clock(7 * 3600 + 8 * 60 + 9), '07:08');
});
