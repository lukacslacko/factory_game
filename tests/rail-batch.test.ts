import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS } from '../src/catalog';
import { angleDelta } from '../src/motion';
import { trackGeometry } from '../src/track';
import { railBatchContinues } from '../src/rail-batch';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { Item, RailWorkPose, State } from '../src/types';

function fixture(curve = false) {
  const s = S.createState();
  seedHandlingResources(s, 'excavator');
  const result = curve
    ? S.planRailLayout(s, 'curve', { x: 125, z: 5 })
    : { jobs: [S.plan(s, 'rail', 125, 4).job!, S.plan(s, 'rail', 130, 4).job!] };
  assert.ok(result.jobs.every(Boolean));
  const item: Item = curve ? 'railCurve' : 'rail',
    m = MATERIALS[item];
  for (let i = 0; i < result.jobs.length; i++)
    s.stacks.push({
      id: `BATCH-STOCK-${i}`,
      item,
      qty: 1,
      reserved: 0,
      x: 30,
      z: 29 + i * 4,
      w: m.w,
      d: m.d,
      source: 'opening',
    });
  return { s, ids: result.jobs.map((j) => j.id), item };
}

function events(s: State, expression: RegExp) {
  return s.events.filter((e) => e.entity === 'BUFFER-001' && expression.test(e.text));
}

test('a two-panel straight work removes and returns its one real buffer only once', () => {
  const { s, ids } = fixture();
  assert.equal(
    railBatchContinues(
      s,
      s.jobs.find((j) => j.id === ids[0])!,
    ),
    true,
  );
  let firstAside: RailWorkPose | undefined;
  tickUntil(
    s,
    () => ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'),
    2200,
    () => {
      const shared = s.jobGroups?.[0].railBuffer;
      if (s.jobs.find((j) => j.id === ids[0])!.status === 'done') {
        assert.ok(shared);
        firstAside ??= { ...shared.pose };
        const next = s.jobs.find((j) => j.id === ids[1])!;
        if (next.status !== 'done' && next.railWork?.panel.state !== 'installed') {
          assert.equal(shared.pose.x, firstAside.x);
          assert.equal(shared.pose.z, firstAside.z);
          assert.equal(shared.pose.secured, false);
        }
      }
    },
  );
  assert.equal(s.rails.length, 2);
  assert.deepEqual(s.buffer, { x: 135, z: 5 });
  assert.equal(events(s, /released the existing buffer rail clamps/).length, 1);
  assert.equal(events(s, /secured the same buffer/).length, 1);
  assert.equal(s.jobs.find((j) => j.id === ids[0])!.railWork!.buffer, undefined);
  assert.equal(s.jobGroups![0].railBuffer!.pose.secured, true);
});

test('six-piece curve keeps its buffer aside across a between-panel save and returns it at the final tangent', () => {
  const { s, ids, item } = fixture(true);
  let reloaded = false,
    prior: RailWorkPose | undefined;
  tickUntil(
    s,
    () => ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'),
    4000,
    () => {
      const shared = s.jobGroups![0].railBuffer;
      if (shared) {
        const p = shared.pose;
        if (prior)
          assert.ok(
            Math.hypot(p.x - prior.x, p.z - prior.z, p.y - prior.y) < 1.5,
            'The shared buffer remains a continuously moved physical asset',
          );
        prior = { ...p };
      }
      if (!reloaded && s.jobs.find((j) => j.id === ids[0])!.status === 'done') {
        assert.ok(shared && !shared.pose.secured);
        Object.assign(s, S.load(S.save(s)));
        reloaded = true;
      }
      const totals = S.totals(s, item);
      assert.equal(totals.stored + totals.cargo + totals.installed, 6);
    },
  );
  assert.ok(reloaded);
  assert.equal(events(s, /released the existing buffer rail clamps/).length, 1);
  assert.equal(events(s, /secured the same buffer/).length, 1);
  assert.ok(Math.hypot(s.buffer.x - 145, s.buffer.z - 25) < 0.01);
  assert.ok(Math.abs(angleDelta(s.jobGroups![0].railBuffer!.pose.yaw, Math.PI / 2)) < 0.01);
});

