import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import {
  equipmentAssignment,
  equipmentHasAssignedWork,
  jobRows,
  setJobEquipment,
  workLeaves,
} from '../src/jobs.ts';
import { tickUntil, advance } from './support/yard.ts';

test('building plans have a parent work order, foundation subgroup, and real slab and assembly leaves', () => {
  const s = S.createState();
  const assembly = S.plan(s, 'office', 30, 30).job!;
  assert.ok(assembly);
  const root = s.jobGroups!.find((g) => g.id === assembly.parentId)!;
  const foundation = s.jobGroups!.find((g) => g.parentId === root.id)!;
  assert.equal(root.label, 'Place Office container');
  assert.equal(foundation.label, 'Pave foundation');
  const slabs = s.jobs.filter((j) => j.parentId === foundation.id);
  assert.equal(slabs.length, assembly.w * assembly.d);
  assert.ok(slabs.every((j) => j.kind === 'slab' && j.qty === 1));
  assert.equal(workLeaves(s, root.id).length, slabs.length + 1);
  const rows = jobRows(s);
  assert.equal(rows.find((r) => r.id === root.id)!.depth, 0);
  assert.equal(rows.find((r) => r.id === foundation.id)!.depth, 1);
  assert.ok(rows.filter((r) => slabs.some((j) => j.id === r.id)).every((r) => r.depth === 2));
});

test('paving drag and contiguous rail panels form work-order groups without changing leaf jobs', () => {
  const s = S.createState();
  assert.equal(S.pave(s, { x: 30, z: 30, w: 3, d: 2 }), 6);
  const pavingGroup = s.jobs[0].parentId!;
  assert.equal(workLeaves(s, pavingGroup).length, 6);
  const a = S.plan(s, 'rail', 125, 4).job!,
    b = S.plan(s, 'rail', 130, 4).job!;
  assert.equal(a.parentId, b.parentId);
  const g = s.jobGroups!.find((g) => g.id === a.parentId)!;
  assert.equal(g.w, 10);
  assert.equal(g.d, 2);
});

test('nearest equipment override wins and survives saves; cyclic or dangling links are rejected', () => {
  const s = S.demoState();
  const assembly = S.plan(s, 'office', 56, 35).job!;
  const parent = assembly.parentId!;
  const foundation = s.jobGroups!.find((g) => g.parentId === parent)!;
  const slab = s.jobs.find((j) => j.parentId === foundation.id)!;
  const excavator = s.equipment.find((e) => e.kind === 'excavator')!,
    forklift = s.equipment.find((e) => e.kind === 'forklift')!;
  assert.equal(setJobEquipment(s, parent, excavator.id), '');
  assert.equal(equipmentAssignment(s, slab.id).equipmentId, excavator.id);
  assert.equal(equipmentAssignment(s, slab.id).inherited, true);
  assert.equal(setJobEquipment(s, foundation.id, forklift.id), '');
  assert.equal(equipmentAssignment(s, slab.id).sourceId, foundation.id);
  assert.equal(setJobEquipment(s, slab.id, excavator.id), '');
  assert.equal(equipmentAssignment(s, slab.id).sourceId, slab.id);
  assert.equal(setJobEquipment(s, slab.id), '');
  assert.equal(equipmentAssignment(s, slab.id).equipmentId, forklift.id);
  const restored = S.load(S.save(s));
  assert.equal(equipmentAssignment(restored, slab.id).equipmentId, forklift.id);
  const broken = JSON.parse(S.save(s));
  broken.jobGroups[0].parentId = broken.jobGroups[0].id;
  assert.throws(() => S.load(JSON.stringify(broken)), /cyclic/);
  const dangling = JSON.parse(S.save(s));
  dangling.jobs[0].parentId = 'WORK-missing';
  assert.throws(() => S.load(JSON.stringify(dangling)), /parent/);
  const legacy = JSON.parse(S.save(s));
  delete legacy.jobGroups;
  for (const j of legacy.jobs) {
    delete j.parentId;
    delete j.preferredEquipment;
  }
  assert.equal(jobRows(S.load(JSON.stringify(legacy))).length, legacy.jobs.length);
});

