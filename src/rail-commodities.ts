/** Contained bulk liquids are accounted in liters, separate from liftable material stock. */
export const RAIL_COMMODITIES = {
  rawReagent: { name: 'Raw reagent', unit: 'L', density: 1, price: 0.30, color: 'b0c1a3' },
  refinedReagent: { name: 'Refined reagent', unit: 'L', density: 1, price: 0.85, color: '7dc3cf' },
  bulkWater: { name: 'Process water', unit: 'L', density: 1, price: 0.015, color: 'ced5cc' },
  bulkDiesel: { name: 'Bulk diesel', unit: 'L', density: 0.84, price: 1.35, color: 'b2b8ae' },
} as const;
export type RailCommodity = keyof typeof RAIL_COMMODITIES;
export const isRailCommodity = (item: string): item is RailCommodity =>
  Object.hasOwn(RAIL_COMMODITIES, item);
