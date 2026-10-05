import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { setJobEquipment } from '../src/jobs';
import { MATERIALS, ROLES } from '../src/catalog';
import { seedHandlingResources, tickUntil, advance } from './support/yard';
import type { State } from '../src/types';
function fixture(fork = false) {
  const s = S.createState(),
    e = seedHandlingResources(s, fork ? 'forklift' : 'excavator');
  if (fork)
    s.workers.push({
      ...s.workers[0],
      id: S.id(s, 'worker'),
      name: 'Worker #2',
      role: 'builder',
      wage: ROLES.builder.wage,
      x: 15,
      z: 25,
    });
  const t = {
    id: S.id(s, 'stack'),
    item: 'rail' as const,
    x: 30,
    z: 29,
    w: 5,
    d: 3,
    qty: 3,
    reserved: 0,
    source: 'opening',
  };
  s.stacks.push(t);
  s.zones.push({ id: S.id(s, 'zone'), name: 'Clear stockyard', x: 25, z: 20, w: 65, d: 55 });
  const result = S.moveRailStock(s, t.id, { x: 65, z: 40, w: 5, d: 3 });
  assert.equal(result.error, '');
  assert.equal(setJobEquipment(s, result.job!.parentId!, e.id), '');
  return { s, e, t, j: result.job! };
}
function balance(s: State) {
  assert.equal(S.totals(s, 'rail').stored + S.totals(s, 'rail').cargo, 3);
  assert(s.stacks.every((t) => t.reserved >= 0 && t.qty >= t.reserved));
}
test('rail relocation physically lifts one exact-source panel, lowers ordinary stock and releases only after withdrawal', () => {
  const { s, e, t, j } = fixture();
  let lifted = false,
    lowered = false,
    release = false;
  const phases = new Set();
  const oldBuffer = { ...s.buffer };
  tickUntil(
    s,
    () => j.status === 'done',
    1200,
    () => {
      balance(s);
      phases.add(j.railWork?.phase);
      if (e.cargo) {
        lifted = true;
        assert.equal(t.qty, 2);
        assert.equal(e.cargo.qty, 1);
      }
      if (j.status === 'doing' && j.railWork?.panel.state === 'staged') {
        lowered = true;
        assert.equal(e.job, j.id);
        const dest = s.stacks.find((k) => k.id === j.railWork!.panel.stackId)!;
        assert.equal(dest.reserved, 1);
        assert.equal(dest.railStagingJobs, undefined);
        assert.equal(dest.x, 65);
        assert.equal(dest.z, 40);
      }
      if (j.status === 'done') release = true;
    },
  );
  assert(lifted && lowered && release);
  assert(phases.has('source-rig'));
  assert(phases.has('stage-lower'));
  assert(phases.has('legacy-fork-withdraw'));
  assert.deepEqual(s.buffer, oldBuffer);
  assert.equal(s.rails.length, 0);
  assert.equal(t.qty, 2);
  assert.equal(t.reserved, 0);
  S.load(S.save(s));
});
test('forklift rail relocation uses hired operator and rigger, remains conserved through carried save reload', () => {
  let { s, e, t, j } = fixture(true);
  tickUntil(
    s,
    () => !!e.cargo,
    1200,
    () => balance(s),
  );
  s = S.load(S.save(s));
  j = s.jobs.find((k) => k.id === j.id)!;
  tickUntil(
    s,
    () => j.status === 'done',
    1200,
    () => balance(s),
  );
  assert.equal(s.stacks.find((k) => k.id === t.id)!.qty, 2);
  assert.equal(s.equipment[0].cargo, undefined);
});
test('canceling queued, source-rigging or carried relocation keeps every panel in physical stock', () => {
  for (const at of ['queued', 'rigged', 'carried']) {
    const { s, e, j } = fixture();
    if (at !== 'queued')
      tickUntil(
        s,
        () => (at === 'carried' ? !!e.cargo : j.railWork?.phase === 'source-rig'),
        1200,
        () => balance(s),
      );
    S.cancelJob(s, j.id);
    tickUntil(
      s,
      () => j.status === 'canceled',
      1200,
      () => balance(s),
    );
    assert.equal(e.cargo, undefined);
    assert.equal(S.totals(s, 'rail').stored, 3);
    S.load(S.save(s));
  }
});
test('relocation refuses reserved source or an occupied/nonstockyard destination and never orders duplicate material', () => {
  const { s, t, j } = fixture();
  assert.deepEqual(S.missingMaterials(s), {});
  assert.match(S.stockMoveError(s, t.id, { x: 30, z: 29, w: 5, d: 3 }), /already queued/);
  S.cancelJob(s, j.id);
  t.reserved = 3;
  assert.match(S.stockMoveError(s, t.id, { x: 65, z: 40, w: 5, d: 3 }), /unreserved/);
  t.reserved = 0;
  assert.match(S.stockMoveError(s, t.id, { x: 5, z: 80, w: 5, d: 3 }), /stockyard/);
  assert.match(S.stockMoveError(s, t.id, { x: 30, z: 29, w: 5, d: 3 }), /overlaps/);
  assert.equal(S.buyMissing(s), 0);
});
test('malformed relocation save cannot redirect load outside its saved destination', () => {
  const { s, j } = fixture();
  const invalid = JSON.parse(S.save(s));
  invalid.jobs[0].stockMove.destination.x = 999;
  assert.throws(() => S.load(JSON.stringify(invalid)), /stock relocation/);
});