test('manual group assignment overrides automatic role and reserves the machine from unrelated jobs', () => {
  const s = S.demoState();
  const excavator = s.equipment.find((e) => e.kind === 'excavator')!,
    forklift = s.equipment.find((e) => e.kind === 'forklift')!;
  S.setEquipmentRole(s, excavator.id, 'receiving');
  S.setEquipmentRole(s, forklift.id, 'hold');
  const unrelated = S.plan(s, 'slab', 57, 36).job!;
  S.pave(s, { x: 56, z: 35, w: 2, d: 1 });
  const assigned = s.jobs.find((j) => j.parentId)!.parentId!;
  assert.equal(setJobEquipment(s, assigned, excavator.id), '');
  assert.equal(equipmentHasAssignedWork(s, excavator), true);
  tickUntil(
    s,
    () => workLeaves(s, assigned).every((j) => j.status === 'done'),
    1800,
    () => {
      for (const j of workLeaves(s, assigned))
        if (j.equipment) assert.equal(j.equipment, excavator.id);
      assert.equal(unrelated.equipment, undefined);
    },
  );
  assert.equal(equipmentHasAssignedWork(s, excavator), false);
  assert.equal(excavator.workRole, 'receiving');
  assert.equal(unrelated.status, 'todo');
});

test('urgent assignment retains current carried job, then safely hands the machine to requested work', () => {
  let s = S.demoState();
  let excavator = s.equipment.find((e) => e.kind === 'excavator')!;
  const forklift = s.equipment.find((e) => e.kind === 'forklift')!;
  S.setEquipmentRole(s, excavator.id, 'paving');
  S.setEquipmentRole(s, forklift.id, 'hold');
  const first = S.plan(s, 'slab', 56, 35).job!,
    urgent = S.plan(s, 'slab', 58, 35).job!;
  tickUntil(s, () => !!excavator.cargo && excavator.job === first.id);
  const cargo = { ...excavator.cargo! },
    position = { x: excavator.x, z: excavator.z };
  assert.equal(setJobEquipment(s, urgent.id, excavator.id), '');
  assert.equal(excavator.job, first.id);
  assert.deepEqual(excavator.cargo, cargo);
  assert.deepEqual({ x: excavator.x, z: excavator.z }, position);
  assert.match(equipmentAssignment(s, urgent.id).text, /finishing/);
  s = S.load(S.save(s));
  excavator = s.equipment.find((e) => e.id === excavator.id)!;
  tickUntil(
    s,
    () => s.jobs.find((j) => j.id === urgent.id)!.status === 'done',
    1800,
    () => {
      if (excavator.job === urgent.id)
        assert.equal(s.jobs.find((j) => j.id === first.id)!.status, 'done');
    },
  );
  assert.equal(excavator.cargo, undefined);
  const t = S.totals(s, 'slab');
  assert.equal(t.delivered + t.recovered, t.stored + t.cargo + t.installed);
});

test('manual assignment rejects a forklift for actual rail and can clear an inherited reservation', () => {
  const s = S.demoState();
  const rail = S.plan(s, 'rail', 125, 4).job!;
  const forklift = s.equipment.find((e) => e.kind === 'forklift')!,
    excavator = s.equipment.find((e) => e.kind === 'excavator')!;
  assert.match(setJobEquipment(s, rail.parentId!, forklift.id), /requires an excavator/);
  assert.equal(equipmentAssignment(s, rail.id).equipmentId, undefined);
  assert.equal(setJobEquipment(s, rail.parentId!, excavator.id), '');
  assert.equal(equipmentHasAssignedWork(s, excavator), true);
  assert.equal(setJobEquipment(s, rail.parentId!), '');
  assert.equal(equipmentHasAssignedWork(s, excavator), false);
  advance(s, 1);
});

test('urgent paving waits for the current unloading batch, then gets priority before later freight', () => {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  // Seeded fixtures still contain a real owned machine and hired operator.
  const demo = S.demoState();
  s.workers = demo.workers;
  s.equipment = demo.equipment.filter((e) => e.kind === 'forklift');
  s.next = demo.next;
  s.equipment[0].workRole = 'receiving';
  const e = s.equipment[0];
  const [oid] = S.purchase(s, 'slab', 24);
  const order = s.orders.find((o) => o.id === oid)!;
  tickUntil(s, () => order.unload?.phase === 'carry' && !!e.cargo, 1800);
  const cargo = { ...e.cargo! };
  const slab = S.plan(s, 'slab', 56, 35).job!;
  assert.equal(setJobEquipment(s, slab.id, e.id), '');
  assert.deepEqual(e.cargo, cargo);
  assert.equal(e.deliveryOrder, oid);
  let arrivedWhenConstruction: number | undefined;
  tickUntil(
    s,
    () => slab.status === 'done',
    1800,
    () => {
      if (slab.equipment) {
        arrivedWhenConstruction ??= order.arrived;
        assert.equal(
          order.arrived,
          arrivedWhenConstruction,
          'Next delivery batch must wait for reserved urgent work',
        );
        assert.equal(slab.equipment, e.id);
        assert.equal(e.deliveryOrder, undefined);
      }
    },
  );
  assert.ok(arrivedWhenConstruction! < order.qty);
  tickUntil(s, () => order.status === 'done', 1800);
  assert.equal(order.arrived, 24);
  const t = S.totals(s, 'slab');
  assert.equal(t.delivered, t.stored + t.cargo + t.installed);
});

