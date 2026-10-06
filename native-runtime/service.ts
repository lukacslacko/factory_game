/** Native simulation host: no window, browser, DOM, or renderer. Single authenticated
 * loopback client, fixed simulation clock, bounded transport, atomic local persistence. */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import * as Sim from '../src/sim';
import { bufferAssets } from '../src/buffers';
import { detachRailFreight, orderShunter, setShunterDriver, shuntRailCars, parkShunter, refuelShunter, requestEmptyReturn } from '../src/rail-operations';
import {
  configureRailFreight,
  requestRailUnloading,
  railFreightCarPose,
} from '../src/rail-freight';
import {
  MATERIALS,
  BUILDINGS,
  EQUIPMENT,
  ROLES,
  SERVICES,
  bounds,
  TRACK_GAUGE,
} from '../src/catalog';
import { EQUIPMENT_ROLES, EQUIPMENT_ACTIVITIES } from '../src/equipment-roles';
import { setJobEquipment, setRailCrew, jobRows, workLeaves } from '../src/jobs';
import { setEquipmentAssistant } from '../src/work-crews';
import {
  workerAvailable,
  setWorkerSchedule,
  setEquipmentParking,
  clearEquipmentParking,
} from '../src/workforce';
import { pauseDeliveryHandling, resumeDeliveryHandling } from '../src/delivery-control';
import {
  nearestRailLocationAnchor,
  saveRailLocation,
  removeRailLocation,
} from '../src/rail-locations';
import { snapTrackStart, railLayoutPieces, trackGeometry, type TrackPiece } from '../src/track';
import {
  packPurchase,
  itemMass,
  orderDeckLength,
  FREIGHT_CAPACITY,
  FREIGHT_DECK_LENGTH,
  CREW_BUS_SEATS,
} from '../src/procurement';
import { query, SQL_EXAMPLES, csv } from '../src/reports';
import { DiagnosticRecorder } from '../src/diagnostics';
import { renderState } from './render';
import type { State, Rect, BuildKind, EquipmentWorkRole, EquipmentActivity } from '../src/types';

const flags = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const at = a.indexOf('=');
    return at < 0 ? [a, ''] : [a.slice(0, at), a.slice(at + 1)];
  }),
);
const token = flags['--token'];
const portFile = flags['--port-file'];
const dataDir = flags['--data-dir'];
if (
  !token ||
  token.length < 16 ||
  !portFile ||
  !dataDir ||
  !path.isAbsolute(portFile) ||
  !path.isAbsolute(dataDir)
) {
  console.error(
    'Required: --token=<16+ characters> --port-file=<absolute path> --data-dir=<absolute directory>',
  );
  process.exit(2);
}
fs.mkdirSync(dataDir, { recursive: true });
const savePath = path.join(dataDir, 'yard.json'),
  backupPath = path.join(dataDir, 'yard.backup.json');
let state = Sim.createState();
state.paused = true;
let started = false,
  lastSavedAt: number | null = null,
  loadError: string | null = null;
if (fs.existsSync(savePath)) {
  try {
    state = Sim.load(fs.readFileSync(savePath, 'utf8'));
    state.paused = true;
  } catch (error) {
    loadError = message(error);
  }
}
const recorder = new DiagnosticRecorder(12000, 4_000_000);
let seq = 0,
  ticks = 0,
  snapshotsSent = 0,
  snapshotsSkipped = 0,
  closing = false,
  authenticated = false;
let client: net.Socket | undefined;
const MAX_INPUT = 64_000_000,
  HIGH_WATER = 1_000_000,
  MAX_PENDING_REPLY = 8_000_000;
