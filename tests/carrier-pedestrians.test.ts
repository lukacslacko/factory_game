import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { sampleRoad, roadLength, roadExitLength } from '../src/motion.ts';
import { carrierBoxes, personTouchesBox } from '../src/traffic.ts';
import { seedHandlingResources, tickUntil, advance } from './support/yard.ts';
import { dist } from '../src/path.ts';
import type { State } from '../src/types.ts';
function fixture() {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 12, d: 12 });
  seedHandlingResources(s);
  const [id] = S.purchase(s, 'slab', 8);
  tickUntil(s, () => {
    const o = s.orders.find((o) => o.id === id);
    return o?.status === 'departing' && !o.unload;
  });
  const o = s.orders.find((o) => o.id === id)!,
    p = sampleRoad(o, o.drive!.distance + 12);
  const w = {
    ...s.workers[0],
    id: S.id(s, 'worker'),
    name: 'Worker #2',
    role: 'builder' as const,
    x: p.x,
    z: p.z,
    path: [],
    vehicle: undefined,
    job: undefined,
    deliveryOrder: undefined,
    transportOrder: undefined,
    y: 0,
  };
  s.workers.push(w);
  return { s, id, wid: w.id, initial: { x: w.x, z: w.z } };
}
function checkSafety(s: State, wid: string) {
  const w = s.workers.find((w) => w.id === wid)!;
  for (const o of s.orders.filter((o) => o.status !== 'ordered' && o.status !== 'done'))
    assert.ok(
      !carrierBoxes(o).some((b) => personTouchesBox(w, b, 0.3)),
      `${o.id} drives through ${wid}`,
    );
}
test('departing freight stops for an automatic worker who walks aside and returns after save/resume', () => {
  const f = fixture();
  let s = f.s,
    w = s.workers.find((w) => w.id === f.wid)!;
  tickUntil(
    s,
    () => w.yieldingTo === f.id && w.path.length > 0,
    120,
    () => checkSafety(s, f.wid),
  );
  assert.ok(dist(w, f.initial) < 1, 'Traffic clearance starts without teleportation');
  s = S.load(S.save(s));
  w = s.workers.find((w) => w.id === f.wid)!;
  let moved = 0,
    previous = { x: w.x, z: w.z };
  tickUntil(
    s,
    () => s.orders.find((o) => o.id === f.id)?.status === 'done' && !w.yieldingTo && !w.path.length,
    180,
    () => {
      const step = dist(w, previous);
      assert.ok(step < 0.18, 'Worker walks at ground speed');
      moved += step;
      previous = { x: w.x, z: w.z };
      checkSafety(s, f.wid);
    },
  );
  assert.ok(moved > 5, 'Worker actually walks away and back');
  assert.ok(dist(w, f.initial) < 0.1);
  assert.equal(s.costs.filter((c) => c.entity === f.id).length, 1);
  assert.equal(S.totals(s, 'slab').delivered, 8);
  assert.equal(s.events.filter((e) => e.type === 'Traffic' && e.entity === f.wid).length, 1);
});
test('a manual worker blocks a departing truck until the player walks them clear', () => {
  const { s, id, wid, initial } = fixture(),
    w = s.workers.find((w) => w.id === wid)!;
  w.duty = 'manual';
  advance(s, 60);
  assert.equal(s.orders.find((o) => o.id === id)?.status, 'departing');
  assert.ok(dist(w, initial) < 1e-8);
  assert.equal(w.yieldingTo, undefined);
  checkSafety(s, wid);
  const targets = [
    { x: w.x, z: w.z + 5 },
    { x: w.x, z: w.z - 5 },
    { x: w.x + 5, z: w.z },
    { x: w.x - 5, z: w.z },
    { x: w.x, z: w.z + 8 },
    { x: w.x, z: w.z - 8 },
    { x: w.x + 8, z: w.z },
    { x: w.x - 8, z: w.z },
  ];
  const truck = s.orders.find((o) => o.id === id)!;
  assert.ok(
    targets.some((p) => {
      for (let at = truck.drive!.distance; at < roadExitLength(truck); at += 0.5)
        if (carrierBoxes(truck, sampleRoad(truck, at)).some((b) => personTouchesBox(p, b, 0.8)))
          return false;
      return S.moveWorker(s, wid, p) === '';
    }),
    'The player can choose a clear walking cell outside the remaining truck route',
  );
  tickUntil(
    s,
    () => s.orders.find((o) => o.id === id)?.status === 'done',
    180,
    () => checkSafety(s, wid),
  );
});
test('a worker carrying a real refueling can pauses their task, clears a truck, and resumes after returning', () => {
  let { s, id, wid } = fixture();
  let w = s.workers.find((w) => w.id === wid)!,
    e = s.equipment[0];
  e.fuel = 10;
  const drum = {
    id: S.id(s, 'stack'),
    item: 'diesel' as const,
    qty: 1,
    reserved: 0,
    liters: 180,
    source: 'opening',
    x: 30,
    z: 30,
    w: 1,
    d: 1,
  };
  s.stacks.push(drum);
  assert.equal(S.refuel(s, e.id), '');
  const j = s.jobs.find((j) => j.kind === 'refuel')!;
  // Focused physical-state fixture: the worker has already collected a 20 L can.
  Object.assign(j, {
    status: 'doing',
    phase: 'Carry fuel',
    worker: wid,
    equipment: e.id,
    stack: drum.id,
    fuelLiters: 20,
    elapsed: 0,
  });
  w.job = j.id;
  w.status = 'Carrying 20 L service can';
  e.job = j.id;
  e.refueling = j.id;
  const resumedJob = j.id;
  // Put the already-departing truck at its imminent checked encounter. A real
  // carried can now returns to the filler, rather than pouring remotely while
  // standing idle in the lane for six seconds.
  const carrier=s.orders.find(o=>o.id===id)!;
  carrier.drive!.distance+=6;
  const nearby=sampleRoad(carrier,carrier.drive!.distance);
  carrier.vehicle={x:nearby.x,z:nearby.z};carrier.drive!.yaw=nearby.yaw;
  checkSafety(s,wid);
  tickUntil(
    s,
    () => w.yieldingTo === id,
    120,
    () => checkSafety(s, wid),
  );
  const paused = s.jobs.find((j) => j.id === resumedJob)!;
  assert.equal(paused.fuelLiters, 20, 'Safety walk keeps the actual fuel can');
  const before = paused.elapsed,
    tank = e.fuel;
  s = S.load(S.save(s));
  w = s.workers.find((w) => w.id === wid)!;
  tickUntil(
    s,
    () => s.orders.find((o) => o.id === id)?.status === 'done',
    180,
    () => {
      checkSafety(s, wid);
      assert.equal(
        s.jobs.find((j) => j.id === resumedJob)!.elapsed,
        before,
        'Refueling cannot run while worker is clearing traffic',
      );
      assert.equal(s.equipment[0].fuel, tank);
    },
  );
  tickUntil(s, () => s.jobs.find((j) => j.id === resumedJob)?.status === 'done', 120);
  assert.equal(s.equipment[0].fuel, s.equipment[0].tank);
  assert.ok(
    s.events.some(
      (e) =>
        e.type === 'Fuel' &&
        e.entity === s.equipment[0].id &&
        e.text.startsWith('Transferred 20.0'),
    ),
  );
  assert.equal(s.jobs.find((j) => j.id === resumedJob)!.fuelLiters, 0);
  assert.equal(s.workers.find((w) => w.id === wid)!.job, undefined);
  assert.ok(!w.yieldingTo);
});
