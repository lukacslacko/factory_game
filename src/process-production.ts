import type { State } from './types';
import type { ProcessReactor, ProcessTank } from './process-types';
import { electricalConsumerPower } from './electrical-network';
import { processNetworkRoute, reconcileProcessAssets, moveContainedLiquid } from './process-fluids';

export const REACTOR_CAPACITY = 1000;
export const REACTOR_SECONDS = 60;
export const REACTOR_RATE = 5;
const next = (s: State, prefix: string) => `${prefix}-${String(s.next++).padStart(4, '0')}`;
export function configureProcessReactor(
  s: State,
  id: string,
  options: { inputTankId?: string; outputTankId?: string; batchSize?: number },
) {
  reconcileProcessAssets(s);
  const r = s.process?.reactors?.find((r) => r.id === id);
  if (!r) return 'Select an installed batch reactor.';
  if (r.enabled || r.phase !== 'idle' || r.liters > 1e-8)
    return 'Finish the current batch and stop the reactor before changing its tanks or batch size.';
  const input = options.inputTankId ?? r.inputTankId,
    output = options.outputTankId ?? r.outputTankId;
  if (
    (input && !s.process!.tanks.some((t) => t.id === input)) ||
    (output && !s.process!.tanks.some((t) => t.id === output))
  )
    return 'Select installed feed and product tanks.';
  if (input && input === output) return 'Feed and product need separate tanks.';
  if (
    options.batchSize !== undefined &&
    (!Number.isInteger(options.batchSize) ||
      options.batchSize < 100 ||
      options.batchSize > REACTOR_CAPACITY)
  )
    return 'Choose a whole batch size from 100 to 1,000 L.';
  r.inputTankId = input;
  r.outputTankId = output;
  r.batchSize = options.batchSize ?? r.batchSize;
  r.status = 'Stopped';
  s.revision++;
}
export function setProcessReactorRunning(s: State, id: string, enabled: boolean) {
  const r = s.process?.reactors?.find((r) => r.id === id);
  if (!r) return 'Select an installed batch reactor.';
  if (enabled) {
    if (!r.inputTankId || !r.outputTankId) return 'Choose separate feed and product tanks first.';
    if (
      ['idle', 'filling'].includes(r.phase) &&
      !processNetworkRoute(s, r.id, r.inputTankId, false, 0)
    )
      return 'Connect an open pipe route from the feed tank to the reactor west inlet.';
    if (
      ['idle', 'discharging'].includes(r.phase) &&
      !processNetworkRoute(s, r.id, r.outputTankId, false, 1)
    )
      return 'Connect an open pipe route from the reactor east outlet to the product tank.';
    const probe = {
      ...s,
      process: {
        ...s.process!,
        reactors: s.process!.reactors!.map((q) => (q.id === id ? { ...q, enabled: true } : q)),
      },
    };
    const power = electricalConsumerPower(probe, id);
    if (!power.powered) return `Reactor electrical interlock: ${power.reason}.`;
  }
  r.enabled = enabled;
  r.status = enabled ? 'Starting batch operation' : 'Paused; contents retained';
  s.revision++;
}
function routes(s: State, r: ProcessReactor) {
  const input = s.process!.tanks.find((t) => t.id === r.inputTankId),
    output = s.process!.tanks.find((t) => t.id === r.outputTankId);
  const inlet = input && processNetworkRoute(s, r.id, input.id, false, 0),
    outlet = output && processNetworkRoute(s, r.id, output.id, false, 1);
  const line = new Map(s.process!.lines.map((l) => [l.id, l]));
  return { input, output, inlet, outlet, line };
}
function step(s: State, r: ProcessReactor, dt: number) {
  if (!r.enabled) {
    r.status = r.phase === 'idle' ? 'Stopped' : 'Paused; contents retained';
    return;
  }
  const power = electricalConsumerPower(s, r.id);
  if (!power.powered) {
    r.status = power.reason;
    return;
  }
  const { input, output, inlet, outlet, line } = routes(s, r);
  if (!input || !output) {
    r.status = 'Select feed and product tanks';
    return;
  }
  if (['idle', 'filling'].includes(r.phase) && !inlet) {
    r.status = 'Feed pipe route incomplete or valve closed';
    return;
  }
  if (['idle', 'discharging'].includes(r.phase) && !outlet) {
    r.status = 'Product pipe route incomplete or valve closed';
    return;
  }
  const intake = [...(inlet || [])]
    .reverse()
    .slice(1)
    .map((id) => (id === r.id ? r : line.get(id)!));
  const discharge = (outlet || [])
    .slice(1)
    .map((id) => (id === output.id ? output : line.get(id)!));
  const incompatible = (nodes: ProcessTank[], product: string) =>
    nodes.some((n) => n.liters > 1e-8 && n.product !== product);
  if (
    ['idle', 'filling'].includes(r.phase) &&
    incompatible([input, ...intake.filter((n) => n !== r)], 'rawReagent')
  ) {
    r.status = 'Feed tank or inlet pipe contains incompatible liquid';
    return;
  }
  if (['idle', 'discharging'].includes(r.phase) && incompatible(discharge, 'refinedReagent')) {
    r.status = 'Product tank or outlet pipe contains incompatible liquid';
    return;
  }
  if (r.phase === 'idle') {
    const holdUp = intake.filter((n) => n !== r).reduce((sum, n) => sum + n.capacity - n.liters, 0);
    if (input.product !== 'rawReagent' || input.liters + 1e-7 < r.batchSize + holdUp) {
      r.status = `Waiting for ${(r.batchSize + holdUp).toFixed(1)} L raw reagent in feed tank`;
      return;
    }
    r.phase = 'filling';
    r.clock = 0;
    r.product = undefined;
    r.runId = next(s, 'BATCH');
  }
  if (r.phase === 'filling') {
    // Only the requested batch volume is available inside this physical vessel.
    const capacity = r.capacity;
    r.capacity = r.batchSize;
    const moved = moveContainedLiquid(s, r.runId!, 'rawReagent', input, intake, REACTOR_RATE * dt);
    r.capacity = capacity;
    r.inputFlow += moved;
    r.status = moved > 1e-9 ? 'Filling batch' : 'Waiting for raw reagent';
    if (r.liters >= r.batchSize - 1e-7) {
      r.liters = r.batchSize;
      r.phase = 'reacting';
      r.clock = 0;
    }
    return;
  }
  if (r.phase === 'reacting') {
    r.status = 'Reacting';
    r.clock = Math.min(REACTOR_SECONDS, r.clock + dt);
    if (r.clock < REACTOR_SECONDS) return;
    const p = s.process!;
    p.production!.consumed += r.liters;
    p.production!.produced += r.liters;
    p.production!.batches++;
    r.product = 'refinedReagent';
    r.phase = 'discharging';
    r.batches++;
    s.events.push({
      id: next(s, 'EV'),
      time: s.time,
      type: 'Production',
      entity: r.id,
      text: `Batch ${r.runId}: ${r.liters.toFixed(1)} L raw reagent converted to refined reagent.`,
    });
    s.revision++;
    return;
  }
  const moved = moveContainedLiquid(s, r.runId!, 'refinedReagent', r, discharge, REACTOR_RATE * dt);
  r.outputFlow += moved;
  r.status = moved > 1e-9 ? 'Discharging product' : 'Product tank and pipe route full';
  if (r.liters < 1e-8) {
    r.liters = 0;
    r.product = undefined;
    r.phase = 'idle';
    r.clock = 0;
    r.status = 'Batch complete';
    s.revision++;
  }
}
function warning(s: State, r: ProcessReactor) {
  const blocked =
    r.enabled &&
    !['Reacting', 'Filling batch', 'Discharging product', 'Batch complete'].includes(r.status);
  const prior = s.notices.find((n) => n.entity === r.id && n.title === 'Production blocked');
  if (!blocked) {
    r.blockedSince = undefined;
    if (prior && prior.state !== 'done') {
      prior.state = 'done';
      s.revision++;
    }
    return;
  }
  r.blockedSince ??= s.time;
  if (s.time - r.blockedSince < 15) return;
  if (prior) {
    if (prior.detail !== r.status || prior.state === 'done') {
      prior.detail = r.status;
      prior.state = 'todo';
      prior.seen = false;
      s.revision++;
    }
  } else {
    s.notices.unshift({
      id: next(s, 'N'),
      time: s.time,
      title: 'Production blocked',
      detail: r.status,
      entity: r.id,
      state: 'todo',
      seen: false,
      severity: 'warning',
    });
    s.revision++;
  }
}
export function tickProcessProduction(s: State, dt: number) {
  if (!s.process || !Number.isFinite(dt) || dt <= 0) return;
  for (const r of s.process.reactors || []) {
    r.inputFlow = 0;
    r.outputFlow = 0;
    let remaining = dt;
    while (remaining > 1e-9) {
      const slice = Math.min(0.25, remaining);
      step(s, r, slice);
      remaining -= slice;
    }
    r.inputFlow /= dt;
    r.outputFlow /= dt;
    warning(s, r);
  }
}