const catalog = {
  materials: MATERIALS,
  buildings: BUILDINGS,
  equipment: EQUIPMENT,
  roles: ROLES,
  services: SERVICES,
  equipmentRoles: EQUIPMENT_ROLES,
  activities: EQUIPMENT_ACTIVITIES,
  sqlExamples: SQL_EXAMPLES,
  bounds,
  gauge: TRACK_GAUGE,
  freightCapacity: FREIGHT_CAPACITY,
  freightDeckLength: FREIGHT_DECK_LENGTH,
  busSeats: CREW_BUS_SEATS,
};
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function check(error: string | undefined) {
  if (error) throw new Error(error);
}
function number(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100000)
    throw new Error(`${name} must be a finite number within the yard's coordinate limits.`);
  return value;
}
function point(a: any) {
  return { x: number(a.x, 'x'), z: number(a.z, 'z') };
}
function rect(value: any): Rect {
  if (!value || typeof value !== 'object') throw new Error('Choose a rectangular area.');
  const r = { ...point(value), w: number(value.w, 'width'), d: number(value.d, 'depth') };
  if (!Object.values(r).every(Number.isInteger) || r.w < 1 || r.d < 1 || r.w * r.d > 10000)
    throw new Error('Choose an integer grid rectangle of 1–10,000 cells.');
  return r;
}
function entityId(a: any) {
  const id = a.id ?? a.workId ?? a.equipmentId ?? a.workerId ?? a.orderId ?? a.stackId;
  if (typeof id !== 'string' || id.length > 128) throw new Error('An entity ID is required.');
  return id;
}
function worker(id: string) {
  const w = state.workers.find((w) => w.id === id);
  if (!w) throw new Error('Worker not found.');
  return w;
}
function selectedPath(p: unknown, fallback?: string) {
  if (p === undefined && fallback) return fallback;
  if (typeof p !== 'string' || !path.isAbsolute(p))
    throw new Error('Choose an absolute local file path.');
  return p;
}
function atomicWrite(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, contents);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function persist(file = savePath, backup = true) {
  const json = Sim.save(state);
  if (file === savePath && backup && fs.existsSync(savePath))
    atomicWrite(backupPath, fs.readFileSync(savePath, 'utf8'));
  atomicWrite(file, json);
  if (file === savePath) {
    lastSavedAt = Date.now();
    loadError = null;
  }
  return { path: file, bytes: Buffer.byteLength(json), savedAt: Date.now() };
}
function replaceState(json: string) {
  const next = Sim.load(json);
  next.paused = true;
  state = next;
  started = true;
  recorder.record(state, 'native-load', { elapsed: state.elapsed });
  return persist();
}
function storage() {
  return {
    dataDir,
    savePath,
    backupPath,
    lastSavedAt,
    loadError,
    hasSave: fs.existsSync(savePath),
    hasBackup: fs.existsSync(backupPath),
    started,
  };
}
function reportingRows() {
  return {
    work: jobRows(state),
    inventory: Object.keys(MATERIALS).map((item) => ({ item, ...Sim.totals(state, item as any) })),
    workers: state.workers,
    equipment: state.equipment,
    shunters: state.shunters||[],
    railReturns: state.railReturns||[],
    materials: state.stacks,
    deliveries: state.orders,
    activity: state.events.slice(-1000).reverse(),
    costs: state.costs,
    inbox: state.notices,
    railway: state.rails,
    buffers: bufferAssets(state),
    freightCars: state.orders.flatMap((o) =>
      (o.railFreight?.cars || []).map((car, index) => ({
        ...car,
        orderId: o.id,
        status: o.status,
        ...railFreightCarPose(o, index),
        receptionLocationId: o.railFreight?.receptionLocationId,
        storageZoneId: o.railFreight?.storageZoneId,
      })),
    ),
    locomotives: state.orders
      .filter((o) => o.railFreight)
      .map((o) => ({
        id: o.railFreight!.locomotiveId,
        orderId: o.id,
        ownership: 'Supplier',
        status: o.railFreight!.locomotivePhase || o.status,
        ...(o.railFreight!.locomotivePose||o.vehicle),
      })),
    locations: state.railLocations || [],
    movements: state.movements.slice(-1000).reverse(),
  };
}
function snapshot() {
  if (!client || !authenticated || client.destroyed || closing) return;
  if (client.writableLength > HIGH_WATER || client.writableNeedDrain) {
    snapshotsSkipped++;
    return;
  }
  const render = renderState(state),
    tables = reportingRows();
  const limited = {
    ...state,
    events: state.events.slice(-1000),
    movements: state.movements.slice(-1000),
    costs: state.costs.slice(-2000),
  };
  send({
    type: 'snapshot',
    seq: ++seq,
    state: limited,
    catalog,
    render,
    storage: storage(),
    workRows: tables.work,
    inventory: tables.inventory,
    summaries: {
      totalCosts: state.costs.reduce((n, c) => n + c.amount, 0),
      costCount: state.costs.length,
      eventCount: state.events.length,
      movementCount: state.movements.length,
    },
  });
  snapshotsSent++;
}
function send(payload: unknown) {
  if (!client || client.destroyed) return;
  const encoded = JSON.stringify(payload) + '\n';
  if (client.writableLength + Buffer.byteLength(encoded) > MAX_PENDING_REPLY) {
    client.destroy(new Error('Native client is not reading; reconnect to resume.'));
    return;
  }
  client.write(encoded);
}
function railPreview(a: any) {
  if (!['straight', 'curve', 'turnout'].includes(a.layout))
    throw new Error('Choose straight, curve, or turnout.');
  const layout = a.layout as TrackPiece['layout'];
  let origin = point(a),
    heading = a.heading ?? 0;
  if (![0, 1, 2, 3].includes(heading)) throw new Error('Rail heading must be 0, 1, 2, or 3.');
  const flow: TrackPiece['flow'] = a.flow === 'converging' ? 'converging' : undefined;
  if (a.flow !== undefined && !['diverging', 'converging'].includes(a.flow))
    throw new Error('Choose diverging or converging turnout flow.');
  const hand = a.hand ?? 1;
  if (![1, -1].includes(hand)) throw new Error('Rail hand must be 1 or -1.');
  if (a.snap !== false) {
    const snap = snapTrackStart(state, origin, undefined, true, 8, false);
    if (snap) {
      origin = snap.origin;
      heading = snap.heading;
    }
  }
  origin = { x: Math.round(origin.x), z: Math.round(origin.z) };
  const pieces = railLayoutPieces(layout, origin, heading, hand, flow);
  return {
    origin,
    heading,
    hand,
    flow,
    layout,
    error: Sim.validRailLayout(state, layout, origin, heading, hand, flow),
    pieces,
    geometries: pieces.map(trackGeometry),
  };
}
const readonly = new Set([
  'hello',
  'ping',
  'rail_preview',
  'rail_location_anchor',
  'inspect',
  'tables',
  'sql',
  'purchase_preview',
  'export',
  'export_costs',
  'diagnostics',
]);
async function dispatch(action: string, a: any) {
  switch (action) {
    case 'hello':
      return {
        version: 1,
        capabilities: [
          'background-clock',
          'atomic-save',
          'browser-import',
          'sql',
          'render-poses',
          'bounded-diagnostics',
        ],
      };
    case 'ping':
      return {
        time: state.time,
        elapsed: state.elapsed,
        speed: state.speed,
        paused: state.paused,
        ticks,
        snapshotsSent,
        snapshotsSkipped,
        pendingBytes: client?.writableLength ?? 0,
        started,
      };
    case 'new_game': {
      if (!['empty', 'starter', 'example'].includes(a.mode))
        throw new Error('Choose empty, starter, or example.');
      if (started) persist();
      state = a.mode === 'example' ? Sim.demoState() : Sim.createState();
      if (a.mode === 'starter') Sim.starterOrder(state);
      started = true;
      persist();
      return { mode: a.mode };
    }
    case 'continue':
      if (loadError)
        throw new Error(
          `Existing save could not load: ${loadError}. Import a valid save or start a new yard.`,
        );
      started = true;
      state.paused = false;
      return {};
    case 'save':
      started = true;
      return persist(selectedPath(a.path, savePath));
    case 'load':
      return replaceState(fs.readFileSync(selectedPath(a.path, savePath), 'utf8'));
    case 'import':
      return replaceState(
        typeof a.json === 'string' ? a.json : fs.readFileSync(selectedPath(a.path), 'utf8'),
      );
    case 'restore_backup':
      return replaceState(fs.readFileSync(backupPath, 'utf8'));
    case 'export': {
      const json = Sim.save(state);
      if (a.path !== undefined) {
        const file = selectedPath(a.path);
        atomicWrite(file, json);
        return { path: file, bytes: Buffer.byteLength(json) };
      }
      return { json };
    }
    case 'export_costs': {
      const file = selectedPath(a.path),
        columns = ['id', 'time', 'category', 'entity', 'description', 'amount'];
      const contents = csv(
        columns,
        state.costs.map((c) => columns.map((k) => (c as any)[k])),
      );
      atomicWrite(file, contents);
      return { path: file, rows: state.costs.length };
    }
    case 'diagnostics': {
      const archive = recorder.archive(state);
      if (a.path !== undefined) {
        const file = selectedPath(a.path),
          json = JSON.stringify(archive);
        atomicWrite(file, json);
        return { path: file, bytes: Buffer.byteLength(json), entries: archive.entries.length };
      }
      return archive;
    }
    case 'shutdown':
      return { shuttingDown: true };
    case 'purchase_batch':
      return {
        orders: Sim.purchaseBatch(state, a.lines, a.mode, {
          railLocationId: a.railLocationId,
          storageZoneId: a.storageZoneId,
        }),
      };
    case 'configure_rail_freight': {
      const error = configureRailFreight(state, a.orderId, {
        railLocationId: a.railLocationId,
        storageZoneId: a.storageZoneId,
      });
      if (error) throw new Error(error);
      return {};
    }
    case 'pause_rail_unloading': {
      const order=state.orders.find(o=>o.id===a.orderId);
      if(!order?.railFreight) throw new Error('Choose a rail freight delivery.');
      order.railFreight.unloadRequested=false;order.note=order.unload?'Finishing current lift before pausing unloading':'Unloading paused; cars available for shunting';state.revision++;return {};
    }
    case 'begin_rail_unloading': {
      const error = requestRailUnloading(state, a.orderId, a.carIds);
      if (error) throw new Error(error);
      return {};
    }
    case 'rail_access_plan': {const plan=Sim.planSidingAccess(state,a.x??80);check(plan.error || undefined);return {workId:plan.group?.id,jobs:plan.jobs.map(j=>j.id)};}
    case 'rail_exit_plan': {
      const plan=Sim.planMainlineExit(state);check(plan.error || undefined);return {workId:plan.group?.id,jobs:plan.jobs.map(j=>j.id)};
    }
    case 'rail_detach':check(detachRailFreight(state,a.orderId));return {};
    case 'shunter_order': {const result=orderShunter(state,a);check(result.error);return result;}
    case 'shunter_driver':check(setShunterDriver(state,a.shunterId,a.workerId||undefined));return {};
    case 'rail_shunt':check(shuntRailCars(state,a));return {};
    case 'shunter_park':check(parkShunter(state,a.shunterId,a.railLocationId));return {};
    case 'shunter_refuel':check(refuelShunter(state,a.shunterId));return {};
    case 'rail_return': {const result=requestEmptyReturn(state,a);check(result.error);return result;}
    case 'purchase':
      return { orders: Sim.purchase(state, a.item, a.qty, a.mode) };
    case 'purchase_preview': {
      const loads = packPurchase(a.lines, a.mode);
      const railLoads = loads.filter((l) => l.mode === 'rail');
      return {
        loads: loads.map((l) => ({
          ...l,
          mass: l.manifest.reduce((n, line) => n + (itemMass(line.item) || 0) * line.qty, 0),
          deckLength: orderDeckLength(l.manifest),
        })),
        mass: a.lines.reduce((n: number, l: any) => n + (itemMass(l.item) || 0) * l.qty, 0),
        capacity: FREIGHT_CAPACITY[a.mode as 'road' | 'rail'],
        railCars: railLoads.length,
        trainLength: railLoads.length ? 26.1 + Math.max(0, railLoads.length - 1) * 17.6 : 0,
        transportCost:
          (railLoads.length ? 240 : 0) + loads.filter((l) => l.mode === 'road').length * 90,
      };
    }
    case 'starter_order':
      Sim.starterOrder(state);
      return {};
    case 'buy_missing':
      return { units: Sim.buyMissing(state) };
    case 'creative':
      if (typeof a.enabled !== 'boolean')
        throw new Error('Choose whether creative mode is on or off.');
      Sim.setCreativeMode(state, a.enabled);
      return { creative: !!state.creative };
    case 'pause':
      state.paused = typeof a.paused === 'boolean' ? a.paused : !state.paused;
      return { paused: state.paused };
    case 'speed':
      if (![1, 3, 10].includes(a.value)) throw new Error('Choose 1×, 3×, or 10×.');
      state.speed = a.value;
      state.paused = false;
      return { speed: state.speed };
    case 'guide':
      state.guide = !!a.visible;
      return {};
    case 'plan': {
      if (!Object.hasOwn(BUILDINGS, a.kind) && !['power', 'water'].includes(a.kind))
        throw new Error('Unknown building.');
      const result = Sim.plan(
        state,
        a.kind as BuildKind,
        Math.round(number(a.x, 'x')),
        Math.round(number(a.z, 'z')),
        a.rotation ?? 0,
        a.foundations !== false,
      );
      check(result.error);
      return result;
    }
    case 'pave':
      return { count: Sim.pave(state, rect(a.rect)) };
    case 'zone':
      check(Sim.addZone(state, rect(a.rect), a.name));
      return { zone: state.zones.at(-1) };
    case 'remove_zone':
      check(Sim.removeZone(state, entityId(a)));
      return {};
    case 'rail_preview':
      return railPreview(a);
    case 'plan_rail': {
      const p = railPreview(a);
      check(p.error);
      const result = Sim.planRailLayout(state, p.layout, p.origin, p.heading, p.hand, p.flow);
      check(result.error);
      return result;
    }
    case 'plan_buffer': {
      const result = Sim.planBufferStop(state, point(a));
      check(result.error);
      return result;
    }
    case 'remove_buffer':
      check(Sim.removeBufferStop(state, entityId(a)));
      return {};
    case 'resume_track':
      check(Sim.resumeTrackWork(state, entityId(a)));
      return {};
    case 'turnout':
      if (!['straight', 'branch'].includes(a.route)) throw new Error('Choose straight or branch.');
      check(Sim.setTurnoutRoute(state, entityId(a), a.route));
      return {};
    case 'move_worker':
      check(Sim.moveWorker(state, entityId(a), point(a)));
      return {};
    case 'control': {
      const w = worker(entityId(a));
      if (w.job || w.deliveryOrder || !workerAvailable(state, w))
        throw new Error('Release the current assignment before taking control.');
      w.duty = 'manual';
      return {};
    }
    case 'release': {
      const w = worker(entityId(a));
      check(Sim.releaseWorker(state, w.id));
      return {};
    }
    case 'worker_duty': {
      const w = worker(entityId(a));
      if (w.job || w.deliveryOrder || w.transportOrder || w.transition)
        throw new Error('Worker has active work or transportation.');
      if (!['auto', 'rest'].includes(a.duty)) throw new Error('Choose auto or rest.');
      if (w.vehicle) Sim.exitVehicle(state, w.id);
      w.duty = a.duty;
      return {};
    }
    case 'enter_vehicle':
      check(Sim.enterVehicle(state, a.workerId, a.equipmentId));
      return {};
    case 'exit_vehicle':
      Sim.exitVehicle(state, entityId(a));
      return {};
    case 'unload':
      check(Sim.unloadDelivery(state, a.orderId, a.workerId));
      return {};
    case 'delivery_pause':
      check(pauseDeliveryHandling(state, entityId(a)));
      return {};
    case 'delivery_resume':
      check(resumeDeliveryHandling(state, entityId(a)));
      return {};
    case 'equipment_role':
      check(Sim.setEquipmentRole(state, entityId(a), a.role as EquipmentWorkRole));
      return {};
    case 'equipment_activities':
      check(Sim.setEquipmentActivities(state, entityId(a), a.activities as EquipmentActivity[]));
      return {};
    case 'assistant':
      check(setEquipmentAssistant(state, entityId(a), a.workerId || undefined));
      return {};
    case 'worker_schedule':
      check(setWorkerSchedule(state, entityId(a), a.startHour, a.endHour));
      return {};
    case 'parking':
      check(
        setEquipmentParking(
          state,
          entityId(a),
          number(a.x, 'x'),
          number(a.z, 'z'),
          a.rotation ?? 0,
        ),
      );
      return {};
    case 'clear_parking':
      check(clearEquipmentParking(state, entityId(a)));
      return {};
    case 'job_equipment':
      check(setJobEquipment(state, entityId(a), a.equipmentId || undefined));
      return {};
    case 'rail_crew':
      check(
        setRailCrew(
          state,
          entityId(a),
          a.stagingEquipmentId || undefined,
          a.installingEquipmentId || undefined,
        ),
      );
      return {};
    case 'assign_worker': {
      const w = worker(a.workerId),
        j = state.jobs.find((j) => j.id === entityId(a));
      if (!j || !['todo', 'doing'].includes(j.status)) throw new Error('Active job not found.');
      j.preferredWorker = w.id;
      state.jobs = [j, ...state.jobs.filter((p) => p !== j)];
      return {};
    }
    case 'priority': {
      const leaves = workLeaves(state, entityId(a)).filter((j) => j.status === 'todo');
      if (!leaves.length) throw new Error('No waiting work in this assignment.');
      const ids = new Set(leaves.map((j) => j.id));
      state.jobs = [...leaves, ...state.jobs.filter((j) => !ids.has(j.id))];
      return {};
    }
    case 'cancel_job':
      Sim.cancelJob(state, entityId(a));
      return {};
    case 'refuel':
      check(Sim.refuel(state, entityId(a)));
      return {};
    case 'remove_rail':
      if (a.scope !== undefined && !['panel', 'assembly'].includes(String(a.scope)))
        throw new Error('Choose panel or assembly recovery.');
      check(
        Sim.removeRailInfrastructure(
          state,
          entityId(a),
          (a.scope || 'panel') as 'panel' | 'assembly',
        ),
      );
      return {};
    case 'remove_building':
      check(Sim.removeBuilding(state, entityId(a)));
      return {};
    case 'recover':
      check(Sim.recoverAt(state, point(a)));
      return {};
    case 'move_stock': {
      const id = entityId(a),
        source = state.stacks.find((s) => s.id === id);
      if (!source) throw new Error('Stock not found.');
      const destination = a.rect ? rect(a.rect) : { ...point(a), w: source.w, d: source.d };
      const result = Sim.moveRailStock(state, id, destination);
      check(result.error);
      return result;
    }
    case 'rail_location_anchor':
      return nearestRailLocationAnchor(state, point(a)) ?? null;
    case 'save_rail_location':
      check(saveRailLocation(state, a.location));
      return { location: (state.railLocations || []).at(-1) };
    case 'remove_rail_location':
      check(removeRailLocation(state, entityId(a)));
      return {};
    case 'notice': {
      const n = state.notices.find((n) => n.id === entityId(a));
      if (!n) throw new Error('Notice not found.');
      if (a.state !== undefined) {
        if (!['todo', 'doing', 'done'].includes(a.state))
          throw new Error('Choose todo, doing, or done.');
        n.state = a.state;
      }
      if (typeof a.seen === 'boolean') n.seen = a.seen;
      return {};
    }
    case 'mark_all_seen':
      state.notices.forEach((n) => (n.seen = true));
      return {};
    case 'inspect': {
      const id = entityId(a),
        tables = reportingRows();
      for (const [type, rows] of Object.entries(tables)) {
        const entity = rows.find((r: any) => r.id === id);
        if (entity)
          return {
            type,
            entity,
            intent: renderState(state).equipmentIntents.find((e) => e.id === id),
          };
      }
      throw new Error('Entity not found.');
    }
    case 'tables': {
      const rows = reportingRows();
      if (a.table !== undefined) {
        if (!Object.hasOwn(rows, a.table)) throw new Error('Unknown reporting table.');
        return (rows as any)[a.table];
      }
      return rows;
    }
    case 'sql':
      if (typeof a.sql !== 'string' || a.sql.length > 100000)
        throw new Error('Provide a SELECT query of at most 100,000 characters.');
      return query(state, a.sql);
    default:
      throw new Error(`Unknown native command: ${action}`);
  }
}
let dispatchQueue = Promise.resolve(),
  pendingCommands = 0;
