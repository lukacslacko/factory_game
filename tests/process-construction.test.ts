import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS, BUILDINGS } from '../src/catalog';
import {
  PROCESS_KINDS,
  processComponentDefinitions,
  processAssemblyRender,
} from '../src/process-construction';
import { seedHandlingResources, tickUntil } from './support/yard';
import { staticObstacleRects } from '../src/traffic';
import type { Item, State } from '../src/types';
function yard(kind: Item = 'processTank') {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  s.stacks.push({
    id: 'PROCESS-KIT',
    item: kind,
    qty: 1,
    reserved: 0,
    x: 12,
    z: 30,
    w: MATERIALS[kind].w,
    d: MATERIALS[kind].d,
    source: 'test',
    assetId: 'BLD-0099',
  });
  const size = BUILDINGS[kind];
  for (let x = 30; x < 30 + size.w; x++)
    for (let z = 30; z < 30 + size.d; z++) s.paving[`${x},${z}`] = 'opening';
  const result = S.plan(s, kind, 30, 30, 0, false);
  assert.equal(result.error, '');
  return { s, e, j: result.job! };
}
test('process catalogs provide finite kits, weights, foundations and cardinal component poses', () => {
  assert.equal(MATERIALS.processTank.mass, 4800);
  assert.equal(MATERIALS.processTank.w * MATERIALS.processTank.d, 6);
  assert.equal(MATERIALS.transferPump.mass, 900);
  for (const kind of PROCESS_KINDS) {
    assert.ok(MATERIALS[kind].price > 0);
    assert.ok(MATERIALS[kind].mass > 0);
    assert.ok(
      processComponentDefinitions({ kind, x: 0, z: 0, w: 4, d: 4, rotation: 3 }).every(
        (p) => p.pose.yaw === (kind === 'processTank' ? 0 : Math.PI * 1.5),
      ),
    );
  }
  const s = S.createState();
  S.plan(s, 'processTank', 40, 30);
  assert.equal(s.jobs.filter((j) => j.kind === 'slab').length, 16);
  S.plan(s, 'transferPump', 50, 30);
  assert.equal(s.jobs.filter((j) => j.kind === 'slab').length, 20);
});
test('normal process tank transports one real kit and erects visible courses before completion', () => {
  let { s, j } = yard();
  const phases = new Set<string>();
  let assemblySeen = false,
    fastened = 0,
    previous: any;
  tickUntil(
    s,
    () => j.status === 'done',
    1200,
    () => {
      const h = j.processAssembly;
      if (!h) return;
      assemblySeen = true;
      phases.add(h.phase);
      fastened = Math.max(fastened, h.completed);
      if (j.status !== 'done')
        assert.equal(s.buildings.filter((b) => b.kind === 'processTank').length, 0);
      if (h.part && previous?.kind === h.part.kind && previous.phase === h.phase) {
        assert.ok(
          Math.hypot(h.part.pose.x - previous.x, h.part.pose.z - previous.z) < 0.6,
          'supported load movement remains continuous',
        );
      }
      previous = h.part
        ? { kind: h.part.kind, phase: h.phase, x: h.part.pose.x, z: h.part.pose.z }
        : undefined;
    },
  );
  assert.ok(assemblySeen);
  assert.equal(fastened, 6);
  for (const p of ['unpack', 'rig', 'lift', 'lower', 'fasten', 'inspect'])
    assert.ok(phases.has(p), p);
  assert.equal(s.buildings.at(-1)!.id, 'BLD-0099');
  assert.equal(Object.keys(s.buildings.at(-1)!.componentIds!).length, 6);
  assert.equal(s.stacks.find((t) => t.id === 'PROCESS-KIT')!.qty, 0);
  assert.equal(S.totals(s, 'processTank').installed, 1);
  assert.ok(
    s.movements.some((m) => m.reason === 'Process kit unpacked at the actual construction site'),
  );
  s = S.load(S.save(s));
  assert.equal(s.buildings.at(-1)!.id, 'BLD-0099');
});
test('process construction resumes after reload and cancel reverses components into the original kit', () => {
  let { s, j } = yard();
  tickUntil(s, () => !!j.processAssembly && j.processAssembly.completed >= 2, 1000);
  const before = processAssemblyRender(j)!;
  s = S.load(S.save(s));
  j = s.jobs.find((k) => k.id === j.id)!;
  assert.deepEqual(
    JSON.parse(JSON.stringify(processAssemblyRender(j))),
    JSON.parse(JSON.stringify(before)),
  );
  S.cancelJob(s, j.id);
  tickUntil(s, () => j.status === 'canceled', 1000);
  assert.equal(s.buildings.filter((b) => b.kind === 'processTank').length, 0);
  const recovered = s.stacks.find((t) => t.qty === 1 && t.item === 'processTank')!;
  assert.ok(recovered);
  assert.equal(recovered.assetId, 'BLD-0099');
  assert.equal(S.totals(s, 'processTank').stored, 1);
  assert.equal(S.totals(s, 'processTank').inConstruction, 0);
  S.load(S.save(s));
});
test('all process kits construct physically and Creative has the same completed component records', () => {
  for (const kind of PROCESS_KINDS.filter((k) => k !== 'processTank')) {
    const { s, j } = yard(kind);
    tickUntil(s, () => j.status === 'done', 1000);
    assert.equal(
      Object.keys(s.buildings.at(-1)!.componentIds!).length,
      processComponentDefinitions(j).length,
      kind,
    );
  }
  const s = S.createState();
  s.creative = true;
  PROCESS_KINDS.forEach((kind, i) => {
    assert.equal(S.plan(s, kind, 40 + i * 8, 40, i % 4).error, '');
    const b = s.buildings.at(-1)!;
    assert.equal(b.rotation, i % 4);
    assert.equal(Object.keys(b.componentIds!).length, processComponentDefinitions(b).length);
  });
  assert.equal(s.stacks.length, 0);
  assert.equal(s.equipment.length, 0);
  S.load(S.save(s));
});
test('malformed process assembly phases, identities, poses and ownership are rejected atomically', () => {
  const { s, j } = yard();
  tickUntil(s, () => j.processAssembly?.phase === 'rig', 1000);
  const saved = JSON.parse(S.save(s));
  const index = s.jobs.indexOf(j);
  for (const modify of [
    (x: any) => (x.phase = 'magic'),
    (x: any) => (x.completed = 100),
    (x: any) => (x.clock = -1),
    (x: any) => (x.kitPose.x = null),
    (x: any) => (x.componentIds.base = 'FAKE'),
  ]) {
    const bad = structuredClone(saved);
    modify(bad.jobs[index].processAssembly);
    assert.throws(() => S.load(JSON.stringify(bad)), /Invalid save/);
  }
  const bad = structuredClone(saved);
  bad.jobs[index].delivered = false;
  assert.throws(() => S.load(JSON.stringify(bad)), /ownership/);
});
test('process kit procurement uses capacity-limited real trucks and conserves every delivered item', () => {
  const s = S.createState();
  S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
  seedHandlingResources(s, 'excavator');
  const lines = [
    { item: 'processTank', qty: 1 },
    { item: 'transferPump', qty: 1 },
    { item: 'processPipe', qty: 3 },
    { item: 'pipeElbow', qty: 1 },
    { item: 'pipeTee', qty: 1 },
    { item: 'processValve', qty: 1 },
    { item: 'processGauge', qty: 1 },
  ];
  const ids = S.purchaseBatch(s, lines, 'road');
  assert.equal(ids.length, 2);
  assert.equal(
    s.orders.reduce((n, o) => n + o.total, 0),
    180 + lines.reduce((n, l) => n + MATERIALS[l.item as Item].price * l.qty, 0),
  );
  tickUntil(s, () => s.orders.every((o) => o.status === 'done'), 1800);
  for (const l of lines) {
    assert.equal(S.totals(s, l.item as Item).stored, l.qty);
    assert.equal(S.totals(s, l.item as Item).delivered, l.qty);
  }
  assert.equal(s.orders.length, 2);
  S.load(S.save(s));
});
test('active process workers cannot be stolen by manual movement, boarding or support reassignment', async () => {
  const { setEquipmentAssistant } = await import('../src/work-crews');
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator'),
    w = s.workers[1];
  w.processAssignment = 'PROCESS-001';
  assert.match(S.moveWorker(s, w.id, { x: 40, z: 40 }), /process operation/);
  assert.match(S.enterVehicle(s, w.id, e.id), /process operation/);
  assert.match(S.releaseWorker(s, w.id), /process operation/);
  assert.match(setEquipmentAssistant(s, e.id, w.id), /process operation/);
  assert.equal(w.processAssignment, 'PROCESS-001');
  assert.equal(w.path.length, 0);
});
test('canceling an airborne or just-placed part safely finishes lowering before repacking', () => {
  for (const phase of ['lift', 'lower', 'fasten'] as const) {
    const { s, j } = yard('transferPump');
    tickUntil(s, () => j.processAssembly?.phase === phase && j.processAssembly.clock > 0.2, 1000);
    S.cancelJob(s, j.id);
    const totalBefore = S.totals(s, 'transferPump');
    assert.equal(
      totalBefore.stored + totalBefore.cargo + totalBefore.inConstruction + totalBefore.installed,
      1,
    );
    tickUntil(
      s,
      () => j.status === 'canceled',
      1000,
      () => {
        const t = S.totals(s, 'transferPump');
        assert.equal(t.stored + t.cargo + t.inConstruction + t.installed, 1);
      },
    );
    assert.equal(S.totals(s, 'transferPump').stored, 1);
    assert.equal(s.equipment[0].cargo, undefined);
    S.load(S.save(s));
  }
});
test('partial process construction is a solid obstacle and upper tank fasteners require ladder work', () => {
  const { s, j } = yard();
  let climbed = false;
  tickUntil(
    s,
    () => j.status === 'done',
    1200,
    () => {
      if (j.status === 'doing' && j.processAssembly && j.processAssembly.completed > 0)
        assert.ok(staticObstacleRects(s).some((r) => r.id === j.id + '-process'));
      if (j.processAssembly?.ladder && s.workers.some((w) => (w.y || 0) > 0.3)) climbed = true;
    },
  );
  assert.ok(climbed);
});
test('process recovery rejects nonempty vessels and connected pumps without changing plans', () => {
  const s = S.createState();
  s.creative = true;
  S.plan(s, 'processTank', 40, 40);
  S.plan(s, 'transferPump', 50, 40);
  const tank = s.process!.tanks[0],
    pump = s.process!.pumps[0];
  tank.liters = 100;
  tank.product = 'bulkWater';
  pump.hose = 'connected';
  const before = S.save(s);
  assert.match(S.removeBuilding(s, tank.id), /Drain/);
  assert.match(S.removeBuilding(s, pump.id), /disconnect/);
  assert.equal(S.save(s), before);
});
test('one normal construction crew builds an adjacent connected process line and physically opens its valve', async () => {
  const { processNetworkRoute, requestProcessValve } = await import('../src/process-fluids');
  let s = S.createState();
  const e = seedHandlingResources(s, 'excavator');
  e.x = 33;
  e.z = 40;
  s.workers[0].x = 31;
  s.workers[0].z = 40;
  s.workers[1].x = 31;
  s.workers[1].z = 42;
  const quantities: Partial<Record<Item, number>> = {
    processTank: 1,
    transferPump: 1,
    processPipe: 3,
    processValve: 1,
    processGauge: 1,
    pipeTee: 1,
  };
  Object.entries(quantities).forEach(([kind, qty], index) => {
    const item = kind as Item,
      m = MATERIALS[item];
    s.stacks.push({
      id: 'PROCESS-STOCK-' + index,
      item,
      qty: qty!,
      reserved: 0,
      x: 12 + index * 4,
      z: 40,
      w: m.w,
      d: m.d,
      source: 'test',
    });
  });
  for (const r of [
    { x: 40, z: 30, w: 2, d: 2 },
    { x: 48, z: 28, w: 4, d: 4 },
  ])
    for (let x = r.x; x < r.x + r.w; x++)
      for (let z = r.z; z < r.z + r.d; z++) s.paving[`${x},${z}`] = 'EXISTING';
  assert.equal(S.plan(s, 'transferPump', 40, 30, 0, false).error, '');
  assert.equal(S.plan(s, 'processTank', 48, 28, 0, false).error, '');
  const line: Item[] = [
    'processPipe',
    'processValve',
    'processGauge',
    'processPipe',
    'pipeTee',
    'processPipe',
  ];
  line.forEach((kind, i) => assert.equal(S.plan(s, kind, 42 + i, 30, 0, false).error, ''));
  tickUntil(s, () => s.jobs.every((j) => j.status === 'done'), 2400);
  assert.equal(s.buildings.length, 8);
  assert.equal(s.equipment[0].id, e.id);
  const pump = s.buildings.find((b) => b.kind === 'transferPump')!,
    tank = s.buildings.find((b) => b.kind === 'processTank')!,
    valve = s.buildings.find((b) => b.kind === 'processValve')!;
  assert.equal(
    processNetworkRoute(s, pump.id, tank.id),
    undefined,
    'Closed valve initially isolates the assembled tank',
  );
  assert.equal(processNetworkRoute(s, pump.id, tank.id, true)?.length, 8);
  assert.equal(requestProcessValve(s, valve.id, true), undefined);
  tickUntil(s, () => s.process!.valves[0].open, 120);
  assert.deepEqual(processNetworkRoute(s, pump.id, tank.id), [
    pump.id,
    ...s.buildings
      .filter((b) => line.includes(b.kind as Item))
      .sort((a, b) => a.x - b.x)
      .map((b) => b.id),
    tank.id,
  ]);
  s = S.load(S.save(s));
  assert.equal(processNetworkRoute(s, pump.id, tank.id)?.length, 8);
  for (const kind of Object.keys(quantities) as Item[]) assert.equal(S.totals(s, kind).stored, 0);
});
