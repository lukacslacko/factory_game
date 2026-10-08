import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import * as Sim from '../src/sim';
import { MATERIALS, PURCHASE_GROUPS } from '../src/catalog';
import { seedHandlingResources } from './support/yard';
import { renderState } from '../native-runtime/render';
import { trackGeometry, trackSections } from '../src/track';
const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.execPath, ['native-runtime/build.mjs'], { cwd: root, stdio: 'pipe' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const token = 'native-runtime-test-authentication-token';
class Client {
  socket: net.Socket;
  next = 0;
  latest: any;
  snapshots = 0;
  input = '';
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', (chunk) => {
      this.input += chunk.toString();
      let n;
      while ((n = this.input.indexOf('\n')) >= 0) {
        const text = this.input.slice(0, n);
        this.input = this.input.slice(n + 1);
        const m = JSON.parse(text);
        if (m.type === 'snapshot') {
          this.latest = m;
          this.snapshots++;
        } else if (m.type === 'reply') {
          const p = this.pending.get(m.id);
          if (p) {
            this.pending.delete(m.id);
            p.resolve(m);
          }
        }
      }
    });
    socket.on('error', () => {});
  }
  request(action: string, args: any = {}, auth = token): Promise<any> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(
        JSON.stringify({ id, action, args, token: action === 'hello' ? auth : undefined }) + '\n',
      );
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`Timeout: ${action}`));
      }, 8000);
      timer.unref();
    });
  }
  async ok(action: string, args: any = {}) {
    const r = await this.request(action, args);
    assert.equal(r.ok, true, r.error);
    return r.result;
  }
  async snapshot() {
    for (let n = 0; n < 100; n++) {
      if (this.latest) return this.latest;
      await sleep(20);
    }
    throw new Error('Snapshot missing');
  }
}
async function launch(dataDir?: string) {
  const dir = dataDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'plant01-native-test-'))),
    portFile = path.join(dir, `port-${Date.now()}.json`);
  const child = spawn(
    process.execPath,
    [
      '--max-old-space-size=192',
      path.join(root, 'native/runtime/service.cjs'),
      `--token=${token}`,
      `--port-file=${portFile}`,
      `--data-dir=${dir}`,
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr!.on('data', (c) => (stderr += c.toString()));
  let port: number | undefined;
  for (let n = 0; n < 100; n++) {
    try {
      port = JSON.parse(await fs.readFile(portFile, 'utf8')).port;
      break;
    } catch {}
    if (child.exitCode !== null) throw new Error(`Service exited: ${stderr}`);
    await sleep(20);
  }
  if (!port) {
    child.kill();
    throw new Error(`No native port: ${stderr}`);
  }
  const socket = net.createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  const client = new Client(socket);
  await client.ok('hello');
  await client.snapshot();
  return {
    dir,
    portFile,
    client,
    child,
    stderr: () => stderr,
    async close() {
      if (child.exitCode === null) {
        client.socket.end();
        await Promise.race([once(child, 'exit'), sleep(3000)]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      client.socket.destroy();
    },
  };
}

test('native new-yard modes include one opening cabinet and share the grouped purchase catalog', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const c = host.client;
  const snapshot = await c.snapshot();
  assert.deepEqual(snapshot.purchaseGroups, PURCHASE_GROUPS);
  assert.equal(snapshot.catalog.services.power.purchasable, false);
  assert.equal(snapshot.purchaseGroups[0].id, 'workers');
  assert.equal(snapshot.purchaseGroups.flatMap((g: any) => g.items).includes('power'), false);
  for (const mode of ['empty', 'starter', 'example']) {
    await c.ok('new_game', { mode });
    await c.ok('pause', { paused: true });
    const state = JSON.parse((await c.ok('export')).json);
    const stations = state.buildings.filter((b: any) => b.kind === 'power');
    assert.equal(stations.length, 1, mode);
    assert.equal(stations[0].id, 'BLD-0000');
    assert.equal(stations[0].source, 'opening');
    assert.equal(stations[0].connected, true);
    assert.equal(state.utilities.power, true);
    assert.ok(state.orders.every((o: any) => o.item !== 'power'));
    assert.equal((await c.ok('tables', { table: 'electricalSources' })).length, 1);
    const mixed = [{ item: 'slab', qty: 12 }, { item: 'power', qty: 1 }];
    for (const [action, args] of [
      ['purchase_preview', { lines: mixed, mode: 'road' }],
      ['purchase_batch', { lines: mixed, mode: 'road' }],
      ['purchase', { item: 'power', qty: 1, mode: 'road' }],
    ] as const) {
      assert.equal((await c.request(action, args)).ok, false);
      assert.deepEqual(JSON.parse((await c.ok('export')).json), state, `${action} must reject atomically`);
    }
    await c.ok('save');
    const saved = Sim.load(await fs.readFile(path.join(host.dir, 'yard.json'), 'utf8'));
    assert.deepEqual(saved.buildings.find((b) => b.id === 'BLD-0000'), stations[0]);
  }
});

test('native host authenticates, starts in menu, and persists on disconnect without browser focus', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const first = await host.client.snapshot();
  assert.equal(first.storage.started, false);
  assert.equal(first.state.paused, true);
  assert.equal(first.storage.hasSave, false);
  await sleep(200);
  assert.equal((await host.client.ok('ping')).elapsed, 0);
  await host.client.ok('new_game', { mode: 'empty' });
  const before = (await host.client.ok('ping')).elapsed;
  await sleep(1100);
  const after = (await host.client.ok('ping')).elapsed;
  assert.ok(after - before >= 0.95 && after - before <= 1.3, `Real-time elapsed ${after - before}`);
  await host.client.ok('pause', { paused: true });
  const elapsed = (await host.client.ok('ping')).elapsed;
  await sleep(160);
  assert.equal((await host.client.ok('ping')).elapsed, elapsed);
  await host.close();
  const saved = Sim.load(await fs.readFile(path.join(host.dir, 'yard.json'), 'utf8'));
  assert.equal(saved.elapsed, elapsed);
  assert.equal(
    await fs.stat(host.portFile).then(
      () => true,
      () => false,
    ),
    false,
  );
  const resumed = await launch(host.dir);
  t.after(() => resumed.close());
  const snap = await resumed.client.snapshot();
  assert.equal(snap.storage.hasSave, true);
  assert.equal(snap.storage.started, false);
  assert.equal(snap.state.elapsed, elapsed);
  await resumed.client.ok('continue');
  assert.equal((await resumed.client.ok('ping')).paused, false);
  await resumed.client.ok('shutdown');
  await once(resumed.child, 'exit');
  assert.equal(resumed.child.exitCode, 0);
});

test('native batches, work planning, inspection, equipment roles, schedules and SQL retain simulation semantics', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const c = host.client;
  await c.ok('new_game', { mode: 'example' });
  await c.ok('pause', { paused: true });
  const preview = await c.ok('purchase_preview', {
    lines: [
      { item: 'builder', qty: 4 },
      { item: 'slab', qty: 24 },
    ],
    mode: 'rail',
  });
  assert.ok(preview.loads.length >= 2);
  assert.equal(preview.mass, 24 * MATERIALS.slab.mass);
  const ordered = await c.ok('purchase_batch', {
    lines: [
      { item: 'builder', qty: 4 },
      { item: 'slab', qty: 24 },
    ],
    mode: 'rail',
  });
  assert.ok(ordered.orders.length >= 2);
  await c.ok('zone', { rect: { x: 65, z: 30, w: 20, d: 15 }, name: 'Native rail store' });
  const paved = await c.ok('pave', { rect: { x: 65, z: 45, w: 3, d: 3 } });
  assert.equal(paved.count, 9);
  const rail = await c.ok('rail_preview', {
    layout: 'straight',
    x: 127,
    z: 6,
    heading: 2,
    hand: 1,
    snap: true,
  });
  assert.deepEqual(rail.origin, { x: 125, z: 5 });
  assert.equal(rail.heading, 0);
  assert.equal(rail.error, '');
  const plan = await c.ok('plan_rail', {
    layout: 'straight',
    x: 125,
    z: 5,
    heading: 0,
    hand: 1,
    snap: true,
  });
  assert.equal(plan.jobs.length, 1);
  const e = (await c.ok('tables', { table: 'equipment' }))[0],
    workers = await c.ok('tables', { table: 'workers' });
  await c.ok('equipment_activities', { id: e.id, activities: ['rail'] });
  await c.ok('assistant', {
    id: e.id,
    workerId: workers.find((w: any) => w.role === 'builder').id,
  });
  await c.ok('job_equipment', { id: plan.jobs[0].id, equipmentId: e.id });
  await c.ok('worker_schedule', { id: workers[0].id, startHour: 6, endHour: 18 });
  const inspection = await c.ok('inspect', { id: e.id });
  assert.deepEqual(inspection.entity.allowedWork, ['rail']);
  assert.ok(inspection.intent);
  const sql = await c.ok('sql', { sql: 'SELECT COUNT(*) AS count FROM orders;' });
  assert.ok(sql[0].values[0][0] >= 2);
  const unsupported = await c.request('sql', { sql: 'DELETE FROM equipment;' });
  assert.equal(unsupported.ok, false);
  const invalid = await c.request('pave', { rect: { x: 1, z: 2, w: 100000, d: 100000 } });
  assert.equal(invalid.ok, false);
});

