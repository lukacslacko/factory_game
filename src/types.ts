import type { TrackPiece } from './track';
export type Point = { x: number; z: number };
export type Rect = Point & { w: number; d: number };
export type Item =
  | 'slab'
  | 'rail'
  | 'railCurve'
  | 'railPoints'
  | 'railFrog'
  | 'railClosure'
  | 'railExit'
  | 'bufferStop'
  | 'office'
  | 'sanitary'
  | 'shed'
  | 'store'
  | 'lamp'
  | 'diesel'
  | 'fence';
export type BuildKind = Item | 'power' | 'water';
export type Role = 'builder' | 'operator' | 'engineer';
export type EquipmentKind = 'excavator' | 'forklift';
export type EquipmentWorkRole =
  'all' | 'receiving' | 'paving' | 'construction' | 'rail' | 'recovery' | 'hold';
export type EquipmentActivity = Exclude<EquipmentWorkRole, 'all' | 'hold'>;
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
  /** Pedestrian whose walking escape must finish after a withdrawal. */
  trafficYieldWorker?: string;
  /** Keep clear until the addressed equipment has passed the work dock. */
  trafficYieldEquipment?: string;
  trafficRetry?: number;
  /** Physical blockage duration; route retries must not reset this clock. */
  trafficBlockedSince?: number;
  trafficBlockedNotice?: boolean;
};
export interface Worker extends Point, Move, Motion {
  id: string;
  name: string;
  role: Role;
  /** Dedicated ground helper; separate from the machine operator. */
  assistingEquipment?: string;
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
  /** Selected automatic activities. Absent on older saves; workRole remains their fallback. */
  allowedWork?: EquipmentActivity[];
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
  assemblyLoad?: {
    job: string;
    kind: ShedPartKind;
    length: number;
    width: number;
    yawOffset: number;
  };
  heading: number;
  work: number;
  transportOrder?: string;
  deliveryOrder?: string;
  lift?: number;
  reach?: number;
}
export interface Stack extends Rect {
  /** Physical panels in shared preparation stock; canceled IDs retain resumable, unreserved steel. */
  railStagingJobs?: string[];
  /** Recovered component identity for each layer, bottom to top; null means new steel. */
  railAssetIds?: (string | null)[];
  trackHand?: 1 | -1;
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
export interface BufferStop extends Point {
  id: string;
  y: number;
  yaw: number;
  secured: boolean;
  carried: boolean;
  source?: string;
}
export interface Rail extends Point {
  track?: TrackPiece;
  item?: Item;
  selectedRoute?: 'straight' | 'branch';
  id: string;
  rotation: number;
  length: number;
}
/** A virtual service designation anchored to physical rail, not an installed sign. */
export interface RailLocation {
  id: string;
  name: string;
  kind: 'loading' | 'unloading' | 'transfer' | 'parking';
  trackId: string;
  route: 'straight' | 'branch';
  /** Arc distance from the referenced path's entry, in meters. */
  offset: number;
  /** Centered rail interval; no cargo capacity or traffic reservation is created. */
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
  | 'configure-staged-panel'
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
export interface RailBatchBuffer {
  pose: RailWorkPose & { id: string; secured: boolean; carried: boolean };
  start: RailWorkPose;
  latestEnd: RailWorkPose;
  ownerJob?: string;
}
export interface RailWork {
  /** Stable alternate crane dock; keep the same safe approach through lowering and saves. */
  approach?: { preferred: Point; target: Point; point: Point };
  /** Deduplicated static route warnings and bounded route retry cadence. */
  routeBlockage?: { blocker: string; since: number; retryAt: number; warned?: boolean };
  /** Temporary handling-site occupants addressed by this crew; saved for deduplicated warnings. */
  siteClearance?: {
    area?: string;
    blockers: string[];
    requested: string[];
    since: number;
    warned?: boolean;
    retryAt?: number;
  };
  /** Same-type panels transported together by this staging pass; installation remains per panel. */
  stagingBatch?: { jobIds: string[]; qty: number };
  configuredHand?: 1 | -1;
  configureProgress?: number;
  legacyForkYaw?: number;
  phase: RailWorkPhase;
  clock: number;
  start: Point;
  end: Point;
  axisYaw: number;
  stageYaw?: number;
  entryYaw?: number;
  endYaw?: number;
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
  buffer?: RailWorkPose & { id: string; secured: boolean; carried: boolean };
  source?: {
    stackId: string;
    pose: RailWorkPose;
    dock: Point;
    clear: Point;
    workerPoint: Point;
    approach?: Point;
    entering?: boolean;
  };
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
  railCrew?: { stagingEquipment?: string; installingEquipment?: string };
  railBuffer?: RailBatchBuffer;
  track?: Omit<TrackPiece, 'section' | 'groupId'>;
  id: string;
  label: string;
  parentId?: string;
  preferredEquipment?: string;
  /** Sticky automatic machine for the whole work order, separate from a manual assignment. */
  automaticEquipment?: string;
  equipmentPriority?: number;
  created: number;
}
export type ShedPartKind = 'post' | 'beam' | 'roof' | 'wall' | 'brace';
export interface ShedAssembly {
  phase:
    | 'stage'
    | 'unpack'
    | 'anchor'
    | 'collect'
    | 'rig'
    | 'lift'
    | 'carry'
    | 'lower'
    | 'fasten'
    | 'withdraw'
    | 'complete';
  clock: number;
  anchors: number;
  posts: number;
  beams: number;
  roofSheets: number;
  wallPanels: number;
  braces: number;
  kitPose: RailWorkPose;
  recovering: boolean;
  dock?: Point;
  workerPoint?: Point;
  ladder?: Point & { height: number };
  part?: {
    kind: ShedPartKind;
    index: number;
    pose: RailWorkPose;
    from: RailWorkPose;
    to: RailWorkPose;
    carried?: boolean;
  };
}
export interface Job extends Rect {
  /** Created directly in creative mode, without consuming delivered stock. */
  creative?: boolean;
  /** Another panel's active staging pass owns this panel's reserved or carried material. */
  railStagingBatch?: string;
  track?: TrackPiece;
  parentId?: string;
  preferredEquipment?: string;
  equipmentPriority?: number;
  legacyRailHandoff?: 'carried' | 'staged' | 'installed';
  /** First physical pass of this same panel record, handed off after staging. */
  railStageOnly?: boolean;
  railBufferCleanup?: boolean;
  bufferTarget?: Point & { yaw: number };
  bufferDestination?: Rect;
  id: string;
  kind: BuildKind | 'refuel' | 'remove' | 'throwSwitch' | 'moveStock';
  /** Exact-source physical rail relocation, never a construction material demand. */
  stockMove?: { sourceId: string; destination: Rect; yaw: number; mergeId?: string };
  /** Installed steel remains in the network until its joints and slings are released. */
  railRecovery?: {
    railId: string;
    recoveredItem: Item;
    rail: Rail;
    buffers: string[];
    unbolted?: boolean;
    lifted?: boolean;
    retightenClock?: number;
  };
  requestedRoute?: 'straight' | 'branch';
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
  /** Physical identities of a carried rail batch, bottom to top. */
  railAssetIds?: (string | null)[];
  recoveryStack?: Stack;
  retryAt?: number;
  retryRevision?: number;
  fuelLiters?: number;
  railWork?: RailWork;
  handling?: ConstructionHandling;
  shedAssembly?: ShedAssembly;
}
export interface OrderLine {
  item: string;
  qty: number;
  arrived: number;
}
/** One physical flatcar with a stable identity and its own cargo accounting. */
export interface RailFreightCar {
  id: string;
  kind: 'flatcar';
  manifest: (OrderLine & { orderLineIndex: number })[];
  length: number;
  width: number;
  wheelbase: number;
  centerOffset: number;
  /** Original payload mass, in kilograms; tare is accounted separately. */
  mass: number;
  tareMass: number;
  deckLength: number;
}
export interface RailFreight {
  locomotiveId: string;
  cars: RailFreightCar[];
  receptionLocationId?: string;
  storageZoneId?: string;
  stopDistance?: number;
  unloadRequested?: boolean;
}
export interface Order {
  /** Original parcel sizes: storage limits may increase without repacking an existing carrier. */
  stackLimits?: Partial<Record<Item, number>>;
  railFreight?: RailFreight;
  /** Manual recovery pauses only site handling; an empty carrier still departs. */
  unloadPaused?: boolean;
  unloadOperatorDuty?: Worker['duty'];
  unloadBlockage?: { since: number; reason: string; warned?: boolean };
  /** One carrier, with separately accounted material or passenger lines. */
  manifest?: OrderLine[];
  /** One automatic unloading machine across all lifts of this carrier. */
  automaticEquipment?: string;
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
    /** Last worker addressed during the current driving blockage. */
    clearanceRequestedFor?: string;
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
  carId?: string;
  carLineIndex?: number;
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
  /** Older activity rows have ordinary informational severity. */
  severity?: 'info' | 'warning';
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
  /** Direct, cost-free placement of completed assets for testing. */
  creative?: boolean;
  next: number;
  revision: number;
  workers: Worker[];
  equipment: Equipment[];
  stacks: Stack[];
  buildings: Building[];
  rails: Rail[];
  railLocations?: RailLocation[];
  buffers?: BufferStop[];
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
    | 'railLocation'
    | 'buffer';
  id: string;
};
