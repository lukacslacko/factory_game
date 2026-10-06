import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS } from '../src/catalog';
import { setRailCrew } from '../src/jobs';
import { setEquipmentAssistant } from '../src/work-crews';
import { dist, center } from '../src/path';
import { equipmentSweepBlocked, equipmentTravelSpeed, workerMoveBlocked } from '../src/traffic';
import { seedHandlingResources, stateSummary } from './support/yard';
import type { State } from '../src/types';

function fixture(manual = false, blockerAtSite = true) {
  const s = S.createState();
  const installer = seedHandlingResources(s, 'excavator');
  const installerOperator = s.workers.find((w) => w.role === 'operator')!;
  // The installer waits in the first planned landing area. Its operator is a
  // real seated opening asset; clearance must move both through normal ticks.
  Object.assign(installer, {
    x: blockerAtSite ? 127.5 : 100,
    z: blockerAtSite ? 14.5 : 25,
    operator: installerOperator.id,
  });
  Object.assign(installerOperator, {
    x: installer.x,
    z: installer.z,
    vehicle: installer.id,
    duty: manual ? 'manual' : 'auto',
  });
  const stager = seedHandlingResources(s, 'excavator');
  Object.assign(stager, { x: 20, z: 35 });
  const builders = s.workers.filter((w) => w.role === 'builder');
  Object.assign(builders[0], { x: 110, z: 30 });
  assert.equal(setEquipmentAssistant(s, installer.id, builders[0].id), '');
  assert.equal(setEquipmentAssistant(s, stager.id, builders[1].id), '');
  const jobs = [125, 130, 135, 140].map((x) => S.plan(s, 'rail', x, 4).job!);
  const group = s.jobGroups!.find((g) => g.id === jobs[0].parentId)!;
  assert.equal(setRailCrew(s, group.id, stager.id, installer.id), '');
  s.stacks.push({
    id: S.id(s, 'stack'),
    item: 'rail',
    qty: 4,
    reserved: 0,
    x: 30,
    z: 29,
    w: MATERIALS.rail.w,
    d: MATERIALS.rail.d,
    source: 'opening',
  });
  return {
    s,
    installerId: installer.id,
    operatorId: installerOperator.id,
    stagerId: stager.id,
    ids: jobs.map((j) => j.id),
    leadId: jobs[0].id,
  };
}

function safeTick(s: State) {
  const priorMachines = s.equipment.map((e) => ({ ...e, path: e.path.slice() }));
  const priorWorkers = s.workers.map((w) => ({ ...w, path: w.path.slice() }));
  S.tick(s, 0.1);
  for (const before of priorMachines) {
    const after = s.equipment.find((e) => e.id === before.id)!;
    assert.ok(
      dist(before, after) <= Math.max(2.3, equipmentTravelSpeed(s, before)) * 0.1 + 1e-6,
      `${before.id} never jumps to a clearance location`,
    );
    if (dist(before, after) > 1e-7 || Math.abs((before.yaw || 0) - (after.yaw || 0)) > 1e-7)
      assert.equal(
        equipmentSweepBlocked(s, before, after),
        '',
        `${before.id} executes only physically clear movement`,
      );
  }
  for (const before of priorWorkers) {
    const after = s.workers.find((w) => w.id === before.id)!;
    if (before.vehicle || after.vehicle || before.transition || after.transition) continue;
    assert.ok(dist(before, after) <= 0.17 + 1e-6, `${before.id} must walk to clearance`);
    if (dist(before, after) > 1e-7)
      assert.equal(
        workerMoveBlocked(s, before, after),
        '',
        `${before.id} never walks through equipment or stock`,
      );
  }
  const totals = S.totals(s, 'rail');
  assert.equal(
    totals.stored + totals.cargo + totals.installed,
    4,
    'All four real panels remain conserved',
  );
}

function until(s: State, predicate: () => boolean, seconds: number) {
  for (let t = 0; t < seconds && !predicate(); t += 0.1) safeTick(s);
  assert.ok(predicate(), stateSummary(s));
}

const requests = (s: State, leadId: string, blockerId: string) =>
  s.events.filter((e) => e.entity === leadId && e.text.includes(`requests ${blockerId} to clear`));

