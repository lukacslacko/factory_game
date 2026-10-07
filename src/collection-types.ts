import type { Equipment, Item, Point, Rect, Stack } from './types';
export interface CollectionRequest {
  lines?: { stackId: string; qty: number }[];
  equipmentId?: string;
}
export interface CollectionLine {
  stackId: string;
  /** Immutable source description retained when a fully collected stack is removed. */
  sourceSnapshot?: Stack;
  item: Item;
  qty: number;
  /** Units still reserved on the original source. */
  reserved: number;
  /** Units secured on the outbound carrier. */
  loaded: number;
  /** Units that have physically left the yard. */
  collected: number;
  assetIds?: (string | null)[];
  trackHand?: 1 | -1;
  yaw: number;
  massKg: number;
}
export interface CollectionTask {
  equipmentId: string;
  operatorId: string;
  helperId?: string;
  phase:
    | 'boarding'
    | 'source'
    | 'rig'
    | 'lift'
    | 'clear-source'
    | 'carry'
    | 'lower'
    | 'secure-exit'
    | 'secure-walk'
    | 'secure'
    | 'secure-return'
    | 'secure-board'
    | 'clear-deck'
    | 'return'
    | 'return-lower'
    | 'equipment-approach'
    | 'ramps'
    | 'equipment-ramp'
    | 'equipment-exit'
    | 'equipment-unload'
    | 'equipment-clear';
  clock: number;
  lineIndex?: number;
  qty: number;
  source: Point & { y: number; yaw: number };
  sourceDock: Point;
  sourceClear: Point;
  deck: Point & { y: number; yaw: number };
  deckDock: Point;
  deckClear: Point;
  sourceYaw: number;
  deckYaw: number;
  originalSource?: Rect;
  originalEquipmentPose?: Point & { yaw: number };
  operatorRampOrigin?: Point & { y: number };
  cargo?: Point & { y: number; yaw: number };
  assetIds?: (string | null)[];
  lifted?: boolean;
  rigged?: boolean;
  returnQty?: number;
  withdrawalPoint?: Point;
  securingPoint?: Point;
}
export interface Collection {
  id: string;
  carrierOrderId: string;
  kind: 'materials' | 'equipment';
  status: 'ordered' | 'loading' | 'departing' | 'done' | 'canceling' | 'canceled' | 'paused';
  phase: string;
  note: string;
  lines: CollectionLine[];
  equipmentId?: string;
  automaticEquipment?: string;
  massKg: number;
  fees: { transport: number; disposal: number; total: number; invoiced: boolean; charged: number };
  created: number;
  finished?: number;
  cancelRequested?: boolean;
  pausedStatus?: 'ordered' | 'loading' | 'canceling';
  task?: CollectionTask;
  retryAt?: number;
  warned?: string[];
}
export interface RetiredEquipment extends Equipment {
  collectionId: string;
  retiredAt: number;
  retirementReason: 'paid collection';
}
export interface CollectionQuote {
  valid: boolean;
  error?: string;
  kind?: 'materials' | 'equipment';
  massKg: number;
  transportFee: number;
  disposalFee: number;
  total: number;
  loads: {
    lines: CollectionLine[];
    equipmentId?: string;
    massKg: number;
    transportFee: number;
    disposalFee: number;
    total: number;
  }[];
}
