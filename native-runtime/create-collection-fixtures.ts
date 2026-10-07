/** Synthetic opening stock/crew, followed solely by real Sim.tick collection work. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources } from '../tests/support/yard';
import { MATERIALS, EQUIPMENT, BUILDINGS, ROLES, SERVICES } from '../src/catalog';
import { renderState } from './render';
const directory = path.resolve(import.meta.dirname, '../native/tests/fixtures');
fs.mkdirSync(directory, { recursive: true });
const records: any[] = [];
function capture(
  name: string,
  s: ReturnType<typeof S.createState>,
  focus: { x: number; z: number },
) {
  const state = { ...s, paused: true };
  S.load(S.save(state));
  const render = renderState(state);
  const record = {
    state,
    render,
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
      focus,
      origin:
        'Synthetic opening stock and owned resources; physical operation advanced exclusively by real Sim.tick.',
    },
  };
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(record) + '\n');
  fs.writeFileSync(path.join(directory, `${name}.save.json`), S.save(state));
  records.push({
    name,
    focus,
    phase: s.collections![0].task?.phase || s.collections![0].status,
    elapsed: s.elapsed,
  });
}
{
  const s = S.createState();
  seedHandlingResources(s);
  const source = {
    id: S.id(s, 'stack'),
    item: 'slab' as const,
    x: 30,
    z: 32,
    w: 1,
    d: 1,
    qty: 12,
    reserved: 0,
    source: 'opening',
  };
  s.stacks.push(source);
  assert.equal(
    S.requestCollection(s, { lines: [{ stackId: source.id, qty: 12 }] }).error,
    undefined,
  );
  const captured = new Set<string>();
  for (let i = 0; i < 18000; i++) {
    S.tick(s, 0.1);
    const c = s.collections![0],
      t = c.task;
    for (const [name, condition, focus] of [
      ['collection-pickup', t?.phase === 'lift' && t.clock > 1, { x: 30, z: 34 }],
      [
        'collection-carry',
        t?.phase === 'carry' && !!s.equipment[0].path.length && t.clock > 3,
        { x: 26, z: 30 },
      ],
      ['collection-secure', t?.phase === 'secure' && t.clock > 0.7, { x: 20, z: 20 }],
      [
        'collection-departing',
        c.status === 'departing' && s.orders[0].drive!.distance > 100,
        { x: 20, z: 18 },
      ],
    ] as const)
      if (condition && !captured.has(name)) {
        capture(name, s, focus);
        captured.add(name);
      }
    if (c.status === 'done') break;
  }
  assert.equal(captured.size, 4);
}
{
  const s = S.createState();
  const e = seedHandlingResources(s, 'excavator');
  s.workers = s.workers.filter((w) => w.role === 'operator');
  assert.equal(S.requestCollection(s, { equipmentId: e.id }).error, undefined);
  let captured = false;
  for (let i = 0; i < 18000; i++) {
    S.tick(s, 0.1);
    const t = s.collections![0].task;
    if (t?.phase === 'equipment-ramp' && t.clock > 8) {
      capture('collection-lowloader-ramp', s, { x: -10.1, z: 34 });
      captured = true;
      break;
    }
  }
  assert.ok(captured);
}
fs.writeFileSync(
  path.join(directory, 'collection-fixtures.json'),
  JSON.stringify(records, null, 2) + '\n',
);
console.log(JSON.stringify(records));
