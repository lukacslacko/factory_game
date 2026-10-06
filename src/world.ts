import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { ContactShadingPass } from './contact-shading';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { surfaceMaterial } from './surfaces';
import { WornPaths } from './worn-paths';
import { railLocationPose, railLocationPath, railLocationStatus } from './rail-locations';
import { trackNetwork } from './track';
import { equipmentIntent } from './equipment-intent';
import { GATE_PADS, groundPad, sceneryRandom } from './terrain-visuals';
import { assembledShed, shedComponentModel } from './shed-visuals';
import { shedComponentPose, shedPostPoints } from './shed-geometry';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type {
  State,
  Point,
  Rect,
  Selection,
  BuildKind,
  Equipment,
  Motion,
  Order,
  Item,
  RailWork,
  RailWorkPose,
  Job,
  ShedPartKind,
} from './types';
import { MATERIALS, BUILDINGS, footprint, RAIL_CENTER_OFFSET, RAIL_HEAD_WIDTH } from './catalog';
import { center, dist } from './path';
import { material, boxGeo, box, bevelBox, cylinder, beam, sign } from './mesh';
import {
  mixAngle,
  angleDelta,
  carPose,
  sampleRoad,
  roadWheelTravel,
  ROAD_CENTER_Z,
  ROAD_WIDTH,
  roadSurfaceHeight,
  deckPose,
  COUPLED_CENTERS,
  deliveryKind,
  localPoint,
  smoothstep,
} from './motion';
import { shipmentLots, stackHeight, parcelPitch } from './delivery';
import { railFreightCarPose } from './rail-freight';
import { RAIL_PANEL_PITCH } from './railwork';
import { trackGeometry, railCells, type TrackPiece } from './track';
import {
  animateTurnout,
  isRailMaterial,
  stockRailModel,
  trackLiftPoints,
  trackPanelModel,
} from './track-visuals';

type RenderPose = Point &
  Required<Pick<Motion, 'y' | 'yaw' | 'travel'>> & {
    lift: number;
    reach: number;
    pitch: number;
    moving: boolean;
  };
