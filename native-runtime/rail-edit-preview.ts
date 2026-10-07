import * as Sim from '../src/sim';
import { bufferAssets } from '../src/buffers';
import { MATERIALS, EQUIPMENT } from '../src/catalog';
import { trackGeometry } from '../src/track';
import type { Item, State } from '../src/types';

/** A read-only rehearsal of the real editing commands. No live inventory is reserved.
 * Creative recovery supplies the same finite footprint preflight for both modes;
 * physical jobs recheck their destination when the machine actually carries the load. */
export function railEditPreview(state: State, a: any) {
  if (!['recover_rail', 'recover_buffer', 'install_buffer'].includes(a.operation))
    throw new Error('Choose rail recovery, buffer recovery, or buffer installation.');
  if (a.scope !== undefined && !['panel', 'assembly'].includes(a.scope))
    throw new Error('Choose panel or assembly recovery.');
  const operation = String(a.operation),
    scope = a.scope || 'panel',
    id = String(a.id || '');
  if (operation !== 'install_buffer' && !id) throw new Error('Choose installed infrastructure.');
  if (operation === 'install_buffer' && (!Number.isFinite(a.x) || !Number.isFinite(a.z)))
    throw new Error('Choose a real rail endpoint.');
  const planned = structuredClone(state),
    creative = structuredClone(state);
  creative.creative = true;
  const apply = (s: State) =>
    operation === 'recover_rail'
      ? Sim.removeRailInfrastructure(s, id, scope)
      : operation === 'recover_buffer'
        ? Sim.removeBufferStop(s, id)
        : Sim.planBufferStop(s, { x: a.x, z: a.z }).error;
  const constraint = apply(planned),
    storageError = constraint ? '' : apply(creative);
  const assets: { id: string; item: Item }[] = [];
  if (operation === 'recover_rail') {
    const rail = state.rails.find((r) => r.id === id);
    const rails =
      scope === 'assembly' && rail?.track?.groupId
        ? state.rails.filter((r) => r.track?.groupId === rail.track!.groupId)
        : rail
          ? [rail]
          : [];
    for (const r of rails) {
      const g = trackGeometry(r);
      for (const b of bufferAssets(state))
        if (
          !b.carried &&
          [...g.entries, ...g.ends].some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 0.2) &&
          !assets.some((asset) => asset.id === b.id)
        )
          assets.push({ id: b.id, item: 'bufferStop' });
      assets.push({ id: r.id, item: r.item || 'rail' });
    }
  } else if (operation === 'recover_buffer' && bufferAssets(state).some((b) => b.id === id))
    assets.push({ id, item: 'bufferStop' });
  const materials = [...new Set(assets.map((asset) => asset.item))].map((item) => ({
    item,
    qty: assets.filter((asset) => asset.item === item).length,
    assetIds: assets.filter((asset) => asset.item === item).map((asset) => asset.id),
    unitMass: MATERIALS[item].mass,
  }));
  if (operation === 'install_buffer')
    materials.push({
      item: 'bufferStop',
      qty: 1,
      assetIds: [],
      unitMass: MATERIALS.bufferStop.mass,
    });
  const destinations = creative.movements
    .slice(state.movements.length)
    .filter((m) => assets.some((asset) => asset.id === m.from))
    .flatMap((m) => {
      const stock = creative.stacks.find((t) => t.id === m.to);
      if (!stock) return [];
      const zone = state.zones.find(
        (z) =>
          stock.x >= z.x &&
          stock.z >= z.z &&
          stock.x + stock.w <= z.x + z.w &&
          stock.z + stock.d <= z.z + z.d,
      );
      return [
        {
          assetId: m.from,
          item: m.item,
          stackId: stock.id,
          zoneId: zone?.id,
          x: stock.x,
          z: stock.z,
          w: stock.w,
          d: stock.d,
        },
      ];
    });
  const totals = Sim.totals(state, 'bufferStop'),
    warnings: string[] = [];
  if (!state.creative) {
    if (storageError)
      warnings.push(
        storageError + ' The work can be queued, but cannot finish until storage is available.',
      );
    const maxMass = Math.max(0, ...materials.map((m) => m.unitMass));
    if (!state.equipment.some((e) => EQUIPMENT[e.kind].capacity >= maxMass))
      warnings.push(
        `An owned lifting machine rated for at least ${maxMass.toLocaleString('en-US')} kg is required.`,
      );
    if (!state.workers.some((w) => w.role === 'operator'))
      warnings.push('Hire an equipment operator to drive the lifting machine.');
    if (state.workers.length < 2)
      warnings.push(
        'A separate ground worker is required to rig, unfasten, and fasten material while the operator drives.',
      );
    if (operation === 'install_buffer' && totals.stored - totals.reserved < 1)
      warnings.push(
        totals.incoming > 0
          ? 'Awaiting delivery of the ordered buffer stop.'
          : 'Purchase a buffer stop before this work can begin.',
      );
    warnings.push(
      'Equipment and crew need a clear approach. Storage is chosen again at the physical lift; preview destinations are not reserved.',
    );
  }
  return {
    operation,
    id,
    scope,
    mode: state.creative ? 'creative' : 'physical',
    constraint,
    storageError,
    materials,
    destinations,
    warnings,
    pendingJobs: state.jobs
      .filter(
        (j) =>
          !['done', 'canceled'].includes(j.status) &&
          (j.target === id || j.railRecovery?.railId === id),
      )
      .map((j) => j.id),
    availableStops: totals.stored - totals.reserved,
    incomingStops: totals.incoming,
    installedStops: bufferAssets(state).filter((b) => !b.carried).length,
    sources:
      operation === 'install_buffer'
        ? state.stacks
            .filter((t) => t.item === 'bufferStop' && t.qty > t.reserved)
            .map((t) => ({
              stockId: t.id,
              assetId: t.assetId,
              x: t.x,
              z: t.z,
              available: t.qty - t.reserved,
            }))
        : [],
    endpoint: operation === 'install_buffer' ? { x: a.x, z: a.z } : undefined,
  };
}