test('native JSON import/export, backup, CSV and bounded rolling diagnostics are local files', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const c = host.client;
  await c.ok('new_game', { mode: 'empty' });
  await c.ok('pause', { paused: true });
  await c.ok('save');
  const demo = Sim.demoState();
  demo.name = 'Imported local yard';
  const imported = path.join(host.dir, 'browser-yard.json');
  await fs.writeFile(imported, Sim.save(demo));
  await c.ok('import', { path: imported });
  assert.equal(JSON.parse((await c.ok('export')).json).name, 'Imported local yard');
  const exported = path.join(host.dir, 'export.json');
  await c.ok('export', { path: exported });
  assert.equal(Sim.load(await fs.readFile(exported, 'utf8')).name, 'Imported local yard');
  const prior = await fs.readFile(path.join(host.dir, 'yard.json'), 'utf8');
  const bad = await c.request('import', { json: '{"workers":[]}' });
  assert.equal(bad.ok, false);
  assert.equal(await fs.readFile(path.join(host.dir, 'yard.json'), 'utf8'), prior);
  await c.ok('restore_backup');
  assert.equal(JSON.parse((await c.ok('export')).json).workers.length, 0);
  const diag = path.join(host.dir, 'diagnostics.json');
  await c.ok('diagnostics', { path: diag });
  const archive = JSON.parse(await fs.readFile(diag, 'utf8'));
  assert.equal(archive.format, 'plant01-diagnostics');
  assert.ok(archive.entries.length <= 12000);
  assert.ok(archive.checkpoints.length <= 4);
  const csvPath = path.join(host.dir, 'costs.csv');
  await c.ok('export_costs', { path: csvPath });
  assert.match(await fs.readFile(csvPath, 'utf8'), /^"id","time","category"/);
});

test('unauthenticated connection cannot change a yard or obtain a snapshot', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const other = net.createConnection({
    host: '127.0.0.1',
    port: JSON.parse(await fs.readFile(host.portFile, 'utf8')).port,
  });
  await once(other, 'connect');
  let data = '';
  other.on('data', (d) => (data += d));
  other.write(JSON.stringify({ id: 1, action: 'new_game', args: { mode: 'example' } }) + '\n');
  await once(other, 'close');
  assert.equal(data.includes('snapshot'), false);
  assert.equal((await host.client.ok('ping')).started, false);
});

