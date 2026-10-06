import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { trackGeometry, trackNetwork, trackOpenPorts } from '../src/track';
import { bufferAssets } from '../src/buffers';
import { setJobEquipment } from '../src/jobs';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { State } from '../src/types';

function fixture() {
  const s = S.createState();
  S.setCreativeMode(s, true);
  for (let x = 125; x < 145; x += 5)
    assert.equal(S.planRailLayout(s, 'straight', { x, z: 5 }).error, '');
  S.setCreativeMode(s, false);
  const e = seedHandlingResources(s, 'excavator');
  Object.assign(e, { x: 130, z: 18 });
  Object.assign(s.workers[0], { x: 126, z: 18 });
  Object.assign(s.workers[1], { x: 126, z: 15 });
  s.zones.push({ id: S.id(s, 'zone'), name: 'Recovered steel', x: 120, z: 28, w: 55, d: 25 });
  const rail = s.rails[2];
  assert.equal(S.removeRailInfrastructure(s, rail.id), '');
  const j = s.jobs.find((j) => j.railRecovery?.railId === rail.id)!;
  assert.equal(setJobEquipment(s, j.parentId!, e.id), '');
  return { s, e, j, rail };
}
function steel(s: State) {
  return (
    s.rails.length +
    s.stacks.filter((t) => t.item === 'rail').reduce((n, t) => n + t.qty, 0) +
    s.equipment.filter((e) => e.cargo?.item === 'rail').reduce((n, e) => n + e.cargo!.qty, 0)
  );
}

test('rail recovery unbolts, rigs, lifts, transports and stores the same installed panel', () => {
  const { s, e, j, rail } = fixture();
  const phases = new Set<string>();
  tickUntil(
    s,
    () => j.status === 'done',
    900,
    () => {
      assert.equal(steel(s), 4);
      if (j.railWork) phases.add(j.railWork.phase);
      if (!j.railRecovery!.lifted) assert(s.rails.some((r) => r.id === rail.id));
      if (e.cargo) assert(!s.rails.some((r) => r.id === rail.id));
    },
  );
  for (const phase of [
    'source-rig',
    'source-lift',
    'source-clear',
    'stage-travel',
    'stage-lower',
    'legacy-fork-withdraw',
  ])
    assert(phases.has(phase), phase);
  assert.equal(e.cargo, undefined);
  const t = s.stacks.find((t) => t.assetId === rail.id)!;
  assert.equal(t.qty, 1);
  assert.equal(t.reserved, 0);
  assert.equal(t.item, 'rail');
  assert(s.events.some((e) => e.text.includes('released the joint fasteners')));
  assert.deepEqual(S.missingMaterials(s), {});
  assert.equal(S.buyMissing(s), 0);
  S.load(S.save(s));
});

test('recovery saves before and after lifting; cancellation secures installed or carried steel', () => {
  for (const phase of ['queued', 'unbolted', 'carried', 'staged']) {
    let { s, j, rail } = fixture();
    if (phase !== 'queued')
      tickUntil(
        s,
        () =>
          phase === 'unbolted'
            ? !!j.railRecovery?.unbolted
            : phase === 'carried'
              ? !!j.railRecovery?.lifted
              : j.railWork?.panel.state === 'staged',
        900,
      );
    s = S.load(S.save(s));
    j = s.jobs.find((t) => t.id === j.id)!;
    S.cancelJob(s, j.id);
    tickUntil(
      s,
      () => j.status === 'canceled',
      900,
      () => assert.equal(steel(s), 4),
    );
    assert.equal(
      s.rails.some((r) => r.id === rail.id),
      ['queued', 'unbolted'].includes(phase),
    );
    assert(s.equipment.every((e) => !e.cargo));
    S.load(S.save(s));
  }
});

test('unsafe recovery is refused and insufficient storage leaves installed steel untouched', () => {
  const { s, j, rail } = fixture();
  assert.match(S.removeRailInfrastructure(s, rail.id), /already planned/);
  assert.match(S.removeRailInfrastructure(s, 'BOOTSTRAP-SIDING'), /not found|protected/);
  s.zones = [];
  tickUntil(s, () => !!j.reason.includes('storage slot'), 100);
  assert(s.rails.some((t) => t.id === rail.id));
  assert.equal(steel(s), 4);
  assert.equal(s.equipment[0].cargo, undefined);
  S.load(S.save(s));
});

