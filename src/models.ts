import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, cylinder, beam, material, sign } from './mesh';
import { RAIL_CENTER_OFFSET } from './catalog';
const steel = 0x424b4d,
  tire = 0x25282a,
  yellow = 0xd6a329;
const glass = new THREE.MeshPhysicalMaterial({
  color: 0x7f999f,
  roughness: 0.29,
  metalness: 0.04,
  transparent: true,
  opacity: 0.44,
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
    material(color, 0.73, 0.13),
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
/** A sheet-metal silhouette in the local X/Y plane, with readable bevels. */
function profile(
  parent: THREE.Object3D,
  points: [number, number][],
  depth: number,
  color: number,
  z = 0,
  bevel = 0.018,
  hole?: [number, number][],
) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  if (hole) {
    const opening = new THREE.Path();
    hole.forEach(([x, y], i) => (i ? opening.lineTo(x, y) : opening.moveTo(x, y)));
    opening.closePath();
    shape.holes.push(opening);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2 + bevel);
  const mesh = new THREE.Mesh(geometry, material(color, 0.76, 0.15));
  mesh.position.z = z;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function pivot(parent: THREE.Object3D, name: string, r: number, width: number) {
  const group = new THREE.Group();
  group.name = name;
  const collar = cylinder(group, 0, 0, 0, r, width, 0x5e6664, 16);
  collar.rotation.x = Math.PI / 2;
  for (const sign of [-1, 1]) {
    const cap = cylinder(group, 0, 0, sign * (width / 2 + 0.014), r * 0.62, 0.035, 0xa4aaa2, 12);
    cap.rotation.x = Math.PI / 2;
    const bolt = cylinder(group, 0, 0, sign * (width / 2 + 0.037), r * 0.27, 0.02, steel, 6);
    bolt.rotation.x = Math.PI / 2;
  }
  parent.add(group);
  return group;
}
function hydraulic(parent: THREE.Object3D, name: string) {
  // Unit-length actuator; segment() sets its live end points without changing the API.
  const group = new THREE.Group();
  group.name = name;
  cylinder(group, 0, -0.18, 0, 0.75, 0.64, 0x515b59, 12);
  cylinder(group, 0, 0.18, 0, 0.39, 0.64, 0xb2c0c0, 12);
  cylinder(group, 0, 0.14, 0, 0.82, 0.045, 0x394341, 12);
  parent.add(group);
  return group;
}
function boomMember(parent: THREE.Object3D, name: string, width: number, color: number) {
  const group = new THREE.Group();
  group.name = name;
  const p: [number, number][] = [
    [-0.33, -0.5],
    [0.34, -0.5],
    [width, -0.15],
    [width * 0.8, 0.26],
    [0.25, 0.5],
    [-0.25, 0.5],
    [-width * 0.65, 0.17],
    [-width * 0.8, -0.23],
  ];
  profile(group, p, 0.95, color, 0, 0.025);
  // Dark recessed pin plates and raised perimeter reinforcement read at yard scale.
  for (const z of [-0.49, 0.49]) box(group, -0.17, 0.02, z, 0.08, 0.7, 0.055, 0xbd8b22);
  const hose = cylinder(group, -width * 0.7, 0, -0.6, 0.065, 0.86, 0x333d3b, 8);
  hose.name = 'hydraulic-hose';
  parent.add(group);
  return group;
}
function grille(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number) {
  rounded(parent, x, y, z, w, h, 0.025, 0x323b3b, 0.014);
  for (let dy = -h / 2 + 0.055; dy < h / 2; dy += 0.065)
    box(parent, x, y + dy, z + Math.sign(z || 1) * 0.018, w - 0.055, 0.019, 0.025, 0x657068);
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
  t.material = material(rail ? 0x687276 : tire, rail ? 0.58 : 0.95, rail ? 0.6 : 0.02);
  const out = z > 0 ? 1 : -1;
  if (!rail) {
    const sidewall = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.84, r * 0.115, 7, 22),
      material(0x303434, 0.96, 0.015),
    );
    sidewall.position.z = out * (width / 2 - 0.015);
    sidewall.castShadow = sidewall.receiveShadow = true;
    rotor.add(sidewall);
  }
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
  // Tapered work clothes retain the original shoulders, hip, and boot anchors.
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.205, 0.172, 0.45, 10),
    material(vest, 0.94),
  );
  torso.position.y = 1.135;
  torso.scale.set(0.78, 1, 1.1);
  torso.castShadow = torso.receiveShadow = true;
  g.add(torso);
  rounded(g, -0.025, 0.91, 0, 0.29, 0.14, 0.34, 0x37474e, 0.045);
  rounded(g, 0, 1.065, 0, 0.307, 0.049, 0.4, 0xdedfc7, 0.01);
  for (const z of [-0.118, 0.118]) {
    box(g, 0.15, 1.225, z, 0.012, 0.24, 0.027, 0xe3e4ce);
    box(g, -0.15, 1.225, z, 0.012, 0.24, 0.027, 0xe3e4ce);
  }
  box(g, 0.164, 1.19, 0, 0.012, 0.31, 0.013, 0x5b6659);
  rounded(g, 0.172, 1.235, -0.065, 0.025, 0.074, 0.07, 0x4b5350, 0.009);
  cylinder(g, 0, 1.4, 0, 0.065, 0.12, 0xc39b7e, 10);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 10), material(0xc59b79, 0.91));
  head.position.set(0.013, 1.526, 0);
  head.scale.set(0.91, 1.04, 0.86);
  head.castShadow = head.receiveShadow = true;
  g.add(head);
  rounded(g, 0.145, 1.53, 0, 0.047, 0.058, 0.049, 0xc59b79, 0.018);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), material(0xbb9274, 0.91));
    ear.position.set(-0.005, 1.526, side * 0.125);
    ear.scale.set(0.65, 1.1, 0.6);
    g.add(ear);
  }
  const helmetColor = role === 'engineer' ? 0xe5e1d6 : 0xe2ba35;
  const hat = new THREE.Mesh(
    new THREE.SphereGeometry(0.178, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2),
    material(helmetColor, 0.72, 0.025),
  );
  hat.position.set(0, 1.625, 0);
  hat.scale.z = 0.92;
  hat.castShadow = hat.receiveShadow = true;
  g.add(hat);
  cylinder(g, 0.018, 1.626, 0, 0.193, 0.021, helmetColor, 18).scale.x = 1.1;
  rounded(g, 0.015, 1.788, 0, 0.21, 0.023, 0.022, helmetColor, 0.009);
  for (const z of [-0.13, 0.13]) {
    const leg = new THREE.Group();
    leg.name = z < 0 ? 'leg-left' : 'leg-right';
    leg.userData.side = z < 0 ? -1 : 1;
    leg.position.z = z;
    g.add(leg);
    for (const name of ['thigh', 'shin']) {
      const limb = new THREE.Mesh(
        new THREE.CylinderGeometry(name === 'thigh' ? 0.55 : 0.51, 0.46, 1, 9),
        material(0x394a51, 0.95),
      );
      limb.name = name;
      limb.castShadow = limb.receiveShadow = true;
      leg.add(limb);
    }
    rounded(leg, 0.07, 0.075, 0, 0.29, 0.15, 0.2, 0x292e30, 0.035).name = 'boot';
    const arm = new THREE.Group();
    arm.position.set(0, 1.32, z < 0 ? -0.26 : 0.26);
    arm.name = z < 0 ? 'arm-left' : 'arm-right';
    g.add(arm);
    const sleeve = cylinder(arm, -0.006, -0.112, 0, 0.074, 0.25, vest, 10);
    sleeve.rotation.z = -0.07;
    const forearm = cylinder(arm, 0.025, -0.298, 0, 0.055, 0.17, 0x687677, 10);
    forearm.rotation.z = 0.24;
    rounded(arm, 0.05, -0.41, 0, 0.11, 0.135, 0.12, 0xa89d7c, 0.04);
    cylinder(arm, 0.012, -0.225, 0, 0.076, 0.035, 0xe3e4ce, 10);
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
  for (const z of [-0.78, 0.78]) rounded(g, -0.08, 2.7, z, 1.66, 0.105, 0.08, 0x414b4e, 0.025);
  for (let x = -0.81; x <= 0.71; x += 0.25)
    rounded(g, x, 2.7, 0, 0.065, 0.09, 1.56, 0x414b4e, 0.017);
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
  for (const z of [-0.748, 0.748]) {
    grille(g, -0.86, 0.77, z, 0.6, 0.32);
    box(g, -0.36, 0.74, z, 0.018, 0.39, 0.025, 0x725a23);
    box(g, -0.22, 0.96, z, 0.16, 0.029, 0.034, 0x303c38);
    box(g, -0.14, 0.45, z, 0.7, 0.12, 0.12, 0x4a5450);
    tube(
      g,
      [
        new THREE.Vector3(0.48, 1.02, z),
        new THREE.Vector3(0.48, 1.41, z),
        new THREE.Vector3(0.26, 1.48, z),
      ],
      0.02,
      0x303b37,
    );
  }
  for (const z of [-0.82, 0.82]) {
    const guard = new THREE.Mesh(
      new THREE.TorusGeometry(0.466, 0.045, 6, 16, Math.PI),
      material(0xba8925, 0.82, 0.12),
    );
    guard.position.set(0.78, 0.41, z);
    guard.scale.z = 3;
    guard.castShadow = guard.receiveShadow = true;
    g.add(guard);
  }
  for (const z of [-0.16, 0.16]) {
    box(g, 1.15, 1.57, z, 0.028, 2.56, 0.022, 0x293331);
    for (let y = 0.34; y < 2.85; y += 0.115) box(g, 1.168, y, z, 0.023, 0.022, 0.039, 0x8a9591);
  }
  rounded(g, 0.47, 2.53, -0.7, 0.15, 0.12, 0.22, 0x2b3634, 0.025);
  box(g, 0.553, 2.53, -0.7, 0.017, 0.07, 0.15, 0xe3e0ce);
  rounded(g, -1.42, 1.18, 0, 0.28, 0.08, 0.51, 0xd6a329, 0.025);
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
  // The tail wraps around the slew deck; engine cover, service doors and cab are distinct assemblies.
  rounded(upper, -0.6, 0.18, 0, 2.44, 0.33, 1.98, 0x424b48, 0.11);
  rounded(upper, -0.92, 0.62, -0.31, 1.49, 1.03, 1.35, yellow, 0.2);
  rounded(upper, -1.3, 0.53, 0, 0.54, 1.02, 1.9, 0xd2a02c, 0.2);
  rounded(upper, -0.72, 1.16, -0.32, 0.99, 0.13, 1.12, 0x505950, 0.045);
  for (let x = -1.11; x < -0.3; x += 0.105)
    box(upper, x, 1.231, -0.33, 0.048, 0.012, 0.73, 0x262e2c);
  for (const z of [-0.991, 0.991]) {
    rounded(upper, -1.22, 0.56, z, 0.38, 0.7, 0.025, 0xc18c24, 0.02);
    box(upper, -1.03, 0.56, z + Math.sign(z) * 0.013, 0.012, 0.62, 0.018, 0x6b602d);
    box(upper, -1.3, 0.69, z + Math.sign(z) * 0.02, 0.1, 0.028, 0.028, 0x3a4440);
    box(upper, -1.38, 0.3, z + Math.sign(z) * 0.02, 0.14, 0.045, 0.015, 0xe5c564);
  }
  grille(upper, -0.65, 0.69, -1.003, 0.74, 0.61);
  // Chamfered, forward-raked cab. The dark lower door panel gives the glazing a real frame.
  const outline: [number, number][] = [
    [-0.4, 0.29],
    [0.88, 0.29],
    [0.99, 0.69],
    [0.85, 1.85],
    [0.65, 2.06],
    [-0.31, 2.06],
    [-0.43, 1.87],
  ];
  const window: [number, number][] = [
    [-0.315, 0.96],
    [0.813, 0.96],
    [0.732, 1.805],
    [0.57, 1.941],
    [-0.28, 1.941],
  ];
  for (const z of [0.026, 1.01]) {
    profile(upper, outline, 0.062, 0x384441, z, 0.025, window);
    const pane = profile(upper, window, 0.013, 0x769599, z + (z > 0.5 ? 0.039 : -0.039), 0);
    pane.material = glass;
    pane.castShadow = false;
    box(upper, -0.2, 1.44, z + (z > 0.5 ? 0.05 : -0.05), 0.039, 1.025, 0.022, 0x2c3735);
    box(upper, 0.41, 0.82, z + (z > 0.5 ? 0.05 : -0.05), 0.18, 0.035, 0.028, 0x9da69a);
    profile(
      upper,
      [
        [-0.31, 0.37],
        [0.79, 0.37],
        [0.86, 0.68],
        [0.81, 0.84],
        [-0.31, 0.84],
      ],
      0.021,
      0xc69729,
      z + (z > 0.5 ? 0.055 : -0.055),
      0.009,
    );
  }
  const windscreen = windowPane(upper, 0.844, 1.42, 0.52, 0.024, 1.09, 0.875);
  windscreen.rotation.z = 0.115;
  beam(
    upper,
    new THREE.Vector3(0.901, 0.93, 0.52),
    new THREE.Vector3(0.795, 1.57, 0.62),
    0.023,
    0x202b2b,
  );
  windowPane(upper, -0.421, 1.52, 0.52, 0.021, 0.86, 0.87);
  rounded(upper, 0.17, 2.075, 0.52, 1.34, 0.115, 1.1, 0xd9b33d, 0.065);
  rounded(upper, 0.85, 0.55, 0.52, 0.2, 0.39, 0.91, 0x49534b, 0.06);
  box(upper, 0.02, 0.94, 0.52, 0.49, 0.1, 0.5, 0x283335);
  rounded(upper, -0.22, 1.17, 0.52, 0.1, 0.48, 0.5, 0x283335, 0.035);
  for (const z of [0.2, 0.83]) {
    const lever = cylinder(upper, 0.33, 1.17, z, 0.027, 0.25, 0x3a4546, 8);
    lever.rotation.z = -0.2;
    cylinder(upper, 0.36, 1.31, z, 0.048, 0.045, 0x242e30, 10);
  }
  driver(upper, 0.04, 0.1, 0.52).visible = false;
  cylinder(upper, -0.95, 1.52, -0.65, 0.043, 0.63, steel, 10);
  cylinder(upper, -0.95, 1.23, -0.65, 0.09, 0.19, 0x3d4844, 12);
  for (const z of [0.12, 0.88]) {
    rounded(upper, 0.71, 2.025, z, 0.13, 0.1, 0.17, 0x273633, 0.018);
    box(upper, 0.781, 2.025, z, 0.015, 0.057, 0.119, 0xe2dfc9);
  }
  tube(
    upper,
    [
      new THREE.Vector3(-0.49, 0.25, 1.08),
      new THREE.Vector3(-0.49, 1.25, 1.08),
      new THREE.Vector3(-0.22, 1.36, 1.08),
    ],
    0.022,
    0x303b36,
  );
  box(upper, 0.16, 0.17, 1.04, 0.83, 0.08, 0.17, 0x606963);
  const boom = new THREE.Group();
  boom.name = 'boom-system';
  upper.add(boom);
  boomMember(boom, 'boom-link', 0.63, yellow);
  boomMember(boom, 'stick-link', 0.59, 0xd5a32d);
  hydraulic(boom, 'hydraulic-a');
  hydraulic(boom, 'hydraulic-b');
  pivot(boom, 'boom-base-pin', 0.17, 0.54);
  pivot(boom, 'boom-elbow-pin', 0.145, 0.47);
  pivot(boom, 'bucket-pin', 0.115, 0.4);
  const hook = new THREE.Group();
  hook.name = 'tool-tip';
  boom.add(hook);
  const bucket = new THREE.Group();
  bucket.name = 'bucket';
  hook.add(bucket);
  // Curved bucket cheeks and folded shell leave the mouth visibly open.
  const cheek: [number, number][] = [
    [-0.3, 0.06],
    [-0.37, -0.14],
    [-0.24, -0.39],
    [0.35, -0.42],
    [0.53, -0.32],
    [0.12, -0.25],
    [-0.1, -0.02],
  ];
  for (const z of [-0.39, 0.39]) profile(bucket, cheek, 0.055, 0x565d58, z, 0.013);
  const shell = [
    [-0.32, -0.015],
    [-0.335, -0.17],
    [-0.22, -0.35],
    [0.12, -0.39],
    [0.38, -0.37],
  ];
  for (let i = 1; i < shell.length; i++) {
    const [ax, ay] = shell[i - 1],
      [bx, by] = shell[i];
    const plate = box(
      bucket,
      (ax + bx) / 2,
      (ay + by) / 2,
      0,
      Math.hypot(bx - ax, by - ay),
      0.05,
      0.77,
      0x636960,
      0.3,
    );
    plate.rotation.z = Math.atan2(by - ay, bx - ax);
  }
  for (const z of [-0.28, 0, 0.28]) {
    const tooth = profile(
      bucket,
      [
        [0.35, -0.34],
        [0.62, -0.38],
        [0.52, -0.43],
        [0.34, -0.42],
      ],
      0.1,
      0xa2a697,
      z,
      0.006,
    );
    tooth.name = 'bucket-tooth';
  }
  rounded(bucket, -0.09, 0.015, 0, 0.28, 0.17, 0.29, 0x454f4b, 0.025);
  const curl = pivot(bucket, 'bucket-coupler', 0.08, 0.42);
  curl.position.set(-0.11, 0.04, 0);
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
  system.getObjectByName('boom-base-pin')!.position.copy(a);
  system.getObjectByName('boom-elbow-pin')!.position.copy(b);
  system.getObjectByName('bucket-pin')!.position.copy(c);
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
  rounded(g, 0.55, 0.91, 0, 2.05, 0.44, 1.21, 0x3a4542, 0.06);
  for (const z of [-0.858, 0.858]) {
    for (const x of [-0.45, 0.65, 1.75, 2.85]) {
      box(g, x, 1.89, z, 0.015, 0.67, 0.026, 0x293b33);
      box(g, x + 0.11, 2.02, z, 0.018, 0.15, 0.03, 0xb3bcac);
    }
    rounded(g, 3.27, 2.18, z, 0.15, 1.02, 0.03, 0x3a5045, 0.02);
  }
  for (const x of [-2.5, 2.5])
    for (const z of [-1.065, 1.065]) rounded(g, x, 0.82, z, 0.5, 0.3, 0.2, 0x48524d, 0.035);
  for (const x of [-3.44, -1.06])
    for (const z of [-0.72, 0.72]) {
      box(g, x, 2.96, z, 0.026, 0.73, 0.026, 0x33433c);
      const wipe = box(g, x + Math.sign(x) * 0.021, 2.77, z, 0.035, 0.43, 0.021, 0x242f2d);
      wipe.rotation.x = 0.24;
    }
  cylinder(g, 0.45, 3.35, 0, 0.12, 0.04, 0x3c4842, 12);
  rounded(g, -2.25, 3.64, 0, 0.95, 0.095, 0.79, 0x526157, 0.04);
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
  for (let x = -7; x <= 7; x += 2) {
    box(g, x, 0.88, 0, 0.14, 0.17, 2.4, 0x46514d);
    for (const z of [-1.335, 1.335]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.017, 5, 10, Math.PI),
        material(0x969b8b, 0.8, 0.35),
      );
      ring.position.set(x, 1.2, z);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
  }
  const tank = cylinder(g, -1.9, 0.72, 0, 0.2, 1.07, 0x58615a, 12);
  tank.rotation.x = Math.PI / 2;
  box(g, 0.9, 0.77, 0, 3.6, 0.065, 0.085, 0x3e4b45);
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
  const paint = bus ? 0xcbd1ca : 0xd6d8cc;
  rounded(g, front, 1.05, 0, 2.5, 1.03, 2.4, paint, 0.15);
  rounded(g, front, bus ? 2.82 : 2.71, 0, 2.57, 0.15, 2.43, bus ? 0xdfe3db : paint, 0.075);
  for (const x of [front - 1.17, front + 1.17])
    for (const z of [-1.14, 1.14])
      box(g, x, bus ? 2.13 : 2.08, z, 0.11, bus ? 1.29 : 1.18, 0.11, paint);
  box(g, front - 1.18, 2.06, 0, 0.12, 1.14, 2.36, paint);
  box(g, front + 0.78, 1.57, 0, 0.76, 0.15, 2.22, 0x41504e);
  const frontGlass = windowPane(g, front + 1.187, 2.11, 0, 0.027, 1.02, 2.15);
  frontGlass.rotation.z = 0.115;
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
    for (const z of [-1.19, 1.19]) box(g, 1.9, 1.94, z, 0.145, 1.72, 0.08, paint);
    rounded(g, 1.9, 2.82, 0, 0.2, 0.16, 2.42, 0xdfe3db, 0.025);
    rounded(g, -1.24, 1.16, 0, 6.25, 1.28, 2.4, 0xcbd1ca, 0.12);
    rounded(g, -1.24, 2.82, 0, 6.25, 0.16, 2.4, 0xdfe3db, 0.075);
    box(g, -4.31, 2.19, 0, 0.12, 1.12, 2.36, 0xcbd1ca);
    for (let x = -4.28; x < 1.9; x += 1.02)
      for (const z of [-1.16, 1.16]) box(g, x, 2.21, z, 0.075, 1.08, 0.075, 0x47534e);
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
  for (const z of [-1.04, 1.04]) {
    const tank = cylinder(g, low ? 2.23 : 0.92, 0.7, z, 0.24, 1.02, 0x8c9690, 14);
    tank.rotation.z = Math.PI / 2;
    for (const x of [front - 0.89, front - 0.45]) box(g, x, 0.44, z, 0.31, 0.07, 0.28, 0x515c57);
    for (const x of [rear, rear + (!bus ? 1.14 : 0)]) {
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry((low ? 0.33 : 0.5) + 0.075, 0.038, 6, 16, Math.PI),
        material(0x4b5550, 0.87, 0.08),
      );
      arch.position.set(x, low ? 0.33 : 0.5, z);
      arch.scale.z = 3.5;
      arch.castShadow = arch.receiveShadow = true;
      g.add(arch);
    }
    box(g, rear - 0.58, 0.43, z, 0.055, 0.55, 0.3, 0x323b37);
  }
  for (let x = low ? -4.9 : -4.1; x < 1.3; x += 1.25)
    for (const z of [-1.32, 1.32]) box(g, x, 0.87, z, 0.17, 0.045, 0.025, 0xdda645);
  if (bus) {
    rounded(g, -1.62, 2.96, 0, 1.42, 0.18, 1.16, 0xd5d7cd, 0.09);
    grille(g, -1.62, 2.975, 0.594, 1.12, 0.12);
    for (const x of [-3.15, 0.03]) {
      rounded(g, x, 2.934, 0, 0.69, 0.045, 0.83, 0x85928c, 0.025);
      box(g, x, 2.96, 0, 0.58, 0.012, 0.72, 0x3c504f);
    }
    for (const z of [-1.238, 1.238]) {
      box(g, -1.65, 1.62, z, 4.95, 0.025, 0.013, 0x707e74);
      for (const x of [-3.67, -1.94, -0.23]) box(g, x, 1.23, z, 0.014, 0.52, 0.017, 0x8e9a89);
      grille(g, -3.48, 1.1, z, 0.91, 0.4);
    }
    rounded(g, -4.38, 2.1, 0, 0.09, 1.04, 2.27, 0x3a4b49, 0.04);
    windowPane(g, -4.434, 2.17, 0, 0.016, 0.78, 1.98);
  } else {
    for (const z of [-1.236, 1.236]) {
      box(g, front - 0.86, 1.84, z, 0.021, 1.07, 0.015, 0x829089);
      rounded(g, front + 0.24, 1.59, z, 0.27, 0.043, 0.032, 0x303d38, 0.012);
      box(g, front - 0.07, 1.21, z, 1.27, 0.027, 0.022, 0xa8afa1);
    }
    if (service) {
      for (const z of [-1.24, 1.24]) {
        for (const x of [-2.75, -1.05, 0.65]) box(g, x, 1.63, z, 0.018, 1.55, 0.024, 0x809383);
        box(g, -1.05, 2.3, z, 4.92, 0.08, 0.028, 0x597d74);
      }
      rounded(g, -1.1, 2.91, 0, 4.74, 0.11, 2.01, 0xaab8a6, 0.035);
      for (const x of [-2.9, 0.66]) cylinder(g, x, 3.04, 0.82, 0.075, 0.14, 0xe2a232, 10);
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