test('slow native client has bounded snapshots while independent simulation keeps ticking', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const c = host.client;
  const yard = Sim.createState();
  yard.notices = Array.from({ length: 1800 }, (_, i) => ({
    id: `NTC-${i + 1}`,
    time: yard.time,
    title: 'Transport backpressure test',
    detail: 'x'.repeat(1100),
    entity: '',
    state: 'todo' as const,
    seen: false,
  }));
  yard.next = 2000;
  await c.ok('import', { json: Sim.save(yard) });
  await c.ok('speed', { value: 1 });
  const before = await c.ok('ping');
  c.socket.pause();
  await sleep(1800);
  c.socket.resume();
  const after = await c.ok('ping');
  assert.ok(after.elapsed - before.elapsed >= 1.6);
  assert.ok(after.snapshotsSkipped > 0, JSON.stringify(after));
  assert.ok(after.pendingBytes <= 8_000_000);
  assert.ok(host.child.exitCode === null);
});

test('native render poses honor paved contact, vehicle occupancy, and coupling spacing', () => {
  const yard = Sim.demoState(),
    e = yard.equipment[0],
    w = yard.workers[0];
  yard.paving[`${Math.floor(e.x)},${Math.floor(e.z)}`] = 'test';
  e.y = undefined;
  w.shiftPhase = 'home';
  const render = renderState(yard);
  assert.equal(render.actors.find((a) => a.id === e.id)?.y, 0.105);
  assert.equal(render.actors.find((a) => a.id === w.id)?.visible, false);
  assert.equal(render.equipmentIntents.length, yard.equipment.length);
});

test('native 10× clock retains small physical steps and matches direct simulation movement', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const c = host.client;
  await c.ok('new_game', { mode: 'example' });
  await c.ok('pause', { paused: true });
  const initial = JSON.parse((await c.ok('export')).json);
  await c.ok('speed', { value: 10 });
  await sleep(650);
  await c.ok('pause', { paused: true });
  const actual = JSON.parse((await c.ok('export')).json),
    expected = Sim.load(JSON.stringify(initial));
  expected.paused = false;
  expected.speed = 10;
  const count = Math.round((actual.elapsed - initial.elapsed) / 0.05);
  assert.ok(count >= 110 && count <= 150, `Steps at 10×: ${count}`);
  for (let n = 0; n < count; n++) Sim.tick(expected, 0.05);
  for (const e of expected.equipment) {
    const other = actual.equipment.find((p: any) => p.id === e.id);
    assert.ok(Math.abs(other.x - e.x) < 1e-5);
    assert.ok(Math.abs(other.z - e.z) < 1e-5);
    assert.ok(Math.abs((other.yaw || 0) - (e.yaw || 0)) < 1e-5);
  }
});

test('bounded display ledgers preserve authoritative totals and full SQL/file history', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const c = host.client;
  const yard = Sim.createState();
  yard.name = 'Full ledger test';
  yard.costs = Array.from({ length: 2500 }, (_, i) => ({
    id: `COST-${i + 1}`,
    time: yard.time,
    category: 'test',
    entity: '',
    description: 'Audited expense',
    amount: 1,
  }));
  yard.next = 3000;
  const before = c.latest.seq;
  await c.ok('import', { json: Sim.save(yard) });
  for (let n = 0; n < 50 && c.latest.seq <= before; n++) await sleep(20);
  assert.equal(c.latest.state.costs.length, 2000);
  assert.equal(c.latest.summaries.costCount, 2500);
  assert.equal(c.latest.summaries.totalCosts, 2500);
  const sql = await c.ok('sql', {
    sql: 'SELECT SUM(amount) AS total, COUNT(*) AS count FROM costs;',
  });
  assert.deepEqual(sql[0].values, [[2500, 2500]]);
  assert.equal(JSON.parse((await c.ok('export')).json).costs.length, 2500);
});

test('native release command clears manual vehicle control and its stale driving destination', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const s = Sim.createState(),
    e = seedHandlingResources(s, 'excavator');
  const op = s.workers.find((w) => w.role === 'operator')!;
  e.operator = op.id;
  op.vehicle = e.id;
  op.x = e.x;
  op.z = e.z;
  s.paused = true;
  const c = host.client;
  await c.ok('import', { json: Sim.save(s) });
  await c.ok('pause', { paused: true });
  await c.ok('control', { id: op.id });
  await c.ok('move_worker', { id: op.id, x: 20, z: 45 });
  await c.ok('release', { id: op.id });
  const released = Sim.load((await c.ok('export')).json);
  const actual = released.equipment.find((q) => q.id === e.id)!;
  assert.equal(released.workers.find((w) => w.id === op.id)!.duty, 'auto');
  assert.equal(actual.path.length, 0);
  assert.equal(actual.trafficGoal, undefined);
  assert.equal(actual.operator, op.id);
});

