/** Engine-neutral render records. Coordinates remain the simulation's meters and radians;
 * Godot converts positive planar yaw to its negative Y rotation. No browser/Three dependency. */
import type { State, ShedPartKind } from '../src/types';
import { MATERIALS } from '../src/catalog';
import { equipmentIntent } from '../src/equipment-intent';
import { trackGeometry, trackNetwork, trackOpenPorts } from '../src/track';
import { bufferAssets } from '../src/buffers';
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
import { shedComponentPose, shedPostPoints } from '../src/shed-geometry';
import { RAIL_PANEL_PITCH } from '../src/railwork';
import { railLocationPath, railLocationPose, railLocationStatus } from '../src/rail-locations';

export function renderState(s: State) {
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
  const actors = [
    ...s.workers.map((w) => {
      const job = s.jobs.find((j) => j.status === 'doing' && j.worker === w.id);
      const pose = { x: w.x, z: w.z, y: w.y || surface(w), yaw: w.yaw ?? 0 };
      return {
        ...w,
        ...pose,
        kind: 'worker',
        visible: !w.vehicle && !['home', 'returning', 'aboard'].includes(w.shiftPhase || 'working'),
        walking: !!w.path?.length || Math.abs(w.velocity || 0) > 0.01,
        workPhase:
          job?.railWork?.phase || job?.shedAssembly?.phase || job?.handling?.phase || job?.phase,
        workClock:
          job?.railWork?.clock ||
          job?.shedAssembly?.clock ||
          job?.handling?.clock ||
          job?.elapsed ||
          0,
        fuelCan:
          job?.kind === 'refuel' && (job.fuelLiters || 0) > 0
            ? { liters: job.fuelLiters, phase: job.phase }
            : undefined,
      };
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
          pose: loadPose,
          carried: true,
        });
      }
      return {
        ...e,
        ...pose,
        visible: true,
        walking: !!e.path?.length || Math.abs(e.velocity || 0) > 0.01,
        lift,
        reach,
        toolLift: lift,
        toolReach: reach,
        forkSupportY: e.kind === 'forklift' ? pose.y + lift : undefined,
        upperYaw,
        cargoPose: loadPose,
        workPhase: rail?.phase || handling?.phase || shed?.phase || unload?.phase,
        workClock: rail?.clock || handling?.clock || shed?.clock || unload?.clock || 0,
      };
    }),
  ];
  const carriers = s.orders
    .filter((o) => !['ordered', 'done'].includes(o.status) && !o.carrierDeparted)
    .map((o) => {
      const freight = freightPose(o);
      const rail = o.mode === 'rail';
      const pose = rail
        ? carPose(o.drive?.distance ?? RAIL_STOP, 5)
        : { ...o.vehicle, yaw: o.drive?.yaw ?? 0 };
      const surface = rail ? 0 : roadSurfaceHeight(pose);
      const deck = rail
        ? { ...freight, y: 1.3, pitch: 0 }
        : deckPose({ ...freight, y: o.drive?.y ?? surface, pitch: o.drive?.pitch ?? 0 });
      const cargo = shipmentLots(o)
        .filter((l) => l.qty > 0)
        .map((l) => ({
          ...l,
          ...(rail
            ? { ...localPoint(o.railFreight ? railFreightCarPose(o, l.carIndex || 0) : freight, l.x, l.z), y: 1.3 }
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
        ...(rail && o.railFreight ? {
          locomotive: {
            id: o.railFreight.locomotiveId,
            ...pose, y: 0,
            bogies: [-2.79, 2.79].map(offset => ({ ...trackPose((o.drive?.distance ?? RAIL_STOP) + offset), y: 0 })),
          },
          cars: o.railFreight.cars.map((car, index) => ({
            ...car, ...railFreightCarPose(o, index), y: 0,
            bogies: railFreightCarBogies(o, index).map(p => ({...p,y:0})),
          })),
        } : {}),
      };
    });
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
          pose: shedComponentPose(j, kind, index),
          installed: true,
        })),
      );
      if (assembly.part) parts.push({ ...assembly.part, installed: false });
      return {
        jobId: j.id,
        kind: j.kind,
        x: j.x,
        z: j.z,
        w: j.w,
        d: j.d,
        rotation: j.rotation,
        ...assembly,
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
    loads,
    carriers,
    railCars: carriers.flatMap(c => (c as any).cars || []),
    railLocomotives: carriers.flatMap(c => (c as any).locomotive ? [(c as any).locomotive] : []),
    railGeometry,
    buffers: bufferAssets(s),
    railNetwork: trackNetwork(s),
    railOpenEndpoints: trackOpenPorts(s, false).map((p) => ({
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