test('canceling the second panel restores the loose buffer to the last installed end', () => {
  const { s, ids } = fixture();
  tickUntil(
    s,
    () => {
      const second = s.jobs.find((j) => j.id === ids[1])!;
      return !!second.railWork && second.railWork.panel.state === 'stored';
    },
    1800,
  );
  assert.equal(s.jobs.find((j) => j.id === ids[0])!.status, 'done');
  S.cancelJob(s, ids[1]);
  Object.assign(s, S.load(S.save(s)));
  tickUntil(s, () => s.jobs.find((j) => j.id === ids[1])!.status === 'canceled', 1000);
  assert.equal(s.rails.length, 1);
  assert.deepEqual(s.buffer, { x: 130, z: 5 });
  assert.equal(s.jobGroups![0].railBuffer!.pose.secured, true);
  assert.equal(events(s, /secured the same buffer/).length, 1);
  assert.equal(S.totals(s, 'rail').stored + S.totals(s, 'rail').installed, 2);
});

test('a canceled gap or a disconnected group panel does not leave the buffer loose', () => {
  const { s, ids } = fixture();
  S.cancelJob(s, ids[1]);
  assert.equal(
    railBatchContinues(
      s,
      s.jobs.find((j) => j.id === ids[0])!,
    ),
    false,
  );
  const second = s.jobs.find((j) => j.id === ids[1])!;
  second.status = 'todo';
  second.cancel = false;
  second.x += 5;
  assert.notEqual(trackGeometry(second).entry.x, trackGeometry(s.jobs[0]).end.x);
  assert.equal(
    railBatchContinues(
      s,
      s.jobs.find((j) => j.id === ids[0])!,
    ),
    false,
  );
});

test('canceling all remaining panels between installs restores the buffer physically without rebuilding track', () => {
  const { s, ids } = fixture(true);
  tickUntil(s, () => s.jobs.find((j) => j.id === ids[0])!.status === 'done', 1000);
  for (const id of ids.slice(1)) S.cancelJob(s, id);
  tickUntil(s, () => s.jobGroups![0].railBuffer!.pose.secured, 1500);
  assert.equal(s.rails.length, 1);
  assert.equal(s.jobs.find((j) => j.id === ids[0])!.status, 'done');
  assert.equal(events(s, /released the existing buffer rail clamps/).length, 1);
  assert.equal(events(s, /secured the same buffer/).length, 1);
  S.load(S.save(s));
});

test('an older saved mixed-gear source approach resumes through a stationary forward-entry handoff', () => {
  const s = S.demoState();
  const forklift = s.equipment.find((e) => e.kind === 'forklift')!;
  S.setEquipmentRole(s, forklift.id, 'hold');
  const j = S.plan(s, 'rail', 125, 4).job!;
  tickUntil(s, () => !!j.railWork?.source?.entering, 1000);
  const e = s.equipment.find((e) => e.id === j.equipment)!;
  assert.equal(j.railWork!.phase, 'source-approach');
  const source = j.railWork!.source!;
  delete source.approach;
  delete source.entering;
  // Old saves could retain reverse gear while their accepted path included a
  // forward entry. A real gear handoff must replace that serialized mismatch.
  e.reverse = true;
  Object.assign(s, S.load(S.save(s)));
  let sawForwardEntry = false,
    prior: { x: number; z: number } | undefined;
  tickUntil(
    s,
    () => s.jobs.find((job) => job.id === j.id)!.status === 'done',
    1600,
    () => {
      const current = s.jobs.find((job) => job.id === j.id)!,
        machine = s.equipment.find((q) => q.id === e.id)!;
      if (prior) assert.ok(Math.hypot(machine.x - prior.x, machine.z - prior.z) < 0.4);
      prior = { x: machine.x, z: machine.z };
      if (current.railWork?.phase === 'source-approach' && current.railWork.source?.entering) {
        assert.equal(machine.reverse, false);
        sawForwardEntry = true;
      }
    },
  );
  assert.ok(sawForwardEntry);
  assert.equal(s.rails.length, 1);
  assert.deepEqual(s.buffer, { x: 130, z: 5 });
});