test('native switch planning exposes open ends, physical buffer orders and converging turnout flow', async (t) => {
  const yard = Sim.createState();
  for (const piece of trackSections('turnout', { x: 125, z: 5 }, 0, 1)) {
    const geometry = trackGeometry(piece);
    yard.rails.push({
      id: `SWITCH-${piece.section}-${piece.route || 'points'}`,
      ...geometry.rect,
      rotation: 0,
      length: geometry.length,
      item: Sim.trackItem(piece),
      track: piece,
    });
  }
  yard.buffer = { x: 145, z: 5 };
  const host = await launch();
  t.after(() => host.close());
  const c = host.client;
  await c.ok('import', { json: Sim.save(yard) });
  const buffers = await c.ok('tables', { table: 'buffers' });
  assert.equal(buffers[0].id, 'BUFFER-001');
  const visual = renderState(yard);
  assert.equal(visual.buffers[0].secured, true);
  assert.equal(visual.railOpenEndpoints.find((p) => p.z === 5)?.occupiedBy, buffers[0].id);
  const inspect = await c.ok('inspect', { id: buffers[0].id });
  assert.equal(inspect.type, 'buffers');
  const planned = await c.ok('plan_buffer', { x: 145, z: 10 });
  assert.equal(planned.job.item, 'bufferStop');
  assert.equal((await c.request('plan_buffer', { x: 145, z: 10 })).ok, false);
  const buy = await c.ok('purchase_preview', {
    lines: [{ item: 'bufferStop', qty: 2 }],
    mode: 'road',
  });
  assert.equal(buy.mass, MATERIALS.bufferStop.mass * 2);
  const exported = Sim.load((await c.ok('export')).json);
  assert.ok(exported.jobs.some((j) => j.item === 'bufferStop'));
  await c.ok('import', { json: Sim.save(yard) });
  const preview = await c.ok('rail_preview', {
    layout: 'turnout',
    x: 145,
    z: 5,
    heading: 0,
    hand: 1,
    flow: 'converging',
    snap: false,
  });
  assert.equal(preview.error, '');
  assert.equal(preview.flow, 'converging');
  assert.equal(preview.pieces[0].section, 3);
  assert.equal(preview.pieces.at(-1).section, 0);
  const joined = await c.ok('plan_rail', {
    layout: 'turnout',
    x: 145,
    z: 5,
    heading: 0,
    hand: 1,
    flow: 'converging',
    snap: false,
  });
  assert.equal(joined.jobs.length, 7);
  assert.ok(joined.jobs.every((j: any) => j.track.flow === 'converging'));
  const sql = await c.ok('sql', { sql: 'SELECT id, secured FROM buffers;' });
  assert.equal(sql[0].values[0][0], 'BUFFER-001');
  const badFlow = await c.request('rail_preview', {
    layout: 'straight',
    x: 145,
    z: 5,
    flow: 'unknown',
  });
  assert.equal(badFlow.ok, false);
});

test('native freight reception exposes car IDs, named routing, unloading controls and conserved SQL manifests', async (t) => {
  const { saveRailLocation } = await import('../src/rail-locations');
  const s = Sim.createState();
  assert.equal(Sim.addZone(s, { x: 35, z: 28, w: 24, d: 15 }, 'Freight destination'), '');
  assert.equal(
    saveRailLocation(s, {
      name: 'Reception A',
      kind: 'unloading',
      trackId: 'BOOTSTRAP-SIDING',
      route: 'straight',
      offset: 50,
      length: 70,
    }),
    undefined,
  );
  const [oid] = Sim.purchaseBatch(s, [{ item: 'slab', qty: 200 }], 'rail', {
    railLocationId: s.railLocations![0].id,
    storageZoneId: s.zones[0].id,
  });
  for (let n = 0; n < 5000 && s.orders[0].status !== 'unloading'; n++) Sim.tick(s, 0.1);
  assert.equal(s.orders[0].status, 'unloading');
  assert.equal(s.orders[0].arrived, 0, 'Received train waits for the player to begin unloading');
  s.paused = true;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plant01-freight-native-'));
  await fs.writeFile(path.join(dir, 'yard.json'), Sim.save(s));
  const host = await launch(dir);
  t.after(() => host.close());
  const c = host.client;
  const preview = await c.ok('purchase_preview', {
    lines: [{ item: 'slab', qty: 200 }],
    mode: 'rail',
  });
  assert.equal(preview.railCars, 2);
  assert.equal(preview.trainLength, 43.7);
  assert.equal(preview.transportCost, 240);
  const snap = await c.snapshot();
  const cars = snap.render.railCars;
  assert.equal(cars.length, 2);
  assert.notEqual(cars[0].id, cars[1].id);
  assert.ok(Math.abs(cars[0].x - cars[1].x - 17.6) < 0.01);
  assert.equal(cars[0].bogies.length, 2);
  const inspected = await c.ok('inspect', { id: cars[1].id });
  assert.equal(inspected.type, 'freightCars');
  assert.equal(inspected.entity.orderId, oid);
  const loco = await c.ok('inspect', { id: s.orders[0].railFreight!.locomotiveId });
  assert.equal(loco.type, 'locomotives');
  assert.equal(
    (await c.request('configure_rail_freight', { orderId: oid, railLocationId: '' })).ok,
    false,
    'Approaching/received trains cannot be rerouted',
  );
  const rows = await c.ok('sql', {
    sql: 'SELECT SUM(qty) AS ordered, SUM(arrived) AS received FROM freight_car_lines;',
  });
  assert.deepEqual(rows[0].values, [[200, 0]]);
  const premature = await c.request('unload', { orderId: oid, workerId: 'none' });
  assert.equal(premature.ok, false);
  assert.match(premature.error, /Start unloading/);
  await c.ok('begin_rail_unloading', { orderId: oid });
  await c.ok('save');
  const saved = Sim.load(await fs.readFile(path.join(dir, 'yard.json'), 'utf8'));
  assert.equal(saved.orders[0].railFreight!.unloadRequested, true);
  assert.deepEqual(
    saved.orders[0].railFreight!.cars.map((car) => car.id),
    cars.map((car: any) => car.id),
  );
});

