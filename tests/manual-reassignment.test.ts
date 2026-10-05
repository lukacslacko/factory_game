import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources, tickUntil } from './support/yard';
import {
  setJobEquipment,
  setRailCrew,
  reconcileEquipmentAssignments,
  jobEquipmentAssignment,
  railCrewGroup,
  createJobGroup,
  workLeaves,
} from '../src/jobs';
import { railWorkGroup } from '../src/rail-work-groups';

function fixture() {
  const s = S.createState(),
    old = seedHandlingResources(s, 'excavator');
  old.x = 27;
  old.z = 36;
  const stager = seedHandlingResources(s, 'forklift');
  stager.x = 70;
  stager.z = 40;
  const installer = seedHandlingResources(s, 'excavator');
  installer.x = 90;
  installer.z = 30;
  const j = S.plan(s, 'rail', 125, 4).job!;
  const stock = {
    id: 'STOCK-RAIL',
    item: 'rail' as const,
    qty: 2,
    reserved: 0,
    source: 'opening',
    x: 30,
    z: 28,
    w: 5,
    d: 2,
  };
  s.stacks.push(stock);
  return { s, old, stager, installer, j, stock, group: railWorkGroup(s, j)! };
}

test('manual rail crew immediately supersedes a safely unloaded automatic source approach', () => {
  const { s, old, stager, installer, j, stock, group } = fixture();
  tickUntil(s, () => j.railWork?.phase === 'source-approach', 100);
  assert.equal(j.equipment, old.id);
  assert.equal(stock.reserved, 1);
  const before = { x: old.x, z: old.z, qty: stock.qty };
  assert.equal(setRailCrew(s, group.id, stager.id, installer.id), '');
  assert.equal(j.status, 'todo');
  assert.equal(j.equipment, undefined);
  assert.equal(old.job, undefined);
  assert.equal(stock.reserved, 0);
  assert.equal(stock.qty, before.qty);
  assert.deepEqual(
    { x: old.x, z: old.z },
    { x: before.x, z: before.z },
    'No actor teleports during reassignment',
  );
  assert.equal(jobEquipmentAssignment(s, j).equipmentId, stager.id);
  tickUntil(s, () => j.status === 'doing', 5);
  assert.equal(j.equipment, stager.id, 'Requested stager claims the requeued physical job');
});

test('a loaded automatic rail machine finishes its staging pass before the new installation crew takes over', () => {
  const { s, old, stager, installer, j, group } = fixture();
  tickUntil(s, () => j.railWork?.phase === 'stage-travel', 180);
  assert.equal(j.equipment, old.id);
  assert.equal(old.cargo?.qty, 1);
  const cargo = { ...old.cargo! },
    material = S.totals(s, 'rail');
  assert.equal(setRailCrew(s, group.id, stager.id, installer.id), '');
  assert.equal(j.equipment, old.id);
  assert.equal(old.job, j.id);
  assert.deepEqual(old.cargo, cargo);
  assert.deepEqual(S.totals(s, 'rail'), material);
  assert.equal(j.railStageOnly, true);
  assert.match(j.reason, /safely finishes/);
  tickUntil(s, () => j.legacyRailHandoff === 'staged' && !j.equipment, 300);
  assert.equal(old.cargo, undefined);
  assert.equal(jobEquipmentAssignment(s, j).equipmentId, installer.id);
  tickUntil(s, () => !!j.equipment, 5);
  assert.equal(j.equipment, installer.id);
  assert.equal(
    S.totals(s, 'rail').stored + S.totals(s, 'rail').cargo + S.totals(s, 'rail').installed,
    2,
  );
});

