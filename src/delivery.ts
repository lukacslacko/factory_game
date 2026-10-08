import { storageMoveOwnsStack } from './storage-locks';
import { tickCollection, collectionOwnsEquipment, collectionOwnsStack } from './collection';
import type { TrafficBox } from './traffic';
import { requestActionClearance, clearActionClearance, actionEnvelopeBlockers } from './action-clearance';
import { appendRailLayers, incomingRailLayers } from './rail-stock';
export { orderLines, orderDescription, orderMass, itemMass } from './procurement';
import { orderLines, orderDescription, pendingOrderLine, freightStackLimit } from './procurement';
import { railFreightCarPose, railReceptionPlan, railStopDistance } from './rail-freight';
import { railActorBoxes, prepareRailArrival, advanceRailArrival, advanceAttachedRailDeparture } from './rail-operations';
import { workerAvailable, commuteDoor } from './workforce';
import { selectWorker, noteWorkerAssignment } from './worker-selection';
import { actionClearanceHoldsEquipment } from './action-clearance';
import {
  equipmentAssistant,
  availableEquipmentAssistant,
  equipmentAssistantReason,
  workerSupportsEquipment,
} from './work-crews';
import { equipmentHasAssignedWork, equipmentCanReceiveRailSupply } from './jobs';
import { RAIL_PANEL_PITCH, railStagingStackOwned } from './railwork';
import { equipmentAllows } from './equipment-roles';
import { FORK_LOAD_CENTER } from './fork-geometry';
import { deliveryBlockageNotice, resetDeliveryBlockage } from './delivery-control';
import { staticRailPickupFaces } from './rail-pickup';
import type {
  State,
  Order,
  Point,
  Rect,
  Equipment,
  EquipmentKind,
  Worker,
  Item,
  Stack,
  UnloadTask,
} from './types';
import { leaveMachine, machineStep } from './boarding';
import { MATERIALS, EQUIPMENT, ROLES, SERVICES, label } from './catalog';
import { route, approach, overlap, center, dist } from './path';
import {
  roadMoveBlocked,
  carrierBoxes,
  boxOverlap,
  boxRect,
  equipmentSweepBlocked,
  equipmentMoveBlocked,
  equipmentReachBlocked,
  equipmentBoxes,
  walkRoute,
  machineRoute,
  machineRetreatRoute,
  staticObstacleRects,
  personTouchesBox,
  workerMoveBlocked,
} from './traffic';
import {
  berth,
  deliveryKind,
  roadLength,
  roadExitLength,
  roadStopDistances,
  ROAD_ROUTE_VERSION,
  sampleRoad,
  RAIL_STOP,
  trackPose,
  carPose,
  COUPLED_CENTERS,
  localPoint,
  deckPose,
  turn,
  angleDelta,
  smoothstep,
} from './motion';

export interface DeliveryAPI {
  id(s: State, type: string): string;
  event(s: State, type: string, entity: string, text: string): void;
  notice(s: State, title: string, detail: string, entity: string): void;
  cost(s: State, category: string, entity: string, description: string, amount: number): void;
  movement(s: State, item: Item, qty: number, from: string, to: string, reason: string): void;
  obstacles(s: State): Rect[];
  allocate(s: State, item: Item, from?: Point): Rect | null;
}
export const parcelPitch = (item: Item) =>
  item === 'slab'
    ? 0.18
    : item === 'rail' || item.startsWith('rail')
      ? RAIL_PANEL_PITCH
      : item === 'lamp'
        ? 0.16
        : item === 'fence'
          ? 0.14
          : 0;
export const stackHeight = (item: Item, qty: number) =>
  item === 'slab'
    ? 0.02 + qty * 0.18
    : item === 'rail' || item.startsWith('rail')
      ? (qty - 1) * RAIL_PANEL_PITCH + 0.325
      : item === 'office' || item === 'sanitary'
        ? 3
        : item === 'bufferStop'
          ? 1.1
          : item === 'diesel'
            ? 0.94
            : Math.max(0.35, qty * parcelPitch(item) + 0.35);
export function freightPose(o: Order, carIndex?: number) {
  if (o.mode !== 'rail') return { ...o.vehicle, yaw: o.drive?.yaw || 0 };
  const index =
    carIndex ??
    Math.max(
      0,
      o.railFreight?.cars.findIndex((car) => car.manifest.some((l) => l.arrived < l.qty)) ?? 0,
    );
  return railFreightCarPose(o, index);
}
export function shipmentLots(o: Order) {
  const out: {
    index: number;
    lineIndex: number;
    carId?: string;
    carIndex?: number;
    carLineIndex?: number;
    item: Item;
    qty: number;
    original: number;
    x: number;
    z: number;
  }[] = [];
  const groups = o.railFreight
    ? o.railFreight.cars.map((car, carIndex) => ({ car, carIndex, lines: car.manifest }))
    : [{ car: undefined, carIndex: undefined, lines: orderLines(o) }];
  for (const group of groups) {
    if(group.car?.kind==='tanker') continue;
    const begin = out.length;
    let width = 0;
    for (const [localLineIndex, line] of group.lines.entries()) {
      const m = MATERIALS[line.item as Item];
      if (!m) continue;
      const lineIndex = 'orderLineIndex' in line ? Number(line.orderLineIndex) : localLineIndex;
      const limit = freightStackLimit(o, line.item as Item);
      let taken = line.arrived;
      for (let i = 0; i < Math.ceil(line.qty / limit); i++) {
        const original = Math.min(limit, line.qty - i * limit),
          qty = Math.max(0, original - taken);
        taken = Math.max(0, taken - original);
        out.push({
          index: out.length,
          lineIndex,
          carId: group.car?.id,
          carIndex: group.carIndex,
          carLineIndex: group.car ? localLineIndex : undefined,
          item: line.item as Item,
          qty,
          original,
          x: width + m.w / 2,
          z: 0,
        });
        width += m.w;
      }
    }
    for (const lot of out.slice(begin)) lot.x -= width / 2 + (o.mode === 'road' ? 1.4 : 0);
  }
  return out;
}
export function carrierRects(s: State): Rect[] {
  return [...railActorBoxes(s).map(b=>boxRect(b)), ...s.orders
    .filter((o) => o.status !== 'ordered' && o.status !== 'done' && !o.carrierDeparted)
    .flatMap((o) => carrierBoxes(o).map((b) => boxRect(b)))];
}
const equipmentRect = (e: Equipment): Rect => ({ x: e.x - 1.9, z: e.z - 1.25, w: 3.8, d: 2.5 });
/** Keep a load's approach and straight withdrawal lane free until handling releases it. */
export function constructionStorageClearance(s: State): Rect[] {
  const areas: Rect[] = [];
  for (const j of s.jobs) {
    const h = j.handling,
      e = s.equipment.find((e) => e.id === j.equipment);
    if (j.status !== 'doing' || !h || !e || h.phase === 'complete') continue;
    const reserve = (points: Point[], target: Point) => {
      const yaw = Math.atan2(target.z - points[0].z, target.x - points[0].x);
      const rects = points.flatMap((p) =>
        equipmentBoxes(
          { ...e, reach: h.reach, cargo: { item: j.item || 'slab', qty: 1 } },
          { ...p, yaw },
        ).map((b) => boxRect(b, 0.18)),
      );
      const x = Math.min(...rects.map((r) => r.x)),
        z = Math.min(...rects.map((r) => r.z));
      areas.push({
        x,
        z,
        w: Math.max(...rects.map((r) => r.x + r.w)) - x,
        d: Math.max(...rects.map((r) => r.z + r.d)) - z,
      });
    };
    if (['approach', 'rig', 'engage', 'lift', 'clear'].includes(h.phase))
      reserve([h.sourceDock, h.sourceApproach, h.sourceClear], h.source);
    reserve(
      [h.destinationDock, h.destinationClear],
      j.bufferTarget || center(j.bufferDestination || j),
    );
    if (j.bufferDestination) areas.push(j.bufferDestination);
  }
  return areas;
}
function freeOperator(s: State, e?: Equipment, preferred?: string, target?:Point) {
  const goal=target||(e?machineStep(e):undefined);if(!goal)return;
  return selectWorker(s,[goal],{preferredId:preferred,equipmentId:e?.id,allowVehicle:true,eligible:w=>(!e?.operator||e.operator===w.id)&&w.role==='operator'&&(!w.vehicle||w.vehicle===e?.id||s.equipment.some(q=>q.id===w.vehicle&&!q.job&&!q.deliveryOrder&&!q.transportOrder&&!q.path.length))})?.worker;
}
function walkingRoute(s: State, w: Worker, p: Point, api: DeliveryAPI) {
  return walkRoute(s, w, p, [
    ...s.buildings.filter((b) => !['lamp', 'power', 'water', 'shed', 'engineShed'].includes(b.kind)),
    ...s.stacks.filter((t) => t.qty > 0 || t.item === 'diesel'),
  ]);
}
function boardPoint(e: Equipment) {
  return localPoint({ ...e, yaw: e.yaw ?? (e.heading * Math.PI) / 2 }, -0.2, 1.85);
}
function reserve(s: State, o: Order, e: Equipment, w: Worker) {
  if (w.vehicle && w.vehicle !== e.id) leaveMachine(s, w);
  e.deliveryOrder = o.id;
  w.deliveryOrder = o.id;
  w.status = 'Walking to machine';
  o.operatorId = w.id;
}
function release(s: State, o: Order, api: DeliveryAPI) {
  const t = o.unload;
  if (t) {
    const e = s.equipment.find((e) => e.id === t.equipmentId),
      w = s.workers.find((w) => w.id === t.operatorId),
      r = s.workers.find((w) => w.id === t.riggerId);
    if (e) {
      e.deliveryOrder = undefined;
      e.reverse = false;
      e.work = 0;
      e.lift = 0.12;
      e.reach = 2.7;
    }
    if (w) {
      noteWorkerAssignment(s,w,{equipmentId:e?.id,workId:o.id});
      w.deliveryOrder = undefined;
      w.status = 'Available in cab';
    }
    if (r) {
      noteWorkerAssignment(s,r,{equipmentId:e?.id,workId:o.id});
      r.deliveryOrder = undefined;
      r.status = 'Available';
    }
  }
  o.unload = undefined;
  o.allocated = undefined;
  o.cargoQty = undefined;
}
function finish(s: State, o: Order, api: DeliveryAPI) {
  o.automaticEquipment = undefined;
  if (o.railFreight?.detached) {
    o.railFreight.unloadRequested=false;
    o.note='Empty cars awaiting assembly and mainline collection';
    if(!s.events.some(e=>e.entity===o.id&&e.text==='All freight cargo received; empty cars retained for return.')) {
      api.event(s,'Delivery',o.id,'All freight cargo received; empty cars retained for return.');
      api.notice(s,'Freight unloading complete',`${o.id}: assemble empty cars on the receiving siding and request mainline pickup.`,o.id);
    }
    return;
  }
  o.status = 'departing';
  o.note =
    o.mode === 'rail'
      ? 'Received; train reversing out'
      : deliveryKind(o) === 'bus'
        ? 'Passengers clear; bus continuing forward'
        : 'Received; carrier leaving via exit aisle';
  o.stage = 0;
  if (o.drive) {
    o.drive.velocity = 0;
    o.drive.reverse = o.mode === 'rail';
    o.drive.gearPause = 0.6;
    o.drive.yardPermit = undefined;
  }
  api.event(
    s,
    'Delivery',
    o.id,
    o.commute
      ? `Shift bus ${o.commute.direction}: ${o.qty} passengers boarded/alighted.`
      : `Received ${orderDescription(o)} using site resources.`,
  );
  api.notice(
    s,
    o.commute ? 'Shift bus departing' : 'Delivery received',
    o.commute
      ? `${o.qty} workers · ${o.commute.direction}`
      : `${orderDescription(o)} received and recorded.`,
    o.id,
  );
}
function waiting(s: State, o: Order, message: string, code: string, api: DeliveryAPI) {
  o.note = message;
  o.notifiedBlocks ??= [];
  if (!o.notifiedBlocks.includes(code)) {
    o.notifiedBlocks.push(code);
    api.notice(s, 'Delivery waiting', `${o.id}: ${message}.`, o.id);
    api.event(s, 'Delivery', o.id, message);
  }
}
/** Between lifts the carrier still owns its receiving machine; cargo ownership
 * itself remains on the active UnloadTask until physical withdrawal completes. */
