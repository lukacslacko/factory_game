import type { State } from './types';

/** Names are display labels; wiring, history and SQL always retain the stable asset ID. */
export function renameElectricalAsset(s: State, id: string, name: unknown): string | undefined {
  const asset = s.buildings.find((b) => b.id === id);
  if (!asset || !['power', 'lamp', 'transferPump', 'electricalJunction'].includes(asset.kind))
    return 'Choose an installed electrical station, junction, light, or pump.';
  if (typeof name !== 'string' || /[\u0000-\u001f\u007f]/u.test(name))
    return 'Enter a name without control characters.';
  const cleaned = name.trim();
  if (!cleaned || cleaned.length > 80) return 'Use a name between 1 and 80 characters.';
  if (asset.name === cleaned) return;
  asset.name = cleaned;
  s.revision++;
}