test('recovered straight rails can be replaced with a real turnout joining the downstream end', () => {
  const { s, j } = fixture();
  S.cancelJob(s, j.id);
  S.setCreativeMode(s, true);
  const ids = s.rails.map((r) => r.id);
  for (const id of ids) assert.equal(S.removeRailInfrastructure(s, id), '');
  assert.equal(s.rails.length, 0);
  assert.equal(
    s.stacks.filter((t) => t.item === 'rail').reduce((n, t) => n + t.qty, 0),
    4,
  );
  assert.equal(S.planRailLayout(s, 'turnout', { x: 125, z: 5 }).error, '');
  assert.equal(s.rails.length, 7);
  S.load(S.save(s));
});

test('real completed rail geometry accepts a closed loop and retains connectivity after save/load', () => {
  let s = S.createState();
  S.setCreativeMode(s, true);
  const build = (
    layout: 'curve' | 'straight' | 'turnout',
    x: number,
    z: number,
    heading: 0 | 1 | 2 | 3,
    hand: 1 | -1 = 1,
  ) =>
    assert.equal(
      S.planRailLayout(s, layout, { x, z }, heading, hand).error,
      '',
      `${layout} at ${x},${z}`,
    );
  build('curve', 125, 5, 0);
  for (let z = 25; z < 45; z += 5) build('straight', 145, z, 1);
  build('curve', 145, 45, 1);
  build('turnout', 125, 65, 2);
  build('curve', 105, 65, 2, -1);
  build('curve', 85, 85, 1);
  build('curve', 65, 105, 2);
  build('straight', 45, 85, 3);
  build('curve', 45, 80, 3);
  for (let x = 65; x < 105; x += 5) build('straight', x, 60, 0);
  s = S.load(S.save(s));
  const network = trackNetwork(s);
  assert(network.panels.every((p) => p.connected));
  // Mainline is externally connected to the seed, leaving a cycle in factory panel joints.
  assert(network.joints.length >= network.panels.length - 1);
  assert.equal(
    trackOpenPorts(s, false).filter((p) => p.assetId !== 'BOOTSTRAP-MAINLINE').length,
    0,
  );
  assert.equal(
    network.joints.filter((j) => Math.hypot(j.point.x - 105, j.point.z - 60) < 0.02).length,
    1,
  );
});

test('a 20 m middle gap accepts a turnout and reconnects surviving downstream track', () => {
  const s = S.createState();
  S.setCreativeMode(s, true);
  s.zones.push({ id: S.id(s, 'zone'), name: 'Steel', x: 45, z: 30, w: 60, d: 35 });
  for (let x = 125; x < 165; x += 5)
    assert.equal(S.planRailLayout(s, 'straight', { x, z: 5 }).error, '');
  const middle = s.rails.filter((r) => r.track?.origin.x! >= 130 && r.track?.origin.x! < 150);
  for (const r of middle) assert.equal(S.removeRailInfrastructure(s, r.id), '');
  assert.equal(trackNetwork(s).panels.filter((p) => !p.connected).length, 3);
  assert.equal(S.planRailLayout(s, 'turnout', { x: 130, z: 5 }).error, '');
  assert(trackNetwork(s).panels.every((p) => p.connected));
  S.load(S.save(s));
});

test('terminal panel recovery physically stores its attached buffer before lifting any rail', () => {
  const { s, j, rail } = fixture();
  S.cancelJob(s, j.id);
  const end = s.rails.at(-1)!;
  assert.equal(S.removeRailInfrastructure(s, end.id), '');
  const recovery = s.jobs.find((t) => t.railRecovery?.railId === end.id)!;
  const bufferId = bufferAssets(s)[0].id;
  let stored = false;
  tickUntil(
    s,
    () => recovery.status === 'done',
    1200,
    () => {
      if (!bufferAssets(s).some((b) => b.id === bufferId)) stored = true;
      if (recovery.railRecovery?.lifted) assert(stored);
      assert.equal(steel(s), 4);
    },
  );
  assert.equal(s.stacks.find((t) => t.assetId === bufferId)?.qty, 1);
  assert.equal(s.stacks.find((t) => t.assetId === end.id)?.qty, 1);
  S.load(S.save(s));
});