function complete(s: State, ids: string[]) {
  until(s, () => ids.every((id) => s.jobs.find((j) => j.id === id)!.status === 'done'), 2400);
  assert.equal(S.totals(s, 'rail').installed, 4);
  assert.equal(
    s.movements.filter((m) => m.reason.includes('temporary staging supports')).length,
    1,
  );
  assert.equal(s.movements.find((m) => m.reason.includes('temporary staging supports'))!.qty, 4);
}

test('a distant stager collects four panels while requesting the idle installation crew to physically clear its landing area', () => {
  const { s, installerId, stagerId, leadId, ids } = fixture();
  const initial = { ...s.equipment.find((e) => e.id === installerId)! };
  until(s, () => requests(s, leadId, installerId).length > 0, 30);
  const lead = s.jobs.find((j) => j.id === leadId)!;
  assert.ok(
    lead.railWork?.source,
    'Temporary site occupancy does not prevent source pickup initialization',
  );
  assert.ok(
    dist(
      s.equipment.find((e) => e.id === stagerId)!,
      center(lead.railWork!.stage),
    ) > 60,
    'Clearance starts while collection is still distant',
  );
  assert.equal(requests(s, leadId, installerId).length, 1);
  until(
    s,
    () =>
      dist(
        s.equipment.find((e) => e.id === installerId)!,
        initial,
      ) > 1,
    30,
  );
  complete(s, ids);
  assert.equal(
    requests(s, leadId, installerId).length,
    1,
    'A continuing clearance request is deduplicated',
  );
  S.load(S.save(s));
});

test('manual site occupancy allows collection and safe approach, warns once, and resumes after release with saved clearance ownership', () => {
  let { s, installerId, operatorId, stagerId, leadId, ids } = fixture(true);
  const initial = { ...s.equipment.find((e) => e.id === installerId)! };
  until(s, () => s.equipment.find((e) => e.id === stagerId)?.cargo?.qty === 4, 180);
  const lead = s.jobs.find((j) => j.id === leadId)!;
  assert.ok(lead.railWork?.siteClearance?.blockers.includes(installerId));
  assert.equal(
    dist(
      s.equipment.find((e) => e.id === installerId)!,
      initial,
    ),
    0,
    'Automatic clearance respects manual control',
  );
  const warning = s.notices.filter(
    (n) => n.entity === leadId && n.title === 'Rail staging blocked',
  );
  assert.equal(warning.length, 1);
  assert.notEqual(warning[0].state, 'done');
  const recorded = structuredClone(lead.railWork!.siteClearance!);
  for (const [field, value] of [
    ['blockers', [123]],
    ['since', -1],
    ['warned', 'yes'],
  ] as const) {
    const malformed = JSON.parse(S.save(s));
    malformed.jobs.find((j: { id: string }) => j.id === leadId).railWork.siteClearance[field] =
      value;
    assert.throws(
      () => S.load(JSON.stringify(malformed)),
      /invalid rail staging clearance request/,
    );
  }
  s = S.load(S.save(s));
  assert.deepEqual(s.jobs.find((j) => j.id === leadId)!.railWork!.siteClearance, recorded);
  until(
    s,
    () =>
      dist(
        s.equipment.find((e) => e.id === stagerId)!,
        center(s.jobs.find((j) => j.id === leadId)!.railWork!.stage),
      ) < 25,
    180,
  );
  assert.equal(
    dist(
      s.equipment.find((e) => e.id === installerId)!,
      initial,
    ),
    0,
    'Loaded approach cannot override manual control',
  );
  assert.equal(
    s.equipment.find((e) => e.id === stagerId)!.cargo!.qty,
    4,
    'The real load travels toward the blocked site without being placed',
  );
  for (let t = 0; t < 5; t += 0.1) safeTick(s);
  assert.equal(
    s.notices.filter((n) => n.entity === leadId && n.title === 'Rail staging blocked').length,
    1,
  );
  assert.equal(requests(s, leadId, installerId).length, 1);
  assert.equal(S.releaseWorker(s, operatorId), '');
  complete(s, ids);
  assert.equal(s.notices.find((n) => n.id === warning[0].id)!.state, 'done');
});

