import { electricalObstacles } from './electrical-geometry';
import { bufferAssets } from './buffers';
import { railFreightCarPose, railFreightCarBogies, railMovementPose } from './rail-freight';
import type { State, Point, Equipment, Order, Worker, Rect, Item } from './types';
import { MATERIALS } from './catalog';
import { forkTip } from './fork-geometry';
import { shedComponentPose, shedPostPoints, shedPartSize } from './shed-geometry';
import {
  localPoint,
  carPose,
  COUPLED_CENTERS,
  RAIL_STOP,
  deliveryKind,
  mixAngle,
  move,
  angleDelta,
} from './motion';
import { Heap, dist, segmentClear, route, segmentTravelCost } from './path';
import { surfaceTravelCost, FIXED_TRAVEL_SURFACES } from './ground-wear';
export interface TrafficBox extends Point {
  yaw: number;
  length: number;
  width: number;
  id?: string;
}
/** A collision report describes an attempted action, not a permanent exclusion
 * zone around an idle machine. Keep live routes, work and supported loads
 * protected, but release an obsolete report once its physical intent ends. */
export function clearIdleEquipmentBlockage(s: State, e: Equipment) {
  if (!e.blockedBy && !e.trafficWait && e.trafficBlockedSince === undefined && !e.trafficBlockedNotice)
    return;
  if (
    e.path.length || e.trafficGoal || e.work || e.job || e.deliveryOrder ||
    e.transportOrder || e.refueling || e.cargo || e.assemblyLoad ||
    e.trafficYieldWorker || e.trafficYieldEquipment || e.actionYieldFor ||
    (e.parking && e.parkingState !== 'parked')
  ) return;
  e.blockedBy = undefined;
  e.trafficWait = 0;
  e.trafficBlockedSince = undefined;
  e.trafficBlockedNotice = undefined;
  for (const n of s.notices)
    if (n.entity === e.id && n.title === 'Equipment movement blocked') n.state = 'done';
}
interface BoxGeometry {
  yaw: number;
  length: number;
  width: number;
  margin: number;
  c: number;
  n: number;
  halfLength: number;
  halfWidth: number;
}
// Route replay tests the same stationary boxes thousands of times. Keep one
// geometry entry per live object, with dimensions/yaw/margin invalidation;
// positions are deliberately read directly on every collision check.
const boxGeometryCache = new WeakMap<TrafficBox, BoxGeometry>();
function boxGeometry(b: TrafficBox, margin: number): BoxGeometry {
  let g = boxGeometryCache.get(b);
  if (
    !g ||
    g.yaw !== b.yaw ||
    g.length !== b.length ||
    g.width !== b.width ||
    g.margin !== margin
  ) {
    const halfLength = b.length / 2 + margin,
      halfWidth = b.width / 2 + margin;
    g = {
      yaw: b.yaw,
      length: b.length,
      width: b.width,
      margin,
      c: Math.cos(b.yaw),
      n: Math.sin(b.yaw),
      halfLength,
      halfWidth,
    };
    boxGeometryCache.set(b, g);
  }
  return g;
}
export function boxOverlap(a: TrafficBox, b: TrafficBox, margin = 0) {
  const dx = a.x - b.x,
    dz = a.z - b.z;
  const reach =
    Math.hypot(a.length / 2 + margin, a.width / 2 + margin) +
    Math.hypot(b.length / 2 + margin, b.width / 2 + margin);
  // Most replay pairs are far apart. Reject them before looking up cached
  // trigonometry or allocating geometry for a short-lived moving pose.
  if (Math.abs(dx) > reach || Math.abs(dz) > reach) return false;
  const ga = boxGeometry(a, margin),
    gb = boxGeometry(b, margin);
  const dot = Math.abs(ga.c * gb.c + ga.n * gb.n),
    cross = Math.abs(ga.c * gb.n - ga.n * gb.c);
  return (
    Math.abs(dx * ga.c + dz * ga.n) <
      ga.halfLength + gb.halfLength * dot + gb.halfWidth * cross - 1e-7 &&
    Math.abs(-dx * ga.n + dz * ga.c) <
      ga.halfWidth + gb.halfLength * cross + gb.halfWidth * dot - 1e-7 &&
    Math.abs(dx * gb.c + dz * gb.n) <
      gb.halfLength + ga.halfLength * dot + ga.halfWidth * cross - 1e-7 &&
    Math.abs(-dx * gb.n + dz * gb.c) <
      gb.halfWidth + ga.halfLength * cross + ga.halfWidth * dot - 1e-7
  );
}
/** Minimum SAT penetration of the inflated boxes; zero means clear. */
export function boxPenetrationDepth(a: TrafficBox, b: TrafficBox, margin = 0) {
  const ga = boxGeometry(a, margin),
    gb = boxGeometry(b, margin),
    dx = a.x - b.x,
    dz = a.z - b.z,
    dot = Math.abs(ga.c * gb.c + ga.n * gb.n),
    cross = Math.abs(ga.c * gb.n - ga.n * gb.c);
  return Math.max(
    0,
    Math.min(
      ga.halfLength + gb.halfLength * dot + gb.halfWidth * cross - Math.abs(dx * ga.c + dz * ga.n),
      ga.halfWidth + gb.halfLength * cross + gb.halfWidth * dot - Math.abs(-dx * ga.n + dz * ga.c),
      gb.halfLength + ga.halfLength * dot + ga.halfWidth * cross - Math.abs(dx * gb.c + dz * gb.n),
      gb.halfWidth + ga.halfLength * cross + ga.halfWidth * dot - Math.abs(-dx * gb.n + dz * gb.c),
    ),
  );
}
export function personTouchesBox(p: Point, b: TrafficBox, radius = 0.34) {
  const dx = p.x - b.x,
    dz = p.z - b.z,
    c = Math.cos(b.yaw),
    n = Math.sin(b.yaw);
  const x = Math.max(0, Math.abs(dx * c + dz * n) - b.length / 2),
    z = Math.max(0, Math.abs(-dx * n + dz * c) - b.width / 2);
  return x * x + z * z < radius * radius;
}

