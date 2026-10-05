import type {
  Equipment,
  Item,
  Job,
  Point,
  RailWork,
  RailWorkPhase,
  RailWorkPose,
  Rect,
  State,
  Worker,
} from './types';
import { forkStagingWithdrawal, legacyStagingAccessible } from './legacy-rail';
import {
  claimRailBatchBuffer,
  railBatchContinues,
  railBatchSafeEnd,
  releaseRailBatchBuffer,
  syncRailBatchBuffer,
} from './rail-batch';
import { MATERIALS } from './catalog';
import { railCells, trackGeometry } from './track';
import { center, dist, overlap } from './path';
import { angleDelta, localPoint, mixAngle, smoothstep, turn } from './motion';
import {
  equipmentSweepBlocked,
  equipmentMoveBlocked,
  machineRoute,
  workerMoveBlocked,
  equipmentBoxes,
  boxOverlap,
  personTouchesBox,
  walkRoute,
} from './traffic';

export interface RailWorkAPI {
  id(s: State, type: string): string;
  obstacles(s: State): Rect[];
  movement(s: State, item: Item, qty: number, from: string, to: string, reason: string): void;
  event(s: State, type: string, entity: string, text: string): void;
  complete(s: State, j: Job): void;
  release(s: State, j: Job): void;
}

export const RAIL_PANEL_PITCH = 0.36;
/** Staging supports hold one job-owned panel, not reusable receiving capacity. */
export function railStagingStackOwned(s: State, stackId: string): boolean {
  const stack = s.stacks.find((t) => t.id === stackId);
  return s.jobs.some(
    (j) =>
      j.kind === 'rail' &&
      !['done', 'canceled'].includes(j.status) &&
      ((j.railWork?.panel.state === 'staged' && j.railWork.panel.stackId === stackId) ||
        (j.legacyRailHandoff === 'staged' && stack?.source === j.id)),
  );
}
const REACH = 4;
const surface = (s: State, p: Point) =>
  s.paving[`${Math.floor(p.x)},${Math.floor(p.z)}`] ? 0.105 : 0;
const PANEL_TRAVEL_HEIGHT = 0.65;
const BUFFER_TRAVEL_HEIGHT = 0.8;
const phaseLabels: Record<RailWorkPhase, string> = {
  'source-approach': 'Approach reserved rail panel in stock',
  'source-rig': 'Rig the rail panel on its storage stack',
  'source-lift': 'Lift rail panel from the storage stack',
  'source-clear': 'Clear the loaded rail panel from storage',
  'stage-travel': 'Carry panel to staging area',
  'stage-align': 'Align panel over staging supports',
  'stage-lower': 'Lower panel onto staging supports',
  'configure-staged-panel': 'Reposition and bolt turnout branch components',
  'legacy-fork-withdraw': 'Withdraw staging machine from the supported panel',
  'unbolt-buffer': 'Unbolt existing buffer clamps',
  'buffer-rig': 'Attach buffer lifting slings',
  'buffer-lift': 'Lift released buffer clear of track',
  'buffer-carry-aside': 'Carry buffer to temporary resting place',
  'buffer-lower-aside': 'Lower buffer beside the track',
  'panel-approach': 'Approach staged rail panel',
  'panel-rig': 'Attach rail panel lifting slings',
  'panel-lift': 'Lift rail panel from staging supports',
  'panel-carry': 'Carry rail panel to the extension',
  'panel-align': 'Align rail panel with existing track',
  'panel-lower': 'Lower rail panel into the track bed',
  'join-panel': 'Fit and tighten rail joints',
  'buffer-retrieve': 'Approach resting buffer',
  'buffer-rig-return': 'Attach slings to resting buffer',
  'buffer-lift-return': 'Lift buffer for final placement',
  'buffer-carry-end': 'Carry buffer to track end',
  'buffer-align-end': 'Align buffer over the rails',
  'buffer-lower-end': 'Lower buffer onto the rail ends',
  'fasten-buffer': 'Fasten buffer clamps',
  'cancel-panel-lift': 'Lift panel for safe cancellation',
  'cancel-panel-return': 'Return panel to staging supports',
  'cancel-panel-align': 'Align returned panel over supports',
  'cancel-panel-lower': 'Lower returned panel safely',
  complete: 'Complete',
};

const add = (p: Point, d: Point, n: number): Point => ({ x: p.x + d.x * n, z: p.z + d.z * n });
const copyPose = (p: RailWorkPose): RailWorkPose => ({ x: p.x, z: p.z, y: p.y, yaw: p.yaw });
const stepToward = (from: number, to: number, amount: number) =>
  from + Math.max(-amount, Math.min(amount, to - from));
const facing = (from: Point, to: Point) => Math.atan2(to.z - from.z, to.x - from.x);
const axis = (r: RailWork): Point => ({ x: Math.cos(r.axisYaw), z: Math.sin(r.axisYaw) });
const finalBufferPoint = (s: State, j: Job) =>
  j.railWork!.restoreOriginal ? railBatchSafeEnd(s, j) || j.railWork!.start : j.railWork!.end;
const railItem = (j: Job): Item => j.item || 'rail';
const stageYaw = (r: RailWork) => r.stageYaw ?? r.axisYaw;
const entryYaw = (r: RailWork) => r.entryYaw ?? r.axisYaw;
const finalBufferYaw = (s: State, j: Job) => {
  const r = j.railWork!;
  return r.restoreOriginal ? (railBatchSafeEnd(s, j)?.yaw ?? entryYaw(r)) : (r.endYaw ?? r.axisYaw);
};
const installedPose = (j: Job): RailWorkPose => ({ ...trackGeometry(j).pose, y: 0 });
const suppliedHand = (r: RailWork) => r.configuredHand ?? 1;

function transition(s: State, j: Job, phase: RailWorkPhase, from?: RailWorkPose) {
  const r = j.railWork!;
  r.phase = phase;
  r.clock = 0;
  r.from = from ? copyPose(from) : undefined;
  j.phase = phaseLabels[phase];
  j.reason = '';
  j.elapsed = 0;
  s.revision++;
}

function blocked(s: State, r: Rect, api: RailWorkAPI) {
  if (r.x < -12 || r.x + r.w > 220 || r.z < 7 || r.z + r.d > 110) return true;
  return (
    api.obstacles(s).some((o) => overlap(o, r, 0.15)) ||
    s.rails.some((t) => railCells(t).some((p) => overlap(r, { ...p, w: 1, d: 1 }))) ||
    s.jobs.some((j) => j.status === 'doing' && j.railWork && overlap(j.railWork.stage, r))
  );
}

