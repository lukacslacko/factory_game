import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { angleDelta } from '../src/motion.ts';
import { RAIL_PANEL_PITCH } from '../src/railwork.ts';
import type { State, RailWorkPose } from '../src/types.ts';
import { tickUntil } from './support/yard.ts';

function balanced(s: State) {
  const total = S.totals(s, 'rail');
  assert.equal(
    total.delivered,
    total.stored + total.cargo + total.installed,
    `Rail panel lost or duplicated: ${JSON.stringify(total)}`,
  );
  for (const stack of s.stacks.filter((t) => t.item === 'rail'))
    assert.ok(stack.qty >= stack.reserved && stack.reserved >= 0);
}
function continuous(previous: RailWorkPose | undefined, current: RailWorkPose, label: string) {
  if (!previous) return;
  // At 100 ms, machine travel plus the outer sweep of a 4 m crane reach
  // can exceed half a meter; a whole-cell teleport cannot be hidden here.
  const distance = Math.hypot(
    current.x - previous.x,
    current.z - previous.z,
    current.y - previous.y,
  );
  assert.ok(distance < 1.3, `${label} jumps ${distance.toFixed(3)} m between simulation ticks`);
  assert.ok(Math.abs(current.y - previous.y) < 0.25, `${label} jumps vertically`);
  assert.ok(
    Math.abs(angleDelta(previous.yaw, current.yaw)) < 0.55,
    `${label} changes orientation instantaneously`,
  );
}

