import type { BufferStop, Job, Point, Stack, State } from './types';
import { dist } from './path';
import { trackGeometry, trackOpenPorts, trackNetwork } from './track';

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
  return trackOpenPorts(s, false).find((q) => dist(q, p) < 0.02);
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
