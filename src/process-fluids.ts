import type { State, Building, Point, Worker, Order, RailFreightCar } from './types';
import type { ProcessState, ProcessOperation, ProcessPump } from './process-types';
import type { RailCommodity } from './rail-commodities';
import { railFreightCarPose } from './rail-freight';
import { localPoint } from './motion';
import { walkRoute, staticObstacleRects } from './traffic';
import { selectWorker, noteWorkerAssignment } from './worker-selection';

/** DN100 internal bore; fitting volumes use their actual modeled centerline lengths. */
export const PROCESS_LINE_CAPACITY = ((Math.PI * 0.1 ** 2) / 4) * 1000;
export const PROCESS_PIPE_HEIGHT = 0.85;
export const processLineLength = (kind: string) =>
  kind === 'pipeTee' ? 1.5 : kind === 'pipeElbow' ? 0.6 + Math.PI * 0.1 : 1;
export const processLineCapacity = (kind: string) =>
  PROCESS_LINE_CAPACITY * processLineLength(kind);
export const PROCESS_KINDS = [
  'processTank',
  'transferPump',
  'processPipe',
  'pipeElbow',
  'pipeTee',
  'processValve',
  'processGauge',
] as const;
const lineKinds = ['processPipe', 'pipeElbow', 'pipeTee', 'processValve', 'processGauge'];
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const next = (s: State, prefix: string) => `${prefix}-${String(s.next++).padStart(4, '0')}`;
const asset = (s: State, id: string) => s.buildings.find((b) => b.id === id);
const active = (o: ProcessOperation) => o.finished === undefined;
function log(s: State, entity: string, text: string, warning = false) {
  s.events.push({
    id: next(s, 'E'),
    time: s.time,
    type: 'Process',
    entity,
    text,
    severity: warning ? 'warning' : 'info',
  });
  if (warning)
    s.notices.unshift({
      id: next(s, 'N'),
      time: s.time,
      title: 'Process work blocked',
      detail: text,
      entity,
      state: 'todo',
      seen: false,
    });
  s.revision++;
}
/** Register only installed components. Safe removal is checked before a building is removed. */
export function reconcileProcessAssets(s: State) {
  const bs = s.buildings.filter((b) => (PROCESS_KINDS as readonly string[]).includes(b.kind));
  if (!s.process && !bs.length) return;
  const p = (s.process ||= {
    tanks: [],
    lines: [],
    pumps: [],
    valves: [],
    operations: [],
    sources: [],
    ledger: [],
  });
  const tankIds = new Set(p.tanks.map((q) => q.id)),
    lineIds = new Set(p.lines.map((q) => q.id)),
    pumpIds = new Set(p.pumps.map((q) => q.id)),
    valveIds = new Set(p.valves.map((q) => q.id));
  for (const b of bs) {
    if (b.kind === 'processTank' && !tankIds.has(b.id))
      p.tanks.push({ id: b.id, liters: 0, capacity: 30000 });
    if (lineKinds.includes(b.kind) && !lineIds.has(b.id))
      p.lines.push({ id: b.id, liters: 0, capacity: processLineCapacity(b.kind), flow: 0 });
    if (b.kind === 'transferPump' && !pumpIds.has(b.id))
      p.pumps.push({
        id: b.id,
        enabled: false,
        rate: 5,
        flow: 0,
        transferred: 0,
        hose: 'disconnected',
        status: 'Connect a stationary tanker',
      });
    if (b.kind === 'processValve' && !valveIds.has(b.id)) p.valves.push({ id: b.id, open: false });
  }
  const buildings = new Map(bs.map((b) => [b.id, b]));
  for (const line of p.lines) {
    const b = buildings.get(line.id);
    if (b && line.liters === 0) line.capacity = processLineCapacity(b.kind);
  }
  const present = new Set(bs.map((b) => b.id));
  p.tanks = p.tanks.filter((q) => present.has(q.id));
  p.lines = p.lines.filter((q) => present.has(q.id));
  p.pumps = p.pumps.filter((q) => present.has(q.id));
  p.valves = p.valves.filter((q) => present.has(q.id));
  for (const pump of p.pumps)
    if (pump.tankId && !p.tanks.some((t) => t.id === pump.tankId)) {
      pump.tankId = undefined;
      pump.enabled = false;
    }
}
export interface ProcessPort extends Point {
  dx: number;
  dz: number;
  y: number;
}
function rotated(b: Building, x: number, z: number): Point {
  const a = ((b.rotation || 0) * Math.PI) / 2,
    c = Math.round(Math.cos(a)),
    n = Math.round(Math.sin(a));
  return {
    x: b.x + b.w / 2 + c * (x - b.w / 2) - n * (z - b.d / 2),
    z: b.z + b.d / 2 + n * (x - b.w / 2) + c * (z - b.d / 2),
  };
}
export function processPorts(b: Building): ProcessPort[] {
  const raw =
    b.kind === 'processTank'
      ? [
          [0, 2.5, -1, 0],
          [4, 2.5, 1, 0],
          [2.5, 0, 0, -1],
          [2.5, 4, 0, 1],
        ]
      : b.kind === 'transferPump'
        ? [[2, 0.5, 1, 0]]
        : b.kind === 'pipeElbow'
          ? [
              [0, 0.5, -1, 0],
              [0.5, 0, 0, -1],
            ]
          : b.kind === 'pipeTee'
            ? [
                [0, 0.5, -1, 0],
                [1, 0.5, 1, 0],
                [0.5, 0, 0, -1],
              ]
            : lineKinds.includes(b.kind)
              ? [
                  [0, 0.5, -1, 0],
                  [1, 0.5, 1, 0],
                ]
              : [];
  return raw.map(([x, z, dx, dz]) => {
    // Tank ports are fixed to the vessel footprint; the four nozzles are symmetric by use, not by rotation.
    const r = b.kind === 'processTank' ? { ...b, rotation: 0 } : b;
    const pt = rotated(r, x, z),
      a = (r.rotation * Math.PI) / 2,
      c = Math.round(Math.cos(a)),
      n = Math.round(Math.sin(a));
    return { ...pt, dx: c * dx - n * dz || 0, dz: n * dx + c * dz || 0, y: PROCESS_PIPE_HEIGHT };
  });
}
function car(s: State, id: string): { o: Order; c: RailFreightCar; index: number } | undefined {
  for (const o of s.orders) {
    const index = o.railFreight?.cars.findIndex((c) => c.id === id) ?? -1;
    if (index >= 0) return { o, c: o.railFreight!.cars[index], index };
  }
}
export function processPumpHosePoints(s: State, pumpId: string) {
  const p = s.process?.pumps.find((p) => p.id === pumpId),
    b = asset(s, pumpId),
    source = p?.carId && car(s, p.carId);
  if (!p || !b || !source) return [];
  const inlet = rotated(b, 0, 0.5),
    fitting = localPoint(railFreightCarPose(source.o, source.index), 0, 1.6);
  return [
    { ...inlet, y: 1.1 },
    { ...inlet, y: 0.2 },
    { ...fitting, y: 0.2 },
    { ...fitting, y: 1.66 },
  ];
}
export function processHosePaths(s: State) {
  return (s.process?.pumps || [])
    .filter((p) => p.hose !== 'disconnected')
    .map((p) => {
      const physical = processPumpHosePoints(s, p.id),
        op = s.process?.operations.find((o) => o.id === p.operation),
        w = op && s.workers.find((w) => w.id === op.workerId);
      let points = physical;
      if (physical.length === 4 && op && w) {
        const inlet = physical[0];
        if (op.kind === 'connect' && op.phase === 0)
          points = [
            inlet,
            { x: inlet.x, y: 0.2, z: inlet.z },
            { x: inlet.x - 0.4, y: 0.2, z: inlet.z + 0.3 },
            { x: inlet.x, y: 0.2, z: inlet.z + 0.55 },
          ];
        else if (op.phase === 1 && (op.kind === 'connect' || op.kind === 'disconnect'))
          points = [
            inlet,
            { ...inlet, y: 0.2 },
            { x: w.x, y: 0.2, z: w.z },
            { x: w.x, y: (w.y || 0) + 0.9, z: w.z },
          ];
      }
      return { id: `HOSE-${p.id}`, pumpId: p.id, points };
    });
}
export function processRailCarLocked(s: State, carId: string) {
  return s.process?.pumps.find((p) => p.carId === carId && p.hose !== 'disconnected')?.id;
}
export function processCarStationary(s: State, id: string) {
  const q = car(s, id);
  if (!q?.c.tank || q.c.returned || q.o.status !== 'unloading') return false;
  if (
    q.o.railFreight?.returnId ||
    (s.railReturns || []).some((r) => r.phase !== 'done' && r.carIds.includes(id))
  )
    return false;
  if (
    q.o.railFreight?.incomingRailMove &&
    q.o.railFreight.incomingRailMove.distance < q.o.railFreight.incomingRailMove.end - 0.01
  )
    return false;
  return !(s.shunters || []).some(
    (e) => (e.carIds || []).includes(id) && !['parked', 'uncoupling'].includes(e.phase),
  );
}
/** Walk graph edges only through opposing, physically coincident installed ports. */
export function processNetworkRoute(
  s: State,
  pumpId: string,
  tankId: string,
  ignoreValves = false,
): string[] | undefined {
  const bs = s.buildings.filter(
    (b) => b.id === pumpId || b.id === tankId || lineKinds.includes(b.kind),
  );
  const byId = new Map(bs.map((b) => [b.id, b]));
  if (!byId.has(pumpId) || !byId.has(tankId)) return;
  const ports = new Map<string, { id: string; port: ProcessPort }[]>();
  for (const b of bs)
    for (const port of processPorts(b)) {
      const key = `${port.x},${port.z}`,
        at = ports.get(key) || [];
      at.push({ id: b.id, port });
      ports.set(key, at);
    }
  const closed = new Set(
    ignoreValves ? [] : s.process?.valves.filter((v) => !v.open).map((v) => v.id) || [],
  );
  const queue = [pumpId],
    prev = new Map<string, string | undefined>([[pumpId, undefined]]);
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    if (id === tankId) {
      const route: string[] = [];
      let at: string | undefined = id;
      while (at) {
        route.unshift(at);
        at = prev.get(at);
      }
      return route;
    }
    if (closed.has(id)) continue;
    for (const port of processPorts(byId.get(id)!))
      for (const other of ports.get(`${port.x},${port.z}`) || [])
        if (!prev.has(other.id) && port.dx === -other.port.dx && port.dz === -other.port.dz) {
          prev.set(other.id, id);
          queue.push(other.id);
        }
  }
}
export function configureProcessPump(
  s: State,
  pumpId: string,
  choices: { tankId?: string; rate?: number },
) {
  reconcileProcessAssets(s);
  const p = s.process?.pumps.find((p) => p.id === pumpId);
  if (!p) return 'Select an installed transfer pump.';
  if (p.enabled || p.operation)
    return 'Stop the pump and finish its current operation before configuring it.';
  if (choices.tankId && !s.process!.tanks.some((t) => t.id === choices.tankId))
    return 'Select an installed process tank.';
  if (
    choices.rate !== undefined &&
    (!Number.isFinite(choices.rate) || choices.rate < 0.1 || choices.rate > 5)
  )
    return 'Choose a rate from 0.1 to 5 L/s.';
  if ('tankId' in choices) p.tankId = choices.tankId;
  if (choices.rate !== undefined) p.rate = choices.rate;
  s.revision++;
  return undefined;
}
function operationWorker(s: State, point: Point, workerId?: string) {
  return selectWorker(s,[point],{preferredId:workerId,candidates:workerId?s.workers.filter(w=>w.id===workerId):undefined,eligible:w=>['builder','engineer'].includes(w.role)&&!w.assistingEquipment})?.worker;
}
function pumpWorkpoint(b: Building) {
  return rotated(b, -0.7, 0.5);
}
function startOperation(
  s: State,
  b: Building,
  kind: ProcessOperation['kind'],
  workerId?: string,
  carId?: string,
  open?: boolean,
) {
  const goal = kind === 'valve' ? rotated(b, 0.5, 1.6) : pumpWorkpoint(b),
    w = operationWorker(s, goal, workerId);
  if (!w) return 'No available builder or engineer can walk to the work point.';
  const op: ProcessOperation = {
    id: next(s, 'PROC'),
    buildingId: b.id,
    workerId: w.id,
    carId,
    kind,
    open,
    phase: 0,
    clock: 0,
    started: s.time,
    status: 'Walk to work point',
  };
  s.process!.operations.push(op);
  noteWorkerAssignment(s,w,{workId:b.id});
  w.processAssignment = op.id;
  w.path = walkRoute(s, w, goal, staticObstacleRects(s)) || [];
  w.status = op.status;
  log(s, op.id, `${w.name} assigned to ${kind} at ${b.id}.`);
  return op;
}
export function requestPumpHose(s: State, pumpId: string, carId: string, workerId?: string) {
  reconcileProcessAssets(s);
  const p = s.process?.pumps.find((p) => p.id === pumpId),
    b = asset(s, pumpId),
    q = car(s, carId);
  if (!p || !b) return 'Select an installed transfer pump.';
  if (p.hose !== 'disconnected' || p.operation)
    return 'This pump already has a hose connection or operation.';
  if (!q?.c.tank || !processCarStationary(s, carId))
    return 'Select a stationary received tanker car.';
  if (processRailCarLocked(s, carId))
    return 'The tanker discharge connection is already reserved by another pump.';
  const inlet = rotated(b, 0, 0.5),
    fitting = localPoint(railFreightCarPose(q.o, q.index), 0, 1.6);
  if (distance(inlet, fitting) > 8)
    return 'The tanker discharge fitting must be within 8 meters of the pump inlet.';
  const op = startOperation(s, b, 'connect', workerId, carId);
  if (typeof op === 'string') return op;
  p.carId = carId;
  p.hose = 'connecting';
  p.operation = op.id;
  p.status = 'Crew connecting hose';
  return undefined;
}
export function disconnectPumpHose(s: State, pumpId: string, workerId?: string) {
  const p = s.process?.pumps.find((p) => p.id === pumpId),
    b = asset(s, pumpId);
  if (!p || !b || p.hose !== 'connected' || p.operation)
    return 'Select a connected pump with no active hose operation.';
  if (p.enabled) return 'Stop the pump before disconnecting the hose.';
  const op = startOperation(s, b, 'disconnect', workerId, p.carId);
  if (typeof op === 'string') return op;
  p.hose = 'disconnecting';
  p.operation = op.id;
  p.status = 'Crew disconnecting hose';
  return undefined;
}
export function requestProcessValve(s: State, valveId: string, open: boolean, workerId?: string) {
  reconcileProcessAssets(s);
  const v = s.process?.valves.find((v) => v.id === valveId),
    b = asset(s, valveId);
  if (!v || !b) return 'Select an installed valve.';
  if (v.operation) return 'A worker is already operating this valve.';
  if (v.open === open) return undefined;
  const op = startOperation(s, b, 'valve', workerId, undefined, open);
  if (typeof op === 'string') return op;
  v.operation = op.id;
  return undefined;
}
export function setProcessPumpRunning(s: State, pumpId: string, running: boolean) {
  const p = s.process?.pumps.find((p) => p.id === pumpId);
  if (!p) return 'Select an installed pump.';
  if (running && (p.hose !== 'connected' || p.operation || !p.tankId))
    return 'Connect the tanker hose and select a destination tank first.';
  if (running && !processNetworkRoute(s, p.id, p.tankId!))
    return 'No open, continuous installed pipe route reaches the selected tank.';
  if (running && !s.utilities.power)
    return 'Connect the site electrical supply before starting the pump.';
  p.enabled = running;
  p.runId = running ? next(s, 'FLOW') : undefined;
  p.flow = 0;
  p.status = running ? 'Starting transfer' : 'Stopped';
  s.revision++;
  return undefined;
}
function tickOperations(s: State, dt: number) {
  const p = s.process!;
  for (const op of p.operations.filter(active)) {
    const w = s.workers.find((w) => w.id === op.workerId),
      b = asset(s, op.buildingId);
    if (!w || !b) continue;
    const pump = p.pumps.find((p) => p.id === b.id),
      q = op.carId ? car(s, op.carId) : undefined;
    const carFoot = q ? localPoint(railFreightCarPose(q.o, q.index), 0, 2.05) : undefined;
    const valve = op.kind === 'valve';
    const goals = valve
      ? [rotated(b, 0.5, 1.6)]
      : op.kind === 'connect'
        ? [pumpWorkpoint(b), carFoot!, pumpWorkpoint(b)]
        : [carFoot!, pumpWorkpoint(b)];
    const goal = goals[op.phase];
    if (!goal) {
      op.status = 'Missing physical work point';
      continue;
    }
    if (distance(w, goal) > 0.24) {
      if (!op.lastPoint || distance(w, op.lastPoint) > 0.04) {
        op.lastPoint = { x: w.x, z: w.z };
        op.lastProgress = s.time;
      }
      if (s.time - (op.lastProgress ?? s.time) >= 15 && !op.warned) {
        log(
          s,
          op.id,
          `${w.name} cannot reach ${b.id}${w.blockedBy ? `; waiting for ${w.blockedBy}` : ''}; clear its physical work point.`,
          true,
        );
        op.warned = true;
      }
      if (!w.path.length) {
        const route = walkRoute(s, w, goal, staticObstacleRects(s));
        if (route) w.path = route;
      }
      op.status = `Walk to ${(op.phase === 1 && op.kind === 'connect') || (op.phase === 0 && op.kind === 'disconnect') ? 'tanker discharge fitting' : 'work point'}`;
      if (!w.path.length) {
        op.blockedSince ??= s.time;
        if (s.time - op.blockedSince >= 15 && !op.warned) {
          log(
            s,
            op.id,
            `${w.name} cannot reach ${b.id}; clear its hose or valve work point.`,
            true,
          );
          op.warned = true;
        }
      }
      w.status = op.status;
      continue;
    }
    op.blockedSince = undefined;
    op.lastPoint = undefined;
    op.lastProgress = undefined;
    op.clock += dt;
    op.status = valve
      ? 'Turn valve handwheel'
      : op.kind === 'connect'
        ? ['Prepare pump hose', 'Connect tanker discharge fitting', 'Check hose connection'][
            op.phase
          ]
        : ['Disconnect tanker discharge fitting', 'Secure hose on pump'][op.phase];
    w.status = op.status;
    if (op.clock < (valve ? 3 : 4)) continue;
    op.clock = 0;
    op.phase++;
    if (op.phase < goals.length) continue;
    if (valve) {
      const v = p.valves.find((v) => v.id === b.id)!;
      v.open = !!op.open;
      v.operation = undefined;
    } else if (pump) {
      pump.hose = op.kind === 'connect' ? 'connected' : 'disconnected';
      pump.operation = undefined;
      pump.status = op.kind === 'connect' ? 'Connected; pump stopped' : 'Disconnected';
      if (op.kind === 'disconnect') pump.carId = undefined;
      if (op.kind === 'connect' && q?.c.tank && !p.sources.some((v) => v.carId === q.c.id))
        p.sources.push({
          carId: q.c.id,
          product: q.c.tank.product,
          initialLiters: q.c.tank.liters,
          initialArrived: q.c.manifest[0].arrived,
        });
    }
    op.finished = s.time;
    op.status = 'Done';
    w.processAssignment = undefined;
    w.status = 'Available';
    log(s, op.id, `${op.kind} operation completed at ${b.id}.`);
  }
  if (p.operations.length > 5000)
    p.operations = p.operations
      .filter(active)
      .concat(p.operations.filter((o) => !active(o)).slice(-4000));
}
function ledger(
  s: State,
  pump: ProcessPump,
  product: RailCommodity,
  from: string,
  to: string,
  liters: number,
) {
  const p = s.process!,
    runId = pump.runId!;
  let entry;
  for (let i = p.ledger.length - 1; i >= 0; i--) {
    const row = p.ledger[i];
    if (row.runId === runId && row.from === from && row.to === to && row.product === product) {
      entry = row;
      break;
    }
  }
  if (entry) {
    entry.liters += liters;
    entry.updated = s.time;
  } else
    p.ledger.push({
      id: next(s, 'FLUID'),
      runId,
      time: s.time,
      updated: s.time,
      product,
      from,
      to,
      liters,
    });
  if (p.ledger.length > 50000) p.ledger.splice(0, p.ledger.length - 50000);
}
function transfer(s: State, dt: number) {
  const p = s.process!,
    lineMap = new Map(p.lines.map((l) => [l.id, l])),
    tankMap = new Map(p.tanks.map((l) => [l.id, l])),
    budget = s.utilities.power
      ? Math.max(0, 16000 - s.buildings.filter((b) => b.kind === 'lamp').length * 100)
      : 0;
  let watts = budget;
  const candidates: {
    pump: ProcessPump;
    q: NonNullable<ReturnType<typeof car>>;
    route: string[];
    want: number;
    room: number;
    sourceLiters: number;
  }[] = [];
  for (const pump of [...p.pumps].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!pump.enabled) {
      pump.status = pump.operation
        ? 'Crew operating hose'
        : pump.hose === 'connected'
          ? 'Stopped'
          : 'Connect a stationary tanker';
      continue;
    }
    if (watts < 2000) {
      pump.status = s.utilities.power ? 'Site power capacity exhausted' : 'No electrical supply';
      continue;
    }
    watts -= 2000;
    const q = pump.carId ? car(s, pump.carId) : undefined;
    if (pump.hose !== 'connected' || !q?.c.tank || !processCarStationary(s, q.c.id)) {
      pump.status = 'Hose not connected to a stationary tanker';
      continue;
    }
    const tank = p.tanks.find((t) => t.id === pump.tankId);
    if (!tank) {
      pump.status = 'Select destination tank';
      continue;
    }
    const route = processNetworkRoute(s, pump.id, tank.id);
    if (!route) {
      pump.status = processNetworkRoute(s, pump.id, tank.id, true)
        ? 'Closed valve isolates destination'
        : 'No continuous installed pipe route';
      continue;
    }
    const nodes = route.slice(1).map((id) => lineMap.get(id) || tankMap.get(id)!);
    if (nodes.some((n) => n.product && n.product !== q.c.tank!.product)) {
      pump.status = 'Incompatible liquid in selected pipe route or tank';
      continue;
    }
    const room = nodes.reduce((sum, n) => sum + n.capacity - n.liters, 0);
    if (q.c.tank.liters < 1e-8) {
      pump.status = 'Tanker empty';
      continue;
    }
    if (room < 1e-8) {
      pump.status = 'Tank and pipe route full';
      continue;
    }
    candidates.push({ pump, q, route, want: pump.rate * dt, room, sourceLiters: q.c.tank.liters });
  }
  const sourceDemand = new Map<string, number>(),
    tankDemand = new Map<string, number>();
  for (const c of candidates) {
    sourceDemand.set(c.q.c.id, (sourceDemand.get(c.q.c.id) || 0) + c.want);
    tankDemand.set(c.pump.tankId!, (tankDemand.get(c.pump.tankId!) || 0) + c.want);
  }
  for (const c of candidates) {
    const { pump, q, route } = c,
      product = q.c.tank!.product;
    const nodes = route.slice(1).map((id) => lineMap.get(id) || tankMap.get(id)!);
    if (nodes.some((n) => n.product && n.product !== product)) {
      pump.status = 'Incompatible liquid in shared pipe';
      continue;
    }
    const actualRoom = nodes.reduce((sum, n) => sum + n.capacity - n.liters, 0);
    const sourceInitial = p.sources.find((v) => v.carId === q.c.id);
    if (!sourceInitial) {
      pump.status = 'Missing source accounting baseline';
      continue;
    }
    const sourceBudget = c.sourceLiters;
    const factor = Math.min(
      1,
      sourceBudget / sourceDemand.get(q.c.id)!,
      c.room / tankDemand.get(pump.tankId!)!,
    );
    const accepted = Math.min(c.want * factor, q.c.tank!.liters, actualRoom);
    if (accepted <= 1e-10) continue;
    let left = accepted,
      from = q.c.id;
    for (const n of nodes) {
      n.product = product;
      const held = Math.min(left, n.capacity - n.liters);
      n.liters += held;
      ledger(s, pump, product, from, n.id, left);
      const line = lineMap.get(n.id);
      if (line) line.flow += left;
      left -= held;
      from = n.id;
      if (left <= 1e-10) break;
    }
    q.c.tank!.liters = Math.max(0, q.c.tank!.liters - accepted);
    if (q.c.tank!.liters < 1e-8) q.c.tank!.liters = 0;
    q.c.manifest[0].arrived = q.c.manifest[0].qty - q.c.tank!.liters;
    for (let i = 0; i < (q.o.manifest?.length || 0); i++)
      q.o.manifest![i].arrived = q.o.railFreight!.cars.reduce(
        (sum, car) =>
          sum +
          car.manifest
            .filter((line) => (line.orderLineIndex ?? 0) === i)
            .reduce((n, line) => n + line.arrived, 0),
        0,
      );
    q.o.arrived = (q.o.manifest || []).reduce((sum, line) => sum + line.arrived, 0);
    pump.flow += accepted;
    pump.transferred += accepted;
    pump.status = 'Transferring';
  }
}
export function tickProcessFluids(s: State, dt: number) {
  reconcileProcessAssets(s);
  if (!s.process || !Number.isFinite(dt) || dt <= 0) return;
  tickOperations(s, dt);
  for (const p of s.process.pumps) p.flow = 0;
  for (const l of s.process.lines) l.flow = 0;
  // Small deterministic transfer slices prevent large time steps from skipping finite line fill.
  let remaining = dt;
  while (remaining > 1e-9) {
    const step = Math.min(0.25, remaining);
    transfer(s, step);
    remaining -= step;
  }
  // Rates are mean accepted flow during this simulation tick, not sums of substep rates.
  for (const p of s.process.pumps) p.flow /= dt;
  for (const l of s.process.lines) l.flow /= dt;
}
export function processRecoveryConflict(s: State, id: string) {
  const p = s.process;
  if (!p) return;
  if (
    p.tanks.some((t) => t.id === id && t.liters > 1e-7) ||
    p.lines.some((t) => t.id === id && t.liters > 1e-7)
  )
    return 'Drain the contained liquid before removing this component.';
  if (p.pumps.some((t) => t.id === id && (t.hose !== 'disconnected' || t.enabled || t.operation)))
    return 'Stop the pump and physically disconnect its hose before removal.';
  if (p.operations.some((o) => active(o) && o.buildingId === id))
    return 'Finish the physical process operation before removal.';
}
export const processBuildingRemovalProblem = processRecoveryConflict;
export function processBalance(s: State) {
  const p = s.process,
    carsById = new Map(
      s.orders.flatMap((o) => (o.railFreight?.cars || []).map((c) => [c.id, c] as const)),
    );
  return (['bulkWater', 'bulkDiesel'] as const).map((product) => {
    const sources = p?.sources.filter((q) => q.product === product) || [],
      initial = sources.reduce((n, q) => n + q.initialLiters, 0),
      cars = sources.reduce((n, q) => n + (carsById.get(q.carId)?.tank?.liters || 0), 0),
      tanks = (p?.tanks || [])
        .filter((q) => q.product === product)
        .reduce((n, q) => n + q.liters, 0),
      lines = (p?.lines || [])
        .filter((q) => q.product === product)
        .reduce((n, q) => n + q.liters, 0);
    return { product, initial, cars, tanks, lines, difference: initial - cars - tanks - lines };
  });
}
export function processRows(s: State) {
  const p = s.process,
    assets = new Map(s.buildings.map((b) => [b.id, b]));
  const allPorts = new Map<string, { id: string; p: ProcessPort }[]>();
  for (const b of s.buildings)
    for (const port of processPorts(b)) {
      const key = `${port.x},${port.z}`,
        rows = allPorts.get(key) || [];
      rows.push({ id: b.id, p: port });
      allPorts.set(key, rows);
    }
  const base = (id: string) => {
    const b = assets.get(id);
    return {
      id,
      kind: b?.kind,
      x: b?.x,
      z: b?.z,
      rotation: b?.rotation || 0,
      ports: b ? processPorts(b) : [],
      connectedTo: b ? [...new Set(processPorts(b).flatMap(port =>
        (allPorts.get(`${port.x},${port.z}`) || []).filter(q => q.id !== id && port.dx === -q.p.dx && port.dz === -q.p.dz).map(q => q.id)
      ))] : [],
      source: b?.source,
      material: b?.kind,

    };
  };
  const tanks = (p?.tanks || []).map((t) => ({
    ...base(t.id),
    ...t,
    status: t.liters < 1e-8 ? 'Empty' : t.liters >= t.capacity - 1e-8 ? 'Full' : 'Contains liquid',
  }));
  const lines = (p?.lines || []).map((l) => {
    const b = assets.get(l.id);
    return {
      ...base(l.id),
      ...l,
      length: b ? processLineLength(b.kind) : 0,
      status: l.liters < 1e-8 ? 'Dry' : l.liters >= l.capacity - 1e-8 ? 'Full' : 'Filling',
      connected:
        !!b &&
        processPorts(b).some((port) =>
          (allPorts.get(`${port.x},${port.z}`) || []).some(
            (q) => q.id !== l.id && port.dx === -q.p.dx && port.dz === -q.p.dz,
          ),
        ),
    };
  });
  const pumps = (p?.pumps || []).map((q) => ({
    ...base(q.id), ...q,
    route: q.tankId ? processNetworkRoute(s, q.id, q.tankId) || [] : [],
    installedRoute: q.tankId ? processNetworkRoute(s, q.id, q.tankId, true) || [] : [],
  }));
  const valves = (p?.valves || []).map((v) => ({
    ...base(v.id),
    ...p?.lines.find((l) => l.id === v.id),
    ...v,
    length: processLineLength('processValve'),
    status: v.operation ? 'Worker operating valve' : v.open ? 'Open' : 'Closed',
  }));
  const gauges = lines
    .filter((l) => l.kind === 'processGauge')
    .map((l) => {
      const reachable = tanks.filter((t) => processNetworkRoute(s, l.id, t.id));
      const tank = reachable.length === 1 ? reachable[0] : undefined;
      const measuredPump = pumps.find(
        (q) => q.enabled && q.tankId && processNetworkRoute(s, q.id, q.tankId)?.includes(l.id),
      );
      const route = measuredPump?.tankId
        ? processNetworkRoute(s, measuredPump.id, measuredPump.tankId)
        : undefined;
      const nextId = route?.[route.indexOf(l.id) + 1],
        nextAsset = nextId ? asset(s, nextId) : undefined;
      const direction = nextAsset
        ? { x: Math.sign(nextAsset.x - (l.x || 0)), z: Math.sign(nextAsset.z - (l.z || 0)) }
        : undefined;
      return {
        ...l,
        reading: l.connected && l.liters > 1e-8 ? l.flow : undefined,
        status: !l.connected
          ? 'Disconnected'
          : !reachable.length
            ? 'Isolated'
            : reachable.length > 1
              ? 'Multiple connected tanks'
              : l.liters < 1e-8
                ? 'Dry'
                : l.flow > 1e-8
                  ? 'Flowing'
                  : 'No flow',
        unit: 'L/s',
        calibrated: true,
        tankId: tank?.id,
        level: tank?.liters,
        capacity: tank?.capacity,
        lineCapacity: l.capacity,
        direction,
      };
    });
  const balance = processBalance(s);
  return {
    tanks,
    pumps,
    lines,
    valves,
    gauges,
    operations: p?.operations || [],
    balance,
    ledger: p?.ledger || [],
  };
}
