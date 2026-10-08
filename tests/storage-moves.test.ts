import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { EQUIPMENT, MATERIALS } from '../src/catalog';
import { equipmentSweepBlocked } from '../src/traffic';
import { angleDelta } from '../src/motion';
import { seedHandlingResources, stateSummary, tickUntil } from './support/yard';
import { setJobEquipment } from '../src/jobs';
import type { EquipmentKind, Item, Stack, State } from '../src/types';

function fixture(item: Item = 'cableReel', quantity = 1, kind: EquipmentKind = 'forklift') {
  const s = S.createState();
  assert.equal(S.addZone(s, { x: 52, z: 36, w: 20, d: 20 }, 'Electrical stores'), '');
  assert.equal(S.addZone(s, { x: 82, z: 36, w: 20, d: 20 }, 'East stockyard'), '');
  // Both lifting machines have their own real operator and a construction helper.
  const e = seedHandlingResources(s, 'excavator');
  Object.assign(e, {
    kind,
    x: 25.5,
    z: 45.5,
    yaw: 0,
    tank: EQUIPMENT[kind].tank,
    fuel: EQUIPMENT[kind].tank,
  });
  Object.assign(s.workers[0], { x: 24.5, z: 42.5 });
  Object.assign(s.workers[1], { x: 28.5, z: 49.5 });
  const m = MATERIALS[item];
  const t: Stack = {
    id: S.id(s, 'stack'),
    item,
    qty: quantity,
    reserved: 0,
    x: 35,
    z: 45,
    w: m.w,
    d: m.d,
    source: 'opening',
    ...(item === 'cableReel' ? { cableMeters: 18.75 } : {}),
    ...(item === 'diesel' ? { liters: 72.5 } : {}),
  };
  s.stacks.push(t);
  return { s, e, t };
}

function physicalCount(s: State, item: Item) {
  return (
    s.stacks.filter((t) => t.item === item).reduce((n, t) => n + t.qty, 0) +
    s.equipment.reduce((n, e) => n + (e.cargo?.item === item ? e.cargo.qty : 0), 0)
  );
}
function conservedContents(s: State, item: 'cableReel' | 'diesel') {
  const key = item === 'cableReel' ? 'cableMeters' : 'liters';
  return (
    s.stacks.filter((t) => t.item === item && t.qty > 0).reduce((n, t) => n + (t[key] || 0), 0) +
    s.jobs.reduce((n, j) => {
      const e = s.equipment.find((e) => e.job === j.id);
      return n + (e?.cargo?.item === item ? j.stockMove?.load?.[key] || 0 : 0);
    }, 0)
  );
}
function inside(t: Stack, zone: State['zones'][number]) {
  return (
    t.x >= zone.x && t.z >= zone.z && t.x + t.w <= zone.x + zone.w && t.z + t.d <= zone.z + zone.d
  );
}

