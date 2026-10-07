import type { Point, Rect } from './types';
export interface ElectricalRequest {
  sourceId: string;
  targetId: string;
  cells: Point[];
}
export type ElectricalPhase =
  | 'isolate-source'
  | 'isolate-target'
  | 'return-cable'
  | 'recover-cable'
  | 'reserve'
  | 'board'
  | 'reel-source'
  | 'reel-rig'
  | 'reel-lift'
  | 'reel-withdraw'
  | 'reel-carry'
  | 'reel-lower'
  | 'reel-clear'
  | 'approach'
  | 'lift-paving'
  | 'dig'
  | 'dig-lift'
  | 'swing-spoil'
  | 'dump-spoil'
  | 'dig-return'
  | 'crew-clear'
  | 'collect-cable'
  | 'lay'
  | 'pull-cable'
  | 'backfill-approach'
  | 'backfill-pick'
  | 'backfill-lift'
  | 'swing-trench'
  | 'backfill'
  | 'backfill-return'
  | 'restore-paving'
  | 'terminate-source'
  | 'terminate-target'
  | 'test'
  | 'complete'
  | 'canceled';
export interface ElectricalCell extends Point {
  excavation: number;
  backfilled: number;
  soilRemovedM3: number;
  spoilM3: number;
  spoilRect: Rect;
  slabRect?: Rect;
  originalPaving?: string;
  slabLifted?: boolean;
  slabCarried?: boolean;
  slabRestored?: boolean;
  cableInstalled: boolean;
}
export interface ElectricalRun {
  id: string;
  jobId: string;
  sourceId: string;
  targetId: string;
  cells: ElectricalCell[];
  phase: ElectricalPhase;
  status: 'planned' | 'working' | 'commissioned' | 'canceling' | 'canceled';
  /** Whole-run sequence: open the route, pull/retrieve cable, then restore it. */
  workStage?: 'excavate' | 'lay' | 'restore';
  cellIndex: number;
  clock: number;
  created: number;
  finished?: number;
  workerId?: string;
  operatorId?: string;
  equipmentId?: string;
  reelId?: string;
  reservations: { stackId: string; meters: number }[];
  stagedReels: string[];
  reelStage?: Rect;
  reelOrigin?: Rect;
  reelDock?: Point & { yaw: number };
  reelClear?: Point;
  dock?: Point & { yaw: number };
  workPoint?: Point;
  cableInHand: number;
  soilInBucketM3: number;
  toolPoint?: Point;
  pavingStep?: 'carry' | 'lower';
  sourceTerminated: boolean;
  targetTerminated: boolean;
  tested: boolean;
  cancelRequested?: boolean;
  retryAt?: number;
  blockedSince?: number;
  warned?: boolean;
  reason: string;
  creative?: boolean;
  /** Explicit prebuilt opening circuit; no historical construction job is required. */
  opening?: boolean;
  recovering?: boolean;
  sourceRect?: Rect;
  targetRect?: Rect;
}
export interface ElectricalCableMovement {
  id: string;
  time: number;
  runId: string;
  from: string;
  to: string;
  meters: number;
  reason: string;
}
export interface ElectricalState {
  runs: ElectricalRun[];
  meterLedger: ElectricalCableMovement[];
}
export interface ElectricalPreview {
  valid: boolean;
  error?: string;
  cells: ElectricalCell[];
  meters: number;
  sourceId: string;
  targetId: string;
  terminals: { source: Point[]; target: Point[] };
}