function receive(socket: net.Socket, request: any) {
  if (++pendingCommands > 64) {
    pendingCommands--;
    socket.destroy(new Error('Too many queued native commands.'));
    return;
  }
  dispatchQueue = dispatchQueue.then(async () => {
    if (closing || socket.destroyed) {
      pendingCommands--;
      return;
    }
    const id = request?.id;
    try {
      if (
        !request ||
        typeof request.action !== 'string' ||
        !['string', 'number'].includes(typeof id)
      )
        throw new Error('Each command needs an id and action.');
      if (client !== socket || !authenticated) {
        if (client && client !== socket && !client.destroyed)
          throw new Error('A native client is already connected.');
        const supplied =
            typeof request.token === 'string' ? Buffer.from(request.token) : Buffer.alloc(0),
          expected = Buffer.from(token);
        if (
          request.action !== 'hello' ||
          supplied.length !== expected.length ||
          !crypto.timingSafeEqual(supplied, expected)
        ) {
          socket.end(
            JSON.stringify({ type: 'reply', id, ok: false, error: 'Authentication failed.' }) +
              '\n',
          );
          pendingCommands--;
          return;
        }
        authenticated = true;
        client = socket;
      }
      const action = request.action,
        args = request.args ?? {};
      if (!args || typeof args !== 'object' || Array.isArray(args))
        throw new Error('Command args must be an object.');
      const result = await dispatch(action, args);
      if (
        !readonly.has(action) &&
        !['shutdown', 'save', 'load', 'import', 'restore_backup'].includes(action)
      ) {
        started = true;
        state.revision++;
        recorder.record(state, 'native-command', { action, args });
      }
      send({ type: 'reply', id, ok: true, result });
      if (action === 'shutdown') {
        shutdown();
        pendingCommands--;
        return;
      }
      if (action === 'hello' || !readonly.has(action)) snapshot();
    } catch (error) {
      if (client === socket) send({ type: 'reply', id, ok: false, error: message(error) });
      else
        socket.write(
          JSON.stringify({ type: 'reply', id, ok: false, error: message(error) }) + '\n',
        );
    }
    pendingCommands--;
  });
}
const sockets = new Set<net.Socket>();
const server = net.createServer((socket) => {
  if (client && !client.destroyed) {
    socket.end();
    return;
  }
  sockets.add(socket);
  socket.setNoDelay(true);
  let input = '',
    packetCount = 0;
  const timeout = setTimeout(() => {
    if (!authenticated || client !== socket) socket.destroy();
  }, 10000);
  timeout.unref();
  socket.on('data', (chunk) => {
    input += chunk.toString('utf8');
    if (Buffer.byteLength(input) > MAX_INPUT) {
      socket.destroy();
      return;
    }
    let newline;
    while ((newline = input.indexOf('\n')) >= 0) {
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      if (!line.trim()) continue;
      if (++packetCount > 64) {
        socket.destroy();
        return;
      }
      try {
        receive(socket, JSON.parse(line));
      } catch {
        socket.write(
          JSON.stringify({ type: 'reply', id: null, ok: false, error: 'Invalid JSON command.' }) +
            '\n',
        );
      }
    }
    setImmediate(() => (packetCount = 0));
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    clearTimeout(timeout);
    sockets.delete(socket);
    if (client === socket && authenticated) shutdown();
  });
});
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(tickTimer);
  clearInterval(snapshotTimer);
  clearInterval(autosaveTimer);
  clearTimeout(unconnectedTimer);
  try {
    if (started) persist();
  } catch (error) {
    console.error(`Native save failed: ${message(error)}`);
    process.exitCode = 1;
  }
  for (const socket of sockets) socket.end();
  server.close();
  try {
    fs.unlinkSync(portFile);
  } catch {}
  setTimeout(() => {
    for (const socket of sockets) socket.destroy();
    process.exit(process.exitCode || 0);
  }, 100).unref();
}
let previous = performance.now(),
  accumulator = 0;
