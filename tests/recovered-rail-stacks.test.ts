import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS } from '../src/catalog';
import { appendRailLayers, takeRailLayers } from '../src/rail-stock';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { Item, Stack, State } from '../src/types';

function yard(count = 4) {
  const s = S.createState();
  S.setCreativeMode(s, true);
  assert.equal(S.addZone(s, { x: 70, z: 35, w: 60, d: 30 }, 'Recovered rail'), '');
  for (let n = 0; n < count; n++)
    assert.equal(S.planRailLayout(s, 'straight', { x: 125 + n * 5, z: 5 }).error, '');
  return s;
}
function railStacks(s: State, item: Item = 'rail') {
  return s.stacks.filter((t) => t.item === item && t.qty > 0);
}
function identities(stack: Stack): (string | null)[] {
  const layers = (stack as Stack & { railAssetIds?: (string | null)[] }).railAssetIds;
  assert.ok(layers, 'A stacked recovered rail has explicit bottom-to-top identity layers');
  assert.equal(layers.length, stack.qty, 'Every physical layer has exactly one identity slot');
  return layers;
}
function stock(s: State, qty: number, item: Item = 'rail', hand: 1 | -1 = 1): Stack {
  const m = MATERIALS[item];
  const t: Stack = {
    id: S.id(s, 'stack'),
    item,
    qty,
    reserved: 0,
    source: 'fixture-delivery',
    x: 70,
    z: 35,
    w: m.w,
    d: m.d,
    trackHand: hand,
  };
  s.stacks.push(t);
  return t;
}

test('Creative recovery stacks consecutive straight panels and preserves all identities through reload', () => {
  let s = yard();
  const original = s.rails.slice(0, 3).map((r) => r.id);
  for (const railId of original) assert.equal(S.removeRailInfrastructure(s, railId), '');
  const stacks = railStacks(s);
  assert.equal(stacks.length, 1);
  assert.equal(stacks[0].qty, 3);
  assert.deepEqual(identities(stacks[0]), original);
  assert.equal(s.rails.length, 1);
  s = S.load(S.save(s));
  assert.deepEqual(identities(railStacks(s)[0]), original);
  assert.equal(new Set([...s.rails.map((r) => r.id), ...identities(railStacks(s)[0])]).size, 4);
});

test('recovery tops up delivered stock without assigning false identities to its anonymous layers', () => {
  const s = yard();
  const existing = stock(s, 3);
  const original = s.rails.slice(0, 2).map((r) => r.id);
  for (const railId of original) assert.equal(S.removeRailInfrastructure(s, railId), '');
  assert.equal(railStacks(s).length, 1);
  assert.equal(existing.qty, 5);
  assert.deepEqual(identities(existing), [null, null, null, ...original]);
  assert.deepEqual(S.load(S.save(s)).stacks, JSON.parse(S.save(s)).stacks);
});

test('Creative recovery fills an existing stack to eight and allocates only the overflow', () => {
  const s = yard();
  const existing = stock(s, 7);
  const original = s.rails.slice(0, 3).map((r) => r.id);
  for (const railId of original) assert.equal(S.removeRailInfrastructure(s, railId), '');
  const stacks = railStacks(s);
  assert.equal(stacks.length, 2);
  assert.equal(existing.qty, 8);
  const overflow = stacks.find((t) => t.id !== existing.id)!;
  assert.equal(overflow.qty, 2);
  assert.deepEqual(identities(existing), [...Array(7).fill(null), original[0]]);
  assert.deepEqual(identities(overflow), original.slice(1));
  assert.ok(
    existing.x !== overflow.x || existing.z !== overflow.z,
    'Overflow has its own finite footprint',
  );
  assert.ok(stacks.every((t) => t.qty <= MATERIALS.rail.max));
  S.load(S.save(s));
});

test('a full finite stockyard accepts its final stack layer, then rejects further recovery atomically', () => {
  const s = yard(3);
  s.zones = [{ ...s.zones[0], x: 70, z: 35, w: 5, d: 3 }];
  const existing = stock(s, 7);
  const [first, second] = s.rails;
  assert.equal(S.removeRailInfrastructure(s, first.id), '');
  assert.equal(existing.qty, 8);
  const before = S.save(s);
  assert.match(S.removeRailInfrastructure(s, second.id), /stockyard space/);
  assert.equal(
    S.save(s),
    before,
    'Failed recovery changes no rails, layers, jobs, events, buffers, or IDs',
  );
});

