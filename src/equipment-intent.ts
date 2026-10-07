import type { Equipment, Point, Rect, State } from './types';
import { localPoint } from './motion';
import { boxRect, carrierBoxes } from './traffic';
import { equipmentFuelFiller } from './equipment-refueling';
import { machineStep } from './boarding';

export interface EquipmentIntent {
  phase: string;
  detail: string;
  target?: Point;
  targetLabel: string;
  route: Point[];
  hasRoute: boolean;
  references: string[];
  blocker?: { id: string; rect: Rect };
}
const middle = (r: Rect): Point => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });
const copy = (p: Point | undefined) => p && { x: p.x, z: p.z };

/** Read current simulation intent without inventing a route or changing a save. */
export function equipmentIntent(s: State, e: Equipment): EquipmentIntent {
  const order = s.orders.find((o) => o.unload?.equipmentId === e.id),
    job =
      s.jobs.find((j) => j.id === (e.refueling || e.job)) ||
      s.jobs.find((j) => j.equipment === e.id && j.status === 'doing');
  let phase = 'Available',
    detail = 'No active assignment',
    target: Point | undefined,
    targetLabel = 'Destination';
  const references: string[] = [];
  const collection=s.collections?.find(c=>!['done','canceled'].includes(c.status) && (c.task?.equipmentId===e.id || c.equipmentId===e.id || c.automaticEquipment===e.id));
  if(collection && !e.refueling && !(job?.kind==='refuel' && job.status==='doing')) {
    const t=collection.task;
    phase=`Collection${collection.status==='paused'?' paused':''} · ${t?.phase||collection.phase}`;
    detail=collection.note;
    references.push(collection.id,collection.carrierOrderId,...[collection.equipmentId,t?.operatorId,t?.helperId,t?.lineIndex!==undefined?collection.lines[t.lineIndex]?.stackId:undefined].filter((id):id is string=>!!id));
    if(t) {
      target=['boarding','source','rig','lift'].includes(t.phase)?t.sourceDock:
        t.phase==='clear-source'?t.sourceClear:
        ['return','return-lower'].includes(t.phase)?t.sourceDock:
        t.phase==='clear-deck'?t.withdrawalPoint||t.deckClear:
        t.phase==='equipment-clear'?t.deckClear:
        t.phase.startsWith('equipment-')||t.phase==='ramps'?t.deckDock:t.deckDock;
      if(['equipment-ramp','equipment-exit','equipment-unload'].includes(t.phase)) target=t.deck;
      targetLabel=t.phase.startsWith('equipment-')||t.phase==='ramps'?'Collection lowloader':
        ['source','rig','lift','boarding','clear-source','return','return-lower'].includes(t.phase)?'Selected collection source':'Collection truck';
    }
  } else if (order?.unload && !e.refueling) {
    const t = order.unload;
    phase = `${order.unloadPaused ? 'Delivery paused' : 'Delivery'} · ${t.phase}`;
    detail = order.note || 'Handling delivery';
    references.push(order.id, ...(t.mergeId ? [t.mergeId] : []));
    const collecting = ['boarding', 'approach', 'rig', 'lift'].includes(t.phase);
    target = collecting ? t.pickup : t.drop;
    targetLabel = collecting ? 'Pickup approach' : 'Storage approach';
  } else if (job) {
    phase = job.phase || job.kind;
    detail = job.reason || job.phase || 'Assigned work';
    references.push(job.id, ...[job.stack, job.target].filter((v): v is string => !!v));
    const h = job.handling,
      r = job.railWork;
    references.push(
      ...(r?.siteClearance?.blockers || []),
      ...(r?.routeBlockage ? [r.routeBlockage.blocker] : []),
      ...[h?.sourceId, r?.source?.stackId, r?.panel.stackId].filter((v): v is string => !!v),
    );
    if (job.kind==='refuel') {
      const barrel=s.stacks.find(t=>t.id===(job.fuelWork?.barrelId||job.stack));
      references.push(...[job.fuelWork?.barrelId].filter((v):v is string=>!!v));
      target=job.phase==='Carry fuel'?equipmentFuelFiller(e):
        ['Board equipment','Alight for fuel'].includes(job.phase)?machineStep(e):
        job.phase==='Drive to diesel barrel'&&job.fuelWork?.station?job.fuelWork.station:
        barrel?middle(barrel):undefined;
    } else if (h) {
      target = ['approach', 'rig', 'engage', 'lift'].includes(h.phase)
        ? h.sourceDock
        : h.phase === 'clear'
          ? h.sourceClear
          : h.phase === 'withdraw'
            ? h.destinationClear
            : h.destinationDock;
    } else if (r) {
      const bufferDock = (p: Point) => ({
        x: p.x + r.side.x * (4 + (job.track?.layout === 'curve' ? 0.8 : 0)),
        z: p.z + r.side.z * (4 + (job.track?.layout === 'curve' ? 0.8 : 0)),
      });
      if (r.phase.startsWith('source-'))
        target = r.phase === 'source-clear' ? r.source?.clear : r.source?.dock;
      else if (r.phase === 'legacy-fork-withdraw')
        target =
          r.clock < 1
            ? r.from ||
              localPoint({ ...r.stageDock, yaw: e.yaw ?? (e.heading * Math.PI) / 2 }, -3.5, 0)
            : {
                x: middle(r.stage).x - Math.cos(r.axisYaw) * 15 + r.side.x * 8,
                z: middle(r.stage).z - Math.sin(r.axisYaw) * 15 + r.side.z * 8,
              };
      else if (['buffer-carry-aside', 'buffer-lower-aside'].includes(r.phase))
        target = bufferDock(r.bufferAside);
      else if (
        ['buffer-carry-end', 'buffer-align-end', 'buffer-lower-end', 'fasten-buffer'].includes(
          r.phase,
        )
      )
        target = bufferDock(r.restoreOriginal ? r.start : r.end);
      else if (r.phase.startsWith('buffer-') || r.phase === 'unbolt-buffer')
        target = r.buffer ? bufferDock(r.buffer) : undefined;
      else if (
        r.phase.startsWith('stage') ||
        [
          'panel-approach',
          'panel-rig',
          'panel-lift',
          'configure-staged-panel',
          'cancel-panel-return',
          'cancel-panel-align',
          'cancel-panel-lower',
        ].includes(r.phase)
      )
        target = r.stageDock;
      else if (r.phase === 'cancel-panel-lift') target = copy(e);
      else target = r.railDock;
      if (
        r.approach &&
        target &&
        Math.hypot(target.x - r.approach.preferred.x, target.z - r.approach.preferred.z) < 0.02
      )
        target = r.approach.point;
    } else {
      const stock = !job.delivered && job.stack && s.stacks.find((t) => t.id === job.stack);
      target = job.shedAssembly?.dock || (stock ? middle(stock) : middle(job));
    }
    targetLabel = job.kind==='refuel'
      ? job.phase==='Carry fuel'?'Equipment fuel filler':job.phase==='Drive to diesel barrel'?'Fuel service position':['Board equipment','Alight for fuel'].includes(job.phase)?'Equipment cab step':'Diesel barrel'
      : !h && !r && !job.shedAssembly && !job.delivered && job.stack
        ? 'Reserved material'
        : 'Work approach';
  } else if (e.parking && e.parkingState && e.parkingState !== 'parked') {
    phase = `Parking · ${e.parkingState}`;
    detail = e.parkingReason || 'Returning to assigned parking bay';
    target = e.parking;
    targetLabel = 'Parking bay';
  } else if (e.transportOrder) {
    phase = 'Equipment delivery';
    detail = s.orders.find((o) => o.id === e.transportOrder)?.note || 'On delivery carrier';
    references.push(e.transportOrder);
  }
  if (e.path.length) {
    target = e.path[e.path.length - 1];
    if (order?.unloadPaused) targetLabel = 'Manual drive destination';
    if (e.trafficGoal) targetLabel = 'Clearance maneuver';
    if (phase === 'Available') {
      phase = 'Driving';
      detail = 'Following planned route';
    }
  } else if (e.trafficGoal) {
    target = e.trafficGoal;
    targetLabel = 'Clearance maneuver';
  } else if (e.destination && !job && !collection) target = e.destination;
  const blockedId = e.blockedBy?.match(/(?:EQ|WRK|STK|BLD|RAIL|PO|BUFFER)-\d+/)?.[0];
  let blocker: EquipmentIntent['blocker'];
  if (blockedId) {
    const asset = [...s.equipment, ...s.workers, ...s.stacks, ...s.buildings, ...s.rails].find(
      (a) => a.id === blockedId,
    );
    const p = asset || (blockedId === 'BUFFER-001' ? s.buffer : undefined);
    const order = s.orders.find((o) => o.id === blockedId);
    if (order && !order.carrierDeparted) {
      const boxes = carrierBoxes(order).map((b) => boxRect(b));
      if (boxes.length) {
        const x = Math.min(...boxes.map((r) => r.x)),
          z = Math.min(...boxes.map((r) => r.z));
        blocker = {
          id: blockedId,
          rect: {
            x,
            z,
            w: Math.max(...boxes.map((r) => r.x + r.w)) - x,
            d: Math.max(...boxes.map((r) => r.z + r.d)) - z,
          },
        };
      }
    }
    if (p)
      blocker = {
        id: blockedId,
        rect:
          'w' in p
            ? { x: p.x, z: p.z, w: (p as Rect).w, d: (p as Rect).d }
            : { x: p.x - 1, z: p.z - 1, w: 2, d: 2 },
      };
    references.push(blockedId);
  }
  if (e.blockedBy && !detail.includes(e.blockedBy))
    detail = `Waiting for ${e.blockedBy}. ${detail}`;
  return {
    phase,
    detail,
    target: copy(target),
    targetLabel,
    route: e.path.slice(0, 512).map((p) => ({ ...p })),
    hasRoute: e.path.length > 0,
    references: [...new Set(references)],
    blocker,
  };
}