test('native creative toggle instantly places completed assets and persists without changing normal planning', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  await host.client.ok('new_game', { mode: 'empty' });
  await host.client.ok('pause', { paused: true });
  assert.equal((await host.client.request('creative', { enabled: 'yes' })).ok, false);
  assert.deepEqual(await host.client.ok('creative', { enabled: true }), { creative: true });
  assert.equal((await host.client.ok('plan', { kind: 'shed', x: 60, z: 30 })).job.status, 'done');
  assert.equal((await host.client.ok('pave', { rect: { x: 50, z: 30, w: 2, d: 3 } })).count, 6);
  assert.ok(
    (
      await host.client.ok('plan_rail', {
        layout: 'straight',
        x: 125,
        z: 5,
        heading: 0,
        hand: 1,
        snap: false,
      })
    ).jobs.every((j: any) => j.status === 'done'),
  );
  await host.client.ok('save');
  const stored = Sim.load(await fs.readFile(path.join(host.dir, 'yard.json'), 'utf8'));
  assert.equal(stored.creative, true);
  assert.equal(stored.buildings.filter((b) => b.kind === 'shed').length, 1);
  assert.equal(stored.rails.length, 1);
  assert.equal(stored.orders.length, 0);
  assert.equal(stored.costs.length, 0);
  await host.client.ok('creative', { enabled: false });
  assert.equal((await host.client.ok('plan', { kind: 'office', x: 80, z: 30 })).job.status, 'todo');
});

test('native recovery command stores installed steel and exposes both ends of a gap', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const s = Sim.createState();
  s.paused = true;
  Sim.setCreativeMode(s, true);
  s.zones.push({ id: Sim.id(s, 'zone'), name: 'Recovered steel', x: 40, z: 35, w: 65, d: 35 });
  for (let x = 125; x < 150; x += 5)
    assert.equal(Sim.planRailLayout(s, 'straight', { x, z: 5 }).error, '');
  const panel = s.rails[2];
  await host.client.ok('import', { json: Sim.save(s) });
  assert.equal(
    (await host.client.request('remove_rail', { id: panel.id, scope: 'teleport' })).ok,
    false,
  );
  await host.client.ok('remove_rail', { id: panel.id, scope: 'panel' });
  await host.client.ok('save');
  const saved = Sim.load(await fs.readFile(path.join(host.dir, 'yard.json'), 'utf8'));
  assert(!saved.rails.some((r) => r.id === panel.id));
  assert.equal(saved.stacks.find((t) => t.assetId === panel.id)?.qty, 1);
  const endpoints = renderState(saved).railOpenEndpoints;
  assert(endpoints.some((p: any) => p.x === 135 && p.z === 5));
  assert(endpoints.some((p: any) => p.x === 140 && p.z === 5));
  const preview = await host.client.ok('rail_preview', { layout: 'straight', x: 140, z: 5 });
  assert.deepEqual(preview.origin, { x: 140, z: 5 });
  assert.equal(preview.heading, 2);
  assert.equal(preview.error, '');
});

test('native rail editing previews are read-only and match the committed Creative recovery', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const c = host.client,
    s = Sim.createState();
  s.paused = true;
  Sim.setCreativeMode(s, true);
  s.zones.push({ id: Sim.id(s, 'zone'), name: 'Recovery yard', x: 40, z: 35, w: 30, d: 20 });
  assert.equal(Sim.planRailLayout(s, 'straight', { x: 125, z: 5 }).error, '');
  await c.ok('import', { json: Sim.save(s) });
  const before = await c.ok('export');
  const preview = await c.ok('rail_edit_preview', {
    operation: 'recover_rail',
    id: s.rails[0].id,
    scope: 'panel',
  });
  assert.equal(preview.mode, 'creative');
  assert.equal(preview.constraint, '');
  assert.equal(preview.storageError, '');
  assert.deepEqual(preview.materials.map((m: any) => [m.item, m.qty]).sort(), [
    ['bufferStop', 1],
    ['rail', 1],
  ]);
  assert.equal(preview.destinations.length, 2);
  assert(preview.destinations.every((d: any) => d.zoneId === s.zones[0].id));
  assert.deepEqual(
    await c.ok('export'),
    before,
    'Preview must not change IDs, jobs, stock, or the event ledger',
  );
  await c.ok('remove_rail', { id: s.rails[0].id, scope: 'panel' });
  await c.ok('save');
  const recovered = Sim.load(await fs.readFile(path.join(host.dir, 'yard.json'), 'utf8'));
  for (const destination of preview.destinations) {
    const stock = recovered.stacks.find(
      (q) => q.assetId === destination.assetId || q.railAssetIds?.includes(destination.assetId),
    );
    assert(stock, destination.assetId);
    assert.equal(stock.x, destination.x);
    assert.equal(stock.z, destination.z);
  }
  assert.equal(recovered.rails.length, 0);
  assert.equal(
    (await c.request('rail_edit_preview', { operation: 'delete_everything', id: 'BUFFER-001' })).ok,
    false,
  );
  assert.equal(
    (
      await c.request('rail_edit_preview', {
        operation: 'recover_rail',
        id: 'none',
        scope: 'unknown',
      })
    ).ok,
    false,
  );
});

