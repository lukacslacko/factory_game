import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, cylinder, beam, material, sign } from './mesh';
import { RAIL_CENTER_OFFSET } from './catalog';
const steel = 0x424b4d,
  tire = 0x25282a,
  yellow = 0xd6a329;
const glass = new THREE.MeshPhysicalMaterial({
  color: 0x91bcc8,
  roughness: 0.2,
  metalness: 0.05,
  transparent: true,
  opacity: 0.27,
  depthWrite: false,
  side: THREE.DoubleSide,
});
function rounded(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
  r = 0.09,
) {
  const m = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 4, h / 4, d / 4)),
    material(color, 0.54, 0.25),
  );
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}
function windowPane(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  const m = box(g, x, y, z, w, h, d, 0x718f98);
  m.material = glass;
  m.castShadow = false;
  return m;
}
function tube(g: THREE.Object3D, pts: THREE.Vector3[], r: number, color: number) {
  const m = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(pts),
      Math.max(8, pts.length * 4),
      r,
      6,
      false,
    ),
    material(color, 0.55, 0.4),
  );
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}
function tireWheel(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  r: number,
  width = 0.26,
  rail = false,
  steer = false,
) {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  root.name = steer ? 'steered-wheel' : 'wheel';
  g.add(root);
  const rotor = new THREE.Group();
  rotor.name = 'wheel-rotor';
  rotor.userData.radius = r;
  root.add(rotor);
  const t = cylinder(rotor, 0, 0, 0, r, width, rail ? 0x687276 : tire, 24);
  t.rotation.x = Math.PI / 2;
  const out = z > 0 ? 1 : -1;
  if (rail) {
    const flange = cylinder(rotor, 0, 0, -out * width * 0.37, r + 0.035, 0.035, 0x474f54, 24);
    flange.rotation.x = Math.PI / 2;
  }
  const rim = cylinder(
    rotor,
    0,
    0,
    out * (width / 2 + 0.012),
    r * 0.65,
    0.03,
    rail ? 0x9ca9ac : 0xb2b5b1,
    20,
  );
  rim.rotation.x = Math.PI / 2;
  const hub = cylinder(rotor, 0, 0, out * (width / 2 + 0.035), r * 0.23, 0.08, steel, 12);
  hub.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const b = cylinder(
      rotor,
      Math.cos(a) * r * 0.42,
      Math.sin(a) * r * 0.42,
      out * (width / 2 + 0.036),
      0.025,
      0.023,
      0x555e60,
      6,
    );
    b.rotation.x = Math.PI / 2;
  }
  if (!rail)
    for (let i = 0; i < 20; i++) {
      const a = (i * Math.PI) / 10;
      const tread = box(
        rotor,
        Math.cos(a) * (r - 0.025),
        Math.sin(a) * (r - 0.025),
        0,
        0.045,
        0.035,
        width + 0.015,
        0x363a39,
      );
      tread.rotation.z = a;
    }
  return root;
}
function axle(
  g: THREE.Object3D,
  x: number,
  y: number,
  r: number,
  z: number,
  rail = false,
  steer = false,
) {
  const shaft = cylinder(g, x, y, 0, rail ? 0.065 : 0.075, z * 2, steel, 10);
  shaft.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) tireWheel(g, x, y, z * side, r, rail ? 0.14 : 0.29, rail, steer);
}
export function workerModel(role: string, seated = false) {
  const g = new THREE.Group();
  g.userData.seated = seated;
  const vest = role === 'operator' ? 0xe1b137 : role === 'engineer' ? 0x76a5a8 : 0xe17f28;
  rounded(g, 0, 1.14, 0, 0.31, 0.49, 0.44, vest, 0.06);
  box(g, 0, 1.06, 0, 0.322, 0.06, 0.452, 0xe0e5cb);
  for (const z of [-0.13, 0.13]) box(g, 0.161, 1.22, z, 0.012, 0.34, 0.035, 0xe0e5cb);
  cylinder(g, 0, 1.51, 0, 0.145, 0.25, 0xc59b79, 12);
  rounded(g, 0.115, 1.54, 0, 0.09, 0.08, 0.09, 0xc59b79, 0.025);
  const helmetColor = role === 'engineer' ? 0xe2dfce : 0xe4be35;
  const hat = new THREE.Mesh(
    new THREE.SphereGeometry(0.184, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    material(helmetColor, 0.65, 0.04),
  );
  hat.position.set(0, 1.625, 0);
  hat.scale.z = 0.95;
  hat.castShadow = hat.receiveShadow = true;
  g.add(hat);
  cylinder(g, 0.018, 1.626, 0, 0.207, 0.026, helmetColor, 16).scale.x = 1.08;
  rounded(g, 0, 1.785, 0, 0.22, 0.025, 0.024, helmetColor, 0.009);
  for (const side of [-1, 1]) box(g, 0.14, 1.56, side * 0.065, 0.015, 0.017, 0.024, 0x423d35);
  for (const z of [-0.13, 0.13]) {
    const leg = new THREE.Group();
    leg.name = z < 0 ? 'leg-left' : 'leg-right';
    leg.userData.side = z < 0 ? -1 : 1;
    leg.position.z = z;
    g.add(leg);
    const upper = box(leg, 0, 0.7, 0, 0.16, 0.46, 0.17, 0x394a51);
    upper.name = 'thigh';
    const lower = box(leg, 0, 0.29, 0, 0.14, 0.38, 0.15, 0x394a51);
    lower.name = 'shin';
    rounded(leg, 0.07, 0.075, 0, 0.29, 0.15, 0.2, 0x292e30, 0.035).name = 'boot';
    const arm = new THREE.Group();
    arm.position.set(0, 1.32, z < 0 ? -0.29 : 0.29);
    arm.name = z < 0 ? 'arm-left' : 'arm-right';
    g.add(arm);
    box(arm, 0, -0.18, 0, 0.13, 0.37, 0.15, vest);
    rounded(arm, 0.02, -0.39, 0, 0.13, 0.15, 0.14, 0xc59b79, 0.03);
  }
  animatePerson(g, 0, false);
  return g;
}
function segment(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, thickness: number) {
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.scale.set(thickness, a.distanceTo(b), thickness);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}
export function animatePerson(g: THREE.Group, travel: number, moving: boolean) {
  const seated = !!g.userData.seated;
  for (const leg of g.children.filter((c) => c.name.startsWith('leg-'))) {
    const phase = travel * 6.5 + (leg.userData.side < 0 ? Math.PI : 0);
    const stride = moving ? Math.sin(phase) * 0.25 : 0,
      lift = moving ? Math.max(0, Math.cos(phase)) * 0.085 : 0;
    const hip = new THREE.Vector3(0, 0.92, 0),
      knee = new THREE.Vector3(
        seated ? 0.34 : stride * 0.5 + (moving ? 0.065 : 0.015),
        seated ? 0.83 : 0.5 + lift * 0.25,
        0,
      );
    const foot = new THREE.Vector3(seated ? 0.48 : stride, 0.15 + (seated ? 0.38 : lift), 0);
    segment(leg.getObjectByName('thigh')!, hip, knee, 0.155);
    segment(leg.getObjectByName('shin')!, knee, foot, 0.14);
    leg.getObjectByName('boot')!.position.set(foot.x + 0.065, foot.y - 0.075, 0);
  }
  for (const arm of g.children.filter((c) => c.name.startsWith('arm-')))
    arm.rotation.z = seated
      ? 0.95
      : moving
        ? Math.sin(travel * 6.5 + (arm.name === 'arm-left' ? 0 : Math.PI)) * 0.28
        : 0;
}
function driver(g: THREE.Group, x: number, y: number, z: number, role = 'operator') {
  const d = workerModel(role, true);
  d.position.set(x, y, z);
  d.name = 'seated-operator';
  g.add(d);
  return d;
}
export function forklift(g: THREE.Group) {
  rounded(g, -0.4, 0.7, 0, 2.35, 0.75, 1.45, yellow, 0.16);
  rounded(g, -1.12, 0.96, 0, 0.68, 0.75, 1.43, 0xc78e21, 0.18);
  axle(g, 0.78, 0.41, 0.41, 0.82);
  axle(g, -1.05, 0.32, 0.32, 0.76, false, true);
  for (const z of [-0.68, 0.68]) {
    box(g, -0.72, 1.76, z, 0.075, 1.82, 0.075, steel);
    box(g, 0.58, 1.76, z, 0.075, 1.82, 0.075, steel);
  }
  rounded(g, -0.08, 2.7, 0, 1.66, 0.1, 1.65, 0x414b4e, 0.035);
  box(g, -0.38, 1.14, 0, 0.46, 0.13, 0.54, 0x2c3439);
  box(g, -0.61, 1.4, 0, 0.1, 0.5, 0.53, 0x2c3439);
  const steering = cylinder(g, 0.3, 1.49, 0, 0.2, 0.045, 0x242e33, 16);
  steering.rotation.z = 0.5;
  for (const z of [-0.55, 0.55]) box(g, 1.17, 1.57, z, 0.16, 2.94, 0.15, steel);
  for (const y of [0.35, 1.3, 2.9]) box(g, 1.19, y, 0, 0.12, 0.12, 1.18, 0x697476);
  const innerMast = new THREE.Group();
  innerMast.name = 'inner-mast';
  g.add(innerMast);
  for (const z of [-0.43, 0.43]) box(innerMast, 1.23, 1.75, z, 0.11, 2.4, 0.1, 0x748084);
  box(innerMast, 1.23, 2.95, 0, 0.11, 0.1, 0.96, 0x748084);
  const lift = new THREE.Group();
  lift.name = 'fork-carriage';
  g.add(lift);
  box(lift, 1.25, 0.4, 0, 0.14, 0.76, 1.27, 0x626d70);
  for (let z = -0.56; z <= 0.6; z += 0.14) box(lift, 1.3, 0.82, z, 0.065, 0.7, 0.04, 0x616d6f);
  const contact = new THREE.Object3D();
  contact.name = 'cargo-contact';
  contact.position.set(2.4, 0, 0);
  lift.add(contact);
  for (const z of [-0.4, 0.4]) {
    const section = new THREE.Shape();
    section.moveTo(-0.5, 0);
    section.lineTo(0.5, 0);
    section.lineTo(0.5, -0.3);
    section.lineTo(0.31, -1);
    section.lineTo(-0.5, -1);
    section.closePath();
    const geo = new THREE.ExtrudeGeometry(section, { depth: 1, bevelEnabled: false });
    geo.translate(0, 0, -0.5);
    const fork = new THREE.Mesh(geo, material(0x727d7e, 0.6, 0.75));
    fork.position.set(2.05, 0, z);
    fork.scale.set(1.9, 0.04, 0.12);
    fork.castShadow = fork.receiveShadow = true;
    lift.add(fork);
    fork.name = 'fork-tine';
    box(lift, 1.15, 0.25, z, 0.08, 0.44, 0.12, 0x727d7e, 0.75);
  }
  for (const z of [-0.29, 0.29]) cylinder(g, 1.02, 1.4, z, 0.046, 2.5, 0xa9b7b7, 10);
  box(g, -1.48, 0.76, 0, 0.16, 0.23, 1.12, 0x242f34);
  for (const z of [-0.63, 0.63]) box(g, -1.54, 1.03, z, 0.035, 0.13, 0.17, 0xba3c2d);
  const beacon = cylinder(g, -0.44, 2.83, 0, 0.075, 0.16, 0xd68826, 12);
  beacon.material = material(0xf9b039, 0.35, 0.1);
  sign(g, '2.5 t', -0.45, 0.89, 0.736, 0.42);
  driver(g, -0.37, 0.32, 0).visible = false;
}
export function excavator(g: THREE.Group) {
  for (const z of [-0.91, 0.91]) {
    const shape = new THREE.Shape();
    shape.moveTo(-1.48, 0.025);
    shape.lineTo(1.48, 0.025);
    shape.quadraticCurveTo(1.88, 0.025, 1.88, 0.45);
    shape.quadraticCurveTo(1.88, 0.86, 1.48, 0.86);
    shape.lineTo(-1.48, 0.86);
    shape.quadraticCurveTo(-1.88, 0.86, -1.88, 0.45);
    shape.quadraticCurveTo(-1.88, 0.025, -1.48, 0.025);
    const track = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.58, bevelEnabled: false, curveSegments: 8 }),
      material(0x303739),
    );
    track.position.z = z - 0.29;
    track.castShadow = track.receiveShadow = true;
    g.add(track);
    for (let n = 0; n < 38; n++) {
      const shoe = box(g, 0, 0, z, 0.18, 0.03, 0.63, 0x535b5d);
      shoe.name = 'track-shoe';
      shoe.userData.phase = n / 38;
      positionTrackShoe(shoe, 0);
    }
    for (let x = -1.45; x < 1.6; x += 0.58)
      tireWheel(g, x, 0.43, z + (z > 0 ? 0.3 : -0.3), 0.27, 0.08, true);
  }
  cylinder(g, 0, 0.96, 0, 0.76, 0.24, steel, 24);
  const upper = new THREE.Group();
  upper.name = 'upper';
  upper.position.y = 1.1;
  g.add(upper);
  rounded(upper, -0.75, 0.55, -0.28, 1.8, 1.02, 1.36, yellow, 0.18);
  rounded(upper, -1.24, 0.55, 0, 0.55, 1, 1.88, 0xbf8c24, 0.17);
  for (let x = -1.25; x < -0.4; x += 0.12) box(upper, x, 1.07, -0.37, 0.045, 0.01, 0.66, 0x514b38);
  // A glazed cab with actual pillars and a visible seated operator.
  box(upper, 0.26, 0.32, 0.51, 1.32, 0.21, 0.92, steel);
  for (const x of [-0.35, 0.87])
    for (const z of [0.04, 1]) box(upper, x, 1.18, z, 0.07, 1.74, 0.07, steel);
  rounded(upper, 0.26, 2.08, 0.52, 1.4, 0.1, 1.06, 0xd5b85e, 0.055);
  windowPane(upper, 0.26, 1.48, 1.012, 1.15, 1.05, 0.025);
  windowPane(upper, 0.26, 1.48, 0.01, 1.15, 1.05, 0.025);
  windowPane(upper, 0.89, 1.48, 0.52, 0.025, 1.05, 0.84);
  box(upper, 0.02, 0.94, 0.52, 0.49, 0.1, 0.5, 0x283335);
  rounded(upper, -0.22, 1.17, 0.52, 0.1, 0.48, 0.5, 0x283335, 0.035);
  for (const z of [0.2, 0.83]) {
    const lever = cylinder(upper, 0.33, 1.17, z, 0.027, 0.25, 0x3a4546, 8);
    lever.rotation.z = -0.2;
    cylinder(upper, 0.36, 1.31, z, 0.048, 0.045, 0x242e30, 10);
  }
  driver(upper, 0.04, 0.1, 0.52).visible = false;
  cylinder(upper, -0.95, 1.37, -0.65, 0.05, 0.63, steel, 10);
  const boom = new THREE.Group();
  boom.name = 'boom-system';
  upper.add(boom);
  for (const name of ['boom-link', 'stick-link', 'hydraulic-a', 'hydraulic-b']) {
    const m = box(boom, 0, 0, 0, 1, 1, 1, name.startsWith('hydraulic') ? 0x9ba8aa : yellow);
    m.name = name;
  }
  const hook = new THREE.Group();
  hook.name = 'tool-tip';
  boom.add(hook);
  const bucket = new THREE.Group();
  bucket.name = 'bucket';
  hook.add(bucket);
  // Open bucket shell: curved back, bottom and side cheeks, rather than a solid cube.
  box(bucket, 0.06, -0.38, 0, 0.76, 0.085, 0.82, 0x65614e);
  const back = box(bucket, -0.28, -0.15, 0, 0.085, 0.54, 0.82, 0x65614e);
  back.rotation.z = -0.22;
  for (const side of [-1, 1]) {
    const cheek = box(bucket, 0.04, -0.23, side * 0.4, 0.67, 0.32, 0.065, 0x706b57);
    cheek.rotation.z = 0.16;
  }
  for (const z of [-0.28, 0, 0.28]) {
    const tooth = box(bucket, 0.5, -0.395, z, 0.26, 0.08, 0.105, 0xb2afa1);
    tooth.rotation.z = -0.07;
  }
  const hookRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.027, 6, 14, Math.PI * 1.65),
    material(steel, 0.4, 0.7),
  );
  hookRing.rotation.y = Math.PI / 2;
  hookRing.name = 'lifting-hook';
  hook.add(hookRing);
  hookRing.visible = false;
  sign(upper, 'EX-6', -0.83, 0.69, 0.97, 0.6);
  animateMachine(g, 'excavator', false, 0, 0, 3.5);
}
/** lift is fork top height, or hook height, measured from the machine's ground plane. */
export function animateMachine(
  g: THREE.Group,
  kind: string,
  occupied: boolean,
  travel: number,
  lift: number,
  reach = 2.7,
  _pitch = 0,
  loading = false,
) {
  g.traverse((o) => {
    if (o.name === 'seated-operator') o.visible = occupied;
  });
  animateWheels(g, travel);
  if (kind === 'forklift') {
    const carriage = g.getObjectByName('fork-carriage')!;
    carriage.position.y = Math.max(0.075, lift);
    g.getObjectByName('inner-mast')!.position.y = Math.max(0, lift - 1.5);
    // Extension forks stay attached to the carriage and support the center of long pallets.
    const tip = Math.max(3.0, Math.min(4.2, reach + 0.35));
    for (const tine of carriage.children.filter((o) => o.name === 'fork-tine')) {
      tine.position.x = (1.1 + tip) / 2;
      tine.scale.x = tip - 1.1;
    }
    carriage.getObjectByName('cargo-contact')!.position.x = reach;
    return;
  }
  const system = g.getObjectByName('boom-system');
  if (!system) return;
  const a = new THREE.Vector3(0.62, 0.6, -0.34),
    requested = new THREE.Vector3(reach, Math.max(-0.7, lift - 1.1), 0);
  const delta = requested.clone().sub(a),
    l1 = 3.3,
    l2 = 2.8;
  const d = Math.min(l1 + l2 - 0.005, Math.max(Math.abs(l1 - l2) + 0.005, delta.length()));
  const v = delta.normalize(),
    c = a.clone().addScaledVector(v, d);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
    rise = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(v, -v.y).normalize();
  const b = a.clone().addScaledVector(v, along).addScaledVector(up, rise);
  segment(system.getObjectByName('boom-link')!, a, b, 0.29);
  segment(system.getObjectByName('stick-link')!, b, c, 0.22);
  segment(
    system.getObjectByName('hydraulic-a')!,
    a.clone().add(new THREE.Vector3(0.15, -0.16, -0.24)),
    b
      .clone()
      .lerp(a, 0.15)
      .add(new THREE.Vector3(0, -0.13, -0.24)),
    0.075,
  );
  segment(
    system.getObjectByName('hydraulic-b')!,
    b.clone().add(new THREE.Vector3(-0.18, -0.14, -0.2)),
    c
      .clone()
      .lerp(b, 0.2)
      .add(new THREE.Vector3(0, 0.1, -0.2)),
    0.06,
  );
  const tip = system.getObjectByName('tool-tip')!;
  tip.position.copy(c);
  tip.getObjectByName('bucket')!.visible = true;
  tip.getObjectByName('lifting-hook')!.visible = loading;
}