function chooseStaging(s: State, j: Job, e: Equipment, api: RailWorkAPI, deferForkAccess = false) {
  const geometry = trackGeometry(j),
    c = geometry.pose;
  const stagingYaw = j.track ? (j.track.heading * Math.PI) / 2 : ((j.rotation % 2) * Math.PI) / 2;
  const baseSide = j.track
    ? { x: -Math.sin(c.yaw), z: Math.cos(c.yaw) }
    : j.rotation % 2
      ? { x: 1, z: 0 }
      : { x: 0, z: 1 };
  const forward = {
    x: Math.cos(geometry.entry.yaw + Math.PI),
    z: Math.sin(geometry.entry.yaw + Math.PI),
  };
  const start = geometry.entry;
  // This rigger must walk to the source edge before the crane ever reaches
  // its laying dock. Preview that later dock without their current idle
  // position; executed movement and boom sweeps still check every worker.
  const dockState = {
    ...s,
    workers: s.workers.filter(
      (w) => w.id !== j.worker || w.duty !== 'auto' || w.path.length || !!w.transition,
    ),
  };
  const sharedBuffer = s.jobGroups?.find(
    (g) => g.id === (j.track?.groupId || j.parentId),
  )?.railBuffer;
  const restingBuffer =
    sharedBuffer &&
    !sharedBuffer.pose.secured &&
    (j.railStageOnly || dist(sharedBuffer.latestEnd, start) < 0.02)
      ? sharedBuffer.pose
      : undefined;
  if (j.legacyRailHandoff === 'staged') {
    const stack = s.stacks.find((t) => t.id === j.stack && t.source === j.id && t.qty > 0);
    if (!stack) return undefined;
    const p = center(stack),
      delta = { x: p.x - c.x, z: p.z - c.z };
    const gap = Math.abs(delta.x * baseSide.x + delta.z * baseSide.z);
    const sign = delta.x * baseSide.x + delta.z * baseSide.z >= 0 ? 1 : -1;
    const side = { x: baseSide.x * sign, z: baseSide.z * sign };
    const stockYaw = stack.yaw ?? stagingYaw,
      stockSide = { x: -Math.sin(stockYaw) * sign, z: Math.cos(stockYaw) * sign };
    return {
      side,
      stage: { x: stack.x, z: stack.z, w: stack.w, d: stack.d },
      stageDock: add(p, stockSide, -REACH),
      railDock: add(c, side, REACH),
      bufferAside: restingBuffer
        ? { x: restingBuffer.x, z: restingBuffer.z }
        : add(add(start, side, gap), forward, j.track ? -8 : -4),
      stageYaw: stockYaw,
    };
  }
  for (const sign of [1, -1])
    for (const gap of j.track?.layout === 'curve' ? [15.5, 18.5, 21.5] : [9.5, 12.5, 15.5]) {
      const side = { x: baseSide.x * sign, z: baseSide.z * sign };
      const stageSide = { x: -Math.sin(stagingYaw) * sign, z: Math.cos(stagingYaw) * sign };
      const candidate = add(c, side, gap),
        m = MATERIALS[railItem(j)],
        w = j.rotation % 2 ? m.d : m.w,
        d = j.rotation % 2 ? m.w : m.d;
      const stage = {
        x: Math.floor(candidate.x - w / 2),
        z: Math.floor(candidate.z - d / 2),
        w,
        d,
      };
      const p = center(stage);
      const forkHandoff =
        e.kind === 'forklift' && (j.legacyRailHandoff === 'carried' || j.railStageOnly);
      const forkYaw =
        e.cargo?.yaw === undefined
          ? j.railStageOnly
            ? Math.PI / 2
            : 0
          : e.cargo.yaw - (e.yaw ?? (e.heading * Math.PI) / 2);
      const dockYaw = stagingYaw - forkYaw;
      let stageDock = forkHandoff
          ? add(p, { x: Math.cos(dockYaw), z: Math.sin(dockYaw) }, -4.2)
          : add(p, stageSide, -REACH),
        railDock = add(c, side, REACH);
      const bufferAside = restingBuffer
        ? { x: restingBuffer.x, z: restingBuffer.z }
        : add(add(start, side, gap), forward, j.track ? -8 : -4);
      const asideBox = { x: bufferAside.x - 1.5, z: bufferAside.z - 1.5, w: 3, d: 3 };
      if (
        blocked(s, stage, api) ||
        (!restingBuffer && blocked(s, asideBox, api)) ||
        overlap(stage, asideBox, 0.3)
      )
        continue;
      const obs = api.obstacles(s);
      if (
        !forkHandoff &&
        equipmentMoveBlocked(dockState, e, { ...stageDock, yaw: facing(stageDock, p) })
      )
        stageDock = add(p, stageSide, REACH);
      if (forkHandoff) {
        const parking = add(add(p, forward, -15), side, 8);
        if (
          !deferForkAccess &&
          !legacyStagingAccessible(s, e, stageDock, stage, parking, dockYaw, obs)
        )
          continue;
      } else if (
        (!machineRoute(s, e, stageDock, obs, 600, true) &&
          !machineRoute(s, { ...e, reverse: !e.reverse }, stageDock, obs, 600, true)) ||
        equipmentMoveBlocked(dockState, e, { ...railDock, yaw: facing(railDock, c) })
      )
        continue;
      return { side, stage, stageDock, railDock, bufferAside, stageYaw: stagingYaw };
    }
  return undefined;
}