test('supported relocation stays reserved until the machine withdraws, including saved cancellation', () => {
  let { s, e, j } = fixture(true);
  tickUntil(s, () => j.railWork?.panel.state === 'staged', 1200);
  const dest = j.railWork!.panel.stackId!;
  assert.equal(s.stacks.find((t) => t.id === dest)!.reserved, 1);
  s = S.load(S.save(s));
  j = s.jobs.find((k) => k.id === j.id)!;
  S.cancelJob(s, j.id);
  tickUntil(
    s,
    () => j.status === 'canceled',
    1200,
    () => balance(s),
  );
  assert.equal(s.stacks.find((t) => t.id === dest)!.reserved, 0);
  S.load(S.save(s));
});

test('automatic rail assignment reserves an exposed matching pile before a boxed-in first pile', () => {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  const t = {
    id: S.id(s, 'stack'),
    item: 'rail' as const,
    x: 40,
    z: 24,
    w: 5,
    d: 3,
    qty: 1,
    reserved: 0,
    source: 'opening',
  };
  s.stacks.push(t);
  for (const [x, z, w, d] of [
    [39, 23, 7, 1],
    [39, 27, 7, 1],
    [39, 24, 1, 3],
    [45, 24, 1, 3],
  ])
    s.buildings.push({
      id: S.id(s, 'building'),
      kind: 'office',
      name: 'Existing enclosure',
      x,
      z,
      w,
      d,
      rotation: 0,
      connected: false,
    });
  const outer = { ...t, id: S.id(s, 'stack'), x: 60, z: 35 };
  s.stacks.push(outer);
  const j = S.plan(s, 'rail', 125, 4).job!;
  tickUntil(s, () => j.status === 'doing', 30);
  assert.equal(j.stack, outer.id);
  assert.equal(t.reserved, 0);
  assert.equal(outer.reserved, 1);
});

test('rotated curved rail relocation preserves handed steel and occupies the original rotated footprint', () => {
  const s = S.createState();
  seedHandlingResources(s, 'excavator');
  s.zones.push({ id: S.id(s, 'zone'), name: 'Rotated steel', x: 25, z: 20, w: 65, d: 55 });
  const t = {
    id: S.id(s, 'stack'),
    item: 'railCurve' as const,
    x: 30,
    z: 29,
    w: 3,
    d: 6,
    qty: 2,
    reserved: 0,
    source: 'opening',
    yaw: Math.PI / 2,
    trackHand: -1 as const,
  };
  s.stacks.push(t);
  const { job: j, error } = S.moveRailStock(s, t.id, { x: 65, z: 40, w: 3, d: 6 });
  assert.equal(error, '');
  tickUntil(s, () => j!.status === 'done', 1200);
  const placed = s.stacks.find((k) => k.x === 65 && k.z === 40)!;
  assert.equal(placed.item, 'railCurve');
  assert.equal(placed.trackHand, -1);
  assert.equal(placed.yaw, Math.PI / 2);
  assert.equal(placed.qty, 1);
  assert.equal(t.qty, 1);
  S.load(S.save(s));
});
