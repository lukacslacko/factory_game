import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import type { EquipmentKind, State, RailWorkPose } from '../src/types.ts';
import { angleDelta, localPoint } from '../src/motion.ts';
import { parcelPitch } from '../src/delivery.ts';
import { equipmentBoxes, boxOverlap } from '../src/traffic.ts';
import { tickUntil, advance } from './support/yard.ts';

function fixture(kind: EquipmentKind) {
  const s = S.demoState();
  s.equipment = s.equipment.filter((e) => e.kind === kind);
  s.jobs = [];
  const j = S.plan(s, 'slab', 50, 45).job!;
  return { s, j, e: s.equipment[0] };
}
function balance(s: State) {
  const t = S.totals(s, 'slab');
  assert.equal(t.delivered + t.recovered, t.stored + t.cargo + t.installed, JSON.stringify(t));
  for (const t of s.stacks) assert.ok(t.reserved >= 0 && t.reserved <= t.qty);
}
for (const kind of ['forklift', 'excavator'] as const) {
  test(`${kind} picks the actual top slab, faces both endpoints, and places continuously without lateral jumps`, () => {
    const { s, j, e } = fixture(kind);
    let before: RailWorkPose | undefined;
    let priorState = '';
    const phases = new Set<string>();
    tickUntil(
      s,
      () => j.status === 'done',
      600,
      () => {
        balance(s);
        const h = j.handling;
        if (!h) return;
        phases.add(h.phase);
        if (h.state === 'stored') {
          const t = s.stacks.find((t) => t.id === h.sourceId)!;
          assert.equal(h.pose.x, t.x + t.w / 2);
          assert.equal(h.pose.z, t.z + t.d / 2);
          assert.ok(Math.abs(h.pose.y - (0.08 + (t.qty - 1) * parcelPitch('slab'))) < 1e-8);
        }
        if (before) {
          const displacement = Math.hypot(
            h.pose.x - before.x,
            h.pose.z - before.z,
            h.pose.y - before.y,
          );
          assert.ok(displacement < 0.8, `${kind} ${h.phase}: slab jumps ${displacement} m`);
          assert.ok(Math.abs(h.pose.y - before.y) < 0.11, `${kind}: vertical discontinuity`);
        }
        if (h.state === 'carried') {
          assert.equal(e.cargo?.qty, 1);
          assert.equal(s.workers.find((w) => w.id === e.operator)?.vehicle, e.id);
          const contact = localPoint({ ...e, yaw: e.yaw || 0 }, h.reach, 0);
          assert.ok(
            Math.hypot(contact.x - h.pose.x, contact.z - h.pose.z) < 0.03,
            `${kind} tool not below its slab`,
          );
        }
        if (['lift', 'lower'].includes(h.phase))
          assert.ok(
            Math.abs(angleDelta(e.yaw || 0, Math.atan2(h.pose.z - e.z, h.pose.x - e.x))) < 0.02,
          );
        if (h.state === 'placed') {
          const t = s.stacks.find((t) => t.id === h.placedStack)!;
          assert.equal(t.qty, 1);
          assert.equal(t.reserved, 1);
          assert.equal(e.cargo, undefined);
        }
        if (priorState === 'stored' && h.state === 'carried')
          assert.ok(
            Math.hypot(h.pose.x - h.source.x, h.pose.z - h.source.z, h.pose.y - h.source.y) < 0.001,
          );
        before = { ...h.pose };
        priorState = h.state;
      },
    );
    for (const p of ['rig', 'lift', 'clear', 'carry', 'lower', 'withdraw', 'settle'])
      assert.ok(phases.has(p), `missing ${p}`);
    if (kind === 'forklift') assert.ok(phases.has('engage'));
    assert.equal(j.handling!.pose.y, -0.015);
    assert.equal(s.paving['50,45'], j.id);
  });
  test(`${kind} slab poses and ownership survive every active save phase`, () => {
    const initial = fixture(kind);
    let s = initial.s;
    const id = initial.j.id;
    const saved = new Set<string>();
    for (let n = 0; n < 6000 && s.jobs.find((j) => j.id === id)!.status !== 'done'; n++) {
      S.tick(s, 0.1);
      const j = s.jobs.find((j) => j.id === id)!,
        h = j.handling;
      if (!h) continue;
      if (!saved.has(h.phase)) {
        saved.add(h.phase);
        const h0 = structuredClone(h);
        s = S.load(S.save(s));
        assert.deepEqual(s.jobs.find((j) => j.id === id)!.handling, h0);
      }
      balance(s);
    }
    assert.equal(s.jobs.find((j) => j.id === id)!.status, 'done');
    assert.ok(saved.has('withdraw') && saved.has('settle'));
  });
}
test('canceling a carried or supported construction slab retains one real accessible stack', () => {
  for (const at of ['carry', 'settle']) {
    const { s, j } = fixture('forklift');
    tickUntil(s, () => j.handling?.phase === at, 500);
    if (at === 'settle') advance(s, 1.5);
    const prior = { ...j.handling!.pose };
    S.cancelJob(s, j.id);
    S.tick(s, 0.1);
    assert.ok(Math.abs(j.handling!.pose.y - prior.y) < (at === 'settle' ? 0.01 : 0.05));
    tickUntil(
      s,
      () => j.status === 'canceled',
      500,
      () => balance(s),
    );
    assert.equal(s.paving['50,45'], undefined);
    const stack = s.stacks.find((t) => t.id === j.handling!.placedStack)!;
    assert.equal(stack.qty, 1);
    assert.equal(stack.reserved, 0);
    assert.ok(Math.abs(j.handling!.pose.y - 0.08) < 1e-8);
  }
});
test('construction slab remains attached when fuel runs out and resumes after a real refueling job', () => {
  const { s, j, e } = fixture('excavator');
  tickUntil(s, () => j.handling?.phase === 'carry' && e.path.length > 0, 500);
  e.fuel = 0.00001;
  S.tick(s, 0.1);
  const frozen = { ...j.handling!.pose };
  advance(s, 3);
  assert.deepEqual(j.handling!.pose, frozen);
  assert.equal(S.refuel(s, e.id), '');
  tickUntil(
    s,
    () => j.status === 'done',
    900,
    () => balance(s),
  );
  assert.ok(s.events.some((ev) => ev.text.includes('using a service can')));
});
test('a legacy v4 in-transit slab adopts its visible pose and completes without a snap', () => {
  const { s, j, e } = fixture('forklift');
  tickUntil(s, () => j.handling?.phase === 'carry', 500);
  j.handling = undefined;
  j.phase = 'Carry to site';
  e.reach = 2.7;
  e.lift = 0.12;
  const expected = localPoint({ ...e, yaw: e.yaw || 0 }, 2.7, 0);
  e.path = [];
  const restored = S.load(S.save(s));
  S.tick(restored, 0.1);
  const h = restored.jobs.find((k) => k.id === j.id)!.handling!;
  assert.ok(Math.hypot(h.pose.x - expected.x, h.pose.z - expected.z) < 0.08);
  assert.ok(Math.abs(h.pose.y - 0.2) < 0.05);
  tickUntil(
    restored,
    () => restored.jobs.find((k) => k.id === j.id)!.status === 'done',
    600,
    () => balance(restored),
  );
});
test('dense multi-cell paving consumes distinct slabs and all cells complete', () => {
  const { s } = fixture('forklift');
  s.jobs = [];
  S.pave(s, { x: 46, z: 42, w: 3, d: 3 });
  tickUntil(
    s,
    () => s.jobs.every((j) => j.status === 'done'),
    1800,
    () => balance(s),
  );
  assert.equal(s.jobs.length, 9);
  assert.equal(Object.values(s.paving).filter((v) => v !== 'EXISTING').length, 9);
});
test('save validation rejects a nonfinite slab pose or missing temporary setdown stock', () => {
  const { s, j } = fixture('forklift');
  tickUntil(s, () => j.handling?.phase === 'settle', 500);
  const data = JSON.parse(S.save(s));
  data.jobs.find((k: any) => k.id === j.id).handling.pose.y = null;
  assert.throws(() => S.load(JSON.stringify(data)), /construction slab handling/);
  const missing = JSON.parse(S.save(s));
  missing.stacks = missing.stacks.filter((t: any) => t.id !== j.handling!.placedStack);
  assert.throws(() => S.load(JSON.stringify(missing)), /missing placed construction slab/);
});

