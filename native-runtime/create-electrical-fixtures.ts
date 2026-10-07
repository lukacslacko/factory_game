/** Opening site assets are explicit; all cable construction is advanced by real Sim.tick. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources, stateSummary } from '../tests/support/yard';
import { MATERIALS, EQUIPMENT, BUILDINGS, ROLES, SERVICES } from '../src/catalog';
import { renderState } from './render';
const directory = path.resolve(import.meta.dirname, '../native/tests/fixtures');
fs.mkdirSync(directory, { recursive: true });
const s = S.createState();
const machine = seedHandlingResources(s, 'excavator');
machine.x = 27.5;
machine.z = 35.5;
s.workers[0].x = 22.5;
s.workers[0].z = 35.5;
s.workers[1].role = 'engineer';
s.workers[1].wage = ROLES.engineer.wage;
s.workers[1].x = 22.5;
s.workers[1].z = 38.5;
const source = {
  id: S.id(s, 'building'),
  kind: 'power' as const,
  x: 30,
  z: 30,
  w: 1,
  d: 1,
  rotation: 0,
  connected: true,
  source: 'opening',
  name: 'Incoming station · 16 kW',
};
const lamp = {
  id: S.id(s, 'building'),
  kind: 'lamp' as const,
  x: 36,
  z: 30,
  w: 1,
  d: 1,
  rotation: 0,
  connected: false,
  source: 'opening',
  name: 'First yard light',
};
s.buildings.push(source, lamp);
s.utilities.power = true;
s.stacks.push({
  id: S.id(s, 'stack'),
  item: 'cableReel',
  qty: 1,
  reserved: 0,
  cableMeters: 50,
  x: 24,
  z: 40,
  w: 1,
  d: 1,
  source: 'opening',
});
const cells = Array.from({ length: 5 }, (_, i) => ({ x: 31 + i, z: 30 }));
const planned = S.planElectrical(s, { sourceId: source.id, targetId: lamp.id, cells });
assert.equal(planned.error, undefined);
const shots: any[] = [];
const startedAt = Date.now();
const captured = new Set<string>();
function capture(name: string) {
  const state = structuredClone(s);
  state.paused = true;
  S.load(S.save(state));
  const run = state.electrical!.runs[0];
  const record = {
    state,
    render: renderState(state),
    catalog: {
      materials: MATERIALS,
      equipment: EQUIPMENT,
      buildings: BUILDINGS,
      roles: ROLES,
      services: SERVICES,
    },
    storage: { started: true, hasSave: true },
    inventory: Object.keys(MATERIALS).map((item) => ({ item, ...S.totals(state, item as any) })),
    workRows: [],
    summaries: { totalCosts: state.costs.reduce((n, c) => n + c.amount, 0) },
    fixture: {
      name,
      focus: { x: 33, z: 31 },
      origin:
        'Explicit opening assets; physical electrical circuit advanced exclusively by real Sim.tick.',
    },
  };
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(record) + '\n');
  fs.writeFileSync(path.join(directory, `${name}.save.json`), S.save(state));
  shots.push({
    name,
    filename: `${name}.json`,
    runId: run.id,
    phase: run.phase,
    focus: record.fixture.focus,
  });
  captured.add(name);
}
for (let i = 0; i < 36000 && Date.now() - startedAt < 45000; i++) {
  S.tick(s, 0.1);
  const run = s.electrical!.runs[0];
  if (
    run.cellIndex >= 2 &&
    run.phase === 'dump-spoil' &&
    run.soilInBucketM3 > 0 &&
    run.cells[run.cellIndex].spoilM3 > 0.1 &&
    !captured.has('electrical-excavating')
  )
    capture('electrical-excavating');
  if (
    run.cellIndex >= 2 &&
    run.phase === 'lay' &&
    run.cableInHand > 0 &&
    run.clock > 0.5 &&
    !captured.has('electrical-laying')
  )
    capture('electrical-laying');
  if (
    run.cellIndex >= 2 &&
    run.phase === 'backfill-approach' &&
    run.cells[run.cellIndex].cableInstalled &&
    !captured.has('electrical-cable-laid')
  )
    capture('electrical-cable-laid');
  if (
    run.cellIndex >= 2 &&
    run.phase === 'backfill' &&
    run.soilInBucketM3 > 0 &&
    run.clock > 0.5 &&
    !captured.has('electrical-backfilling')
  )
    capture('electrical-backfilling');
  if (run.status === 'commissioned') {
    capture('electrical-complete');
    break;
  }
}
if (s.electrical!.runs[0].status !== 'commissioned')
  fs.writeFileSync('/tmp/plant-electrical-blocked.json', JSON.stringify(s));
assert.equal(s.electrical!.runs[0].status, 'commissioned', stateSummary(s));
assert.equal(shots.length, 5, JSON.stringify(shots));
fs.writeFileSync(
  path.join(directory, 'electrical-index.json'),
  JSON.stringify({ shots }, null, 2) + '\n',
);
console.log(JSON.stringify(shots));