test('whole curve recovery keeps six correctly handed curved modules as finite stock', () => {
  const s = S.createState();
  S.setCreativeMode(s, true);
  s.zones.push({ id: S.id(s, 'zone'), name: 'Steel', x: 45, z: 40, w: 70, d: 40 });
  assert.equal(S.planRailLayout(s, 'curve', { x: 125, z: 5 }, 0, 1).error, '');
  const first = s.rails[0];
  assert.equal(S.removeRailInfrastructure(s, first.id, 'assembly'), '');
  assert.equal(s.rails.length, 0);
  const recovered = s.stacks.filter((t) => t.item === 'railCurve');
  assert.equal(
    recovered.reduce((n, t) => n + t.qty, 0),
    6,
  );
  assert(recovered.every((t) => t.trackHand === 1 && t.assetId));
  assert.equal(bufferAssets(s).length, 0);
  S.load(S.save(s));
});

test('Creative recovery with no storage is atomic and leaves the selected assembly unchanged', () => {
  const s = S.createState();
  S.setCreativeMode(s, true);
  assert.equal(S.planRailLayout(s, 'curve', { x: 125, z: 5 }).error, '');
  const before = S.save(s);
  assert.match(S.removeRailInfrastructure(s, s.rails[0].id, 'assembly'), /stockyard space/);
  assert.equal(S.save(s), before);
});

test('malformed recovery cannot change material, target, installed identity or storage dimensions', () => {
  const { s, j } = fixture();
  tickUntil(s, () => !!j.railWork, 100);
  for (const change of [
    (q: any) => (q.railRecovery.recoveredItem = 'railPoints'),
    (q: any) => (q.railRecovery.railId = 'RAIL-impostor'),
    (q: any) => (q.railRecovery.rail.x += 10),
    (q: any) => (q.stockMove.destination.w = 500),
  ]) {
    const bad = JSON.parse(S.save(s)),
      job = bad.jobs.find((q: any) => q.id === j.id);
    change(job);
    assert.throws(() => S.load(JSON.stringify(bad)), /recovery|stock relocation/);
  }
});

test('normal rebuilding can start from a physically detached downstream endpoint', () => {
  const { s, j, rail } = fixture();
  S.cancelJob(s, j.id);
  S.setCreativeMode(s, true);
  assert.equal(S.removeRailInfrastructure(s, rail.id), '');
  S.setCreativeMode(s, false);
  const replacement = S.planRailLayout(s, 'straight', { x: 140, z: 5 }, 2);
  assert.equal(replacement.error, '');
  tickUntil(s, () => replacement.jobs[0].status === 'done', 1200);
  assert(trackNetwork(s).panels.every((p) => p.connected));
  assert(
    s.rails.some((r) => r.id === rail.id),
    'Reinstallation preserves the recovered component ID',
  );
  S.load(S.save(s));
});

test('manual machine selection immediately overrides an unstarted automatic recovery approach', () => {
  const { s, e, j } = fixture();
  tickUntil(s, () => j.railWork?.phase === 'source-approach', 100);
  const second = {
    ...e,
    id: S.id(s, 'equipment'),
    x: 128,
    z: 24,
    path: [],
    job: undefined,
    operator: undefined,
  };
  s.equipment.push(second);
  assert.equal(setJobEquipment(s, j.parentId!, second.id), '');
  tickUntil(s, () => j.equipment === second.id, 100);
  assert.equal(e.job, undefined);
  assert(!j.railRecovery!.lifted);
  assert(!j.railRecovery!.unbolted);
  S.load(S.save(s));
});

