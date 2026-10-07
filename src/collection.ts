import { FORK_LOAD_CENTER } from './fork-geometry';
import type { State, Order, Equipment, Worker, Point, Rect, Item, Stack } from './types';
import type {
  Collection,
  CollectionRequest,
  CollectionQuote,
  CollectionTask,
  RetiredEquipment,
  CollectionLine,
} from './collection-types';
export type {
  Collection,
  CollectionRequest,
  CollectionQuote,
  CollectionTask,
  RetiredEquipment,
  CollectionLine,
} from './collection-types';
import { MATERIALS, EQUIPMENT, label } from './catalog';
import { FREIGHT_CAPACITY, FREIGHT_DECK_LENGTH } from './procurement';
import { equipmentAllows } from './equipment-roles';
import { equipmentHasAssignedWork } from './jobs';
import { workerAvailable } from './workforce';
import { boardMachine, leaveMachine, machineStep } from './boarding';
import { center, dist, overlap } from './path';
import { localPoint, turn, smoothstep, berth } from './motion';
import {
  machineRoute,
  walkRoute,
  equipmentMoveBlocked,
  equipmentSweepBlocked,
  equipmentReachBlocked,
  equipmentBoxes,
  people,
  boxOverlap,
  personTouchesBox,
  carrierBoxes,
  workerMoveBlocked,
} from './traffic';
import { parcelPitch, rampSupportPose } from './delivery';
import { takeRailLayers, appendRailLayers } from './rail-stock';
import { railStagingStackOwned } from './railwork';
import { requestActionClearance, clearActionClearance } from './action-clearance';