test('native buffer editing explains missing resources, recovers instantly in Creative, and rejects full storage', async (t) => {
  const host = await launch();
  t.after(() => host.close());
  const c = host.client,
    s = Sim.createState();
  s.paused = true;
  await c.ok('import', { json: Sim.save(s) });
  const normal = await c.ok('rail_edit_preview', { operation: 'recover_buffer', id: 'BUFFER-001' });
  assert.equal(normal.mode, 'physical');
  assert.equal(normal.constraint, '');
  assert.match(normal.storageError, /stockyard|storage/i);
  assert(normal.warnings.some((w: string) => /operator/i.test(w)));
  assert(normal.warnings.some((w: string) => /machine/i.test(w)));
  await c.ok('creative', { enabled: true });
  const full = await c.ok('rail_edit_preview', { operation: 'recover_buffer', id: 'BUFFER-001' });
  assert.match(full.constraint, /stockyard|storage/i);
  assert.equal((await c.request('remove_buffer', { id: 'BUFFER-001' })).ok, false);
  s.creative = true;
  s.zones.push({ id: Sim.id(s, 'zone'), name: 'Stop storage', x: 40, z: 35, w: 10, d: 10 });
  await c.ok('import', { json: Sim.save(s) });
  const preview = await c.ok('rail_edit_preview', {
    operation: 'recover_buffer',
    id: 'BUFFER-001',
  });
  assert.equal(preview.constraint, '');
  assert.equal(preview.destinations.length, 1);
  await c.ok('remove_buffer', { id: 'BUFFER-001' });
  await c.ok('save');
  const saved = Sim.load(await fs.readFile(path.join(host.dir, 'yard.json'), 'utf8'));
  assert.equal(saved.buffers?.length, 0);
  assert.equal(saved.stacks.find((q) => q.assetId === 'BUFFER-001')?.qty, 1);
  assert(saved.jobs.every((j) => j.status === 'done' || j.status === 'canceled'));
  const install = await c.ok('rail_edit_preview', { operation: 'install_buffer', x: 125, z: 5 });
  assert.equal(install.availableStops, 1);
  assert.equal(install.constraint, '');
  await c.ok('plan_buffer', { x: 125, z: 5 });
  await c.ok('save');
  const installed = Sim.load(await fs.readFile(path.join(host.dir, 'yard.json'), 'utf8'));
  assert.equal(
    installed.buffers?.[0].id,
    'BUFFER-001',
    'Creative installation should reuse the recovered owned stop',
  );
});

test('native railway program dispatch preserves manual steel recovery, qualifications, controls, tanker contents and shed bays', async (t) => {
  const host = await launch(); t.after(() => host.close()); const c=host.client;
  await c.ok('new_game',{mode:'empty'}); await c.ok('pause',{paused:true});await c.ok('creative',{enabled:true});
  await c.ok('zone',{rect:{x:160,z:80,w:18,d:18},name:'Recovered original steel'});
  assert.equal((await c.request('rail_exit_plan')).ok,false);
  await c.ok('rail_exit_prepare');
  let s=JSON.parse((await c.ok('export')).json);
  const possession=s.railPossessions[0]; assert.equal(possession.assetIds.length,4);
  assert.equal((await c.request('rail_exit_plan')).ok,false,'Preparation must not automatically remove straight steel');
  for(const id of possession.assetIds)await c.ok('remove_rail',{id,scope:'panel'});
  await c.ok('rail_exit_plan'); await c.ok('rail_possession_release',{id:possession.id});
  s=Sim.load((await c.ok('export')).json);
  assert.equal(s.railPossessions![0].released,true);assert.equal(s.stacks.filter((q:any)=>q.item==='rail').reduce((n:number,q:any)=>n+q.qty,0),4);
  const quote=await c.ok('tanker_preview',{product:'bulkDiesel',litersPerCar:20000,carCount:2});
  assert.equal(quote.totalMass,73600);assert.equal(quote.price,54560);assert.equal(quote.trainLength,43.7);
  const tanker=await c.ok('tanker_order',{product:'bulkDiesel',litersPerCar:20000,carCount:2});
  const inspected=await c.ok('inspect',{id:tanker.id});assert.equal(inspected.entity.railFreight.cars.length,2);
  const liquid=await c.ok('sql',{sql:'SELECT kind, liquid, liters, capacity_liters FROM freight_cars;'});
  assert.deepEqual(liquid[0].values.map((r:any)=>r.slice(0,4)),[['tanker','bulkDiesel',20000,30000],['tanker','bulkDiesel',20000,30000]]);
  await c.ok('purchase_batch',{lines:[{item:'railDriver',qty:3}],mode:'road'});
  s=JSON.parse((await c.ok('export')).json);const bus=s.orders.find((q:any)=>q.item==='railDriver');assert.equal(bus.qty,3);assert.equal(bus.mode,'road');
  const fixture=Sim.createState();fixture.paused=true;const machine=seedHandlingResources(fixture,'forklift');
  const driver=fixture.workers[0];driver.x=100;driver.z=7;
  const {orderShunter}=await import('../src/rail-operations');assert.equal(orderShunter(fixture).error,undefined);
  const engine=fixture.shunters![0];Object.assign(engine,{phase:'parked',x:100,z:5,yaw:0,anchor:{trackId:'BOOTSTRAP-SIDING',route:'straight',offset:75}});fixture.equipment=[];
  await c.ok('import',{json:Sim.save(fixture)});
  assert.equal((await c.request('shunter_driver',{shunterId:engine.id,workerId:driver.id})).ok,false);
  await c.ok('rail_qualification',{workerId:driver.id});await c.ok('shunter_driver',{shunterId:engine.id,workerId:driver.id});
  await c.ok('shunter_drive',{shunterId:engine.id,distance:5});
  const reservations=await c.ok('tables',{table:'railReservations'});assert.equal(reservations[0].owner,engine.id);
  s=JSON.parse((await c.ok('export')).json);assert.equal(s.shunters[0].manualControl,true);assert.equal(s.shunters[0].phase,'parking');
  assert.equal((await c.request('shunter_release',{shunterId:engine.id})).ok,false,'Release waits for a safe stop');
  // Isolate the already-stopped checkpoint to test mode release and physical fuel dispatch.
  s.shunters[0].phase='parked';delete s.shunters[0].movement;s.shunters[0].fuel=300;
  s.stacks.push({id:'STK-99991',item:'diesel',qty:1,reserved:0,liters:200,x:100,z:9,w:1,d:1,source:'opening'});s.next=100000;
  await c.ok('import',{json:JSON.stringify(s)});await c.ok('shunter_release',{shunterId:engine.id});await c.ok('shunter_refuel',{shunterId:engine.id});
  s=JSON.parse((await c.ok('export')).json);assert.equal(s.shunters[0].fuel,300);assert.equal(s.shunters[0].refueling.workerId,driver.id);assert.equal(s.stacks[0].liters,200);
  assert.equal((await c.request('shunter_driver',{shunterId:engine.id,workerId:''})).ok,false,'A physical fuel handler cannot be orphaned by driver reassignment');
  // The engine shed command uses the actual native plan path and keeps original track assets.
  const shed=Sim.createState();shed.paused=true;shed.creative=true;
  for(let section=0;section<6;section++){const piece={layout:'curve' as const,origin:{x:125,z:5},heading:0 as const,hand:1 as const,section};const g=trackGeometry(piece);shed.rails.push({id:Sim.id(shed,'rail'),...g.rect,rotation:0,length:g.length,item:'railCurve',track:piece});}
  for(let z=25;z<60;z+=5){const piece=trackSections('straight',{x:145,z},1)[0];const g=trackGeometry(piece);shed.rails.push({id:Sim.id(shed,'rail'),...g.rect,rotation:1,length:g.length,item:'rail',track:piece});}
  await c.ok('import',{json:Sim.save(shed)});await c.ok('plan',{kind:'engineShed',x:142,z:33,rotation:0});
  s=JSON.parse((await c.ok('export')).json);assert.equal(s.buildings.find((b:any)=>b.kind==='engineShed').kind,'engineShed');assert.equal(s.rails.length,shed.rails.length);assert.equal(s.railLocations[0].id,s.buildings.find((b:any)=>b.kind==='engineShed').parkingLocationId);
  await c.ok('save');assert.equal(Sim.load(await fs.readFile(path.join(host.dir,'yard.json'),'utf8')).buildings.find(b=>b.kind==='engineShed')!.kind,'engineShed');
});