test('latest group Apply replaces old choices and a later leaf or component choice overrides the parent crew', () => {
  const { s, old, stager, installer, j, group } = fixture();
  const component = createJobGroup(s, 'Component', j, group.id);
  j.parentId = component.id;
  assert.equal(setJobEquipment(s, j.id, old.id), '');
  assert.equal(setRailCrew(s, group.id, stager.id, installer.id), '');
  assert.equal(j.preferredEquipment, undefined);
  assert.equal(jobEquipmentAssignment(s, j).equipmentId, stager.id);
  assert.equal(railCrewGroup(s, j), group);
  assert.equal(setJobEquipment(s, j.id, old.id), '');
  assert.equal(jobEquipmentAssignment(s, j).equipmentId, old.id);
  assert.equal(setRailCrew(s, group.id, stager.id, installer.id), '');
  assert.equal(setJobEquipment(s, component.id, installer.id), '');
  assert.equal(jobEquipmentAssignment(s, j).equipmentId, installer.id);
  assert.equal(setJobEquipment(s, group.id, old.id), '');
  assert.equal(group.railCrew, undefined);
  assert.equal(component.preferredEquipment, undefined);
  assert.equal(jobEquipmentAssignment(s, j).equipmentId, old.id);
});

test('pre-lift general manual changes release reservations while a carried slab keeps its real owner', () => {
  const { s, old, installer } = fixture();
  s.jobs = [];
  s.jobGroups = [];
  const j = S.plan(s, 'slab', 35, 43).job!;
  const stock = {
    id: 'STOCK-SLAB',
    item: 'slab' as const,
    qty: 1,
    reserved: 1,
    source: 'opening',
    x: 25,
    z: 38,
    w: 1,
    d: 1,
  };
  s.stacks.push(stock);
  j.stack = stock.id;
  j.equipment = old.id;
  j.status = 'doing';
  old.job = j.id;
  assert.equal(setJobEquipment(s, j.id, installer.id), '');
  assert.equal(j.status, 'todo');
  assert.equal(stock.reserved, 0);
  assert.equal(old.job, undefined);
  j.status = 'doing';
  j.equipment = old.id;
  old.job = j.id;
  old.cargo = { item: 'slab', qty: 1 };
  stock.qty = 0;
  reconcileEquipmentAssignments(s);
  assert.equal(j.equipment, old.id);
  assert.deepEqual(old.cargo, { item: 'slab', qty: 1 });
  assert.match(j.reason, /Manual.*safely finishes/);
});

test('automatic construction chooses nearby machine/operator pairs while preserving manual override', () => {
  const { s, old, stager, installer } = fixture();
  s.jobs = [];
  s.jobGroups = [];
  old.x = 160;
  old.z = 50;
  installer.x = 80;
  installer.z = 50;
  stager.x = 25;
  stager.z = 35;
  s.workers.forEach((w, n) => {
    w.x = 22 + n;
    w.z = 34;
  });
  s.stacks.push({
    id: 'NEAR-SLAB',
    item: 'slab',
    qty: 2,
    reserved: 0,
    source: 'opening',
    x: 30,
    z: 30,
    w: 1,
    d: 1,
  });
  const first = S.plan(s, 'slab', 32, 35).job!;
  tickUntil(s, () => first.status === 'doing', 5);
  assert.equal(first.equipment, stager.id);
  s.stacks.push({
    id: 'SECOND-SLAB',
    item: 'slab',
    qty: 1,
    reserved: 0,
    source: 'opening',
    x: 34,
    z: 30,
    w: 1,
    d: 1,
  });
  const second = S.plan(s, 'slab', 33, 35).job!;
  assert.equal(setJobEquipment(s, second.id, old.id), '');
  tickUntil(s, () => second.status === 'doing', 5);
  assert.equal(second.equipment, old.id);
});

test('connected modern straight components share one parent crew without merging layout IDs', () => {
  const { s, stager, installer } = fixture();
  s.jobs = [];
  s.jobGroups = [];
  const a = S.planRailLayout(s, 'straight', { x: 125, z: 5 });
  const b = S.planRailLayout(s, 'straight', { x: 130, z: 5 });
  assert.equal(a.error, '');
  assert.equal(b.error, '');
  const root = railWorkGroup(s, a.jobs[0])!;
  assert.equal(railWorkGroup(s, b.jobs[0]), root);
  assert.notEqual(a.jobs[0].track!.groupId, b.jobs[0].track!.groupId);
  assert.equal(workLeaves(s, root.id).filter((j) => j.kind === 'rail').length, 2);
  assert.equal(setRailCrew(s, root.id, stager.id, installer.id), '');
  assert.equal(jobEquipmentAssignment(s, a.jobs[0]).equipmentId, stager.id);
  assert.equal(jobEquipmentAssignment(s, b.jobs[0]).equipmentId, stager.id);
});
