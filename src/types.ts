export type Point = { x: number; z: number };
export type Rect = Point & { w: number; d: number };
export type Item =
  'slab' | 'rail' | 'office' | 'sanitary' | 'shed' | 'store' | 'lamp' | 'diesel' | 'fence';
export type BuildKind = Item | 'power' | 'water';
export type Role = 'builder' | 'operator' | 'engineer';
export type EquipmentKind = 'excavator' | 'forklift';
export type EquipmentWorkRole =
  'all' | 'receiving' | 'paving' | 'construction' | 'rail' | 'recovery' | 'hold';
export type Move = { path: Point[]; destination?: Point };
export type Motion = {
  yaw?: number;
  velocity?: number;
  travel?: number;
  y?: number;
  pitch?: number;
  reverse?: boolean;
  blockedBy?: string;
  trafficWait?: number;
  trafficReverse?: boolean;
  trafficGoal?: Point;
  trafficRetry?: number;
};
export interface Worker extends Point, Move, Motion {
  id: string;
  name: string;
  role: Role;
  duty: 'auto' | 'manual' | 'rest';
  status: string;
  job?: string;
  vehicle?: string;
  schedule?: { start: number; end: number };
  shiftPhase?:
    'working' | 'finishing' | 'parking' | 'walking-to-bus' | 'aboard' | 'home' | 'returning';
  commuteOrder?: string;
  parkingEquipment?: string;
  hours: number;
  wage: number;
  heading: number;
  deliveryOrder?: string;
  transportOrder?: string;
  yieldingTo?: string;
  yieldTarget?: Point;
  transition?: {
    kind: 'enter' | 'exit';
    equipmentId: string;
    clock: number;
    from: Point & { y: number };
    to: Point & { y: number };
  };
}
export interface Equipment extends Point, Move, Motion {
  id: string;
  kind: EquipmentKind;
  workRole?: EquipmentWorkRole;
  parking?: Point & { rotation: number };
  parkingState?: 'waiting-operator' | 'boarding' | 'driving' | 'aligning' | 'parked';
  parkingOperator?: string;
  parkingRetry?: number;
  parkingReason?: string;
  fuel: number;
  tank: number;
  used: number;
  operator?: string;
  job?: string;
  refueling?: string;
  lowFuelWarned?: boolean;
  cargo?: { item: Item; qty: number; yaw?: number };
  heading: number;
  work: number;
  transportOrder?: string;
  deliveryOrder?: string;
  lift?: number;
  reach?: number;
}
export interface Stack extends Rect {
  baseHeight?: number;
  yaw?: number;
  id: string;
  item: Item;
  qty: number;
  reserved: number;
  source: string;
  assetId?: string;
  liters?: number;
}
export interface Building extends Rect {
  id: string;
  kind: BuildKind;
  rotation: number;
  connected: boolean;
  name: string;
  source?: string;
}
export interface Rail extends Point {
  id: string;
  rotation: number;
  length: number;
}
export interface Zone extends Rect {
  id: string;
  name: string;
}
export type RailWorkPhase =
  | 'source-approach'
  | 'source-rig'
  | 'source-lift'
  | 'source-clear'
  | 'stage-travel'
  | 'stage-align'
  | 'stage-lower'
  | 'legacy-fork-withdraw'
  | 'unbolt-buffer'
  | 'buffer-rig'
  | 'buffer-lift'
  | 'buffer-carry-aside'
  | 'buffer-lower-aside'
  | 'panel-approach'
  | 'panel-rig'
  | 'panel-lift'
  | 'panel-carry'
  | 'panel-align'
  | 'panel-lower'
  | 'join-panel'
  | 'buffer-retrieve'
  | 'buffer-rig-return'
  | 'buffer-lift-return'
  | 'buffer-carry-end'
  | 'buffer-align-end'
  | 'buffer-lower-end'
  | 'fasten-buffer'
  | 'cancel-panel-lift'
  | 'cancel-panel-return'
  | 'cancel-panel-align'
  | 'cancel-panel-lower'
  | 'complete';
export type RailWorkPose = Point & { y: number; yaw: number };
export interface RailWork {
  legacyForkYaw?: number;
  phase: RailWorkPhase;
  clock: number;
  start: Point;
  end: Point;
  axisYaw: number;
  side: Point;
  stage: Rect;
  stageDock: Point;
  railDock: Point;
  bufferAside: Point;
  panel: RailWorkPose & {
    state: 'stored' | 'carried' | 'staged' | 'placed' | 'installed';
    stackId?: string;
    railId?: string;
  };
  buffer?: RailWorkPose & { id: 'BUFFER-001'; secured: boolean; carried: boolean };
  source?: { stackId: string; pose: RailWorkPose; dock: Point; clear: Point; workerPoint: Point };
  lifting?: 'panel' | 'buffer';
  from?: RailWorkPose;
  restoreOriginal?: boolean;
}
export type ConstructionPhase =
  | 'approach'
  | 'rig'
  | 'engage'
  | 'lift'
  | 'clear'
  | 'carry'
  | 'lower'
  | 'withdraw'
  | 'settle'
  | 'complete';
