import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Sim from '../src/sim';
import { angleDelta, TAU } from '../src/motion';
import { renderState } from '../native-runtime/render';
import type { RailWorkPhase, State } from '../src/types';

function excavatorPose(s: State, id: string) {
  const actor = renderState(s).actors.find((a) => a.id === id);
  assert.ok(actor && 'upperYaw' in actor, 'Expected an excavator render pose');
  return actor;
}

function fixture(phase: RailWorkPhase = 'source-rig') {
  const s: State = Sim.load(readFileSync('native/tests/fixtures/rail-panel-staging.json', 'utf8'));
  const job = s.jobs.find((j) => j.railWork)!;
  const e = s.equipment.find((e) => e.id === job.equipment)!;
  const r = job.railWork!;
  e.path = [];
  e.yaw = 0.35;
  r.phase = phase;
  r.clock = 1.5;
  r.lifting = 'panel';
  r.panel = { ...r.panel, x: e.x - 3, z: e.z + 0.02, y: 0.65, state: 'staged' };
  if (phase.startsWith('buffer')) {
    r.lifting = 'buffer';
    r.buffer = { ...r.panel, id: 'BUFFER-001', carried: false, secured: false };
  }
  return { s, e, r, actor: () => excavatorPose(s, e.id) };
}

for (const phase of [
  'source-rig',
  'panel-rig',
  'buffer-rig',
  'buffer-rig-return',
  'panel-lower',
] as RailWorkPhase[]) {
  test(`native ${phase} rotates by a physical angle independent of accumulated chassis revolutions`, () => {
    const { s, e, r, actor } = fixture(phase);
    for (const clock of [0, 0.4, 1, 1.5, 2, 2.5, 3]) {
      r.clock = clock;
      e.yaw = 0.35;
      const baseline = actor().upperYaw;
      for (const turns of [-512, -9, -1, 0, 1, 9, 512]) {
        e.yaw = 0.35 + turns * TAU;
        const actual = actor().upperYaw;
        assert.ok(
          Math.abs(actual - baseline) < 1e-10,
          `clock=${clock}, turns=${turns}, yaw=${actual}, expected=${baseline}`,
        );
        assert.ok(Math.abs(actual) <= Math.PI, 'Rigging cannot request extra complete revolutions');
      }
    }
    // Render observation must not change the simulation's accumulated headings.
    const stable = Sim.save(s);
    actor();
    assert.equal(Sim.save(s), stable);
  });
}

test('loaded rail traveling with an excavator has zero relative cab swivel even after many chassis turns', () => {
  const { e, r, actor } = fixture('panel-carry');
  r.panel.state = 'carried';
  for (const turns of [-100, -9, 0, 9, 100]) {
    e.yaw = 0.35 + turns * TAU;
    assert.ok(
      Math.abs(actor().upperYaw) < 1e-10,
      'The raised arm travels with its chassis instead of unwinding',
    );
  }
});

test('rail load bearing across atan2 branch cut is a small physical change, not a full turn', () => {
  const { e, r, actor } = fixture('panel-lower');
  e.yaw = -Math.PI + 0.15;
  r.panel.z = e.z + 0.002;
  const before = actor().upperYaw;
  r.panel.z = e.z - 0.002;
  const after = actor().upperYaw;
  assert.ok(
    Math.abs(after - before) < 0.002,
    'Canonical relative swivel remains continuous beside the branch cut',
  );
  assert.ok(Math.abs(angleDelta(before, after)) < 0.002);
});

test('shed rigging uses a short relative swivel regardless of previous chassis revolutions', () => {
  const s: State = Sim.load(
    readFileSync('native/tests/fixtures/shed-partial-erection.json', 'utf8'),
  );
  const job = s.jobs.find((j) => j.shedAssembly?.part)!;
  const e = s.equipment.find((e) => e.id === job.equipment)!;
  const shed = job.shedAssembly!;
  shed.phase = 'rig';
  e.path = [];
  e.yaw = 0.35;
  const yaw = () => excavatorPose(s, e.id).upperYaw;
  for (const clock of [0, 0.4, 1, 1.5, 2]) {
    shed.clock = clock;
    e.yaw = 0.35;
    const expected = yaw();
    for (const turns of [-100, -1, 1, 100]) {
      e.yaw = 0.35 + turns * TAU;
      assert.ok(
        Math.abs(yaw() - expected) < 1e-10,
        'A half rigged shed part must not unwind chassis history',
      );
    }
  }
});
