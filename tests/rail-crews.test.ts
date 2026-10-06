import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestRailUnloading } from '../src/rail-freight';
import * as S from '../src/sim';
import { setRailCrew, jobEquipmentAssignment } from '../src/jobs';
import { setEquipmentAssistant } from '../src/work-crews';
import { MATERIALS } from '../src/catalog';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { EquipmentKind, Item } from '../src/types';
function fixture(kind: EquipmentKind = 'excavator', curve = false) {
  let s = S.createState();
  const installer = seedHandlingResources(s, 'excavator');
  installer.x = 100;
  installer.z = 25;
  const stager = seedHandlingResources(s, kind);
  stager.x = 20;
  stager.z = 35;
  if (kind === 'forklift')
    s.workers.push({
      ...s.workers.find((w) => w.role === 'builder')!,
      id: S.id(s, 'worker'),
      x: 22,
      z: 37,
      job: undefined,
      path: [],
      name: 'Worker #4',
    });
  const helpers = s.workers.filter((w) => w.role === 'builder');
  assert.equal(setEquipmentAssistant(s, installer.id, helpers[0].id), '');
  assert.equal(setEquipmentAssistant(s, stager.id, helpers[1].id), '');
  const result = curve
    ? S.planRailLayout(s, 'curve', { x: 125, z: 5 })
    : { jobs: [S.plan(s, 'rail', 125, 4).job!, S.plan(s, 'rail', 130, 4).job!] };
  const group = s.jobGroups!.find((g) => g.id === result.jobs[0].parentId)!;
  const item: Item = curve ? 'railCurve' : 'rail',
    m = MATERIALS[item];
  for (let i = 0; i < result.jobs.length; i++)
    s.stacks.push({
      id: `CREW-STOCK-${i}`,
      item,
      qty: 1,
      reserved: 0,
      x: 30,
      z: 29 + i * 4,
      w: m.w,
      d: m.d,
      source: 'opening',
    });
  assert.equal(setRailCrew(s, group.id, stager.id, installer.id), '');
  return { s, installer, stager, group, item, ids: result.jobs.map((j) => j.id) };
}
for (const kind of ['excavator', 'forklift'] as const)
  test(`two-machine rail crew stages and installs with real ${kind} handling, operators and dedicated helpers`, () => {
    const { s, installer, stager, item, ids } = fixture(kind);
    let overlapping = false,
      reloaded = false,
      previous = '',
      stuck = 0;
    tickUntil(
      s,
      () => ids.every((id) => s.jobs.find((j) => j.id === id)?.status === 'done'),
      3200,
      () => {
        const mark = JSON.stringify(
          s.jobs
            .map((j) => [j.status, j.phase, j.equipment, j.railWork?.clock])
            .concat(
              s.equipment.map((e) => [e.x, e.z, e.yaw, e.path.length]) as any,
              s.workers.map((w) => [w.x, w.z, w.yaw, w.path.length]) as any,
            ),
        );
        if (mark === previous) stuck += 0.1;
        else {
          previous = mark;
          stuck = 0;
        }
        if (stuck > 45) {
          throw new Error(
            JSON.stringify(
              s.jobs.map((j) => ({
                id: j.id,
                phase: j.phase,
                reason: j.reason,
                railWork: j.railWork,
              })),
            ),
          );
        }
        const active = s.jobs.filter((j) => j.status === 'doing' && ids.includes(j.id));
        if (active.some((j) => j.railStageOnly) && active.some((j) => !j.railStageOnly))
          overlapping = true;
        for (const j of active) {
          assert.ok(j.operator);
          assert.equal(s.workers.find((w) => w.id === j.worker)?.assistingEquipment, j.equipment);
          assert.equal(j.equipment, j.railStageOnly ? stager.id : installer.id);
        }
        const t = S.totals(s, item);
        assert.equal(t.stored + t.cargo + t.installed, ids.length);
        if (
          !reloaded &&
          active.some((j) => j.railStageOnly && j.railWork?.panel.state === 'carried')
        ) {
          Object.assign(s, S.load(S.save(s)));
          reloaded = true;
        }
      },
    );
    assert.ok(reloaded, 'save/reload while stager carries physical panel');
    assert.ok(overlapping, 'second panel stages while first panel installs');
    assert.equal(
      s.events.filter((e) => e.entity === 'BUFFER-001' && /secured the same buffer/.test(e.text))
        .length,
      1,
    );
    assert.equal(
      s.events.filter(
        (e) => e.entity === 'BUFFER-001' && /released the existing buffer rail clamps/.test(e.text),
      ).length,
      1,
    );
  });