const tickTimer = setInterval(() => {
  const now = performance.now();
  accumulator += Math.min((now - previous) / 1000, 1);
  previous = now;
  let observed = false;
  while (accumulator >= 0.05) {
    accumulator -= 0.05;
    if (started && !state.paused) {
      try {
        // Time multipliers increase the number of small physical steps, never the
        // movement/turn/collision step size. 10× stays equivalent to 1× physics.
        for (let n = 0; n < state.speed; n++) {
          Sim.tick(state, 0.05);
          ticks++;
        }
        observed = true;
      } catch (error) {
        state.paused = true;
        recorder.record(state, 'native-tick-error', { error: message(error) });
        console.error(message(error));
      }
    }
  }
  if (observed) recorder.observe(state);
}, 25);
const snapshotTimer = setInterval(snapshot, 200);
const autosaveTimer = setInterval(() => {
  if (started) {
    try {
      persist();
    } catch (error) {
      loadError = `Autosave failed: ${message(error)}`;
      console.error(loadError);
    }
  }
}, 30000);
const unconnectedTimer = setTimeout(() => {
  if (!authenticated) shutdown();
}, 60000);
unconnectedTimer.unref();
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.on('error', (error) => {
  console.error(message(error));
  shutdown();
  process.exitCode = 1;
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address() as net.AddressInfo;
  atomicWrite(portFile, JSON.stringify({ port: address.port, pid: process.pid, protocol: 1 }));
  console.log(`Native simulation ready on loopback ${address.port}.`);
});
