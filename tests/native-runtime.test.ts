import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import * as Sim from '../src/sim';
import { MATERIALS } from '../src/catalog';
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
  assert.equal(saveRailLocation(s, { name: 'Reception A', kind: 'unloading', trackId: 'BOOTSTRAP-SIDING', route: 'straight', offset: 50, length: 70 }), undefined);
  const [oid] = Sim.purchaseBatch(s, [{ item: 'slab', qty: 200 }], 'rail', { railLocationId: s.railLocations![0].id, storageZoneId: s.zones[0].id });
  for (let n = 0; n < 5000 && s.orders[0].status !== 'unloading'; n++) Sim.tick(s, 0.1);
  assert.equal(s.orders[0].status, 'unloading');
  assert.equal(s.orders[0].arrived, 0, 'Received train waits for the player to begin unloading');
  s.paused = true;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plant01-freight-native-'));
  await fs.writeFile(path.join(dir, 'yard.json'), Sim.save(s));
  const host = await launch(dir);
  t.after(() => host.close());
  const c = host.client;
  const preview = await c.ok('purchase_preview', { lines: [{ item: 'slab', qty: 200 }], mode: 'rail' });
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
  assert.equal((await c.request('configure_rail_freight', { orderId: oid, railLocationId: '' })).ok, false, 'Approaching/received trains cannot be rerouted');
  const rows = await c.ok('sql', { sql: 'SELECT SUM(qty) AS ordered, SUM(arrived) AS received FROM freight_car_lines;' });
  assert.deepEqual(rows[0].values, [[200, 0]]);
  const premature = await c.request('unload', { orderId: oid, workerId: 'none' });
  assert.equal(premature.ok, false);
  assert.match(premature.error, /Start unloading/);
  await c.ok('begin_rail_unloading', { orderId: oid });
  await c.ok('save');
  const saved = Sim.load(await fs.readFile(path.join(dir, 'yard.json'), 'utf8'));
  assert.equal(saved.orders[0].railFreight!.unloadRequested, true);
  assert.deepEqual(saved.orders[0].railFreight!.cars.map(car => car.id), cars.map((car:any)=>car.id));
});