test('canceling a buffer prerequisite releases the dependent recovery for an explicit retry', () => {
  const { s, j } = fixture();
  S.cancelJob(s, j.id);
  const terminal = s.rails.at(-1)!;
  assert.equal(S.removeRailInfrastructure(s, terminal.id), '');
  const dep = s.jobs.find((t) => t.railRecovery?.railId === terminal.id)!;
  const buffer = s.jobs.find(
    (t) => t.kind === 'remove' && t.item === 'bufferStop' && t.parentId === dep.parentId,
  )!;
  S.cancelJob(s, buffer.id);
  assert.equal(dep.status, 'canceled');
  assert.match(dep.reason, /Replan rail recovery/);
  assert(s.rails.some((r) => r.id === terminal.id));
  assert.equal(S.removeRailInfrastructure(s, terminal.id), '');
  const retried = s.jobs.filter((t) => t.railRecovery?.railId === terminal.id).at(-1)!;
  tickUntil(s, () => retried.status === 'done', 1200);
  S.load(S.save(s));
});

test('a left-handed installed curve panel is lifted with its actual orientation and stored unchanged', () => {
  const s = S.createState();
  S.setCreativeMode(s, true);
  assert.equal(S.planRailLayout(s, 'curve', { x: 125, z: 5 }, 0, 1).error, '');
  assert.equal(S.planRailLayout(s, 'curve', { x: 145, z: 25 }, 1, 1).error, '');
  const third = S.planRailLayout(s, 'curve', { x: 125, z: 45 }, 2, -1);
  assert.equal(third.error, '');
  const rail = s.rails.find((r) => r.track?.groupId === third.group!.id)!;
  S.setCreativeMode(s, false);
  const e = seedHandlingResources(s, 'excavator');
  Object.assign(e, { x: 115, z: 55 });
  Object.assign(s.workers[0], { x: 112, z: 56 });
  Object.assign(s.workers[1], { x: 112, z: 58 });
  s.zones.push({ id: S.id(s, 'zone'), name: 'Curve storage', x: 65, z: 75, w: 50, d: 30 });
  assert.equal(S.removeRailInfrastructure(s, rail.id), '');
  const j = s.jobs.find((j) => j.railRecovery?.railId === rail.id)!;
  tickUntil(
    s,
    () => j.status === 'done',
    1200,
    () => {
      if (j.railWork) assert.equal(j.railWork.configuredHand, -1);
      assert.equal(
        s.rails.filter((r) => r.item === 'railCurve').length +
          s.stacks.filter((t) => t.item === 'railCurve').reduce((n, t) => n + t.qty, 0) +
          (e.cargo?.item === 'railCurve' ? e.cargo.qty : 0),
        18,
      );
    },
  );
  assert.equal(s.stacks.find((t) => t.assetId === rail.id)?.trackHand, -1);
  S.load(S.save(s));
});

test('historical switch operation remains readable when the complete installed turnout is recovered', () => {
  const s = S.createState();
  S.setCreativeMode(s, true);
  s.zones.push({ id: S.id(s, 'zone'), name: 'Turnout storage', x: 50, z: 40, w: 60, d: 30 });
  assert.equal(S.planRailLayout(s, 'turnout', { x: 125, z: 5 }).error, '');
  const points = s.rails.find((r) => r.item === 'railPoints')!;
  assert.equal(S.setTurnoutRoute(s, points.id, 'branch'), '');
  seedHandlingResources(s, 'excavator');
  tickUntil(s, () => points.selectedRoute === 'branch', 600);
  const before = Object.fromEntries(
    ['rail', 'railPoints', 'railFrog', 'railClosure', 'railExit'].map((item) => [
      item,
      s.rails.filter((r) => r.item === item).length,
    ]),
  );
  assert.equal(S.removeRailInfrastructure(s, points.id, 'assembly'), '');
  assert.equal(s.rails.length, 0);
  for (const [item, qty] of Object.entries(before))
    assert.equal(
      s.stacks.filter((t) => t.item === item).reduce((n, t) => n + t.qty, 0),
      qty,
    );
  assert(
    s.jobs.some((j) => j.kind === 'throwSwitch' && j.status === 'done' && j.target === points.id),
  );
  S.load(S.save(s));
});