function completeMoves(initial: State, jobIds: string[], item: Item, quantity: number) {
  let s = initial;
  const phases = new Set<string>(),
    savedPhases = new Set<string>();
  let sawOperator = false,
    reloadedCarried = false,
    traveledWithLoad = 0;
  const contents =
    item === 'cableReel' || item === 'diesel' ? conservedContents(s, item) : undefined;
  for (
    let n = 0;
    n < 15000 && !jobIds.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done');
    n++
  ) {
    const old = s.equipment.map((e) => ({ ...e, path: e.path.slice() }));
    S.tick(s, 0.1);
    assert.equal(
      physicalCount(s, item),
      quantity,
      'No existing material is purchased, invented, or lost in transit',
    );
    if (contents !== undefined)
      assert.equal(
        conservedContents(s, item as 'cableReel' | 'diesel'),
        contents,
        'Partial reel or drum contents remain exact at every step',
      );
    for (const before of old) {
      const e = s.equipment.find((q) => q.id === before.id)!;
      const moved = Math.hypot(e.x - before.x, e.z - before.z);
      assert.ok(moved <= 0.321, 'Moving stock never teleports its vehicle');
      if (moved > 1e-7 || Math.abs(angleDelta(before.yaw || 0, e.yaw || 0)) > 1e-7)
        assert.equal(
          equipmentSweepBlocked(s, before, e),
          '',
          'The actual chassis, load and people remain collision checked',
        );
      if (e.cargo?.item === item) {
        assert.ok(
          EQUIPMENT[e.kind].capacity >= MATERIALS[item].mass * e.cargo.qty,
          'Each supported load obeys lift capacity',
        );
        assert.equal(
          s.workers.find((w) => w.id === e.operator)?.vehicle,
          e.id,
          'An owned vehicle has a physically boarded operator',
        );
        sawOperator = true;
        if (before.cargo?.item === item) traveledWithLoad += moved;
      }
    }
    for (const id of jobIds) {
      const j = s.jobs.find((q) => q.id === id)!;
      const activePhase = j.handling?.phase || j.railWork?.phase || j.phase;
      phases.add(activePhase);
      if (!savedPhases.has(`${id}:${activePhase}`)) {
        savedPhases.add(`${id}:${activePhase}`);
        const carriedNow = s.equipment.some((e) => e.job === id && e.cargo?.item === item);
        const before = S.save(s);
        s = S.load(before);
        reloadedCarried ||= carriedNow;
        assert.equal(physicalCount(s, item), quantity);
        assert.deepEqual(
          s.jobs.find((q) => q.id === id)!.stockMove,
          JSON.parse(before).jobs.find((q: { id: string }) => q.id === id).stockMove,
        );
      }
    }
  }
  assert.ok(
    jobIds.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'),
    stateSummary(s),
  );
  assert.ok(sawOperator, 'A real operator and vehicle handled the stock');
  assert.ok(reloadedCarried, 'Save/reload occurred with the physical stock off the ground');
  assert.ok(traveledWithLoad > 3, 'The item actually traveled across the yard on the machine');
  assert.ok(
    phases.size >= 5,
    `Physical pickup, carry and lowering phases are visible: ${[...phases]}`,
  );
  assert.equal(s.orders.length, 0, 'Moving owned stock never places a procurement order');
  assert.equal(s.equipment.length, 1, 'No contractor machine appears out of thin air');
  assert.equal(physicalCount(s, item), quantity);
  assert.ok(s.stacks.every((t) => t.reserved >= 0 && t.reserved <= t.qty));
  S.load(S.save(s));
  return s;
}

test('storage preview is read-only, quotes remaining contents mass, and selects nearest or explicit named stockyard', () => {
  const { s, t } = fixture();
  const before = S.save(s);
  const automatic = S.previewStorageMove(s, { id: t.id });
  assert.equal(automatic.error, '');
  assert.equal(automatic.quantity, 1);
  assert.equal(automatic.mass, 35 + 3 * 18.75);
  assert.equal(automatic.zoneId, s.zones[0].id);
  const explicit = S.previewStorageMove(s, { id: t.id, zoneId: s.zones[1].id });
  assert.equal(explicit.error, '');
  assert.equal(explicit.zoneId, s.zones[1].id);
  assert.ok(explicit.destination!.x >= s.zones[1].x);
  assert.equal(S.save(s), before, 'Preview acquires no stock, space, jobs, IDs or money');
});

for (const [item, kind] of [
  ['cableReel', 'forklift'],
  ['diesel', 'excavator'],
] as const) {
  test(`${kind} physically returns a partly used ${item} to the selected stockyard with exact contents and identity through reload`, () => {
    const { s, t } = fixture(item, 1, kind);
    const id = t.id,
      zone = s.zones[1],
      sourcePosition = { x: t.x, z: t.z };
    const result = S.moveToStorage(s, { id, zoneId: zone.id });
    assert.equal(result.error, '');
    assert.equal(result.jobIds!.length, 1);
    assert.equal(result.job!.status, 'todo');
    assert.equal(t.reserved, 1);
    assert.deepEqual(
      { x: t.x, z: t.z },
      sourcePosition,
      'Requesting transport does not relocate stock',
    );
    const done = completeMoves(s, result.jobIds!, item, 1),
      moved = done.stacks.find((q) => q.id === id)!;
    assert.ok(moved, 'The physical reel or drum keeps its ID');
    assert.ok(inside(moved, zone));
    assert.equal(moved.reserved, 0);
    assert.equal(
      moved[item === 'cableReel' ? 'cableMeters' : 'liters'],
      item === 'cableReel' ? 18.75 : 72.5,
    );
    assert.ok(
      done.costs.every((c) => !/purchas|procure|delivery/i.test(JSON.stringify(c))),
      'No purchase or delivery fees for already owned stock',
    );
  });
}