function bogie(g: THREE.Group, x: number, r = 0.4) {
  const b = new THREE.Group();
  b.position.x = x;
  b.name = 'bogie';
  g.add(b);
  for (const a of [-0.78, 0.78]) axle(b, a, 0.325 + r, r, RAIL_CENTER_OFFSET, true);
  for (const z of [-0.64, 0.64]) {
    box(b, 0, 0.81, z, 2.1, 0.22, 0.12, steel);
    for (const a of [-0.78, 0.78]) {
      box(b, a, 0.75, z, 0.23, 0.25, 0.18, 0x3c4448);
      for (let y = 0.9; y < 1.1; y += 0.045) cylinder(b, a, y, z, 0.07, 0.026, 0x6a7477, 8);
    }
  }
  box(b, 0, 0.95, 0, 0.28, 0.2, 1.3, steel);
  return b;
}
function coupling(g: THREE.Group, x: number) {
  const end = Math.sign(x);
  for (const z of [-0.85, 0.85]) {
    box(g, x + end * 0.26, 0.99, z, 0.58, 0.11, 0.12, steel);
    const pad = cylinder(g, x + end * 0.57, 0.99, z, 0.17, 0.075, 0x262e32, 16);
    pad.rotation.z = Math.PI / 2;
  }
  box(g, x + end * 0.34, 0.84, 0, 0.72, 0.1, 0.12, 0x484f50);
  const link = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.028, 6, 12),
    material(0x424b4d, 0.45, 0.65),
  );
  link.rotation.x = Math.PI / 2;
  link.position.set(x + end * 0.68, 0.84, 0);
  g.add(link);
  tube(
    g,
    [
      new THREE.Vector3(x, 0.9, 0.29),
      new THREE.Vector3(x + end * 0.2, 0.65, 0.29),
      new THREE.Vector3(x + end * 0.34, 0.75, 0.29),
    ],
    0.026,
    0x232b2c,
  );
}
export function locomotive() {
  const g = new THREE.Group();
  g.name = 'diesel-locomotive';
  box(g, 0, 1.18, 0, 7.9, 0.35, 2.35, 0x303d40);
  bogie(g, -2.5, 0.42);
  bogie(g, 2.5, 0.42);
  rounded(g, 0.92, 2.08, 0, 4.9, 1.55, 1.68, 0x49675c, 0.14);
  rounded(g, -2.25, 1.88, 0, 2.25, 1.02, 2.28, 0xb2b6a1, 0.09);
  for (const x of [-3.34, -1.16])
    for (const z of [-1.09, 1.09]) box(g, x, 2.95, z, 0.1, 1.13, 0.1, 0xb2b6a1);
  box(g, -2.25, 2.5, 0, 2.25, 0.12, 2.28, 0xb2b6a1);
  rounded(g, -2.25, 3.54, 0, 2.5, 0.16, 2.46, 0x455651, 0.08);
  for (const z of [-1.146, 1.146]) {
    windowPane(g, -2.3, 2.96, z, 1.64, 0.78, 0.024);
    box(g, -2.23, 2.96, z, 0.06, 0.86, 0.04, 0x344b43);
    box(g, -3.15, 2.4, z, 0.055, 1.45, 0.05, 0x4a5f54);
    box(g, -2.8, 1.95, z, 0.28, 0.05, 0.04, steel);
  }
  windowPane(g, -1.11, 2.97, 0, 0.025, 0.78, 1.88);
  windowPane(g, -3.39, 2.97, 0, 0.025, 0.78, 1.88);
  box(g, -2.05, 2.44, 0.46, 0.5, 0.11, 0.56, 0x3b4847);
  box(g, -2.28, 2.65, 0.46, 0.1, 0.47, 0.54, 0x3b4847);
  box(g, -1.45, 2.49, 0.1, 0.45, 0.22, 1.45, 0x4a5551);
  for (const z of [-0.45, -0.1, 0.25, 0.6]) {
    const dial = cylinder(g, -1.69, 2.51, z, 0.08, 0.015, 0xc4c9b5, 12);
    dial.rotation.z = Math.PI / 2;
  }
  driver(g, -2.05, 1.57, 0.46, 'engineer');
  for (let x = -0.7; x < 3.3; x += 0.18) box(g, x, 2.25, 0.85, 0.055, 0.85, 0.026, 0x263d37);
  for (let x = -0.7; x < 3.3; x += 0.18) box(g, x, 2.25, -0.85, 0.055, 0.85, 0.026, 0x263d37);
  cylinder(g, 0.45, 3.06, 0, 0.09, 0.56, 0x313c3e, 12);
  cylinder(g, 2.3, 2.91, 0, 0.36, 0.08, 0x2a3c36, 20);
  for (const z of [-1.08, 1.08]) {
    box(g, 0.8, 1.47, z, 5.7, 0.09, 0.44, 0x626d63);
    for (const x of [-0.9, 0.45, 1.8, 3.5]) cylinder(g, x, 1.94, z, 0.026, 0.98, 0xc8ba68, 8);
    beam(g, new THREE.Vector3(-0.9, 2.43, z), new THREE.Vector3(3.5, 2.43, z), 0.045, 0xc8ba68);
  }
  for (const z of [-0.66, 0.66]) {
    const lamp = cylinder(g, 3.41, 2.37, z, 0.115, 0.055, 0xe9e0b1, 16);
    lamp.rotation.z = Math.PI / 2;
  }
  for (const x of [-3.9, 3.9]) {
    box(g, x, 1.19, 0, 0.12, 0.35, 2.3, 0xc59c39);
    for (let z = -0.95; z < 1; z += 0.32) {
      const stripe = box(g, x + Math.sign(x) * 0.065, 1.19, z, 0.02, 0.32, 0.12, 0x3d463d);
      stripe.rotation.x = 0.45;
    }
    coupling(g, x);
  }
  for (const x of [-3.6, 3.6])
    for (const z of [-1.12, 1.12])
      for (let y = 0.57; y < 1.4; y += 0.25) box(g, x, y, z, 0.48, 0.06, 0.32, steel);
  sign(g, 'D 01', 0.8, 1.74, 0.868, 0.7);
  return g;
}
export function flatcar() {
  const g = new THREE.Group();
  g.name = 'flatcar';
  bogie(g, -5.5, 0.38);
  bogie(g, 5.5, 0.38);
  box(g, 0, 1.07, 0, 16, 0.3, 2.55, 0x525d5d);
  for (const z of [-1.29, 1.29]) box(g, 0, 1.12, z, 16, 0.3, 0.11, 0x6c6657);
  for (let x = -7.85; x < 8; x += 0.3)
    box(
      g,
      x,
      1.26,
      0,
      0.286,
      0.075,
      2.5,
      ((Math.round(x * 10) % 3) + 3) % 3 === 0 ? 0x928572 : 0x887c68,
    );
  for (let x = -7.5; x <= 7.5; x += 1.5)
    for (const z of [-1.35, 1.35]) box(g, x, 1.12, z, 0.14, 0.29, 0.12, 0x9f987e);
  for (const x of [-8, 8]) coupling(g, x);
  const brake = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.024, 6, 18), material(0x9e7540));
  brake.position.set(-7.65, 1.52, 1.38);
  g.add(brake);
  sign(g, 'FLAT 01 · 48 t', 0, 1.02, 1.353, 1.15);
  return g;
}
export function roadVehicle(kind: string, passengers = 0) {
  const g = new THREE.Group(),
    bus = kind === 'bus',
    low = kind === 'lowloader',
    service = kind === 'service';
  g.name = kind;
  const front = low ? 4.3 : 3.2,
    rear = low ? -4.1 : -3.05;
  box(g, low ? 0.25 : 0, 0.69, 0, low ? 11 : 9, 0.28, 2.15, steel);
  axle(g, front, 0.5, 0.5, 1.08, false, true);
  axle(g, rear, low ? 0.33 : 0.5, low ? 0.33 : 0.5, low ? 1.17 : 1.08);
  if (!bus) axle(g, rear + 1.14, low ? 0.33 : 0.5, low ? 0.33 : 0.5, low ? 1.17 : 1.08);
  const paint = bus ? 0xc7ba8c : 0xd6d8cc;
  rounded(g, front, 1.05, 0, 2.5, 1.03, 2.4, paint, 0.15);
  rounded(g, front, 2.71, 0, 2.53, 0.15, 2.43, paint, 0.075);
  for (const x of [front - 1.17, front + 1.17])
    for (const z of [-1.14, 1.14]) box(g, x, 2.08, z, 0.11, 1.18, 0.11, paint);
  box(g, front - 1.18, 2.06, 0, 0.12, 1.14, 2.36, paint);
  box(g, front + 0.78, 1.57, 0, 0.76, 0.15, 2.22, 0x41504e);
  windowPane(g, front + 1.225, 2.11, 0, 0.027, 1.02, 2.15);
  for (const z of [-0.55, 0.55]) {
    const wipe = box(g, front + 1.246, 1.83, z, 0.027, 0.43, 0.024, 0x364442);
    wipe.rotation.x = 0.28;
  }
  const steering = cylinder(g, front + 0.47, 1.66, -0.58, 0.21, 0.035, 0x283534, 16);
  steering.rotation.z = 0.45;
  for (const z of [-1.22, 1.22]) {
    windowPane(g, front, 2.1, z, 1.4, 0.97, 0.022);
    box(g, front + 0.02, 1.5, z, 0.52, 0.035, 0.035, steel);
    box(g, front - 0.78, 2.03, z, 0.07, 1.05, 0.035, 0x65766b);
    beam(
      g,
      new THREE.Vector3(front + 0.53, 2.05, z),
      new THREE.Vector3(front + 0.65, 2.05, z + Math.sign(z) * 0.24),
      0.035,
      steel,
    );
    box(g, front + 0.66, 2.05, z + Math.sign(z) * 0.25, 0.18, 0.3, 0.05, steel);
  }
  box(g, front + 1.28, 1.1, 0, 0.07, 0.47, 1.33, 0x475457);
  for (let z = -0.55; z <= 0.6; z += 0.12)
    box(g, front + 1.32, 1.1, z, 0.012, 0.32, 0.035, 0x84908b);
  for (const z of [-0.93, 0.93]) {
    box(g, front + 1.28, 1.13, z, 0.04, 0.19, 0.32, 0xe1ddc5);
    box(g, front + 1.28, 0.97, z, 0.04, 0.065, 0.28, 0xd68e30);
  }
  box(g, front + 1.3, 0.74, 0, 0.13, 0.2, 2.3, 0x63706e);
  box(g, front - 0.28, 1.46, -0.58, 0.5, 0.13, 0.55, 0x384846);
  box(g, front - 0.53, 1.72, -0.58, 0.13, 0.56, 0.55, 0x384846);
  driver(g, front - 0.28, 0.61, -0.58, 'engineer');
  if (bus) {
    rounded(g, -1.24, 1.16, 0, 6.25, 1.28, 2.4, 0xbcb492, 0.12);
    rounded(g, -1.24, 2.82, 0, 6.25, 0.16, 2.4, 0xbcb492, 0.075);
    box(g, -4.31, 2.19, 0, 0.12, 1.12, 2.36, 0xbcb492);
    for (let x = -4.28; x < 1.9; x += 1.02)
      for (const z of [-1.16, 1.16]) box(g, x, 2.21, z, 0.09, 1.08, 0.075, 0xbcb492);
    for (let x = -3.8; x < 1.4; x += 1.02)
      for (const z of [-1.213, 1.213]) windowPane(g, x, 2.24, z, 0.86, 0.85, 0.026);
    for (let n = 0; n < Math.min(12, passengers); n++) {
      const sx = -3.7 + Math.floor(n / 2) * 0.82,
        sz = n % 2 ? 0.53 : -0.53;
      box(g, sx, 1.46, sz, 0.5, 0.13, 0.53, 0x526e68);
      box(g, sx - 0.25, 1.72, sz, 0.1, 0.56, 0.53, 0x526e68);
      const p = driver(g, sx, 0.61, sz);
      p.name = 'passenger';
    }
    box(g, 1.34, 1.43, 1.225, 0.56, 1.8, 0.035, 0x40524d);
    for (let y = 0.14; y < 0.82; y += 0.2) box(g, 1.34, y, 1.35, 0.6, 0.06, 0.24, steel);
    box(g, -1.2, 1.43, 1.24, 5.9, 0.13, 0.025, 0x51736a);
  } else if (service) {
    rounded(g, -1.08, 1.72, 0, 5.65, 2.1, 2.45, 0xbac6b4, 0.1);
    for (const z of [-1.235, 1.235]) sign(g, 'UTILITY SERVICE', -1.1, 2, z, 2.5);
  } else {
    const deck = low ? 0.82 : 1.15,
      cx = low ? -1.2 : -1.4,
      len = low ? 8.1 : 6;
    box(g, cx, deck - 0.15, 0, len, 0.24, low ? 2.8 : 2.55, 0x707564);
    for (let x = cx - len / 2 + 0.1; x < cx + len / 2; x += 0.23)
      box(g, x, deck - 0.015, 0, 0.22, 0.035, low ? 2.76 : 2.51, 0x9a8e74);
    for (const z of [-1.3, 1.3]) {
      box(g, cx, deck - 0.1, z, len, 0.16, 0.1, 0x656956);
      for (let x = cx - len / 2 + 0.3; x < cx + len / 2; x += 1.3)
        box(g, x, deck - 0.11, z, 0.08, 0.21, 0.09, 0xa1a18a);
    }
    if (low) {
      for (const z of [-0.88, 0.88]) {
        const ramp = new THREE.Group();
        ramp.name = 'loading-ramp';
        ramp.position.set(-5.25, 0.82, z);
        g.add(ramp);
        const rampLength = Math.hypot(4.5, 0.82);
        const profile = new THREE.Shape();
        profile.moveTo(0, 0);
        profile.lineTo(-rampLength, 0);
        profile.lineTo(-rampLength + 0.6, -0.1);
        profile.lineTo(0, -0.1);
        profile.closePath();
        const rampDeck = new THREE.Mesh(
          new THREE.ExtrudeGeometry(profile, { depth: 0.68, bevelEnabled: false }),
          material(0x5a6666, 0.8, 0.3),
        );
        rampDeck.position.z = -0.34;
        rampDeck.castShadow = rampDeck.receiveShadow = true;
        ramp.add(rampDeck);
        for (let x = -4.4; x < 0; x += 0.24) box(ramp, x, 0.012, 0, 0.08, 0.024, 0.65, 0x8a9690);
        ramp.rotation.z = -Math.PI / 2;
      }
    }
  }
  for (const z of [-1.13, 1.13]) {
    box(g, low ? -5.31 : -4.54, 0.72, z, 0.04, 0.14, 0.24, 0xae4030);
    box(g, low ? -5.31 : -4.54, 0.59, z, 0.04, 0.07, 0.24, 0xd59b40);
  }
  return g;
}
function positionTrackShoe(shoe: THREE.Object3D, travel: number) {
  const straight = 2.96,
    r = 0.415,
    arc = Math.PI * r,
    loop = straight * 2 + arc * 2;
  let d = (((shoe.userData.phase * loop - travel) % loop) + loop) % loop;
  if (d < straight) {
    shoe.position.x = -1.48 + d;
    shoe.position.y = 0.015;
    shoe.rotation.z = 0;
  } else if (d < straight + arc) {
    const angle = -Math.PI / 2 + (d - straight) / r;
    shoe.position.x = 1.48 + Math.cos(angle) * r;
    shoe.position.y = 0.43 + Math.sin(angle) * r;
    shoe.rotation.z = angle + Math.PI / 2;
  } else if (d < straight * 2 + arc) {
    shoe.position.x = 1.48 - (d - straight - arc);
    shoe.position.y = 0.845;
    shoe.rotation.z = Math.PI;
  } else {
    const angle = Math.PI / 2 + (d - straight * 2 - arc) / r;
    shoe.position.x = -1.48 + Math.cos(angle) * r;
    shoe.position.y = 0.43 + Math.sin(angle) * r;
    shoe.rotation.z = angle + Math.PI / 2;
  }
}
export function animateWheels(g: THREE.Object3D, travel: number, steer = 0) {
  g.traverse((o) => {
    if (o.name === 'wheel-rotor') o.rotation.z = -travel / o.userData.radius;
    if (o.name === 'track-shoe') positionTrackShoe(o, travel);
    if (o.name === 'steered-wheel') o.rotation.y = -steer;
  });
}
