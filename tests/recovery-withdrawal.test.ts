import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { angleDelta } from '../src/motion';
import { boxOverlap, boxPenetrationDepth, equipmentBoxes } from '../src/traffic';
import { tickUntil } from './support/yard';

test('a recovered office backs clear before turning beside an unoccupied held forklift', () => {
  let s = S.demoState();
  let e = s.equipment.find((m) => m.kind === 'excavator')!;
  const idleId = s.equipment.find((m) => m.kind === 'forklift')!.id;
  S.setEquipmentRole(s, idleId, 'hold');
  S.setEquipmentRole(s, e.id, 'recovery');
  // Opening machine at the office's north work approach, facing the kit.
  e.x = 10.5;
  e.z = 29.5;
  e.yaw = Math.PI / 2;
  e.heading = 1;
  e.reach = 4;
  const office = s.buildings.find((b) => b.kind === 'office')!;
  assert.equal(S.removeBuilding(s, office.id), '');
  const jobId = s.jobs.find((j) => j.kind === 'remove' && j.target === office.id)!.id;
  tickUntil(s, () => s.jobs.find((j) => j.id === jobId)!.phase === 'Withdraw recovered kit', 500);
  let j = s.jobs.find((k) => k.id === jobId)!;
  const start = { x: e.x, z: e.z, yaw: e.yaw };
  assert.ok(e.reverse && e.cargo?.item === 'office');
  assert.ok(e.path[0].z < e.z);
  assert.ok(Math.abs(e.path[0].x - e.x) < 0.01);
  s = S.load(S.save(s));
  e = s.equipment.find((m) => m.id === e.id)!;
  j = s.jobs.find((k) => k.id === jobId)!;
  // The older generic recovery pickup already puts this wide prefab partly
  // over the idle fork envelope. Escape must monotonically reduce that overlap;
  // a turn instead increases it and is rejected by executed collision checks.
  const penetration = () => {
    const idle = s.equipment.find((m) => m.id === idleId)!;
    return Math.max(
      ...equipmentBoxes(e).flatMap((a) =>
        equipmentBoxes(idle).map((b) => boxPenetrationDepth(a, b, 0.06)),
      ),
    );
  };
  let priorPenetration = penetration();
  tickUntil(
    s,
    () => j.phase === 'Return recovered kit',
    120,
    () => {
      const idle = s.equipment.find((m) => m.id === idleId)!;
      assert.equal(idle.operator, undefined);
      const next = penetration();
      assert.ok(
        next <= priorPenetration + 1e-6,
        'Withdrawal may not increase an existing pickup overlap',
      );
      priorPenetration = next;
      assert.ok(
        Math.abs(angleDelta(start.yaw!, e.yaw!)) < 0.02,
        'Withdrawal must not turn the wide kit into the forklift',
      );
      assert.ok(Math.abs(e.x - start.x) < 0.02);
    },
  );
  assert.ok(e.z <= start.z - 3.9, 'The machine must first physically withdraw into turning room');
  assert.equal(penetration(), 0);
  assert.equal(e.reverse, false, 'Change to forward gear only after clearing the site');
  tickUntil(
    s,
    () => j.status === 'done',
    1200,
    () => {
      const idle = s.equipment.find((m) => m.id === idleId)!;
      assert.ok(
        !equipmentBoxes(e).some((a) => equipmentBoxes(idle).some((b) => boxOverlap(a, b, 0.06))),
      );
    },
  );
  assert.equal(e.cargo, undefined);
  assert.equal(s.stacks.find((t) => t.assetId === office.id)?.qty, 1);
  assert.equal(s.equipment.find((m) => m.id === idleId)!.operator, undefined);
  const totals = S.totals(s, 'office');
  assert.equal(
    totals.delivered + totals.recovered,
    totals.stored + totals.cargo + totals.installed,
  );
});