function panelCrewPoints(p: Point, yaw: number, length = 5, width = 3): Point[] {
  const f = { x: Math.cos(yaw), z: Math.sin(yaw) },
    n = { x: -Math.sin(yaw), z: Math.cos(yaw) };
  const points = [add(p, f, length / 2 + 1), add(p, f, -length / 2 - 1)];
  for (const sign of [-1, 1])
    for (const along of [-length / 2 + 0.55, length / 2 - 0.55])
      points.push(add(add(p, f, along), n, sign * (width / 2 + 0.6)));
  return points;
}
function initialize(s: State, j: Job, e: Equipment, api: RailWorkAPI) {
  const forkHandoff =
    e.kind === 'forklift' &&
    (j.railStageOnly || (j.legacyRailHandoff === 'carried' && e.cargo?.item === railItem(j)));
  if (e.kind !== 'excavator' && !forkHandoff) {
    j.reason = 'Rail laying and buffer handling require an excavator';
    return false;
  }
  const geometry = trackGeometry(j);
  const start = { x: geometry.entry.x, z: geometry.entry.z };
  const end = { x: geometry.end.x, z: geometry.end.z },
    axisYaw = geometry.pose.yaw;
  const installed = j.delivered
    ? s.rails.find(
        (t) =>
          t.x === j.x &&
          t.z === j.z &&
          t.rotation === j.rotation &&
          (!j.track ||
            (t.track?.section === j.track.section &&
              t.track?.route === j.track.route &&
              t.track?.layout === j.track.layout)),
      )
    : undefined;
  let staging = chooseStaging(s, j, e, api, !!(forkHandoff && !e.cargo));
  if (!staging) {
    j.reason =
      'Rail work needs a clear staging area beside the track and an accessible machine route';
    return false;
  }
  if (
    !installed &&
    (!e.cargo || e.cargo.item !== railItem(j) || e.cargo.qty !== 1) &&
    !s.stacks.some(
      (t) => t.id === j.stack && t.item === railItem(j) && t.qty >= 1 && t.reserved >= 1,
    )
  ) {
    j.reason = 'The assigned excavator must bring the reserved rail panel to the site';
    return false;
  }
  const sourceStack =
    !e.cargo && !installed && j.legacyRailHandoff !== 'staged'
      ? s.stacks.find(
          (t) => t.id === j.stack && t.item === railItem(j) && t.qty >= 1 && t.reserved >= 1,
        )
      : undefined;
  let source: RailWork['source'];
  if (
    sourceStack &&
    s.jobs.some(
      (other) =>
        other.id !== j.id &&
        other.status === 'doing' &&
        other.railWork?.source?.stackId === sourceStack.id &&
        other.railWork.phase.startsWith('source-'),
    )
  ) {
    // One top panel and one lifting face cannot belong to two cranes at once.
    j.reason =
      'Another rail crew is lifting from this stack; waiting for the storage face to clear';
    return false;
  }
  if (sourceStack) {
    const point = center(sourceStack),
      yaw = sourceStack.yaw || 0,
      normal = { x: -Math.sin(yaw), z: Math.cos(yaw) },
      forward = { x: Math.cos(yaw), z: Math.sin(yaw) };
    const crew = s.workers.find((w) => w.id === j.worker)!;
    const material = MATERIALS[railItem(j)];
    const workerPoint = panelCrewPoints(point, yaw, material.w, material.d)
      .sort((a, b) => dist(crew, a) - dist(crew, b))
      .find((p) => !workerMoveBlocked(s, crew, p) && walkRoute(s, crew, p, api.obstacles(s)));
    if (!workerPoint) {
      j.reason = 'Crew needs access to an exposed rail-panel edge for rigging';
      return false;
    }
    const faces = [
      { direction: normal, reach: REACH },
      { direction: forward, reach: material.w / 2 + 2.5 },
    ];
    sourceFace: for (const { direction, reach } of faces)
      for (const sign of [1, -1]) {
        const dock = add(point, direction, reach * sign),
          clear = add(dock, direction, 2.5 * sign),
          approach = { ...clear };
        const parked = { ...e, ...dock, yaw: facing(dock, point), reach };
        const alignedApproach = { ...parked, ...approach, reach: 2.7, reverse: false };
        const liftedState = {
          ...s,
          stacks: s.stacks.map((t) =>
            t.id === sourceStack.id ? { ...t, qty: t.qty - 1, reserved: t.reserved - 1 } : t,
          ),
        };
        const loaded = { ...parked, cargo: { item: railItem(j), qty: 1, yaw } };
        const inward = add(dock, direction, -2.5 * sign);
        const loadedClear = machineRoute(
          liftedState,
          { ...loaded, reverse: true },
          clear,
          api.obstacles(liftedState),
          350,
          true,
        )
          ? clear
          : machineRoute(
                liftedState,
                { ...loaded, reverse: false },
                inward,
                api.obstacles(liftedState),
                350,
                true,
              )
            ? inward
            : undefined;
        if (
          !equipmentMoveBlocked(s, e, parked) &&
          !equipmentMoveBlocked(s, e, alignedApproach) &&
          (machineRoute(s, e, approach, api.obstacles(s), 450, true) ||
            machineRoute(
              s,
              { ...e, reverse: !e.reverse },
              approach,
              api.obstacles(s),
              450,
              true,
            )) &&
          machineRoute(s, alignedApproach, dock, api.obstacles(s), 250, true) &&
          loadedClear
        ) {
          source = {
            stackId: sourceStack.id,
            pose: {
              ...point,
              y:
                surface(s, point) +
                (sourceStack.baseHeight || 0) +
                Math.max(0, sourceStack.qty - 1) * RAIL_PANEL_PITCH,
              yaw,
            },
            dock,
            clear: loadedClear,
            approach,
            entering: false,
            workerPoint,
          };
          break sourceFace;
        }
      }
    if (!source) {
      j.reason = 'Reserved rail panel needs an accessible lifting face';
      return false;
    }
  }
  if (forkHandoff && source) {
    // The accessible storage face determines the rail panel's orientation on
    // its forks. Preflight staging AND the mandatory straight withdrawal with
    // that real orientation, rather than reversing an earlier guessed dock.
    const liftedState = {
      ...s,
      stacks: s.stacks.map((t) =>
        t.id === source!.stackId ? { ...t, qty: t.qty - 1, reserved: t.reserved - 1 } : t,
      ),
    };
    const loadedAtSource = {
      ...e,
      ...source.dock,
      yaw: facing(source.dock, source.pose),
      reach: dist(source.dock, source.pose),
      cargo: { item: railItem(j), qty: 1, yaw: source.pose.yaw },
    };
    staging = chooseStaging(liftedState, j, loadedAtSource, api);
    if (!staging) {
      j.reason = 'Rail-panel staging needs an accessible fork approach and straight withdrawal';
      return false;
    }
  }
  const initial = localPoint({ ...e, yaw: e.yaw ?? (e.heading * Math.PI) / 2 }, e.reach || 2.7, 0);
  const staged =
    j.legacyRailHandoff === 'staged'
      ? s.stacks.find((t) => t.id === j.stack && t.qty > 0 && t.reserved > 0)
      : undefined;
  const r: RailWork = {
    ...staging,
    phase: installed
      ? 'buffer-retrieve'
      : staged
        ? 'panel-approach'
        : source
          ? 'source-approach'
          : 'stage-travel',
    clock: 0,
    start,
    end,
    axisYaw,
    entryYaw: geometry.entry.yaw + Math.PI,
    endYaw: geometry.end.yaw,
    configuredHand: installed
      ? (j.track?.hand ?? 1)
      : (sourceStack?.trackHand ?? staged?.trackHand ?? 1),
    legacyForkYaw: forkHandoff
      ? source
        ? source.pose.yaw - facing(source.dock, source.pose)
        : (e.cargo?.yaw ?? e.yaw ?? (e.heading * Math.PI) / 2) -
          (e.yaw ?? (e.heading * Math.PI) / 2)
      : undefined,
    source,
    panel: source
      ? { ...source.pose, state: 'stored' }
      : staged
        ? {
            ...center(staged),
            y: surface(s, center(staged)) + (staged.baseHeight || 0),
            yaw: staged.yaw || 0,
            state: 'staged',
            stackId: staged.id,
          }
        : installed
          ? { ...installedPose(j), state: 'installed', railId: installed.id }
          : {
              ...initial,
              y: (e.y || 0) + Math.max(0.12, e.lift || 0.12),
              yaw: e.cargo?.yaw ?? e.yaw ?? (e.heading * Math.PI) / 2,
              state: 'carried',
            },
    lifting: installed || source || staged ? undefined : 'panel',
  };
  if (forkHandoff && source) {
    const dockYaw = stageYaw(r) - r.legacyForkYaw!;
    r.stageDock = add(center(r.stage), { x: Math.cos(dockYaw), z: Math.sin(dockYaw) }, -4.2);
  }
  if (
    !j.railStageOnly &&
    (dist(s.buffer, start) < 0.15 ||
      (installed && (j.phase === 'Relocate buffer' || j.legacyRailHandoff === 'installed')))
  ) {
    r.buffer = {
      ...s.buffer,
      y: 0.2,
      yaw: geometry.entry.yaw + Math.PI,
      id: 'BUFFER-001',
      secured: !installed,
      carried: false,
    };
  }
  claimRailBatchBuffer(s, j, r);
  if (staged && r.buffer?.secured) r.phase = 'unbolt-buffer';
  if (
    staged &&
    j.track?.layout === 'turnout' &&
    j.track.route !== 'straight' &&
    suppliedHand(r) !== j.track.hand
  )
    r.phase = 'configure-staged-panel';
  j.railWork = r;
  const crew = s.workers.find((worker) => worker.id === j.worker);
  if (crew) {
    // A prior yielding maneuver can retain a return destination beside a
    // buffer that has since been set down. This sequence owns the next real
    // walking destination; stop the stale path before requesting its rigger.
    crew.path = [];
    crew.yieldTarget = undefined;
  }
  j.phase = phaseLabels[r.phase];
  j.elapsed = 0;
  j.reason = '';
  api.event(
    s,
    'Work',
    j.id,
    installed
      ? 'Resuming physical buffer placement for the installed rail panel.'
      : 'Rail panel at site; preparing staging supports and buffer handling.',
  );
  s.revision++;
  return true;
}

function crewClearForTurn(s: State, j: Job, e: Equipment, target: Point, api: RailWorkAPI) {
  const w = s.workers.find((worker) => worker.id === j.worker);
  if (!w) return false;
  const from = e.yaw ?? (e.heading * Math.PI) / 2,
    to = facing(e, target),
    change = angleDelta(from, to);
  if (Math.abs(change) < 0.03) return true;
  // Clear the complete intended rotation before beginning it. Waiting until
  // a moving boom almost touches the rigger can trap them against the stock.
  const count = Math.max(1, Math.ceil(Math.abs(change) / (Math.PI / 18)));
  const envelope = Array.from({ length: count + 1 }, (_, i) =>
    equipmentBoxes(
      { ...e, reach: Math.max(e.reach || 2.7, dist(e, target)) },
      { ...e, yaw: from + (change * i) / count },
    ),
  ).flat();
  const safe = (p: Point) => envelope.every((b) => !personTouchesBox(p, b, 0.7));
  if (!w.path.length && safe(w)) return true;
  w.status = 'Walking clear of the excavator turning area';
  j.reason = 'Waiting for the rigging worker to clear the planned boom sweep';
  if (w.path.length) return false;
  const candidates: Point[] = [];
  for (const radius of [5.5, 7, 9])
    for (let i = 0; i < 8; i++)
      candidates.push({
        x: e.x + Math.cos((i * Math.PI) / 4) * radius,
        z: e.z + Math.sin((i * Math.PI) / 4) * radius,
      });
  for (const p of candidates.filter(safe).sort((a, b) => dist(w, a) - dist(w, b))) {
    const path = walkRoute(s, w, p, api.obstacles(s));
    if (path) {
      w.path = path;
      return false;
    }
  }
  return false;
}