function personOverlapDepth(p: Point, b: TrafficBox, radius: number) {
  const dx = p.x - b.x,
    dz = p.z - b.z,
    c = Math.cos(b.yaw),
    n = Math.sin(b.yaw);
  const x = Math.abs(dx * c + dz * n) - b.length / 2,
    z = Math.abs(-dx * n + dz * c) - b.width / 2;
  return x <= 0 && z <= 0
    ? radius - Math.max(x, z)
    : Math.max(0, radius - Math.hypot(Math.max(x, 0), Math.max(z, 0)));
}
export function equipmentBoxes(
  e: Equipment,
  pose: Point & { yaw?: number } = e,
  attachments = true,
): TrafficBox[] {
  const yaw = pose.yaw ?? e.yaw ?? (e.heading * Math.PI) / 2;
  const boxes: TrafficBox[] = [
    {
      ...pose,
      yaw,
      length: e.kind === 'excavator' ? 3.76 : 3.15,
      width: e.kind === 'excavator' ? 2.6 : 1.96,
      id: e.id,
    },
  ];
  if (attachments) {
    const reach = e.reach ?? (e.kind === 'excavator' ? 2.7 : 2.4),
      tip = e.kind === 'forklift' ? forkTip(reach) : reach + 0.45,
      front = localPoint({ ...pose, yaw }, (1.1 + tip) / 2, 0);
    boxes.push({
      ...front,
      yaw,
      length: Math.max(0.1, tip - 1.1),
      width: e.kind === 'excavator' ? 0.85 : 1.1,
      id: e.id,
    });
    if (e.assemblyLoad) {
      const p = localPoint({ ...pose, yaw }, reach, 0);
      boxes.push({
        ...p,
        yaw: yaw + e.assemblyLoad.yawOffset,
        length: e.assemblyLoad.length,
        width: e.assemblyLoad.width,
        id: e.id,
      });
    }
    if (e.cargo) {
      const m = MATERIALS[e.cargo.item],
        p = localPoint({ ...pose, yaw }, reach, 0);
      boxes.push({
        ...p,
        yaw:
          e.cargo.yaw === undefined
            ? yaw
            : e.cargo.storageMove || ['slab', 'bufferStop'].includes(e.cargo.item)
              ? e.cargo.yaw + angleDelta(e.yaw ?? (e.heading * Math.PI) / 2, yaw)
              : e.cargo.yaw,
        length: e.cargo.yaw === undefined ? m.d : m.w,
        width: e.cargo.yaw === undefined ? m.w : m.d,
        id: e.id,
      });
    }
  }
  return boxes;
}
/** A reach change moves the supported load even when the chassis is stationary.
 * Check the changing tool/load envelope against actors before advancing it. */
export function equipmentReachBlocked(s: State, e: Equipment, reach: number) {
  const before = equipmentBoxes(e),
    after = equipmentBoxes({ ...e, reach });
  for (const person of people(s)) {
    if (person.worker?.transition?.equipmentId === e.id) continue;
    if (
      after.some(
        (box, i) =>
          personOverlapDepth(person, box, 0.42) >
          personOverlapDepth(person, before[i], 0.42) + 1e-7,
      )
    )
      return person.id;
  }
  for (const other of s.equipment) {
    if (other.id === e.id || other.transportOrder) continue;
    if (
      equipmentBoxes(other).some((box) =>
        after.some((next, i) => boxOverlap(next, box, 0.08) && !boxOverlap(before[i], box, 0.08)),
      )
    )
      return other.id;
  }
  return '';
}
export function carrierBoxes(o: Order, pose?: Point & { yaw: number }): TrafficBox[] {
  const k = deliveryKind(o),
    yaw = pose?.yaw ?? o.drive?.yaw ?? 0;
  if (k === 'rail') {
    const distance = o.drive?.distance ?? RAIL_STOP;
    const front = pose ?? carPose(distance, 5),
      back = carPose(distance - COUPLED_CENTERS, 11);
    if (o.railFreight) {
      if(o.railFreight.incomingRailMove) {
        const m=o.railFreight.incomingRailMove;
        let station=m.distance;
        if(pose) {
          let best=Infinity;
          for(let at=Math.max(0,m.distance-8);at<=Math.min(m.end,m.distance+40);at+=0.25) {
            const p=railMovementPose(m,at,5.58),d=Math.hypot(p.x-pose.x,p.z-pose.z);
            if(d<best) {best=d;station=at;}
          }
        }
        return [{...railMovementPose(m,station,5.58),length:8.6,width:2.65,id:o.id},...o.railFreight.cars.map(c=>({...railMovementPose(m,station-c.centerOffset,c.wheelbase),length:c.length,width:c.width,id:c.id}))];
      }
      // The movement caller supplies a future head pose. Derive its station by
      // a bounded local search along the surveyed route, rather than shifting
      // the cars rigidly sideways across the turnout.
      let station = distance;
      if (pose) {
        let lo = distance - 40,
          hi = distance + 40;
        for (let n = 0; n < 24; n++) {
          const a = lo + (hi - lo) / 3,
            b = hi - (hi - lo) / 3;
          const pa = carPose(a, 5),
            pb = carPose(b, 5);
          if (Math.hypot(pa.x - pose.x, pa.z - pose.z) < Math.hypot(pb.x - pose.x, pb.z - pose.z))
            hi = b;
          else lo = a;
        }
        station = (lo + hi) / 2;
      }
      if (o.railFreight.detached) {
        const f = o.railFreight;
        return [
          ...(f.locomotivePhase !== 'gone' && f.locomotivePose
            ? [{ ...f.locomotivePose, length: 8.6, width: 2.65, id: o.id }]
            : []),
          ...f.cars
            .filter((c) => !c.returned)
            .map((c) => ({
              ...railFreightCarPose(o, f.cars.indexOf(c)),
              length: c.length,
              width: c.width,
              id: c.id,
            })),
        ];
      }
      const future = { ...o, drive: { ...o.drive!, distance: station } };
      return [
        { ...front, length: 8.6, width: 2.65, id: o.id },
        ...o.railFreight.cars.map((car, index) => ({
          ...railFreightCarPose(future, index),
          length: car.length,
          width: car.width,
          id: o.id,
        })),
      ];
    }
    return [
      { ...front, length: 8.6, width: 2.65, id: o.id },
      { ...back, length: 16.8, width: 2.75, id: o.id },
    ];
  }
  const at = pose ?? { ...o.vehicle, yaw };
  const center = k === 'lowloader' ? localPoint(at, 0.2, 0) : at;
  return [{ ...center, yaw, length: k === 'lowloader' ? 11.8 : 9.4, width: 2.8, id: o.id }];
}
/** Owned and collecting locomotives participate in every traffic check even
 * when parked; they are not supplier Order carriers. */
