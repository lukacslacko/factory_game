import { electricalRender, electricalToolPose } from './electrical-render';
import { collectionLots } from '../src/collection';
/** Engine-neutral render records. Coordinates remain the simulation's meters and radians;
 * Godot converts positive planar yaw to its negative Y rotation. No browser/Three dependency. */
import type { State, ShedPartKind } from '../src/types';
import { MATERIALS } from '../src/catalog';
import { equipmentIntent } from '../src/equipment-intent';
import {
  trackGeometry,
  trackNetwork,
  trackOpenPorts,
  sidingAccessSpans,
  mainlineExitCommissioned,
} from '../src/track';
import { bufferAssets } from '../src/buffers';
import { processRows, processHosePaths } from '../src/process-fluids';
import { processAssemblyRender } from '../src/process-construction';
import { freightPose, shipmentLots, stackHeight } from '../src/delivery';
import { railFreightCarPose, railFreightCarBogies } from '../src/rail-freight';
import {
  angleDelta,
  carPose,
  COUPLED_CENTERS,
  deckPose,
  deliveryKind,
  localPoint,
  RAIL_STOP,
  roadSurfaceHeight,
  smoothstep,
  trackPose,
} from '../src/motion';
import { shedComponentPose, shedPostPoints, shedPartLimits } from '../src/shed-geometry';
import { RAIL_PANEL_PITCH } from '../src/railwork';
import { railLocationPath, railLocationPose, railLocationStatus } from '../src/rail-locations';
import { workerFuelCan } from './fuel-can-render';