function machineAt(
  s: State,
  j: Job,
  e: Equipment,
  point: Point,
  target: Point,
  dt: number,
  api: RailWorkAPI,
) {
  if (e.path.length) {
    const next = e.path[0],
      direction = facing(e, next),
      reach = e.reach || REACH;
    crewClearForTurn(
      s,
      j,
      e,
      { x: e.x + Math.cos(direction) * reach, z: e.z + Math.sin(direction) * reach },
      api,
    );
    return false;
  }
  if (dist(e, point) > 0.04) {
    let reverse = !!e.reverse;
    let path = machineRoute(s, e, point, api.obstacles(s), 450, true);
    if (!path) {
      reverse = !reverse;
      path = machineRoute(s, { ...e, reverse }, point, api.obstacles(s), 450, true);
    }
    if (!path) {
      j.reason = 'Machine route blocked during rail work; clear the approach';
      return false;
    }
    e.path = path;
    e.reverse = reverse;
    return false;
  }
  e.velocity = 0;
  if (!crewClearForTurn(s, j, e, target, api)) return false;
  const candidate = { x: e.x, z: e.z, yaw: e.yaw ?? (e.heading * Math.PI) / 2 };
  const aligned = turn(candidate, facing(e, target), dt, 1.15);
  const blocker = equipmentSweepBlocked(s, e, candidate);
  if (blocker) {
    e.blockedBy = blocker;
    j.reason = `Waiting for ${blocker} to clear the excavator turning area`;
    parkRailBlocker(s, e, blocker, target, api);
    return false;
  }
  e.blockedBy = undefined;
  e.yaw = candidate.yaw;
  e.reach = stepToward(e.reach || 2.7, dist(e, target), dt * 0.8);
  return aligned && Math.abs((e.reach || 0) - dist(e, target)) < 0.02;
}

/** An idle, occupied machine can clear a neighboring crew's actual boom sweep. */
function parkRailBlocker(s: State, e: Equipment, blocker: string, target: Point, api: RailWorkAPI) {
  const other = s.equipment.find((q) => q.id === blocker);
  if (
    !other ||
    other.path.length ||
    other.job ||
    other.cargo ||
    other.deliveryOrder ||
    other.transportOrder ||
    other.refueling ||
    other.fuel <= 0 ||
    s.elapsed < (other.trafficRetry || 0)
  )
    return;
  const op = s.workers.find(
    (w) => w.id === other.operator && w.vehicle === other.id && w.duty === 'auto',
  );
  if (!op) return;
  const from = e.yaw ?? (e.heading * Math.PI) / 2,
    change = angleDelta(from, facing(e, target));
  const sweep = Array.from({ length: 17 }, (_, i) =>
    equipmentBoxes(e, { ...e, yaw: from + (change * i) / 16 }),
  ).flat();
  const away = facing(e, other);
  for (const distance of [5, 8, 11])
    for (const offset of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const p = add(other, { x: Math.cos(away + offset), z: Math.sin(away + offset) }, distance);
      if (
        equipmentBoxes(other, { ...p, yaw: other.yaw }).some((b) =>
          sweep.some((q) => boxOverlap(b, q, 0.35)),
        )
      )
        continue;
      for (const reverse of [false, true]) {
        const path = machineRoute(s, { ...other, reverse }, p, api.obstacles(s), 150, true);
        if (!path?.length) continue;
        other.path = path;
        other.reverse = reverse;
        other.trafficReverse = reverse || undefined;
        other.trafficGoal = { ...p };
        other.trafficWait = 0;
        op.status = 'Parking clear of the neighboring rail crew';
        api.event(
          s,
          'Traffic',
          other.id,
          `${op.name} is moving ${other.id} clear of ${e.id}'s rail-handling sweep.`,
        );
        return;
      }
    }
  other.trafficRetry = s.elapsed + 1.5;
}

function workerAt(
  s: State,
  j: Job,
  w: Worker,
  point: Point,
  api: RailWorkAPI,
  alternatives: Point[] = [],
) {
  if (w.path.length || w.transition) return false;
  const candidates = [
    point,
    ...alternatives,
    ...[
      [-0.4, 0],
      [0.4, 0],
      [0, -0.4],
      [0, 0.4],
    ].map(([x, z]) => ({ x: point.x + x, z: point.z + z })),
  ].sort((a, b) => dist(w, a) - dist(w, b));
  for (const candidate of candidates) {
    if (
      workerMoveBlocked(s, w, candidate) ||
      s.equipment.some(
        (e) =>
          !e.transportOrder && equipmentBoxes(e).some((b) => personTouchesBox(candidate, b, 0.46)),
      )
    )
      continue;
    const path = walkRoute(s, w, candidate, api.obstacles(s));
    if (!path) continue;
    if (dist(w, candidate) < 0.08) return true;
    w.path = path;
    return false;
  }
  j.reason = 'Crew cannot reach an exposed rail fastener or lifting point';
  return false;
}

function crewClearForLift(
  s: State,
  j: Job,
  e: Equipment,
  w: Worker,
  load: RailWorkPose,
  buffer: boolean,
  api: RailWorkAPI,
  withdraw?: Point,
) {
  const dx = withdraw ? withdraw.x - e.x : 0,
    dz = withdraw ? withdraw.z - e.z : 0;
  const envelope = [0, 0.5, 1].flatMap((t) => [
    ...equipmentBoxes(e, { x: e.x + dx * t, z: e.z + dz * t, yaw: e.yaw }),
    {
      x: load.x + dx * t,
      z: load.z + dz * t,
      yaw: load.yaw,
      length: buffer ? 1.5 : MATERIALS[railItem(j)].w,
      width: buffer ? 2.5 : MATERIALS[railItem(j)].d,
    },
  ]);
  const safe = (p: Point) => envelope.every((b) => !personTouchesBox(p, b, 0.7));
  if (!w.path.length && safe(w)) return true;
  w.status = 'Walking clear of the attached load and machine withdrawal';
  j.reason = 'Waiting for the rigging worker to clear the lifting area';
  if (w.path.length) return false;
  const candidates: Point[] = [];
  for (const distance of [3.5, 5, 7])
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      candidates.push(localPoint(load, Math.cos(angle) * distance, Math.sin(angle) * distance));
  for (const p of candidates.filter(safe).sort((a, b) => dist(w, a) - dist(w, b))) {
    if (workerMoveBlocked(s, w, p)) continue;
    const path = walkRoute(s, w, p, api.obstacles(s));
    if (path) {
      w.path = path;
      return false;
    }
  }
  j.reason = 'Rigging worker needs a clear walking route outside the lifting area';
  return false;
}

function followLoad(
  r: RailWork,
  e: Equipment,
  object: 'panel' | 'buffer',
  dt: number,
  travelHeight?: number,
) {
  const pose = object === 'panel' ? r.panel : r.buffer!;
  const p = localPoint({ ...e, yaw: e.yaw ?? (e.heading * Math.PI) / 2 }, e.reach || REACH, 0);
  pose.x = p.x;
  pose.z = p.z;
  pose.y = stepToward(
    pose.y,
    (e.y || 0) +
      (travelHeight ?? (object === 'panel' ? PANEL_TRAVEL_HEIGHT : BUFFER_TRAVEL_HEIGHT)),
    dt * 0.25,
  );
  const targetYaw =
    object === 'buffer'
      ? ['buffer-carry-end', 'buffer-align-end'].includes(r.phase)
        ? r.restoreOriginal
          ? entryYaw(r)
          : (r.endYaw ?? r.axisYaw)
        : entryYaw(r)
      : r.phase === 'source-clear'
        ? (r.source?.pose.yaw ?? stageYaw(r))
        : ['stage-travel', 'stage-align', 'cancel-panel-return', 'cancel-panel-align'].includes(
              r.phase,
            )
          ? stageYaw(r)
          : r.axisYaw;
  pose.yaw =
    r.legacyForkYaw !== undefined
      ? (e.yaw ?? (e.heading * Math.PI) / 2) + r.legacyForkYaw
      : mixAngle(pose.yaw, targetYaw, Math.min(1, dt * 1.5));
  e.lift = pose.y - (e.y || 0);
}