test('rail crew assignment validates distinct machines and load capacity', () => {
  const { s, installer, stager, group } = fixture();
  assert.match(setRailCrew(s, group.id, installer.id, installer.id), /different/);
  assert.match(setRailCrew(s, group.id, stager.id), /both/);
  assert.equal(jobEquipmentAssignment(s, s.jobs[0]).equipmentId, stager.id);
  assert.equal(setRailCrew(s, group.id), '');
  assert.equal(jobEquipmentAssignment(s, s.jobs[0]).equipmentId, undefined);
});

test('canceling an active staging crew restores the loose buffer after the final staged load is supported', () => {
  const { s, ids } = fixture('excavator', true);
  tickUntil(
    s,
    () =>
      s.jobs.find((j) => j.id === ids[0])!.status === 'done' &&
      s.jobs.some((j) => j.railStageOnly && j.status === 'doing'),
    2000,
  );
  for (const id of ids.slice(1)) S.cancelJob(s, id);
  tickUntil(
    s,
    () =>
      !!s.jobGroups![0].railBuffer?.pose.secured &&
      !s.jobs.some((j) => j.status === 'doing' || j.status === 'todo'),
    2000,
  );
  assert.equal(s.rails.length, 1);
  assert.equal(s.jobs.find((j) => j.id === ids[0])!.status, 'done');
  S.load(S.save(s));
});

test('rail staging machine can receive ordered missing panels before the assigned crew starts construction', () => {
  const { s, installer, stager, ids } = fixture();
  s.stacks = [];
  assert.equal(S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }, 'Rail crew material receiving'), '');
  const orders = S.purchase(s, 'rail', 2, 'rail');
  assert.ok(orders.length);
  tickUntil(s, () => s.orders[0].status === 'unloading');
  assert.equal(requestRailUnloading(s, orders[0]), undefined);
  let received = false;
  tickUntil(
    s,
    () =>
      ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done') &&
      s.orders.every((o) => o.status === 'done'),
    3500,
    () => {
      for (const o of s.orders)
        if (o.unload) {
          received = true;
          assert.equal(o.unload.equipmentId, stager.id);
        }
    },
  );
  assert.ok(received);
  const t = S.totals(s, 'rail');
  assert.equal(t.delivered, 2);
  assert.equal(t.installed, 2);
});

test('a forklift staging crew and excavator install all six curve panels with one buffer removal', () => {
  const { s, ids, item } = fixture('forklift', true);
  let overlap = false,
    previous = '',
    stuck = 0;
  tickUntil(
    s,
    () => ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'),
    4500,
    () => {
      const mark = JSON.stringify([
        s.jobs.map((j) => [j.status, j.phase, j.railWork?.clock]),
        s.equipment.map((e) => [e.x, e.z, e.yaw, e.path.length]),
        s.workers.map((w) => [w.x, w.z, w.yaw, w.path.length]),
      ]);
      stuck = mark === previous ? stuck + 0.1 : 0;
      previous = mark;
      assert.ok(
        stuck < 60,
        JSON.stringify(s.jobs.map((j) => ({ id: j.id, phase: j.phase, reason: j.reason }))),
      );
      const active = s.jobs.filter((j) => j.status === 'doing');
      overlap ||= active.some((j) => j.railStageOnly) && active.some((j) => !j.railStageOnly);
      const t = S.totals(s, item);
      assert.equal(t.stored + t.cargo + t.installed, 6);
    },
  );
  assert.ok(overlap);
  assert.equal(s.rails.length, 6);
  assert.ok(Math.hypot(s.buffer.x - 145, s.buffer.z - 25) < 0.01);
  assert.equal(
    s.events.filter(
      (e) => e.entity === 'BUFFER-001' && /released the existing buffer rail clamps/.test(e.text),
    ).length,
    1,
  );
  assert.equal(
    s.events.filter((e) => e.entity === 'BUFFER-001' && /secured the same buffer/.test(e.text))
      .length,
    1,
  );
});
