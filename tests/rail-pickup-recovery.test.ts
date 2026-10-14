import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { setJobEquipment } from '../src/jobs';
import { seedHandlingResources, stateSummary } from './support/yard';
import type { State } from '../src/types';

function crowdedPickup(spareCrew = true) {
  const s = S.createState();
  const lead = seedHandlingResources(s, 'excavator');
  Object.assign(lead, { x: 24, z: 46, yaw: 0 });
  let spare: typeof lead | undefined;
  if (spareCrew) {
    spare = seedHandlingResources(s, 'excavator');
    Object.assign(spare, { x: 24, z: 60, yaw: 0 });
  }
  s.zones.push({ id: 'ZONE-RECOVERY', name: 'Clear steel bay', x: 70, z: 35, w: 35, d: 35 });
  const source = { id: 'STK-INNER', item: 'rail' as const, x: 45, z: 48,
    w: 5, d: 3, qty: 1, reserved: 0, source: 'opening' };
  const blocker = { ...source, id: 'STK-OUTER', item: 'railCurve' as const,
    x: 39, z: 48, w: 6 };
  s.stacks.push(source, blocker,
    { ...blocker, id: 'STK-EAST', x: 51 },
    { ...blocker, id: 'STK-NORTH', x: 45, z: 44 },
    { ...blocker, id: 'STK-SOUTH', x: 45, z: 52 });
  const result = S.plan(s, 'rail', 125, 4);
  assert.equal(result.error, '');
  const job = result.job!;
  assert.equal(setJobEquipment(s, job.id, lead.id), '');
  return { s, job, lead, spare, blocker };
}

test('crowded rail pickup creates one physical stock-move prerequisite and resumes after reload', () => {
  let { s, job, lead, blocker } = crowdedPickup();
  let childId = '';
  for (let n = 0; n < 3000 && !childId; n++) {
    S.tick(s, 0.1);
    childId = job.railPickupRecovery?.activeJobId || '';
  }
  assert.ok(childId, stateSummary(s));
  const child = s.jobs.find((j) => j.id === childId)!;
  assert.equal(child.kind, 'moveStock');
  assert.ok(['STK-OUTER', 'STK-EAST', 'STK-NORTH', 'STK-SOUTH'].includes(child.stockMove!.sourceId));
  assert.equal(child.stockMove?.toStorage, true);
  assert.equal(job.equipment, lead.id, 'Explicit rail assignment remains with the original work');
  assert.equal(s.jobs.filter((j) => j.kind === 'moveStock').length, 1);
  const broken = JSON.parse(S.save(s));
  broken.jobs.find((j: { id: string }) => j.id === job.id).railPickupRecovery.activeJobId = job.id;
  assert.throws(() => S.load(JSON.stringify(broken)), /invalid rail pickup recovery prerequisite or cycle/);
  s = S.load(S.save(s));
  job = s.jobs.find((j) => j.id === job.id)!;
  let carried = false;
  for (let n = 0; n < 20000 && job.status !== 'done'; n++) {
    S.tick(s, 0.1);
    carried ||= s.equipment.some((e) => e.job === childId && e.cargo?.item === 'railCurve');
    assert.equal(s.jobs.filter((j) => j.kind === 'moveStock').length, 1,
      'Reload and later pickup retries do not duplicate the prerequisite');
    assert.equal(S.totals(s, 'rail').stored + S.totals(s, 'rail').cargo +
      S.totals(s, 'rail').installed, 1, 'The installation panel remains conserved');
    assert.equal(S.totals(s, 'railCurve').stored + S.totals(s, 'railCurve').cargo +
      S.totals(s, 'railCurve').installed, 4, 'The obstructing panels remain conserved');
  }
  assert.ok(carried, 'A real machine carries the blocking panel');
  assert.equal(s.jobs.find((j) => j.id === childId)?.status, 'done', stateSummary(s));
  assert.equal(job.status, 'done', stateSummary(s));
  assert.equal(s.stacks.find((t) => t.id === child.stockMove!.sourceId)?.qty, 0);
});

test('without a second crew, rail pickup stays specifically blocked and creates no unverified move', () => {
  const { s, job } = crowdedPickup(false);
  for (let n = 0; n < 1000; n++) S.tick(s, 0.1);
  assert.equal(s.jobs.filter((j) => j.kind === 'moveStock').length, 0);
  assert.match(job.reason, /no unassigned machine|no separate operator|blocked by/i);
  assert.ok(s.notices.some((n) => n.entity === job.id && n.title === 'Rail pickup blocked'));
  S.load(S.save(s));
});

test('an idle excavator manually assigned elsewhere is not borrowed for automatic pickup recovery', () => {
  const { s, job, spare } = crowdedPickup();
  const other = S.plan(s, 'slab', 90, 65).job!;
  assert.equal(setJobEquipment(s, other.id, spare!.id), '');
  for (let n = 0; n < 1000; n++) S.tick(s, 0.1);
  assert.equal(s.jobs.filter((j) => j.kind === 'moveStock').length, 0);
  assert.match(job.reason, /No unassigned machine permits recovery work/i);
  assert.equal(other.preferredEquipment, spare!.id);
});

test('a spare excavator without an available helper cannot certify a recovery route', () => {
  const { s, job } = crowdedPickup();
  s.workers.filter((w) => w.role !== 'operator').at(-1)!.duty = 'manual';
  for (let n = 0; n < 1000; n++) S.tick(s, 0.1);
  assert.equal(s.jobs.filter((j) => j.kind === 'moveStock').length, 0);
  assert.match(job.reason, /no separate operator, support worker, and machine have a verified handling route/i);
  assert.ok((job.railPickupRecovery?.nextProbeAt || 0) >= s.elapsed - 10,
    'Repeated failed surveys stay on a fixed time cadence');
  S.load(S.save(s));
});