export interface ConstructionHandling {
  equipmentReleased?: boolean;
  phase: ConstructionPhase;
  clock: number;
  pose: RailWorkPose;
  state: 'stored' | 'carried' | 'placed' | 'installed';
  sourceId?: string;
  placedStack?: string;
  source: RailWorkPose;
  sourceDock: Point;
  sourceApproach: Point;
  sourceClear: Point;
  destinationDock: Point;
  destinationClear: Point;
  reach: number;
  yawOffset: number;
  toolLift: number;
  toolReach: number;
  from?: RailWorkPose;
}
export interface JobGroup extends Rect {
  id: string;
  label: string;
  parentId?: string;
  preferredEquipment?: string;
  equipmentPriority?: number;
  created: number;
}
export interface Job extends Rect {
  parentId?: string;
  preferredEquipment?: string;
  equipmentPriority?: number;
  legacyRailHandoff?: 'carried' | 'staged' | 'installed';
  id: string;
  kind: BuildKind | 'refuel' | 'remove';
  rotation: number;
  item?: Item;
  qty: number;
  status: 'todo' | 'doing' | 'done' | 'canceled';
  phase: string;
  reason: string;
  progress: number;
  worker?: string;
  operator?: string;
  equipment?: string;
  stack?: string;
  delivered: boolean;
  elapsed: number;
  preferredWorker?: string;
  target?: string;
  created: number;
  finished?: number;
  cancel?: boolean;
  resumeJob?: string;
  assetId?: string;
  recoveryStack?: Stack;
  retryAt?: number;
  retryRevision?: number;
  fuelLiters?: number;
  railWork?: RailWork;
  handling?: ConstructionHandling;
}
export interface OrderLine {
  item: string;
  qty: number;
  arrived: number;
}
export interface Order {
  /** One carrier, with separately accounted material or passenger lines. */
  manifest?: OrderLine[];
  commute?: {
    direction: 'outbound' | 'inbound';
    workers: string[];
    boarding?: { worker: string; clock: number; from: Point };
  };
  id: string;
  item: string;
  qty: number;
  arrived: number;
  mode: 'road' | 'rail';
  status: 'ordered' | 'approaching' | 'unloading' | 'departing' | 'done';
  /** Carrier has left the yard; site handling may still be finishing. */
  carrierDeparted?: boolean;
  eta: number;
  total: number;
  invoiced: boolean;
  vehicle: Point;
  stage: number;
  handler: Point;
  handling: number;
  allocated?: Rect;
  handlerPath?: Point[];
  handlingStage?: 'carry' | 'return';
  cargoQty?: number;
  retryAt?: number;
  note: string;
  notifiedBlocks?: string[];
  drive?: Motion & {
    distance: number;
    roadVersion?: number;
    gearPause?: number;
    yardPermit?: boolean;
  };
  equipmentId?: string;
  operatorId?: string;
  ramp?: number;
  deployment?: 'waiting' | 'walk' | 'climb' | 'board' | 'offload' | 'park' | 'complete';
  deploymentClock?: number;
  unload?: UnloadTask;
  contractor?: Point & Move & Motion & { phase: string; clock: number };
}
export interface UnloadTask {
  /** Fixed during handling, even after this line is emptied on the carrier. */
  item?: Item;
  lineIndex?: number;
  equipmentId: string;
  operatorId: string;
  riggerId?: string;
  rigged?: boolean;
  phase:
    | 'boarding'
    | 'approach'
    | 'rig'
    | 'lift'
    | 'clear'
    | 'carry'
    | 'lower'
    | 'release'
    | 'back-away';
  clock: number;
  qty: number;
  mergeId?: string;
  source: Point;
  sourceY: number;
  sourceYaw: number;
  pickup: Point;
  destination: Rect;
  drop: Point;
  dropYaw: number;
  destinationY: number;
  cargo?: Point & { y: number; yaw: number };
}
export interface Event {
  id: string;
  time: number;
  type: string;
  entity: string;
  text: string;
}
export interface Cost {
  id: string;
  time: number;
  category: string;
  entity: string;
  description: string;
  amount: number;
}
export interface Movement {
  id: string;
  time: number;
  item: Item;
  qty: number;
  from: string;
  to: string;
  reason: string;
}
export interface Notice {
  id: string;
  time: number;
  title: string;
  detail: string;
  entity: string;
  state: 'todo' | 'doing' | 'done';
  seen: boolean;
}
export interface State {
  version: 1 | 2 | 3 | 4;
  name: string;
  time: number;
  elapsed: number;
  speed: number;
  paused: boolean;
  next: number;
  revision: number;
  workers: Worker[];
  equipment: Equipment[];
  stacks: Stack[];
  buildings: Building[];
  rails: Rail[];
  paving: Record<string, string>;
  /** Compaction from accepted equipment travel, bounded to one value per meter cell. */
  groundWear?: Record<string, number>;
  zones: Zone[];
  jobs: Job[];
  jobGroups?: JobGroup[];
  orders: Order[];
  events: Event[];
  costs: Cost[];
  movements: Movement[];
  notices: Notice[];
  buffer: Point;
  utilities: { power: boolean; water: boolean };
  wageClock: number;
  guide: boolean;
}
export type Selection = {
  type:
    | 'worker'
    | 'equipment'
    | 'stack'
    | 'building'
    | 'job'
    | 'jobGroup'
    | 'order'
    | 'zone'
    | 'buffer';
  id: string;
};