export function ownedRailActorBoxes(s: State): TrafficBox[] {
  return [
    ...(s.shunters || [])
      .filter((e) => e.phase !== 'ordered')
      .map((e) => ({ x: e.x, z: e.z, yaw: e.yaw, length: 8.6, width: 2.65, id: e.id })),
    ...(s.railReturns || [])
      .filter((r) => r.phase !== 'done')
      .map((r) => ({ x: r.x, z: r.z, yaw: r.yaw, length: 8.6, width: 2.65, id: r.id })),
  ];
}
/** Includes standing detached cars after the supplier locomotive has left. */
export function railRollingStockBoxes(s: State): TrafficBox[] {
  return [
    ...ownedRailActorBoxes(s),
    ...s.orders
      .filter((o) => o.mode === 'rail' && !['ordered', 'done'].includes(o.status))
      .flatMap((o) => carrierBoxes(o)),
  ];
}
/** Axle contact envelopes for pointwork interlocking. Nose overhang does not
 * prohibit a throw when every wheel is still before the points; chassis
 * collision checks elsewhere continue to use the full vehicle body. */
export function railRollingStockAxles(s: State): TrafficBox[] {
  const out: TrafficBox[] = [];
  const add = (
    pose: Point & { yaw: number },
    wheelbase: number,
    id: string,
    bogies?: (Point & { yaw: number })[],
  ) => {
    for (const p of bogies || [
      localPoint(pose, -wheelbase / 2, 0),
      localPoint(pose, wheelbase / 2, 0),
    ])
      out.push({ ...p, yaw: pose.yaw, length: 0.1, width: 1.65, id });
  };
  for (const e of s.shunters || []) if (e.phase !== 'ordered') add(e, 5.58, e.id, e.bogies);
  for (const e of s.railReturns || []) if (e.phase !== 'done') add(e, 5.58, e.id, e.bogies);
  for (const o of s.orders) {
    if (o.mode !== 'rail' || ['ordered', 'done'].includes(o.status)) continue;
    const f = o.railFreight;
    if (!f) {
      out.push(...carrierBoxes(o));
      continue;
    }
    const bodies = carrierBoxes(o);
    if (!f.detached || f.locomotivePhase !== 'gone') {
      const pose = f.locomotivePose || bodies[0];
      if (pose) add(pose, 5.58, o.id, f.locomotiveBogies);
    }
    for (const [i, c] of f.cars.entries())
      if (!c.returned) {
        const pose = railFreightCarPose(o, i);
        add(pose, c.wheelbase, c.id, c.bogies || (c.pose ? undefined : railFreightCarBogies(o, i)));
      }
  }
  return out;
}
export function boxRect(b: TrafficBox, pad = 0): Rect {
  const c = Math.abs(Math.cos(b.yaw)),
    n = Math.abs(Math.sin(b.yaw));
  const w = b.length * c + b.width * n + pad * 2,
    d = b.length * n + b.width * c + pad * 2;
  return { x: b.x - w / 2, z: b.z - d / 2, w, d };
}
/** Ground-level collision geometry shared by routing and executed movement.
 * Open sheds keep their usable interior; only their six post bases and back
 * wall are solid. All coordinates follow the rendered cardinal rotation. */
export function staticObstacleRects(s: State): (Rect & { id: string })[] {
  const out: (Rect & { id: string })[] = s.stacks
    .filter((t) => !t.storageCarriedBy && (t.qty > 0 || t.item === 'diesel'))
    .map((t) => ({ x: t.x, z: t.z, w: t.w, d: t.d, id: t.id }));
  for (const j of s.jobs) {
    const h = j.shedAssembly;
    if (!h || j.status !== 'doing' || !j.delivered) continue;
    const rotated = Math.abs(Math.sin(h.kitPose.yaw)) > 0.5;
    out.push({
      x: h.kitPose.x - (rotated ? (j.kind==='engineShed'?1.5:1) : 2),
      z: h.kitPose.z - (rotated ? 2 : (j.kind==='engineShed'?1.5:1)),
      w: rotated ? (j.kind==='engineShed'?3:2) : 4,
      d: rotated ? 4 : (j.kind==='engineShed'?3:2),
      id: j.id + '-kit',
    });
    for (const p of shedPostPoints(j).slice(0, h.posts))
      out.push({ x: p.x - 0.2, z: p.z - 0.2, w: 0.4, d: 0.4, id: j.id + '-post' });
    for (let index = 0; index < h.wallPanels; index++) {
      const p = shedComponentPose(j, 'wall', index);
      if(j.kind==='engineShed' && index>=4) continue; // Raised roller doors preserve the rail entrance.
      const width = shedPartSize(j,'wall',index)[0];
      out.push({ ...boxRect({ ...p, length: width, width: 0.08 }), id: j.id + '-wall-' + index });
    }
  }
  for (const j of s.jobs) {
    const h=j.processAssembly;
    if(!h||j.status!=='doing'||!j.delivered)continue;
    const m=MATERIALS[j.item!],rotated=Math.abs(Math.sin(h.kitPose.yaw))>.5;
    const w=rotated?m.d:m.w,d=rotated?m.w:m.d;
    out.push({x:h.kitPose.x-w/2,z:h.kitPose.z-d/2,w,d,id:j.id+'-process-kit'});
    if(h.completed>0)out.push({x:j.x,z:j.z,w:j.w,d:j.d,id:j.id+'-process'});
    if(h.part && ['lift','lower'].includes(h.phase)) {
      const p=h.part.pose,span=j.kind==='processTank'?3.7:j.kind==='transferPump'?1.8:1;
      const side=span*(Math.abs(Math.cos(p.yaw))+Math.abs(Math.sin(p.yaw)));
      out.push({x:p.x-side/2,z:p.z-side/2,w:side,d:side,id:j.id+'-process-load'});
    }
  }
  for (const b of s.buildings) {
    const c = { x: b.x + b.w / 2, z: b.z + b.d / 2 },
      yaw = ((b.rotation % 2) * Math.PI) / 2;
    if (['shed','engineShed'].includes(b.kind)) {
      const w = b.rotation % 2 ? b.d : b.w,
        d = b.rotation % 2 ? b.w : b.d;
      for (const x of [-w / 2 + 0.18, w / 2 - 0.18])
        for (const z of [-d / 2 + 0.18, 0, d / 2 - 0.18]) {
          const p = localPoint({ ...c, yaw }, x, z);
          out.push({ x: p.x - 0.2, z: p.z - 0.2, w: 0.4, d: 0.4, id: b.id });
        }
      if(b.kind==='engineShed') {
        for(const x of [-w/2+.08,w/2-.08]) { const side=localPoint({...c,yaw},x,0);
          out.push({...boxRect({...side,yaw:yaw+Math.PI/2,length:d,width:.12}),id:b.id}); }
      } else {
        const back = localPoint({ ...c, yaw }, 0, -d / 2);
        out.push({ ...boxRect({ ...back, yaw, length: w, width: 0.08 }), id: b.id });
      }
    } else if (b.kind === 'lamp') {
      out.push({ x: c.x - 0.275, z: c.z - 0.275, w: 0.55, d: 0.55, id: b.id });
    } else if (b.kind === 'power' || b.kind === 'water') {
      out.push({ ...boxRect({ ...c, yaw, length: 0.8, width: 0.65 }), id: b.id });
    } else {
      out.push({ x: b.x, z: b.z, w: b.w, d: b.d, id: b.id });
    }
  }
  for (const buffer of bufferAssets(s)) {
    if (buffer.carried) continue;
    const p = localPoint(buffer, 0.55, 0);
    out.push({ ...boxRect({ ...p, yaw: buffer.yaw, length: 1.75, width: 2.05 }), id: buffer.id });
  }
  for (let x = -110; x < 250; x += 28)
    out.push({ x: x - 0.13, z: -20.13, w: 0.26, d: 0.26, id: `CORRIDOR-POLE-${x}` });
  out.push(...electricalObstacles(s));
  return out;
}
export function people(s: State) {
  const out: { id: string; x: number; z: number; worker?: Worker }[] = s.workers
    .filter(
      (w) => !w.vehicle && !['home', 'returning', 'aboard'].includes(w.shiftPhase || 'working'),
    )
    .map((w) => ({ ...w, worker: w }));
  for (const o of s.orders)
    if (o.contractor && o.contractor.phase !== 'seated')
      out.push({ ...o.contractor, id: o.id + '-crew' });
  for (const crew of s.railServiceCrew || [])
    if (!['aboard', 'left-site'].includes(crew.phase)) out.push({ ...crew });
  return out;
}
export function roadMoveBlocked(s: State, o: Order, pose: Point & { yaw: number }): string {
  const next = carrierBoxes(o, pose);
  for (const other of s.orders) {
    if (
      other.id === o.id ||
      other.status === 'ordered' ||
      other.status === 'done' ||
      other.carrierDeparted
    )
      continue;
    if (next.some((a) => carrierBoxes(other).some((b) => boxOverlap(a, b, 0.15)))) return other.id;
  }
  for (const actor of ownedRailActorBoxes(s))
    if (next.some((b) => boxOverlap(b, actor, 0.15))) return actor.id!;
  for (const e of s.equipment) {
    if (e.transportOrder === o.id) continue;
    if (next.some((a) => equipmentBoxes(e).some((b) => boxOverlap(a, b, 0.15)))) return e.id;
  }
  for (const p of people(s)) if (next.some((b) => personTouchesBox(p, b, 0.55))) return p.id;
  return '';
}