test('rail extension stages the panel, lifts the unfastened buffer aside, lays track, and refastens the same buffer', () => {
  const s = S.demoState();
  const job = S.plan(s, 'rail', 125, 4).job!;
  let sourceRigged = false,
    crewReserved = false,
    liftedFromSource = false,
    staged = false,
    released = false,
    aside = false,
    panelLifted = false,
    panelLowering = false,
    endLowering = false,
    fastening = false;
  let previousPanel: RailWorkPose | undefined, previousBuffer: RailWorkPose | undefined;
  let previousPanelState: string | undefined;
  tickUntil(
    s,
    () => job.status === 'done',
    1800,
    () => {
      balanced(s);
      if (!crewReserved && job.phase === 'Board equipment') {
        const crew = s.workers.find((w) => w.id === job.worker)!;
        assert.equal(
          crew.path.length,
          0,
          'Reserving a rail crew must not send them into the crane approach before it parks',
        );
        crewReserved = true;
      }
      const r = job.railWork;
      if (!r) return;
      continuous(previousPanel, r.panel, 'Rail panel');
      if (r.panel.state === 'stored') {
        const source = s.stacks.find((t) => t.id === r.source!.stackId)!;
        assert.ok(source);
        assert.ok(
          Math.hypot(r.panel.x - (source.x + source.w / 2), r.panel.z - (source.z + source.d / 2)) <
            0.001,
        );
        assert.ok(
          Math.abs(
            r.panel.y -
              ((source.qty - 1) * RAIL_PANEL_PITCH +
                (s.paving[`${source.x},${source.z}`] ? 0.105 : 0)),
          ) < 0.001,
          'The visible source panel must rest on the actual top layer',
        );
        assert.equal(s.equipment.find((e) => e.id === job.equipment)!.cargo, undefined);
        if (r.phase === 'source-rig' && r.clock > 0) sourceRigged = true;
      }
      if (previousPanelState === 'stored' && r.panel.state === 'carried') {
        assert.ok(
          sourceRigged,
          'A worker must attach the lifting tackle before stock leaves its stack',
        );
        assert.ok(
          Math.hypot(
            r.panel.x - previousPanel!.x,
            r.panel.z - previousPanel!.z,
            r.panel.y - previousPanel!.y,
          ) < 0.05,
          'The source panel must begin its lift from the stack, not appear at the excavator',
        );
        const rigger = s.workers.find((w) => w.id === job.worker)!;
        const dx = rigger.x - r.panel.x,
          dz = rigger.z - r.panel.z,
          c = Math.cos(r.panel.yaw),
          n = Math.sin(r.panel.yaw);
        const edgeDistance = Math.hypot(
          Math.max(0, Math.abs(dx * c + dz * n) - 2.5),
          Math.max(0, Math.abs(-dx * n + dz * c) - 1.5),
        );
        assert.ok(
          edgeDistance >= 0.45,
          'After attaching slings the rigger must walk clear of the full 5×3 m panel before it lifts',
        );
        assert.equal(
          rigger.path.length,
          0,
          'The lift must wait until the rigger finishes clearing the load',
        );
        liftedFromSource = true;
      }
      previousPanelState = r.panel.state;
      previousPanel = { ...r.panel };
      if (r.panel.state === 'staged') {
        staged = true;
        const stack = s.stacks.find((t) => t.id === r.panel.stackId)!;
        assert.ok(stack, 'A staged rail panel must remain real material in storage');
        assert.equal(stack.qty, 1);
        assert.equal(stack.reserved, 1);
        assert.equal(s.equipment.find((e) => e.id === job.equipment)!.cargo, undefined);
      }
      if (aside && r.panel.state === 'carried' && r.panel.y > 0.3) panelLifted = true;
      if (r.phase === 'panel-lower' && r.panel.y > 0 && r.panel.y < 0.6) panelLowering = true;
      if (r.panel.state === 'installed') {
        assert.ok(staged && released && aside && panelLifted && panelLowering);
        assert.equal(s.rails.filter((track) => track.id === r.panel.railId).length, 1);
      }
      const buffer = r.buffer!;
      assert.ok(buffer, 'Extending the existing siding must handle its buffer');
      assert.equal(buffer.id, 'BUFFER-001');
      continuous(previousBuffer, buffer, 'Buffer');
      if (!buffer.secured) released = true;
      if (Math.hypot(buffer.x - r.start.x, buffer.z - r.start.z) > 0.1 && !buffer.secured)
        assert.ok(released && staged);
      if (buffer.carried) {
        assert.equal(buffer.secured, false);
        const machine = s.equipment.find((e) => e.id === job.equipment)!;
        assert.equal(machine.operator, job.operator);
        assert.equal(s.workers.find((w) => w.id === job.operator)!.vehicle, machine.id);
      }
      if (
        !buffer.secured &&
        !buffer.carried &&
        buffer.y < 0.01 &&
        Math.hypot(buffer.x - r.start.x, buffer.z - r.start.z) > 3
      )
        aside = true;
      if (r.phase === 'buffer-lower-end' && buffer.y > 0 && buffer.y < 0.7) endLowering = true;
      if (r.phase === 'fasten-buffer' && r.clock > 0) {
        fastening = true;
        const crew = s.workers.find((w) => w.id === job.worker)!;
        assert.ok(
          Math.hypot(crew.x - buffer.x, crew.z - buffer.z) < 2.5,
          'A worker must be next to the buffer clamps to tighten them',
        );
      }
      assert.ok(Math.hypot(s.buffer.x - buffer.x, s.buffer.z - buffer.z) < 0.001);
      previousBuffer = { ...buffer };
    },
  );
  assert.ok(crewReserved && sourceRigged && liftedFromSource && endLowering && fastening);
  assert.equal(job.railWork!.buffer!.secured, true);
  assert.equal(job.railWork!.buffer!.carried, false);
  assert.ok(Math.abs(job.railWork!.buffer!.y - 0.2) < 0.001);
  assert.deepEqual(s.buffer, { x: 130, z: 5 });
  assert.equal(s.rails.length, 1);
  assert.equal(job.railWork!.panel.state, 'installed');
  assert.ok(
    s.events
      .filter((e) => e.type === 'Asset' && e.text.toLowerCase().includes('buffer'))
      .every((e) => e.entity === 'BUFFER-001'),
  );
});