export function equipmentReservedForDelivery(s: State, e: Equipment, ignoreOrder?: string) {
  return s.orders.some(
    (o) =>
      o.id !== ignoreOrder &&
      o.status === 'unloading' &&
      o.arrived < o.qty &&
      o.automaticEquipment === e.id,
  );
}
function materialMachine(s: State, o: Order, preferred?: string, manual = false) {
  const mass = MATERIALS[selectedPendingLine(o)!.item as Item].mass;
  const qualified = (e: Equipment) =>
    !collectionOwnsEquipment(s, e.id) &&
    (!equipmentHasAssignedWork(s, e) ||
      equipmentCanReceiveRailSupply(s, e, selectedPendingLine(o)!.item as Item)) &&
    !e.transportOrder &&
    !e.deliveryOrder &&
    !e.job &&
    !e.refueling &&
    !e.cargo &&
    equipmentAllows(e, 'receiving') &&
    e.fuel > 0.5 &&
    EQUIPMENT[e.kind].capacity >= mass;
  const ready = (e: Equipment) =>
    !e.path.length && !e.trafficGoal && !['boarding', 'driving', 'aligning'].includes(e.parkingState || '');
  if (!manual && o.automaticEquipment) {
    const owner = s.equipment.find((e) => e.id === o.automaticEquipment),
      operator = owner && qualified(owner) ? freeOperator(s, owner, preferred) : undefined;
    if (owner && operator) return ready(owner) ? { e: owner, w: operator } : undefined;
    // Never reached for an active lift: startUnloading is only called after release.
    // Role, fuel, shift or explicit assignment changes therefore hand off supported freight.
    o.automaticEquipment = undefined;
  }
  const machines = s.equipment.filter(
    (e) => !actionClearanceHoldsEquipment(s,e.id) && qualified(e) && ready(e) && (manual || !equipmentReservedForDelivery(s, e, o.id)),
  );
  // Nearby feasible equipment and its real operator beat a distant machine.
  // A small forklift handling preference breaks close choices, never a yard-wide trip.
  const selected = manual ? s.workers.find((w) => w.id === preferred)?.vehicle : undefined;
  const carrier = freightPose(o);
  return machines
    .map((e) => ({ e, w: freeOperator(s, e, preferred) }))
    .filter(
      (pair): pair is { e: Equipment; w: Worker } =>
        !!pair.w && (!manual || pair.w.id === preferred),
    )
    .sort(
      (a, b) =>
        Number(b.e.id === selected) - Number(a.e.id === selected) ||
        dist(a.e, carrier) +
          (a.w.vehicle === a.e.id ? 0 : dist(a.w, a.e) * 0.6) +
          (a.e.kind === 'forklift' ? 0 : 5) -
          (dist(b.e, carrier) +
            (b.w.vehicle === b.e.id ? 0 : dist(b.w, b.e) * 0.6) +
            (b.e.kind === 'forklift' ? 0 : 5)),
    )[0];
}
function* storageDockCandidates(
  s: State,
  from: Point,
  r: Rect,
  e: Equipment,
  api: DeliveryAPI,
  clearance = constructionStorageClearance(s),
) {
  const c = center(r),
    reach = Math.ceil(r.d / 2 + 1.55);
  const obs = api.obstacles(s);
  for (const side of [-1, 1]) {
    const p = { x: c.x, z: c.z + side * reach },
      yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const back = localPoint({ ...p, yaw }, -2.8, 0);
    const envelopes = [p, back].flatMap((point) =>
      equipmentBoxes({ ...e, reach }, { ...point, yaw }).map((b) => boxRect(b, 0.18)),
    );
    const left = Math.min(...envelopes.map((b) => b.x)),
      top = Math.min(...envelopes.map((b) => b.z));
    const maneuver = {
      x: left,
      z: top,
      w: Math.max(...envelopes.map((b) => b.x + b.w)) - left,
      d: Math.max(...envelopes.map((b) => b.z + b.d)) - top,
    };
    if (clearance.some((area) => overlap(area, maneuver))) continue;
    if (equipmentMoveBlocked(s, { ...e, reach }, { ...p, yaw })) continue;
    const path = route(from, p, obs, 1.1);
    if (path) yield { p, yaw, path, reach };
  }
}
function storageDock(
  s: State,
  from: Point,
  r: Rect,
  e: Equipment,
  api: DeliveryAPI,
  clearance = constructionStorageClearance(s),
) {
  return storageDockCandidates(s, from, r, e, api, clearance).next().value || null;
}
const isRailStock = (item: string) => item === 'rail' || item.startsWith('rail');

/** Screen future storage footprints without running path searches for every
 * cell. Keep at least one physical lifting face and a place for the rigger. */