test('native fluid commands use actual assets, worker operations, conserved quantities, reports and atomic saves',async(t)=>{
  const {createProcessYard}=await import('./support/process');
  const f=createProcessYard({connect:true});f.s.paused=true;
  const host=await launch();t.after(()=>host.close());const c=host.client;
  await c.ok('import',{json:Sim.save(f.s)});
  await c.ok('process_configure',{id:f.pump.id,tankId:f.tank.id,rate:2.5});
  await c.ok('process_run',{id:f.pump.id,running:true});
  await c.ok('speed',{value:10});await sleep(1300);await c.ok('pause',{paused:true});
  let s=Sim.load((await c.ok('export')).json);assert.ok(s.process!.pumps[0].transferred>15);assert.ok(s.process!.pumps[0].transferred<50);
  const transferred=s.process!.pumps[0].transferred;
  assert.ok(Math.abs(s.orders[0].railFreight!.cars[0].tank!.liters+transferred-1000)<1e-6);
  const rows=await c.ok('tables',{table:'process'});assert.equal(rows.pumps[0].tankId,f.tank.id);assert.ok(Math.abs(rows.balance[0].difference)<1e-6);
  for(const sql of ['SELECT * FROM process_tanks;','SELECT * FROM process_lines;','SELECT * FROM process_pumps;','SELECT * FROM process_gauges;','SELECT * FROM process_operations;','SELECT * FROM fluid_movements;'])assert.ok((await c.ok('sql',{sql}))[0].columns.length>0);
  assert.equal((await c.request('remove_building',{id:f.pump.id})).ok,false,'A connected pump cannot be recovered');
  await c.ok('process_run',{id:f.pump.id,running:false});await c.ok('save');
  const saved=Sim.load(await fs.readFile(path.join(host.dir,'yard.json'),'utf8'));assert.equal(saved.process!.pumps[0].transferred,transferred);
  await c.ok('process_disconnect',{id:f.pump.id,workerId:f.worker.id});
  s=Sim.load((await c.ok('export')).json);const op=s.process!.operations.find(o=>!o.finished)!;
  assert.equal((await c.ok('inspect',{id:op.id})).type,'processOperation');
  assert.equal((await c.request('worker_duty',{id:f.worker.id,duty:'rest'})).ok,false);
  assert.equal((await c.request('control',{id:f.worker.id})).ok,false);
  assert.equal(s.process!.pumps[0].hose,'disconnecting');assert.equal(s.process!.pumps[0].transferred,transferred);
});