test('queued movement reserves the exact requested source and canceling releases it for future use', () => {
  const { s, t } = fixture('slab', 12);
  s.equipment = [];
  s.workers = [];
  const result = S.moveToStorage(s, { id: t.id, quantity: 5 });
  assert.equal(result.error, '');
  assert.equal(t.qty, 12);
  assert.equal(t.reserved, 5);
  assert.match(S.moveToStorage(s, { id: t.id, quantity: 1 }).error, /reserved|queued/i);
  assert.deepEqual(
    S.missingMaterials(s),
    {},
    'Stock transport is never counted as demand for more construction material',
  );
  for (const id of result.jobIds!) S.cancelJob(s, id);
  assert.equal(t.reserved, 0);
  assert.equal(t.qty, 12);
  assert.ok(result.jobIds!.every((id) => s.jobs.find((j) => j.id === id)!.status === 'canceled'));
  assert.equal(S.previewStorageMove(S.load(S.save(s)), { id: t.id, quantity: 5 }).error, '');
  assert.equal(s.orders.length, 0);
});

test('a slab-stack move is one work group split into real capacity-limited loads and safely merged at storage', () => {
  const { s, t } = fixture('slab', 12);
  const result = S.moveToStorage(s, { id: t.id, zoneId: s.zones[0].id });
  assert.equal(result.error, '');
  const jobs = s.jobs.filter((j) => result.jobIds!.includes(j.id));
  assert.ok(jobs.length > 1, 'Twelve 280 kg slabs exceed the forklift lift limit');
  assert.equal(
    jobs.reduce((n, j) => n + j.qty, 0),
    12,
  );
  assert.ok(jobs.every((j) => j.qty * MATERIALS.slab.mass <= EQUIPMENT.forklift.capacity));
  assert.ok(jobs.every((j) => j.parentId === result.groupId));
  const done = completeMoves(s, result.jobIds!, 'slab', 12),
    stored = done.stacks.filter((q) => q.item === 'slab' && q.qty > 0);
  assert.equal(stored.length, 1, 'Sequential loads top up their finite destination stack');
  assert.equal(stored[0].qty, 12);
  assert.ok(inside(stored[0], s.zones[0]));
  assert.ok(stored.every((q) => q.qty <= MATERIALS.slab.max));
});

test('moving recovered rail panels preserves each layer identity and groups the physical passes', () => {
  const { s, t } = fixture('rail', 3, 'excavator');
  t.railAssetIds = ['RAIL-9010', 'RAIL-9011', 'RAIL-9012'];
  t.assetId = 'RAIL-9012';
  const result = S.moveToStorage(s, { id: t.id });
  assert.equal(result.error, '');
  assert.equal(result.jobIds!.length, 3);
  assert.ok(s.jobs.every((j) => j.parentId === result.groupId));
  const done = completeMoves(s, result.jobIds!, 'rail', 3),
    stored = done.stacks.filter((q) => q.item === 'rail' && q.qty > 0);
  assert.equal(
    stored.reduce((n, q) => n + q.qty, 0),
    3,
  );
  assert.deepEqual(stored.flatMap((q) => q.railAssetIds || [q.assetId]).sort(), [
    'RAIL-9010',
    'RAIL-9011',
    'RAIL-9012',
  ]);
  assert.ok(stored.every((q) => inside(q, s.zones[0]) && q.qty <= MATERIALS.rail.max));
});

test('finite selected stockyard capacity rejects an overfill atomically and accepts a compatible top-up', () => {
  const { s, t } = fixture('slab', 2);
  const zone = { ...s.zones[0], x: 52, z: 36, w: 1, d: 1 };
  s.zones = [zone];
  const existing = { ...t, id: S.id(s, 'stack'), x: 52, z: 36, qty: 11 };
  s.stacks.push(existing);
  const before = S.save(s);
  assert.match(S.moveToStorage(s, { id: t.id, zoneId: zone.id }).error, /space/i);
  assert.equal(
    S.save(s),
    before,
    'A rejected request changes no stock, orders, jobs, reservations or IDs',
  );
  existing.qty = 10;
  const result = S.moveToStorage(s, { id: t.id, zoneId: zone.id });
  assert.equal(result.error, '');
  assert.equal(result.job!.stockMove!.mergeId, existing.id);
  assert.equal(existing.qty, 10, 'Topping up still requires a real delivery by equipment');
});