function animatePose(r: RailWork, to: RailWorkPose, seconds: number, pose: RailWorkPose) {
  const from = r.from || copyPose(pose),
    f = smoothstep(r.clock / seconds);
  pose.x = from.x + (to.x - from.x) * f;
  pose.z = from.z + (to.z - from.z) * f;
  pose.y = from.y + (to.y - from.y) * f;
  pose.yaw = mixAngle(from.yaw, to.yaw, f);
  return f >= 1;
}

function stagePanel(s: State, j: Job, e: Equipment, api: RailWorkAPI) {
  const r = j.railWork!;
  const id = r.panel.stackId || api.id(s, 'stack');
  let stack = s.stacks.find((t) => t.id === id);
  if (!stack) {
    stack = {
      ...r.stage,
      id,
      item: railItem(j),
      qty: 0,
      reserved: 0,
      source: j.id,
      yaw: stageYaw(r),
      trackHand: suppliedHand(r),
    };
    s.stacks.push(stack);
  }
  stack.qty = 1;
  stack.reserved = 1;
  if (j.legacyRailHandoff === 'carried' || (j.railStageOnly && e.kind === 'forklift'))
    stack.baseHeight = 0.06;
  r.panel.stackId = id;
  r.panel.state = 'staged';
  Object.assign(r.panel, center(r.stage), {
    y: surface(s, center(r.stage)) + (stack.baseHeight || 0),
    yaw: stageYaw(r),
  });
  e.cargo = undefined;
  r.lifting = undefined;
  j.stack = id;
  api.movement(s, railItem(j), 1, e.id, id, 'Rail panel placed on temporary staging supports');
  s.revision++;
}

function collectStagedPanel(s: State, j: Job, e: Equipment, api: RailWorkAPI) {
  const r = j.railWork!,
    t = s.stacks.find((t) => t.id === r.panel.stackId);
  if (!t || t.qty !== 1 || t.reserved !== 1) {
    j.reason = 'Reserved staged rail panel is unavailable';
    return false;
  }
  t.qty = 0;
  t.reserved = 0;
  e.cargo = { item: railItem(j), qty: 1, yaw: r.panel.yaw };
  r.panel.state = 'carried';
  r.lifting = 'panel';
  j.stack = undefined;
  api.movement(s, railItem(j), 1, t.id, e.id, 'Lift staged rail panel for track installation');
  s.revision++;
  return true;
}

function finish(s: State, j: Job, api: RailWorkAPI) {
  const r = j.railWork!;
  r.phase = 'complete';
  r.clock = 0;
  r.lifting = undefined;
  r.from = undefined;
  releaseRailBatchBuffer(s, j);
  if (j.railBufferCleanup) {
    j.cancel = undefined;
    j.railBufferCleanup = undefined;
  }
  if (!j.cancel) {
    api.complete(s, j);
    return;
  }
  api.release(s, j);
  j.status = 'canceled';
  j.finished = s.time;
  j.phase =
    r.panel.state === 'stored'
      ? 'Canceled; reserved panel remains in stock'
      : r.panel.state === 'installed'
        ? 'Canceled; placed track retained and buffer secured'
        : 'Canceled; panel staged and buffer secured';
  j.reason = '';
  j.progress = r.panel.state === 'installed' ? 1 : 0;
  api.event(s, 'Work', j.id, j.phase);
  s.revision++;
}

function afterPanelStaged(s: State, j: Job, api: RailWorkAPI) {
  const r = j.railWork!;
  if (
    !j.cancel &&
    j.track?.layout === 'turnout' &&
    j.track.route !== 'straight' &&
    suppliedHand(r) !== j.track.hand
  ) {
    r.configureProgress = 0;
    transition(s, j, 'configure-staged-panel');
    return;
  }
  if (j.legacyRailHandoff === 'carried' || j.railStageOnly) {
    transition(s, j, 'legacy-fork-withdraw');
    return;
  }
  if (j.cancel) {
    if (r.buffer && !r.buffer.secured) {
      r.restoreOriginal = true;
      transition(s, j, 'buffer-retrieve');
    } else finish(s, j, api);
  } else transition(s, j, r.buffer?.secured ? 'unbolt-buffer' : 'panel-approach');
}

/**
 * Owns physical pickup and laying after the assigned machine reaches its source. The normal simulation continues
 * moving e.path and w.path; this state machine owns cargo, fastening and crane poses.
 * State.buffer remains the single BUFFER-001 asset. Its elevation is in railWork.buffer.
 */