test('Creative curve recovery merges whole assemblies by hand and splits only above eight layers', () => {
  const s = yard(0);
  s.zones = [{ ...s.zones[0], x: 45, z: 75, w: 70, d: 30 }];
  for (const [x, z, heading, hand] of [
    [125, 5, 0, 1],
    [145, 25, 1, 1],
    [125, 45, 2, -1],
  ] as const)
    assert.equal(S.planRailLayout(s, 'curve', { x, z }, heading, hand).error, '');
  const groups = [...new Set(s.rails.map((r) => r.track!.groupId))];
  const original = s.rails.map((r) => r.id);
  for (const groupId of groups) {
    const rail = s.rails.find((r) => r.track!.groupId === groupId)!;
    assert.equal(S.removeRailInfrastructure(s, rail.id, 'assembly'), '');
  }
  const curves = railStacks(s, 'railCurve');
  assert.deepEqual(
    curves
      .filter((t) => t.trackHand === 1)
      .map((t) => t.qty)
      .sort((a, b) => a - b),
    [4, 8],
  );
  assert.deepEqual(
    curves.filter((t) => t.trackHand === -1).map((t) => t.qty),
    [6],
  );
  assert.deepEqual(curves.flatMap(identities).sort(), original.sort());
  assert.equal(s.rails.length, 0);
  assert.deepEqual(S.load(S.save(s)).stacks, JSON.parse(S.save(s)).stacks);
});

test('recovered switch modules stack with their own type and preserve all installed component identities', () => {
  const s = yard(0);
  for (const x of [125, 145]) assert.equal(S.planRailLayout(s, 'turnout', { x, z: 5 }).error, '');
  const original = s.rails.map((r) => ({ id: r.id, item: r.item! }));
  const groups = [...new Set(s.rails.map((r) => r.track!.groupId))];
  for (const groupId of groups)
    assert.equal(
      S.removeRailInfrastructure(
        s,
        s.rails.find((r) => r.track!.groupId === groupId)!.id,
        'assembly',
      ),
      '',
    );
  for (const item of ['rail', 'railPoints', 'railFrog', 'railClosure', 'railExit'] as Item[]) {
    const stacks = railStacks(s, item);
    assert.equal(stacks.length, 1, `${item} has one compact stack`);
    assert.equal(stacks[0].qty, item === 'rail' ? 6 : 2);
    assert.deepEqual(
      identities(stacks[0]).slice().sort(),
      original
        .filter((r) => r.item === item)
        .map((r) => r.id)
        .sort(),
    );
  }
  S.load(S.save(s));
});

test('reserved stock is excluded from Creative recovery top-ups', () => {
  const s = yard();
  const existing = stock(s, 3);
  existing.reserved = 1;
  const target = s.rails[0];
  assert.equal(S.removeRailInfrastructure(s, target.id), '');
  assert.equal(existing.qty, 3);
  assert.equal(existing.reserved, 1);
  assert.equal(railStacks(s).length, 2);
  const recovered = railStacks(s).find((t) => t.id !== existing.id)!;
  assert.equal(recovered.assetId, target.id);
});

test('normal reinstallation consumes recovered stack layers in order without duplicating installed identities', () => {
  let s = yard(3);
  const first = s.rails[0].id,
    second = s.rails[1].id;
  assert.equal(S.removeRailInfrastructure(s, first), '');
  assert.equal(S.removeRailInfrastructure(s, second), '');
  assert.deepEqual(identities(railStacks(s)[0]), [first, second]);
  s = S.load(S.save(s));
  S.setCreativeMode(s, false);
  const e = seedHandlingResources(s, 'excavator');
  Object.assign(e, { x: 120, z: 25 });
  Object.assign(s.workers[0], { x: 120, z: 22 });
  Object.assign(s.workers[1], { x: 118, z: 23 });
  const rebuilt = S.planRailLayout(s, 'straight', { x: 135, z: 5 }, 2);
  assert.equal(rebuilt.error, '');
  tickUntil(s, () => rebuilt.jobs[0].status === 'done', 1200);
  assert.ok(
    s.rails.some((r) => r.id === second),
    'The physical top layer retains its recovered rail ID',
  );
  const remaining = railStacks(s)[0];
  assert.equal(remaining.qty, 1);
  assert.equal(remaining.assetId, first);
  assert.equal(new Set(s.rails.map((r) => r.id)).size, s.rails.length);
  s = S.load(S.save(s));
  const final = S.planRailLayout(s, 'straight', { x: 130, z: 5 }, 2);
  assert.equal(final.error, '');
  tickUntil(s, () => final.jobs[0].status === 'done', 1200);
  assert.ok(s.rails.some((r) => r.id === first));
  assert.equal(railStacks(s).length, 0);
  assert.equal(new Set(s.rails.map((r) => r.id)).size, 3);
  S.load(S.save(s));
});