test('reserved cable, electrical handling, existing construction and missing stockyard produce actionable refusals', () => {
  const { s, t } = fixture();
  for (const changes of [
    { reserved: 1 },
    { cableReservedMeters: 2 },
    { cableReservedSpaceMeters: 2 },
    { electricalCarriedBy: 'EQ-9000' },
  ]) {
    Object.assign(t, changes);
    const before = S.save(s);
    assert.match(S.moveToStorage(s, { id: t.id }).error, /reserved.*active work/i);
    assert.equal(S.save(s), before);
    for (const key of Object.keys(changes)) delete (t as unknown as Record<string, unknown>)[key];
    t.reserved = 0;
  }
  assert.match(S.moveToStorage(s, { id: t.id, quantity: 0 }).error, /whole quantity/i);
  assert.match(S.moveToStorage(s, { id: t.id, quantity: 0.5 }).error, /whole quantity/i);
  assert.match(S.moveToStorage(s, { id: t.id, quantity: 2 }).error, /whole quantity/i);
  assert.match(S.moveToStorage(s, { id: 'STK-NOT-HERE' }).error, /physical material/i);
  assert.match(
    S.moveToStorage(s, { id: t.id, zoneId: 'STORAGE-NOT-HERE' }).error,
    /stockyard.*exists/i,
  );
  s.zones = [];
  assert.match(S.moveToStorage(s, { id: t.id }).error, /designate.*stockyard/i);
  assert.equal(s.jobs.length, 0);
});

test('Creative mode moves existing physical stock through equipment and crew instead of conjuring its relocation', () => {
  const { s, t } = fixture();
  S.setCreativeMode(s, true);
  const old = { x: t.x, z: t.z };
  const result = S.moveToStorage(s, { id: t.id });
  assert.equal(result.error, '');
  assert.equal(result.job!.status, 'todo');
  assert.equal(result.job!.creative, undefined);
  assert.deepEqual({ x: t.x, z: t.z }, old);
  const done = completeMoves(s, result.jobIds!, 'cableReel', 1);
  assert.ok(
    inside(
      done.stacks.find((q) => q.id === t.id)!,
      s.zones[0],
    ),
  );
  assert.equal(done.creative, true);
});

for (const [item, key, remaining] of [
  ['cableReel', 'cableMeters', 50],
  ['cableReel', 'cableMeters', 0],
  ['diesel', 'liters', 0],
] as const) {
  test(`a ${remaining === 0 ? 'fully used' : 'full'} ${item} remains a movable physical unit with exact contents`, () => {
    const { s, t } = fixture(item);
    t[key] = remaining;
    const preview = S.previewStorageMove(s, { id: t.id });
    assert.equal(preview.mass, item === 'cableReel' ? 35 + 3 * remaining : 20 + 0.825 * remaining);
    const result = S.moveToStorage(s, { id: t.id });
    assert.equal(result.error, '');
    const done = completeMoves(s, result.jobIds!, item, 1),
      moved = done.stacks.find((q) => q.id === t.id)!;
    assert.equal(
      moved[key],
      remaining,
      'Empty containers are never refilled or discarded by relocation',
    );
    assert.equal(moved.qty, 1);
    assert.ok(inside(moved, s.zones[0]));
  });
}

test('a returned cable drum can be moved again to another named stockyard without identity or content drift', () => {
  const initial = fixture();
  const first = S.moveToStorage(initial.s, { id: initial.t.id, zoneId: initial.s.zones[0].id });
  assert.equal(first.error, '');
  let s = completeMoves(initial.s, first.jobIds!, 'cableReel', 1);
  const second = S.moveToStorage(s, { id: initial.t.id, zoneId: s.zones[1].id });
  assert.equal(second.error, '');
  s = completeMoves(s, second.jobIds!, 'cableReel', 1);
  const moved = s.stacks.find((t) => t.id === initial.t.id)!;
  assert.equal(moved.cableMeters, 18.75);
  assert.equal(moved.reserved, 0);
  assert.ok(inside(moved, s.zones[1]));
  assert.equal(s.stacks.filter((t) => t.item === 'cableReel' && t.qty > 0).length, 1);
});

for (const cancelAt of ['carried', 'placed'] as const) {
  test(`canceling ${cancelAt} storage handling safely sets down owned stock and releases it through reload`, () => {
    let { s, t } = fixture();
    const request = S.moveToStorage(s, { id: t.id });
    assert.equal(request.error, '');
    const jid = request.job!.id;
    tickUntil(s, () => s.jobs.find((j) => j.id === jid)!.handling?.state === cancelAt, 600);
    S.cancelJob(s, jid);
    assert.equal(s.jobs.find((j) => j.id === jid)!.cancel, true);
    s = S.load(S.save(s));
    tickUntil(
      s,
      () => s.jobs.find((j) => j.id === jid)!.status === 'canceled',
      600,
      () => {
        assert.equal(physicalCount(s, 'cableReel'), 1);
        assert.equal(conservedContents(s, 'cableReel'), 18.75);
      },
    );
    const moved = s.stacks.find((q) => q.id === t.id)!;
    assert.equal(moved.qty, 1);
    assert.equal(moved.cableMeters, 18.75);
    assert.equal(moved.reserved, 0);
    assert.ok(
      inside(moved, s.zones[0]),
      'Cancellation supports the load safely at its selected destination',
    );
    assert.ok(s.equipment.every((e) => !e.cargo && !e.job));
    assert.equal(
      S.previewStorageMove(S.load(S.save(s)), { id: t.id, zoneId: s.zones[1].id }).error,
      '',
    );
  });
}

