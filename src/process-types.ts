import type { RailCommodity } from './rail-commodities';
export interface ProcessTank {
  id: string;
  product?: RailCommodity;
  liters: number;
  capacity: number;
}
export interface ProcessLine extends ProcessTank {
  flow: number;
}
export interface ProcessPump {
  id: string;
  carId?: string;
  tankId?: string;
  enabled: boolean;
  rate: number;
  flow: number;
  transferred: number;
  status: string;
  hose: 'disconnected' | 'connecting' | 'connected' | 'disconnecting';
  operation?: string;
  runId?: string;
}
export interface ProcessValve {
  id: string;
  open: boolean;
  operation?: string;
}
export interface ProcessOperation {
  id: string;
  buildingId: string;
  workerId: string;
  carId?: string;
  kind: 'connect' | 'disconnect' | 'valve';
  open?: boolean;
  phase: number;
  clock: number;
  started: number;
  finished?: number;
  status: string;
  blockedSince?: number;
  warned?: boolean;
  lastPoint?: { x: number; z: number };
  lastProgress?: number;
}
export interface ProcessLedger {
  id: string;
  runId: string;
  time: number;
  updated: number;
  product: RailCommodity;
  liters: number;
  from: string;
  to: string;
}
export interface ProcessState {
  tanks: ProcessTank[];
  lines: ProcessLine[];
  pumps: ProcessPump[];
  valves: ProcessValve[];
  operations: ProcessOperation[];
  sources: {
    carId: string;
    product: RailCommodity;
    initialLiters: number;
    initialArrived: number;
  }[];
  ledger: ProcessLedger[];
}