export function createRailStorageAccessCheck(
  s: State,
): (item: Item, r: Rect, yaw?: number) => boolean {
  const pending: Stack[] = [];
  for (const o of s.orders) {
    const r = o.allocated || o.unload?.destination;
    const item = o.unload?.item || pendingOrderLine(o)?.item;
    if (!r || !item || !MATERIALS[item as Item] || o.status === 'done') continue;
    pending.push({
      ...r,
      id: `${o.id}-storage`,
      item: item as Item,
      qty: 1,
      reserved: 0,
      source: o.id,
    });
  }
  for (const j of s.jobs) {
    if (j.recoveryStack) pending.push(j.recoveryStack);
    if (j.stockMove && (j.status === 'todo' || j.status === 'doing')) {
      const item = j.item || s.stacks.find((t) => t.id === j.stockMove!.sourceId)?.item;
      if (item)
        pending.push({
          ...j.stockMove.destination,
          id: `${j.id}-storage`,
          item,
          yaw: j.stockMove.yaw,
          qty: 1,
          reserved: 0,
          source: j.id,
        });
    }
  }
  const solids: Rect[] = [...staticObstacleRects(s), ...pending];
  const railStacks = [...s.stacks.filter((t) => t.qty > 0), ...pending].filter((t) =>
    isRailStock(t.item),
  );
  const kinds = (stack: Stack): EquipmentKind[] =>
    (['excavator', 'forklift'] as const).filter(
      (kind) => EQUIPMENT[kind].capacity >= MATERIALS[stack.item].mass,
    );
  const accessible = (stack: Stack, obstacles: Rect[]) =>
    kinds(stack).some((kind) => staticRailPickupFaces(s, stack, kind, obstacles).length > 0);
  const exposed = railStacks.filter((stack) => accessible(stack, solids));
  // Every preview face is within ten meters of its footprint, including the
  // straight withdrawal and chassis. Unrelated yard stock needs no recheck.
  const nearby = (a: Rect, b: Rect) =>
    a.x < b.x + b.w + 10 && a.x + a.w + 10 > b.x && a.z < b.z + b.d + 10 && a.z + a.d + 10 > b.z;
  return (item, r, yaw) => {
    // A queued relocation owns its footprint as well as its loading face.
    // A small parcel must not be dropped inside it before the rail arrives.
    if (pending.some((p) => overlap(p, r))) return false;
    if (!isRailStock(item) && !exposed.some((stack) => nearby(stack, r))) return true;
    const obstacles = [...solids, r];
    if (
      isRailStock(item) &&
      !accessible(
        {
          ...r,
          id: 'storage-preview',
          item,
          yaw:
            yaw ??
            (r.w === MATERIALS[item].d && r.d === MATERIALS[item].w && r.w !== r.d
              ? Math.PI / 2
              : 0),
          qty: 1,
          reserved: 0,
          source: 'preview',
        },
        obstacles,
      )
    )
      return false;
    return exposed.every((stack) => !nearby(stack, r) || accessible(stack, obstacles));
  };
}
export function railStoragePlacementPreservesAccess(
  s: State,
  item: Item,
  r: Rect,
  yaw?: number,
): boolean {
  return createRailStorageAccessCheck(s)(item, r, yaw);
}
function chooseStorage(
  s: State,
  item: Item,
  e: Equipment,
  api: DeliveryAPI,
  storageZoneId?: string,
) {
  const zones = storageZoneId ? s.zones.filter((z) => z.id === storageZoneId) : s.zones;
  const inDestination = (r: Rect) =>
    zones.some((z) => r.x >= z.x && r.z >= z.z && r.x + r.w <= z.x + z.w && r.z + r.d <= z.z + z.d);
  const m = MATERIALS[item];
  const preservesRailAccess = createRailStorageAccessCheck(s);
  const clearance = constructionStorageClearance(s);
  const loaded = { ...e, cargo: { item, qty: 1 } };
  const unavailable = (r: Rect) => clearance.some((area) => overlap(area, r));
  const incoming = (id: string) =>
    incomingRailLayers(s, id) +
    s.jobs
      .filter((j) => j.recoveryStack?.id === id)
      .reduce((n, j) => n + (j.recoveryStack?.qty || 0), 0);
  // Partial stacks are useful physical capacity, including when they came on an earlier truck.
  for (const stack of s.stacks
    .filter(
      (t) =>
        t.item === item &&
        !storageMoveOwnsStack(s,t.id) &&
        !collectionOwnsStack(s,t.id) &&
        (!item.startsWith('rail') || item === 'rail' || (t.trackHand ?? 1) === 1) &&
        inDestination(t) &&
        t.qty > 0 &&
        t.qty + incoming(t.id) < m.max &&
        !railStagingStackOwned(s, t.id) &&
        !unavailable(t) &&
        preservesRailAccess(item, t),
    )
    .sort((a, b) => b.qty - a.qty)) {
    const dock = storageDock(s, e, stack, loaded, api, clearance);
    if (dock)
      return { rect: stack, merge: stack, space: m.max - stack.qty - incoming(stack.id), dock };
  }
  const candidates: Rect[] = [];
  for (const z of zones)
    for (let zz = z.z; zz + m.d <= z.z + z.d; zz++)
      for (let xx = z.x; xx + m.w <= z.x + z.w; xx++) {
        const r = { x: xx, z: zz, w: m.w, d: m.d };
        if (
          s.stacks.some((t) => (t.qty > 0 || t.item === 'diesel') && overlap(t, r)) ||
          s.orders.some((o) => o.allocated && overlap(o.allocated, r)) ||
          s.jobs.some((j) => j.recoveryStack && overlap(j.recoveryStack, r)) ||
          unavailable(r) ||
          s.buildings.some((b) => overlap(b, r))
        )
          continue;
        candidates.push(r);
      }
  // Fill the far side first, leaving the loading face accessible as a dense block grows.
  candidates.sort((a, b) => b.z - a.z || a.x - b.x);
  for (const r of candidates) {
    if (!preservesRailAccess(item, r)) continue;
    const dock = storageDock(s, e, r, loaded, api, clearance);
    if (dock) return { rect: r, space: m.max, dock };
  }
  return null;
}
function riggingPoint(source: Point, item: Item): Point {
  return {
    x: source.x - Math.max(1.6, Math.min(3.4, MATERIALS[item].w / 2 + 0.4)),
    z: source.z + 1.9,
  };
}
function pickupRoute(s: State, e: Equipment, pickup: Point, api: DeliveryAPI) {
  const obstacles = api.obstacles(s);
  for (const reverse of [false, true]) {
    const path = machineRoute(s, { ...e, reverse }, pickup, obstacles, 250, true, -Math.PI / 2);
    if (path) return { path, reverse, retreat: false };
  }
  const path = machineRetreatRoute(s, e, pickup, obstacles, true, -Math.PI / 2);
  return path ? { path, reverse: true, retreat: true } : null;
}
function beginPickupRoute(
  e: Equipment,
  pickup: Point,
  planned: NonNullable<ReturnType<typeof pickupRoute>>,
) {
  e.path = planned.path;
  e.reverse = planned.reverse;
  e.trafficReverse = planned.reverse || undefined;
  e.trafficGoal = planned.retreat ? { ...pickup } : undefined;
  e.trafficYieldEquipment = undefined;
  e.blockedBy = undefined;
  e.trafficWait = 0;
}
function selectedShipmentLots(o: Order) {
  return shipmentLots(o).filter(t=>t.qty>0 && (!o.railFreight?.unloadCarIds || o.railFreight.unloadCarIds.includes(t.carId!)) && !o.railFreight?.cars.find(c=>c.id===t.carId)?.returned);
}
function selectedPendingLine(o: Order) {
  const slot=selectedShipmentLots(o)[0];
  return slot ? {item:slot.item} : pendingOrderLine(o);
}
function startUnloading(s: State, o: Order, api: DeliveryAPI, preferred?: string, manual = false) {
  preferred ??= o.operatorId;
  const slot=selectedShipmentLots(o)[0];
  if(!slot) {if(o.railFreight){o.railFreight.unloadRequested=false;o.note='Selected cars unloaded; choose more cars or arrange return';} return false;}
  const item = slot.item as Item,
    m = MATERIALS[item],
    pair = materialMachine(s, o, preferred, manual);
  if (!pair) {
    waiting(
      s,
      o,
      s.equipment.some((e) => EQUIPMENT[e.kind].capacity >= m.mass) &&
        !s.equipment.some(
          (e) => equipmentAllows(e, 'receiving') && EQUIPMENT[e.kind].capacity >= m.mass,
        )
        ? 'No suitable machine allows receiving — change Automatic work in Equipment'
        : `Waiting for your ${m.mass > 2500 ? 'excavator' : 'forklift or excavator'} and a hired operator`,
      'resources',
      api,
    );
    return false;
  }
  const { e, w } = pair;
  const source = localPoint(freightPose(o, slot.carIndex), slot.x, slot.z);
  const assignedAssistant = equipmentAssistant(s, e.id);
  const rigger =
    e.kind === 'excavator'
      ? assignedAssistant
        ? availableEquipmentAssistant(s, e.id)
        : selectWorker(s,[riggingPoint(source,item)],{equipmentId:e.id,workId:o.id,eligible:r=>r.role!=='operator'&&workerSupportsEquipment(r,e.id),route:(r,p)=>walkingRoute(s,r,p,api)})?.worker
      : undefined;
  if (e.kind === 'excavator' && !rigger) {
    waiting(
      s,
      o,
      equipmentAssistantReason(s, e.id) || 'Waiting for a reachable site worker to rig the excavator lift',
      'rigger',
      api,
    );
    return false;
  }
  const dest = chooseStorage(s, item, e, api, o.railFreight?.storageZoneId);
  if (!dest) {
    waiting(
      s,
      o,
      s.zones.length
        ? 'No reachable storage position or stack capacity'
        : 'No stockyard — designate a storage area',
      'storage',
      api,
    );
    return false;
  }
  const qty = Math.min(slot.qty, dest.space, Math.floor(EQUIPMENT[e.kind].capacity / m.mass));
  const pickup = {
    x: source.x,
    z:
      source.z +
      Math.max(e.kind === 'excavator' ? (m.d < 2 ? 4.6 : 4) : 3.85, Math.ceil(m.d / 2 + 1.55)),
  };
  const approachPath = pickupRoute(s, e, pickup, api);
  const walkingFrom =
    w.vehicle && w.vehicle !== e.id ? machineStep(s.equipment.find((q) => q.id === w.vehicle)!) : w;
  const workerPath =
    w.vehicle === e.id ? [] : route(walkingFrom, boardPoint(e), api.obstacles(s), 0.15);
  if (!approachPath || !workerPath) {
    waiting(s, o, 'Machine or operator cannot reach the unloading face', 'approach', api);
    return false;
  }
  const sourceY = (o.mode === 'rail' ? 1.3 : 1.15) + (slot.qty - qty) * parcelPitch(item);
  const riggerPath = rigger ? walkingRoute(s, rigger, riggingPoint(source, item), api) : [];
  if (!riggerPath) {
    o.note = 'Rigging worker cannot reach the lift';
    return false;
  }
  o.unload = {
    item,
    lineIndex: slot.lineIndex,
    carId: slot.carId,
    carLineIndex: slot.carLineIndex,
    equipmentId: e.id,
    operatorId: w.id,
    riggerId: rigger?.id,
    phase: 'boarding',
    clock: 0,
    qty,
    mergeId: dest.merge?.id,
    source,
    sourceY,
    sourceYaw: 0,
    pickup,
    destination: { ...dest.rect },
    drop: dest.dock.p,
    dropYaw: dest.dock.yaw,
    destinationY: dest.merge
      ? (dest.merge.baseHeight || 0) + dest.merge.qty * parcelPitch(item)
      : 0,
  };
  noteWorkerAssignment(s,w,{equipmentId:e.id,workId:o.id});
  if(rigger)noteWorkerAssignment(s,rigger,{equipmentId:e.id,workId:o.id});
  o.allocated = { ...dest.rect };
  o.automaticEquipment = e.id;
  if (manual) {
    for (const other of s.orders)
      if (other.id !== o.id && !other.unload && other.automaticEquipment === e.id)
        other.automaticEquipment = undefined;
  }
  reserve(s, o, e, w);
  w.path = workerPath;
  if (rigger) {
    rigger.deliveryOrder = o.id;
    rigger.path = riggerPath || [];
    rigger.status = 'Walking to rig lift';
    api.event(
      s,
      'Dispatch',
      rigger.id,
      `Walking to assist ${e.id} with ${o.id} while its operator approaches.`,
    );
  }
  o.note = `${w.name} preparing ${e.id} to unload`;
  s.revision++;
  return true;
}
export function requestUnloading(s: State, oid: string, wid: string, api: DeliveryAPI) {
  const o = s.orders.find((o) => o.id === oid),
    w = s.workers.find((w) => w.id === wid);
  if (!o || o.status !== 'unloading') return 'Select a delivery waiting at its berth.';
  if (o.railFreight && !o.railFreight.unloadRequested)
    return 'Choose the destination stockyard and click Start unloading before assigning an operator.';
  if (!w || w.role !== 'operator' || w.job || w.deliveryOrder || w.transportOrder || w.transition)
    return 'Choose an available equipment operator.';
  if (o.item in EQUIPMENT) {
    if (o.deployment !== 'waiting') return 'Equipment deployment is already assigned.';
    o.operatorId = w.id;
    equipmentTick(s, o, 0, api);
    return o.deployment === 'waiting' ? o.note : '';
  }
  if (!(o.item in MATERIALS)) return 'This delivery does not need a machine operator.';
  if (o.unload) return 'Unloading is already assigned.';
  return startUnloading(s, o, api, wid, true) ? '' : o.note;
}
function cargoFollow(t: UnloadTask, e: Equipment, y: number) {
  const p = localPoint({ ...e, yaw: e.yaw || 0 }, e.reach || 3, 0);
  t.cargo = { ...p, y, yaw: (e.yaw || 0) + Math.PI / 2 };
}
/** Carry poses must follow the chassis after the movement pass, not one tick behind it. */
export function syncDeliveryCargo(s: State) {
  for (const o of s.orders) {
    const t = o.unload;
    if (!t?.cargo || !['clear', 'carry'].includes(t.phase)) continue;
    const e = s.equipment.find((e) => e.id === t.equipmentId);
    if (e?.cargo) cargoFollow(t, e, t.cargo.y);
  }
}
function loadedStorageRoute(
  s: State,
  e: Equipment,
  drop: Point,
  api: DeliveryAPI,
  finalYaw: number,
) {
  const obstacles = api.obstacles(s);
  // Arrival must leave room for the complete final turn. A centerline-only
  // route can reach a dock yet trap the loaded machine facing the wrong way.
  for (const reverse of [false, true]) {
    const path = machineRoute(s, { ...e, reverse }, drop, obstacles, 250, true, finalYaw);
    if (path) return { path, reverse };
  }
  // A stopped, angled chassis may need a short reverse withdrawal before a
  // forward approach is possible. Verify both legs, but commit only the actual
  // retreat; the retained task replans its aligned final leg once it is clear.
  const retreat = machineRetreatRoute(s, e, drop, obstacles, true, finalYaw);
  return retreat ? { path: retreat, reverse: true } : null;
}
function loadedStorageApproach(s: State, e: Equipment, t: UnloadTask, api: DeliveryAPI) {
  const receiving = s.stacks.find((stack) => stack.id === t.mergeId);
  const shapedRail = e.cargo?.item.startsWith('rail') && e.cargo.item !== 'rail';
  const matchingBearing = (yaw: number) =>
    !receiving || !shapedRail ||
    Math.abs(angleDelta(receiving.yaw || 0, yaw + Math.PI / 2)) < 0.01;
  const current = matchingBearing(t.dropYaw)
    ? loadedStorageRoute(s, e, t.drop, api, t.dropYaw)
    : null;
  if (current) return current;
  // A late obstacle can invalidate the selected face while another face of
  // the same reserved footprint remains usable. Do not commit a new dock
  // until its loaded travel and complete final turn both fit.
  for (const dock of storageDockCandidates(s, e, t.destination, e, api)) {
    if (dist(dock.p, t.drop) < 0.1 || !matchingBearing(dock.yaw)) continue;
    const alternate = loadedStorageRoute(s, e, dock.p, api, dock.yaw);
    if (!alternate) continue;
    t.drop = dock.p;
    t.dropYaw = dock.yaw;
    return alternate;
  }
  return null;
}
function loadedRouteBlocked(s: State, o: Order, e: Equipment, t: UnloadTask) {
  const blocker = equipmentMoveBlocked(
    s,
    { ...e, reach: dist(t.drop, center(t.destination)) },
    { ...t.drop, yaw: t.dropYaw },
  );
  e.blockedBy = blocker || undefined;
  // Empty-path searches do not pass through tickMove's retry throttle.
  // The same timer is safe here: normal movement owns it again once a real
  // path is accepted, and no physical payload pose is changed by waiting.
  e.trafficRetry = s.elapsed + 1.5;
  o.note = `No clear loaded route to ${t.mergeId || 'storage'} at (${t.drop.x.toFixed(1)}, ${t.drop.z.toFixed(1)})${blocker ? `; blocked by ${blocker}` : '; clear the approach aisle'}`;
  deliveryBlockageNotice(s, o, o.note);
}
function blockedTurnMessage(s: State, blocker: string) {
  const fixed =
    s.stacks.some((t) => t.id === blocker) ||
    s.buildings.some((b) => b.id === blocker) ||
    s.rails.some((r) => r.id === blocker) ||
    blocker === 'BUFFER-001';
  return fixed
    ? `Turning space obstructed by ${blocker}; checking a clear reapproach. Pause unloading to drive clear if needed`
    : `Waiting for ${blocker} to clear the turning area`;
}
function retryAlignedApproach(
  s: State,
  o: Order,
  e: Equipment,
  target: Point,
  yaw: number,
  api: DeliveryAPI,
  storage?: UnloadTask,
) {
  if (s.elapsed < (e.trafficRetry || 0)) return;
  e.trafficRetry = s.elapsed + 1.5;
  const planned = storage
    ? loadedStorageApproach(s, e, storage, api)
    : loadedStorageRoute(s, e, target, api, yaw);
  if (!planned?.path.length) return;
  clearActionClearance(s, o.id);
  resumeLoadedRoute(e, planned);
  o.note = `Reapproaching the handling dock with ${e.id} to align before placement`;
}
function resumeLoadedRoute(
  e: Equipment,
  planned: NonNullable<ReturnType<typeof loadedStorageRoute>>,
) {
  e.path = planned.path;
  e.reverse = planned.reverse;
  e.trafficReverse = planned.reverse || undefined;
  e.trafficGoal = undefined;
  e.trafficYieldEquipment = undefined;
  e.blockedBy = undefined;
  e.trafficWait = 0;
}
function unloadTick(s: State, o: Order, dt: number, api: DeliveryAPI) {
  if (o.unloadPaused) return;
  if (!o.unload) {
    if (o.arrived >= o.qty) {
      finish(s, o, api);
      return;
    }
    if ((o.retryAt || 0) > s.elapsed) return;
    o.retryAt = s.elapsed + 2;
    startUnloading(s, o, api);
    return;
  }
  const t = o.unload,
    e = s.equipment.find((e) => e.id === t.equipmentId)!,
    w = s.workers.find((w) => w.id === t.operatorId)!,
    r = s.workers.find((w) => w.id === t.riggerId),
    item = t.item || (o.item as Item);
  if (!e || !w) {
    o.note = 'Assigned machine or operator missing';
    return;
  }
  if (e.velocity && e.velocity > 0.01 && !e.blockedBy) resetDeliveryBlockage(s, o);
  else if (e.blockedBy) deliveryBlockageNotice(s, o, `Route blocked by ${e.blockedBy}`);
  if (e.fuel <= 0 || e.refueling) {
    o.note = 'Unloading paused: machine needs fuel';
    return;
  }
  const set = (phase: UnloadTask['phase']) => {
    t.phase = phase;
    t.clock = 0;
  };
  t.clock += dt;
  if (t.phase === 'boarding') {
    if (w.path.length || w.transition) {
      t.clock = 0;
      return;
    }
    if (!w.vehicle) {
      const f = smoothstep(t.clock / 1.4),
        p = boardPoint(e);
      w.x = p.x + (e.x - p.x) * f;
      w.z = p.z + (e.z - p.z) * f;
      w.y = (e.y || 0) + f * 0.7;
      w.status = 'Climbing into machine';
      if (t.clock < 1.4) return;
      w.vehicle = e.id;
      e.operator = w.id;
    }
    if (s.elapsed < (e.trafficRetry || 0)) return;
    const planned = pickupRoute(s, e, t.pickup, api);
    if (!planned) {
      e.trafficRetry = s.elapsed + 1.5;
      o.note = 'No clear machine route to the unloading face; checking again';
      deliveryBlockageNotice(s, o, o.note);
      return;
    }
    beginPickupRoute(e, t.pickup, planned);
    w.status = 'Driving to unload';
    set('approach');
  } else if (t.phase === 'approach') {
    o.note = e.blockedBy
      ? `Route to unloading face blocked by ${e.blockedBy}; checking a safe maneuver`
      : e.trafficGoal
        ? `${w.name} backing ${e.id} clear before driving to the load`
        : `${w.name} driving ${e.id} to the load`;
    if (e.path.length || e.trafficGoal) return;
    if (dist(e, t.pickup) > 0.15) {
      if (s.elapsed < (e.trafficRetry || 0)) return;
      e.trafficRetry = s.elapsed + 1.5;
      const planned = pickupRoute(s, e, t.pickup, api);
      if (planned) beginPickupRoute(e, t.pickup, planned);
      else {
        o.note = 'No clear machine route to the unloading face; checking again';
        deliveryBlockageNotice(s, o, o.note);
      }
      return;
    }
    const candidate = { ...e };
    const aligned = turn(candidate, -Math.PI / 2, dt, 1.2);
    const blocker = equipmentSweepBlocked(s, e, candidate);
    if (blocker) {
      e.blockedBy = blocker;
      o.note = blockedTurnMessage(s, blocker);
      requestActionClearance(s,{ownerId:o.id,requesterEquipmentId:e.id,blockerId:blocker,action:"Align for unloading",envelopes:[...equipmentBoxes(e),...equipmentBoxes(e,candidate)]});
      retryAlignedApproach(s, o, e, t.pickup, -Math.PI / 2, api);
      return;
    }
    e.yaw = candidate.yaw;
    e.blockedBy = undefined;
    if (!aligned) return;
    if (r) {
      const path = walkingRoute(s, r, riggingPoint(t.source, item), api);
      if (!path) {
        o.note = 'Waiting for a clear walking route to attach the load';
        return;
      }
      r.yieldingTo = undefined;
      r.yieldTarget = undefined;
      r.path = path;
      r.status = 'Walking to rig lift';
    }
    e.reach = dist(e, t.source);
    e.lift = t.sourceY;
    e.work = 1;
    set('rig');
  } else if (t.phase === 'rig') {
    o.note =
      e.kind === 'excavator'
        ? `${r?.name} attaching lifting slings`
        : `${w.name} raising and engaging forks`;
    if (r?.path.length) {
      if (!t.rigged) t.clock = 0;
      return;
    }
    if (t.clock < 2.5) return;
    if (r && r.status !== 'Clear of lift') {
      const path = walkingRoute(s, r, { x: t.pickup.x - 3, z: t.pickup.z + 1.5 }, api);
      if (!path) {
        o.note = 'Waiting for the rigging worker to clear the lift';
        return;
      }
      r.yieldingTo = undefined;
      r.yieldTarget = undefined;
      r.path = path;
      r.status = 'Clear of lift';
      t.rigged = true;
      return;
    }
    e.cargo = { item, qty: t.qty };
    o.arrived += t.qty;
    if (o.manifest) o.manifest[t.lineIndex!].arrived += t.qty;
    if (t.carId && o.railFreight) {
      const car = o.railFreight.cars.find((c) => c.id === t.carId)!;
      car.manifest[t.carLineIndex!].arrived += t.qty;
    }
    t.cargo = { ...t.source, y: t.sourceY, yaw: t.sourceYaw };
    api.movement(s, item, t.qty, o.id, e.id, 'Unloaded onto site equipment');
    set('lift');
    s.revision++;
  } else if (t.phase === 'lift') {
    t.cargo = { ...t.source, y: t.sourceY + smoothstep(t.clock / 2.5) * 0.42, yaw: 0 };
    e.lift = t.cargo.y;
    o.note = 'Lifting clear of the deck';
    if (t.clock < 2.5) return;
    if (r) {
      r.deliveryOrder = undefined;
      r.status = 'Available';
      t.riggerId = undefined;
    }
    const m = MATERIALS[item],
      sweep = Math.hypot((e.reach || 3) + m.d / 2, m.w / 2);
    const withdrawal = Math.max(3, Math.ceil(sweep + 1.5 - (e.reach || 3)));
    e.reverse = true;
    e.path = [{ x: e.x, z: e.z + withdrawal }];
    set('clear');
    if (o.arrived >= o.qty && o.status === 'unloading') {
      finish(s, o, api);
      api.event(
        s,
        'Transport',
        o.id,
        'Last parcel lifted clear; carrier released while site placement continues.',
      );
    }
  } else if (t.phase === 'clear') {
    cargoFollow(t, e, t.sourceY + 0.42);
    e.lift = t.cargo!.y;
    if (e.path.length || e.trafficGoal) {
      o.note = 'Backing clear of the carrier';
      return;
    }
    // The carrier pickup can require a longer reach than the storage dock.
    // Retract the real supported load before asking whether its arrival turn
    // fits; otherwise planning can wait forever for the carry phase that would
    // have performed this retraction. Check every physical carriage movement.
    const travelReach = e.kind === 'forklift'
      ? FORK_LOAD_CENTER
      : dist(t.drop, center(t.destination));
    if ((e.reach || 3) > travelReach + 0.001) {
      const nextReach = Math.max(travelReach, (e.reach || 3) - dt * 0.8);
      const blocker = equipmentReachBlocked(s, e, nextReach);
      if (blocker) {
        e.blockedBy = blocker;
        o.note = `Waiting for ${blocker} to clear the reach carriage`;
        return;
      }
      e.reach = nextReach;
      cargoFollow(t, e, t.sourceY + 0.42);
      o.note = 'Retracting the supported load before the storage trip';
      if (nextReach > travelReach + 0.001) return;
    }
    if (s.elapsed < (e.trafficRetry || 0)) return;
    e.reverse = false;
    // A long panel is carried across the machine's heading. Inflating every
    // obstacle by half its width wrongly blocks the valid top-up dock beside
    // its own partial stack. Replay the actual chassis, tools, and load instead.
    const planned = loadedStorageApproach(s, e, t, api);
    if (!planned) {
      loadedRouteBlocked(s, o, e, t);
      return;
    }
    clearActionClearance(s, o.id);
    resumeLoadedRoute(e, planned);
    o.note = `${w.name} hauling to storage`;
    set('carry');
  } else if (t.phase === 'carry') {
    const transitHeight = Math.max(0.4, t.destinationY + 0.35);
    const y = t.sourceY + 0.42 + (transitHeight - t.sourceY - 0.42) * smoothstep(t.clock / 3);
    // The carrier and storage docks have different working reaches. Retract
    // continuously while carrying; changing reach only at setdown snaps cargo.
    const dropReach = dist(t.drop, center(t.destination));
    // Bring the center of the load back toward the mast while traveling. Reach
    // out again only after arriving at the storage dock, never along the route.
    const targetReach =
      e.kind === 'forklift' && dist(e, t.drop) > 0.15 ? FORK_LOAD_CENTER : dropReach;
    const nextReach =
      (e.reach || 3) + Math.max(-dt * 0.8, Math.min(dt * 0.8, targetReach - (e.reach || 3)));
    const reachBlocker = equipmentReachBlocked(s, e, nextReach);
    if (!reachBlocker) e.reach = nextReach;
    else {
      e.blockedBy = reachBlocker;
      o.note = `Waiting for ${reachBlocker} to clear the reach carriage`;
      requestActionClearance(s,{ownerId:o.id,requesterEquipmentId:e.id,blockerId:reachBlocker,action:"Move loaded reach carriage",envelopes:[...equipmentBoxes(e),...equipmentBoxes({...e,reach:nextReach})]});
    }
    cargoFollow(t, e, y);
    e.lift = y;
    if (!e.path.length && dist(e, t.drop) > 0.025) {
      // Finishing a traffic escape is not arrival at the storage dock. Its
      // return route may have failed while another actor occupied the dock.
      // Retry the real loaded trip instead of turning and lowering remotely.
      if (s.elapsed < (e.trafficRetry || 0)) return;
      const planned = loadedStorageApproach(s, e, t, api);
      if (planned) {
        clearActionClearance(s, o.id);
        resumeLoadedRoute(e, planned);
        o.note = `${w.name} resuming the loaded trip to storage`;
      } else loadedRouteBlocked(s, o, e, t);
      return;
    }
    o.note = reachBlocker
      ? `Waiting for ${reachBlocker} to clear the reach carriage`
      : `${w.name} hauling to storage`;
    if (
      !e.trafficGoal &&
      (e.trafficWait || 0) > 2 &&
      s.elapsed >= (o.retryAt || 0) &&
      equipmentMoveBlocked(
        s,
        { ...e, reach: dist(t.drop, center(t.destination)) },
        { ...t.drop, yaw: t.dropYaw },
      )
    ) {
      // Movement has its own retry clock; do not let it starve this check,
      // or run complete approach searches on every blocked simulation tick.
      o.retryAt = s.elapsed + 1.5;
      const planned = loadedStorageApproach(s, e, t, api);
      if (planned) {
        clearActionClearance(s, o.id);
        resumeLoadedRoute(e, planned);
      }
    }
    if (e.path.length) return;
    const candidate = { ...e };
    const aligned = turn(candidate, t.dropYaw, dt, 1.2);
    const blocker = equipmentSweepBlocked(s, e, candidate);
    if (blocker) {
      e.blockedBy = blocker;
      o.note = blockedTurnMessage(s, blocker);
      requestActionClearance(s,{ownerId:o.id,requesterEquipmentId:e.id,blockerId:blocker,action:"Align delivery setdown",envelopes:[...equipmentBoxes(e),...equipmentBoxes(e,candidate)]});
      retryAlignedApproach(s, o, e, t.drop, t.dropYaw, api, t);
      return;
    }
    e.yaw = candidate.yaw;
    e.blockedBy = undefined;
    cargoFollow(t, e, y);
    if (
      !aligned ||
      reachBlocker ||
      Math.abs((e.reach || 3) - dropReach) > 0.005 ||
      dist(t.cargo!, center(t.destination)) >= 0.025
    )
      return;
    e.reach = dist(e, center(t.destination));
    cargoFollow(t, e, y);
    set('lower');
    resetDeliveryBlockage(s, o);
  } else if (t.phase === 'lower') {
    const landing: TrafficBox={...center(t.destination),yaw:t.dropYaw+Math.PI/2,length:MATERIALS[item].w,width:MATERIALS[item].d};
    const blockers=actionEnvelopeBlockers(s,e,[landing]);
    if(blockers.length) {
      t.clock=Math.max(0,t.clock-dt);
      for(const blockerId of blockers)requestActionClearance(s,{ownerId:o.id,requesterEquipmentId:e.id,blockerId,action:"Lower delivery cargo into storage",envelopes:[landing]});
      o.note=`Waiting for ${blockers.join(', ')} to clear the cargo landing footprint`;
      return;
    }
    clearActionClearance(s,o.id);
    const c = center(t.destination),
      raised = Math.max(0.4, t.destinationY + 0.35);
    t.cargo = {
      ...c,
      y: raised + (t.destinationY - raised) * smoothstep(t.clock / 2.5),
      yaw: t.dropYaw + Math.PI / 2,
    };
    e.lift = t.cargo.y;
    o.note = t.mergeId ? 'Placing onto the existing stack' : 'Lowering into the storage cell';
    if (t.clock < 2.5) return;
    set('release');
  } else if (t.phase === 'release') {
    if (t.clock < 1) return;
    let stack = s.stacks.find((q) => q.id === t.mergeId);
    if (stack) {
      if (item.startsWith('rail')) appendRailLayers(stack, Array(t.qty).fill(null));
      else stack.qty += t.qty;
    } else {
      stack = {
        ...t.destination,
        id: api.id(s, 'stack'),
        item,
        qty: t.qty,
        reserved: 0,
        source: o.id,
        yaw: t.dropYaw + Math.PI / 2,
      };
      if (item === 'diesel') stack.liters = 200;
      if (item === 'cableReel') stack.cableMeters = 50;
      s.stacks.push(stack);
    }
    api.movement(
      s,
      item,
      t.qty,
      e.id,
      stack.id,
      t.mergeId ? 'Topped up existing stack' : 'Placed in storage',
    );
    e.cargo = undefined;
    t.cargo = undefined;
    e.reverse = true;
    e.path = [localPoint({ ...e, yaw: e.yaw || 0 }, -2.8, 0)];
    set('back-away');
    s.revision++;
  } else if (t.phase === 'back-away') {
    o.note = 'Withdrawing forks / lifting tackle';
    if (e.path.length || e.trafficGoal) return;
    release(s, o, api);
    if(o.railFreight?.unloadCarIds && !selectedShipmentLots(o).length){o.railFreight.unloadRequested=false;o.note='Selected cars unloaded; ready for shunting or return';}
    if (o.arrived >= o.qty) {
      if (o.status === 'unloading') finish(s, o, api);
      else if (o.carrierDeparted) {
        o.status = 'done';
        o.note = 'Delivery complete; all freight placed in storage';
      }
    }
  }
}
function purchasedMachine(s: State, o: Order, api: DeliveryAPI) {
  if (o.equipmentId) return;
  const kind = o.item as Equipment['kind'];
  const e: Equipment = {
    id: api.id(s, 'equipment'),
    kind,
    workRole: 'all',
    x: o.vehicle.x,
    z: o.vehicle.z,
    path: [],
    fuel: EQUIPMENT[kind].tank,
    tank: EQUIPMENT[kind].tank,
    used: 0,
    heading: 0,
    work: 0,
    transportOrder: o.id,
  };
  s.equipment.push(e);
  o.equipmentId = e.id;
  o.deployment = 'waiting';
  s.revision++;
}
function rampHeight(x: number) {
  return x >= -5.25 ? 0.82 : Math.max(0, 0.82 * (1 + (x + 5.25) / 4.5));
}
export function rampSupportPose(kind: Equipment['kind'], x: number) {
  if (kind === 'excavator') {
    const rear = rampHeight(x - 1.65),
      front = rampHeight(x + 1.65);
    return { y: (rear + front) / 2, pitch: Math.atan2(front - rear, 3.3) };
  }
  // Solve both wheel contacts, including their unequal radii and asymmetric wheelbase.
  const height = (angle: number, a: number, r: number) => {
    const worldX = x + a * Math.cos(angle) - r * Math.sin(angle);
    return rampHeight(worldX) + r - a * Math.sin(angle) - r * Math.cos(angle);
  };
  let lo = 0,
    hi = 0.35;
  for (let i = 0; i < 25; i++) {
    const angle = (lo + hi) / 2;
    if (height(angle, 0.78, 0.41) > height(angle, -1.05, 0.32)) lo = angle;
    else hi = angle;
  }
  const pitch = (lo + hi) / 2;
  return { y: height(pitch, -1.05, 0.32), pitch };
}
function equipmentTick(s: State, o: Order, dt: number, api: DeliveryAPI) {
  const e = s.equipment.find((e) => e.id === o.equipmentId)!;
  const b = berth(o);
  let w = s.workers.find((w) => w.id === o.operatorId);
  o.deploymentClock = (o.deploymentClock || 0) + dt;
  const set = (phase: Order['deployment']) => {
    o.deployment = phase;
    o.deploymentClock = 0;
  };
  if (o.deployment === 'waiting') {
    const foot=localPoint(b,-11.5,1.8);
    w = freeOperator(s, undefined, o.operatorId,foot);
    if (!w) {
      waiting(s, o, 'Waiting for your hired operator to drive the machine off', 'operator', api);
      return;
    }
    const from = w.vehicle ? machineStep(s.equipment.find((q) => q.id === w!.vehicle)!) : w,
      path = route(from, foot, api.obstacles(s), 0.15);
    if (!path) {
      o.note = 'Operator cannot reach the lowloader ramp';
      return;
    }
    reserve(s, o, e, w);
    noteWorkerAssignment(s,w,{equipmentId:e.id,workId:o.id});
    w.path = path;
    set('walk');
  } else if (o.deployment === 'walk') {
    if (!w || w.path.length || w.transition) return;
    o.ramp = Math.min(1, (o.ramp || 0) + dt * 0.35);
    w.status = 'Lowering lowloader ramps';
    if (o.ramp < 1) return;
    set('climb');
  } else if (o.deployment === 'climb') {
    if (!w) return;
    const t = smoothstep((o.deploymentClock || 0) / 5),
      p = localPoint(b, -11.5 + 10 * t, 1.1 * (1 - t));
    w.x = p.x;
    w.z = p.z;
    w.y = rampHeight(-11.5 + 10 * t);
    w.status = 'Walking up ramp to machine';
    if (t < 1) return;
    set('board');
  } else if (o.deployment === 'board') {
    if (!w) return;
    w.y = 0.82 + Math.min(1, (o.deploymentClock || 0) / 1.5) * 0.7;
    w.status = 'Climbing into delivered machine';
    if ((o.deploymentClock || 0) < 1.5) return;
    w.vehicle = e.id;
    e.operator = w.id;
    set('offload');
  } else if (o.deployment === 'offload') {
    if (!w) return;
    const t = smoothstep((o.deploymentClock || 0) / 16),
      x = -1.5 - 12 * t,
      p = localPoint(b, x, 0);
    const blocker = equipmentSweepBlocked(s, e, { ...p, yaw: b.yaw });
    if (blocker) {
      o.deploymentClock = Math.max(0, (o.deploymentClock || 0) - dt);
      e.velocity = 0;
      o.note = `Waiting for ${blocker} to clear the lowloader ramps`;
      return;
    }
    const support = rampSupportPose(e.kind, x);
    e.x = p.x;
    e.z = p.z;
    e.y = support.y;
    e.pitch = support.pitch;
    e.yaw = b.yaw;
    e.travel = -12 * t;
    e.velocity = t < 1 ? 0.75 : 0;
    e.reverse = true;
    const used = Math.min(e.fuel, dt * 0.008);
    e.fuel -= used;
    e.used += used;
    w.x = e.x;
    w.z = e.z;
    o.note = `${w.name} reversing ${e.id} down the ramps`;
    if (t < 1) return;
    e.transportOrder = undefined;
    e.y = 0;
    e.pitch = 0;
    e.reverse = false;
    let parkingPath: Point[] | undefined;
    // Keep the maneuver clear of the ramp and select an actually free parking
    // footprint; the number of machines says nothing about occupied ground.
    for (const z of [28.5, 35.5, 42.5, 49.5]) {
      for (const x of [6.5, 13.5, 20.5]) {
        const park = { x, z },
          clear = { x, z: e.z };
        if (equipmentMoveBlocked(s, e, { ...park, yaw: Math.PI / 2 })) continue;
        const first = route(e, clear, api.obstacles(s), 2.3),
          last = route(clear, park, api.obstacles(s), 2.3);
        if (first && last) {
          parkingPath = [...first, ...last];
          break;
        }
        const solids = [
          ...s.buildings.filter((b) => !['lamp', 'power', 'water', 'shed', 'engineShed'].includes(b.kind)),
          ...s.stacks.filter((t) => t.qty > 0 || t.item === 'diesel'),
        ];
        const exact = machineRoute(s, e, park, solids);
        if (exact) {
          parkingPath = exact;
          break;
        }
      }
      if (parkingPath) break;
    }
    if (!parkingPath) {
      o.note = 'Waiting for a clear parking space beyond the lowloader';
      return;
    }
    e.path = parkingPath;
    set('park');
    s.revision++;
  } else if (o.deployment === 'park') {
    if (e.path.length) return;
    e.deliveryOrder = undefined;
    e.velocity = 0;
    if (w) {
      w.deliveryOrder = undefined;
      w.status = 'Available in cab';
    }
    o.arrived = 1;
    set('complete');
    api.event(s, 'Asset', e.id, 'Driven off the lowloader by a hired operator.');
    s.revision++;
  } else if (o.deployment === 'complete') {
    o.ramp = Math.max(0, (o.ramp || 0) - dt * 0.35);
    if (o.ramp > 0) return;
    finish(s, o, api);
  }
}
function commuteTick(s: State, o: Order, dt: number, api: DeliveryAPI) {
  const c = o.commute!,
    door = commuteDoor(o);
  const passengers = c.workers.map((id) => s.workers.find((w) => w.id === id)!);
  if (c.direction === 'outbound') {
    for (const w of passengers) {
      if (w.shiftPhase === 'aboard' || w.transportOrder) continue;
      if (!w.path.length && dist(w, door) > 0.12) {
        w.path = walkRoute(s, w, door, api.obstacles(s)) || [];
        w.status = w.path.length ? 'Walking to shift bus' : 'No walking route to shift bus';
      }
      if (w.path.length || w.transition) continue;
      if (dist(w, door) < 0.15 && !c.boarding) {
        c.boarding = { worker: w.id, clock: 0, from: { x: w.x, z: w.z } };
        w.transportOrder = o.id;
        w.status = 'Boarding shift bus';
      }
    }
    if (c.boarding) {
      const b = c.boarding,
        w = s.workers.find((w) => w.id === b.worker)!,
        seat = localPoint({ ...o.vehicle, yaw: o.drive?.yaw || 0 }, 1.35, 0.8);
      b.clock += dt;
      const t = smoothstep(b.clock / 1.6);
      w.x = b.from.x + (seat.x - b.from.x) * t;
      w.z = b.from.z + (seat.z - b.from.z) * t;
      w.y = t * 0.55;
      w.path = [];
      if (t >= 1) {
        w.shiftPhase = 'aboard';
        w.status = 'Riding home';
        c.boarding = undefined;
        o.arrived++;
        s.revision++;
      }
    }
    if (o.arrived >= o.qty) finish(s, o, api);
  } else {
    for (const w of passengers.filter((w) => w.transportOrder === o.id)) {
      w.y = Math.max(0, (w.y || 0) - dt * 0.5);
      w.z += dt * 0.35;
      if (w.y === 0) {
        w.transportOrder = undefined;
        w.shiftPhase = 'working';
        // Site handoff happens only when actually clear of the door.
        w.commuteOrder = undefined;
        w.path =
          walkRoute(s, w, { x: 16.5 + (s.workers.indexOf(w) % 6), z: 23.5 }, api.obstacles(s)) ||
          [];
        w.status = 'Walking to site';
        api.event(s, 'Shift', w.id, 'Arrived by charter bus for scheduled shift.');
        s.revision++;
      }
    }
    o.handling += dt;
    if (o.arrived < o.qty && o.handling >= 2) {
      const w = passengers[o.arrived];
      const p = localPoint({ ...o.vehicle, yaw: o.drive?.yaw || 0 }, 1.35, 1.7);
      w.x = p.x;
      w.z = p.z;
      w.y = 0.5;
      w.path = [];
      w.transportOrder = o.id;
      w.shiftPhase = 'working';
      w.status = 'Stepping off shift bus';
      o.arrived++;
      o.handling = 0;
      s.revision++;
    }
    if (o.arrived >= o.qty && !passengers.some((w) => w.transportOrder === o.id)) finish(s, o, api);
  }
}
function crewTick(s: State, o: Order, dt: number, api: DeliveryAPI) {
  for (const w of s.workers.filter((w) => w.transportOrder === o.id)) {
    w.y = Math.max(0, (w.y || 0) - dt * 0.5);
    w.z += dt * 0.35;
    w.travel = (w.travel || 0) + dt * 0.35;
    if (w.y === 0) {
      w.transportOrder = undefined;
      w.path =
        route(w, { x: 16.5 + (s.workers.indexOf(w) % 6), z: 23.5 }, api.obstacles(s), 0.15) || [];
      w.status = 'Walking to site';
    }
  }
  o.handling += dt;
  if (o.arrived < o.qty && o.handling >= 2) {
    const role = pendingOrderLine(o)!.item as Worker['role'];
    const p = localPoint({ ...o.vehicle, yaw: 0 }, 1.35, 1.7),
      wid = api.id(s, 'worker');
    const w: Worker = {
      id: wid,
      name: `Worker #${s.workers.length + 1}`,
      role,
      x: p.x,
      z: p.z,
      path: [],
      duty: 'auto',
      status: 'Stepping off bus',
      hours: 0,
      wage: ROLES[role].wage,
      heading: 1,
      y: 0.5,
      yaw: Math.PI / 2,
      transportOrder: o.id,
    };
    s.workers.push(w);
    if (o.manifest) pendingOrderLine(o)!.arrived++;
    o.arrived++;
    o.handling = 0;
    s.revision++;
  }
  if (o.arrived >= o.qty && !s.workers.some((w) => w.transportOrder === o.id)) finish(s, o, api);
}
function serviceTick(s: State, o: Order, dt: number, api: DeliveryAPI) {
  const target = { x: o.item === 'power' ? 3 : 6, z: 15 };
  o.contractor ??= {
    ...localPoint({ ...o.vehicle, yaw: o.drive?.yaw || 0 }, 3, 1.85),
    y: 0,
    path: [],
    phase: 'walk',
    clock: 0,
  };
  const c = o.contractor;
  const foot = localPoint({ ...o.vehicle, yaw: o.drive?.yaw || 0 }, 3, 1.85);
  const solids = [
    ...s.buildings.filter((b) => !['lamp', 'power', 'water', 'shed', 'engineShed'].includes(b.kind)),
    ...s.stacks.filter((t) => t.qty > 0 || t.item === 'diesel'),
  ];
  if (c.phase === 'walk') {
    if (!c.path.length && dist(c, target) > 1) {
      c.path = walkRoute(s, c, target, solids) || [];
    }
    if (dist(c, target) < 1) {
      c.phase = 'work';
      c.clock = 0;
    }
  }
  if (c.phase === 'work') {
    c.clock += dt;
    o.note =
      c.clock < 12
        ? 'Utility crew preparing connection'
        : c.clock < 24
          ? 'Installing connection'
          : 'Testing connection';
    if (c.clock < 36) return;
    s.utilities[o.item as 'power' | 'water'] = true;
    s.buildings.push({
      ...target,
      w: 1,
      d: 1,
      id: api.id(s, 'building'),
      kind: o.item as 'power' | 'water',
      rotation: 0,
      connected: true,
      name: label(o.item),
    });
    for (const b of s.buildings)
      if (
        b.kind === 'sanitary' && o.item === 'water'
      )
        b.connected = true;
    o.arrived = o.qty;
    s.revision++;
    c.phase = 'return';
    c.path = walkRoute(s, c, foot, solids) || [];
  }
  if (c.phase === 'return' && !c.path.length) {
    if (dist(c, foot) < 0.12) c.phase = 'seated';
    else {
      c.path = walkRoute(s, c, foot, solids) || [];
      o.note = c.path.length
        ? 'Utility crew returning to van'
        : 'Utility crew waiting for a clear path to the van';
    }
  }
  if (c.phase === 'seated') finish(s, o, api);
}
const crossingArea = { x: -11, z: -4, yaw: 0, length: 20, width: 32 };
/** Automatic ground workers clear the real future carrier corridor on foot. */
function clearCarrierPedestrian(
  s: State,
  o: Order,
  blocked: string,
  pose: Point & { yaw: number },
  api: DeliveryAPI,
) {
  const w = s.workers.find((w) => w.id === blocked);
  if (!w) return;
  const d = (o.drive ??= { distance: 0, velocity: 0, yaw: pose.yaw, travel: 0 });
  if (d.clearanceRequestedFor !== w.id) {
    d.clearanceRequestedFor = w.id;
    api.event(s, 'Traffic', o.id, `${o.id} requests ${w.id} to clear its driving corridor.`);
  }
  const mutualWait = !!w.path.length && w.blockedBy === o.id && (w.trafficWait || 0) >= 1;
  if (
    w.duty !== 'auto' ||
    (w.path.length && !mutualWait) ||
    w.vehicle ||
    w.transition ||
    w.transportOrder ||
    w.deliveryOrder ||
    w.commuteOrder ||
    w.parkingEquipment ||
    (w.y || 0) > 0.15 ||
    ['home', 'returning', 'aboard'].includes(w.shiftPhase || '')
  )
    return;
  if (s.jobs.some((j) => j.worker === w.id && j.status === 'doing' && j.shedAssembly?.ladder))
    return;
  // A moving escape owned by another machine is respected unless it is itself
  // stalled on this carrier. Its original destination remains the return target.
  if (w.yieldingTo && w.yieldingTo !== o.id && !mutualWait) return;
  // Do not repeatedly dispatch a worker who has already completed this escape.
  if (w.yieldingTo === o.id && !w.path.length) return;
  if (s.elapsed < (w.trafficRetry || 0)) return;
  w.trafficRetry = s.elapsed + 1.5;
  const sweep = carrierBoxes(o, pose);
  if (o.drive && o.mode === 'road') {
    const end = Math.min(roadExitLength(o), o.drive.distance + 32);
    for (let at = o.drive.distance; at <= end; at += 1)
      sweep.push(...carrierBoxes(o, sampleRoad(o, at)));
  }
  const yaw = o.drive?.yaw ?? pose.yaw,
    side = { x: -Math.sin(yaw), z: Math.cos(yaw) },
    sign = (w.x - o.vehicle.x) * side.x + (w.z - o.vehicle.z) * side.z >= 0 ? 1 : -1;
  const candidates = [sign, -sign].flatMap((direction) =>
    [3, 4.5, 6, 8].map((distance) => ({
      x: w.x + side.x * direction * distance,
      z: w.z + side.z * direction * distance,
    })),
  );
  // Stock rows and walls may block both perpendicular exits. Search bounded
  // nearby refuge points around the actual vehicle corridor, not just its sides.
  candidates.push(
    ...[5, 9, 13].flatMap((radius) =>
      Array.from({ length: 8 }, (_, i) => ({
        x: w.x + Math.cos(yaw + (i * Math.PI) / 4) * radius,
        z: w.z + Math.sin(yaw + (i * Math.PI) / 4) * radius,
      })),
    ),
  );
  for (const target of candidates) {
    if (sweep.some((b) => personTouchesBox(target, b, 0.85)) || workerMoveBlocked(s, w, target))
      continue;
    const path = walkRoute(s, w, target, staticObstacleRects(s));
    if (!path?.length) continue;
    w.yieldTarget ??= mutualWait ? { ...w.path[w.path.length - 1] } : { x: w.x, z: w.z };
    w.yieldingTo = o.id;
    w.path = path;
    w.status = 'Stepping clear of road vehicle';
    api.event(
      s,
      'Traffic',
      w.id,
      `Walking clear of ${o.id}; return to the previous task after it passes.`,
    );
    return;
  }
}
function carrierBlockage(s: State, o: Order, blocked: string, api: DeliveryAPI) {
  const d = o.drive!;
  d.blockedBy = blocked || undefined;
  if (!blocked) {
    if (d.trafficBlockedNotice)
      for (const n of s.notices)
        if (n.entity === o.id && n.title === 'Delivery vehicle blocked') n.state = 'done';
    d.trafficBlockedSince = undefined;
    d.trafficBlockedNotice = undefined;
    d.clearanceRequestedFor = undefined;
    return;
  }
  d.trafficBlockedSince ??= s.elapsed;
  if (s.elapsed - d.trafficBlockedSince < 20 || d.trafficBlockedNotice) return;
  const w = s.workers.find((w) => w.id === blocked);
  const reason = w
    ? w.duty !== 'auto'
      ? `${w.id} is under ${w.duty} control; move them clear or restore automatic duty.`
      : w.vehicle ||
          w.transition ||
          w.deliveryOrder ||
          w.transportOrder ||
          w.commuteOrder ||
          w.parkingEquipment ||
          (w.y || 0) > 0.15
        ? `${w.id} is occupied with another physical operation; inspect the worker and clear the route safely.`
        : `Requested ${w.id} to move, but no walking clearance has completed; inspect the worker and nearby obstacles.`
    : `Inspect ${blocked} and clear the driving route.`;
  const detail = `${o.id} has been blocked by ${blocked} for 20 seconds. ${reason}`;
  api.notice(s, 'Delivery vehicle blocked', detail, o.id);
  s.events.push({
    id: api.id(s, 'event'),
    time: s.time,
    type: 'Traffic',
    entity: o.id,
    text: detail,
    severity: 'warning',
  });
  d.trafficBlockedNotice = true;
}

