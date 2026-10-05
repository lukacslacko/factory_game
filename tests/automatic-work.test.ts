import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import {
  automaticEquipmentForWork,
  automaticEquipmentAllowsJob,
  refreshAutomaticEquipment,
  setJobEquipment,
  workLeaves,
} from '../src/jobs';
import { tickUntil } from './support/yard';

test('one automatic machine paves an entire work order through settling, prefetch and reload', () => {
  let s = S.demoState();
  S.pave(s, { x: 56, z: 35, w: 4, d: 1 });
  const groupId = s.jobs[0].parentId!;
  tickUntil(
    s,
    () => s.jobs.some((j) => !!s.equipment.find((e) => e.id === j.equipment)?.cargo),
    1200,
  );
  const owner = s.jobGroups!.find((g) => g.id === groupId)!.automaticEquipment;
  assert.ok(owner);
  assert.equal(new Set(s.jobs.filter((j) => j.equipment).map((j) => j.equipment)).size, 1);
  s = S.load(S.save(s));
  assert.equal(s.jobGroups!.find((g) => g.id === groupId)!.automaticEquipment, owner);
  tickUntil(
    s,
    () => s.jobs.every((j) => j.status === 'done'),
    2400,
    () => {
      for (const j of s.jobs) if (j.equipment) assert.equal(j.equipment, owner);
    },
  );
  const total = S.totals(s, 'slab');
  assert.equal(total.delivered + total.recovered, total.stored + total.cargo + total.installed);
});

test('different paving work orders can use separate machines simultaneously', () => {
  const s = S.demoState();
  S.pave(s, { x: 56, z: 35, w: 2, d: 1 });
  S.pave(s, { x: 56, z: 45, w: 2, d: 1 });
  let parallel = false;
  tickUntil(
    s,
    () => s.jobs.every((j) => j.status === 'done'),
    2400,
    () => {
      const active = s.jobs.filter((j) => j.status === 'doing' && !j.handling?.equipmentReleased);
      if (
        new Set(active.map((j) => j.parentId)).size === 2 &&
        new Set(active.map((j) => j.equipment)).size === 2
      )
        parallel = true;
      for (const g of s.jobGroups!)
        assert.ok(
          new Set(
            workLeaves(s, g.id)
              .filter((j) => j.equipment)
              .map((j) => j.equipment),
          ).size <= 1,
        );
    },
  );
  assert.ok(parallel, 'Independent work must not become one global machinery queue');
});

test('a role change waits for the carried slab before transferring the group to another machine', () => {
  const s = S.demoState();
  S.pave(s, { x: 56, z: 35, w: 3, d: 1 });
  tickUntil(s, () => s.equipment.some((e) => !!e.cargo), 1200);
  const original = s.equipment.find((e) => e.cargo)!;
  const carried = original.job!;
  S.setEquipmentRole(s, original.id, 'hold');
  let handedOver = false;
  tickUntil(
    s,
    () => s.jobs.every((j) => j.status === 'done'),
    2400,
    () => {
      const others = s.jobs.filter((j) => j.equipment && j.equipment !== original.id);
      if (others.length) {
        handedOver = true;
        assert.ok(
          s.jobs.find((j) => j.id === carried)!.handling?.equipmentReleased ||
            s.jobs.find((j) => j.id === carried)!.status === 'done',
        );
      }
    },
  );
  assert.ok(handedOver);
});

test('a forklift paving a building foundation hands off to the excavator for the heavy office', () => {
  const s = S.demoState();
  const fork = s.equipment.find((e) => e.kind === 'forklift')!;
  const excavator = s.equipment.find((e) => e.kind === 'excavator')!;
  S.setEquipmentRole(s, fork.id, 'paving');
  S.setEquipmentRole(s, excavator.id, 'construction');
  const office = S.plan(s, 'office', 56, 35).job!;
  let erectedBy: string | undefined;
  const pavingMachines = new Map<string, string>();
  tickUntil(
    s,
    () => office.status === 'done',
    4000,
    () => {
      if (office.equipment) erectedBy = office.equipment;
      for (const j of s.jobs)
        if (j.kind === 'slab' && j.equipment) pavingMachines.set(j.id, j.equipment);
    },
  );
  assert.equal(erectedBy, excavator.id);
  assert.equal(pavingMachines.size, 18);
  assert.deepEqual([...new Set(pavingMachines.values())], [fork.id]);
});

test('legacy active machines drain safely and explicit choices override automatic ownership', () => {
  const s = S.demoState();
  S.pave(s, { x: 56, z: 35, w: 3, d: 1 });
  const [a, b, next] = s.jobs;
  // Model an imported assignment state; physical execution is covered above.
  a.status = b.status = 'doing';
  a.equipment = s.equipment[0].id;
  b.equipment = s.equipment[1].id;
  refreshAutomaticEquipment(s, () => true);
  assert.equal(automaticEquipmentForWork(s, next), a.equipment);
  assert.equal(automaticEquipmentAllowsJob(s, s.equipment[0], next), false);
  b.status = 'done';
  assert.equal(automaticEquipmentAllowsJob(s, s.equipment[0], next), true);
  assert.equal(setJobEquipment(s, next.id, s.equipment[1].id), '');
  assert.equal(next.preferredEquipment, s.equipment[1].id);
  assert.equal(a.status, 'doing');
});

test('saves reject missing automatic work and delivery machines', () => {
  const s = S.demoState();
  S.pave(s, { x: 56, z: 35, w: 1, d: 1 });
  s.jobGroups![0].automaticEquipment = 'MISSING';
  assert.throws(() => S.load(S.save(s)), /automatic work-order equipment/);
  s.jobGroups![0].automaticEquipment = undefined;
  const [id] = S.purchase(s, 'slab', 1);
  s.orders.find((o) => o.id === id)!.automaticEquipment = 'MISSING';
  assert.throws(() => S.load(S.save(s)), /automatic delivery equipment/);
});
