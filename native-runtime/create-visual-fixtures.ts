/** Deterministic native visual QA saves produced by actual procurement, work plans,
 * crew boarding, transport, lifting and construction ticks. No invented work phases. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { setEquipmentAssistant } from '../src/work-crews';
import { requestRailUnloading } from '../src/rail-freight';
import { renderState } from './render';
import type { State } from '../src/types';
import { requestLowFuelService } from '../tests/support/yard';
const directory = path.resolve(import.meta.dirname, '../native/tests/fixtures');
fs.mkdirSync(directory, { recursive: true });
const records: any[] = [];
let ticks = 0;
function advance(s: State, predicate: () => boolean, seconds = 2400, inspect?: () => void) {
  for (let n = 0; n < Math.ceil(seconds / 0.1); n++) {
    if (predicate()) return;
    // QA represents the player explicitly starting each received rail train.
    for (const order of s.orders)
      if (order.railFreight && order.status === 'unloading' && !order.railFreight.unloadRequested)
        assert.equal(requestRailUnloading(s, order.id), undefined);
    S.tick(s, 0.1);
    ticks++;
    inspect?.();
  }
  if (!predicate()) {
    fs.writeFileSync(path.join(directory, 'debug-timeout.json'), S.save(s));
    throw new Error(
      JSON.stringify({
        reason: 'fixture timeout',
        jobs: s.jobs
          .filter((j) => !['done', 'canceled'].includes(j.status))
          .map((j) => ({ id: j.id, phase: j.phase, reason: j.reason })),
        orders: s.orders
          .filter((o) => o.status !== 'done')
          .map((o) => ({
            id: o.id,
            status: o.status,
            note: o.note,
            deployment: o.deployment,
            unload: o.unload?.phase,
          })),
        machines: s.equipment.map((e) => ({
          id: e.id,
          fuel: e.fuel,
          blockedBy: e.blockedBy,
          path: e.path.length,
          x: e.x,
          z: e.z,
        })),
      }),
    );
  }
}
function capture(name: string, s: State, focus: { x: number; z: number }, description: string) {
  const paused = { ...s, paused: true };
  const json = S.save(paused);
  const loaded = S.load(json); // Exercise the same loader as native import before delivery.
  const render = renderState(loaded);
  const file = path.join(directory, `${name}.json`);
  fs.writeFileSync(file, json);
  records.push({
    name,
    file: path.relative(path.dirname(directory), file),
    bytes: Buffer.byteLength(json),
    elapsed: s.elapsed,
    focus: { x: focus.x, z: focus.z },
    description,
    counts: {
      workers: s.workers.length,
      equipment: s.equipment.length,
      stacks: s.stacks.filter((t) => t.qty > 0).length,
      jobs: s.jobs.length,
    },
    activePhases: s.jobs
      .filter((j) => j.status === 'doing')
      .map((j) => j.railWork?.phase || j.shedAssembly?.phase || j.handling?.phase || j.phase),
    carriers: render.carriers.map((c) => ({
      id: c.id,
      kind: c.kind,
      status: c.status,
      loads: c.cargo.length,
    })),
    renderLoads: render.loads.length,
  });
  console.log(
    `Saved ${name}: ${records.at(-1).bytes} bytes at ${s.elapsed.toFixed(1)} game seconds.`,
  );
}
function branch(s: State) {
  return S.load(S.save(s));
}
const base = S.createState();
assert.equal(S.addZone(base, { x: 24, z: 26, w: 45, d: 24 }, 'Receiving stockyard'), '');
S.purchaseBatch(
  base,
  [
    { item: 'operator', qty: 2 },
    { item: 'builder', qty: 3 },
    { item: 'excavator', qty: 1 },
    { item: 'forklift', qty: 1 },
  ],
  'road',
);
let rampSaved = false;
advance(
  base,
  () => base.orders.every((o) => o.status === 'done'),
  2400,
  () => {
    if (rampSaved) return;
    const order = base.orders.find((o) => o.item === 'excavator' && o.deployment === 'offload');
    const e = order && base.equipment.find((e) => e.id === order.equipmentId);
    if (e && (e.y || 0) > 0.15 && (e.y || 0) < 0.65 && e.operator) {
      capture(
        'lowloader-ramp',
        base,
        e,
        'Purchased excavator is driven down the delivery ramp by its hired operator.',
      );
      rampSaved = true;
    }
  },
);
assert.ok(rampSaved, 'Observed genuine intermediate ramp descent');
const excavator = base.equipment.find((e) => e.kind === 'excavator')!,
  forklift = base.equipment.find((e) => e.kind === 'forklift')!,
  helper = base.workers.find((w) => w.role === 'builder')!;
assert.equal(setEquipmentAssistant(base, excavator.id, helper.id), '');
S.purchaseBatch(
  base,
  [
    { item: 'slab', qty: 96 },
    { item: 'shed', qty: 1 },
    { item: 'diesel', qty: 2 },
  ],
  'road',
);
S.purchaseBatch(base, [{ item: 'rail', qty: 8 }], 'rail');
let truckSaved = false,
  railSaved = false;
advance(
  base,
  () => base.orders.every((o) => o.status === 'done'),
  4000,
  () => {
    for (const o of base.orders) {
      const u = o.unload;
      if (!u || u.phase !== 'carry' || !u.cargo) continue;
      const e = base.equipment.find((e) => e.id === u.equipmentId);
      if (!e?.cargo) continue;
      if (o.mode === 'road' && !truckSaved && e.cargo.item === 'slab') {
        capture(
          'truck-unloading',
          base,
          e,
          'Owned machine carrying an actual unloaded stack; remaining freight stays on the truck.',
        );
        truckSaved = true;
      }
      if (o.mode === 'rail' && !railSaved) {
        capture(
          'rail-unloading',
          base,
          { x: (o.vehicle.x + e.x) / 2, z: (o.vehicle.z + e.z) / 2 },
          'Line locomotive and coupled wagon at the siding while an owned machine carries an actual panel lift.',
        );
        railSaved = true;
      }
    }
  },
);
assert.ok(truckSaved && railSaved, 'Observed both road and rail material handling');
capture(
  'delivered-stockyard',
  base,
  { x: 36, z: 30 },
  'Procured equipment, hired crew, and physically unloaded material stacks.',
);
// Independent rail branch: real panel collection/staging and real buffer removal.
const railway = branch(base);
assert.equal(S.setEquipmentRole(railway, forklift.id, 'hold'), '');
const planned = S.planRailLayout(railway, 'straight', { x: 125, z: 5 }, 0, 1);
assert.equal(planned.error, '');
let stageSaved = false,
  bufferSaved = false;
advance(
  railway,
  () => planned.jobs.every((j) => j.status === 'done'),
  2400,
  () => {
    const j = planned.jobs[0],
      r = j.railWork;
    if (!r) return;
    if (!stageSaved && r.panel.state === 'carried' && r.phase === 'stage-travel') {
      const e = railway.equipment.find((e) => e.id === j.equipment)!;
      capture(
        'rail-panel-staging',
        railway,
        e,
        'Reserved panel has been rigged, lifted, and is traveling to its actual staging position.',
      );
      stageSaved = true;
    }
    if (
      !bufferSaved &&
      r.buffer?.carried &&
      (r.phase === 'buffer-carry-aside' || r.phase === 'buffer-lift') &&
      r.buffer.y > 0.4
    ) {
      capture(
        'rail-buffer-lift',
        railway,
        { x: r.buffer.x, z: r.buffer.z },
        'Crew has unbolted the real buffer; the excavator lifts it while the prepared panel remains staged.',
      );
      bufferSaved = true;
    }
  },
);
assert.ok(stageSaved && bufferSaved, 'Observed real rail staging and buffer-lift phases');
// Independent building branch: paving precedes unpacking, anchor bolts and erection.
const shed = branch(base);
assert.equal(S.setEquipmentRole(shed, forklift.id, 'hold'), '');
assert.equal(S.pave(shed, { x: 78, z: 32, w: 8, d: 6 }), 48);
advance(
  shed,
  () => shed.jobs.every((j) => j.status === 'done'),
  10000,
  () => requestLowFuelService(shed),
);
const foundation = branch(shed);
const shedJob = S.plan(shed, 'shed', 78, 32).job!;
assert.ok(shedJob);
advance(
  shed,
  () =>
    !!shedJob.shedAssembly &&
    shedJob.shedAssembly.posts === 6 &&
    shedJob.shedAssembly.beams >= 1 &&
    shedJob.shedAssembly.roofSheets < 4 &&
    shedJob.shedAssembly.phase === 'carry',
  2000,
);
capture(
  'shed-partial-erection',
  shed,
  { x: 82, z: 35 },
  'Foundation paved slab by slab; real anchors, six columns and partial frames are erected while the next component is carried.',
);
// Real service request after work has consumed fuel; no direct fuel edit.
const fueling = foundation;
const machine = fueling.equipment.find((e) => e.id === excavator.id)!;
assert.ok(machine.fuel < machine.tank - 1, 'Previous real paving consumed diesel');
assert.equal(S.refuel(fueling, machine.id), '');
advance(
  fueling,
  () =>
    fueling.jobs.some(
      (j) => j.kind === 'refuel' && j.phase === 'Carry fuel' && (j.fuelLiters || 0) > 0,
    ),
  1800,
);
const service = fueling.jobs.find((j) => j.kind === 'refuel' && j.phase === 'Carry fuel')!,
  w = fueling.workers.find((w) => w.id === service.worker)!;
capture(
  'worker-fuel-can',
  fueling,
  { x: w.x, z: w.z },
  'Actual refueling job transfers diesel from a delivered drum into the worker service can, then carries it to parked equipment.',
);
const summary = {
  generatedAt: new Date().toISOString(),
  source: 'native-runtime/create-visual-fixtures.ts',
  step: 0.1,
  simulationTicks: ticks,
  fixtures: records,
};
fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(directory, '../verification-simulation.json'),
  JSON.stringify({ ok: true, ...summary }, null, 2),
);
console.log(
  `Validated ${records.length} fixture imports from ${ticks} actual fixed simulation ticks.`,
);
