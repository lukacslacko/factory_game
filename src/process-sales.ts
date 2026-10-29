import type { State, RailFreightCar } from './types';
export const REFINED_SALE_PRICE = 0.85;
const next = (s: State, p: string) => `${p}-${String(s.next++).padStart(4, '0')}`;
export function recordProductLoading(s: State, car: RailFreightCar, liters: number) {
  if (liters <= 1e-10) return;
  const sales = (s.process!.sales ||= []);
  let sale = sales.find((x) => x.id === car.saleId);
  if (!sale) {
    sale = {
      id: next(s, 'SALE'),
      carId: car.id,
      product: 'refinedReagent',
      unitPrice: REFINED_SALE_PRICE,
      liters: 0,
      revenue: 0,
      created: s.time,
    };
    sales.push(sale);
    car.saleId = sale.id;
  }
  sale.liters += liters;
}
/** Settlement happens only when the physical pickup consist has left the factory. */
export function settleProductSales(s: State, saleIds: string[], returnId: string) {
  for (const id of saleIds) {
    const sale = s.process?.sales?.find((x) => x.id === id);
    if (!sale || sale.shippedAt !== undefined) continue;
    const car = s.orders.flatMap((o) => o.railFreight?.cars || []).find((c) => c.id === sale.carId);
    if (!car?.returned) continue;
    sale.shippedAt = s.time;
    sale.revenue = Math.round(sale.liters * sale.unitPrice * 100) / 100;
    sale.costId = next(s, 'COST');
    s.costs.push({
      id: sale.costId,
      time: s.time,
      category: 'Product sales',
      entity: sale.id,
      description: `${sale.liters.toFixed(2)} L refined reagent shipped in ${sale.carId} · ${returnId}`,
      amount: -sale.revenue,
    });
    s.events.push({
      id: next(s, 'EV'),
      time: s.time,
      type: 'Sale',
      entity: sale.id,
      text: `${sale.carId} departed with ${sale.liters.toFixed(2)} L refined reagent; received $${sale.revenue.toFixed(2)}.`,
    });
    s.notices.unshift({
      id: next(s, 'N'),
      time: s.time,
      title: 'Product sold',
      detail: `${sale.liters.toFixed(2)} L refined reagent · $${sale.revenue.toFixed(2)} received`,
      entity: sale.id,
      state: 'done',
      seen: false,
    });
    s.revision++;
  }
}