/** Heights of the actual storage props, including finite supported layers. */
export function storageMoveStockHeight(item: Item, qty: number): number {
  if (qty <= 0) return 0;
  if (item === 'slab') return 0.02 + qty * 0.18;
  if (item.startsWith('rail')) return 0.325 + (qty - 1) * 0.36;
  if (item === 'office' || item === 'sanitary') return 3;
  if (item === 'diesel') return 0.94;
  if (item === 'cableReel') return 0.94;
  if (item === 'bufferStop') return 1.1;
  if (item === 'lamp') return 0.395 + (qty - 1) * 0.16;
  if (
    [
      'processTank',
      'transferPump',
      'processPipe',
      'pipeElbow',
      'pipeTee',
      'processValve',
      'processGauge',
    ].includes(item)
  )
    return (item === 'processTank' ? 1.3 : 0.8) * (qty - 1) + 1.1;
  return Math.max(1.1, 0.35 + qty * (item === 'fence' ? 0.14 : 0));
}
interface StorageSolid extends TrafficBox {
  top: number;
}
/** New storage hauling opts into load/solid checks; legacy delivery and rail
 * handling retain their existing policies. A work-owned source/target permits
 * support contact, never carrying a low load through the rest of a stack. */
function storageLoadStaticContext(s: State, e: Equipment, extra: Rect[] = []) {
  if (!e.cargo || e.cargo.item.startsWith('rail')) return;
  const job = s.jobs.find(
    (j) =>
      (j.id === e.job || j.equipment === e.id) &&
      j.kind === 'moveStock' &&
      j.stockMove?.toStorage &&
      !['done', 'canceled'].includes(j.status),
  );
  if (!e.cargo.storageMove && !job) return;
  const heights = new Map<string, number>();
  const surface = (p: Point) => (s.paving[`${Math.floor(p.x)},${Math.floor(p.z)}`] ? 0.105 : 0);
  for (const t of s.stacks)
    heights.set(
      t.id,
      surface({ x: t.x + t.w / 2, z: t.z + t.d / 2 }) +
        (t.baseHeight || 0) +
        storageMoveStockHeight(t.item, t.qty || (t.item === 'diesel' ? 1 : 0)),
    );
  const buildingHeights: Partial<Record<string, number>> = {
    office: 3,
    sanitary: 3,
    store: 4,
    shed: 6,
    engineShed: 7,
    lamp: 7,
    power: 1.6,
    water: 1.6,
    electricalJunction: 1.3,
    fence: 2.3,
    processTank: 4.5,
    transferPump: 1.8,
    processPipe: 1.4,
    pipeElbow: 1.4,
    pipeTee: 1.4,
    processValve: 1.8,
    processGauge: 1.8,
  };
  for (const b of s.buildings)
    heights.set(b.id, surface(b) + (buildingHeights[b.kind] ?? Infinity));
  for (const b of bufferAssets(s)) heights.set(b.id, (b.y || 0) + 1.1);
  for (const run of s.electrical?.runs || [])
    for (const [i, c] of run.cells.entries()) {
      heights.set(`${run.id}/trench/${i}`, 0);
      heights.set(`${run.id}/spoil/${i}`, 1.1);
      heights.set(`${run.id}/slab/${i}`, surface(c) + 0.2);
    }
  const unique = new Map<string, Rect & { id?: string }>();
  for (const r of [...staticObstacleRects(s), ...extra])
    unique.set(`${(r as { id?: string }).id || ''}/${r.x}/${r.z}/${r.w}/${r.d}`, r);
  const solids: StorageSolid[] = [...unique.values()].map((r) => ({
    x: r.x + r.w / 2,
    z: r.z + r.d / 2,
    length: r.w,
    width: r.d,
    yaw: 0,
    id: r.id,
    top: r.id ? (heights.get(r.id) ?? Infinity) : Infinity,
  }));
  const bottom =
    job?.handling?.state === 'carried' ? job.handling.pose.y : (e.y || 0) + (e.lift ?? 0.12);
  return {
    solids,
    bottom,
    clearance: (id?: string) =>
      id && (id === job?.stockMove?.sourceId || id === job?.stockMove?.mergeId) ? 0.025 : -0.035,
  };
}