test('sorting work rows reorders siblings while preserving complete parent and child blocks', async () => {
  const { sortWorkRows } = await import('../src/jobs.ts');
  const rows = [
    { id: 'old', status: 'done' as const, created: 10 },
    { id: 'old-child', parentId: 'old', status: 'done' as const, created: 20 },
    { id: 'new', status: 'doing' as const, created: 30 },
    { id: 'new-a', parentId: 'new', status: 'todo' as const, created: 40 },
    { id: 'new-a-child', parentId: 'new-a', status: 'todo' as const, created: 60 },
    { id: 'new-b', parentId: 'new', status: 'doing' as const, created: 50 },
  ];
  assert.deepEqual(
    sortWorkRows(rows).map((r) => r.id),
    ['new', 'new-b', 'new-a', 'new-a-child', 'old', 'old-child'],
  );
  assert.deepEqual(
    sortWorkRows(rows, (a, b) => a.id.localeCompare(b.id)).map((r) => r.id),
    ['new', 'new-a', 'new-a-child', 'new-b', 'old', 'old-child'],
  );
  assert.deepEqual(
    sortWorkRows(rows.filter((r) => r.id !== 'new')).map((r) => r.id),
    ['new-b', 'new-a', 'new-a-child', 'old', 'old-child'],
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ['old', 'old-child', 'new', 'new-a', 'new-a-child', 'new-b'],
  );
});

test('a newer urgent assignment wins after the carried leaf of an older assigned group finishes', () => {
  const s = S.demoState();
  const e = s.equipment.find((e) => e.kind === 'excavator')!;
  S.setEquipmentRole(s, s.equipment.find((e) => e.kind === 'forklift')!.id, 'hold');
  S.pave(s, { x: 56, z: 35, w: 3, d: 1 });
  const group = s.jobs[0].parentId!;
  assert.equal(setJobEquipment(s, group, e.id), '');
  tickUntil(s, () => !!e.cargo && !!e.job, 1200);
  const carried = e.job!;
  const urgent = S.plan(s, 'slab', 60, 35).job!;
  assert.equal(setJobEquipment(s, urgent.id, e.id), '');
  let handedOver = false;
  tickUntil(
    s,
    () => urgent.status === 'done',
    1800,
    () => {
      if (e.job === urgent.id) handedOver = true;
      if (e.job && e.job !== carried && e.job !== urgent.id)
        assert.ok(
          handedOver,
          'Urgent job must precede remaining leaves of the earlier assigned paving group',
        );
    },
  );
  assert.ok(handedOver);
  tickUntil(s, () => workLeaves(s, group).every((j) => j.status === 'done'), 1800);
});

test('manual assignment checks the real weight of newly queued recovery before scheduling resolves its item', () => {
  const s = S.demoState();
  const office = s.buildings.find((b) => b.kind === 'office')!;
  const forklift = s.equipment.find((e) => e.kind === 'forklift')!,
    excavator = s.equipment.find((e) => e.kind === 'excavator')!;
  assert.equal(S.removeBuilding(s, office.id), '');
  const recovery = s.jobs.find((j) => j.kind === 'remove' && j.target === office.id)!;
  assert.equal(
    recovery.item,
    undefined,
    'Regression must cover a job before its first scheduler tick',
  );
  assert.match(setJobEquipment(s, recovery.id, forklift.id), /lift capacity/);
  assert.equal(recovery.preferredEquipment, undefined);
  assert.equal(setJobEquipment(s, recovery.id, excavator.id), '');
  assert.equal(
    recovery.item,
    undefined,
    'Assignment validation must not mutate material ownership',
  );
});

test('a group reports its active physical operation before queued staffing requirements', () => {
  const s = S.createState();
  S.pave(s, { x: 56, z: 35, w: 3, d: 1 });
  const group = s.jobs[0].parentId!,
    [working, waiting, done] = workLeaves(s, group);
  working.status = 'doing';
  working.phase = 'Face slab storage';
  working.reason = 'Waiting for EQ-0010 to clear the loading face';
  waiting.reason = 'Need an available equipment operator';
  done.status = 'done';
  done.progress = 1;
  let row = jobRows(s).find((r) => r.id === group)!;
  assert.match(row.reason, /1\/3 complete.*Waiting for EQ-0010/);
  assert.ok(!row.reason.includes('available equipment operator'));
  working.reason = '';
  row = jobRows(s).find((r) => r.id === group)!;
  assert.match(row.reason, /1\/3 complete.*Face slab storage/);
  working.status = 'done';
  row = jobRows(s).find((r) => r.id === group)!;
  assert.match(row.reason, /2\/3 complete.*available equipment operator/);
});