for (const item of [
  'shed',
  'office',
  'engineShed',
  'processTank',
  'lamp',
  'fence',
  'bufferStop',
  'processPipe',
] as const) {
  test(`a stored ${item} kit is physically relocated as material without installing it as a building`, () => {
    const kind = MATERIALS[item].mass > EQUIPMENT.forklift.capacity ? 'excavator' : 'forklift';
    const { s, t } = fixture(item, 1, kind);
    const beforeBuildings = structuredClone(s.buildings),
      beforeRails = structuredClone(s.rails);
    const result = S.moveToStorage(s, { id: t.id });
    assert.equal(result.error, '');
    const done = completeMoves(s, result.jobIds!, item, 1),
      moved = done.stacks.find((q) => q.id === t.id)!;
    assert.equal(moved.qty, 1);
    assert.ok(inside(moved, s.zones[0]));
    assert.deepEqual(
      done.buildings,
      beforeBuildings,
      'Transporting a kit does not construct a building',
    );
    assert.deepEqual(done.rails, beforeRails);
    assert.equal(Object.keys(done.paving).length, 0);
  });
}

test('unloaded manual equipment reassignment retains queued stock reservation and releases it once when canceled', () => {
  const { s, t, e } = fixture('slab', 12);
  const request = S.moveToStorage(s, { id: t.id, quantity: 5 });
  assert.equal(request.error, '');
  const replacement = seedHandlingResources(s, 'excavator');
  Object.assign(replacement, { x: 22.5, z: 55.5 });
  const j = request.job!;
  assert.equal(setJobEquipment(s, j.id, e.id), '');
  tickUntil(s, () => j.status === 'doing' && j.equipment === e.id, 30);
  assert.ok(!e.cargo, 'Change occurs before the first actual lift');
  assert.equal(setJobEquipment(s, j.id, replacement.id), '');
  S.tick(s, 0.1);
  assert.equal(
    t.reserved,
    5,
    'Changing the assigned unloaded machine does not release the queued source demand',
  );
  S.cancelJob(s, j.id);
  assert.equal(t.reserved, 0);
  assert.equal(t.qty, 12);
  assert.equal(j.status, 'canceled');
  S.load(S.save(s));
});

for (const item of ['cableReel', 'diesel'] as const) {
  test(`import rejects damaged conserved ${item} contents or carriage ownership`, () => {
    const { s, t } = fixture(item);
    const request = S.moveToStorage(s, { id: t.id });
    assert.equal(request.error, '');
    const jid = request.job!.id;
    tickUntil(s, () => s.equipment.some((e) => e.cargo?.item === item), 600);
    const good = S.save(s);
    for (const badValue of [-1, item === 'cableReel' ? 51 : 201, null]) {
      const damaged = JSON.parse(good),
        job = damaged.jobs.find((j: { id: string }) => j.id === jid);
      job.stockMove.load[item === 'cableReel' ? 'cableMeters' : 'liters'] = badValue;
      assert.throws(
        () => S.load(JSON.stringify(damaged)),
        /storage|material|cable|fuel|liters|meters|contents/i,
      );
    }
    const damaged = JSON.parse(good);
    damaged.stacks.find((q: { id: string }) => q.id === t.id).storageCarriedBy = 'JOB-NONEXISTENT';
    assert.throws(() => S.load(JSON.stringify(damaged)), /storage|carried|ownership|material/i);
    assert.equal(physicalCount(S.load(good), item), 1, 'The original carried save still reloads');
  });
}

function almostFullSlabStore() {
  const { s, t, e } = fixture('slab', 2);
  const zone = { ...s.zones[0], x: 52, z: 36, w: 1, d: 1 };
  s.zones[0] = zone;
  const destination: Stack = { ...t, id: S.id(s, 'stack'), x: 52, z: 36, qty: 10 };
  s.stacks.push(destination);
  return { s, t, e, zone, destination };
}