export function equipmentMoveBlocked(
  s: State,
  e: Equipment,
  pose: Point & { yaw?: number },
): string {
  const loadStatic = storageLoadStaticContext(s, e);
  const moving = loadStatic ? {...e,cargo:{...e.cargo!,storageMove:true}} : e;
  const boxes = equipmentBoxes(moving, pose),
    prior = equipmentBoxes(moving);
  const blocks = (a: TrafficBox, b: TrafficBox, part: number, margin = 0.06) => {
    if (!boxOverlap(a, b, margin)) return false;
    const next = boxPenetrationDepth(a, b, margin),
      old = prior[part] ? boxPenetrationDepth(prior[part], b, margin) : 0;
    // Imported poses or a newly attached load may already overlap a safety
    // margin. Allow only outward/tangential escape, never deeper penetration
    // and never an overlap with any new obstacle.
    return old <= 1e-7 || next > old + 1e-7;
  };
  for (const r of staticObstacleRects(s)) {
    if (
      blocks(boxes[0], { x: r.x + r.w / 2, z: r.z + r.d / 2, yaw: 0, length: r.w, width: r.d }, 0)
    )
      return r.id;
  }
  if (loadStatic) {
    const part = boxes.length - 1;
    for (const solid of loadStatic.solids) {
      if (loadStatic.bottom + loadStatic.clearance(solid.id) >= solid.top) continue;
      if (blocks(boxes[part], solid, part)) return solid.id || 'static load obstruction';
    }
  }
  for (const p of people(s)) {
    if (p.worker?.transition?.equipmentId === e.id) continue;
    if (
      boxes.some((b, i) => {
        const next = personOverlapDepth(p, b, 0.42),
          old = personOverlapDepth(p, prior[i], 0.42);
        return next > 1e-7 && (old <= 1e-7 || next > old + 1e-7);
      })
    )
      return p.id;
  }
  // Swept poses protect track corners and forks while turning as well as while translating.
  for (const other of s.equipment) {
    if (other.id === e.id || other.transportOrder) continue;
    if (boxes.some((a, i) => equipmentBoxes(other).some((b) => blocks(a, b, i)))) return other.id;
  }
  for (const actor of ownedRailActorBoxes(s))
    if (equipmentBoxes(e, pose, false).some((b) => blocks(b, actor, 0))) return actor.id!;
  for (const o of s.orders) {
    if (
      o.status === 'ordered' ||
      o.status === 'done' ||
      o.carrierDeparted ||
      e.transportOrder === o.id
    )
      continue;
    // Raised tools legitimately reach over a freight deck; chassis must always remain clear.
    if (equipmentBoxes(e, pose, false).some((a) => carrierBoxes(o).some((b) => blocks(a, b, 0))))
      return o.id;
  }
  return '';
}
export function equipmentSweepBlocked(s: State, e: Equipment, pose: Point & { yaw?: number }) {
  const fromYaw = e.yaw ?? (e.heading * Math.PI) / 2,
    toYaw = pose.yaw ?? fromYaw;
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const blocker = equipmentMoveBlocked(s, e, {
      x: e.x + (pose.x - e.x) * t,
      z: e.z + (pose.z - e.z) * t,
      yaw: mixAngle(fromYaw, toYaw, t),
    });
    if (blocker) return blocker;
  }
  return '';
}
export function workerMoveBlocked(s: State, w: Point & { id?: string }, pose: Point): string {
  // A newly attached load or imported pose may already touch a worker's safety
  // margin. Let the worker step outward, without deepening that overlap or
  // entering any new obstacle; otherwise even the escape route is impossible.
  const blocks = (b: TrafficBox) => {
    const next = personOverlapDepth(pose, b, 0.31);
    if (next <= 1e-7) return false;
    const prior = personOverlapDepth(w, b, 0.31);
    return prior <= 1e-7 || next > prior + 1e-7;
  };
  for (const r of staticObstacleRects(s))
    if (blocks({ x: r.x + r.w / 2, z: r.z + r.d / 2, yaw: 0, length: r.w, width: r.d }))
      return r.id;
  for (const e of s.equipment) {
    if (e.transportOrder) continue;
    if (equipmentBoxes(e).some(blocks)) return e.id;
  }
  for (const actor of ownedRailActorBoxes(s)) if (blocks(actor)) return actor.id!;
  for (const o of s.orders) {
    if (o.status === 'ordered' || o.status === 'done' || o.carrierDeparted) continue;
    if (carrierBoxes(o).some(blocks)) return o.id;
  }
  return '';
}
export function navigationActors(s: State, ignore: string): Rect[] {
  const out: Rect[] = [];
  for (const e of s.equipment)
    if (e.id !== ignore && !e.transportOrder)
      out.push(...equipmentBoxes(e).map((b) => boxRect(b, 0.1)));
  for (const actor of ownedRailActorBoxes(s))
    if (actor.id !== ignore) out.push(boxRect(actor, 0.1));
  for (const p of people(s))
    if (p.id !== ignore) out.push({ x: p.x - 0.4, z: p.z - 0.4, w: 0.8, d: 0.8 });
  return out;
}