type CollectionState = State & {
  collections?: Collection[];
  retiredEquipment?: RetiredEquipment[];
};
type CollectionOrder = Order & { collectionId?: string };
export interface CollectionAPI {
  id(s: State, type: string): string;
  event(s: State, type: string, entity: string, text: string): void;
  notice(s: State, title: string, detail: string, entity: string): void;
  cost(s: State, category: string, entity: string, description: string, amount: number): void;
  movement(s: State, item: Item, qty: number, from: string, to: string, reason: string): void;
  obstacles(s: State): Rect[];
}
export const COLLECTION_FEES = {
  truck: 90,
  lowloader: 180,
  materialPerKg: 0.04,
  equipmentPerKg: 0.025,
};
export function collectionOwnsStack(s: CollectionState, stackId: string) {
  return (s.collections || []).some(
    (c) =>
      !['done', 'canceled'].includes(c.status) &&
      c.lines.some(
        (l) =>
          l.stackId === stackId &&
          (l.reserved > 0 || (c.task?.lifted && c.lines[c.task.lineIndex!]?.stackId === stackId)),
      ),
  );
}
export function collectionOwnsEquipment(s: CollectionState, equipmentId: string) {
  return (s.collections || []).some(
    (c) =>
      !['done', 'canceled'].includes(c.status) &&
      (c.equipmentId === equipmentId || c.automaticEquipment === equipmentId),
  );
}
function idleMachine(e: Equipment) {
  return (
    !e.job &&
    !e.deliveryOrder &&
    !e.transportOrder &&
    !e.refueling &&
    !e.cargo &&
    !e.assemblyLoad &&
    !e.path.length &&
    !e.trafficGoal &&
    !e.work
  );
}
function stackError(s: CollectionState, t: Stack | undefined) {
  if (!t || t.qty < 1) return 'Choose a physical stack with material remaining.';
  if (t.reserved || t.cableReservedMeters || t.cableReservedSpaceMeters || s.electrical?.runs.some(r=>!['commissioned','canceled'].includes(r.status)&&(r.reelId===t.id || r.reservations.some(q=>q.stackId===t.id))) || collectionOwnsStack(s, t.id) || railStagingStackOwned(s, t.id))
    return `${t.id} is reserved by active work. Release that work before collection.`;
  if (t.item === 'diesel' && (t.liters || 0) > 0.000001)
    return `${t.id} contains fuel. This collection service accepts empty drums only.`;
  if (
    s.jobs.some(
      (j) =>
        !['done', 'canceled'].includes(j.status) &&
        (j.stack === t.id || j.stockMove?.sourceId === t.id || j.recoveryStack?.id === t.id),
    )
  )
    return `${t.id} belongs to queued or active handling.`;
  return '';
}
export function quoteCollection(s: CollectionState, request: CollectionRequest): CollectionQuote {
  const bad = (error: string): CollectionQuote => ({
    valid: false,
    error,
    massKg: 0,
    transportFee: 0,
    disposalFee: 0,
    total: 0,
    loads: [],
  });
  if (!request || !!request.equipmentId === !!request.lines?.length)
    return bad('Choose material stacks or one machine for collection.');
  const loads: CollectionQuote['loads'] = [];
  if (request.equipmentId) {
    const e = s.equipment.find((e) => e.id === request.equipmentId);
    if (!e) return bad('Equipment not found.');
    if (!idleMachine(e) || collectionOwnsEquipment(s, e.id) || equipmentHasAssignedWork(s, e))
      return bad(`${e.id} is busy or assigned. Finish or release its work first.`);
    if (
      s.workers.some(
        (w) =>
          w.transition?.equipmentId === e.id ||
          w.assistingEquipment === e.id ||
          w.parkingEquipment === e.id,
      )
    )
      return bad(`Release active boarding, parking or support work on ${e.id} first.`);
    if (e.fuel < 1)
      return bad('Refuel this self-propelled machine before requesting a collection lowloader.');
    const massKg = EQUIPMENT[e.kind].mass + e.fuel * 0.825;
    const disposalFee = Math.ceil(massKg * COLLECTION_FEES.equipmentPerKg);
    loads.push({
      lines: [],
      equipmentId: e.id,
      massKg,
      transportFee: COLLECTION_FEES.lowloader,
      disposalFee,
      total: COLLECTION_FEES.lowloader + disposalFee,
    });
  } else {
    if (!Array.isArray(request.lines) || request.lines.length > 100)
      return bad('Choose 1–100 material stacks.');
    const seen = new Set<string>();
    let load: CollectionQuote['loads'][number] | undefined;
    for (const choice of request.lines) {
      if (
        !choice ||
        !Number.isInteger(choice.qty) ||
        choice.qty < 1 ||
        choice.qty > 1000 ||
        seen.has(choice.stackId)
      )
        return bad('Choose each stack once, with a whole quantity from 1 to 1,000.');
      seen.add(choice.stackId);
      const t = s.stacks.find((t) => t.id === choice.stackId),
        error = stackError(s, t);
      if (error) return bad(error);
      if (choice.qty > t!.qty) return bad(`${t!.id} has only ${t!.qty} units available.`);
      const m = MATERIALS[t!.item],
        unitMass = t!.item === 'diesel' ? 20 : t!.item === 'cableReel' ? 35+3*(t!.cableMeters??50) : m.mass;
      if (m.w > FREIGHT_DECK_LENGTH.road || m.d > 3)
        return bad(`${label(t!.item)} does not fit this collection truck.`);
      for (let remaining = choice.qty; remaining > 0;) {
        const length = (load?.lines || []).reduce(
          (n, l) => n + Math.ceil(l.qty / MATERIALS[l.item].max) * MATERIALS[l.item].w,
          0,
        );
        const cap = Math.min(
          m.max,
          Math.floor((FREIGHT_CAPACITY.road - (load?.massKg || 0)) / unitMass),
        );
        if (!load || cap < 1 || length + m.w > FREIGHT_DECK_LENGTH.road) {
          load = {
            lines: [],
            massKg: 0,
            transportFee: COLLECTION_FEES.truck,
            disposalFee: 0,
            total: COLLECTION_FEES.truck,
          };
          loads.push(load);
        }
        const qty = Math.min(
          remaining,
          m.max,
          Math.floor((FREIGHT_CAPACITY.road - load.massKg) / unitMass),
        );
        if (qty < 1) return bad('This parcel exceeds the truck payload.');
        load.lines.push({
          stackId: t!.id,
          sourceSnapshot: structuredClone(t!),
          item: t!.item,
          qty,
          reserved: qty,
          loaded: 0,
          collected: 0,
          yaw: t!.yaw || 0,
          trackHand: t!.trackHand,
          massKg: qty * unitMass,
        });
        load.massKg += qty * unitMass;
        load.disposalFee = Math.ceil(load.massKg * COLLECTION_FEES.materialPerKg);
        load.total = load.transportFee + load.disposalFee;
        remaining -= qty;
      }
    }
  }
  return {
    valid: true,
    kind: request.equipmentId ? 'equipment' : 'materials',
    massKg: loads.reduce((n, l) => n + l.massKg, 0),
    transportFee: loads.reduce((n, l) => n + l.transportFee, 0),
    disposalFee: loads.reduce((n, l) => n + l.disposalFee, 0),
    total: loads.reduce((n, l) => n + l.total, 0),
    loads,
  };
}
export function requestCollection(
  s: CollectionState,
  request: CollectionRequest,
  api: CollectionAPI,
): { ids: string[]; error?: string } {
  const quote = quoteCollection(s, request);
  if (!quote.valid) return { ids: [], error: quote.error };
  const ids: string[] = [];
  for (const load of quote.loads) {
    const cid = api.id(s, 'COL'),
      oid = api.id(s, 'order'),
      machine = s.equipment.find((e) => e.id === load.equipmentId);
    const c: Collection = {
      id: cid,
      carrierOrderId: oid,
      kind: machine ? 'equipment' : 'materials',
      status: 'ordered',
      phase: 'Await carrier',
      note: 'Collection ordered; physical site loading required.',
      lines: load.lines,
      equipmentId: machine?.id,
      massKg: load.massKg,
      fees: {
        transport: load.transportFee,
        disposal: load.disposalFee,
        total: load.total,
        invoiced: false,
        charged: 0,
      },
      created: s.time,
    };
    const o: CollectionOrder = {
      id: oid,
      collectionId: cid,
      item: machine?.kind || load.lines[0].item,
      qty: machine ? 1 : load.lines.reduce((n, l) => n + l.qty, 0),
      arrived: 0,
      mode: 'road',
      status: 'ordered',
      eta: s.time + 180 + ids.length * 45,
      total: load.total,
      invoiced: false,
      vehicle: { x: -75, z: -13 },
      stage: 0,
      handler: { x: 20, z: 20 },
      handling: 0,
      note: c.note,
    };
    (s.collections ??= []).push(c);
    s.orders.push(o);
    ids.push(cid);
    for (const l of c.lines) s.stacks.find((t) => t.id === l.stackId)!.reserved += l.qty;
    if (machine) machine.deliveryOrder = oid;
    api.event(
      s,
      'Collection',
      cid,
      `Paid ${c.kind} collection ordered: ${load.massKg.toFixed(1)} kg; quoted $${load.total}. Carrier ${oid}.`,
    );
    api.notice(
      s,
      'Collection ordered',
      `${cid}: $${load.total}; an operator and physical loading are required.`,
      cid,
    );
  }
  s.revision++;
  return { ids };
}
function collectionOrder(s: CollectionState, c: Collection) {
  return s.orders.find((o) => o.id === c.carrierOrderId)! as CollectionOrder;
}
export function collectionLots(s: CollectionState, o: CollectionOrder) {
  const c = s.collections?.find((c) => c.id === o.collectionId);
  if (!c || c.kind !== 'materials') return [];
  const width = c.lines.reduce((n, l) => n + MATERIALS[l.item].w, 0);
  let x = -width / 2 - 1.4;
  return c.lines.map((l, index) => {
    const w = MATERIALS[l.item].w,
      at = x + w / 2;
    x += w;
    return {
      index,
      item: l.item,
      qty: l.loaded - l.collected,
      original: l.qty,
      x: at,
      z: 0,
      lineIndex: index,
      carIndex: 0,
      carId: undefined as string | undefined,
      trackHand: l.trackHand,
    };
  });
}
function crew(s: CollectionState, e: Equipment, c: Collection, operator: boolean) {
  return s.workers
    .filter(
      (w) =>
        workerAvailable(s, w) &&
        w.duty === 'auto' &&
        !w.job &&
        !w.deliveryOrder &&
        !w.transportOrder &&
        !w.transition &&
        !w.railAssignment &&
        !w.processAssignment &&
        (operator
          ? w.role === 'operator' &&
            (!e.operator || e.operator === w.id) &&
            (!w.vehicle || w.vehicle === e.id)
          : w.role !== 'operator' &&
            !w.vehicle &&
            (!w.assistingEquipment || w.assistingEquipment === e.id)),
    )
    .sort(
      (a, b) => (a.vehicle === e.id ? -100 : dist(a, e)) - (b.vehicle === e.id ? -100 : dist(b, e)),
    )[0];
}
function warning(s: CollectionState, c: Collection, note: string, api: CollectionAPI) {
  c.note = note;
  if ((c.warned || []).includes(note)) return;
  (c.warned ??= []).push(note);
  if (c.warned.length > 32) c.warned.shift();
  api.notice(s, 'Collection waiting', `${c.id}: ${note}`, c.id);
  api.event(s, 'Collection', c.id, note);
}
function routeMachine(
  s: CollectionState,
  e: Equipment,
  p: Point,
  api: CollectionAPI,
  yaw?: number,
) {
  const path = machineRoute(s, { ...e, reverse: false }, p, api.obstacles(s), 600, true, yaw);
  if (!path) return false;
  e.reverse = false;
  e.path = path;
  e.trafficGoal = undefined;
  e.trafficReverse = undefined;
  return true;
}
function moveToward(s: CollectionState, e: Equipment, p: Point, api: CollectionAPI, yaw?: number) {
  if (e.path.length || e.trafficGoal) return false;
  if (dist(e, p) < 0.05) return true;
  if ((e.trafficRetry || 0) > s.elapsed) return false;
  e.trafficRetry = s.elapsed + 1.5;
  routeMachine(s, e, p, api, yaw);
  return false;
}
function align(s: CollectionState, c: Collection, e: Equipment, yaw: number, dt: number) {
  const pose = { ...e },
    done = turn(pose, yaw, dt, 1.2),
    blocker = equipmentSweepBlocked(s, e, pose);
  if (blocker) {
    e.blockedBy = blocker;
    c.note = `Waiting for ${blocker} to clear the collection maneuver`;
    requestActionClearance(s, {
      ownerId: c.carrierOrderId,
      requesterEquipmentId: e.id,
      blockerId: blocker,
      action: 'Align collection load',
      envelopes: [...equipmentBoxes(e), ...equipmentBoxes(e, pose)],
    });
    return false;
  }
  e.yaw = pose.yaw;
  e.blockedBy = undefined;
  return done;
}
function reach(s: CollectionState, e: Equipment, value: number, dt: number) {
  const next = (e.reach || 2.7) + Math.max(-dt * 0.8, Math.min(dt * 0.8, value - (e.reach || 2.7)));
  if (equipmentReachBlocked(s, e, next)) return false;
  e.reach = next;
  return Math.abs(next - value) < 0.01;
}
/** A stationary vertical lift still needs a clear real tool/load footprint. */
function loadAreaClear(s: State, c: Collection, e: Equipment) {
  const boxes = equipmentBoxes(e),
    blockers = new Set<string>();
  for (const p of people(s))
    if (
      p.worker?.transition?.equipmentId !== e.id &&
      boxes.some((b) => personTouchesBox(p, b, 0.42))
    )
      blockers.add(p.id);
  for (const other of s.equipment)
    if (
      other.id !== e.id &&
      !other.transportOrder &&
      boxes.some((a) => equipmentBoxes(other).some((b) => boxOverlap(a, b, 0.08)))
    )
      blockers.add(other.id);
  for (const o of s.orders)
    if (
      o.id !== c.carrierOrderId &&
      !['ordered', 'done'].includes(o.status) &&
      !o.carrierDeparted &&
      boxes.some((a) => carrierBoxes(o).some((b) => boxOverlap(a, b, 0.08)))
    )
      blockers.add(o.id);
  for (const blockerId of blockers)
    requestActionClearance(s, {
      ownerId: c.carrierOrderId,
      requesterEquipmentId: e.id,
      blockerId,
      action: 'Lift or lower collection load',
      envelopes: boxes,
    });
  if (blockers.size) c.note = `Waiting for ${[...blockers].join(', ')} to clear collection load.`;
  return !blockers.size;
}
function cargoFollow(t: CollectionTask, e: Equipment, y: number) {
  t.cargo = {
    ...localPoint({ ...e, yaw: e.yaw || 0 }, e.reach || 2.7, 0),
    y,
    yaw: (e.yaw || 0) + Math.PI / 2,
  };
  e.lift = y;
}
function releaseCrew(s: CollectionState, c: Collection) {
  const t = c.task;
  if (!t) return;
  const e = s.equipment.find((e) => e.id === t.equipmentId);
  if (e) {
    e.deliveryOrder = undefined;
    e.work = 0;
    e.reverse = false;
    e.reach = 2.7;
    e.lift = 0.12;
    e.trafficGoal = undefined;
    e.trafficReverse = undefined;
  }
  for (const wid of [t.operatorId, t.helperId]) {
    const w = s.workers.find((w) => w.id === wid);
    if (w?.deliveryOrder === c.carrierOrderId) {
      w.deliveryOrder = undefined;
      w.status = w.vehicle ? 'Available in cab' : 'Available';
    }
  }
  c.task = undefined;
  clearActionClearance(s, c.carrierOrderId);
}
function releaseUnpicked(s: CollectionState, c: Collection) {
  for (const l of c.lines) {
    const t = s.stacks.find((t) => t.id === l.stackId);
    if (t) t.reserved = Math.max(0, t.reserved - l.reserved);
    l.reserved = 0;
  }
}
function depart(s: CollectionState, c: Collection, api: CollectionAPI) {
  releaseCrew(s, c);
  releaseUnpicked(s, c);
  const o = collectionOrder(s, c);
  c.status = 'departing';
  c.phase = 'Carrier departing';
  c.note = c.cancelRequested
    ? 'Remaining pickup canceled; already secured cargo leaving with the carrier.'
    : 'All cargo secured; carrier leaving the yard.';
  o.status = 'departing';
  o.note = c.note;
  if (o.drive) {
    o.drive.velocity = 0;
    o.drive.reverse = false;
    o.drive.gearPause = 0.6;
    o.drive.yardPermit = undefined;
  }
  api.event(s, 'Collection', c.id, c.note);
  s.revision++;
}
function startMaterial(s: CollectionState, c: Collection, api: CollectionAPI) {
  const index = c.lines.findIndex((l) => l.reserved > 0);
  if (index < 0) {
    depart(s, c, api);
    return;
  }
  const l = c.lines[index],
    source = s.stacks.find((t) => t.id === l.stackId);
  if (!source || source.qty < l.reserved) {
    warning(s, c, `Reserved source ${l.stackId} is unavailable.`, api);
    return;
  }
  const m = MATERIALS[l.item],
    unitMass = l.massKg / l.qty;
  const machines = s.equipment
    .filter(
      (e) =>
        idleMachine(e) &&
        !collectionOwnsEquipment(s, e.id) &&
        !equipmentHasAssignedWork(s, e) &&
        equipmentAllows(e, 'recovery') &&
        e.fuel > 0.5 &&
        EQUIPMENT[e.kind].capacity >= unitMass,
    )
    .sort(
      (a, b) =>
        (a.id === c.automaticEquipment ? -2 : a.kind === 'forklift' ? 0 : 1) -
        (b.id === c.automaticEquipment ? -2 : b.kind === 'forklift' ? 0 : 1),
    );
  // The current collection's owner may be idle between lifts but remains reserved to it.
  const owner = s.equipment.find((e) => e.id === c.automaticEquipment);
  if (
    owner &&
    idleMachine(owner) &&
    equipmentAllows(owner, 'recovery') &&
    owner.fuel > 0.5 &&
    !equipmentHasAssignedWork(s, owner) &&
    EQUIPMENT[owner.kind].capacity >= unitMass
  )
    machines.unshift(owner);
  for (const e of machines) {
    const w = crew(s, e, c, true),
      helper = e.kind === 'excavator' ? crew(s, e, c, false) : undefined;
    if (!w || (e.kind === 'excavator' && !helper)) continue;
    const qty = Math.min(l.reserved, Math.floor(EQUIPMENT[e.kind].capacity / unitMass));
    const yaw = source.yaw || 0,
      sourcePose = {
        ...center(source),
        y: (source.baseHeight || 0) + (source.qty - qty) * parcelPitch(l.item),
        yaw,
      };
    const workingReach = Math.max(3.1, Math.ceil(m.d / 2 + 1.55));
    const sourceDock = localPoint(sourcePose, 0, workingReach),
      sourceClear = localPoint(sourcePose, 0, workingReach + 3.5);
    const slot = collectionLots(s, collectionOrder(s, c))[index];
    const deck = {
      ...localPoint(
        { ...collectionOrder(s, c).vehicle, yaw: collectionOrder(s, c).drive?.yaw || 0 },
        slot.x,
        0,
      ),
      y: 1.15 + l.loaded * parcelPitch(l.item),
      yaw: 0,
    };
    const deckReach = Math.max(3.9, m.d / 2 + 1.9),
      deckDock = localPoint(deck, 0, deckReach),
      deckClear = localPoint(deck, 0, deckReach + 3.5);
    const wp = w.vehicle === e.id ? [] : walkRoute(s, w, machineStep(e), api.obstacles(s));
    const helperPoint = localPoint(sourcePose, -m.w / 2 - 0.7, 1.3);
    const hp = helper ? walkRoute(s, helper, helperPoint, api.obstacles(s)) : [];
    const path = machineRoute(s, e, sourceDock, api.obstacles(s), 600, true, yaw - Math.PI / 2);
    if (!wp || !hp || !path) continue;
    e.deliveryOrder = c.carrierOrderId;
    w.deliveryOrder = c.carrierOrderId;
    w.path = wp;
    w.status = 'Walking to collection equipment';
    if (helper) {
      helper.deliveryOrder = c.carrierOrderId;
      helper.path = hp;
      helper.status = 'Walking to rig collection load';
    }
    c.automaticEquipment = e.id;
    c.task = {
      equipmentId: e.id,
      operatorId: w.id,
      helperId: helper?.id,
      phase: 'boarding',
      clock: 0,
      lineIndex: index,
      qty,
      source: sourcePose,
      sourceDock,
      sourceClear,
      sourceYaw: yaw - Math.PI / 2,
      deck,
      deckDock,
      deckClear,
      deckYaw: -Math.PI / 2,
      originalSource: { x: source.x, z: source.z, w: source.w, d: source.d },
    };
    c.phase = 'Operator boarding';
    c.note = `${w.id} preparing ${e.id} to load ${source.id}.`;
    s.revision++;
    return;
  }
  warning(
    s,
    c,
    'Waiting for an available recovery machine, qualified operator, accessible source and any required helper.',
    api,
  );
}
function materialTick(s: CollectionState, c: Collection, dt: number, api: CollectionAPI) {
  const t = c.task!,
    e = s.equipment.find((e) => e.id === t.equipmentId)!,
    w = s.workers.find((w) => w.id === t.operatorId)!;
  if (!e || !w) {
    warning(s, c, 'Assigned collection equipment or operator is missing.', api);
    return;
  }
  const l = c.lines[t.lineIndex!],
    source = s.stacks.find((s) => s.id === l.stackId)!;
  const set = (phase: CollectionTask['phase']) => {
    t.phase = phase;
    t.clock = 0;
    c.phase = phase;
  };
  if (e.fuel <= 0 || e.refueling) {
    warning(s, c, `${e.id} needs fuel before collection can continue.`, api);
    return;
  }
  t.clock += dt;
  if (
    c.cancelRequested &&
    !t.lifted &&
    !['clear-deck', 'secure-return', 'secure-board'].includes(t.phase)
  ) {
    e.path = [];
    w.path = [];
    const h = s.workers.find((w) => w.id === t.helperId);
    if (h) h.path = [];
    depart(s, c, api);
    return;
  }
  if (c.cancelRequested && t.phase === 'carry') {
    e.path = [];
    e.trafficGoal = undefined;
    set('return');
  }
  if (t.phase === 'boarding') {
    if (w.path.length || w.transition) {
      t.clock = 0;
      return;
    }
    if (w.vehicle !== e.id) {
      boardMachine(w, e);
      t.clock = 0;
      return;
    }
    if (!routeMachine(s, e, t.sourceDock, api, t.sourceYaw)) {
      c.note = 'Waiting for a clear route to the selected stock.';
      return;
    }
    set('source');
  } else if (t.phase === 'source') {
    c.note = `${e.id} approaching exact source ${source.id}.`;
    if (!moveToward(s, e, t.sourceDock, api, t.sourceYaw) || !align(s, c, e, t.sourceYaw, dt))
      return;
    if (!reach(s, e, dist(e, t.source), dt)) return;
    e.lift = t.source.y;
    e.work = 1;
    set('rig');
  } else if (t.phase === 'rig') {
    const helper = s.workers.find((w) => w.id === t.helperId);
    if (helper?.path.length) {
      t.clock = 0;
      return;
    }
    if (t.clock < 2.5) return;
    if (helper && !t.rigged) {
      const clear = localPoint(
        { ...t.sourceDock, yaw: t.sourceYaw },
        -1.5,
        -MATERIALS[l.item].w / 2 - 2.1,
      );
      const path = walkRoute(s, helper, clear, api.obstacles(s));
      if (!path) {
        c.note = `${helper.id} needs a clear walking route away from the load.`;
        return;
      }
      helper.path = path;
      helper.status = 'Clearing collection lift';
      t.rigged = true;
      return;
    }
    if (!source || source.qty < t.qty || source.reserved < t.qty) {
      warning(s, c, 'Collection stock reservation no longer matches the physical source.', api);
      return;
    }
    t.assetIds = l.item.startsWith('rail')
      ? takeRailLayers(source, t.qty)
      : source.assetId
        ? [source.assetId]
        : undefined;
    if (!l.item.startsWith('rail')) source.qty -= t.qty;
    source.reserved -= t.qty;
    l.reserved -= t.qty;
    e.cargo = { item: l.item, qty: t.qty };
    t.cargo = { ...t.source };
    t.lifted = true;
    api.movement(s, l.item, t.qty, source.id, e.id, 'Collection pickup');
    set('lift');
    s.revision++;
  } else if (t.phase === 'lift') {
    if (!loadAreaClear(s, c, e)) {
      t.clock -= dt;
      return;
    }
    t.cargo = { ...t.source, y: t.source.y + 0.45 * smoothstep(t.clock / 2.5) };
    e.lift = t.cargo.y;
    if (t.clock < 2.5) return;
    e.reverse = true;
    e.path = [t.sourceClear];
    set('clear-source');
  } else if (t.phase === 'clear-source') {
    cargoFollow(t, e, t.source.y + 0.45);
    if (e.path.length || e.trafficGoal) return;
    if (dist(e, t.sourceClear) > 0.05) {
      e.reverse = true;
      e.path = [t.sourceClear];
      return;
    }
    e.reverse = false;
    const helper = s.workers.find((w) => w.id === t.helperId);
    if (helper) {
      helper.deliveryOrder = undefined;
      helper.status = 'Available';
      t.helperId = undefined;
    }
    set(c.cancelRequested ? 'return' : 'carry');
  } else if (t.phase === 'carry' || t.phase === 'return') {
    const returning = t.phase === 'return',
      goal = returning ? t.sourceDock : t.deckDock,
      yaw = returning ? t.sourceYaw : t.deckYaw;
    const target = returning ? t.source : t.deck;
    const travelReach =
      e.kind === 'forklift' && dist(e, goal) > 0.1 ? FORK_LOAD_CENTER : dist(goal, target);
    if (!reach(s, e, travelReach, dt)) {
      cargoFollow(t, e, Math.max(0.45, target.y + 0.4));
      return;
    }
    cargoFollow(t, e, Math.max(0.45, target.y + 0.4));
    if (!moveToward(s, e, goal, api, yaw) || !align(s, c, e, yaw, dt)) return;
    if (!reach(s, e, dist(e, target), dt)) return;
    cargoFollow(t, e, Math.max(0.45, target.y + 0.4));
    if (dist(t.cargo!, target) > 0.03) return;
    set(returning ? 'return-lower' : 'lower');
  } else if (t.phase === 'lower' || t.phase === 'return-lower') {
    if (!loadAreaClear(s, c, e)) {
      t.clock -= dt;
      return;
    }
    const returning = t.phase === 'return-lower',
      target = returning ? t.source : t.deck;
    const raised = Math.max(0.45, target.y + 0.4);
    t.cargo = { ...target, y: raised + (target.y - raised) * smoothstep(t.clock / 2.5) };
    e.lift = t.cargo.y;
    if (t.clock < 2.5) return;
    if (returning) {
      if (l.item.startsWith('rail'))
        appendRailLayers(source, t.assetIds || Array(t.qty).fill(null));
      else source.qty += t.qty;
      if (l.item === 'diesel') source.liters = 0;
      api.movement(s, l.item, t.qty, e.id, source.id, 'Canceled collection returned to source');
      e.cargo = undefined;
      t.cargo = undefined;
      t.lifted = false;
      e.reverse = true;
      e.path = [t.sourceClear];
      t.withdrawalPoint = t.sourceClear;
      set('clear-deck');
    } else set('secure-exit');
    s.revision++;
  } else if (t.phase === 'secure-exit') {
    if (w.vehicle) {
      leaveMachine(s, w);
      t.clock = 0;
      return;
    }
    if (w.transition) {
      t.clock = 0;
      return;
    }
    t.securingPoint ??= localPoint(
      t.deck,
      -MATERIALS[l.item].w / 2 - 0.8,
      Math.max(2, MATERIALS[l.item].d / 2 + 0.8),
    );
    const path = walkRoute(s, w, t.securingPoint, api.obstacles(s));
    if (!path) {
      c.note = 'Operator needs a clear walking route to the load tie-downs.';
      return;
    }
    w.path = path;
    w.status = 'Walking to secure collection load';
    set('secure-walk');
  } else if (t.phase === 'secure-walk') {
    if (w.path.length || w.transition) return;
    if (dist(w, t.securingPoint!) > 0.05) {
      const path = walkRoute(s, w, t.securingPoint!, api.obstacles(s));
      if (path) w.path = path;
      return;
    }
    w.yaw = Math.atan2(t.deck.z - w.z, t.deck.x - w.x);
    w.status = 'Securing load to collection truck';
    set('secure');
  } else if (t.phase === 'secure') {
    if (!loadAreaClear(s, c, e)) {
      t.clock -= dt;
      return;
    }
    if (t.clock < 2) return;
    l.loaded += t.qty;
    (l.assetIds ??= []).push(...(t.assetIds || Array(t.qty).fill(null)));
    collectionOrder(s, c).arrived += t.qty;
    if (source.qty === 0 && source.reserved === 0)
      s.stacks = s.stacks.filter((stack) => stack.id !== source.id);
    api.movement(s, l.item, t.qty, e.id, c.id, 'Secured on collection truck');
    e.cargo = undefined;
    t.cargo = undefined;
    t.lifted = false;
    w.status = 'Returning to collection equipment';
    set('secure-return');
    s.revision++;
  } else if (t.phase === 'secure-return') {
    if (w.path.length || w.transition) return;
    const step = machineStep(e);
    if (dist(w, step) > 0.05) {
      const path = walkRoute(s, w, step, api.obstacles(s));
      if (path) w.path = path;
      else c.note = 'Operator needs a clear walking route back to the cab.';
      return;
    }
    set('secure-board');
  } else if (t.phase === 'secure-board') {
    if (w.transition) return;
    if (w.vehicle !== e.id) {
      boardMachine(w, e);
      return;
    }
    e.reverse = true;
    e.path = [t.deckClear];
    t.withdrawalPoint = t.deckClear;
    set('clear-deck');
  } else if (t.phase === 'clear-deck') {
    if (e.path.length || e.trafficGoal) return;
    const target = t.withdrawalPoint || t.deckClear;
    if (dist(e, target) > 0.05) {
      e.reverse = true;
      e.path = [target];
      return;
    }
    releaseCrew(s, c);
    if (c.cancelRequested || c.lines.every((l) => !l.reserved)) depart(s, c, api);
  }
}
function startEquipment(s: CollectionState, c: Collection, api: CollectionAPI) {
  const e = s.equipment.find((e) => e.id === c.equipmentId);
  if (!e) {
    warning(s, c, 'Collection equipment is missing.', api);
    return;
  }
  if (e.fuel <= 0.5) {
    warning(s, c, `${e.id} needs fuel to drive onto the lowloader. Refuel before collection.`, api);
    return;
  }
  const w = crew(s, e, c, true),
    o = collectionOrder(s, c),
    b = berth(o),
    approach = localPoint(b, -13.5, 0);
  if (!w) {
    warning(s, c, 'Waiting for a hired operator to drive this machine onto the lowloader.', api);
    return;
  }
  const path = w.vehicle === e.id ? [] : walkRoute(s, w, machineStep(e), api.obstacles(s));
  if (!path || !machineRoute(s, e, approach, api.obstacles(s), 600, true, b.yaw)) {
    warning(s, c, 'No clear operator or equipment route to the lowloader ramp.', api);
    return;
  }
  w.deliveryOrder = o.id;
  w.path = path;
  e.deliveryOrder = o.id;
  c.task = {
    equipmentId: e.id,
    operatorId: w.id,
    phase: 'boarding',
    clock: 0,
    qty: 1,
    source: { ...e, y: e.y || 0, yaw: e.yaw || 0 },
    sourceDock: { ...e },
    sourceClear: { ...e },
    deck: { ...localPoint(b, -1.5, 0), y: 0.82, yaw: b.yaw },
    deckDock: approach,
    deckClear: localPoint(b, -13.5, 3),
    sourceYaw: e.yaw || 0,
    deckYaw: b.yaw,
    originalEquipmentPose: { ...e, yaw: e.yaw || 0 },
  };
  c.phase = 'Operator boarding equipment';
  s.revision++;
}
function equipmentTick(s: CollectionState, c: Collection, dt: number, api: CollectionAPI) {
  const t = c.task!,
    e = s.equipment.find((e) => e.id === t.equipmentId)!,
    w = s.workers.find((w) => w.id === t.operatorId)!,
    o = collectionOrder(s, c),
    b = berth(o);
  if (!e || !w) {
    warning(s, c, 'Collection machine or operator is missing.', api);
    return;
  }
  const set = (phase: CollectionTask['phase']) => {
    t.phase = phase;
    t.clock = 0;
    c.phase = phase;
  };
  t.clock += dt;
  if (c.cancelRequested && ['boarding', 'equipment-approach', 'ramps'].includes(t.phase)) {
    e.path = [];
    e.deliveryOrder = undefined;
    w.path = [];
    releaseCrew(s, c);
    depart(s, c, api);
    return;
  }
  if (t.phase === 'boarding') {
    if (w.path.length || w.transition) {
      t.clock = 0;
      return;
    }
    if (w.vehicle !== e.id) {
      boardMachine(w, e);
      return;
    }
    if (!routeMachine(s, e, t.deckDock, api, t.deckYaw)) return;
    set('equipment-approach');
  } else if (t.phase === 'equipment-approach') {
    if (!moveToward(s, e, t.deckDock, api, t.deckYaw) || !align(s, c, e, t.deckYaw, dt)) return;
    set('ramps');
  } else if (t.phase === 'ramps') {
    if (e.fuel < 0.25) {
      warning(
        s,
        c,
        'Insufficient fuel to complete the ramp; cancel and refuel this machine before collection.',
        api,
      );
      return;
    }
    o.ramp = Math.min(1, t.clock / 3);
    if (o.ramp < 1) return;
    e.transportOrder = o.id;
    o.equipmentId = e.id;
    o.deployment = 'offload';
    set('equipment-ramp');
  } else if (t.phase === 'equipment-ramp' || t.phase === 'equipment-unload') {
    const unloading = t.phase === 'equipment-unload';
    if (c.cancelRequested && !unloading) {
      t.returnQty = Math.min(1, t.clock / 16);
      set('equipment-unload');
      return;
    }
    const f = unloading
      ? Math.max(0, (t.returnQty ?? 1) - t.clock / 16)
      : Math.min(1, t.clock / 16);
    const x = -13.5 + 12 * smoothstep(f),
      p = localPoint(b, x, 0);
    const blocker = equipmentSweepBlocked(s, e, { ...p, yaw: b.yaw });
    if (blocker) {
      t.clock = Math.max(0, t.clock - dt);
      c.note = `Ramp blocked by ${blocker}.`;
      return;
    }
    const fuel = Math.min(e.fuel, dt * 0.008);
    if (fuel <= 0) {
      t.clock = Math.max(0, t.clock - dt);
      warning(s, c, 'Machine ran out of fuel on the lowloader ramp; refuel to resume.', api);
      return;
    }
    e.fuel -= fuel;
    e.used += fuel;
    Object.assign(e, p, rampSupportPose(e.kind, x), {
      yaw: b.yaw,
      reverse: unloading,
      travel: 12 * smoothstep(f),
      velocity: 0.75,
    });
    w.x = e.x;
    w.z = e.z;
    if (unloading ? f > 0 : f < 1) return;
    e.velocity = 0;
    e.reverse = false;
    if (unloading) {
      e.transportOrder = undefined;
      e.y = 0;
      e.pitch = 0;
      o.equipmentId = undefined;
      t.deckClear = localPoint(b, -12, -15);
      set('equipment-clear');
      return;
    }
    set('equipment-exit');
  } else if (t.phase === 'equipment-clear') {
    if (!moveToward(s, e, t.deckClear, api)) return;
    releaseCrew(s, c);
    depart(s, c, api);
  } else if (t.phase === 'equipment-exit') {
    // Operator physically walks down the same deployed ramp; the carrier waits.
    if (w.vehicle) {
      leaveMachine(s, w);
      t.clock = 0;
      return;
    }
    if (w.transition) {
      t.clock = 0;
      return;
    }
    t.operatorRampOrigin ??= { x: w.x, z: w.z, y: w.y || 0 };
    const f = smoothstep(Math.max(0, t.clock - 2) / 8),
      x = -1.7 - 11.8 * f,
      ramp = localPoint(b, x, 0),
      side = (1 - f) * 1.85;
    const p = localPoint({ ...ramp, yaw: b.yaw }, 0, side);
    const next = {
      x: t.operatorRampOrigin.x + (p.x - t.operatorRampOrigin.x) * Math.min(1, t.clock / 2),
      z: t.operatorRampOrigin.z + (p.z - t.operatorRampOrigin.z) * Math.min(1, t.clock / 2),
    };
    const rampState = {
      ...s,
      orders: s.orders.filter((q) => q.id !== o.id),
      equipment: s.equipment.map((q) => (q.id === e.id ? { ...q, transportOrder: undefined } : q)),
    };
    const blocker = workerMoveBlocked(rampState, w, next);
    if (blocker) {
      t.clock -= dt;
      c.note = `Operator ramp walk blocked by ${blocker}.`;
      requestActionClearance(s, {
        ownerId: o.id,
        blockerId: blocker,
        action: 'Clear collection operator ramp',
        envelopes: [{ ...next, yaw: 0, length: 1, width: 1 }],
      });
      return;
    }
    w.x = next.x;
    w.z = next.z;
    w.y = rampSupportPose(e.kind, x).y;
    w.travel = 12 * f;
    w.yaw=b.yaw+Math.PI;
    w.status = 'Walking down collection lowloader ramp';
    if (f < 1) return;
    w.y = 0;
    w.path = walkRoute(s, w, t.deckClear, api.obstacles(s)) || [];
    if (!w.path.length && dist(w, t.deckClear) > 0.05) {
      c.note = 'Operator needs a clear walking route away from the lowloader.';
      return;
    }
    o.arrived = 1;
    o.deployment = 'complete';
    e.transportOrder = o.id;
    // The tank is sealed and remains accounted in the archived asset after departure.
    c.phase = 'Waiting for operator clear of carrier';
    set('clear-deck');
  } else if (t.phase === 'clear-deck') {
    if (w.path.length || w.transition) return;
    depart(s, c, api);
  }
}
export function cancelCollection(
  s: CollectionState,
  id: string,
  api: CollectionAPI,
): string | undefined {
  const c = s.collections?.find((c) => c.id === id);
  if (!c || ['done', 'canceled', 'departing'].includes(c.status))
    return 'Select a collection that has not departed.';
  c.cancelRequested = true;
  if (c.status === 'paused') c.status = c.pausedStatus || 'loading';
  const o = collectionOrder(s, c);
  if (o.status === 'ordered') {
    releaseUnpicked(s, c);
    releaseCrew(s, c);
    const e = s.equipment.find((e) => e.id === c.equipmentId);
    if (e?.deliveryOrder === o.id) e.deliveryOrder = undefined;
    o.status = 'done';
    c.status = 'canceled';
    c.phase = 'Canceled before dispatch';
    c.note = 'No collection or disposal fee charged.';
    c.finished = s.time;
  } else {
    c.status = 'canceling';
    c.note =
      'Cancel requested; return suspended cargo safely, then stop remaining pickup. Already secured cargo still leaves.';
  }
  api.event(s, 'Collection', c.id, c.note);
  s.revision++;
}
export function pauseCollection(s: CollectionState, id: string): string | undefined {
  const c = s.collections?.find((c) => c.id === id);
  if (!c || !['ordered', 'loading', 'canceling'].includes(c.status))
    return 'This collection cannot be paused now.';
  const e = s.equipment.find((e) => e.id === c.task?.equipmentId);
  if (collectionOrder(s, c).status === 'approaching')
    return 'Wait for the carrier to stop at its berth before pausing.';
  if (
    e?.path.length ||
    e?.trafficGoal ||
    c.task?.phase === 'equipment-ramp' ||
    c.task?.phase === 'equipment-exit' ||
    c.task?.phase === 'equipment-unload'
  )
    return 'Wait for the current movement or ramp operation to stop before pausing.';
  c.pausedStatus =
    c.status === 'ordered' ? 'ordered' : c.status === 'canceling' ? 'canceling' : 'loading';
  c.status = 'paused';
  c.note = 'Collection paused; cargo and source reservations retained.';
  s.revision++;
}
export function resumeCollection(s: CollectionState, id: string): string | undefined {
  const c = s.collections?.find((c) => c.id === id);
  if (!c || c.status !== 'paused') return 'Select a paused collection.';
  c.status = c.pausedStatus || 'loading';
  c.pausedStatus = undefined;
  c.note = 'Collection resumed.';
  c.retryAt = undefined;
  s.revision++;
}
export function tickCollection(
  s: CollectionState,
  o: CollectionOrder,
  dt: number,
  api: CollectionAPI,
) {
  const c = s.collections?.find((c) => c.id === o.collectionId);
  if (!c || c.status === 'done' || c.status === 'canceled') return;
  if (o.carrierDeparted) {
    const acceptedMass =
      c.kind === 'equipment'
        ? o.arrived
          ? c.massKg
          : 0
        : c.lines.reduce((n, l) => n + l.loaded * (l.massKg / l.qty), 0);
    const disposal = Math.ceil(
      acceptedMass *
        (c.kind === 'equipment' ? COLLECTION_FEES.equipmentPerKg : COLLECTION_FEES.materialPerKg),
    );
    if (disposal) {
      api.cost(
        s,
        'Collection',
        c.id,
        `Disposal / handling of ${acceptedMass.toFixed(1)} kg physically collected`,
        disposal,
      );
      c.fees.charged += disposal;
    }
    for (const l of c.lines) {
      const qty = l.loaded - l.collected;
      if (qty) api.movement(s, l.item, qty, c.id, 'OFFSITE', 'Paid collection departed');
      l.collected = l.loaded;
    }
    if (c.equipmentId && o.arrived) {
      const index = s.equipment.findIndex((e) => e.id === c.equipmentId);
      if (index >= 0) {
        const e = s.equipment[index];
        (s.retiredEquipment ??= []).push({
          ...structuredClone(e),
          path: [],
          deliveryOrder: undefined,
          transportOrder: undefined,
          operator: undefined,
          collectionId: c.id,
          retiredAt: s.time,
          retirementReason: 'paid collection',
        });
        s.equipment.splice(index, 1);
      }
    }
    if (c.equipmentId && !o.arrived) {
      const e = s.equipment.find((e) => e.id === c.equipmentId);
      if (e?.deliveryOrder === o.id) e.deliveryOrder = undefined;
    }
    c.status = c.cancelRequested && !o.arrived ? 'canceled' : 'done';
    c.phase = 'Carrier left yard';
    c.finished = s.time;
    c.note = `${o.arrived} unit${o.arrived === 1 ? '' : 's'} collected; source, fees and asset history retained.`;
    c.automaticEquipment = undefined;
    releaseCrew(s, c);
    api.notice(s, 'Collection complete', `${c.id}: ${c.note}`, c.id);
    api.event(s, 'Collection', c.id, c.note);
    s.revision++;
    return;
  }
  if (c.status === 'paused' || o.status === 'ordered' || o.status === 'approaching') return;
  if (o.status === 'departing') {
    if (c.equipmentId && o.arrived) {
      const e = s.equipment.find((e) => e.id === c.equipmentId);
      if (e)
        Object.assign(e, localPoint({ ...o.vehicle, yaw: o.drive?.yaw || 0 }, -1.5, 0), {
          yaw: o.drive?.yaw || 0,
        });
    }
    return;
  }
  if (!c.fees.invoiced) {
    api.cost(
      s,
      'Collection',
      c.id,
      `Collection carrier arrived · transport service`,
      c.fees.transport,
    );
    c.fees.invoiced = true;
    c.fees.charged = c.fees.transport;
    o.invoiced = true;
  }
  if (c.status === 'ordered') c.status = 'loading';
  if (c.cancelRequested && !c.task) {
    depart(s, c, api);
    return;
  }
  if (c.task) {
    if (c.kind === 'equipment') equipmentTick(s, c, dt, api);
    else materialTick(s, c, dt, api);
    return;
  }
  if ((c.retryAt || 0) > s.elapsed) return;
  c.retryAt = s.elapsed + 2;
  if (c.kind === 'equipment') startEquipment(s, c, api);
  else startMaterial(s, c, api);
}
export function collectionInventory(s: CollectionState, item: Item) {
  const lines = (s.collections || []).flatMap((c) => c.lines.filter((l) => l.item === item));
  return {
    outbound: lines.reduce((n, l) => n + l.loaded - l.collected, 0),
    collected: lines.reduce((n, l) => n + l.collected, 0),
  };
}
