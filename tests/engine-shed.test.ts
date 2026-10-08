import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import type { State } from '../src/types';
import { railFootprint, trackGeometry, type TrackPiece } from '../src/track';
import {
  engineShedPlacementError,
  engineShedParkingLocation,
  assignEngineShedParking,
} from '../src/engine-shed';
import { orderShunter, parkShunter } from '../src/rail-operations';
import { saveRailLocation } from '../src/rail-locations';
import { shedComponentPose, shedPartLimits } from '../src/shed-geometry';
import { staticObstacleRects } from '../src/traffic';
import { equipmentCanDoJob } from '../src/jobs';
import { seedHandlingResources, tickUntil } from './support/yard';
function install(s: State, piece: TrackPiece) {
  const rect = railFootprint(piece),
    id = S.id(s, 'rail');
  s.rails.push({
    ...rect,
    id,
    rotation: piece.heading % 2,
    length: trackGeometry({ ...rect, id, rotation: 0, length: 5, track: piece }).length,
    track: piece,
    item: S.trackItem(piece),
  });
}
function yard() {
  const s = S.createState();
  for (let section = 0; section < 6; section++)
    install(s, { layout: 'curve', origin: { x: 125, z: 5 }, heading: 0, hand: 1, section });
  for (let z = 25; z < 60; z += 5)
    install(s, { layout: 'straight', origin: { x: 145, z }, heading: 1, hand: 1, section: 0 });
  return s;
}
const rect = { x: 142, z: 33, w: 6, d: 14 };
test('engine shed requires centered connected straight track and unobstructed drive-through doors', () => {
  const s = yard();
  assert.equal(engineShedPlacementError(s, rect, 0), '');
  assert.match(engineShedPlacementError(s, { ...rect, x: 141 }, 0), /Center/);
  assert.match(engineShedPlacementError(s, rect, 1), /Center/);
  s.buffers = [
    { id: 'STOP', x: 145, z: 40, y: 0.2, yaw: Math.PI / 2, secured: true, carried: false },
  ];
  assert.match(engineShedPlacementError(s, rect, 0), /buffer stop/);
  s.buffers = [];
  install(s, { layout: 'straight', origin: { x: 143, z: 35 }, heading: 1, hand: 1, section: 0 });
  assert.match(engineShedPlacementError(s, rect, 0), /parallel rails/);
});
test('creative engine shed preserves internal rails and creates saved named parking and component identities', () => {
  let s = yard();
  s.creative = true;
  const tracks = s.rails.length;
  assert.equal(S.plan(s, 'engineShed', rect.x, rect.z).error, '');
  assert.equal(s.rails.length, tracks);
  const b = s.buildings.at(-1)!;
  assert.equal(b.kind, 'engineShed');
  assert.equal(Object.keys(b.componentIds!).length, 29);
  const result = engineShedParkingLocation(s, b.id);
  assert.equal(result.error, '');
  assert.equal(result.location!.length, 14);
  assert.equal(result.location!.kind, 'parking');
  const obstacles = staticObstacleRects(s).filter((r) => r.id === b.id);
  assert.ok(obstacles.length >= 8);
  assert.ok(obstacles.every((r) => !(145 > r.x && 145 < r.x + r.w && 40 > r.z && 40 < r.z + r.d)));
  s = S.load(S.save(s));
  assert.equal(s.buildings.at(-1)!.parkingLocationId, b.parkingLocationId);
  assert.deepEqual(s.buildings.at(-1)!.componentIds, b.componentIds);
});
function constructionYard() {
  const s = yard();
  const e = seedHandlingResources(s, 'excavator');
  e.x = 136;
  e.z = 35;
  s.workers[0].x = 134;
  s.workers[0].z = 34;
  s.workers[1].x = 135;
  s.workers[1].z = 34;
  s.stacks.push({
    id: 'ENGINE-KIT',
    item: 'engineShed',
    qty: 1,
    reserved: 0,
    x: 128,
    z: 30,
    w: 4,
    d: 3,
    source: 'test',
  });
  for (let x = rect.x; x < rect.x + rect.w; x++)
    for (let z = rect.z; z < rect.z + rect.d; z++) s.paving[`${x},${z}`] = 'EXISTING';
  return s;
}
test('engine shed is physically erected from one delivered kit with recoverable saved partial construction', () => {
  let s = constructionYard();
  const e = s.equipment[0];
  const result = S.plan(s, 'engineShed', rect.x, rect.z);
  assert.equal(result.error, '');
  const jid = result.job!.id;
  assert.equal(equipmentCanDoJob({ ...e, kind: 'forklift' }, result.job!), false);
  tickUntil(s, () => !!s.jobs.find((j) => j.id === jid)!.shedAssembly, 800);
  assert.equal(s.buildings.filter((b) => b.kind === 'engineShed').length, 0);
  tickUntil(s, () => s.jobs.find((j) => j.id === jid)!.shedAssembly!.posts >= 1, 1400);
  const before = s.jobs.find((j) => j.id === jid)!.shedAssembly!;
  assert.ok(staticObstacleRects(s).some((r) => r.id === jid + '-post'));
  s = S.load(S.save(s));
  assert.deepEqual(
    s.jobs.find((j) => j.id === jid)!.shedAssembly!.componentIds,
    before.componentIds,
  );
  tickUntil(s, () => s.jobs.find((j) => j.id === jid)!.status === 'done', 2400);
  const b = s.buildings.find((b) => b.kind === 'engineShed')!;
  assert.equal(b.kind, 'engineShed');
  assert.ok(b.parkingLocationId);
  assert.equal(s.stacks[0].qty, 0);
  assert.equal(S.totals(s, 'engineShed').installed, 1);
  const h = s.jobs.find((j) => j.id === jid)!.shedAssembly!;
  assert.deepEqual(
    [h.anchors, h.posts, h.beams, h.roofSheets, h.wallPanels, h.braces],
    [6, 6, 3, 8, 6, 0],
  );
  assert.deepEqual(shedPartLimits(result.job!), { post: 6, beam: 3, roof: 8, wall: 6, brace: 0 });
  assert.ok(shedComponentPose(result.job!, 'wall', 4).y > 5);
});