// A parked carrier's bounding rectangle is useful for a first route, but it
// cannot describe an escape from beside its angled cab. Search actual machine
// poses here, validating the same gradual steering used while driving.
/** Route previews and executed motion must use the same steering speed. */
export function equipmentTravelSpeed(s: State, e: Equipment) {
  const job = s.jobs.find((j) => j.equipment === e.id && j.status === 'doing');
  return job?.kind === 'rail'
    ? 1
    : job?.handling || job?.shedAssembly
      ? 1.6
      : e.kind === 'excavator'
        ? 2.3
        : 3.1;
}
export function machineRoute(
  s: State,
  e: Equipment,
  goal: Point,
  staticObstacles: Rect[],
  searchLimit = 250,
  allowWorkerYield = false,
  finalYaw?: number,
  preferStraight = false,
): Point[] | null {
  const loadStatic = storageLoadStaticContext(s, e, staticObstacles);
  if(loadStatic) e = {...e,cargo:{...e.cargo!,storageMove:true}};
  const solid = staticObstacles.map((r) => ({
    x: r.x + r.w / 2,
    z: r.z + r.d / 2,
    length: r.w,
    width: r.d,
    yaw: 0,
  }));
  const machines = s.equipment
    .filter((q) => q.id !== e.id && !q.transportOrder)
    .flatMap((q) => equipmentBoxes(q));
  const carriers = s.orders
    .filter(
      (q) =>
        q.status !== 'ordered' &&
        q.status !== 'done' &&
        !q.carrierDeparted &&
        q.id !== e.transportOrder,
    )
    .flatMap((q) => carrierBoxes(q));
  carriers.push(...ownedRailActorBoxes(s));
  const pedestrians = people(s).filter(
    (p) =>
      p.worker?.transition?.equipmentId !== e.id &&
      !(
        allowWorkerYield &&
        p.worker?.duty === 'auto' &&
        !p.worker.path.length &&
        !p.worker.transition
      ),
  );
  const initialBoxes = equipmentBoxes(e);
  const replayBlocked = (a: TrafficBox, b: TrafficBox, part: number, margin = 0.06) => {
    if (!boxOverlap(a, b, margin)) return false;
    const old = initialBoxes[part] ? boxPenetrationDepth(initialBoxes[part], b, margin) : 0;
    return old <= 1e-7 || boxPenetrationDepth(a, b, margin) > old + 1e-7;
  };
  const safe = (p: Equipment) => {
    if (p.x < -48 || p.x > 230 || p.z < -30 || p.z > 115) return false;
    const boxes = equipmentBoxes(e, p),
      chassis = boxes[0];
    return (
      !boxes.some(
        (a, i) =>
          machines.some((b) => replayBlocked(a, b, i)) ||
          pedestrians.some((w) => {
            const next = personOverlapDepth(w, a, 0.42),
              old = personOverlapDepth(w, initialBoxes[i], 0.42);
            return next > 1e-7 && (old <= 1e-7 || next > old + 1e-7);
          }),
      ) &&
      !carriers.some((b) => replayBlocked(chassis, b, 0)) &&
      !solid.some((b) => replayBlocked(chassis, b, 0)) &&
      (!loadStatic || !loadStatic.solids.some(b =>
        loadStatic.bottom + loadStatic.clearance(b.id) < b.top &&
        replayBlocked(boxes[boxes.length - 1], b, boxes.length - 1)))
    );
  };
  // A storage dock can fit the final chassis yet have no room for a turn
  // from the route's arrival heading. Validate the whole stationary turn,
  // so a caller can request a physical reapproach instead of waiting forever.
  const canAlign = (p: Equipment) => {
    if (finalYaw === undefined) return true;
    const fromYaw = p.yaw ?? (p.heading * Math.PI) / 2;
    return Array.from({ length: 24 }, (_, i) => (i + 1) / 24).every((t) =>
      safe({ ...p, yaw: mixAngle(fromYaw, finalYaw, t) }),
    );
  };
  if (
    !(
      finalYaw === undefined ? Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8) : [finalYaw]
    ).some((yaw) => safe({ ...e, ...goal, yaw }))
  )
    return null;
  const maximum = equipmentTravelSpeed(s, e);
  let steeringSteps = 0;
  const steeringBudget = Math.max(4500, searchLimit * 20);
  const advance = (from: Equipment, to: Point): Equipment | null => {
    // The inscribed chassis circle is inside every rotated body pose. If
    // even that circle intersects a wall along this straight segment, the
    // expensive steering replay cannot possibly succeed.
    const radius = (e.kind === 'excavator' ? 1.3 : 0.98) + 0.055;
    const whollyClearStart = segmentClear(from, from, staticObstacles, radius);
    if (whollyClearStart && !segmentClear(from, to, staticObstacles, radius)) return null;
    const p = { ...from, path: [to], velocity: 0 };
    for (
      let i = 0, limit = Math.ceil(dist(from, to) / (0.1 * maximum)) + 45;
      i < limit && p.path.length;
      i++
    ) {
      if (++steeringSteps > steeringBudget) return null;
      const prev = { ...p };
      move(p, 0.1, maximum, true);
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const pose = {
          ...p,
          x: prev.x + (p.x - prev.x) * t,
          z: prev.z + (p.z - prev.z) * t,
          yaw: mixAngle(prev.yaw ?? 0, p.yaw ?? 0, t),
        };
        if (!safe(pose)) return null;
      }
    }
    return p.path.length ? null : p;
  };
  if (dist(e, goal) < 0.01 && canAlign(e)) return [];
  // A withdrawal probe specifically asks whether the current track/wheel
  // axis can clear a tight pocket. Try that exact swept segment before a
  // normal low-turn grid route, which may contain two unnecessary bends.
  if (preferStraight) {
    const end = advance(e, goal);
    if (end && canAlign(end)) return [{ ...goal }];
  }
  const surfaceCost = (p: Point, yaw: number) => {
    const strip = e.kind === 'excavator' ? 0.94 : 0.68;
    return (
      surfaceTravelCost(s, p) * 0.2 +
      [-strip, strip].reduce(
        (total, side) =>
          total +
          surfaceTravelCost(s, { x: p.x - Math.sin(yaw) * side, z: p.z + Math.cos(yaw) * side }) *
            0.4,
        0,
      )
    );
  };
  const routeCost = (from: Equipment, path: Point[]) => {
    let at: Point = from,
      yaw = (from.yaw ?? 0) + (from.reverse ? Math.PI : 0),
      cost = 0;
    for (const p of path) {
      const direction = Math.atan2(p.z - at.z, p.x - at.x);
      cost += segmentTravelCost(at, p, surfaceCost) + Math.abs(angleDelta(yaw, direction)) * 2.5;
      yaw = direction;
      at = p;
    }
    return cost;
  };
  const connect = (from: Equipment) => {
    let best: Point[] | null = null,
      cost = Infinity;
    const seen = new Set<string>();
    for (const bend of [
      { x: goal.x, z: from.z },
      { x: from.x, z: goal.z },
    ]) {
      let p = from,
        valid = true;
      const path = [bend, goal].filter((q, i, a) => dist(i ? a[i - 1] : from, q) > 0.01);
      const signature = path.map((q) => `${q.x},${q.z}`).join(';');
      if (seen.has(signature)) continue;
      seen.add(signature);
      for (const q of path) {
        const next = advance(p, q);
        if (!next) {
          valid = false;
          break;
        }
        p = next;
      }
      if (valid && !canAlign(p)) valid = false;
      const value = routeCost(from, path);
      if (valid && value < cost) {
        best = path;
        cost = value;
      }
    }
    return best;
  };
  // Search nodes are a feasibility scaffold. Collapse stair-step fragments
  // only after replaying their exact swept machine poses, so a detour does
  // not turn left and right at every 1.25 m node or cut a post with its rear.
  const simplify = (path: Point[], preserveSurface = false) => {
    const out: Point[] = [];
    let at = { ...e },
      index = 0;
    while (index < path.length) {
      let selected = index,
        next: Equipment | null = null;
      for (let i = path.length - 1; i >= index; i--) {
        if (
          preserveSurface &&
          routeCost(at, [path[i]]) > routeCost(at, path.slice(index, i + 1)) + 0.02
        )
          continue;
        next = advance(at, path[i]);
        if (next && i === path.length - 1 && !canAlign(next)) next = null;
        if (next) {
          selected = i;
          break;
        }
      }
      if (!next) return path;
      out.push(path[selected]);
      at = next;
      index = selected + 1;
    }
    return out;
  };
  const direct = connect(e);
  // A coarse low-turn corridor is usually enough for long yard detours.
  // Replay its steering before accepting it; hybrid pose search remains the
  // fallback for close clearances and escapes beside an angled carrier.
  const corridor = (from: Equipment, preferSurface = false): Point[] | null => {
    const rects = [
      ...staticObstacles,
      ...machines.map((b) => boxRect(b, 0.08)),
      ...carriers.map((b) => boxRect(b, 0.08)),
      ...pedestrians.map((p) => ({ x: p.x - 0.42, z: p.z - 0.42, w: 0.84, d: 0.84 })),
    ];
    for (const clearance of e.kind === 'excavator' ? [1.4, 2.35] : [1.1, 1.94]) {
      const coarse = route(
        from,
        goal,
        rects,
        clearance,
        6500,
        preferSurface ? surfaceCost : undefined,
      );
      if (!coarse) continue;
      let at = from,
        valid = true;
      for (const q of coarse) {
        const next = advance(at, q);
        if (!next) {
          valid = false;
          break;
        }
        at = next;
      }
      if (valid && canAlign(at)) return coarse;
    }
    return null;
  };
  // Short loading approaches keep their deliberate simple geometry. On longer
  // journeys compare nearby established lanes, without searching the whole
  // yard for remote pavement or compromising any swept-footprint checks.
  const pad = Math.min(10, dist(e, goal) * 0.25);
  const nearby = (k: string) => {
    const [x, z] = k.split(',').map(Number);
    return (
      x >= Math.min(e.x, goal.x) - pad &&
      x <= Math.max(e.x, goal.x) + pad &&
      z >= Math.min(e.z, goal.z) - pad &&
      z <= Math.max(e.z, goal.z) + pad
    );
  };
  const preferSurface =
    dist(e, goal) > 8 &&
    (Object.keys(s.paving).some(nearby) ||
      Object.entries(s.groundWear ?? {}).some(([k, v]) => v > 0.08 && nearby(k)) ||
      FIXED_TRAVEL_SURFACES.some(
        (r) =>
          r.x < Math.max(e.x, goal.x) + pad &&
          r.x + r.w > Math.min(e.x, goal.x) - pad &&
          r.z < Math.max(e.z, goal.z) + pad &&
          r.z + r.d > Math.min(e.z, goal.z) - pad,
      ));
  if (direct) {
    if (preferSurface && routeCost(e, direct) > dist(e, goal) * 1.03) {
      const preferred = corridor(e, true);
      if (preferred && routeCost(e, preferred) + 0.1 < routeCost(e, direct))
        return simplify(preferred, true);
    }
    return direct;
  }
  const coarse = corridor(e, preferSurface) || (preferSurface ? corridor(e) : null);
  if (coarse) return simplify(coarse, preferSurface);
  // A machine stopped halfway through a turn may not have room to rotate to
  // any grid heading. Move along its current wheel/track axis first, creating
  // turning clearance without sweeping its rear corner into the obstruction.
  const heading = (e.yaw ?? (e.heading * Math.PI) / 2) + (e.reverse ? Math.PI : 0);
  for (const distance of [1.25, 2.5, 4, 6, 8]) {
    const point = { x: e.x + Math.cos(heading) * distance, z: e.z + Math.sin(heading) * distance };
    const next = advance(e, point);
    if (!next) break;
    const tail = connect(next) || corridor(next);
    if (tail) return simplify([point, ...tail]);
  }
  const step = 1.25,
    dirs = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];
  const bin = (yaw: number) => ((Math.round(yaw / (Math.PI / 8)) % 16) + 16) % 16;
  const key = (x: number, z: number, yaw: number) => `${x},${z},${bin(yaw)}`;
  const heap = new Heap(),
    score = new Map<string, number>(),
    parents = new Map<string, string>(),
    poses = new Map<string, Equipment>();
  const start = key(0, 0, e.yaw ?? 0);
  heap.push({ x: 0, z: 0, g: 0, f: dist(e, goal), direction: bin(e.yaw ?? 0) });
  score.set(start, 0);
  poses.set(start, { ...e });
  for (
    let loops = 0;
    heap.a.length && loops < searchLimit && steeringSteps <= steeringBudget;
    loops++
  ) {
    const node = heap.pop(),
      k = `${node.x},${node.z},${node.direction}`,
      at = poses.get(k)!;
    if (node.g !== score.get(k)) continue;
    const shortConnection = () => {
      if (dist(at, goal) >= step * 2.1) return null;
      const end = advance(at, goal);
      return end && canAlign(end) ? [{ ...goal }] : null;
    };
    const tail = loops < 8 || loops % 16 === 0 ? connect(at) : shortConnection();
    if (tail) {
      const path: Point[] = [];
      let cur = k;
      while (cur !== start) {
        const p = poses.get(cur)!;
        path.push({ x: p.x, z: p.z });
        cur = parents.get(cur)!;
      }
      return simplify([...path.reverse(), ...tail]);
    }
    for (const [dx, dz] of dirs) {
      const x = node.x + dx,
        z = node.z + dz,
        to = { x: e.x + x * step, z: e.z + z * step };
      if (to.x < -48 || to.x > 230 || to.z < -30 || to.z > 115) continue;
      const yaw = Math.atan2(dz, dx) + (e.reverse ? Math.PI : 0);
      const g =
        node.g +
        segmentTravelCost(at, to, surfaceCost) +
        Math.abs(angleDelta(at.yaw ?? 0, yaw)) * 2.5;
      const next = advance(at, to);
      if (!next) continue;
      const nk = key(x, z, next.yaw ?? 0);
      if (g >= (score.get(nk) ?? Infinity)) continue;
      score.set(nk, g);
      parents.set(nk, k);
      poses.set(nk, next);
      heap.push({ x, z, g, f: g + dist(to, goal) * 1.08, direction: bin(next.yaw ?? 0) });
    }
  }
  return null;
}