test('rail staging reservations and suspended panel/buffer poses survive save and resume', () => {
  let s = S.demoState();
  const id = S.plan(s, 'rail', 125, 4).job!.id;
  for (const phase of [
    'source-lift',
    'unbolt-buffer',
    'buffer-carry-aside',
    'panel-carry',
    'buffer-carry-end',
  ]) {
    tickUntil(s, () => s.jobs.find((j) => j.id === id)!.railWork?.phase === phase, 1800);
    const previous = JSON.parse(S.save(s));
    s = S.load(S.save(s));
    assert.deepEqual(
      s.jobs.find((j) => j.id === id)!.railWork,
      previous.jobs.find((j: { id: string }) => j.id === id).railWork,
    );
    assert.deepEqual(s.equipment, previous.equipment);
    assert.deepEqual(s.stacks, previous.stacks);
    assert.deepEqual(s.buffer, previous.buffer);
    balanced(s);
  }
  tickUntil(
    s,
    () => s.jobs.find((j) => j.id === id)!.status === 'done',
    1800,
    () => balanced(s),
  );
  assert.deepEqual(s.buffer, { x: 130, z: 5 });
  assert.equal(s.jobs.find((j) => j.id === id)!.railWork!.buffer!.id, 'BUFFER-001');
});

test('canceling rail work with the buffer set aside returns it safely and retains the staged panel', () => {
  const s = S.demoState();
  const job = S.plan(s, 'rail', 125, 4).job!;
  tickUntil(s, () => job.railWork?.phase === 'panel-approach', 1800);
  const stackId = job.railWork!.panel.stackId;
  S.cancelJob(s, job.id);
  tickUntil(
    s,
    () => job.status === 'canceled',
    1800,
    () => balanced(s),
  );
  assert.deepEqual(s.buffer, { x: 125, z: 5 });
  assert.equal(job.railWork!.buffer!.id, 'BUFFER-001');
  assert.equal(job.railWork!.buffer!.secured, true);
  assert.equal(job.railWork!.buffer!.carried, false);
  assert.equal(s.rails.length, 0);
  const staged = s.stacks.find((t) => t.id === stackId)!;
  assert.equal(staged.qty, 1);
  assert.equal(staged.reserved, 0);
  assert.ok(s.equipment.every((e) => !e.cargo));
});

test('save validation rejects corrupt suspended rail poses and missing physical panel references', () => {
  const s = S.demoState();
  const job = S.plan(s, 'rail', 125, 4).job!;
  tickUntil(s, () => job.railWork?.phase === 'source-lift');
  const original = S.save(s);
  for (const mutate of [
    (v: any) => {
      v.jobs[0].railWork.panel.y = null;
    },
    (v: any) => {
      v.jobs[0].railWork.buffer.id = 'OTHER-BUFFER';
    },
    (v: any) => {
      v.jobs[0].railWork.source.workerPoint.x = null;
    },
    (v: any) => {
      delete v.equipment.find((e: any) => e.id === job.equipment).cargo;
    },
  ]) {
    const invalid = JSON.parse(original);
    mutate(invalid);
    assert.throws(() => S.load(JSON.stringify(invalid)), /Invalid save/);
  }
  tickUntil(s, () => job.railWork?.phase === 'unbolt-buffer');
  const staged = JSON.parse(S.save(s));
  staged.jobs[0].railWork.panel.stackId = 'MISSING-STACK';
  assert.throws(() => S.load(JSON.stringify(staged)), /reserved rail panel is missing/);
});

test('a version 3 yard migrates without changing its installed assets or inventory', () => {
  const s = S.demoState();
  const legacy = JSON.parse(S.save(s));
  legacy.version = 3;
  const restored = S.load(JSON.stringify(legacy));
  assert.equal(restored.version, 4);
  assert.deepEqual(restored.buffer, s.buffer);
  assert.deepEqual(restored.rails, s.rails);
  assert.deepEqual(restored.stacks, s.stacks);
  assert.deepEqual(restored.movements, s.movements);
  assert.deepEqual(restored.costs, s.costs);
});
