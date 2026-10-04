import type { Order, OrderLine } from './types';
import { MATERIALS, EQUIPMENT, ROLES, SERVICES, label } from './catalog';

export const FREIGHT_CAPACITY = { road: 12000, rail: 48000 };
export const FREIGHT_DECK_LENGTH = { road: 6, rail: 16 };
export const CREW_BUS_SEATS = 12;
export function itemMass(item: string): number | undefined {
  return Object.hasOwn(MATERIALS, item)
    ? (MATERIALS as any)[item].mass
    : Object.hasOwn(EQUIPMENT, item)
      ? (EQUIPMENT as any)[item].mass
      : undefined;
}
export function orderLines(o: Pick<Order, 'item' | 'qty' | 'arrived' | 'manifest'>): OrderLine[] {
  return o.manifest || [{ item: o.item, qty: o.qty, arrived: o.arrived }];
}
export function orderDescription(o: Pick<Order, 'item' | 'qty' | 'arrived' | 'manifest'>) {
  return orderLines(o)
    .map((line) => `${line.qty} × ${label(line.item)}`)
    .join(' + ');
}
export function orderMass(o: Pick<Order, 'item' | 'qty' | 'arrived' | 'manifest'>) {
  return orderLines(o).reduce((sum, line) => sum + (itemMass(line.item) || 0) * line.qty, 0);
}
export function orderDeckLength(lines: Pick<OrderLine, 'item' | 'qty'>[]) {
  return lines.reduce((sum, line) => {
    const m = Object.hasOwn(MATERIALS, line.item) ? (MATERIALS as any)[line.item] : undefined;
    return sum + (m ? Math.ceil(line.qty / m.max) * m.w : 0);
  }, 0);
}
export function pendingOrderLine(o: Order) {
  return orderLines(o).find((line) => line.arrived < line.qty);
}
/** Validate the entire request before mutation, then pack physical stacks and seats. */
export function packPurchase(lines: { item: string; qty: number }[], mode: 'road' | 'rail') {
  if (!['road', 'rail'].includes(mode)) throw new Error('Choose road or rail transport.');
  if (!Array.isArray(lines) || !lines.length || lines.length > 100)
    throw new Error('Choose between 1 and 100 order lines.');
  const normalized: { item: string; qty: number }[] = [];
  for (const line of lines) {
    if (!line || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 1000)
      throw new Error('Order a whole quantity between 1 and 1,000 per line.');
    if (
      typeof line.item !== 'string' ||
      ![MATERIALS, EQUIPMENT, ROLES, SERVICES].some((catalog) => Object.hasOwn(catalog, line.item))
    )
      throw new Error('Unknown catalog item.');
    const prior = normalized.find((p) => p.item === line.item);
    if (prior) {
      if (prior.qty + line.qty > 1000)
        throw new Error('Order a whole quantity between 1 and 1,000 per catalog item.');
      prior.qty += line.qty;
    } else normalized.push({ ...line });
  }
  const loads: { mode: 'road' | 'rail'; manifest: OrderLine[] }[] = [];
  for (const category of ['materials', 'crew', 'dedicated']) {
    let load: (typeof loads)[number] | undefined;
    for (const line of normalized) {
      const material = line.item in MATERIALS,
        crew = line.item in ROLES;
      if ((material ? 'materials' : crew ? 'crew' : 'dedicated') !== category) continue;
      for (let n = 0; n < line.qty; n++) {
        const transport = material ? mode : 'road';
        const candidate = load ? load.manifest.map((l) => ({ ...l })) : [];
        const same = candidate.find((l) => l.item === line.item);
        if (same) same.qty++;
        else candidate.push({ item: line.item, qty: 1, arrived: 0 });
        const fits =
          load &&
          (material
            ? orderDeckLength(candidate) <= FREIGHT_DECK_LENGTH[mode] &&
              candidate.reduce((sum, l) => sum + itemMass(l.item)! * l.qty, 0) <=
                FREIGHT_CAPACITY[mode]
            : crew && candidate.reduce((sum, l) => sum + l.qty, 0) <= CREW_BUS_SEATS);
        if (fits) load!.manifest = candidate;
        else {
          load = { mode: transport, manifest: [{ item: line.item, qty: 1, arrived: 0 }] };
          loads.push(load);
        }
      }
    }
  }
  return loads;
}