type RailWorkRenderState = {
  panel: RailWorkPose;
  buffer?: RailWorkPose;
  phase: string;
  clock: number;
};
const interpolateWorkPose = (
  a: RailWorkPose | undefined,
  b: RailWorkPose,
  t: number,
): RailWorkPose => ({
  x: lerp(a?.x ?? b.x, b.x, t),
  z: lerp(a?.z ?? b.z, b.z, t),
  y: lerp(a?.y ?? b.y, b.y, t),
  yaw: mixAngle(a?.yaw ?? b.yaw, b.yaw, t),
});
type DeliveryPose = {
  distance: number;
  ramp: number;
  clock: number;
  phase?: string;
  cargo?: Point & { y: number; yaw: number };
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function updateBeam(
  parent: THREE.Group,
  index: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
  width: number,
  color: number,
) {
  const mesh = parent.children[index] || box(parent, 0, 0, 0, width, 1, width, color, 0.4);
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.scale.set(width, a.distanceTo(b), width);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}

function roadRenderPose(o: Order, distance: number) {
  const p = sampleRoad(o, distance),
    a = sampleRoad(o, Math.max(0, distance - 0.6)),
    b = sampleRoad(o, distance + 0.6);
  const yaw = mixAngle(a.yaw, b.yaw, 0.5);
  return { ...p, yaw };
}
function container(g: THREE.Group, w: number, d: number, _color: number, kind: string) {
  const shell = 0xcbd0d0,
    trim = 0xb1b9bc,
    steel = 0x5a656a;
  box(g, 0, 0.18, 0, w, 0.25, d, steel, 0.25);
  bevelBox(g, 0, 1.55, 0, w - 0.08, 2.6, d - 0.08, shell, 0.045);
  box(g, 0, 2.89, 0, w + 0.1, 0.1, d + 0.1, 0xc4cbd0, 0.2);
  // Shallow galvanized ribs read as sheet metal, rather than striped roofs.
  for (let x = -w / 2 + 0.06; x < w / 2; x += 0.14)
    box(g, x, 2.953, 0, 0.038, 0.018, d, 0xd1d5d5, 0.12);
  for (let x = -w / 2 + 0.14; x < w / 2; x += 0.18)
    for (const side of [-1, 1])
      box(g, x, 1.56, side * (d / 2 - 0.005), 0.025, 2.51, 0.022, 0xc0c7c8, 0.12);
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08])
    for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) {
      box(g, x, 1.52, z, 0.12, 2.8, 0.12, trim, 0.25);
      for (const y of [0.28, 2.75]) box(g, x, y, z, 0.16, 0.16, 0.16, steel, 0.4);
    }
  const doorX = -w / 2 + 0.72;
  box(g, doorX, 1.35, d / 2 + 0.038, 0.93, 2.25, 0.065, trim, 0.15);
  bevelBox(g, doorX, 1.35, d / 2 + 0.076, 0.78, 2.08, 0.025, 0x6b7e83, 0.01);
  box(g, doorX + 0.23, 1.28, d / 2 + 0.103, 0.13, 0.035, 0.038, 0xd6dadb, 0.6);
  box(g, doorX, 0.16, d / 2 + 0.46, 1.16, 0.2, 0.85, 0x898b86);
  box(g, doorX, 0.275, d / 2 + 0.23, 1.02, 0.035, 0.34, 0xb4b9b8, 0.15);
  if (kind === 'office') {
    for (let x = -0.35; x < w / 2 - 0.5; x += 1.6)
      for (const side of [-1, 1]) {
        const z = side * (d / 2 + 0.05);
        box(g, x, 1.8, z, 1.24, 1.08, 0.075, 0xe0e3e2);
        box(g, x, 1.8, z + side * 0.046, 1.1, 0.91, 0.025, 0x405762, 0.2);
        box(g, x, 1.8, z + side * 0.065, 0.035, 0.93, 0.018, 0xc7d0d1, 0.25);
        box(g, x, 1.31, z + side * 0.1, 1.27, 0.04, 0.13, 0xa4aeb2, 0.2);
        // Reflected sky strip gives glazing a readable plane at the working zoom.
        box(g, x, 2.05, z + side * 0.062, 1.07, 0.12, 0.005, 0x77949e, 0.2);
      }
  } else box(g, 0.52, 2.13, d / 2 + 0.06, 0.55, 0.37, 0.035, 0x637d88);
  for (let y = 1.8; y < 2.25; y += 0.06)
    box(g, w / 2 + 0.018, y, 0, 0.018, 0.026, 0.55, steel, 0.3);
  const label = sign(
    g,
    kind === 'office' ? 'SITE OFFICE' : 'WC / SHOWER',
    0.55,
    2.57,
    d / 2 + 0.035,
    kind === 'office' ? 1.65 : 1.35,
  );
  label.name = 'container-nameplate';
}
function shed(g: THREE.Group, w: number, d: number, closed = false) {
  for (const x of [-w / 2 + 0.18, w / 2 - 0.18])
    for (const z of [-d / 2 + 0.18, 0, d / 2 - 0.18]) {
      box(g, x, 2.15, z, 0.16, 4.3, 0.16, 0x617079, 0.4);
      box(g, x, 0.08, z, 0.4, 0.12, 0.4, 0xb2b1a8);
    }
  for (const z of [-d / 2, d / 2]) {
    beam(g, new THREE.Vector3(-w / 2, 3.9, z), new THREE.Vector3(0, 4.7, z), 0.12, 0x73818a);
    beam(g, new THREE.Vector3(w / 2, 3.9, z), new THREE.Vector3(0, 4.7, z), 0.12, 0x73818a);
  }
  for (let x = -w / 2; x < w / 2; x += 0.23) {
    const y = 4.75 - (Math.abs(x) / w) * 1.5;
    box(g, x, y, 0, 0.225, 0.09, d + 0.45, closed ? 0xa5afb3 : 0xaeb8bd, 0.25);
  }
  if (closed) {
    box(g, 0, 1.9, -d / 2, w, 3.8, 0.12, 0xc5cbcc);
    box(g, -w / 2, 1.9, 0, 0.12, 3.8, d, 0xbbc3c5);
    box(g, w / 2, 1.9, 0, 0.12, 3.8, d, 0xbbc3c5);
    box(g, 0, 1.9, d / 2, w, 3.8, 0.12, 0xb3bfc3);
    box(g, 0, 1.5, d / 2 + 0.09, 2.5, 3, 0.12, 0x536e60);
    for (let y = 0.2; y < 3; y += 0.23) box(g, 0, y, d / 2 + 0.17, 2.5, 0.018, 0.01, 0x718779);
    sign(g, 'STORES', 0, 3.5, d / 2 + 0.12, 1.8);
  } else {
    box(g, 0, 2, -d / 2, w, 3.8, 0.08, 0xb0bcc0);
    beam(
      g,
      new THREE.Vector3(-w / 2, 0.1, -d / 2 + 0.1),
      new THREE.Vector3(w / 2, 4, -d / 2 + 0.1),
      0.06,
      0x616b72,
    );
  }
}
import {
  excavator,
  forklift,
  workerModel,
  roadVehicle,
  locomotive,
  flatcar,
  animateMachine,
  animatePerson,
  animateWheels,
} from './models';
export class World {
  scene = new THREE.Scene();
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  occlusion: SSAOPass;
  controls: OrbitControls;
  ray = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  staticGroup = new THREE.Group();
  dynamicGroup = new THREE.Group();
  planGroup = new THREE.Group();
  grid: THREE.GridHelper;
  hover = new THREE.Group();
  selected = new THREE.Group();
  equipmentIntentOverlay = new THREE.Group();
  private intentEquipmentId?: string;
  private intentKey = '';
  private intentMarkerKey = '';
  private intentBlockerKey = '';
  private intentRoutes = new THREE.Group();
  private intentMarkers = new THREE.Group();
  private intentBlockers = new THREE.Group();
  models = new Map<string, THREE.Group>();
  revision = -1;
  sun: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
  buffer: THREE.Group;
  onPick?: (s: Selection | undefined, p: Point) => void;
  onHover?: (p: Point) => void;
  onDrag?: (a: Point, b: Point) => void;
  onNavigate?: () => void;
  dragMode = false;
  panMode = true;
  pointerStart?: { x: number; y: number; p: Point; pan: boolean; moved: boolean; id: number };
  night = false;
  state?: State;
  frame = 0;
  lights: THREE.PointLight[] = [];
  landscape = new THREE.Group();
  private wornPaths = new WornPaths();
  private previous = new Map<string, RenderPose>();
  private previousDeliveries = new Map<string, DeliveryPose>();
  private previousRailWork = new Map<string, RailWorkRenderState>();
  private previousHandling = new Map<
    string,
    { pose: RailWorkPose; toolLift: number; toolReach: number; phase: string; clock: number }
  >();
  private previousShedWork = new Map<string, { phase: string; clock: number }>();
  private previousSwitchWork = new Map<string, { phase: string; elapsed: number }>();
  private previousShedParts = new Map<
    string,
    { pose: RailWorkPose; kind: ShedPartKind; index: number }
  >();
  private shadowExtent = 0;
  /** Capture only moving values before a fixed simulation step. Rendering blends
   * between two real states without changing the simulation or its timestamps. */
  capturePrevious(s: State) {
    this.previous.clear();
    this.previousDeliveries.clear();
    this.previousRailWork.clear();
    this.previousHandling.clear();
    this.previousShedParts.clear();
    this.previousShedWork.clear();
    this.previousSwitchWork.clear();
    for (const j of s.jobs)
      if (j.kind === 'throwSwitch')
        this.previousSwitchWork.set(j.id, { phase: j.phase, elapsed: j.elapsed });
    for (const j of s.jobs)
      if (j.shedAssembly)
        this.previousShedWork.set(j.id, {
          phase: j.shedAssembly.phase,
          clock: j.shedAssembly.clock,
        });
    for (const j of s.jobs)
      if (j.shedAssembly?.part) {
        const part = j.shedAssembly.part;
        this.previousShedParts.set(j.id, {
          pose: { ...part.pose },
          kind: part.kind,
          index: part.index,
        });
      }
    for (const j of s.jobs)
      if (j.handling)
        this.previousHandling.set(j.id, {
          pose: { ...j.handling.pose },
          toolLift: j.handling.toolLift,
          toolReach: j.handling.toolReach,
          phase: j.handling.phase,
          clock: j.handling.clock,
        });
    for (const j of s.jobs)
      if (j.railWork)
        this.previousRailWork.set(j.id, {
          panel: { ...j.railWork.panel },
          phase: j.railWork.phase,
          clock: j.railWork.clock,
          buffer: j.railWork.buffer ? { ...j.railWork.buffer } : undefined,
        });
    for (const p of [...s.workers, ...s.equipment]) this.previous.set(p.id, this.readPose(s, p));
    for (const o of s.orders) {
      if (o.contractor) this.previous.set(`${o.id}-crew`, this.readPose(s, o.contractor));
      this.previousDeliveries.set(o.id, {
        distance: o.drive?.distance ?? 0,
        ramp: o.ramp ?? 0,
        phase: o.unload?.phase,
        clock: o.unload?.clock ?? 0,
        cargo: o.unload?.cargo ? { ...o.unload.cargo } : undefined,
      });
    }
  }
  private surface(s: State, p: Point) {
    return s.paving[`${Math.floor(p.x)},${Math.floor(p.z)}`] ? 0.105 : 0;
  }
  private readPose(
    s: State,
    p: Point &
      Motion & { heading?: number; path?: Point[]; lift?: number; reach?: number; pitch?: number },
  ): RenderPose {
    return {
      x: p.x,
      z: p.z,
      y: p.y ? p.y : this.surface(s, p),
      yaw: p.yaw ?? ((p.heading || 0) * Math.PI) / 2,
      travel: p.travel ?? 0,
      lift: p.lift ?? 0.12,
      reach: p.reach ?? 2.7,
      pitch: p.pitch ?? 0,
      moving: !!p.path?.length || Math.abs(p.velocity || 0) > 0.01,
    };
  }
  private renderPose(
    s: State,
    id: string,
    p: Parameters<World['readPose']>[1],
    alpha: number,
  ): RenderPose {
    const b = this.readPose(s, p),
      a = this.previous.get(id);
    if (!a) return b;
    return {
      x: lerp(a.x, b.x, alpha),
      z: lerp(a.z, b.z, alpha),
      y: lerp(a.y, b.y, alpha),
      yaw: mixAngle(a.yaw, b.yaw, alpha),
      travel: lerp(a.travel, b.travel, alpha),
      lift: lerp(a.lift, b.lift, alpha),
      reach: lerp(a.reach, b.reach, alpha),
      pitch: lerp(a.pitch, b.pitch, alpha),
      moving: a.moving || b.moving,
    };
  }
  private positionModel(
    g: THREE.Group,
    p: RenderPose | (Point & { y?: number; yaw: number; pitch?: number }),
  ) {
    g.position.set(p.x, p.y || 0, p.z);
    // The simulation uses geographic +Z clockwise, Three.js uses right-handed yaw.
    g.rotation.set(0, -p.yaw, p.pitch || 0, 'YXZ');
  }
  private fitShadowToView() {
    const extent = Math.max(
      20,
      Math.min(
        140,
        Math.ceil((this.camera.position.distanceTo(this.controls.target) * 0.72) / 5) * 5,
      ),
    );
    if (extent !== this.shadowExtent) {
      this.shadowExtent = extent;
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -extent;
      c.right = c.top = extent;
      c.near = 1;
      c.far = 280;
      c.updateProjectionMatrix();
    }
    // Snap in light space, so a camera pan does not make the shadow texels crawl.
    const lightDirection = new THREE.Vector3(-45, 85, -40).normalize();
    const right = new THREE.Vector3(lightDirection.z, 0, -lightDirection.x).normalize();
    const up = new THREE.Vector3().crossVectors(lightDirection, right).normalize();
    const target = this.controls.target.clone();
    const texel = (2 * extent) / this.sun.shadow.mapSize.x;
    target.addScaledVector(
      right,
      Math.round(target.dot(right) / texel) * texel - target.dot(right),
    );
    target.addScaledVector(up, Math.round(target.dot(up) / texel) * texel - target.dot(up));
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(lightDirection, 125);
  }
  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(environment, 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    environment.dispose();
    pmrem.dispose();
    this.scene.background = new THREE.Color(0xd9e2e7);
    this.scene.fog = new THREE.Fog(0xd9e2e7, 150, 700);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1500);
    this.camera.position.set(28, 45, 80);
    this.camera.layers.enable(1);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.occlusion = new ContactShadingPass(this.scene, this.camera, 1, 1, 12);
    this.occlusion.kernelRadius = 0.7;
    this.occlusion.minDistance = 0.0005;
    this.occlusion.maxDistance = 0.035;
    this.composer.addPass(this.occlusion);
    this.composer.addPass(new OutputPass());
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(28, 0, 25);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.enableRotate = true;
    this.controls.minPolarAngle = 0.32;
    this.controls.maxPolarAngle = 1.08;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 360;
    this.controls.mouseButtons = {
      LEFT: -1 as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => this.onNavigate?.());
    this.ambient = new THREE.HemisphereLight(0xe9f2ff, 0x77736c, 1.5);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff5e7, 2.8);
    this.sun.position.set(55, 90, -40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.camera.left = -95;
    this.sun.shadow.camera.right = 95;
    this.sun.shadow.camera.top = 95;
    this.sun.shadow.camera.bottom = -95;
    this.sun.shadow.normalBias = 0.008;
    this.sun.shadow.radius = 2;
    this.sun.shadow.bias = -0.000008;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 280;
    this.scene.add(this.sun, this.sun.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), surfaceMaterial('soil'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.scene.add(this.wornPaths.mesh);
    this.grid = new THREE.GridHelper(300, 300, 0x9a998e, 0x9a998e);
    this.grid.position.set(70, 0.009, 50);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.1;
    (this.grid.material as THREE.Material).depthWrite = false;
    this.scene.add(this.grid);
    this.scene.add(
      this.staticGroup,
      this.dynamicGroup,
      this.planGroup,
      this.hover,
      this.selected,
      this.equipmentIntentOverlay,
      this.landscape,
    );
    this.equipmentIntentOverlay.add(this.intentRoutes, this.intentMarkers, this.intentBlockers);
    this.buildCorridor();
    this.buffer = new THREE.Group();
    for (const z of [-RAIL_CENTER_OFFSET, RAIL_CENTER_OFFSET]) {
      const post = box(this.buffer, 0, 0.65, z, 0.18, 1.1, 0.18, 0x8c493b, 0.45);
      post.name = 'buffer-upright';
      box(this.buffer, 0.6, 0.18, z, 1.55, 0.16, 0.24, 0x5e655d, 0.5);
      beam(
        this.buffer,
        new THREE.Vector3(1.2, 0.23, z),
        new THREE.Vector3(0, 1.05, z),
        0.12,
        0x9b5040,
      );
      const pad = cylinder(this.buffer, -0.24, 1.1, z, 0.22, 0.18, 0x363e39);
      pad.rotation.z = Math.PI / 2;
      for (const x of [-0.08, 1.22]) cylinder(this.buffer, x, 0.29, z, 0.055, 0.08, 0xb7b8a0, 6);
    }
    box(this.buffer, 0, 1.1, 0, 0.24, 0.3, 1.96, 0xd15d43);
    for (const z of [-0.6, 0, 0.6]) box(this.buffer, -0.126, 1.1, z, 0.015, 0.26, 0.22, 0xe5ddc9);
    const bufferTag = sign(this.buffer, 'BUFFER 001', -0.15, 1.43, 0, 0.9);
    bufferTag.rotation.y = -Math.PI / 2;
    // Feet define the model origin; installed rails support them at Y=.2.
    for (const child of this.buffer.children) child.position.y -= 0.1;
    this.buffer.userData.selection = { type: 'buffer', id: 'BUFFER-001' };
    this.scene.add(this.buffer);
    this.buildVegetation();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        const p = this.point(e);
        if (p) {
          this.pointerStart = {
            x: e.clientX,
            y: e.clientY,
            p,
            pan: this.panMode && !this.pick(e),
            moved: false,
            id: e.pointerId,
          };
          canvas.setPointerCapture(e.pointerId);
        }
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      let p = this.point(e);
      const start = this.pointerStart;
      if (
        start?.pan &&
        p &&
        (start.moved || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6)
      ) {
        if (!start.moved) this.onNavigate?.();
        start.moved = true;
        const delta = new THREE.Vector3(start.p.x - p.x, 0, start.p.z - p.z);
        this.controls.target.add(delta);
        this.camera.position.add(delta);
        this.camera.updateMatrixWorld();
        this.canvas.style.cursor = 'grabbing';
        p = this.point(e);
      }
      if (p) this.onHover?.(p);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.pointerStart) return;
      const start = this.pointerStart;
      this.pointerStart = undefined;
      this.canvas.style.cursor = '';
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (start.moved) return;
      const p = this.point(e);
      if (!p) return;
      if (this.dragMode && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5)
        this.onDrag?.(start.p, p);
      else if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6)
        this.onPick?.(this.pick(e), p);
    });
    const cancelPointer = () => {
      this.pointerStart = undefined;
      this.canvas.style.cursor = '';
    };
    canvas.addEventListener('pointercancel', cancelPointer);
    canvas.addEventListener('lostpointercapture', cancelPointer);
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    // Full-resolution color/MSAA; broad contact shading uses a smaller depth buffer.
    this.occlusion.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  rail(parent: THREE.Object3D, points: THREE.Vector3[], existing = true) {
    const g = new THREE.Group();
    parent.add(g);
    const len = points.reduce((n, p, i) => n + (i ? p.distanceTo(points[i - 1]) : 0), 0);
    const curve = new THREE.CatmullRomCurve3(points);
    const segments = Math.ceil(len / 0.67);
    const rails = new THREE.InstancedMesh(boxGeo, material(0xa5adb1, 0.43, 0.72), segments * 2);
    rails.name = 'rail-heads';
    const ties = new THREE.InstancedMesh(boxGeo, material(0x65574a), segments);
    const ballast = new THREE.InstancedMesh(boxGeo, surfaceMaterial('ballast'), Math.ceil(len / 2));
    const obj = new THREE.Object3D();
    for (let i = 0; i < segments; i++) {
      const t = (i + 0.5) / segments,
        p = curve.getPointAt(t),
        dir = curve.getTangentAt(t),
        angle = -Math.atan2(dir.z, dir.x);
      obj.position.copy(p);
      obj.position.y = 0.09;
      obj.rotation.set(0, angle, 0);
      obj.scale.set(len / segments + 0.012, 0.15, 1.95);
      obj.scale.x = 0.22;
      obj.updateMatrix();
      ties.setMatrixAt(i, obj.matrix);
      for (let side = 0; side < 2; side++) {
        const offset = (side ? 1 : -1) * RAIL_CENTER_OFFSET;
        obj.position.set(p.x - dir.z * offset, 0.24, p.z + dir.x * offset);
        obj.scale.set(len / segments + 0.018, 0.17, 0.072);
        obj.updateMatrix();
        rails.setMatrixAt(i * 2 + side, obj.matrix);
      }
    }
    for (let i = 0; i < ballast.count; i++) {
      const t = (i + 0.5) / ballast.count,
        p = curve.getPointAt(t),
        dir = curve.getTangentAt(t);
      obj.position.set(p.x, 0.01, p.z);
      obj.rotation.set(0, -Math.atan2(dir.z, dir.x), 0);
      obj.scale.set(len / ballast.count + 0.1, 0.1, 2.7);
      obj.updateMatrix();
      ballast.setMatrixAt(i, obj.matrix);
    }
    rails.castShadow = ties.castShadow = true;
    rails.receiveShadow = ties.receiveShadow = ballast.receiveShadow = true;
    g.add(ballast, ties, rails);
    return g;
  }
  buildCorridor() {
    const g = new THREE.Group();
    g.name = 'transport-corridor';
    this.scene.add(g);
    const road = groundPad(g, 120, -0.005, ROAD_CENTER_Z, 800, 0.06, ROAD_WIDTH, 0xffffff);
    road.material = surfaceMaterial('asphalt');
    for (let x = -240; x < 520; x += 8)
      groundPad(g, x, 0.033, ROAD_CENTER_Z, 3, 0.008, 0.1, 0xe3e1d5);
    for (const z of [ROAD_CENTER_Z - ROAD_WIDTH / 2 + 0.15, ROAD_CENTER_Z + ROAD_WIDTH / 2 - 0.15])
      groundPad(g, 120, 0.033, z, 800, 0.007, 0.085, 0xe3e1d5);
    // Two distinct gate lanes, with room for the vehicle bodies as they turn.
    for (const r of GATE_PADS)
      groundPad(g, r.x + r.w / 2, 0.02, r.z + r.d / 2, r.w, 0.1, r.d, 0x797a76);
    for (const z of [-5, 9.5, 13]) groundPad(g, -8, 0.078, z, 0.09, 0.01, 1.8, 0xe3e1d5);
    // The bus door opens onto this curbside landing rather than into traffic.
    groundPad(g, -30, 0.003, -7.9, 16, 0.006, 1.4, 0xb6b7a8);
    groundPad(g, -30, 0.008, -8.65, 16, 0.012, 0.18, 0xd6cfab);
    const busStop = sign(g, 'BUS', -30, 0.012, -7.8, 2);
    busStop.rotation.x = -Math.PI / 2;
    // Compacted maneuvering ground for the empty lowloader's forward turn.
    groundPad(g, -18, 0.007, 36, 30, 0.012, 38, 0xb3a790);
    this.rail(g, [new THREE.Vector3(-260, 0, 0), new THREE.Vector3(520, 0, 0)]);
    this.rail(
      g,
      Array.from({ length: 26 }, (_, x) => {
        const t = x / 25;
        return new THREE.Vector3(x, 0, 5 * (3 * t * t - 2 * t * t * t));
      }),
    );
    this.rail(g, [new THREE.Vector3(25, 0, 5), new THREE.Vector3(125, 0, 5)]);
    // This crossing lies before the switch: only the main-line rails cross it.
    const railLines = [-RAIL_CENTER_OFFSET, RAIL_CENTER_OFFSET];
    const crossStops = Array.from({ length: 61 }, (_, i) => -5 + i * 0.25);
    for (const z of railLines) crossStops.push(z - 0.07, z + 0.07);
    crossStops.sort((a, b) => a - b);
    const positions: number[] = [];
    for (let i = 1; i < crossStops.length; i++) {
      const a = crossStops[i - 1],
        b = crossStops[i];
      if (railLines.some((z) => Math.abs((a + b) / 2 - z) < 0.07)) continue;
      const ya = roadSurfaceHeight({ x: -8, z: a }),
        yb = roadSurfaceHeight({ x: -8, z: b });
      positions.push(
        -12.1,
        ya,
        a,
        -12.1,
        yb,
        b,
        -3.9,
        ya,
        a,
        -3.9,
        ya,
        a,
        -12.1,
        yb,
        b,
        -3.9,
        yb,
        b,
      );
    }
    const crossingGeometry = new THREE.BufferGeometry();
    crossingGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    crossingGeometry.computeVertexNormals();
    const crossing = new THREE.Mesh(crossingGeometry, material(0x999b99));
    crossing.name = 'raised-road-crossing';
    crossing.receiveShadow = true;
    g.add(crossing);
    for (let x = -110; x < 250; x += 28) {
      cylinder(g, x, 4.2, -20, 0.13, 8.4, 0x797054, 8);
      const crossarm = box(g, x, 7.65, -20, 0.16, 0.15, 2.8, 0x60674f);
      crossarm.name = 'utility-crossarm';
      for (const dz of [-1, 0, 1]) cylinder(g, x, 7.9, -20 + dz, 0.11, 0.3, 0xacae91, 8);
      if (x + 28 < 250) {
        for (const dz of [-1, 0, 1]) {
          const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(x, 8, -20 + dz),
            new THREE.Vector3(x + 14, 7.15, -20 + dz),
            new THREE.Vector3(x + 28, 8, -20 + dz),
          ]);
          const wire = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 12, 0.017, 3, false),
            material(0x4c5949),
          );
          wire.name = 'utility-wire';
          g.add(wire);
        }
      }
    }
    for (const z of [-5, 9]) {
      cylinder(g, -13, 1.5, z, 0.055, 3, 0xa6aea0);
      const a = box(g, -13, 2.5, z, 1.5, 0.18, 0.08, 0xe3debc);
      a.rotation.z = 0.7;
      const b = box(g, -13, 2.5, z, 1.5, 0.18, 0.08, 0xe3debc);
      b.rotation.z = -0.7;
    }
    groundPad(g, 6.5, 0.03, 18, 39, 0.04, 8, 0xb8ad96);
    const receiving = sign(g, 'RECEIVING', 18, 0.073, 14, 3);
    receiving.rotation.x = -Math.PI / 2;
  }
  buildVegetation() {
    const g = new THREE.Group();
    this.scene.add(g);
    let seed = 37;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const treeMat = material(0x687c58);
    const leaves = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 120; i++) {
      const x = -80 + rand() * 340,
        z = rand() > 0.3 ? 118 + rand() * 110 : -36 - rand() * 85;
      const h = 3 + rand() * 4;
      cylinder(g, x, h / 2, z, 0.16, h, 0x817254, 6);
      const crown = new THREE.Mesh(leaves, treeMat);
      crown.position.set(x, h, z);
      crown.scale.set(h * 0.6, h * 0.85, h * 0.6);
      crown.castShadow = true;
      g.add(crown);
    }
    for (let i = 0; i < 120; i++) {
      const x = -50 + rand() * 290,
        z = 14 + rand() * 100;
      if ((x > -15 && x < 221 && z < 111) || (x > -34 && x < -2 && z > 16 && z < 56)) continue;
      const m = new THREE.Mesh(leaves, material(0x899478));
      m.position.set(x, 0.3, z);
      m.scale.set(0.5 + rand(), 0.3 + rand() * 0.4, 0.5 + rand());
      m.castShadow = true;
      g.add(m);
    }
  }
  scatterGround(s: State) {
    this.disposeGroup(this.landscape);
    const verts: number[] = [];
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.399,
        c = Math.cos(angle),
        n = Math.sin(angle);
      const length = 0.24 + (i % 3) * 0.07,
        height = 0.16 + (i % 4) * 0.06;
      const left = [-n * 0.035, 0.015, c * 0.035];
      const right = [n * 0.035, 0.015, -c * 0.035];
      const tip = [c * length, height, n * length];
      const shoulder = [c * length * 0.6 + n * 0.026, height * 0.8, n * length * 0.6 - c * 0.026];
      verts.push(...left, ...right, ...shoulder, ...left, ...shoulder, ...tip);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    grassMaterial.userData.owned = true;
    const grass = new THREE.InstancedMesh(geo, grassMaterial, 14000);
    grass.name = 'ground-grass';
    const rock = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      material(0xa79d88),
      1200,
    );
    const shrubs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      material(0xffffff),
      6600,
    );
    const o = new THREE.Object3D();
    let gi = 0,
      ri = 0,
      si = 0;
    const occupied = [
      ...s.zones,
      ...s.buildings,
      ...s.rails.flatMap((r) => railCells(r).map((cell) => ({ ...cell, w: 1, d: 1 }))),
      ...s.jobs
        .filter((j) => j.status === 'doing')
        .flatMap((j) => (j.track ? railCells(j).map((cell) => ({ ...cell, w: 1, d: 1 })) : [j])),
    ];
    const clear = (x: number, z: number) => {
      if (
        (z > ROAD_CENTER_Z - ROAD_WIDTH / 2 - 0.3 && z < ROAD_CENTER_Z + ROAD_WIDTH / 2 + 0.3) ||
        (z > -1.7 && z < 6.8) ||
        (x > -39 && x < -21 && z > -9.3 && z < -6.7) ||
        (x > -13 && x < -3 && z < 26) ||
        (x > -34 && x < -2 && z > 16 && z < 56) ||
        (x > -14 && x < 27 && z > 13 && z < 23)
      )
        return true;
      if (s.paving[`${Math.floor(x)},${Math.floor(z)}`]) return true;
      if ((s.groundWear?.[`${Math.floor(x)},${Math.floor(z)}`] || 0) > 0.16) return true;
      return occupied.some(
        (r) => x > r.x - 0.5 && x < r.x + r.w + 0.5 && z > r.z - 0.5 && z < r.z + r.d + 0.5,
      );
    };
    let grassCandidates = 0,
      rockCandidates = 0;
    for (let i = 0; i < 42000 && grassCandidates < 14000; i++) {
      const rand = sceneryRandom(981, i);
      const x = -45 + rand() * 285,
        z = -33 + rand() * 170;
      const patch = (Math.sin(x * 0.12 + z * 0.05) + Math.cos(z * 0.19 - x * 0.07) + 2) / 4;
      if (rand() > patch * 0.85) continue;
      grassCandidates++;
      const hidden = clear(x, z);
      o.position.set(x, 0, z);
      o.rotation.set(0, rand() * Math.PI * 2, 0);
      const a = 0.5 + rand() * 0.7;
      o.scale.set(a, a, a);
      o.updateMatrix();
      const color = new THREE.Color(rand() < 0.25 ? 0xa8a270 : 0x7d8e52).multiplyScalar(
        0.8 + rand() * 0.35,
      );
      if (!hidden) {
        grass.setMatrixAt(gi, o.matrix);
        grass.setColorAt(gi++, color);
      }
      if (rand() < 0.09 && rockCandidates < 1200) {
        rockCandidates++;
        o.position.set(x + 0.5, 0.05, z + 0.4);
        o.scale.set(0.12 + rand() * 0.18, 0.09 + rand() * 0.14, 0.1 + rand() * 0.2);
        o.updateMatrix();
        if (!clear(x + 0.5, z + 0.4)) rock.setMatrixAt(ri++, o.matrix);
      }
    }
    // Rounded leaf clusters, confined to undeveloped ground; no scenery replaces stock.
    let shrubCandidates = 0;
    for (let i = 0; i < 3600 && shrubCandidates < 550; i++) {
      const rand = sceneryRandom(3911, i);
      const x = -45 + rand() * 285,
        z = -33 + rand() * 170;
      const patch = Math.sin(x * 0.12 + z * 0.05) + Math.cos(z * 0.19 - x * 0.07);
      if (patch < 0.2) continue;
      shrubCandidates++;
      if (clear(x, z) || clear(x - 0.7, z - 0.7) || clear(x + 0.7, z + 0.7)) continue;
      const size = 0.28 + rand() * 0.55;
      for (let l = 0; l < 12 && si < 6600; l++) {
        const theta = l * 2.399 + rand() * 0.4;
        o.position.set(
          x + Math.cos(theta) * size * (0.2 + rand() * 0.5),
          size * (0.2 + rand() * 0.4),
          z + Math.sin(theta) * size * (0.2 + rand() * 0.5),
        );
        o.rotation.set(rand() * 0.2, rand() * 6, rand() * 0.2);
        o.scale.set(
          size * (0.23 + rand() * 0.22),
          size * (0.18 + rand() * 0.22),
          size * (0.23 + rand() * 0.22),
        );
        o.updateMatrix();
        shrubs.setMatrixAt(si, o.matrix);
        shrubs.setColorAt(
          si++,
          new THREE.Color(l % 4 === 0 ? 0x8d9459 : 0x5f783e).multiplyScalar(0.85 + rand() * 0.3),
        );
      }
    }
    shrubs.count = si;
    shrubs.receiveShadow = shrubs.castShadow = true;
    grass.count = gi;
    rock.count = ri;
    grass.receiveShadow = true;
    rock.receiveShadow = true;
    rock.castShadow = true;
    for (const mesh of [grass, rock, shrubs]) mesh.layers.set(1);
    this.landscape.add(grass, rock, shrubs);
  }
  disposeGroup(g: THREE.Group) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      c.traverse((o) => {
        if (o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
        if (o instanceof THREE.Mesh) {
          if (o.geometry !== boxGeo) o.geometry.dispose();
          if (o instanceof THREE.InstancedMesh) o.dispose();
          if (o.material.userData?.owned) o.material.dispose();
          if (o.material instanceof THREE.MeshBasicMaterial) {
            o.material.map?.dispose();
            o.material.dispose();
          }
        }
      });
    }
  }
  outline(parent: THREE.Object3D, r: Rect, color: number, height = 0.05, dashed = false) {
    const pts = [
      new THREE.Vector3(r.x, height, r.z),
      new THREE.Vector3(r.x + r.w, height, r.z),
      new THREE.Vector3(r.x + r.w, height, r.z + r.d),
      new THREE.Vector3(r.x, height, r.z + r.d),
      new THREE.Vector3(r.x, height, r.z),
    ];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(
      g,
      dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.2 })
        : new THREE.LineBasicMaterial({ color }),
    );
    line.computeLineDistances();
    parent.add(line);
    return line;
  }
  private railPanelModel(qty = 1) {
    const g = new THREE.Group();
    g.name = 'physical-rail-panel';
    for (let layer = 0; layer < qty; layer++) {
      const y = layer * RAIL_PANEL_PITCH;
      for (let i = 0; i < 8; i++)
        box(g, -2.5 + ((i + 0.5) * 5) / 8, y + 0.09, 0, 0.22, 0.15, 1.95, 0x736d59);
      for (const z of [-RAIL_CENTER_OFFSET, RAIL_CENTER_OFFSET])
        box(g, 0, y + 0.24, z, 5.018, 0.17, RAIL_HEAD_WIDTH, 0x777b69, 0.8);
      if (layer > 0)
        for (const x of [-1.55, 1.55]) box(g, x, y + 0.0025, 0, 0.12, 0.025, 1.92, 0x766b50);
    }
    return g;
  }
  private railSupports(baseHeight: number) {
    const g = new THREE.Group(),
      height = baseHeight + 0.015;
    // Four bearing pads support the ties while leaving both fork channels open.
    for (const x of [-1.5625, 1.5625])
      for (const z of [-0.82, 0.82]) box(g, x, height / 2, z, 0.22, height, 0.17, 0x766b50);
    return g;
  }
  stockModel(item: string, qty: number, spacers = true, hand: 1 | -1 = 1) {
    const g = new THREE.Group();
    const m = MATERIALS[item as keyof typeof MATERIALS];
    if (item === 'slab') {
      for (let i = 0; i < qty; i++) {
        const level = i * parcelPitch('slab');
        const slab = box(g, 0, 0.14 + level, 0, 0.98, 0.12, 0.98, 0xffffff);
        slab.material = surfaceMaterial('concrete');
        // Individual slab layers retain room for forks; runners avoid both tines.
        if (i > 0 || spacers)
          for (const x of [-0.48, 0, 0.48])
            box(g, x, level + (i ? 0.05 : 0.04), 0, 0.04, i ? 0.06 : 0.07, 1, 0x746b4e);
      }
    } else if (item === 'rail') {
      g.add(this.railPanelModel(qty));
    } else if (isRailMaterial(item)) {
      g.add(stockRailModel(item, qty, hand));
    } else if (item === 'diesel') {
      cylinder(g, 0, 0.46, 0, 0.3, 0.9, 0x9d4938);
      for (const y of [0.13, 0.72]) cylinder(g, 0, y, 0, 0.307, 0.03, 0x555b5e);
      sign(g, 'DIESEL', 0, 0.55, 0.305, 0.44);
    } else if (item === 'office' || item === 'sanitary') container(g, m.w, m.d, m.color, item);
    else {
      box(g, 0, 0.14, 0, m.w, 0.2, m.d, 0x847958);
      const n = item === 'lamp' ? qty : 5;
      for (let i = 0; i < n; i++) {
        if (item === 'lamp') {
          const pole = cylinder(g, 0, 0.32 + i * 0.16, 0, 0.075, 4, 0x839388);
          pole.rotation.z = Math.PI / 2;
        } else box(g, 0, 0.35 + i * 0.14, 0, m.w - 0.1, 0.1, m.d - 0.15, m.color, 0.2);
      }
      for (const x of [-m.w * 0.32, m.w * 0.32]) box(g, x, 0.62, 0, 0.065, 1, m.d + 0.03, 0x52654f);
    }
    return g;
  }
  batchStatic() {
    this.staticGroup.updateMatrixWorld(true);
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    this.staticGroup.traverse((o) => {
      if (
        o instanceof THREE.Mesh &&
        !(o instanceof THREE.InstancedMesh) &&
        o.geometry === boxGeo &&
        !o.userData.movable &&
        !Array.isArray(o.material)
      ) {
        const a = groups.get(o.material) || [];
        a.push(o);
        groups.set(o.material, a);
      }
    });
    for (const [mat, meshes] of groups) {
      if (meshes.length < 3) continue;
      const inst = new THREE.InstancedMesh(boxGeo, mat, meshes.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.userData.selections = [];
      meshes.forEach((mesh, i) => {
        inst.setMatrixAt(i, mesh.matrixWorld);
        let p: THREE.Object3D | null = mesh;
        while (p && !p.userData.selection) p = p.parent;
        inst.userData.selections[i] = p?.userData.selection;
        mesh.removeFromParent();
      });
      this.staticGroup.add(inst);
    }
  }
  sync(s: State) {
    this.state = s;
    if (this.revision === s.revision) return;
    this.revision = s.revision;
    this.scatterGround(s);
    this.disposeGroup(this.staticGroup);
    this.disposeGroup(this.planGroup);
    this.lights = [];
    this.outline(this.staticGroup, { x: -12, z: 12, w: 232, d: 98 }, 0x7e8a68, 0.025, true);
    const paving = Object.keys(s.paving);
    if (paving.length) {
      const m = new THREE.InstancedMesh(boxGeo, surfaceMaterial('concrete'), paving.length);
      const o = new THREE.Object3D();
      paving.forEach((k, i) => {
        const [x, z] = k.split(',').map(Number);
        o.position.set(x + 0.5, 0.045, z + 0.5);
        o.scale.set(0.993, 0.12, 0.993);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        const color = new THREE.Color(0xffffff).multiplyScalar(
          0.94 + ((x * 17 + z * 7) % 13) / 180,
        );
        m.setColorAt(i, color);
      });
      m.receiveShadow = true;
      this.staticGroup.add(m);
    }
    for (const zone of s.zones) {
      this.outline(this.staticGroup, zone, 0x6a8267, 0.025, true);
      const g = new THREE.Group();
      const tag = sign(
        g,
        zone.name.toUpperCase(),
        zone.x + zone.w / 2,
        0.025,
        zone.z + zone.d + 1.5,
        Math.min(6, zone.w * 0.7),
      );
      tag.rotation.x = -Math.PI / 2;
      this.staticGroup.add(g);
    }
    for (const b of s.buildings) {
      const g = new THREE.Group();
      g.position.set(b.x + b.w / 2, 0, b.z + b.d / 2);
      const spec = BUILDINGS[b.kind];
      if (spec && b.rotation % 2) g.rotation.y = -Math.PI / 2;
      const w = spec?.w || b.w,
        d = spec?.d || b.d;
      if (b.kind === 'office' || b.kind === 'sanitary')
        container(g, w, d, MATERIALS[b.kind].color, b.kind);
      else if (b.kind === 'shed') {
        const local = { ...b, x: -w / 2, z: -d / 2, w, d, rotation: 0 } as unknown as Job;
        g.add(assembledShed(local));
        for (const p of shedPostPoints(local)) {
          box(g, p.x, 0.185, p.z, 0.4, 0.12, 0.4, 0xb2b1a8);
          for (const dx of [-0.13, 0.13])
            for (const dz of [-0.13, 0.13])
              cylinder(g, p.x + dx, 0.26, p.z + dz, 0.022, 0.07, 0x68737a, 6);
        }
      } else if (b.kind === 'store') shed(g, w, d, true);
      else if (b.kind === 'lamp') {
        box(g, 0, 0.11, 0, 0.55, 0.15, 0.55, 0xb0b2ab);
        for (const x of [-0.19, 0.19])
          for (const z of [-0.19, 0.19]) cylinder(g, x, 0.21, z, 0.032, 0.045, 0x6f787e, 6);
        cylinder(g, 0, 3, 0, 0.067, 6, 0x808b94, 8);
        box(g, 0.37, 5.95, 0, 0.8, 0.08, 0.1, 0x8b959c);
        const bulb = box(g, 0.75, 5.89, 0, 0.42, 0.13, 0.24, b.connected ? 0xe1d49b : 0x58636b);
        if (b.connected) {
          const l = new THREE.PointLight(0xffd99a, 0, 17, 1.7);
          l.position.set(0.75, 5.7, 0);
          g.add(l);
          this.lights.push(l);
        }
        sign(g, b.id, 0, 1.8, 0.1, 0.7);
      } else if (b.kind === 'fence') {
        for (const x of [-1.45, 1.45]) cylinder(g, x, 1, 0, 0.04, 2, 0x73858e, 6);
        for (let y = 0.25; y < 2; y += 0.25) box(g, 0, y, 0, 3, 0.012, 0.015, 0x849397);
        for (let x = -1.4; x < 1.5; x += 0.25) box(g, x, 1, 0, 0.012, 2, 0.015, 0x849397);
      } else {
        box(g, 0, 0.7, 0, 0.8, 1.4, 0.65, b.kind === 'power' ? 0x789077 : 0x698c8b);
        sign(g, b.kind === 'power' ? '16 kVA' : 'WATER', 0, 1, 0.34, 0.65);
      }
      g.userData.selection = { type: 'building', id: b.id };
      this.staticGroup.add(g);
    }
    for (const t of s.stacks) {
      if (
        s.jobs.some(
          (j) =>
            j.status === 'doing' &&
            ((j.handling?.state === 'placed' && j.handling.placedStack === t.id) ||
              (j.railWork?.phase === 'configure-staged-panel' &&
                j.railWork.panel.stackId === t.id)),
        )
      )
        continue;
      const baseHeight = t.baseHeight || 0;
      if (t.qty <= 0 && t.item !== 'diesel' && !baseHeight) continue;
      const g =
        t.qty > 0 || t.item === 'diesel'
          ? this.stockModel(t.item, t.qty, true, t.trackHand ?? 1)
          : new THREE.Group();
      if (isRailMaterial(t.item) && baseHeight) {
        const supports = this.railSupports(baseHeight);
        supports.position.y = -baseHeight;
        g.add(supports);
      }
      g.position.set(t.x + t.w / 2, this.surface(s, center(t)) + baseHeight, t.z + t.d / 2);
      g.rotation.y = -((t as typeof t & { yaw?: number }).yaw || 0);
      g.userData.selection = { type: 'stack', id: t.id };
      this.staticGroup.add(g);
    }
    for (const t of s.rails) {
      // Joining transfers the same physical panel into installed track; it adds no unpurchased ballast.
      const geometry = trackGeometry(t);
      const paired =
        t.track?.layout === 'turnout' &&
        t.track.section === 1 &&
        s.rails.some(
          (other) =>
            other.id !== t.id &&
            other.track?.layout === 'turnout' &&
            other.track.section === 1 &&
            other.track.origin.x === t.track!.origin.x &&
            other.track.origin.z === t.track!.origin.z &&
            other.track.heading === t.track!.heading &&
            other.track.hand === t.track!.hand &&
            other.track.route !== t.track!.route,
        );
      const g = t.track
        ? trackPanelModel(t.track, 1, t.selectedRoute ?? 'straight', paired)
        : this.railPanelModel();
      g.position.set(geometry.pose.x, 0, geometry.pose.z);
      g.rotation.y = -geometry.pose.yaw;
      g.userData.selection = { type: 'building', id: t.id };
      this.staticGroup.add(g);
    }
    const locationNetwork = s.railLocations?.length ? trackNetwork(s) : undefined;
    for (const location of s.railLocations || []) {
      const pose = railLocationPose(s, location);
      if (!pose) continue;
      const group = new THREE.Group();
      group.name = `railway-location-${location.id}`;
      group.userData.selection = { type: 'railLocation', id: location.id };
      const locationStatus = railLocationStatus(s, location, locationNetwork);
      const connected = locationStatus.connected && locationStatus.valid;
      const color = connected
        ? { loading: 0x659bbb, unloading: 0xe7bb58, transfer: 0x9e83bb, parking: 0x71a27e }[
            location.kind
          ]
        : 0xe77965;
      const path = railLocationPath(s, location);
      if (path && path.length > 1) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(
            path.map((p) => new THREE.Vector3(p.x, 0.48, p.z)),
          ),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
        );
        line.name = 'railway-location-length';
        group.add(line);
        for (const p of [path[0], path[path.length - 1]]) {
          const yaw = p.yaw ?? pose.yaw,
            side = { x: -Math.sin(yaw), z: Math.cos(yaw) };
          const cap = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(
              [-1, 1].map((d) => new THREE.Vector3(p.x + side.x * d, 0.48, p.z + side.z * d)),
            ),
            new THREE.LineBasicMaterial({ color }),
          );
          group.add(cap);
        }
      }
      // Virtual map annotation: no unpurchased post, trackside sign, or collision footprint.
      const icon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.25),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
      );
      icon.position.set(pose.x, 1.1, pose.z);
      icon.name = 'railway-location-anchor';
      group.add(icon);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = '14px monospace';
      let text = `${location.name} · ${location.length.toFixed(1)} m`;
      canvas.width = Math.min(330, Math.max(150, Math.ceil(ctx.measureText(text).width + 20)));
      canvas.height = 28;
      ctx.font = '14px monospace';
      while (ctx.measureText(text).width > canvas.width - 16) text = text.slice(0, -2) + '…';
      ctx.fillStyle = '#f1e9d5';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = connected ? '#384d45' : '#a44636';
      ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
      ctx.fillStyle = '#243c35';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 8, 14);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const tag = new THREE.Mesh(
        new THREE.PlaneGeometry(canvas.width / 40, canvas.height / 40),
        new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
      );
      tag.position.set(pose.x, 2.5, pose.z);
      tag.name = 'railway-location-label';
      tag.quaternion.copy(this.camera.quaternion);
      group.add(tag);
      this.staticGroup.add(group);
    }
    for (const j of s.jobs) {
      if (
        j.status === 'done' ||
        j.status === 'canceled' ||
        j.kind === 'refuel' ||
        j.kind === 'remove'
      )
        continue;
      const g = new THREE.Group();
      if (j.track) {
        const color = j.status === 'doing' ? 0xd4a448 : 0x56a38d;
        for (const cell of railCells(j)) {
          this.outline(g, { ...cell, w: 1, d: 1 }, color, 0.15, true);
        }
        const panel = trackPanelModel(j.track),
          pose = trackGeometry(j).pose;
        panel.position.set(pose.x, 0.025, pose.z);
        panel.rotation.y = -pose.yaw;
        panel.traverse((part) => {
          if (!(part instanceof THREE.Mesh)) return;
          const mat = (part.material as THREE.MeshStandardMaterial).clone();
          mat.color.setHex(color);
          mat.transparent = true;
          mat.opacity = 0.28;
          mat.depthWrite = false;
          mat.userData.owned = true;
          part.material = mat;
        });
        g.add(panel);
        g.userData.selection = { type: 'job', id: j.id };
        this.planGroup.add(g);
        continue;
      }
      this.outline(g, j, j.status === 'doing' ? 0xd49b35 : 0x4c9284, 0.15, true);
      const fill = new THREE.Mesh(
        new THREE.BoxGeometry(j.w, 0.025, j.d),
        new THREE.MeshBasicMaterial({
          color: j.status === 'doing' ? 0xd4a448 : 0x56a38d,
          transparent: true,
          opacity: 0.15,
          depthWrite: false,
        }),
      );
      fill.position.set(j.x + j.w / 2, 0.09, j.z + j.d / 2);
      g.add(fill);
      g.userData.selection = { type: 'job', id: j.id };
      this.planGroup.add(g);
    }
    this.batchStatic();
  }
  update(s: State, dt: number, alpha = 1) {
    if (this.wornPaths.update(s) && Object.keys(s.groundWear || {}).length) {
      const grass = this.landscape.getObjectByName('ground-grass') as
        THREE.InstancedMesh | undefined;
      if (grass) {
        const matrix = new THREE.Matrix4();
        let changed = false;
        for (let i = 0; i < grass.count; i++) {
          grass.getMatrixAt(i, matrix);
          const [x, y, z] = [matrix.elements[12], matrix.elements[13], matrix.elements[14]];
          if (y >= 0 && (s.groundWear?.[`${Math.floor(x)},${Math.floor(z)}`] || 0) > 0.16) {
            matrix.elements[13] = -2;
            grass.setMatrixAt(i, matrix);
            changed = true;
          }
        }
        if (changed) grass.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.state !== s) {
      for (const g of this.models.values()) {
        g.removeFromParent();
        this.disposeGroup(g);
      }
      this.models.clear();
      this.previous.clear();
      this.previousDeliveries.clear();
      this.previousRailWork.clear();
      this.previousHandling.clear();
      this.previousShedParts.clear();
      this.previousShedWork.clear();
      this.previousSwitchWork.clear();
      for (const j of s.jobs)
        if (j.kind === 'throwSwitch')
          this.previousSwitchWork.set(j.id, { phase: j.phase, elapsed: j.elapsed });
      for (const j of s.jobs)
        if (j.shedAssembly)
          this.previousShedWork.set(j.id, {
            phase: j.shedAssembly.phase,
            clock: j.shedAssembly.clock,
          });
      for (const j of s.jobs)
        if (j.shedAssembly?.part) {
          const part = j.shedAssembly.part;
          this.previousShedParts.set(j.id, {
            pose: { ...part.pose },
            kind: part.kind,
            index: part.index,
          });
        }
      for (const j of s.jobs)
        if (j.handling)
          this.previousHandling.set(j.id, {
            pose: { ...j.handling.pose },
            toolLift: j.handling.toolLift,
            toolReach: j.handling.toolReach,
            phase: j.handling.phase,
            clock: j.handling.clock,
          });
      this.revision = -1;
    }
    alpha = Math.max(0, Math.min(1, alpha));
    this.sync(s);
    for (const group of this.staticGroup.children) {
      if (group.userData.selection?.type === 'railLocation') {
        const label = group.getObjectByName('railway-location-label');
        if (label) {
          label.quaternion.copy(this.camera.quaternion);
          const depth = -label.position.clone().applyMatrix4(this.camera.matrixWorldInverse).z;
          const metersPerPixel =
            (2 * Math.max(0.1, depth) * Math.tan((this.camera.fov * Math.PI) / 360)) /
            Math.max(1, this.canvas.clientHeight);
          label.scale.setScalar(metersPerPixel * 40);
        }
      }
    }
    for (const rail of s.rails) {
      if (rail.track?.layout !== 'turnout' || rail.track.section !== 0) continue;
      const model = this.staticGroup.children.find((g) => g.userData.selection?.id === rail.id);
      if (!model) continue;
      const job = s.jobs.find(
        (j) =>
          j.kind === 'throwSwitch' &&
          j.target === rail.id &&
          j.status === 'doing' &&
          ['Throw manual turnout lever', 'Return lever to original route'].includes(j.phase),
      );
      if (job) {
        const previous = this.previousSwitchWork.get(job.id);
        const elapsed = lerp(
          previous?.phase === job.phase ? previous.elapsed : 0,
          job.elapsed,
          alpha,
        );
        animateTurnout(
          model,
          rail.selectedRoute ?? 'straight',
          job.requestedRoute!,
          smoothstep(elapsed / 4),
        );
        model.userData.switchAnimation = true;
      } else if (model.userData.switchAnimation) {
        animateTurnout(
          model,
          rail.selectedRoute ?? 'straight',
          rail.selectedRoute ?? 'straight',
          0,
        );
        model.userData.switchAnimation = false;
      }
    }
    this.frame += dt;
    const live = new Set<string>();
    const ensure = (id: string, make: () => THREE.Group, selection: Selection) => {
      live.add(id);
      if (!this.models.has(id)) {
        const g = make();
        g.userData.selection = selection;
        this.dynamicGroup.add(g);
        this.models.set(id, g);
      }
      return this.models.get(id)!;
    };
    const replaceContents = (
      parent: THREE.Group,
      name: string,
      key: string,
      make: () => THREE.Group,
    ) => {
      if (parent.userData[`${name}Key`] === key) return;
      const old = parent.getObjectByName(name);
      if (old) {
        old.removeFromParent();
        this.disposeGroup(old as THREE.Group);
      }
      parent.userData[`${name}Key`] = key;
      if (!key) return;
      const child = make();
      child.name = name;
      parent.add(child);
    };
    for (const w of s.workers) {
      const g = ensure(w.id, () => workerModel(w.role), { type: 'worker', id: w.id });
      g.visible =
        !w.vehicle && !['home', 'returning', 'aboard'].includes(w.shiftPhase || 'working');
      const pose = this.renderPose(s, w.id, w, alpha);
      this.positionModel(g, pose);
      const feet = g.userData.feet as { x: number; z: number; travel: number } | undefined;
      const moved = feet ? Math.hypot(pose.x - feet.x, pose.z - feet.z) : 0;
      const walkTravel = (feet?.travel || 0) + moved;
      g.userData.feet = { x: pose.x, z: pose.z, travel: walkTravel };
      animatePerson(g, walkTravel, (pose.moving || moved > 0.0001) && !w.vehicle);
      const railTask = s.jobs.find((j) => j.status === 'doing' && j.worker === w.id && j.railWork);
      const railPhase = railTask?.railWork?.phase;
      const fastening =
        !!railPhase &&
        ['unbolt-buffer', 'join-panel', 'fasten-buffer', 'configure-staged-panel'].includes(
          railPhase,
        );
      const rigging =
        !!railPhase &&
        ['source-rig', 'panel-rig', 'buffer-rig', 'buffer-rig-return'].includes(railPhase);
      const working =
        (fastening || rigging) && !w.path.length && !w.vehicle && !!railTask?.railWork?.clock;
      let tool = g.getObjectByName('rail-wrench');
      const arm = g.getObjectByName('arm-right');
      if (!tool && arm) {
        const wrench = new THREE.Group();
        wrench.name = 'rail-wrench';
        wrench.position.set(0.02, -0.43, 0);
        box(wrench, 0.12, 0, 0, 0.25, 0.025, 0.035, 0xaeb7b9, 0.8);
        for (const z of [-0.038, 0.038]) box(wrench, 0.26, 0, z, 0.075, 0.026, 0.02, 0xaeb7b9, 0.8);
        arm.add(wrench);
        tool = wrench;
      }
      if (tool) tool.visible = working && fastening;
      const slabTask = s.jobs.find((j) => j.status === 'doing' && j.worker === w.id && j.handling);
      const setting =
        slabTask?.handling?.phase === 'settle' && !w.path.length && slabTask.handling.clock > 0;
      if (setting && arm) {
        const old = this.previousHandling.get(slabTask!.id);
        const clock = lerp(
          old?.phase === 'settle' ? old.clock : 0,
          slabTask!.handling!.clock,
          alpha,
        );
        arm.rotation.z = 0.65 + Math.sin(clock * 5) * 0.12;
        const other = g.getObjectByName('arm-left');
        if (other) other.rotation.z = 0.45;
        g.updateMatrixWorld(true);
        const top = arm.localToWorld(new THREE.Vector3(0.02, -0.45, 0));
        const p = center(slabTask!),
          angle = Math.atan2(w.z - p.z, w.x - p.x);
        const foot = new THREE.Vector3(
          p.x + Math.cos(angle) * 0.48,
          Math.max(0.01, slabTask!.handling!.pose.y + 0.035),
          p.z + Math.sin(angle) * 0.48,
        );
        const lever = ensure(`${w.id}-slab-setting-bar`, () => new THREE.Group(), {
          type: 'worker',
          id: w.id,
        });
        updateBeam(lever, 0, top, foot, 0.028, 0x7f8b8e);
      }
      const shedTask = s.jobs.find(
        (j) => j.status === 'doing' && j.worker === w.id && j.shedAssembly,
      );
      const assembly = shedTask?.shedAssembly;
      if (
        assembly &&
        ['unpack', 'anchor', 'rig', 'fasten'].includes(assembly.phase) &&
        !w.path.length &&
        assembly.clock > 0
      ) {
        const old = this.previousShedWork.get(shedTask!.id);
        const clock = lerp(old?.phase === assembly.phase ? old.clock : 0, assembly.clock, alpha);
        if (arm) arm.rotation.z = 0.8 + Math.sin(clock * 6) * 0.16;
        const other = g.getObjectByName('arm-left');
        if (other) other.rotation.z = 0.65 - Math.sin(clock * 6) * 0.12;
        if (tool) tool.visible = assembly.phase === 'anchor' || assembly.phase === 'fasten';
        if (assembly.ladder && /climb|descend/i.test(w.status)) {
          animatePerson(g, pose.y * 2, true);
          if (arm) arm.rotation.z = 2.1 + Math.sin(clock * 6) * 0.18;
          if (other) other.rotation.z = 2.1 - Math.sin(clock * 6) * 0.18;
          if (tool) tool.visible = false;
        }
      }
      if (working) {
        const old = this.previousRailWork.get(railTask!.id);
        const phase =
          lerp(old?.phase === railPhase ? old.clock : 0, railTask!.railWork!.clock || 0, alpha) * 7;
        if (arm) arm.rotation.z = 0.82 + Math.sin(phase) * 0.2;
        const other = g.getObjectByName('arm-left');
        if (other) other.rotation.z = 0.72 - Math.sin(phase) * 0.12;
      }
      const switchJob = s.jobs.find(
        (j) =>
          j.kind === 'throwSwitch' &&
          j.worker === w.id &&
          j.status === 'doing' &&
          ['Throw manual turnout lever', 'Return lever to original route'].includes(j.phase),
      );
      if (switchJob && !w.path.length) {
        const previous = this.previousSwitchWork.get(switchJob.id);
        const elapsed = lerp(previous?.elapsed ?? switchJob.elapsed, switchJob.elapsed, alpha);
        if (arm) arm.rotation.z = 0.75 + smoothstep(elapsed / 4) * 0.45;
        const other = g.getObjectByName('arm-left');
        if (other) other.rotation.z = 0.62 + smoothstep(elapsed / 4) * 0.25;
        if (tool) tool.visible = false;
      }
    }
    for (const e of s.equipment) {
      const g = ensure(
        e.id,
        () => {
          const q = new THREE.Group();
          e.kind === 'excavator' ? excavator(q) : forklift(q);
          return q;
        },
        { type: 'equipment', id: e.id },
      );
      if (e.parking) {
        const p = e.parking,
          yaw = (p.rotation * Math.PI) / 2,
          length = e.kind === 'excavator' ? 4.2 : 3.6,
          width = e.kind === 'excavator' ? 3 : 2.4;
        const marker = ensure(`${e.id}-parking`, () => new THREE.Group(), {
          type: 'equipment',
          id: e.id,
        });
        replaceContents(marker, 'paint', `${p.x}/${p.z}/${p.rotation}`, () => {
          const paint = new THREE.Group();
          const r = { x: -length / 2, z: -width / 2, w: length, d: width };
          this.outline(paint, r, 0xbac493, 0.12, true);
          for (const side of [-1, 1]) {
            const a = new THREE.Vector3(0.15, 0.122, side * 0.38),
              b = new THREE.Vector3(0.7, 0.122, 0);
            beam(paint, a, b, 0.035, 0xbac493);
          }
          paint.position.set(p.x, this.surface(s, p), p.z);
          paint.rotation.y = -yaw;
          return paint;
        });
      }
      const pose = this.renderPose(s, e.id, e, alpha);
      const delivery = e.transportOrder
        ? s.orders.find((o) => o.id === e.transportOrder)
        : undefined;
      if (delivery && delivery.deployment !== 'offload') {
        const d = this.previousDeliveries.get(delivery.id),
          distance = lerp(
            d?.distance ?? delivery.drive?.distance ?? 0,
            delivery.drive?.distance ?? 0,
            alpha,
          );
        const carrier = roadRenderPose(delivery, distance),
          carried = deckPose(carrier);
        pose.x = carried.x;
        pose.z = carried.z;
        pose.y = carried.y;
        pose.yaw = carrier.yaw;
        pose.pitch = carried.pitch;
      }
      this.positionModel(g, pose);
      const railJob = s.jobs.find(
        (j) => j.status === 'doing' && j.equipment === e.id && j.railWork,
      );
      const railWork = railJob?.railWork;
      const oldWork = railJob ? this.previousRailWork.get(railJob.id) : undefined;
      const railClock = railWork
        ? lerp(oldWork?.phase === railWork.phase ? oldWork.clock : 0, railWork.clock, alpha)
        : 0;
      const constructionJob = s.jobs.find(
        (j) => j.status === 'doing' && j.equipment === e.id && j.handling,
      );
      const handling = constructionJob?.handling,
        oldHandling = constructionJob ? this.previousHandling.get(constructionJob.id) : undefined;
      const slabPose = handling
        ? interpolateWorkPose(oldHandling?.pose, handling.pose, alpha)
        : undefined;
      const legacyForkRail = e.kind === 'forklift' && railJob?.legacyRailHandoff === 'carried';
      const oldRail = railJob ? this.previousRailWork.get(railJob.id) : undefined;
      const railPanel = railWork
        ? interpolateWorkPose(oldRail?.panel, railWork.panel, alpha)
        : undefined;
      const railBuffer = railWork?.buffer
        ? interpolateWorkPose(oldRail?.buffer, railWork.buffer, alpha)
        : undefined;
      const railLoad =
        railWork?.lifting === 'buffer'
          ? railBuffer
          : railWork?.lifting === 'panel'
            ? railPanel
            : undefined;
      const handlingOrder = s.orders.find((o) => o.unload?.equipmentId === e.id);
      const unload = handlingOrder?.unload;
      const cargo = unload?.cargo;
      const oldCargo = unload
        ? this.previousDeliveries.get(e.deliveryOrder || '')?.cargo
        : undefined;
      const renderedCargo = cargo
        ? {
            x: lerp(oldCargo?.x ?? cargo.x, cargo.x, alpha),
            z: lerp(oldCargo?.z ?? cargo.z, cargo.z, alpha),
            y: lerp(oldCargo?.y ?? cargo.y, cargo.y, alpha),
            yaw: mixAngle(oldCargo?.yaw ?? cargo.yaw, cargo.yaw, alpha),
          }
        : undefined;
      if (renderedCargo && e.cargo && unload && ['clear', 'carry'].includes(unload.phase)) {
        // Interpolate the carrying machine, then derive its attachment point.
        // Interpolating two world-space cargo points cuts the corner during a
        // turn and separates a supported load from its forks between ticks.
        const contact = localPoint(pose, pose.reach, 0);
        renderedCargo.x = contact.x;
        renderedCargo.z = contact.z;
        renderedCargo.yaw = pose.yaw + Math.PI / 2;
      }
      const unloadingItem = unload?.item || handlingOrder?.item;
      const load =
        e.cargo ||
        (unload && unloadingItem && unloadingItem in MATERIALS
          ? { item: unloadingItem as Item, qty: unload.qty }
          : undefined);
      const loadHeight = load ? stackHeight(load.item, load.qty) : 0;
      let lift = renderedCargo ? renderedCargo.y - pose.y : pose.lift;
      let reach = pose.reach;
      const oldUnload = handlingOrder ? this.previousDeliveries.get(handlingOrder.id) : undefined;
      const unloadClock = unload
        ? lerp(oldUnload?.phase === unload.phase ? oldUnload.clock : 0, unload.clock, alpha)
        : 0;
      const rigProgress = unload?.phase === 'rig' ? smoothstep(unloadClock / 2.5) : 0;
      if (e.kind === 'excavator') {
        if (renderedCargo || e.cargo) lift += loadHeight + 0.7;
        else if (unload?.phase === 'rig') {
          const sourceDepth = load ? MATERIALS[load.item].d : 1;
          const safeReach = Math.min(
            2.1,
            Math.max(1.2, dist(unload.pickup, unload.source) - sourceDepth / 2 - 0.8),
          );
          // Raise the retracted bucket above the freight before reaching across it.
          // The tooth tips extend .63 m beyond the hook and must clear a tall container's near wall.
          lift = lerp(
            2,
            unload.sourceY - pose.y + loadHeight + 0.7,
            smoothstep(unloadClock / 1.25),
          );
          reach = lerp(safeReach, pose.reach, smoothstep((unloadClock - 1.25) / 1.25));
        } else if (unload?.phase === 'back-away')
          lift = unload.destinationY - pose.y + loadHeight + 0.7;
        else if (unload) {
          const sourceDepth = load ? MATERIALS[load.item].d : 1;
          lift = 2;
          reach = Math.min(
            2.1,
            Math.max(1.2, dist(unload.pickup, unload.source) - sourceDepth / 2 - 0.8),
          );
        } else {
          const resting = !pose.moving && !e.job && !e.deliveryOrder && !e.transportOrder;
          lift = resting ? 0.5 : 2;
          reach = resting ? 2.7 : 2.1;
        }
        if (!unload && !e.cargo && !s.paused && g.userData.armLift !== undefined)
          lift = lerp(g.userData.armLift, lift, Math.min(1, dt * s.speed * 2));
        g.userData.armLift = lift;
      } else {
        const offset = load?.item === 'slab' ? 0.08 : load?.item === 'rail' ? 0.015 : 0;
        if (unload?.phase === 'rig')
          lift = lerp(0.12, unload.sourceY - pose.y + offset, rigProgress);
      }
      if (
        e.kind === 'excavator' &&
        (railWork || g.userData.railWasLoaded) &&
        !railLoad &&
        !unload &&
        !e.cargo
      ) {
        // Fold the empty tool clear of the stock/buffer instead of lowering through it.
        lift = 2;
        reach = 2.1;
      }
      let upperYaw = 0;
      if (legacyForkRail && railPanel) {
        lift = railPanel.y + 0.015 - pose.y;
        if (railLoad) reach = Math.hypot(railPanel.x - pose.x, railPanel.z - pose.z);
      } else if (e.kind === 'excavator' && railWork && railLoad) {
        const anchor = railWork.lifting === 'buffer' ? localPoint(railLoad, 0.45, 0) : railLoad;
        const targetLift =
          railLoad.y +
          (railWork.lifting === 'buffer'
            ? 1.05
            : 0.325 + ((railWork.stagingBatch?.qty || 1) - 1) * RAIL_PANEL_PITCH) +
          0.7 -
          pose.y;
        const targetReach = Math.hypot(anchor.x - pose.x, anchor.z - pose.z);
        const targetYaw = -(Math.atan2(anchor.z - pose.z, anchor.x - pose.x) - pose.yaw);
        const rigging = ['source-rig', 'panel-rig', 'buffer-rig', 'buffer-rig-return'].includes(
          railWork.phase,
        );
        if (rigging) {
          if (g.userData.railRigPhase !== railWork.phase) {
            g.userData.railRigPhase = railWork.phase;
            g.userData.railRigFrom = {
              lift: g.userData.railLift ?? 0.48,
              reach: g.userData.railReach ?? 2.7,
              yaw: g.userData.railUpperYaw ?? 0,
            };
          }
          const f = smoothstep(railClock / (railWork.phase === 'source-rig' ? 3 : 2.5)),
            from = g.userData.railRigFrom;
          lift = lerp(from.lift, targetLift, f);
          reach = lerp(from.reach, targetReach, f);
          upperYaw = mixAngle(from.yaw, targetYaw, f);
        } else {
          lift = targetLift;
          reach = targetReach;
          upperYaw = targetYaw;
          g.userData.railRigPhase = undefined;
        }
      }
      if (e.kind === 'excavator' && railWork) g.userData.railWasLoaded = true;
      else if (unload || e.cargo) g.userData.railWasLoaded = false;
      else if (g.userData.railWasLoaded) {
        // Releasing a sling does not instantly fold or swivel the articulated boom.
        const f = Math.min(1, dt * (s.paused ? 1 : s.speed) * 2);
        lift = lerp(g.userData.railLift ?? lift, lift, f);
        reach = lerp(g.userData.railReach ?? reach, reach, f);
        upperYaw = mixAngle(g.userData.railUpperYaw ?? 0, 0, f);
      }
      g.userData.railLift = lift;
      g.userData.railReach = reach;
      g.userData.railUpperYaw = upperYaw;
      if (railWork || g.userData.railWasLoaded) g.userData.armLift = lift;
      if (handling && slabPose) {
        lift = lerp(oldHandling?.toolLift ?? handling.toolLift, handling.toolLift, alpha);
        reach = lerp(oldHandling?.toolReach ?? handling.toolReach, handling.toolReach, alpha);
        upperYaw = 0;
        if (handling.state === 'carried') {
          lift = slabPose.y - pose.y + (e.kind === 'excavator' ? 0.82 : 0);
          reach = Math.hypot(slabPose.x - pose.x, slabPose.z - pose.z);
          if (e.kind === 'excavator')
            upperYaw = -(Math.atan2(slabPose.z - pose.z, slabPose.x - pose.x) - pose.yaw);
        }
      }
      const shedTask = s.jobs.find(
        (j) => j.status === 'doing' && j.equipment === e.id && j.shedAssembly,
      );
      const shedPart = shedTask?.shedAssembly?.part;
      if (
        shedPart &&
        e.kind === 'excavator' &&
        ['rig', 'lift', 'carry', 'lower', 'fasten'].includes(shedTask!.shedAssembly!.phase)
      ) {
        const previous = this.previousShedParts.get(shedTask!.id);
        const partPose = interpolateWorkPose(
          previous?.kind === shedPart.kind && previous.index === shedPart.index
            ? previous.pose
            : undefined,
          shedPart.pose,
          alpha,
        );
        const top =
          shedPart.kind === 'post'
            ? 2.15
            : shedPart.kind === 'wall'
              ? 1.9
              : shedPart.kind === 'brace'
                ? 1.95
                : 0.4;
        const targetLift = partPose.y - pose.y + top + 0.3;
        const targetReach = Math.hypot(partPose.x - pose.x, partPose.z - pose.z);
        const targetYaw = -(Math.atan2(partPose.z - pose.z, partPose.x - pose.x) - pose.yaw);
        if (shedTask!.shedAssembly!.phase === 'rig') {
          const key = `${shedTask!.id}/${shedPart.kind}/${shedPart.index}`;
          if (g.userData.shedRigKey !== key) {
            g.userData.shedRigKey = key;
            g.userData.shedRigFrom = {
              lift: g.userData.shedToolLift ?? lift,
              reach: g.userData.shedToolReach ?? reach,
              yaw: g.userData.shedToolYaw ?? upperYaw,
            };
          }
          const old = this.previousShedWork.get(shedTask!.id);
          const clock = lerp(
            old?.phase === 'rig' ? old.clock : 0,
            shedTask!.shedAssembly!.clock,
            alpha,
          );
          const f = smoothstep(clock / 2),
            from = g.userData.shedRigFrom;
          lift = lerp(from.lift, targetLift, f);
          reach = lerp(from.reach, targetReach, f);
          upperYaw = mixAngle(from.yaw, targetYaw, f);
        } else {
          lift = targetLift;
          reach = targetReach;
          upperYaw = targetYaw;
          g.userData.shedRigKey = undefined;
        }
      }
      if (shedTask?.shedAssembly?.phase === 'withdraw' && e.kind === 'excavator') {
        lift = pose.lift;
        reach = pose.reach;
        upperYaw = 0;
      }
      g.userData.shedToolLift = lift;
      g.userData.shedToolReach = reach;
      g.userData.shedToolYaw = upperYaw;
      const upper = g.getObjectByName('upper');
      if (upper) upper.rotation.y = upperYaw;
      if (e.kind === 'forklift' && load && !handling && (renderedCargo || e.cargo)) {
        lift += isRailMaterial(load.item)
          ? 0.015
          : load.item === 'slab'
            ? 0.08
            : load.item === 'diesel'
              ? 0.01
              : 0.04;
      }
      animateMachine(
        g,
        e.kind,
        !!e.operator,
        pose.travel,
        lift,
        reach,
        pose.pitch,
        !!e.cargo || unload?.phase === 'rig',
      );
      if (e.kind === 'forklift') {
        const before = this.previous.get(e.id),
          travel = before ? (e.travel || 0) - before.travel : 0;
        const curvature =
          before && Math.abs(travel) > 0.001
            ? angleDelta(before.yaw, e.yaw ?? pose.yaw) / travel
            : 0;
        animateWheels(g, pose.travel, -Math.max(-0.6, Math.min(0.6, Math.atan(curvature * 1.83))));
      }
      const hook = g.getObjectByName('lifting-hook'),
        bucket = g.getObjectByName('bucket');
      if (hook) hook.visible = true;
      if (bucket) bucket.visible = true;
      // Delivery cargo belongs to this purchased machine, and has one world pose
      // from deck pickup through storage placement. It is never a carrier helper.
      replaceContents(
        g,
        'cargo',
        e.cargo && !renderedCargo && !railWork && !handling ? `${e.cargo.item}/${e.cargo.qty}` : '',
        () => {
          const c = this.stockModel(e.cargo!.item, e.cargo!.qty);
          c.position.set(pose.reach, Math.max(0.12, pose.lift), 0);
          c.rotation.y = -Math.PI / 2;
          return c;
        },
      );
      const localCargo = g.getObjectByName('cargo');
      if (localCargo) localCargo.position.set(pose.reach, Math.max(0.12, pose.lift), 0);
      if (renderedCargo && e.cargo && !railWork && !handling) {
        const cargoRoot = ensure(`${e.id}-load`, () => new THREE.Group(), {
          type: 'equipment',
          id: e.id,
        });
        replaceContents(
          cargoRoot,
          'freight',
          `${e.cargo.item}/${e.cargo.qty}/${unload?.mergeId || ''}`,
          () =>
            this.stockModel(
              e.cargo!.item,
              e.cargo!.qty,
              !unload?.mergeId && (unload?.sourceY || 0) < 1.5,
            ),
        );
        this.positionModel(cargoRoot, renderedCargo);
      }
      if (e.kind === 'excavator' && railJob && railWork && railLoad) {
        const rig = ensure(`${e.id}-railwork-slings`, () => new THREE.Group(), {
          type: 'job',
          id: railJob.id,
        });
        g.updateMatrixWorld(true);
        const tip = g.getObjectByName('tool-tip');
        const rigging = ['source-rig', 'panel-rig', 'buffer-rig', 'buffer-rig-return'].includes(
          railWork.phase,
        );
        // Lines are attached only after the boom reaches the sling point.
        rig.visible =
          !rigging || railWork.clock >= (railWork.phase === 'source-rig' ? 3 : 2.5) * 0.96;
        if (tip) {
          const top = tip.getWorldPosition(new THREE.Vector3());
          let line = 0;
          const anchors =
            railWork.lifting === 'buffer'
              ? [0, 0.95].flatMap((x) =>
                  [-RAIL_CENTER_OFFSET, RAIL_CENTER_OFFSET].map((z) => ({
                    x,
                    z,
                    y: x === 0 ? 1.02 : 0.26,
                  })),
                )
              : trackLiftPoints(railJob.item || 'rail', railWork.configuredHand ?? 1);
          for (const anchor of anchors) {
            const p = localPoint(railLoad, anchor.x, anchor.z);
            updateBeam(
              rig,
              line++,
              top,
              new THREE.Vector3(p.x, railLoad.y + anchor.y, p.z),
              0.023,
              0x424b4d,
            );
          }
        }
      }
      if (
        e.kind === 'excavator' &&
        handling &&
        slabPose &&
        (handling.state === 'carried' || (handling.phase === 'rig' && handling.clock >= 2.95))
      ) {
        const rig = ensure(`${e.id}-construction-slings`, () => new THREE.Group(), {
          type: 'job',
          id: constructionJob!.id,
        });
        g.updateMatrixWorld(true);
        const tip = g.getObjectByName('tool-tip');
        if (tip) {
          const top = tip.getWorldPosition(new THREE.Vector3());
          let n = 0;
          for (const x of [-0.34, 0.34])
            for (const z of [-0.34, 0.34]) {
              const p = localPoint(slabPose, x, z);
              updateBeam(
                rig,
                n++,
                top,
                new THREE.Vector3(p.x, slabPose.y + 0.12, p.z),
                0.019,
                0x3e4b51,
              );
            }
        }
      }
      const rigCargo =
        renderedCargo ||
        (unload?.phase === 'rig' && rigProgress > 0.98
          ? { ...unload.source, y: unload.sourceY, yaw: unload.sourceYaw }
          : undefined);
      if (e.kind === 'excavator' && rigCargo && load) {
        const rig = ensure(`${e.id}-slings`, () => new THREE.Group(), {
          type: 'equipment',
          id: e.id,
        });
        g.updateMatrixWorld(true);
        const tip = g.getObjectByName('tool-tip');
        if (tip) {
          const top = tip.getWorldPosition(new THREE.Vector3()),
            m = MATERIALS[load.item];
          const container = load.item === 'office' || load.item === 'sanitary';
          const dx = container ? m.w / 2 - 0.12 : m.w * 0.32,
            dz = container ? m.d / 2 - 0.12 : m.d * 0.32;
          let sling = 0;
          for (const x of [-dx, dx])
            for (const z of [-dz, dz]) {
              const p = localPoint(rigCargo, x, z);
              updateBeam(
                rig,
                sling++,
                top,
                new THREE.Vector3(p.x, rigCargo.y + loadHeight, p.z),
                0.022,
                0x3e4b51,
              );
            }
        }
      }
    }
    for (const j of s.jobs) {
      const r = j.railWork;
      if (
        j.status !== 'doing' ||
        !r ||
        (!['carried', 'placed'].includes(r.panel.state) && r.phase !== 'configure-staged-panel')
      )
        continue;
      if (j.legacyRailHandoff === 'carried') {
        const supports = ensure(`${j.id}-rail-supports`, () => this.railSupports(0.06), {
          type: 'job',
          id: j.id,
        });
        const p = center(r.stage);
        supports.position.set(p.x, this.surface(s, p), p.z);
        supports.rotation.y = -(r.stageYaw ?? r.axisYaw);
      }
      const p = interpolateWorkPose(this.previousRailWork.get(j.id)?.panel, r.panel, alpha);
      const g = ensure(`${j.id}-rail-panel`, () => new THREE.Group(), {
        type: 'job',
        id: j.id,
      });
      const hand = j.track?.layout === 'turnout' ? (r.configuredHand ?? 1) : 1;
      const quantity = r.stagingBatch?.qty || 1;
      const configuring = r.phase === 'configure-staged-panel';
      replaceContents(
        g,
        'panel-parts',
        `${j.item || 'rail'}/${hand}/${quantity}/${configuring ? j.track?.hand : ''}`,
        () => {
          if (!configuring)
            return j.item === 'rail'
              ? this.railPanelModel(quantity)
              : stockRailModel(j.item || 'rail', quantity, hand);
          const assembly = new THREE.Group();
          for (const [name, variant] of [
            ['supplied', hand],
            ['configured', j.track!.hand],
          ] as const) {
            const parts = stockRailModel(j.item!, 1, variant);
            parts.name = `configuration-${name}`;
            parts.traverse((part) => {
              if (!(part instanceof THREE.Mesh)) return;
              const mat = (part.material as THREE.Material).clone();
              mat.transparent = true;
              mat.userData.owned = true;
              part.material = mat;
            });
            assembly.add(parts);
          }
          return assembly;
        },
      );
      if (configuring) {
        const previous = this.previousRailWork.get(j.id);
        const clock = lerp(previous?.phase === r.phase ? previous.clock : 0, r.clock, alpha);
        const f = smoothstep(clock / 6);
        for (const [name, incoming] of [
          ['supplied', false],
          ['configured', true],
        ] as const) {
          const parts = g.getObjectByName(`configuration-${name}`)!;
          // Parts retain their rigid steel profile during reconfiguration;
          // staged supports remain beneath the kit throughout the assembly.
          parts.rotation.y = incoming ? Math.PI * (f - 1) : Math.PI * f;
          parts.position.y = Math.sin(f * Math.PI) * 0.12;
          parts.traverse((part) => {
            if (part instanceof THREE.Mesh)
              (part.material as THREE.Material).opacity = incoming ? f : 1 - f;
          });
        }
        const supports = ensure(
          `${j.id}-configuration-supports`,
          () => this.railSupports(Math.max(0.06, p.y)),
          { type: 'job', id: j.id },
        );
        supports.position.set(p.x, 0, p.z);
        supports.rotation.y = -p.yaw;
      }
      this.positionModel(g, p);
    }
    for (const j of s.jobs) {
      const h = j.handling;
      if (j.status !== 'doing' || !h) continue;
      const p = interpolateWorkPose(this.previousHandling.get(j.id)?.pose, h.pose, alpha);
      if (h.state === 'carried' || h.state === 'placed') {
        const g = ensure(
          `${j.id}-construction-slab`,
          () => {
            const g = new THREE.Group();
            box(g, 0, 0.06, 0, 0.979, 0.12, 0.979, 0xb8b9ab);
            return g;
          },
          h.placedStack ? { type: 'stack', id: h.placedStack } : { type: 'job', id: j.id },
        );
        this.positionModel(g, p);
      }
      if (['lower', 'withdraw', 'settle'].includes(h.phase)) {
        const g = ensure(`${j.id}-construction-runners`, () => new THREE.Group(), {
          type: 'job',
          id: j.id,
        });
        const height = h.state === 'placed' ? Math.max(0, p.y - 0.005) : 0.075;
        replaceContents(g, 'runners', height.toFixed(4), () => {
          const r = new THREE.Group();
          for (const x of [-0.48, 0, 0.48]) box(r, x, height / 2, 0, 0.04, height, 1, 0x746b4e);
          return r;
        });
        g.position.set(j.x + 0.5, 0, j.z + 0.5);
        g.rotation.y = -p.yaw;
      }
    }
    for (const j of s.jobs) {
      const a = j.shedAssembly;
      if (j.status !== 'doing' || !a || a.phase === 'complete') continue;
      if (a.ladder) {
        const ladder = ensure(`${j.id}-shed-ladder`, () => new THREE.Group(), {
          type: 'job',
          id: j.id,
        });
        const height = a.ladder.height;
        replaceContents(ladder, 'ladder', height.toFixed(3), () => {
          const frame = new THREE.Group();
          for (const z of [-0.35, 0.35]) {
            box(frame, 0.3, height / 2, z, 0.05, height, 0.055, 0xadb8be, 0.6);
            beam(
              frame,
              new THREE.Vector3(-1.1, 0.03, z),
              new THREE.Vector3(0.3, height - 0.1, z),
              0.055,
              0xadb8be,
            );
            box(frame, -1.1, 0.03, z, 0.2, 0.06, 0.14, 0x4d585d);
            box(frame, 0.3, 0.03, z, 0.2, 0.06, 0.14, 0x4d585d);
          }
          for (let y = 0.28; y < height - 0.2; y += 0.28)
            box(frame, 0.15, y, 0, 0.35, 0.045, 0.65, 0x9aa8ae, 0.5);
          return frame;
        });
        const worker = s.workers.find((w) => w.id === j.worker);
        ladder.position.set(a.ladder.x, this.surface(s, a.ladder), a.ladder.z);
        ladder.rotation.y = -(worker?.yaw || 0);
      }
      const counts: [ShedPartKind, number][] = [
        ['post', a.posts],
        ['beam', a.beams],
        ['roof', a.roofSheets],
        ['wall', a.wallPanels],
        ['brace', a.braces],
      ];
      const frame = ensure(`${j.id}-shed-frame`, () => new THREE.Group(), {
        type: 'job',
        id: j.id,
      });
      replaceContents(
        frame,
        'members',
        `${a.anchors}/${counts.map(([, n]) => n).join('/')}`,
        () => {
          const members = new THREE.Group();
          for (const p of shedPostPoints(j).slice(0, a.anchors)) {
            box(members, p.x, 0.185, p.z, 0.4, 0.12, 0.4, 0xb2b1a8);
            for (const dx of [-0.13, 0.13])
              for (const dz of [-0.13, 0.13])
                cylinder(members, p.x + dx, 0.26, p.z + dz, 0.022, 0.07, 0x68737a, 6);
          }
          for (const [kind, count] of counts)
            for (let i = 0; i < count; i++) {
              const part = shedComponentModel(j, kind, i),
                p = shedComponentPose(j, kind, i);
              part.position.set(p.x, p.y, p.z);
              part.rotation.y = -p.yaw;
              members.add(part);
            }
          return members;
        },
      );
      const separatePart = a.part && (!a.recovering || a.part.carried) ? 1 : 0;
      const remaining = Math.max(
        0,
        16 - counts.reduce((n, [, count]) => n + count, 0) - separatePart,
      );
      if (j.delivered && (remaining > 0 || a.recovering)) {
        const kit = ensure(`${j.id}-shed-kit`, () => new THREE.Group(), { type: 'job', id: j.id });
        replaceContents(kit, 'unpacked', `${remaining}/${a.phase === 'unpack'}`, () => {
          if (a.phase === 'unpack') return this.stockModel('shed', 1);
          const supplies = new THREE.Group();
          for (const x of [-1.35, 1.35]) box(supplies, x, -0.075, 0, 0.15, 0.15, 1.9, 0x847958);
          box(supplies, 0, 0.05, 0, 3.9, 0.1, 1.9, 0x847958);
          for (let i = 0; i < remaining; i++)
            box(
              supplies,
              0,
              0.14 + i * 0.045,
              -0.65 + (i % 4) * 0.4,
              3.7,
              0.05,
              0.18,
              i % 3 ? 0x73818a : 0xaeb8bd,
              0.35,
            );
          return supplies;
        });
        this.positionModel(kit, a.kitPose);
      }
      if (a.part) {
        const current = a.part,
          previous = this.previousShedParts.get(j.id);
        const pose = interpolateWorkPose(
          previous?.kind === current.kind && previous.index === current.index
            ? previous.pose
            : undefined,
          current.pose,
          alpha,
        );
        const part = ensure(`${j.id}-shed-moving-part`, () => new THREE.Group(), {
          type: 'job',
          id: j.id,
        });
        replaceContents(part, 'member', `${current.kind}/${current.index}`, () =>
          shedComponentModel(j, current.kind, current.index),
        );
        this.positionModel(part, pose);
        if (current.carried || ['lift', 'lower'].includes(a.phase)) {
          const e = s.equipment.find((m) => m.id === j.equipment),
            model = e && this.models.get(e.id);
          const tip = model?.getObjectByName('tool-tip');
          if (tip && e?.kind === 'excavator') {
            const slings = ensure(`${j.id}-shed-slings`, () => new THREE.Group(), {
              type: 'job',
              id: j.id,
            });
            model!.updateMatrixWorld(true);
            updateBeam(
              slings,
              0,
              tip.getWorldPosition(new THREE.Vector3()),
              new THREE.Vector3(
                pose.x,
                pose.y +
                  (current.kind === 'post'
                    ? 2.15
                    : current.kind === 'wall'
                      ? 1.9
                      : current.kind === 'brace'
                        ? 1.95
                        : 0.4),
                pose.z,
              ),
              0.025,
              0x424b4d,
            );
          }
        }
      }
    }
    for (const o of s.orders) {
      if (o.status === 'ordered' || o.status === 'done' || o.carrierDeparted) continue;
      const selection: Selection = { type: 'order', id: o.id },
        kind = deliveryKind(o),
        previous = this.previousDeliveries.get(o.id);
      const distance = lerp(
        previous?.distance ?? o.drive?.distance ?? 0,
        o.drive?.distance ?? 0,
        alpha,
      );
      const loadParents: { parent: THREE.Group; carIndex?: number }[] = [];
      if (kind === 'rail') {
        const loco = ensure(o.railFreight?.locomotiveId || `${o.id}-loco`, locomotive, selection);
        const locomotivePose = carPose(distance, 5);
        this.positionModel(loco, locomotivePose);
        const interpolated = { ...o, drive: { ...o.drive!, distance } };
        const cars = o.railFreight?.cars || [{ id: `${o.id}-flat`, centerOffset: COUPLED_CENTERS }];
        const vehicles = [{ model: loco, at: distance }];
        let leadingPose = locomotivePose,
          leadingRear = -4.2;
        for (const [index, car] of cars.entries()) {
          const flat = ensure(car.id, flatcar, selection);
          const wagonPose = railFreightCarPose(interpolated, index);
          this.positionModel(flat, wagonPose);
          vehicles.push({ model: flat, at: distance - car.centerOffset });
          loadParents.push({ parent: flat, carIndex: o.railFreight ? index : undefined });
          const coupler = ensure(`${car.id}-coupler`, () => new THREE.Group(), selection);
          const rear = localPoint(leadingPose, leadingRear, 0),
            front = localPoint(wagonPose, 8.3, 0);
          updateBeam(
            coupler,
            0,
            new THREE.Vector3(rear.x, 0.84, rear.z),
            new THREE.Vector3(front.x, 0.84, front.z),
            0.095,
            0x424b4d,
          );
          leadingPose = wagonPose;
          leadingRear = -8.3;
        }
        // Each bogie follows its own rail tangent, including through the entry switch.
        for (const { model: car, at } of vehicles) {
          const bodyYaw = -car.rotation.y;
          for (const bogie of car.children.filter((c) => c.name === 'bogie')) {
            const offset = bogie.userData.trackOffset ?? bogie.position.x;
            bogie.userData.trackOffset = offset;
            const bogiePose = carPose(at + offset, 1.56),
              delta = { x: bogiePose.x - car.position.x, z: bogiePose.z - car.position.z };
            bogie.position.x = Math.cos(bodyYaw) * delta.x + Math.sin(bodyYaw) * delta.z;
            bogie.position.z = -Math.sin(bodyYaw) * delta.x + Math.cos(bodyYaw) * delta.z;
            bogie.rotation.y = -angleDelta(bodyYaw, bogiePose.yaw);
          }
          animateWheels(car, distance);
        }
      } else {
        const g = ensure(o.id, () => roadVehicle(kind, kind === 'bus' ? o.qty : 0), selection),
          pose = roadRenderPose(o, distance);
        this.positionModel(g, pose);
        const ahead = roadRenderPose(o, distance + 0.5),
          behind = roadRenderPose(o, Math.max(0, distance - 0.5));
        const curvature = angleDelta(behind.yaw, ahead.yaw);
        animateWheels(
          g,
          roadWheelTravel(o, distance),
          Math.max(-0.6, Math.min(0.6, Math.atan(curvature * 5.5 * (pose.reverse ? -1 : 1)))),
        );
        const ramp = lerp(previous?.ramp ?? o.ramp ?? 0, o.ramp ?? 0, alpha);
        for (const child of g.children.filter((c) => c.name === 'loading-ramp'))
          child.rotation.z = lerp(-Math.PI / 2, Math.atan(0.82 / 4.5), ramp);
        let passenger = 0;
        for (const child of g.children.filter((c) => c.name === 'passenger'))
          child.visible = passenger++ >= o.arrived;
        loadParents.push({ parent: g });
      }
      for (const { parent: loadParent, carIndex } of loadParents)
        replaceContents(
          loadParent,
          'shipment',
          o.item in MATERIALS || o.manifest?.length
            ? `${o.item}/${o.qty}/${o.arrived}/${JSON.stringify(o.manifest || [])}`
            : '',
          () => {
            const load = new THREE.Group();
            for (const slot of shipmentLots(o)) {
              if (slot.qty <= 0 || slot.carIndex !== carIndex) continue;
              const c = this.stockModel(slot.item, slot.qty);
              c.position.set(slot.x, kind === 'rail' ? 1.3 : 1.15, slot.z);
              load.add(c);
            }
            return load;
          },
        );
      if (o.contractor && o.contractor.phase !== 'seated') {
        const h = ensure(`${o.id}-crew`, () => workerModel('engineer'), selection),
          pose = this.renderPose(s, `${o.id}-crew`, o.contractor, alpha);
        this.positionModel(h, pose);
        animatePerson(h, pose.travel, pose.moving);
      }
    }
    for (const [id, g] of this.models) {
      if (!live.has(id)) {
        this.dynamicGroup.remove(g);
        this.disposeGroup(g);
        this.models.delete(id);
      }
    }
    this.updateEquipmentIntent(s, alpha);
    const activeBufferJob = s.jobs.find((j) => j.status === 'doing' && j.railWork?.buffer);
    const lastBufferJob =
      activeBufferJob ||
      [...s.jobs]
        .reverse()
        .find(
          (j) =>
            j.railWork?.buffer &&
            Math.hypot(j.railWork.buffer.x - s.buffer.x, j.railWork.buffer.z - s.buffer.z) < 0.01,
        );
    if (lastBufferJob?.railWork?.buffer) {
      const p = interpolateWorkPose(
        this.previousRailWork.get(lastBufferJob.id)?.buffer,
        lastBufferJob.railWork.buffer,
        alpha,
      );
      this.positionModel(this.buffer, p);
    } else if (s.jobGroups?.some((g) => g.railBuffer && !g.railBuffer.pose.secured)) {
      const pose = s.jobGroups.find((g) => g.railBuffer && !g.railBuffer.pose.secured)!.railBuffer!
        .pose;
      this.positionModel(this.buffer, pose);
    } else {
      this.buffer.position.set(s.buffer.x, 0.2, s.buffer.z);
      this.buffer.rotation.y = 0;
    }
    const hour = (s.time / 3600) % 24;
    const daylight = Math.max(0.035, Math.sin(((hour - 6) / 12) * Math.PI));
    this.night = daylight < 0.15;
    this.sun.intensity = daylight * 2.8;
    this.ambient.intensity = 0.25 + daylight * 1.0;
    this.scene.environmentIntensity = 0.04 + daylight * 0.25;
    const sky = new THREE.Color(0x253e4b).lerp(
      new THREE.Color(0xd9e2e7),
      Math.min(1, daylight * 1.5),
    );
    this.scene.background = sky;
    (this.scene.fog as THREE.Fog).color.copy(sky);
    for (const l of this.lights) l.intensity = this.night ? 18 : 0;
    this.controls.update();
    this.fitShadowToView();
    this.composer.render();
  }
  point(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.mouse, this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, p) ? { x: p.x, z: p.z } : undefined;
  }
  pick(e: PointerEvent) {
    this.point(e);
    const hits = this.ray.intersectObjects(
      [this.dynamicGroup, this.staticGroup, this.planGroup, this.buffer],
      true,
    );
    for (const h of hits) {
      if (h.instanceId !== undefined && h.object.userData.selections?.[h.instanceId])
        return h.object.userData.selections[h.instanceId] as Selection;
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.selection) return o.userData.selection as Selection;
        o = o.parent;
      }
    }
    return undefined;
  }
  previewRailLocation(p: (Point & { yaw: number }) | undefined) {
    const key = p ? `${p.x.toFixed(2)}/${p.z.toFixed(2)}/${p.yaw.toFixed(3)}` : '';
    if (this.hover.userData.railLocationKey === key) return;
    this.disposeGroup(this.hover);
    this.hover.userData.railLocationKey = key;
    if (!p) return;
    const side = { x: -Math.sin(p.yaw), z: Math.cos(p.yaw) };
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        [-1.2, 1.2].map((d) => new THREE.Vector3(p.x + side.x * d, 0.53, p.z + side.z * d)),
      ),
      new THREE.LineBasicMaterial({ color: 0xe8d984 }),
    );
    this.hover.add(line);
    const icon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.23),
      new THREE.MeshBasicMaterial({ color: 0xe8d984, transparent: true, opacity: 0.7 }),
    );
    icon.position.set(p.x, 1.1, p.z);
    this.hover.add(icon);
  }
  preview(r: Rect | undefined, valid = true) {
    this.hover.userData.railLocationKey = undefined;
    this.disposeGroup(this.hover);
    if (!r) return;
    this.outline(this.hover, r, valid ? 0xe8d984 : 0xe06c54, 0.22);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(r.w, 0.08, r.d),
      new THREE.MeshBasicMaterial({
        color: valid ? 0xd7cf70 : 0xd95e46,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      }),
    );
    mesh.position.set(r.x + r.w / 2, 0.13, r.z + r.d / 2);
    this.hover.add(mesh);
  }
  previewTrack(pieces: TrackPiece[] | undefined, valid = true) {
    this.disposeGroup(this.hover);
    if (!pieces) return;
    const color = valid ? 0xe8d984 : 0xe06c54;
    const cells = new Set<string>();
    for (const piece of pieces) {
      const geometry = trackGeometry(piece),
        panel = trackPanelModel(piece);
      panel.position.set(geometry.pose.x, 0.04, geometry.pose.z);
      panel.rotation.y = -geometry.pose.yaw;
      panel.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        const mat = (part.material as THREE.MeshStandardMaterial).clone();
        mat.color.setHex(color);
        mat.transparent = true;
        mat.opacity = 0.42;
        mat.depthWrite = false;
        mat.userData.owned = true;
        part.material = mat;
      });
      this.hover.add(panel);
      for (const cell of geometry.cells) {
        const key = `${cell.x},${cell.z}`;
        if (cells.has(key)) continue;
        cells.add(key);
        this.outline(this.hover, { ...cell, w: 1, d: 1 }, color, 0.21);
      }
    }
  }
  highlight(r: Rect | undefined) {
    this.disposeGroup(this.selected);
    if (r) this.outline(this.selected, r, 0xf9e7a0, 0.27);
  }
  showEquipmentIntent(id?: string) {
    this.intentEquipmentId = id;
    if (!id) {
      for (const group of [this.intentRoutes, this.intentMarkers, this.intentBlockers])
        this.disposeGroup(group);
      this.intentKey = this.intentMarkerKey = this.intentBlockerKey = '';
    }
  }
  private updateEquipmentIntent(s: State, alpha: number) {
    const e = s.equipment.find((e) => e.id === this.intentEquipmentId);
    if (!e) {
      if (this.intentKey || this.intentMarkerKey || this.intentBlockerKey)
        this.showEquipmentIntent(undefined);
      return;
    }
    const intent = equipmentIntent(s, e),
      color = intent.hasRoute ? 0xb9d8bb : 0xe7b96d;
    const key = JSON.stringify([e.id, intent.target, intent.hasRoute, intent.route]);
    if (key !== this.intentKey) {
      this.disposeGroup(this.intentRoutes);
      this.intentKey = key;
      if (intent.target) {
        const points = [{ x: e.x, z: e.z }, ...(intent.hasRoute ? intent.route : [intent.target])];
        const geometry = new THREE.BufferGeometry().setFromPoints(
          points.map((p) => new THREE.Vector3(p.x, 0.39, p.z)),
        );
        const line = new THREE.Line(
          geometry,
          intent.hasRoute
            ? new THREE.LineBasicMaterial({ color, depthTest: false })
            : new THREE.LineDashedMaterial({
                color,
                dashSize: 0.5,
                gapSize: 0.3,
                depthTest: false,
              }),
        );
        line.name = intent.hasRoute ? 'equipment-planned-route' : 'equipment-target-intent';
        line.renderOrder = 12;
        line.computeLineDistances();
        this.intentRoutes.add(line);
        this.outline(
          this.intentRoutes,
          { x: intent.target.x - 0.5, z: intent.target.z - 0.5, w: 1, d: 1 },
          color,
          0.4,
          !intent.hasRoute,
        );
      }
    }
    const markerKey = JSON.stringify([intent.target, intent.targetLabel, intent.hasRoute]);
    if (markerKey !== this.intentMarkerKey) {
      this.disposeGroup(this.intentMarkers);
      this.intentMarkerKey = markerKey;
      if (intent.target) {
        const marker = sign(
          this.intentMarkers,
          `${intent.targetLabel}${intent.hasRoute ? '' : ' · TARGET'}`,
          intent.target.x,
          1.8,
          intent.target.z,
          5,
        );
        marker.name = 'equipment-destination-label';
        marker.renderOrder = 13;
        (marker.material as THREE.MeshBasicMaterial).depthTest = false;
      }
    }
    // Moving blockers may change every frame; quantized bounds keep redraws bounded
    // and never recreate the destination's canvas texture during those redraws.
    const blocker = intent.blocker && {
      id: intent.blocker.id,
      rect: {
        x: Math.floor(intent.blocker.rect.x * 4) / 4,
        z: Math.floor(intent.blocker.rect.z * 4) / 4,
        w: Math.ceil(intent.blocker.rect.w * 4 + 1) / 4,
        d: Math.ceil(intent.blocker.rect.d * 4 + 1) / 4,
      },
    };
    const blockerKey = JSON.stringify(blocker);
    if (blockerKey !== this.intentBlockerKey) {
      this.disposeGroup(this.intentBlockers);
      this.intentBlockerKey = blockerKey;
      if (blocker) this.outline(this.intentBlockers, blocker.rect, 0xe9755f, 0.43, true);
    }
    const pose = this.renderPose(s, e.id, e, alpha),
      line = this.intentRoutes.children[0];
    if (line instanceof THREE.Line) {
      const positions = line.geometry.getAttribute('position');
      positions.setXYZ(0, pose.x, 0.39, pose.z);
      positions.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      line.computeLineDistances();
    }
    const marker = this.intentMarkers.getObjectByName('equipment-destination-label');
    if (marker) marker.quaternion.copy(this.camera.quaternion);
  }
  followWorker(s: State, workerId: string, alpha: number) {
    const worker = s.workers.find((w) => w.id === workerId);
    if (!worker) return;
    const target = worker.vehicle
      ? s.equipment.find((e) => e.id === worker.vehicle) || worker
      : worker;
    this.focus(this.renderPose(s, target.id, target, Math.max(0, Math.min(1, alpha))));
  }
  focus(p: Point, zoom?: number) {
    const delta = new THREE.Vector3(p.x - this.controls.target.x, 0, p.z - this.controls.target.z);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    if (zoom) {
      const offset = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(offset, 110 / zoom);
    }
    this.controls.update();
  }
  pan(x: number, z: number, dt: number) {
    this.onNavigate?.();
    const backward = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
    const right = new THREE.Vector3(backward.z, 0, -backward.x);
    const delta = right.multiplyScalar(x).addScaledVector(backward, z).normalize();
    delta.multiplyScalar(this.camera.position.distanceTo(this.controls.target) * 0.4 * dt);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
  }
  project(p: Point) {
    const v = new THREE.Vector3(p.x, 0.2, p.z).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.canvas.clientWidth,
      y: ((1 - v.y) / 2) * this.canvas.clientHeight,
    };
  }
}
