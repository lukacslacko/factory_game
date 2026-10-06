import { MATERIALS } from './catalog';
import type { Item, Stack, State } from './types';

/** Installed identities follow physical layers, bottom to top. New steel has no identity yet. */
export function railLayerIds(t: Stack): (string | null)[] {
  return (
    t.railAssetIds?.slice() ??
    Array.from({ length: t.qty }, (_, i) => (i === 0 ? t.assetId || null : null))
  );
}
export function appendRailLayers(t: Stack, ids: (string | null)[]) {
  t.railAssetIds = [...railLayerIds(t), ...ids];
  t.qty = t.railAssetIds.length;
  if (t.qty === 1 && t.railAssetIds[0]) t.assetId = t.railAssetIds[0];
  else delete t.assetId;
}
export function takeRailLayers(t: Stack, qty: number): (string | null)[] {
  const ids = railLayerIds(t),
    picked = ids.splice(ids.length - qty, qty);
  t.railAssetIds = ids;
  t.qty = ids.length;
  if (t.qty === 1 && ids[0]) t.assetId = ids[0];
  else delete t.assetId;
  return picked;
}
/** Undeposited incoming panels reserve capacity without counting supported steel twice. */
export function incomingRailLayers(s: State, stackId: string) {
  return (
    s.orders
      .filter((o) => o.unload?.mergeId === stackId && o.unload.phase !== 'back-away')
      .reduce((n, o) => n + o.unload!.qty, 0) +
    s.jobs
      .filter(
        (j) =>
          !['done', 'canceled'].includes(j.status) &&
          j.stockMove?.mergeId === stackId &&
          j.railWork?.panel.state !== 'staged',
      )
      .reduce((n, j) => n + j.qty, 0)
  );
}
export function recoveryStackCandidates(s: State, item: Item, hand: 1 | -1) {
  const m = MATERIALS[item];
  return s.stacks
    .filter(
      (t) =>
        t.item === item &&
        item.startsWith('rail') &&
        t.qty > 0 &&
        t.qty + incomingRailLayers(s, t.id) < m.max &&
        t.reserved === 0 &&
        !t.railStagingJobs?.length &&
        t.w === m.w &&
        t.d === m.d &&
        (item === 'rail' || (t.trackHand ?? 1) === hand) &&
        s.zones.some(
          (z) => t.x >= z.x && t.z >= z.z && t.x + t.w <= z.x + z.w && t.z + t.d <= z.z + z.d,
        ) &&
        !s.jobs.some(
          (j) =>
            !['done', 'canceled'].includes(j.status) &&
            (j.stack === t.id ||
              j.stockMove?.sourceId === t.id ||
              j.stockMove?.mergeId === t.id ||
              j.railWork?.panel.stackId === t.id ||
              j.railWork?.source?.stackId === t.id),
        ) &&
        !s.orders.some((o) => o.unload?.mergeId === t.id && o.unload.phase !== 'back-away'),
    )
    .sort((a, b) => b.qty - a.qty || a.id.localeCompare(b.id));
}