test('active rail staging stock is not silently enlarged by Creative recovery', () => {
  const s = yard();
  const existing = stock(s, 3);
  S.setCreativeMode(s, false);
  const staged = S.planRailLayout(s, 'straight', { x: 145, z: 5 });
  assert.equal(staged.error, '');
  const job = staged.jobs[0];
  existing.source = job.id;
  existing.railStagingJobs = [job.id];
  job.stack = existing.id;
  job.legacyRailHandoff = 'staged';
  S.setCreativeMode(s, true);
  const target = s.rails[0];
  assert.equal(S.removeRailInfrastructure(s, target.id), '');
  assert.equal(existing.qty, 3);
  assert.equal(railStacks(s).length, 2);
  assert.equal(railStacks(s).find((t) => t.id !== existing.id)!.assetId, target.id);
});

test('normal recovery physically lowers its panel onto compatible recovered storage', () => {
  const s = yard();
  const first = s.rails[0].id,
    second = s.rails[1].id;
  assert.equal(S.removeRailInfrastructure(s, first), '');
  const existing = railStacks(s)[0];
  S.setCreativeMode(s, false);
  const e = seedHandlingResources(s, 'excavator');
  Object.assign(e, { x: 130, z: 18 });
  Object.assign(s.workers[0], { x: 126, z: 18 });
  Object.assign(s.workers[1], { x: 126, z: 15 });
  assert.equal(S.removeRailInfrastructure(s, second), '');
  const recovery = s.jobs.find((j) => j.railRecovery?.railId === second)!;
  const phases = new Set<string>();
  tickUntil(
    s,
    () => recovery.status === 'done',
    1200,
    () => {
      if (recovery.railWork) phases.add(recovery.railWork.phase);
      const accounted =
        s.rails.filter((r) => r.item === 'rail').length +
        railStacks(s).reduce((n, t) => n + t.qty, 0) +
        s.equipment.reduce((n, t) => n + (t.cargo?.item === 'rail' ? t.cargo.qty : 0), 0);
      assert.equal(accounted, 4, 'Installed, stored, and carried physical rail remain conserved');
    },
  );
  assert.ok(phases.has('stage-lower'), 'The recovered panel is physically lowered at storage');
  assert.equal(e.cargo, undefined);
  assert.equal(railStacks(s).length, 1);
  assert.equal(existing.qty, 2);
  assert.deepEqual(identities(existing), [first, second]);
  assert.deepEqual(S.load(S.save(s)).stacks, JSON.parse(S.save(s)).stacks);
});

test('supplier top-up leaves recovered identities underneath anonymous new steel', () => {
  const s = S.createState();
  assert.equal(S.addZone(s, { x: 40, z: 30, w: 5, d: 3 }), '');
  const recoveredId = S.id(s, 'rail');
  const stack: Stack = {
    id: S.id(s, 'stack'),
    item: 'rail',
    qty: 1,
    reserved: 0,
    source: recoveredId,
    assetId: recoveredId,
    x: 40,
    z: 30,
    w: 5,
    d: 3,
  };
  s.stacks.push(stack);
  seedHandlingResources(s, 'forklift');
  S.purchase(s, 'rail', 2, 'road');
  tickUntil(s, () => s.orders.every((o) => o.status === 'done'), 1800);
  assert.equal(s.stacks.filter((t) => t.item === 'rail' && t.qty).length, 1);
  assert.deepEqual(identities(stack), [recoveredId, null, null]);
  assert.deepEqual(takeRailLayers(stack, 2), [null, null]);
  assert.equal(stack.assetId, recoveredId);
  assert.deepEqual(takeRailLayers(stack, 1), [recoveredId]);
  assert.equal(stack.assetId, undefined);
  S.load(S.save(s));
});

test('layer helpers retain batch order and reject damaged identity arrays on reload', () => {
  const s = yard(0),
    t = stock(s, 2);
  appendRailLayers(t, ['RAIL-9010', 'RAIL-9011']);
  assert.deepEqual(takeRailLayers(t, 2), ['RAIL-9010', 'RAIL-9011']);
  appendRailLayers(t, ['RAIL-9010', 'RAIL-9011']);
  S.load(S.save(s));
  t.railAssetIds = [null, null, 'RAIL-9010'];
  assert.throws(() => S.load(S.save(s)), /rail layer identities/);
  t.railAssetIds = [null, null, 'RAIL-9010', 'RAIL-9010'];
  assert.throws(() => S.load(S.save(s)), /rail layer identities/);
});
