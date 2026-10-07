import type { BufferStop, Job, Point, Stack, State } from './types';
import { dist } from './path';
import {
  trackGeometry,
  trackOpenPorts,
  trackNetwork,
  trackMacroPorts,
  portsConnect,
} from './track';
import { railRouteReserved } from './rail-operations';
import { boxOverlap, railRollingStockBoxes } from './traffic';
import { railWorkGroup } from './rail-work-groups';

/** The opening stop used to have only a position. Its real identity survives upgrades. */
export function bufferAssets(s: State): BufferStop[] {
  if (s.buffers) return s.buffers;
  const active = s.jobs.find((j) => j.status === 'doing' && j.railWork?.buffer)?.railWork?.buffer;
  const shared = s.jobGroups?.find((g) => g.railBuffer && !g.railBuffer.pose.secured)?.railBuffer
    ?.pose;
  const previous = [...s.jobs].reverse().find((j) => j.railWork?.buffer)?.railWork?.buffer;
  return [
    {
      ...s.buffer,
      id: 'BUFFER-001',
      y: active?.y ?? shared?.y ?? 0.2,
      yaw: active?.yaw ?? shared?.yaw ?? previous?.yaw ?? 0,
      secured: active?.secured ?? shared?.secured ?? true,
      carried: active?.carried ?? shared?.carried ?? false,
      source: 'opening',
    },
  ];
}
export function ensureBuffers(s: State): BufferStop[] {
  return (s.buffers ||= bufferAssets(s).map((b) => ({ ...b })));
}
export function syncBufferAsset(s: State, pose: BufferStop) {
  const list = ensureBuffers(s),
    b = list.find((b) => b.id === pose.id);
  if (b) Object.assign(b, pose);
  else list.push({ ...pose });
  if (pose.id === 'BUFFER-001') Object.assign(s.buffer, { x: pose.x, z: pose.z });
}
export function bufferAt(s: State, p: Point) {
  return bufferAssets(s).find((b) => !b.carried && dist(b, p) < 0.15);
}
export function openBufferEndpoint(s: State, p: Point) {
  return trackOpenPorts(s, false, false).find((q) => dist(q, p) < 0.02);
}
/** Mounted equipment shares the rail edit lifecycle, but adds no fictitious steel.
 * Removing a stop never moves its stopping plane or changes track connectivity. */
export function bufferRecoveryConflict(s: State, bufferId: string, ownJobId?: string): string {
  const b = bufferAssets(s).find((b) => b.id === bufferId);
  if (!b) return 'Buffer stop not found.';
  if (
    b.carried ||
    s.jobs.some(
      (j) =>
        j.id !== ownJobId &&
        j.status === 'doing' &&
        (j.target === bufferId || j.railWork?.buffer?.id === bufferId),
    ) ||
    s.jobGroups?.some(
      (g) =>
        g.railBuffer?.pose.id === bufferId &&
        !g.railBuffer.pose.secured &&
        s.jobs.some(
          (j) =>
            j.kind === 'rail' &&
            !['done', 'canceled'].includes(j.status) &&
            railWorkGroup(s, j)?.id === g.id,
        ),
    )
  )
    return 'The rail crew is handling this buffer. Finish its connected work first.';
  return bufferPlacementConflict(s, b);
}
/** Both mounting and recovery keep the same rail possession and body clearance. */
export function bufferPlacementConflict(s: State, b: Point & { yaw?: number }): string {
  const panels = trackNetwork(s, false).panels.filter((p) =>
    p.ports.some((port) => dist(port, b) < 0.15),
  );
  for (const panel of panels) {
    const reserved = railRouteReserved(s, panel.id);
    if (reserved)
      return `This buffer's rail is reserved by ${reserved}; wait until its movement ends.`;
  }
  const occupied = railRollingStockBoxes(s).find((actor) =>
    boxOverlap(actor, { ...b, yaw: b.yaw || 0, length: 2, width: 2.2 }, 0.15),
  );
  return occupied
    ? `${occupied.id || 'A rail vehicle'} occupies this buffer location; move it clear before editing.`
    : '';
}
/** Recover a stop at a downstream joint (including either turnout tail), while
 * the stop at the current construction entrance follows the normal rail crew. */
export function railConnectionBufferBlockers(s: State, j: Job) {
  const geometry = trackGeometry(j),
    secondary =
      j.track?.flow === 'converging'
        ? trackMacroPorts(j.track)
            .slice(1)
            .filter((p) => p.end === 'entry')
        : [];
  let existingPorts: ReturnType<typeof trackNetwork>['panels'][number]['ports'] | undefined;
  const connected = (port: typeof geometry.entry) => {
    existingPorts ||= trackNetwork(s, false).panels.flatMap((p) => p.ports);
    return existingPorts.some((old) => portsConnect(port, old, 0.02, 0.02));
  };
  return bufferAssets(s).filter((b) => {
    if (b.carried) return false;
    // Clear the second convergence entrance before *either* route takes a
    // machine: a loose stop there can occupy the shared staging clearance.
    if (secondary.some((port) => dist(b, port) < 0.15 && connected(port))) return true;
    const transferEntrance =
      dist(b, geometry.entry) < 0.15 &&
      !secondary.some((p) => dist(b, p) < 0.15) &&
      !(j.track?.flow === 'converging' && j.track.route === 'branch');
    return (
      !transferEntrance && geometry.ports.some((port) => dist(b, port) < 0.15 && connected(port))
    );
  });
}
export function bufferSource(s: State, j: Job): Stack | undefined {
  if (j.kind !== 'remove' || j.item !== 'bufferStop') return undefined;
  const b = bufferAssets(s).find((b) => b.id === j.target && !b.carried);
  return (
    b && {
      id: b.id,
      x: b.x + Math.cos(b.yaw) * 0.5 - 1,
      z: b.z + Math.sin(b.yaw) * 0.5 - 1,
      w: 2,
      d: 2,
      item: 'bufferStop',
      qty: 1,
      reserved: 1,
      assetId: b.id,
      source: b.source || 'opening',
      yaw: b.yaw,
      baseHeight: b.y - 0.2,
    }
  );
}
/** An outgoing rail joint cannot retain a stop inside the connected track. */
export function railBufferShouldBeStored(s: State, j: Job) {
  const r = j.railWork;
  if (!r?.buffer || j.cancel) return false;
  return (
    !trackNetwork(s, false).openPorts.some((p) => dist(p, r.end) < 0.02) &&
    !s.jobs.some(
      (other) =>
        other.id !== j.id &&
        other.kind === 'rail' &&
        !['done', 'canceled'].includes(other.status) &&
        dist(trackGeometry(other).entry, r.end) < 0.02,
    )
  );
}