test('a supported-panel landing occupied after approach cannot advance lowering or create stock', () => {
  const { s, installerId, operatorId, leadId } = fixture(false, false);
  until(s, () => s.jobs.find((j) => j.id === leadId)?.railWork?.phase === 'stage-lower', 500);
  const lead = s.jobs.find((j) => j.id === leadId)!,
    r = lead.railWork!;
  // Opening checkpoint: a manual machine now occupies the landing square.
  // Replay starts here; no actor is repositioned during the checked ticks.
  const installer = s.equipment.find((e) => e.id === installerId)!;
  Object.assign(installer, center(r.stage), { path: [], velocity: 0, trafficGoal: undefined });
  const operator = s.workers.find((w) => w.id === operatorId)!;
  Object.assign(operator, {
    x: installer.x,
    z: installer.z,
    duty: 'manual',
    vehicle: installer.id,
  });
  const pose = { ...r.panel },
    clock = r.clock;
  for (let t = 0; t < 3; t += 0.1) safeTick(s);
  assert.equal(r.phase, 'stage-lower');
  assert.equal(r.clock, clock, 'Blocked lowering cannot advance its animation clock');
  assert.deepEqual(
    r.panel,
    pose,
    'The supported load cannot be lowered through an occupied landing square',
  );
  assert.equal(s.stacks.filter((t) => t.railStagingJobs).length, 0);
  assert.equal(requests(s, leadId, installerId).length, 1);
});

test('static site obstructions remain strict when temporary actors are deferred', () => {
  const { s, stagerId, leadId } = fixture(false, false);
  // A continuous solid strip covers all legal staging positions; the source
  // stock and collection machine remain outside it.
  s.buildings.push({
    id: 'OPENING-SITE-WALL',
    kind: 'store',
    x: 113,
    z: 7,
    w: 45,
    d: 90,
    rotation: 0,
    connected: false,
    source: 'opening',
    name: 'Opening solid obstruction',
  });
  until(s, () => /clear staging area/.test(s.jobs.find((j) => j.id === leadId)!.reason), 30);
  const lead = s.jobs.find((j) => j.id === leadId)!;
  assert.equal(lead.railWork, undefined);
  assert.match(lead.reason, /clear staging area/);
  assert.equal(s.equipment.find((e) => e.id === stagerId)!.cargo, undefined);
  assert.equal(S.totals(s, 'rail').stored, 4);
});

for (const condition of ['unpowered', 'unattended'] as const)
  test(`rail staging requests its ${condition} installer without inventing movement, fuel, or an operator`, () => {
    const { s, installerId, operatorId, stagerId, leadId } = fixture();
    const installer = s.equipment.find((e) => e.id === installerId)!;
    const operator = s.workers.find((w) => w.id === operatorId)!;
    if (condition === 'unpowered') installer.fuel = 0;
    else {
      installer.operator = undefined;
      operator.vehicle = undefined;
      operator.duty = 'rest';
      Object.assign(operator, { x: 150, z: 35 });
    }
    const initial = { x: installer.x, z: installer.z };
    const fuel = installer.fuel;
    const workerCount = s.workers.length;
    until(s, () => s.jobs.find((j) => j.id === leadId)?.railWork?.source !== undefined, 30);
    for (let t = 0; t < 30; t += 0.1) safeTick(s);
    const lead = s.jobs.find((j) => j.id === leadId)!;
    assert.ok(lead.railWork?.siteClearance?.blockers.includes(installerId));
    assert.equal(requests(s, leadId, installerId).length, 1);
    const warnings = s.notices.filter(
      (n) => n.entity === leadId && n.title === 'Rail staging blocked',
    );
    assert.equal(warnings.length, 1);
    assert.ok(
      warnings[0].detail.includes(installerId),
      'The warning identifies the actual protected blocker',
    );
    assert.notEqual(warnings[0].state, 'done');
    assert.deepEqual(
      { x: installer.x, z: installer.z },
      initial,
      'The protected installer remains physically stationary',
    );
    assert.equal(
      installer.fuel,
      fuel,
      'Clearance neither invents fuel nor burns fuel on an unattended machine',
    );
    assert.equal(s.workers.length, workerCount, 'No operator is created to satisfy clearance');
    assert.equal(installer.operator, condition === 'unpowered' ? operatorId : undefined);
    assert.equal(operator.vehicle, condition === 'unpowered' ? installerId : undefined);
    assert.equal(operator.duty, condition === 'unpowered' ? 'auto' : 'rest');
    assert.ok(
      dist(
        s.equipment.find((e) => e.id === stagerId)!,
        { x: 20, z: 35 },
      ) > 1,
      'Collection makes useful physical progress despite the future site blocker',
    );
  });