export function tickRailWork(s: State, j: Job, dt: number, api: RailWorkAPI): boolean {
  if (j.kind !== 'rail' || j.status !== 'doing') return false;
  const e = s.equipment.find((e) => e.id === j.equipment),
    w = s.workers.find((w) => w.id === j.worker),
    op = s.workers.find((w) => w.id === j.operator);
  if (!e || !w || !op) return !!j.railWork;
  if (!j.railWork) {
    if (
      !['Collect material', 'Carry to site', 'Install', 'Relocate buffer'].includes(j.phase) ||
      e.path.length
    )
      return false;
    if (s.elapsed < (e.trafficRetry || 0)) return true;
    if (!initialize(s, j, e, api)) {
      // A blocked lifting face needs a physical change, not ten searches per second.
      e.trafficRetry = s.elapsed + 1.5;
      return true;
    }
  }
  const r = j.railWork!;
  if (e.refueling || e.fuel <= 0) {
    j.reason = 'Rail handling paused for fuel';
    return true;
  }
  if (e.operator !== op.id || op.vehicle !== e.id) {
    j.reason = `Assigned operator must remain in the ${e.kind === 'forklift' ? 'forklift' : 'excavator'}`;
    return true;
  }
  // This sequence owns the rigger's next destination. After yielding to its crane,
  // the crew must not automatically return to a fastener from an earlier phase.
  if (w.yieldingTo === e.id) w.yieldTarget = undefined;
  e.work = 1;
  op.status = phaseLabels[r.phase];
  w.status = 'Standing clear of rail handling';
  j.reason = '';
  j.elapsed += dt;
  const f = axis(r),
    entryForward = { x: Math.cos(entryYaw(r)), z: Math.sin(entryYaw(r)) },
    stagePoint = center(r.stage);
  const bufferCrewPoints = (p: RailWorkPose) =>
    [1, -1].flatMap((sign) => [-0.65, -1.05].map((along) => localPoint(p, along, sign * 2)));
  const workerPoint = (p: RailWorkPose) => bufferCrewPoints(p)[0];
  const stageForward = { x: Math.cos(stageYaw(r)), z: Math.sin(stageYaw(r)) };
  const material = MATERIALS[railItem(j)];
  const stageWorkerPoint = add(stagePoint, stageForward, material.w / 2 + 1);
  const bufferDock = (p: Point) => add(p, r.side, REACH + (j.track?.layout === 'curve' ? 0.8 : 0));

  // A cancellation never deletes a suspended object or abandons a loose buffer.
  if (j.cancel && r.panel.state !== 'installed') {
    r.restoreOriginal = true;
    if (r.panel.state === 'stored') {
      if (r.buffer && !r.buffer.secured) {
        if (!r.phase.includes('buffer')) {
          e.path = [];
          transition(s, j, 'buffer-retrieve');
        }
      } else {
        finish(s, j, api);
        return true;
      }
    }
    if (
      ['panel-lift', 'panel-carry', 'panel-align', 'panel-lower', 'join-panel'].includes(r.phase)
    ) {
      e.path = [];
      transition(s, j, 'cancel-panel-lift', r.panel);
    } else if (['panel-approach', 'panel-rig'].includes(r.phase)) {
      e.path = [];
      if (r.buffer && !r.buffer.secured) transition(s, j, 'buffer-retrieve');
      else {
        finish(s, j, api);
        return true;
      }
    } else if (r.phase === 'unbolt-buffer') {
      // Re-tighten any partly released clamps before letting the crew leave.
      transition(s, j, 'fasten-buffer');
    }
  }

  const carryingPanel = [
    'stage-travel',
    'stage-align',
    'panel-carry',
    'panel-align',
    'cancel-panel-return',
    'cancel-panel-align',
  ].includes(r.phase);
  const carryingBuffer = ['buffer-carry-aside', 'buffer-carry-end', 'buffer-align-end'].includes(
    r.phase,
  );
  if (
    carryingPanel &&
    !(r.legacyForkYaw !== undefined && ['stage-travel', 'stage-align'].includes(r.phase))
  )
    followLoad(r, e, 'panel', dt);
  if (carryingBuffer && r.buffer) followLoad(r, e, 'buffer', dt);

  if (r.phase === 'source-approach') {
    const source = r.source!;
    if (!source.approach) {
      // Earlier saves have one mixed-gear path directly to the lifting face.
      // Preserve the real poses and stock, stop that obsolete path, and begin
      // a physical clear-face approach before making the forward entry.
      const distance = dist(source.dock, source.pose);
      if (distance < 0.1) {
        j.reason = 'Saved rail-panel lifting face needs a valid approach direction';
        return true;
      }
      source.approach = add(
        source.dock,
        {
          x: (source.dock.x - source.pose.x) / distance,
          z: (source.dock.z - source.pose.z) / distance,
        },
        2.5,
      );
      source.entering = false;
      e.path = [];
      e.trafficGoal = undefined;
      e.trafficReverse = undefined;
      e.velocity = 0;
    }
    // Old saves can contain a center-only approach that fits the grid but
    // cannot fit the crane while it turns. Retain the same reserved panel,
    // replay actual steering, and try the opposite lifting face if needed.
    r.clock += dt;
    if (
      ((e.trafficWait || 0) >= 4 || !!e.blockedBy) &&
      r.clock >= 5 &&
      !s.workers.some((q) => q.id === e.blockedBy && q.path.length)
    ) {
      r.clock = 0;
      j.reason = `Waiting for ${e.blockedBy || 'an obstruction'}; checking alternate rail-panel lifting faces`;
      const normal = { x: -Math.sin(source.pose.yaw), z: Math.cos(source.pose.yaw) };
      const forward = { x: Math.cos(source.pose.yaw), z: Math.sin(source.pose.yaw) };
      for (const dock of [
        source.dock,
        add(source.pose, normal, REACH),
        add(source.pose, normal, -REACH),
        add(source.pose, forward, material.w / 2 + 2.5),
        add(source.pose, forward, -material.w / 2 - 2.5),
      ]) {
        const reach = dist(dock, source.pose);
        if (reach < 0.1) continue;
        const direction = {
          x: (dock.x - source.pose.x) / reach,
          z: (dock.z - source.pose.z) / reach,
        };
        const approach = add(dock, direction, 2.5);
        const parked = { ...e, ...dock, yaw: facing(dock, source.pose), reach };
        if (equipmentMoveBlocked(s, e, parked)) continue;
        let reverse = !!e.reverse;
        let path = machineRoute(s, e, approach, api.obstacles(s), 550, true);
        if (!path) {
          reverse = !reverse;
          path = machineRoute(s, { ...e, reverse }, approach, api.obstacles(s), 550, true);
        }
        if (!path) continue;
        const entry = machineRoute(
          s,
          { ...parked, ...approach, reach: 2.7, reverse: false },
          dock,
          api.obstacles(s),
          200,
          true,
        );
        if (!entry) continue;
        source.dock = dock;
        source.clear = approach;
        source.approach = approach;
        source.entering = false;
        e.path = path;
        e.reverse = reverse;
        e.trafficWait = 0;
        j.reason = '';
        api.event(
          s,
          'Traffic',
          j.id,
          `Replanned ${e.id} approach to reserved panel ${source.stackId} using the actual crane footprint.`,
        );
        break;
      }
    }
    if (source.approach && !source.entering) {
      const yaw = facing(source.approach, source.pose),
        alignTarget = localPoint({ ...source.approach, yaw }, 2.7, 0);
      if (machineAt(s, j, e, source.approach, alignTarget, dt, api)) {
        const path = machineRoute(
          s,
          { ...e, reverse: false },
          source.dock,
          api.obstacles(s),
          250,
          true,
        );
        if (path) {
          // Steering and gear change happen while stationary at the clear
          // approach. Every point of the final entry uses this forward gear.
          e.reverse = false;
          e.path = path;
          source.entering = true;
        } else j.reason = 'Clear the forward approach to the rail-panel lifting face';
      }
      return true;
    }
    const machineReady = machineAt(s, j, e, source.dock, source.pose, dt, api);
    const workerReady =
      machineReady &&
      workerAt(
        s,
        j,
        w,
        source.workerPoint,
        api,
        panelCrewPoints(source.pose, source.pose.yaw, material.w, material.d),
      );
    w.status = 'Walking to rig the reserved rail panel';
    if (machineReady && workerReady) transition(s, j, 'source-rig');
  } else if (r.phase === 'source-rig') {
    const source = r.source!,
      stack = s.stacks.find((t) => t.id === source.stackId);
    if (!stack || stack.qty < 1 || stack.reserved < 1) {
      j.reason = 'Reserved rail panel is unavailable';
      return true;
    }
    r.clock += dt;
    r.lifting = 'panel';
    e.lift = r.panel.y;
    w.status =
      e.kind === 'forklift'
        ? 'Checking fork bearings and securing the supported rail panel'
        : 'Attaching slings to the top rail panel';
    if (r.clock >= 3) {
      if (!crewClearForLift(s, j, e, w, r.panel, false, api, source.clear)) return true;
      stack.qty--;
      stack.reserved--;
      e.cargo = { item: railItem(j), qty: 1, yaw: r.panel.yaw };
      j.stack = undefined;
      r.panel.state = 'carried';
      api.movement(
        s,
        railItem(j),
        1,
        stack.id,
        e.id,
        e.kind === 'forklift'
          ? 'Rail panel raised on its supporting forks from storage'
          : 'Rigged rail panel lifted from its storage stack',
      );
      transition(s, j, 'source-lift', r.panel);
    }
  } else if (r.phase === 'source-lift') {
    r.clock += dt;
    if (animatePose(r, { ...r.from!, y: r.source!.pose.y + PANEL_TRAVEL_HEIGHT }, 3.5, r.panel))
      transition(s, j, 'source-clear');
    e.lift = r.panel.y - (e.y || 0);
  } else if (r.phase === 'source-clear') {
    const source = r.source!;
    followLoad(r, e, 'panel', dt, source.pose.y + PANEL_TRAVEL_HEIGHT);
    if (!e.path.length && dist(e, source.clear) > 0.04) {
      let reverse = true;
      let path = machineRoute(
        s,
        { ...e, reverse: true },
        source.clear,
        api.obstacles(s),
        350,
        true,
      );
      if (!path) {
        reverse = false;
        path = machineRoute(s, { ...e, reverse }, source.clear, api.obstacles(s), 450, true);
      }
      if (!path) {
        // A receiving machine may occupy the original withdrawal lane after
        // rigging starts. The old storage bay is physically empty after this
        // panel lifts; advance into it only when the actual loaded envelope
        // can clear every machine, remaining stack, and person along the route.
        const distance = dist(source.dock, source.pose);
        if (distance < 0.1) {
          j.reason = 'Saved rail lifting face has no valid withdrawal direction';
          return true;
        }
        const inward = add(
          source.dock,
          {
            x: (source.pose.x - source.dock.x) / distance,
            z: (source.pose.z - source.dock.z) / distance,
          },
          2.5,
        );
        path = machineRoute(s, { ...e, reverse: false }, inward, api.obstacles(s), 450, true);
        if (path) {
          source.clear = inward;
          reverse = false;
          api.event(
            s,
            'Traffic',
            j.id,
            `${e.id} will withdraw forward through the vacated storage bay; the backward loaded route is obstructed.`,
          );
        }
      }
      if (!path)
        j.reason = 'Loaded rail-panel withdrawal is blocked; clear the storage lifting lane';
      else {
        e.path = path;
        e.reverse = reverse;
      }
    } else if (!e.path.length) {
      e.reverse = false;
      transition(s, j, 'stage-travel');
    }
  } else if (r.phase === 'stage-travel' || r.phase === 'stage-align') {
    w.status = 'Standing clear of panel staging area';
    const aligned = machineAt(s, j, e, r.stageDock, stagePoint, dt, api);
    if (r.legacyForkYaw !== undefined || aligned) followLoad(r, e, 'panel', dt);
    if (aligned) {
      transition(s, j, 'stage-lower', r.panel);
    } else if (!e.path.length && r.phase === 'stage-travel') transition(s, j, 'stage-align');
  } else if (r.phase === 'stage-lower' || r.phase === 'cancel-panel-lower') {
    r.clock += dt;
    const done = animatePose(
      r,
      {
        ...stagePoint,
        y:
          surface(s, stagePoint) +
          (j.legacyRailHandoff === 'carried' || (j.railStageOnly && e.kind === 'forklift')
            ? 0.06
            : 0),
        yaw: stageYaw(r),
      },
      3.5,
      r.panel,
    );
    e.lift = r.panel.y - (e.y || 0);
    if (done) {
      stagePanel(s, j, e, api);
      afterPanelStaged(s, j, api);
    }
  } else if (r.phase === 'configure-staged-panel') {
    const ready = workerAt(
      s,
      j,
      w,
      stageWorkerPoint,
      api,
      panelCrewPoints(stagePoint, stageYaw(r), material.w, material.d),
    );
    w.status = ready
      ? 'Unbolt, reposition and rebolt supported turnout components'
      : 'Walk to supported turnout components';
    if (ready) {
      r.clock += dt;
      r.configureProgress = smoothstep(r.clock / 6);
      if (r.clock >= 6) {
        r.configuredHand = j.track!.hand;
        r.configureProgress = undefined;
        const stack = s.stacks.find((t) => t.id === r.panel.stackId);
        if (stack) stack.trackHand = r.configuredHand;
        api.event(
          s,
          'Work',
          j.id,
          `${w.name} reconfigured and bolted the supported turnout module for its ${r.configuredHand === 1 ? 'right' : 'left'} branch.`,
        );
        afterPanelStaged(s, j, api);
      }
    }
  } else if (r.phase === 'legacy-fork-withdraw') {
    const yaw = facing(r.stageDock, stagePoint);
    if (e.path.length) return true;
    if (r.clock < 1) {
      if (e.kind === 'excavator') {
        // Released slings can be lifted and the empty boom retracted. Unlike
        // forks still beneath a panel, a crane need not reverse toward the
        // running line (or the buffer) before leaving its staging position.
        e.lift = stepToward(e.lift || 0, 0.8, dt * 0.5);
        if (Math.abs(e.lift - 0.8) > 0.02) return true;
        e.reach = stepToward(e.reach || REACH, 2.7, dt * 0.8);
        if (Math.abs(e.reach - 2.7) > 0.02) return true;
      }
      let clear = r.from || localPoint({ ...r.stageDock, yaw }, -3.5, 0);
      if (dist(e, clear) > 0.08) {
        if (s.elapsed < (e.trafficRetry || 0)) {
          j.reason = 'Clear the staging machine withdrawal route beside the supported panel';
          return true;
        }
        let reverse = true,
          path =
            e.kind === 'forklift'
              ? forkStagingWithdrawal(s, { ...e, reverse }, api.obstacles(s))
              : machineRoute(s, { ...e, reverse }, clear, api.obstacles(s), 350, true);
        if (!path && e.kind === 'excavator' && !r.from) {
          const candidates = [-5.5, 5.5].map((side) =>
            localPoint({ ...r.stageDock, yaw }, 0, side),
          );
          for (const candidate of candidates) {
            reverse = false;
            path = machineRoute(s, { ...e, reverse }, candidate, api.obstacles(s), 350, true);
            if (!path) {
              reverse = true;
              path = machineRoute(s, { ...e, reverse }, candidate, api.obstacles(s), 350, true);
            }
            if (path) {
              clear = candidate;
              break;
            }
          }
        }
        if (!path) {
          j.reason = 'Clear the staging machine withdrawal route beside the supported panel';
          e.trafficRetry = s.elapsed + 1.5;
          return true;
        }
        r.from = { ...clear, y: 0, yaw };
        e.path = path;
        e.reverse = reverse;
        return true;
      }
      r.clock = 1;
      r.from = undefined;
      e.reverse = false;
      e.reach = 2.7;
    }
    const parking = add(add(stagePoint, f, -15), r.side, 8);
    if (dist(e, parking) > 0.08) {
      if (s.elapsed < (e.trafficRetry || 0)) {
        j.reason = 'Clear a parking route outside the buffer lifting area';
        return true;
      }
      const path = machineRoute(s, e, parking, api.obstacles(s), 450, true);
      if (!path) {
        j.reason = 'Clear a parking route outside the buffer lifting area';
        e.trafficRetry = s.elapsed + 1.5;
        return true;
      }
      e.path = path;
      return true;
    }
    // Ownership transfers only after the supported panel is stationary and the
    // empty forklift has withdrawn; the next excavator collects real stock.
    e.reverse = false;
    e.lift = 0.12;
    e.reach = 2.7;
    const stagedStackId = r.panel.stackId;
    api.release(s, j);
    j.legacyRailHandoff = j.cancel ? undefined : 'staged';
    j.railWork = undefined;
    j.status = j.cancel ? 'canceled' : 'todo';
    j.phase = j.cancel ? 'Canceled; imported panel staged' : 'Waiting';
    j.reason = j.cancel ? '' : 'Imported panel staged; waiting for an excavator';
    if (j.railStageOnly) {
      j.railStageOnly = false;
      j.stack = j.cancel ? undefined : stagedStackId;
      j.reason = j.cancel ? '' : 'Panel staged; waiting for the rail installation crew';
    }
    j.retryAt = undefined;
    j.retryRevision = undefined;
    api.event(
      s,
      'Work',
      j.id,
      `${e.kind === 'forklift' ? 'Forklift' : 'Excavator'} withdrew from the supported panel and released its staging crew.`,
    );
    s.revision++;
    return true;
  } else if (r.phase === 'unbolt-buffer') {
    const b = r.buffer!;
    const machineReady = machineAt(s, j, e, bufferDock(b), b, dt, api);
    const workerReady = machineReady && workerAt(s, j, w, workerPoint(b), api, bufferCrewPoints(b));
    w.status = workerReady ? 'Unbolting buffer rail clamps' : 'Walking to buffer clamps';
    if (workerReady && machineReady) {
      r.clock += dt;
      if (r.clock >= 5) {
        b.secured = false;
        api.event(s, 'Asset', 'BUFFER-001', `${w.name} released the existing buffer rail clamps.`);
        transition(s, j, 'buffer-rig');
      }
    }
  } else if (r.phase === 'buffer-rig' || r.phase === 'buffer-rig-return') {
    const b = r.buffer!;
    if (r.clock < 2.5) {
      if (
        machineAt(s, j, e, bufferDock(b), b, dt, api) &&
        workerAt(s, j, w, workerPoint(b), api, bufferCrewPoints(b))
      )
        r.clock += dt;
      r.lifting = 'buffer';
      w.status = 'Attaching buffer lifting slings';
      e.lift = b.y;
    }
    if (r.clock >= 2.5 && crewClearForLift(s, j, e, w, b, true, api)) {
      b.carried = true;
      transition(s, j, r.phase === 'buffer-rig' ? 'buffer-lift' : 'buffer-lift-return', b);
    }
  } else if (r.phase === 'buffer-lift' || r.phase === 'buffer-lift-return') {
    const b = r.buffer!;
    r.clock += dt;
    if (animatePose(r, { ...r.from!, y: BUFFER_TRAVEL_HEIGHT }, 3, b))
      transition(s, j, r.phase === 'buffer-lift' ? 'buffer-carry-aside' : 'buffer-carry-end');
    e.lift = b.y;
  } else if (r.phase === 'buffer-carry-aside') {
    if (machineAt(s, j, e, bufferDock(r.bufferAside), r.bufferAside, dt, api)) {
      followLoad(r, e, 'buffer', dt);
      transition(s, j, 'buffer-lower-aside', r.buffer!);
    }
  } else if (r.phase === 'buffer-lower-aside') {
    const b = r.buffer!;
    r.clock += dt;
    if (
      animatePose(r, { ...r.bufferAside, y: surface(s, r.bufferAside), yaw: entryYaw(r) }, 3.5, b)
    ) {
      b.carried = false;
      r.lifting = undefined;
      api.event(
        s,
        'Asset',
        'BUFFER-001',
        'Existing buffer lowered onto its temporary resting place beside the track.',
      );
      transition(s, j, j.cancel ? 'buffer-retrieve' : 'panel-approach');
    }
    e.lift = b.y;
  } else if (r.phase === 'panel-approach') {
    const machineReady = machineAt(s, j, e, r.stageDock, stagePoint, dt, api);
    const workerReady =
      machineReady &&
      workerAt(
        s,
        j,
        w,
        stageWorkerPoint,
        api,
        panelCrewPoints(stagePoint, stageYaw(r), material.w, material.d),
      );
    if (machineReady && workerReady) transition(s, j, 'panel-rig');
  } else if (r.phase === 'panel-rig') {
    r.clock += dt;
    r.lifting = 'panel';
    e.lift = 0;
    w.status = 'Attaching rail panel lifting slings';
    if (
      r.clock >= 2.5 &&
      crewClearForLift(s, j, e, w, r.panel, false, api) &&
      collectStagedPanel(s, j, e, api)
    )
      transition(s, j, 'panel-lift', r.panel);
  } else if (r.phase === 'panel-lift' || r.phase === 'cancel-panel-lift') {
    r.clock += dt;
    if (animatePose(r, { ...r.from!, y: Math.max(PANEL_TRAVEL_HEIGHT, r.from!.y) }, 3, r.panel)) {
      r.panel.state = 'carried';
      r.lifting = 'panel';
      transition(s, j, r.phase === 'panel-lift' ? 'panel-carry' : 'cancel-panel-return');
    }
    e.lift = r.panel.y - (e.y || 0);
  } else if (r.phase === 'panel-carry' || r.phase === 'panel-align') {
    if (machineAt(s, j, e, r.railDock, trackGeometry(j).pose, dt, api)) {
      followLoad(r, e, 'panel', dt);
      transition(s, j, 'panel-lower', r.panel);
    } else if (!e.path.length && r.phase === 'panel-carry') transition(s, j, 'panel-align');
  } else if (r.phase === 'cancel-panel-return' || r.phase === 'cancel-panel-align') {
    if (machineAt(s, j, e, r.stageDock, stagePoint, dt, api)) {
      followLoad(r, e, 'panel', dt);
      transition(s, j, 'cancel-panel-lower', r.panel);
    } else if (!e.path.length && r.phase === 'cancel-panel-return')
      transition(s, j, 'cancel-panel-align');
  } else if (r.phase === 'panel-lower') {
    r.clock += dt;
    if (animatePose(r, installedPose(j), 4, r.panel)) {
      r.panel.state = 'placed';
      transition(s, j, 'join-panel');
    }
    e.lift = r.panel.y - (e.y || 0);
  } else if (r.phase === 'join-panel') {
    // Work from the exposed end of the panel, outside its carried-cargo clearance box.
    const joint = add(add(r.start, entryForward, -0.75), r.side, 1.1);
    const ready = workerAt(s, j, w, joint, api);
    w.status = ready ? 'Fitting joint bars and tightening rail fasteners' : 'Walking to rail joint';
    if (ready) {
      r.clock += dt;
      if (r.clock >= 6) {
        const rid = api.id(s, 'rail');
        s.rails.push({
          id: rid,
          x: j.x,
          z: j.z,
          rotation: j.rotation,
          length: trackGeometry(j).length,
          item: railItem(j),
          ...(j.track ? { track: { ...j.track, origin: { ...j.track.origin } } } : {}),
        });
        r.panel.railId = rid;
        r.panel.state = 'installed';
        r.lifting = undefined;
        e.cargo = undefined;
        j.delivered = true;
        api.movement(
          s,
          railItem(j),
          1,
          e.id,
          rid,
          'Panel lowered into track bed and rail joints fastened',
        );
        api.event(
          s,
          'Work',
          j.id,
          `${w.name} completed the rail joints; panel ${rid} is installed.`,
        );
        s.revision++;
        syncRailBatchBuffer(s, j);
        if (r.buffer && !j.cancel && railBatchContinues(s, j)) {
          // The buffer is a stationary real obstacle beside the track. Keep it
          // there while this work order's next connected panel is installed.
          releaseRailBatchBuffer(s, j);
          r.buffer = undefined;
          finish(s, j, api);
        } else if (r.buffer) transition(s, j, 'buffer-retrieve');
        else finish(s, j, api);
      }
    }
  } else if (r.phase === 'buffer-retrieve') {
    if (!r.buffer) {
      finish(s, j, api);
      return true;
    }
    const machineReady = machineAt(s, j, e, bufferDock(r.buffer), r.buffer, dt, api);
    const workerReady =
      machineReady && workerAt(s, j, w, workerPoint(r.buffer), api, bufferCrewPoints(r.buffer));
    if (machineReady && workerReady) transition(s, j, 'buffer-rig-return');
  } else if (r.phase === 'buffer-carry-end' || r.phase === 'buffer-align-end') {
    const target = finalBufferPoint(s, j);
    if (machineAt(s, j, e, bufferDock(target), target, dt, api)) {
      followLoad(r, e, 'buffer', dt);
      transition(s, j, 'buffer-lower-end', r.buffer!);
    } else if (!e.path.length && r.phase === 'buffer-carry-end')
      transition(s, j, 'buffer-align-end');
  } else if (r.phase === 'buffer-lower-end') {
    const b = r.buffer!,
      target = finalBufferPoint(s, j);
    r.clock += dt;
    if (animatePose(r, { ...target, y: 0.2, yaw: finalBufferYaw(s, j) }, 3.5, b)) {
      b.carried = false;
      r.lifting = undefined;
      transition(s, j, 'fasten-buffer');
    }
    e.lift = b.y;
  } else if (r.phase === 'fasten-buffer') {
    const b = r.buffer!;
    const ready = workerAt(s, j, w, workerPoint(b), api, bufferCrewPoints(b));
    w.status = ready
      ? 'Tightening and checking buffer rail clamps'
      : 'Walking to buffer rail clamps';
    if (ready) {
      r.clock += dt;
      if (r.clock >= 5) {
        b.secured = true;
        b.carried = false;
        api.event(
          s,
          'Asset',
          'BUFFER-001',
          `${w.name} secured the same buffer at ${b.x.toFixed(1)}, ${b.z.toFixed(1)}.`,
        );
        finish(s, j, api);
      }
    }
  }
  if (
    !w.path.length &&
    [
      'source-rig',
      'configure-staged-panel',
      'panel-rig',
      'unbolt-buffer',
      'buffer-rig',
      'buffer-rig-return',
      'join-panel',
      'fasten-buffer',
    ].includes(r.phase)
  ) {
    const target =
      r.phase === 'source-rig'
        ? r.source!.pose
        : r.phase.includes('buffer')
          ? r.buffer!
          : r.phase === 'join-panel'
            ? r.start
            : r.panel;
    turn(w, facing(w, target), dt, 3);
  }
  if (e.cargo?.item === railItem(j) && ['carried', 'placed'].includes(r.panel.state))
    e.cargo.yaw = r.panel.yaw;
  if (r.buffer) {
    s.buffer.x = r.buffer.x;
    s.buffer.z = r.buffer.z;
    syncRailBatchBuffer(s, j);
  }
  if (j.status === 'doing')
    j.progress =
      r.panel.state === 'installed'
        ? 0.78 + Math.min(0.21, r.clock / 30)
        : r.panel.state === 'placed'
          ? 0.7
          : 0.2;
  return true;
}