test('incoming storage loads reserve their destination capacity so a second source cannot overbook a 10-of-12 slab stack', () => {
  const { s, t, zone, destination } = almostFullSlabStore();
  const other: Stack = { ...t, id: S.id(s, 'stack'), z: 55 };
  s.stacks.push(other);
  const first = S.moveToStorage(s, { id: t.id, zoneId: zone.id });
  assert.equal(first.error, '');
  assert.equal(first.job!.stockMove!.mergeId, destination.id);
  assert.equal(destination.qty, 10);
  const beforeSecond = S.save(s);
  assert.match(S.moveToStorage(s, { id: other.id, zoneId: zone.id }).error, /space|reserved/i);
  assert.equal(
    S.save(s),
    beforeSecond,
    'Failed second booking acquires neither source units nor destination space',
  );
  assert.equal(other.reserved, 0);
  for (const id of first.jobIds!) S.cancelJob(s, id);
  const retry = S.moveToStorage(s, { id: other.id, zoneId: zone.id });
  assert.equal(
    retry.error,
    '',
    'Canceling the first booking releases its exact future destination capacity',
  );
  assert.equal(retry.job!.stockMove!.mergeId, destination.id);
});

test('an incoming merge target cannot be moved, collected or consumed by construction until its storage move releases it', () => {
  const { s, t, e, zone, destination } = almostFullSlabStore();
  const request = S.moveToStorage(s, { id: t.id, zoneId: zone.id });
  assert.equal(request.error, '');
  const before = S.save(s);
  assert.match(
    S.moveToStorage(s, { id: destination.id, zoneId: s.zones[1].id, quantity: 1 }).error,
    /reserved|incoming|active/i,
  );
  const pickup = S.requestCollection(s, { lines: [{ stackId: destination.id, qty: 1 }] });
  assert.match(pickup.error!, /reserved|incoming|active/i);
  assert.equal(
    S.save(s),
    before,
    'Rejected competing actions cannot invalidate the receiving stack',
  );
  assert.equal(S.setEquipmentRole(s, e.id, 'paving'), '');
  const paving = S.plan(s, 'slab', 65, 60);
  assert.equal(paving.error, '');
  for (let n = 0; n < 100; n++) S.tick(s, 0.1);
  assert.equal(paving.job!.status, 'todo');
  assert.notEqual(
    paving.job!.stack,
    destination.id,
    'Normal material selection cannot steal a reserved receiving stack',
  );
  assert.equal(destination.qty, 10);
  assert.equal(t.reserved, 2);
  S.cancelJob(s, paving.job!.id);
  for (const id of request.jobIds!) S.cancelJob(s, id);
  assert.equal(
    S.previewStorageMove(s, { id: destination.id, zoneId: s.zones[1].id, quantity: 1 }).error,
    '',
  );
  assert.equal(S.quoteCollection(s, { lines: [{ stackId: destination.id, qty: 1 }] }).valid, true);
});

test('a queued move of a diesel drum excludes that drum from equipment refueling until the move is canceled', () => {
  const { s, t, e } = fixture('diesel');
  const request = S.moveToStorage(s, { id: t.id });
  assert.equal(request.error, '');
  assert.equal(S.setEquipmentRole(s, e.id, 'hold'), '');
  e.fuel = 0;
  assert.equal(S.refuel(s, e.id), '');
  const refuel = s.jobs.find((j) => j.kind === 'refuel')!;
  for (let n = 0; n < 100; n++) S.tick(s, 0.1);
  assert.equal(refuel.status, 'todo');
  assert.match(refuel.reason, /no available diesel/i);
  assert.equal(refuel.stack, undefined);
  assert.equal(refuel.fuelWork, undefined);
  assert.equal(t.liters, 72.5, 'The drum is not secretly drained while queued for lifting');
  assert.equal(e.fuel, 0);
  for (const id of request.jobIds!) S.cancelJob(s, id);
  tickUntil(s, () => refuel.status === 'doing', 30);
  assert.equal(
    refuel.stack,
    t.id,
    'Canceling the storage booking makes the actual drum available to fuel service again',
  );
  S.load(S.save(s));
});