export function renderState(s: State) {
  const electrical=electricalRender(s);
  // Simulation advances a carrying pose before moving the machine in that tick.
  // Sample its exact attachment from the current chassis for rendering, keeping
  // physical hoist height/orientation; never mutate a game/save record.
  const railPoses = new Map(
    s.jobs
      .filter((j) => j.railWork && !['done', 'canceled'].includes(j.status))
      .map((j) => {
        const r = j.railWork!,
          e = s.equipment.find((e) => e.id === j.equipment);
        const panel = { ...r.panel },
          buffer = r.buffer && { ...r.buffer };
        let attachment: any;
        if (e) {
          const movingPanel =
            [
              'source-clear',
              'stage-travel',
              'stage-align',
              'panel-carry',
              'panel-align',
              'cancel-panel-return',
              'cancel-panel-align',
            ].includes(r.phase) && panel.state === 'carried';
          const movingBuffer =
            ['buffer-carry-aside', 'buffer-carry-end', 'buffer-align-end'].includes(r.phase) &&
            buffer?.carried;
          if (movingPanel || movingBuffer) {
            const p = localPoint(
              { ...e, yaw: e.yaw ?? (e.heading * Math.PI) / 2 },
              e.reach || 4,
              0,
            );
            if (movingPanel) Object.assign(panel, p);
            if (movingBuffer) Object.assign(buffer!, p);
            attachment = {
              equipmentId: e.id,
              object: movingBuffer ? 'buffer' : 'panel',
              x: e.reach || 4,
              z: 0,
            };
          }
        }
        return [j.id, { ...r, panel, buffer, attachment }] as const;
      }),
  );
  const surface = (p: { x: number; z: number }) =>
    s.paving[`${Math.floor(p.x)},${Math.floor(p.z)}`] ? 0.105 : 0;
  const loads: any[] = [];
  const groundTasks = [
    ...s.orders.map(o => o.railFreight?.coupling),
    ...(s.shunters || []).map(e => e.coupling),
    ...(s.shunters || []).map(e => e.handover),
    ...(s.railReturns || []).map(r => r.coupling),
    ...(s.railServiceCrew || []).map(c => c.task),
  ].filter(t => t && t.phase !== 'done');
  const process = processRows(s);
  const processOperations = process.operations || [];
  const actors = [
    ...s.workers.map((w) => {
      const job = s.jobs.find((j) => j.status === 'doing' && j.worker === w.id);
      const groundTask = groundTasks.find(t => t!.workerId === w.id);
      const processTask = processOperations.find(t => t.workerId === w.id && !t.finished);
      const collectionTask = s.collections?.find(c=>c.task?.helperId===w.id || c.task?.operatorId===w.id)?.task;
      const pose = { x: w.x, z: w.z, y: w.y || surface(w), yaw: w.yaw ?? 0 };
      const fuelCan = workerFuelCan(s, w, job);
      const electricalWork=s.electrical?.runs.find(r=>r.workerId===w.id && !['commissioned','canceled'].includes(r.status));
      return {
        ...w,
        ...pose,
        kind: 'worker',
        visible: !w.vehicle && !['home', 'returning', 'aboard'].includes(w.shiftPhase || 'working'),
        walking: !!w.path?.length || Math.abs(w.velocity || 0) > 0.01 || (collectionTask?.phase==='equipment-exit' && collectionTask.clock>2),
        workPhase:
          (electricalWork ? `electrical-${electricalWork.phase}` : undefined) || (collectionTask && ['rig','secure'].includes(collectionTask.phase) ? 'rail-fastening' : undefined) || (processTask ? 'rail-fastening' : undefined) || (groundTask?.phase === 'working' ? 'rail-fastening' : undefined) || job?.railWork?.phase || job?.processAssembly?.phase || job?.shedAssembly?.phase || job?.handling?.phase || job?.phase,
        workClock:
          fuelCan?.clock || electricalWork?.clock || collectionTask?.clock || processTask?.clock || groundTask?.clock || job?.railWork?.clock || job?.processAssembly?.clock ||
          job?.shedAssembly?.clock ||
          job?.handling?.clock ||
          job?.elapsed ||
          0,
        fuelCan,
        electricalWork: electricalWork ? {phase:electricalWork.phase,clock:electricalWork.clock,cableInHand:electricalWork.cableInHand,point:electricalWork.workPoint} : undefined,
      };
    }),
    ...(s.railServiceCrew || []).map(w => {
      const task = groundTasks.find(t => t!.workerId === w.id);
      return { ...w, kind: 'worker', y: w.y || surface(w), yaw: w.yaw || 0,
        visible: !['aboard', 'left-site'].includes(w.phase), walking: !!w.path.length || (w.velocity || 0) > 0.01,
        workPhase: task?.phase === 'working' ? 'rail-fastening' : undefined,
        workClock: task?.clock || 0, serviceCrew: true };
    }),
    ...s.equipment.map((e) => {
      let pose = {
        x: e.x,
        z: e.z,
        y: e.y || surface(e),
        yaw: e.yaw ?? (e.heading * Math.PI) / 2,
        pitch: e.pitch ?? 0,
      };
      const transport = e.transportOrder && s.orders.find((o) => o.id === e.transportOrder);
      if (transport && transport.deployment !== 'offload') {
        const freight = freightPose(transport);
        pose = {
          ...deckPose({
            ...freight,
            y: transport.drive?.y ?? 0,
            pitch: transport.drive?.pitch ?? 0,
          }),
          pitch: transport.drive?.pitch ?? 0,
        };
      }
      const job = s.jobs.find((j) => j.status === 'doing' && j.equipment === e.id);
      const rail = job && railPoses.get(job.id),
        handling = job?.handling,
        shed = job?.shedAssembly;
      const order = s.orders.find((o) => o.unload?.equipmentId === e.id),
        unload = order?.unload;
      const collectionTask = s.collections?.find(c=>c.task?.equipmentId===e.id)?.task;
      let lift = e.lift ?? 0.12,
        reach = e.reach ?? 2.7,
        upperYaw = 0;
      if (e.kind === 'excavator') {
        lift = e.path.length || e.job || e.deliveryOrder ? 2 : 0.5;
        reach = e.path.length || e.job || e.deliveryOrder ? 2.1 : 2.7;
      }
      let loadPose: { x: number; z: number; y: number; yaw: number } | undefined;
      if (unload?.cargo && e.cargo) {
        loadPose = { ...unload.cargo };
        if (['clear', 'carry'].includes(unload.phase))
          loadPose = {
            ...localPoint(pose, e.reach ?? 2.7, 0),
            y: unload.cargo.y,
            yaw: pose.yaw + Math.PI / 2,
          };
        lift =
          loadPose.y -
          pose.y +
          (e.kind === 'excavator' ? stackHeight(e.cargo.item, e.cargo.qty) + 0.7 : 0);
        reach = Math.hypot(loadPose.x - pose.x, loadPose.z - pose.z);
      }
      if (e.kind === 'excavator' && unload && !loadPose) {
        const item = unload.item || order?.item;
        const material = item && (MATERIALS as any)[item];
        const height = material ? stackHeight(item as any, unload.qty) : 0;
        const safeReach = Math.min(
          2.1,
          Math.max(
            1.2,
            Math.hypot(unload.pickup.x - unload.source.x, unload.pickup.z - unload.source.z) -
              (material?.d || 1) / 2 -
              0.8,
          ),
        );
        if (unload.phase === 'rig') {
          lift = 2 + (unload.sourceY - pose.y + height + 0.7 - 2) * smoothstep(unload.clock / 1.25);
          reach =
            safeReach + ((e.reach ?? 2.7) - safeReach) * smoothstep((unload.clock - 1.25) / 1.25);
        } else if (unload.phase === 'back-away') lift = unload.destinationY - pose.y + height + 0.7;
        else {
          lift = 2;
          reach = safeReach;
        }
      }
      if (rail?.lifting) {
        const railLoad = rail.lifting === 'buffer' ? rail.buffer : rail.panel;
        if (railLoad) {
          const anchor = rail.lifting === 'buffer' ? localPoint(railLoad, 0.45, 0) : railLoad;
          lift =
            railLoad.y +
            (rail.lifting === 'buffer'
              ? 1.05
              : 0.325 + ((rail.stagingBatch?.qty || 1) - 1) * RAIL_PANEL_PITCH) +
            0.7 -
            pose.y;
          reach = Math.hypot(anchor.x - pose.x, anchor.z - pose.z);
          // Chassis yaw accumulates full revolutions. Blend only the physical
          // relative swivel, or a half-finished rigging move unwinds that history.
          upperYaw = -angleDelta(pose.yaw, Math.atan2(anchor.z - pose.z, anchor.x - pose.x));
          if (
            e.kind === 'excavator' &&
            ['source-rig', 'panel-rig', 'buffer-rig', 'buffer-rig-return'].includes(rail.phase)
          ) {
            const f = smoothstep(rail.clock / (rail.phase === 'source-rig' ? 3 : 2.5));
            lift = 2 + (lift - 2) * f;
            reach = 2.1 + (reach - 2.1) * f;
            upperYaw *= f;
          }
          if (e.kind === 'forklift') {
            lift = railLoad.y + 0.015 - pose.y;
            upperYaw = 0;
          }
        }
      }
      if (handling) {
        lift = handling.toolLift;
        reach = handling.toolReach;
        if (handling.state === 'carried') {
          lift = handling.pose.y - pose.y + (e.kind === 'excavator' ? 0.82 : 0);
          reach = Math.hypot(handling.pose.x - pose.x, handling.pose.z - pose.z);
          if (e.kind === 'excavator')
            upperYaw = -angleDelta(
              pose.yaw,
              Math.atan2(handling.pose.z - pose.z, handling.pose.x - pose.x),
            );
        }
      }
      if (
        shed?.part &&
        e.kind === 'excavator' &&
        ['rig', 'lift', 'carry', 'lower', 'fasten'].includes(shed.phase)
      ) {
        const p = shed.part,
          top =
            p.kind === 'post' ? 2.15 : p.kind === 'wall' ? 1.9 : p.kind === 'brace' ? 1.95 : 0.4;
        lift = p.pose.y - pose.y + top + 0.7;
        reach = Math.hypot(p.pose.x - pose.x, p.pose.z - pose.z);
        upperYaw = -angleDelta(pose.yaw, Math.atan2(p.pose.z - pose.z, p.pose.x - pose.x));
        if (shed.phase === 'rig') {
          const f = smoothstep(shed.clock / 2);
          lift = 2 + (lift - 2) * f;
          reach = 2.1 + (reach - 2.1) * f;
          upperYaw *= f;
        }
      }
      if (e.kind === 'forklift') {
        const item = e.cargo?.item || unload?.item || job?.item;
        const offset =
          item === 'slab'
            ? 0.08
            : item?.startsWith('rail')
              ? 0.015
              : item === 'diesel'
                ? 0.01
                : 0.04;
        if (rail?.lifting && rail.lifting === 'panel') lift = rail.panel.y - pose.y + 0.015;
        else if (handling?.state === 'carried') lift = handling.pose.y - pose.y + offset;
        else if (loadPose) lift = loadPose.y - pose.y + offset;
        else if (unload?.phase === 'rig')
          lift = 0.12 + (unload.sourceY - pose.y + offset - 0.12) * smoothstep(unload.clock / 2.5);
      }
      if (collectionTask?.cargo && e.cargo) {
        loadPose={...collectionTask.cargo};
        reach=Math.hypot(loadPose.x-pose.x,loadPose.z-pose.z);
        lift=loadPose.y-pose.y+(e.kind==='excavator'?stackHeight(e.cargo.item,e.cargo.qty)+0.7:0);
        if(e.kind==='excavator') upperYaw=-angleDelta(pose.yaw,Math.atan2(loadPose.z-pose.z,loadPose.x-pose.x));
      }
      if (e.cargo && !rail && !handling) {
        loadPose ||= {
          ...localPoint(pose, e.reach ?? 2.7, 0),
          y: pose.y + Math.max(0.12, e.lift ?? 0.12),
          yaw: pose.yaw + Math.PI / 2,
        };
        loads.push({
          id: `${e.id}-load`,
          parentEquipmentId: e.id,
          item: e.cargo.item,
          qty: e.cargo.qty,
          cableMeters: e.cargo.item==='cableReel' ? s.stacks.find(stack=>stack.electricalCarriedBy===s.electrical?.runs.find(r=>r.equipmentId===e.id)?.jobId)?.cableMeters ?? (collectionTask?.lineIndex!==undefined?s.collections?.find(c=>c.task===collectionTask)?.lines[collectionTask.lineIndex]?.sourceSnapshot?.cableMeters:undefined) ?? 50 : undefined,
          hand: collectionTask?.lineIndex!==undefined?s.collections?.find(c=>c.task===collectionTask)?.lines[collectionTask.lineIndex]?.trackHand:undefined,
          pose: loadPose,
          carried: true,
        });
      }
      const electricalWork=s.electrical?.runs.find(r=>r.equipmentId===e.id && !['commissioned','canceled'].includes(r.status));
      const electricalTool=electricalWork&&electricalToolPose(electricalWork,e);
      if(electricalTool && !e.path.length && e.kind==='excavator') {lift=electricalTool.lift;reach=electricalTool.reach;upperYaw=-angleDelta(pose.yaw,Math.atan2(electricalTool.point.z-e.z,electricalTool.point.x-e.x));}
      if(electricalWork && e.kind==='excavator' && e.cargo){
        lift=(e.lift??.12)+(e.cargo.item==='cableReel'?.47:stackHeight(e.cargo.item,e.cargo.qty))+.7;
        reach=e.reach??2.7;
      }else if(electricalWork?.phase==='reel-rig' && e.kind==='excavator'){
        lift=2+(.47+.7-2)*smoothstep(electricalWork.clock/3);reach=e.reach??2.7;
      }
      return {
        ...e,
        ...pose,
        visible: true,
        walking: !!e.path?.length || Math.abs(e.velocity || 0) > 0.01,
        lift,
        reach,
        soilInBucketM3: electricalWork?.soilInBucketM3 || 0,
        toolLift: lift,
        toolReach: reach,
        forkSupportY: e.kind === 'forklift' ? pose.y + lift : undefined,
        upperYaw,
        cargoPose: loadPose,
        workPhase: electricalWork?.phase || rail?.phase || handling?.phase || shed?.phase || unload?.phase || collectionTask?.phase,
        workClock: electricalWork?.clock || rail?.clock || handling?.clock || shed?.clock || unload?.clock || collectionTask?.clock || 0,
      };
    }),
  ];
  const carriers = s.orders
    .filter(
      (o) =>
        !['ordered', 'done'].includes(o.status) &&
        (!o.carrierDeparted ||
          (o.mode === 'rail' && o.railFreight?.cars.some((car) => !car.returned))),
    )
    .map((o) => {
      const freight = freightPose(o);
      const rail = o.mode === 'rail';
      const pose = rail
        ? o.railFreight?.locomotivePose || carPose(o.drive?.distance ?? RAIL_STOP, 5)
        : { ...o.vehicle, yaw: o.drive?.yaw ?? 0 };
      const surface = rail ? 0 : roadSurfaceHeight(pose);
      const deck = rail
        ? { ...freight, y: 1.3, pitch: 0 }
        : deckPose({ ...freight, y: o.drive?.y ?? surface, pitch: o.drive?.pitch ?? 0 });
      const cargo = (o.collectionId ? collectionLots(s,o) : shipmentLots(o))
        .filter((l) => l.qty > 0 && !o.railFreight?.cars[l.carIndex || 0]?.returned)
        .map((l) => ({
          ...l,
          hand: 'trackHand' in l ? l.trackHand : 1,
          cableMeters: o.collectionId && 'lineIndex' in l ? s.collections?.find(c=>c.id===o.collectionId)?.lines[l.lineIndex]?.sourceSnapshot?.cableMeters : undefined,
          ...(rail
            ? {
                ...localPoint(
                  o.railFreight ? railFreightCarPose(o, l.carIndex || 0) : freight,
                  l.x,
                  l.z,
                ),
                y: 1.3,
              }
            : deckPose(
                { ...freight, y: o.drive?.y ?? surface, pitch: o.drive?.pitch ?? 0 },
                l.x,
                1.15,
              )),
          yaw: rail && o.railFreight ? railFreightCarPose(o, l.carIndex || 0).yaw : freight.yaw,
          pitch: deck.pitch,
        }));
      const equipment = o.equipmentId ? s.equipment.find((e) => e.id === o.equipmentId) : undefined;
      return {
        id: o.id,
        kind: deliveryKind(o),
        item: o.item,
        mode: o.mode,
        status: o.status,
        ...pose,
        y: o.drive?.y ?? surface,
        pitch: o.drive?.pitch ?? 0,
        travel: o.drive?.travel ?? 0,
        reverse: o.drive?.reverse ?? false,
        freight: { ...freight, y: surface, deck },
        cargo,
        ramp: o.ramp ?? 0,
        deployment: o.deployment,
        equipment,
        unloading: o.unload,
        ...(rail && o.railFreight
          ? {
              locomotive:
                o.railFreight.locomotivePhase === 'gone'
                  ? null
                  : {
                      id: o.railFreight.locomotiveId,
                      driverVisible: !(s.railServiceCrew || []).some(c => c.locomotiveId === o.railFreight!.locomotiveId && c.phase !== 'aboard'),
                      ...(o.railFreight.locomotivePose || pose),
                      y: 0,
                      bogies:
                        o.railFreight.locomotiveBogies ||
                        [-2.79, 2.79].map((offset) => ({
                          ...(o.railFreight!.locomotivePose
                            ? {
                                ...localPoint(o.railFreight!.locomotivePose, offset, 0),
                                yaw: o.railFreight!.locomotivePose.yaw,
                              }
                            : trackPose((o.drive?.distance ?? RAIL_STOP) + offset)),
                          y: 0,
                        })),
                    },
              cars: o.railFreight.cars
                .map((car, index) => ({
                  ...car,
                  ...railFreightCarPose(o, index),
                  y: 0,
                  bogies: railFreightCarBogies(o, index).map((p) => ({ ...p, y: 0 })),
                }))
                .filter((car) => !car.returned),
            }
          : {}),
      };
    });
  const railShunters = (s.shunters || [])
    .filter((shunter) => shunter.phase !== 'ordered')
    .map((shunter) => ({
      ...shunter,
      kind: 'railShunter',
      y: 0,
      visible: true,
      bogies:
        shunter.bogies ||
        [-2.79, 2.79].map((offset) => ({
          ...localPoint(shunter, offset, 0),
          yaw: shunter.yaw || 0,
          y: 0,
        })),
    }));
  // The pickup locomotive is a distinct physical supplier asset. Its assigned
  // cars remain keyed to their original orders so collection never duplicates them.
  for (const pickup of (s.railReturns || []).filter((p) => p.phase !== 'done')) {
    carriers.push({
      id: pickup.id,
      kind: 'rail',
      mode: 'rail',
      status: pickup.phase,
      x: pickup.x,
      z: pickup.z,
      y: 0,
      yaw: pickup.yaw,
      cargo: [],
      cars: [],
      locomotive: {
        id: pickup.locomotiveId,
        driverVisible: !(s.railServiceCrew || []).some(c => c.locomotiveId === pickup.locomotiveId && c.phase !== 'aboard'),
        inspectId: pickup.id,
        x: pickup.x,
        z: pickup.z,
        yaw: pickup.yaw,
        y: 0,
        bogies:
          pickup.bogies ||
          [-2.79, 2.79].map((offset) => ({
            ...localPoint(pickup, offset, 0),
            yaw: pickup.yaw || 0,
            y: 0,
          })),
      },
    } as any);
  }
  const railGeometry = [
    ...s.rails.map((r) => ({
      id: r.id,
      geometry: trackGeometry(r),
      planned: false,
      route: r.selectedRoute,
    })),
    ...s.jobs
      .filter((j) => j.kind === 'rail' && j.track && !['done', 'canceled'].includes(j.status))
      .map((j) => ({ id: j.id, geometry: trackGeometry(j.track!), planned: true })),
  ];
  const railWork = s.jobs
    .filter((j) => j.railWork && !['done', 'canceled'].includes(j.status))
    .map((j) => ({ jobId: j.id, equipmentId: j.equipment, ...railPoses.get(j.id) }));
  const construction = s.jobs
    .filter((j) => j.handling && !['done', 'canceled'].includes(j.status))
    .map((j) => ({
      jobId: j.id,
      equipmentId: j.equipment,
      item: j.item || j.kind,
      qty: j.qty,
      ...j.handling,
    }));
  const sheds = s.jobs
    .filter((j) => j.shedAssembly && !['done', 'canceled'].includes(j.status))
    .map((j) => {
      const assembly = j.shedAssembly!;
      const counts: [ShedPartKind, number][] = [
        ['post', assembly.posts],
        ['beam', assembly.beams],
        ['roof', assembly.roofSheets],
        ['wall', assembly.wallPanels],
        ['brace', assembly.braces],
      ];
      const parts = counts.flatMap(([kind, count]) =>
        Array.from({ length: count }, (_, index) => ({
          kind,
          index,
          assetId:assembly.componentIds?.[`${kind}/${index}`],
          pose: shedComponentPose(j, kind, index),
          installed: true,
        })),
      );
      if (assembly.part) parts.push({ ...assembly.part, assetId:assembly.componentIds?.[`${assembly.part.kind}/${assembly.part.index}`], installed: false });
      return {
        jobId: j.id,
        kind: j.kind,
        x: j.x,
        z: j.z,
        w: j.w,
        d: j.d,
        rotation: j.rotation,
        ...assembly,
        limits:shedPartLimits(j),
        anchorPoses: shedPostPoints(j)
          .slice(0, assembly.anchors)
          .map((p) => ({ ...p, y: surface(p) + 0.025 })),
        parts,
      };
    });
  const railLocations = (s.railLocations || []).map((l) => ({
    id: l.id,
    pose: railLocationPose(s, l),
    path: railLocationPath(s, l),
    status: railLocationStatus(s, l),
  }));
  const equipmentIntents = s.equipment.map((e) => ({ id: e.id, ...equipmentIntent(s, e) }));
  return {
    actors,
    electrical,
    processAssemblies: s.jobs.filter(j => j.status === 'doing' && j.processAssembly).map(j => ({...processAssemblyRender(j), equipmentId:j.equipment})),
    processRows: [...process.tanks,...process.pumps,...process.lines,...process.valves,...process.gauges].map(row=>({...row,...(electrical.consumers.find(c=>c.id===row.id)||{})})),
    processHoses: processHosePaths(s),
    railShunters,
    loads,
    carriers,
    railCars: carriers.flatMap((c) => (c as any).cars || []),
    railLocomotives: carriers.flatMap((c) =>
      (c as any).locomotive ? [(c as any).locomotive] : [],
    ),
    railGeometry,
    sidingCuts: sidingAccessSpans(s).filter((a) => a.complete),
    mainlineExitCut: mainlineExitCommissioned(s),
    buffers: bufferAssets(s),
    railNetwork: trackNetwork(s),
    railOpenEndpoints: trackOpenPorts(s, false, false).map((p) => ({
      id: `END:${p.assetId}:${p.portIndex}`,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      trackId: p.assetId,
      route: p.route,
      occupiedBy: bufferAssets(s).find(
        (b) => b.secured && !b.carried && Math.hypot(b.x - p.x, b.z - p.z) < 0.1,
      )?.id,
    })),
    railWork,
    construction,
    sheds,
    railLocations,
    equipmentIntents,
  };
}