function roadBlocked(s: State, o: Order, pose: Point & { yaw: number }, api: DeliveryAPI) {
  const blocked = roadMoveBlocked(s, o, pose);
  if (blocked) {
    clearCarrierPedestrian(s, o, blocked, pose, api);
    // A parked departing carrier can block this owner's exit while being held
    // by the owner's corridor permit. Let that carrier clear first, using its
    // actual immediate swept geometry rather than bypassing either collision.
    const departingBlocker = s.orders.find(
      (q) =>
        q.id === blocked && q.mode === 'road' && q.status === 'departing' && !q.carrierDeparted,
    );
    if (o.drive?.yardPermit && departingBlocker?.drive) {
      const next = sampleRoad(
        departingBlocker,
        Math.min(roadExitLength(departingBlocker), departingBlocker.drive.distance + 0.5),
      );
      if (!roadMoveBlocked(s, departingBlocker, next)) {
        o.drive.yardPermit = undefined;
        departingBlocker.drive.yardPermit = true;
        api.event(
          s,
          'Traffic',
          o.id,
          `Yielded yard maneuver permit to departing blocker ${departingBlocker.id}.`,
        );
      }
    }
    return blocked;
  }
  if (o.mode === 'road' && deliveryKind(o) !== 'bus' && o.drive) {
    const beyondExit = o.status === 'departing' && pose.x < -30 && pose.z < -13;
    const entering = o.status === 'approaching' && pose.x > -30;
    if (beyondExit) o.drive.yardPermit = undefined;
    else if (entering || o.status === 'departing') {
      // The receiving turns cross the exit lane beyond the rail crossing.
      // Reserve that connected maneuver before leaving a berth or entering
      // the gate, so two long vehicles cannot meet nose-to-nose in a turn.
      // Parked carriers release the permit; public-road traffic and buses
      // remain independent, with the actual footprint checks above intact.
      const owner = s.orders.find(
        (q) =>
          q.id !== o.id &&
          q.drive?.yardPermit &&
          (q.status === 'approaching' || q.status === 'departing'),
      );
      if (owner) return owner.id;
      o.drive.yardPermit = true;
    }
  }
  const boxes = carrierBoxes(o, pose);
  for (const obstacle of [
    ...s.buildings,
    ...s.stacks.filter((t) => t.qty > 0 || t.item === 'diesel'),
  ]) {
    const r = {
      x: obstacle.x + obstacle.w / 2,
      z: obstacle.z + obstacle.d / 2,
      yaw: 0,
      length: obstacle.w,
      width: obstacle.d,
    };
    if (boxes.some((b) => boxOverlap(b, r, 0.12))) return obstacle.id;
  }
  // Admit one full vehicle at a time to the crossing junction. This reservation
  // starts before its nose enters and lasts until its tail clears; it prevents
  // opposing vehicles meeting and deadlocking halfway across the tracks.
  if (boxes.some((b) => boxOverlap(b, crossingArea)))
    for (const other of s.orders) {
      if (
        other.id === o.id ||
        other.status === 'ordered' ||
        other.status === 'done' ||
        other.carrierDeparted
      )
        continue;
      if (deliveryKind(o) === 'bus' && other.mode === 'rail') continue;
      if (carrierBoxes(other).some((b) => boxOverlap(b, crossingArea))) return other.id;
    }
  return '';
}
export function migrateRoadDrive(s: State, o: Order) {
  if (o.mode !== 'road' || o.status === 'ordered' || o.status === 'done' || o.carrierDeparted)
    return;
  o.drive ??= { distance: roadLength(o), velocity: 0, yaw: berth(o).yaw, travel: 0 };
  if (o.drive.roadVersion === ROAD_ROUTE_VERSION) return;
  const old = { ...o.vehicle, yaw: o.drive.yaw ?? berth(o).yaw },
    start = o.status === 'departing' ? roadLength(o) : 0,
    end = o.status === 'approaching' ? roadLength(o) : roadExitLength(o);
  let distance = roadLength(o);
  if (o.status === 'approaching' || o.status === 'departing') {
    let best = Infinity;
    for (let at = start; at <= end; at += 0.5) {
      const p = sampleRoad(o, at),
        d = dist(old, p);
      if (d < best) {
        best = d;
        distance = at;
      }
    }
  }
  const pose = sampleRoad(o, distance);
  const rotate = (p: Point) => {
    const dx = p.x - old.x,
      dz = p.z - old.z;
    return localPoint(
      pose,
      dx * Math.cos(old.yaw) + dz * Math.sin(old.yaw),
      -dx * Math.sin(old.yaw) + dz * Math.cos(old.yaw),
    );
  };
  o.drive.distance = distance;
  o.drive.roadVersion = ROAD_ROUTE_VERSION;
  o.drive.velocity = 0;
  o.drive.yardPermit = undefined;
  o.drive.reverse = pose.reverse;
  o.drive.yaw = pose.yaw;
  o.vehicle = { x: pose.x, z: pose.z };
  for (const e of s.equipment)
    if (e.transportOrder === o.id) {
      const p = o.deployment === 'offload' ? rotate(e) : deckPose(pose);
      e.x = p.x;
      e.z = p.z;
      if (o.deployment !== 'offload') {
        const deck = deckPose(pose);
        e.y = deck.y;
        e.pitch = deck.pitch;
      }
      e.yaw = (e.yaw ?? old.yaw) + pose.yaw - old.yaw;
      e.path = e.path.map(rotate);
      if (e.operator) {
        const w = s.workers.find((w) => w.id === e.operator);
        if (w?.vehicle === e.id) {
          w.x = e.x;
          w.z = e.z;
        }
      }
    }
  for (const w of s.workers)
    if (w.transportOrder === o.id) {
      Object.assign(w, rotate(w));
      w.path = w.path.map(rotate);
      w.yaw = (w.yaw ?? old.yaw) + pose.yaw - old.yaw;
    }
  if (o.operatorId && ['walk', 'climb', 'board'].includes(o.deployment || '')) {
    const w = s.workers.find((w) => w.id === o.operatorId);
    if (w) {
      if (o.deployment === 'walk') {
        const foot = localPoint(pose, -11.5, 1.8);
        w.path = route(w, foot, [...carrierRects(s), ...s.buildings, ...s.stacks], 0.15) || [];
      } else Object.assign(w, rotate(w));
    }
  }
}
export function tickDelivery(s: State, o: Order, dt: number, api: DeliveryAPI) {
  if (o.collectionId) {
    const collection = s.collections?.find(c => c.id === o.collectionId);
    if (collection?.status === 'paused') return;
    if (o.status === 'unloading' || o.status === 'done' || o.carrierDeparted) { tickCollection(s, o, dt, api); if(collection)o.note=collection.note; return; }
    if (o.status === 'departing') tickCollection(s, o, dt, api);
  }
  // Site placement retains its machine/operator after the empty carrier leaves.
  if (o.unload && (o.status === 'departing' || o.status === 'done')) unloadTick(s, o, dt, api);
  if (o.status === 'done' || o.carrierDeparted) return;
  const kind = deliveryKind(o);
  if(o.railFreight?.locomotivePhase==='uncoupling') return;
  if(o.railFreight?.detached) {
    const f=o.railFreight;
    if(o.unload) unloadTick(s,o,dt,api);
    else if(f.unloadRequested && !f.returnId && !s.shunters?.some(e=>e.phase!=='parked'&&e.carIds?.some(id=>f.cars.some(c=>c.id===id)))) unloadTick(s,o,dt,api);
    return;
  }
  if (o.status !== 'ordered') {
    o.drive ??= {
      distance: kind === 'rail' ? railStopDistance(s, o) : roadLength(o),
      velocity: 0,
      yaw: berth(o).yaw,
      travel: 0,
    };
    migrateRoadDrive(s, o);
  }
  if (!o.collectionId && kind === 'lowloader' && o.status !== 'ordered' && !o.equipmentId) {
    purchasedMachine(s, o, api);
    const e = s.equipment.find((e) => e.id === o.equipmentId)!,
      p = localPoint(berth(o), -1.5, 0);
    e.x = p.x;
    e.z = p.z;
    e.y = 0.82;
    e.yaw = berth(o).yaw;
  }
  if (o.status === 'ordered') {
    if (s.time < o.eta) return;
    if (o.railFreight) {
      const reception = railReceptionPlan(s, o);
      if (reception.error) {
        waiting(s, o, reception.error, 'receiving-track', api);
        return;
      }
      o.railFreight.stopDistance = reception.distance;
    }
    const berthBusy = s.orders.some(
      (q) =>
        q.id !== o.id &&
        q.status !== 'ordered' &&
        q.status !== 'done' &&
        !q.carrierDeparted &&
        deliveryKind(q) === kind && kind !== 'rail' &&
        !(q.railFreight?.detached && q.railFreight.locomotivePhase==='gone' && q.railFreight.cars.every(c=>c.returned || Math.abs((c.pose?.z ?? 5) - 5)>1.6 || (c.pose?.x || 0)>130)) &&
        (q.status !== 'departing' ||
          (q.mode === 'rail' ? true : (q.drive?.distance || 0) < roadLength(q) + 14)),
    );
    if (berthBusy) {
      o.note = 'Waiting for the receiving berth';
      return;
    }
    if(o.railFreight){const error=prepareRailArrival(s,o,dt);if(error){o.note=error;return;}}
    const spawn = kind === 'rail' ? (o.railFreight?.incomingRailMove?.points[0] || carPose(0, 5)) : sampleRoad(o, 0);
    if (o.mode === 'road' && roadBlocked(s, o, spawn, api)) {
      o.note = 'Waiting for a safe gap in approaching traffic';
      return;
    }
    o.status = 'approaching';
    o.drive = {
      distance: 0,
      velocity: 0,
      yaw: spawn.yaw,
      travel: 0,
      roadVersion: ROAD_ROUTE_VERSION,
    };
    o.vehicle = { x: spawn.x, z: spawn.z };
    api.notice(
      s,
      o.collectionId ? 'Collection truck approaching' : kind === 'rail' ? 'Train approaching' : 'Road delivery approaching',
      o.collectionId ? `Paid outbound collection · ${o.collectionId} · ${o.id}` : `${orderDescription(o)} · ${o.id}`,
      o.collectionId || o.id,
    );
    if (!o.collectionId && kind === 'lowloader') purchasedMachine(s, o, api);
  }
  if(o.status==='departing' && o.railFreight?.arrivalRailMove && !o.railFreight.detached) {
    if(!advanceAttachedRailDeparture(s,o,dt)) return;
    o.carrierDeparted=true;o.status=o.unload?'departing':'done';o.railFreight.cars.forEach(c=>c.returned=true);
    o.railFreight.movement=undefined;o.note=o.unload?'Empty train returned; site placement still in progress':'Delivery complete; empty train returned';s.revision++;return;
  }
  if(o.status==='approaching' && o.railFreight?.incomingRailMove) {
    if(!advanceRailArrival(s,o,dt)) return;
    o.status='unloading'; o.railFreight.arrivalRailMove=o.railFreight.incomingRailMove; o.railFreight.incomingRailMove=undefined;
    o.note='At receiving track; release supplier locomotive or initiate unloading'; o.handling=0;
    if(!o.invoiced && !o.collectionId) {api.cost(s,'Purchases',o.id,`${orderDescription(o)} + transport`,o.total);o.invoiced=true;}
    api.event(s,'Delivery',o.id,'Arrived; awaiting site unloading resources.');s.revision++;return;
  }
  if (o.status === 'approaching' || o.status === 'departing') {
    const d = o.drive!,
      departing = o.status === 'departing';
    if (o.railFreight && !departing) {
      const reception = railReceptionPlan(s, o);
      if (reception.error) {
        d.velocity = 0;
        waiting(s, o, reception.error, 'receiving-track', api);
        return;
      }
    }
    if ((d.gearPause || 0) > 0) {
      d.gearPause = Math.max(0, (d.gearPause || 0) - dt);
      d.velocity = 0;
      return;
    }
    const rail = kind === 'rail',
      routeEnd = rail ? railStopDistance(s, o) : departing ? roadExitLength(o) : roadLength(o);
    const nextGear = rail ? undefined : roadStopDistances(o).find((p) => p > d.distance + 0.001);
    const limit =
      !rail && departing && nextGear !== undefined ? Math.min(nextGear, routeEnd) : routeEnd;
    const reverse = rail && departing,
      remaining = reverse ? d.distance : Math.max(0, limit - d.distance);
    const poseAt = (at: number) => (rail ? carPose(at, 5) : sampleRoad(o, at));
    const here = poseAt(d.distance),
      backing = rail ? reverse : sampleRoad(o, d.distance + 0.001).reverse;
    const max = rail ? 6 : backing ? 2 : kind === 'bus' ? 7 : 4.5;
    let target = Math.min(max, Math.max(0.1, Math.sqrt(remaining * 1.5)));
    const lookDistance = Math.min(remaining, Math.max(1, (d.velocity || 0) ** 2 / 4 + 1));
    const ahead = poseAt(d.distance + lookDistance * (reverse ? -1 : 1));
    const aheadBlock = rail ? roadMoveBlocked(s, o, ahead) : roadBlocked(s, o, ahead, api);
    if (aheadBlock) target = 0;
    const previousVelocity = d.velocity || 0;
    d.velocity =
      target < previousVelocity
        ? Math.max(target, previousVelocity - dt * 2)
        : Math.min(target, previousVelocity + dt * 0.9);
    // Smooth braking while approaching a predictable obstacle; the final swept
    // footprint check still stops immediately if a person enters unexpectedly.

    const traveled = Math.min(remaining, (d.velocity || 0) * dt),
      next = d.distance + traveled * (reverse ? -1 : 1),
      pose = poseAt(next);
    const obstruction = rail ? roadMoveBlocked(s, o, pose) : roadBlocked(s, o, pose, api);
    if (obstruction) {
      d.velocity = 0;
      carrierBlockage(s, o, obstruction, api);
      o.note = `Yielding to ${obstruction}`;
      return;
    }
    carrierBlockage(s, o, aheadBlock, api);
    d.distance = next;
    d.travel = (d.travel || 0) + traveled * (backing ? -1 : 1);
    d.reverse = backing;
    d.yaw = pose.yaw;
    o.vehicle = { x: pose.x, z: pose.z };
    o.note = aheadBlock
      ? `Slowing for ${aheadBlock}`
      : departing
        ? backing
          ? 'Backing into the exit aisle'
          : 'Departing forward on the road'
        : 'Approaching receiving berth';
    if (
      o.equipmentId &&
      o.deployment !== 'park' &&
      o.deployment !== 'complete' &&
      o.deployment !== 'offload'
    ) {
      const e = s.equipment.find((e) => e.id === o.equipmentId);
      if (e) {
        const p = deckPose(pose);
        e.x = p.x;
        e.z = p.z;
        e.y = p.y;
        e.yaw = p.yaw;
        e.pitch = p.pitch;
      }
    }
    if (remaining > traveled + 0.0001) return;
    d.velocity = 0;
    if (departing && !rail && limit < routeEnd - 0.01) {
      d.gearPause = 0.8;
      o.note = 'Stopped; selecting forward gear';
      return;
    }
    if (departing) {
      o.carrierDeparted = true;
      o.status = o.unload ? 'departing' : 'done';
      d.yardPermit = undefined;
      o.note = o.unload
        ? 'Carrier departed; site placement still in progress'
        : 'Delivery complete';
      s.revision++;
      return;
    }
    o.status = 'unloading';
    if(o.railFreight) o.railFreight.incomingRailMove=undefined;
    d.yardPermit = undefined;
    o.note = kind === 'bus' ? 'Stopped at curb; passengers alighting' : 'At receiving berth';
    o.handling = 0;
    if (!o.invoiced && !o.collectionId) {
      api.cost(
        s,
        'Purchases',
        o.id,
        o.commute
          ? `Chartered ${o.commute.direction} shift bus · ${o.qty} passengers`
          : `${orderDescription(o)} + transport`,
        o.total,
      );
      o.invoiced = true;
    }
    api.event(s, 'Delivery', o.id, 'Arrived; awaiting site unloading resources.');
    s.revision++;
    return;
  }
  // Legacy in-transit saves resume at their berth; invoice exactly once there too.
  if (!o.invoiced && !o.collectionId) {
    api.cost(
      s,
      'Purchases',
      o.id,
      o.commute
        ? `Chartered ${o.commute.direction} shift bus · ${o.qty} passengers`
        : `${orderDescription(o)} + transport`,
      o.total,
    );
    o.invoiced = true;
  }
  if (o.railFreight && !o.railFreight.unloadRequested) {
    o.note = 'At receiving point; choose unloading stockyard and click Start unloading.';
    return;
  }
  if (o.railFreight?.storageZoneId && !s.zones.some((z) => z.id === o.railFreight!.storageZoneId)) {
    waiting(
      s,
      o,
      'Destination stockyard no longer exists; choose another stockyard.',
      'storage',
      api,
    );
    return;
  }
  if (o.commute) commuteTick(s, o, dt, api);
  else if (o.item in MATERIALS) unloadTick(s, o, dt, api);
  else if (o.item in EQUIPMENT) equipmentTick(s, o, dt, api);
  else if (o.item in ROLES) crewTick(s, o, dt, api);
  else if (o.item in SERVICES) serviceTick(s, o, dt, api);
}