for (const item of ['railCurve', 'railPoints', 'railFrog', 'railClosure', 'railExit'] as const) {
  test(`a 180-degree reversed ${item} cannot merge into an incompatible oriented stack`, () => {
    const { s, t } = fixture(item, 1, 'excavator');
    t.yaw = Math.PI;
    t.trackHand = 1;
    s.zones = [{ ...s.zones[0], x: 52, z: 36, w: t.w, d: t.d }];
    const target: Stack = { ...t, id: S.id(s, 'stack'), x: 52, z: 36, yaw: 0 };
    s.stacks.push(target);
    const before = S.save(s);
    assert.match(
      S.moveToStorage(s, { id: t.id, zoneId: s.zones[0].id }).error,
      /space|orientation|compatible/i,
    );
    assert.equal(
      S.save(s),
      before,
      'Reversed asymmetric panels cannot silently change orientation by merging',
    );
    t.yaw = 0;
    const compatible = S.moveToStorage(s, { id: t.id, zoneId: s.zones[0].id });
    assert.equal(
      compatible.error,
      '',
      'Panels with matching hand and exact orientation remain stackable',
    );
    assert.equal(compatible.job!.stockMove!.mergeId, target.id);
  });
}

for (const mergeExisting of [false, true]) {
  test(`a partial process-pipe-kit move lifts its top three layers and ${mergeExisting ? 'tops up two existing kits at their actual height' : 'keeps the remaining two source layers in place'}`, () => {
    let { s, t } = fixture('processPipe', 5);
    const sourceId = t.id,
      zoneId = s.zones[0].id;
    let targetId: string | undefined;
    if (mergeExisting) {
      const target: Stack = { ...t, id: S.id(s, 'stack'), x: 52, z: 45, qty: 2, baseHeight: 0.2 };
      targetId = target.id;
      s.stacks.push(target);
    }
    const request = S.moveToStorage(s, { id: sourceId, quantity: 3, zoneId });
    assert.equal(request.error, '');
    assert.equal(request.jobIds!.length, 1);
    const jid = request.job!.id;
    if (mergeExisting) assert.equal(request.job!.stockMove!.mergeId, targetId);
    tickUntil(s, () => s.jobs.find((j) => j.id === jid)!.handling?.phase === 'rig', 600);
    assert.ok(
      Math.abs(s.jobs.find((j) => j.id === jid)!.handling!.source.y - 1.6) < 1e-8,
      'The bottom of the selected three-kit bundle is above the two 0.8 m source layers that stay behind',
    );
    tickUntil(s, () => s.jobs.find((j) => j.id === jid)!.handling?.state === 'carried', 600);
    assert.equal(s.stacks.find((q) => q.id === sourceId)!.qty, 2);
    assert.equal(s.equipment.find((e) => e.job === jid)!.cargo!.qty, 3);
    assert.ok(
      Math.abs(s.jobs.find((j) => j.id === jid)!.handling!.pose.y - 1.6) < 1e-8,
      'Pickup does not jump the selected kit bundle down through its remaining source layers',
    );
    s = S.load(S.save(s));
    tickUntil(
      s,
      () => s.jobs.find((j) => j.id === jid)!.handling?.state === 'placed',
      600,
      () => {
        assert.equal(physicalCount(s, 'processPipe'), mergeExisting ? 7 : 5);
      },
    );
    const job = s.jobs.find((j) => j.id === jid)!,
      placed = s.stacks.find((q) => q.id === job.handling!.placedStack)!;
    assert.ok(
      Math.abs(job.handling!.pose.y - (mergeExisting ? 1.8 : 0)) < 1e-8,
      'Setdown uses the process-kit model pitch and the real receiving support height',
    );
    assert.equal(placed.qty, mergeExisting ? 5 : 3);
    if (mergeExisting)
      assert.equal(
        placed.baseHeight,
        0.2,
        'Receiving supports are not replaced by the source support height',
      );
    s = S.load(S.save(s));
    tickUntil(s, () => s.jobs.find((j) => j.id === jid)!.status === 'done', 600);
    assert.equal(s.stacks.find((q) => q.id === sourceId)!.qty, 2);
    assert.equal(physicalCount(s, 'processPipe'), mergeExisting ? 7 : 5);
    assert.equal(s.buildings.length, 0, 'Moving several pipe kits does not install process piping');
    S.load(S.save(s));
  });
}

