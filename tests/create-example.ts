import { writeFileSync } from 'node:fs';
import * as S from '../src/sim';
import { checkScenarioFuel, requestLowFuelService, stateSummary } from './support/yard';
let s = S.createState();
S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }, 'Receiving stockyard');
s.name = 'Willow Siding';
s.guide = false;
S.purchase(s, 'builder', 3);
S.purchase(s, 'operator', 2);
S.purchase(s, 'excavator', 1);
S.purchase(s, 'forklift', 1);
S.purchase(s, 'power', 1);
S.purchase(s, 'water', 1);
S.purchase(s, 'diesel', 2);
S.plan(s, 'office', 4, 32);
S.plan(s, 'sanitary', 4, 39);
S.plan(s, 'shed', 12, 44);
S.plan(s, 'store', 55, 29);
for (const [x, z] of [
  [4, 29],
  [21, 31],
  [53, 40],
  [68, 29],
])
  S.plan(s, 'lamp', x, z);
for (let x = 125; x < 150; x += 5) S.plan(s, 'rail', x, 4);
S.pave(s, { x: 56, z: 35, w: 8, d: 4 });
S.buyMissing(s);
let elapsed = 0;
let sawServiceCan = false;
while (
  (s.jobs.some((j) => j.status !== 'done') || s.orders.some((o) => o.status !== 'done')) &&
  elapsed < 12000
) {
  requestLowFuelService(s);
  S.tick(s, 0.1);
  checkScenarioFuel(s);
  if (
    s.jobs.some((j) => j.kind === 'refuel' && j.phase === 'Carry fuel' && (j.fuelLiters || 0) > 0)
  )
    sawServiceCan = true;
  elapsed += 0.1;
}
if (s.jobs.some((j) => j.status !== 'done') || s.orders.some((o) => o.status !== 'done'))
  throw new Error(
    'Example did not complete construction and delivery departures: ' + stateSummary(s),
  );
if (s.equipment.some((e) => e.cargo || e.deliveryOrder || e.transportOrder))
  throw new Error('Example still has equipment handling delivery cargo');
if (s.stacks.some((stack) => stack.reserved !== 0))
  throw new Error('Example still has reserved material after its work orders finished');
if (
  s.jobs.filter((j) => j.kind !== 'refuel').length !== 145 ||
  !sawServiceCan ||
  !s.jobs.some((j) => j.kind === 'refuel' && j.status === 'done')
)
  throw new Error('Example must complete 145 construction jobs and physical fuel service');
for (const item of [
  'slab',
  'rail',
  'office',
  'sanitary',
  'shed',
  'store',
  'lamp',
  'diesel',
  'fence',
] as const) {
  const total = S.totals(s, item);
  if (total.delivered !== total.stored + total.cargo + total.inConstruction + total.installed)
    throw new Error(`Example inventory is not balanced: ${item}`);
}
if (s.version !== 4 || s.workers.some((w, i) => w.name !== `Worker #${i + 1}`))
  throw new Error('Example has not adopted version 4 and numbered worker names');
s.paused = true;
writeFileSync('examples/willow-siding.json', S.save(s));
console.log(
  JSON.stringify({
    jobs: s.jobs.length,
    constructionJobs: s.jobs.filter((j) => j.kind !== 'refuel').length,
    fuelServiceJobs: s.jobs.filter((j) => j.kind === 'refuel').length,
    completed: s.jobs.filter((j) => j.status === 'done').length,
    paving: Object.keys(s.paving).length,
    buildings: s.buildings.length,
    buffer: s.buffer,
    purchases: s.orders.length,
    time: s.time,
    actual: s.costs.reduce((n, c) => n + c.amount, 0),
  }),
);