/** A tight pocket may require reversing before any forward route is possible.
 * Only commit the short retreat if its opposite-gear continuation also fits.
 * The caller retains the destination in trafficGoal and replans after retreat.
 */
export function machineRetreatRoute(
  s: State,
  e: Equipment,
  goal: Point,
  staticObstacles: Rect[],
  allowWorkerYield = false,
  finalYaw?: number,
): Point[] | null {
  const yaw = e.yaw ?? (e.heading * Math.PI) / 2;
  for (const distance of [1.25, 2.5, 4, 6]) {
    const point = { x: e.x - Math.cos(yaw) * distance, z: e.z - Math.sin(yaw) * distance };
    const retreat = machineRoute(
      s,
      { ...e, reverse: true },
      point,
      staticObstacles,
      40,
      allowWorkerYield,
      undefined,
      true,
    );
    if (retreat?.length !== 1) continue;
    const withdrawn = { ...e, ...point, yaw, reverse: false, path: [] };
    if (machineRoute(s, withdrawn, goal, staticObstacles, 250, allowWorkerYield, finalYaw))
      return retreat;
  }
  return null;
}

// Walking around a stopped vehicle needs its actual oriented footprint. An
// axis-aligned bounding box can surround a pedestrian who is already safely
// beside a turning truck, preventing every possible escape from that box.
export function walkRoute(
  s: State,
  w: Point & { id?: string },
  goal: Point,
  staticObstacles: Rect[],
  /** External railway staff may walk back to an engine waiting outside the yard. */
  allowOutsideYard = false,
): Point[] | null {
  const minX = allowOutsideYard ? -260 : -48, maxX = allowOutsideYard ? 520 : 230;
  if (goal.x < minX || goal.x > maxX || goal.z < -30 || goal.z > 115) return null;
  // A newly lowered asset may touch an existing crew position. Permit only
  // monotonically outward escape, checking every real obstacle at each step.
  const initiallyTouching = new Set(staticObstacles.filter((r) => !segmentClear(w, w, [r], 0.22)));
  const safe = (p: Point) =>
    !workerMoveBlocked(s, w, p) &&
    segmentClear(
      p,
      p,
      staticObstacles.filter((r) => !initiallyTouching.has(r)),
      0.22,
    );
  const edge = (a: Point, b: Point) => {
    const obs = staticObstacles.filter(
      (r) => !initiallyTouching.has(r) || segmentClear(a, a, [r], 0.22),
    );
    if (!segmentClear(a, b, obs, 0.22)) return false;
    const n = Math.max(1, Math.ceil(dist(a, b) / 0.18));
    let at = a;
    for (let i = 1; i <= n; i++) {
      const next = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
      if (!safe(next) || workerMoveBlocked(s, { ...w, ...at }, next)) return false;
      at = next;
    }
    return true;
  };
  if (
    !safe(goal) ||
    !segmentClear(goal, goal, staticObstacles, 0.22) ||
    workerMoveBlocked(s, { id: w.id, x: -10000, z: -10000 }, goal)
  )
    return null;
  if (edge(w, goal)) return [{ ...goal }];
  const heap = new Heap(),
    score = new Map<string, number>(),
    parent = new Map<string, string>();
  const key = (x: number, z: number) => `${x},${z}`;
  const point = (x: number, z: number) => ({ x: w.x + x * 0.5, z: w.z + z * 0.5 });
  const heuristic = (x: number, z: number) => {
    const p = point(x, z),
      dx = Math.abs(p.x - goal.x),
      dz = Math.abs(p.z - goal.z);
    // The walking graph has eight directions. Its octile distance avoids
    // exploring a broad ellipse of equally promising cells on long walks.
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * 1.01;
  };
  heap.push({ x: 0, z: 0, g: 0, f: heuristic(0, 0) });
  score.set('0,0', 0);
  for (let loops = 0; heap.a.length && loops < 22000; loops++) {
    const p = heap.pop(),
      pk = key(p.x, p.z),
      at = point(p.x, p.z);
    if (p.g !== score.get(pk)) continue;
    if (dist(at, goal) < 1.05 && edge(at, goal)) {
      const out: Point[] = [{ ...goal }];
      let cur = pk;
      while (cur !== '0,0') {
        const [x, z] = cur.split(',').map(Number);
        out.push(point(x, z));
        cur = parent.get(cur)!;
      }
      out.reverse();
      return out.filter(
        (q, i, a) =>
          i === a.length - 1 ||
          i === 0 ||
          Math.abs(
            (q.x - a[i - 1].x) * (a[i + 1].z - q.z) - (q.z - a[i - 1].z) * (a[i + 1].x - q.x),
          ) > 0.001,
      );
    }
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const x = p.x + dx,
        z = p.z + dz,
        q = point(x, z),
        k = key(x, z),
        g = p.g + Math.hypot(dx, dz) * 0.5;
      if (
        q.x < minX ||
        q.x > maxX ||
        q.z < -30 ||
        q.z > 115 ||
        g >= (score.get(k) ?? Infinity) ||
        !edge(at, q)
      )
        continue;
      score.set(k, g);
      parent.set(k, pk);
      heap.push({ x, z, g, f: g + heuristic(x, z) });
    }
  }
  return null;
}