test('a new landing obstruction after planning stops lowering and retains the physical reel until its footprint is clear', () => {
  const { s, t } = fixture();
  const request = S.moveToStorage(s, { id: t.id });
  assert.equal(request.error, '');
  const j = request.job!;
  tickUntil(s, () => j.handling?.phase === 'lower', 600);
  const obstacleId = S.id(s, 'building');
  s.buildings.push({
    ...j.stockMove!.destination,
    id: obstacleId,
    kind: 'fence',
    rotation: 0,
    name: 'New landing obstruction',
    connected: true,
    source: 'opening',
  });
  const pose = { ...j.handling!.pose },
    clock = j.handling!.clock;
  for (let n = 0; n < 50; n++) {
    S.tick(s, 0.1);
    assert.equal(j.handling!.state, 'carried');
    assert.deepEqual(
      j.handling!.pose,
      pose,
      'The reel cannot descend through a newly occupied landing space',
    );
    assert.equal(j.handling!.clock, clock);
    assert.equal(physicalCount(s, 'cableReel'), 1);
    assert.equal(conservedContents(s, 'cableReel'), 18.75);
  }
  assert.match(j.reason, /obstructed/i);
  assert.ok(j.reason.includes(obstacleId), 'The condition identifies the actual new obstruction');
  S.load(S.save(s));
  s.buildings = s.buildings.filter((b) => b.id !== obstacleId);
  tickUntil(s, () => j.status === 'done', 600);
  assert.equal(s.stacks.find((q) => q.id === t.id)!.cableMeters, 18.75);
  assert.equal(s.stacks.find((q) => q.id === t.id)!.reserved, 0);
});

test('a receiving stack that becomes full after pickup refuses another load without deleting or embedding the carried slabs', () => {
  const { s, t, zone, destination } = almostFullSlabStore();
  const request = S.moveToStorage(s, { id: t.id, zoneId: zone.id });
  assert.equal(request.error, '');
  const j = request.job!;
  tickUntil(s, () => j.handling?.phase === 'lower', 600);
  const pose = { ...j.handling!.pose };
  // An external change after reservation models a late receiving-space race.
  destination.qty = 12;
  for (let n = 0; n < 50; n++) {
    S.tick(s, 0.1);
    assert.equal(j.handling!.state, 'carried');
    assert.deepEqual(j.handling!.pose, pose);
    assert.equal(destination.qty, 12);
    assert.equal(s.equipment.find((e) => e.job === j.id)!.cargo!.qty, 2);
    assert.equal(
      physicalCount(s, 'slab'),
      14,
      'The late extra units and the supported load all remain physically accounted',
    );
  }
  assert.match(j.reason, /insufficient stack capacity/i);
  destination.qty = 10;
  tickUntil(s, () => j.status === 'done', 600);
  assert.equal(destination.qty, 12);
  assert.equal(destination.reserved, 0);
  assert.equal(physicalCount(s, 'slab'), 12);
  S.load(S.save(s));
});

test('automatic storage dispatch selects a crane for the entire heavy slab bundle despite a closer forklift', () => {
  const { s, t, e: forklift } = fixture('slab', 12);
  const crane = seedHandlingResources(s, 'excavator');
  Object.assign(crane, { x: 15.5, z: 62.5, yaw: 0 });
  Object.assign(s.workers[s.workers.length - 2], { x: 15.5, z: 59.5 });
  Object.assign(s.workers[s.workers.length - 1], { x: 18.5, z: 59.5 });
  assert.ok(
    Math.hypot(forklift.x - t.x, forklift.z - t.z) < Math.hypot(crane.x - t.x, crane.z - t.z),
  );
  const request = S.moveToStorage(s, { id: t.id });
  assert.equal(request.error, '');
  assert.equal(
    request.jobIds!.length,
    1,
    'The owned 6 t crane permits a single supported twelve-slab lift',
  );
  const j = request.job!;
  assert.equal(j.qty, 12);
  assert.ok(j.qty * MATERIALS.slab.mass > EQUIPMENT.forklift.capacity);
  tickUntil(s, () => j.status === 'doing', 30);
  assert.equal(
    j.equipment,
    crane.id,
    'Automatic distance scoring must first exclude machines below the whole 3,360 kg load limit',
  );
  let sawFullLoad = false;
  tickUntil(
    s,
    () => j.status === 'done',
    1200,
    () => {
      assert.equal(physicalCount(s, 'slab'), 12);
      for (const equipment of s.equipment) {
        if (!equipment.cargo) continue;
        const mass = equipment.cargo.qty * MATERIALS[equipment.cargo.item].mass;
        assert.ok(
          mass <= EQUIPMENT[equipment.kind].capacity,
          'Every actual assigned cargo fits its carrying machine',
        );
        assert.equal(equipment.id, crane.id);
        assert.equal(equipment.cargo.qty, 12);
        sawFullLoad = true;
      }
    },
  );
  assert.ok(sawFullLoad, 'The eligible crane physically lifts and carries the complete bundle');
  assert.equal(s.equipment.length, 2);
  assert.equal(
    s.stacks.filter((q) => q.item === 'slab' && q.qty > 0).reduce((n, q) => n + q.qty, 0),
    12,
  );
  S.load(S.save(s));
});