test('two machines share one slab stack without entering its pickup lane together', () => {
  const s = S.demoState();
  s.jobs = [];
  const stock = s.stacks.find((t) => t.item === 'slab')!;
  s.stacks = s.stacks.filter((t) => t.item !== 'slab' || t.id === stock.id);
  const a = S.plan(s, 'slab', 50, 45).job!,
    b = S.plan(s, 'slab', 58, 45).job!;
  tickUntil(
    s,
    () => a.status === 'done' && b.status === 'done',
    900,
    () => {
      const picking = s.jobs.filter(
        (j) =>
          j.status === 'doing' &&
          j.handling?.sourceId === stock.id &&
          ['approach', 'rig', 'engage', 'lift', 'clear'].includes(j.handling.phase),
      );
      assert.ok(picking.length <= 1, 'Two machines occupy the same pickup lane');
    },
  );
  assert.equal(stock.qty, 10);
});

test('adjacent slab stacks reserve their future lifted parcels before two machines approach', () => {
  const s = S.demoState();
  s.jobs = [];
  const stocks = s.stacks.filter((t) => t.item === 'slab').slice(0, 2);
  s.stacks = s.stacks.filter((t) => t.item !== 'slab' || stocks.includes(t));
  for (const t of stocks) t.qty = 2;
  for (const [x, z] of [
    [50, 45],
    [62, 45],
    [50, 49],
    [62, 49],
  ])
    S.plan(s, 'slab', x, z);
  tickUntil(
    s,
    () => s.jobs.every((j) => j.status === 'done'),
    1200,
    () => {
      const loaded = s.equipment.filter((e) => e.cargo?.item === 'slab');
      if (loaded.length === 2)
        assert.equal(
          boxOverlap(equipmentBoxes(loaded[0]).at(-1)!, equipmentBoxes(loaded[1]).at(-1)!, 0.025),
          false,
          'Two lifted slabs overlap',
        );
    },
  );
  assert.equal(
    stocks.reduce((n, t) => n + t.qty, 0),
    0,
  );
});