test('canceling partial engine shed physically dismantles and repacks its original kit', () => {
  let s = constructionYard();
  const r = S.plan(s, 'engineShed', rect.x, rect.z);
  assert.equal(r.error, '');
  const jid = r.job!.id;
  tickUntil(s, () => s.jobs.find((j) => j.id === jid)!.shedAssembly?.posts === 2, 1200);
  const identity = s.jobs.find((j) => j.id === jid)!.assetId;
  S.cancelJob(s, jid);
  s = S.load(S.save(s));
  tickUntil(s, () => s.jobs.find((j) => j.id === jid)!.status === 'canceled', 1600);
  assert.equal(s.buildings.filter((b) => b.kind === 'engineShed').length, 0);
  assert.equal(S.totals(s, 'engineShed').stored, 1);
  const kit = s.stacks.find((t) => t.item === 'engineShed' && t.qty === 1)!;
  assert.equal(kit.assetId, identity);
  assert.equal(kit.w * kit.d, 12);
  assert.equal(s.jobs.find((j) => j.id === jid)!.shedAssembly!.posts, 0);
});
test('engine shed foundation jobs leave the two-cell internal track bed unpaved', () => {
  const s = yard(),
    r = S.plan(s, 'engineShed', rect.x, rect.z);
  assert.equal(r.error, '');
  const slabs = s.jobs.filter((j) => j.kind === 'slab');
  assert.equal(slabs.length, 56);
  assert.ok(slabs.every((j) => j.x !== 144 && j.x !== 145));
});

test('owned locomotive physically enters and exits its saved engine shed bay', () => {
  let s = yard();
  s.creative = true;
  s.buffers = [];
  assert.equal(S.plan(s, 'engineShed', rect.x, rect.z).error, '');
  const b = s.buildings.find((b) => b.kind === 'engineShed')!;
  seedHandlingResources(s, 'forklift');
  s.workers[0].railQualified = true;
  const ordered = orderShunter(s, { driverId: s.workers[0].id });
  assert.equal(ordered.error, undefined);
  // Opening rolling-stock fixture isolates shed entry/exit from supplier delivery.
  Object.assign(s.shunters![0], {
    phase: 'parked',
    x: 115,
    z: 5,
    yaw: 0,
    anchor: { trackId: 'BOOTSTRAP-SIDING', route: 'straight', offset: 90 },
  });
  const id = s.shunters![0].id;
  assert.equal(assignEngineShedParking(s, id, b.id), undefined);
  const e = s.shunters![0];
  assert.equal(e.parkingLocationId, b.parkingLocationId);
  assert.equal(e.shedId, b.id);
  let previous = { x: e.x, z: e.z };
  tickUntil(
    s,
    () => e.phase === 'parked',
    1200,
    () => {
      assert.ok(Math.hypot(e.x - previous.x, e.z - previous.z) < 0.5);
      previous = { x: e.x, z: e.z };
    },
  );
  assert.ok(Math.hypot(e.x - 145, e.z - 40) < 0.01);
  s = S.load(S.save(s));
  assert.equal(s.shunters![0].shedId, b.id);
  assert.equal(
    saveRailLocation(s, {
      name: 'Outside bay',
      kind: 'parking',
      trackId: 'BOOTSTRAP-SIDING',
      route: 'straight',
      offset: 65,
      length: 14,
    }),
    undefined,
  );
  const outside = s.railLocations!.at(-1)!;
  assert.equal(parkShunter(s, id, outside.id), undefined);
  tickUntil(s, () => s.shunters![0].phase === 'parked', 1200);
  assert.ok(Math.hypot(s.shunters![0].x - 90, s.shunters![0].z - 5) < 0.01);
  assert.equal(s.shunters![0].parkingLocationId, b.parkingLocationId);
});

test('engine shed import rejects corrupted physical component counts and identities', () => {
  const s = yard();
  s.creative = true;
  assert.equal(S.plan(s, 'engineShed', rect.x, rect.z).error, '');
  const bad = JSON.parse(S.save(s));
  bad.buildings.find((b: any) => b.kind === 'engineShed').componentIds['post/0'] = bad.buildings.find((b: any) => b.kind === 'engineShed').componentIds['post/1'];
  assert.throws(() => S.load(JSON.stringify(bad)), /Invalid save/);
});