test('native paid collection commands quote, revalidate, preserve history and expose exact accounting',async(t)=>{
 const fixture=Sim.createState();fixture.paused=true;seedHandlingResources(fixture);const stack={id:Sim.id(fixture,'stack'),item:'slab' as const,x:30,z:32,w:1,d:1,qty:12,reserved:0,source:'opening'};fixture.stacks.push(stack);
 const host=await launch();t.after(()=>host.close());const c=host.client;await c.ok('import',{json:Sim.save(fixture)});
 const quote=await c.ok('collection_quote',{lines:[{stackId:stack.id,qty:12}]});assert.equal(quote.valid,true);assert.equal(quote.massKg,3360);
 const request=await c.ok('collection_request',{lines:[{stackId:stack.id,qty:12}]});assert.equal(request.ids.length,1);assert.equal((await c.request('collection_request',{lines:[{stackId:stack.id,qty:12}]})).ok,false,'Stale quote cannot silently close as success');
 assert.equal((await c.ok('tables',{table:'collections'})).length,1);assert.equal((await c.ok('inspect',{id:request.ids[0]})).type,'collections');await c.ok('collection_pause',{id:request.ids[0]});await c.ok('collection_resume',{id:request.ids[0]});await c.ok('collection_cancel',{id:request.ids[0]});
 const canceled=Sim.load((await c.ok('export')).json);assert.equal(canceled.stacks[0].reserved,0);assert.equal(canceled.collections![0].fees.charged,0);
 fixture.paused=false;Sim.requestCollection(fixture,{lines:[{stackId:stack.id,qty:12}]});for(let i=0;i<16000&&fixture.collections![0].status!=='done';i++)Sim.tick(fixture,.1);assert.equal(fixture.collections![0].status,'done');fixture.paused=true;await c.ok('import',{json:Sim.save(fixture)});
 const historical=await c.ok('inspect',{id:stack.id});assert.equal(historical.type,'collectedMaterial');assert.equal(historical.entity.collected,12);assert.equal(historical.entity.qty,0);
 const inventory=await c.ok('sql',{sql:"SELECT item, collected, incoming, delivered FROM inventory WHERE item='slab';"});assert.deepEqual(inventory[0].values,[['slab',12,0,0]]);const accounting=await c.ok('sql',{sql:'SELECT charged,total FROM collections;'});assert.equal(accounting[0].values[0][0],accounting[0].values[0][1]);await c.ok('save');Sim.load(await fs.readFile(path.join(host.dir,'yard.json'),'utf8'));
});

test('native electrical commands plan explicit circuits, expose links and meters, and never energize by a global flag', async (t) => {
  const host=await launch();t.after(()=>host.close());const c=host.client;
  await c.ok('new_game',{mode:'empty'});await c.ok('pause',{paused:true});
  const opening=JSON.parse((await c.ok('export')).json);
  assert.equal(opening.buildings.filter((b:any)=>b.kind==='power').length,1);
  assert.equal(opening.buildings[0].id,'BLD-0000');
  assert.equal((await c.request('purchase',{item:'power',qty:1,mode:'road'})).ok,false);
  assert.deepEqual(JSON.parse((await c.ok('export')).json),opening,'Rejected station purchase must not allocate IDs, orders or costs');
  const state=Sim.createState();state.paused=true;state.utilities.power=true;
  state.buildings=state.buildings.filter(b=>b.id!=='BLD-0000');
  state.buildings.push(
    {id:Sim.id(state,'building'),kind:'power',x:30,z:30,w:1,d:1,rotation:0,connected:true,name:'Opening station',source:'opening'},
    {id:Sim.id(state,'building'),kind:'lamp',x:36,z:30,w:1,d:1,rotation:0,connected:false,name:'Light',source:'opening'});
  await c.ok('import',{json:Sim.save(state)});
  const args={sourceId:state.buildings[0].id,targetId:state.buildings[1].id,cells:Array.from({length:5},(_,i)=>({x:31+i,z:30}))};
  await c.ok('electrical_rename',{id:args.targetId,name:'North tanker bay light'});
  const named=(await c.ok('tables',{table:'electricalConsumers'}))[0];
  assert.equal(named.name,'North tanker bay light');assert.equal(named.id,args.targetId);
  const namedState=JSON.parse((await c.ok('export')).json);
  const invalidName=await c.request('electrical_rename',{id:args.targetId,name:' '});assert.equal(invalidName.ok,false);
  assert.deepEqual(JSON.parse((await c.ok('export')).json),namedState,'Rejected name is fully nonmutating');
  const namedSql=await c.ok('sql',{sql:'SELECT id,name,kind,rootSourceId,loadKw FROM electrical_consumers;'});
  assert.ok(JSON.stringify(namedSql).includes('North tanker bay light'));
  await c.ok('sql',{sql:'SELECT name,kind,availableKw FROM electrical_junctions;'});

  const before=JSON.parse((await c.ok('export')).json);
  const preview=await c.ok('electrical_preview',args);assert.equal(preview.valid,true);assert.equal(preview.meters,5);
  assert.deepEqual(JSON.parse((await c.ok('export')).json),before,'Preview must not reserve stock or alter the yard');
  const invalid=await c.request('electrical_plan',{...args,cells:[{x:31,z:30},{x:35,z:30}]});assert.equal(invalid.ok,false);
  const planned=await c.ok('electrical_plan',args);
  assert.equal((await c.ok('inspect',{id:planned.runId})).type,'electricalRuns');
  const load=(await c.ok('tables',{table:'electricalConsumers'}))[0];assert.equal(load.powered,false);
  assert.equal((await c.ok('tables',{table:'electricalSources'}))[0].capacityKw,16);
  await c.ok('buy_missing');
  assert.equal(JSON.parse((await c.ok('export')).json).orders[0].item,'cableReel');
  await c.ok('electrical_cancel',{id:planned.runId});await c.ok('speed',{value:10});await sleep(160);await c.ok('pause',{paused:true});
  assert.equal(JSON.parse((await c.ok('export')).json).electrical.runs[0].status,'canceled');
  await c.ok('electrical_resume',{id:planned.runId});
  assert.equal(JSON.parse((await c.ok('export')).json).electrical.runs[0].status,'planned');
  await c.ok('import',{json:Sim.save(state)});await c.ok('creative',{enabled:true});
  const creative=await c.ok('electrical_plan',args);
  assert.equal((await c.ok('tables',{table:'electricalConsumers'}))[0].powered,true);
  assert.equal((await c.ok('inspect',{id:creative.runId})).entity.installedMeters,5);
  const sql=await c.ok('sql',{sql:'SELECT id, connected, powered, ratedKw FROM electrical_consumers;'});
  assert.ok(JSON.stringify(sql).includes(state.buildings[1].id));
  await c.ok('save');
  const saved=Sim.load(await fs.readFile(path.join(host.dir,'yard.json'),'utf8'));assert.equal(saved.electrical!.runs[0].status,'commissioned');
});
