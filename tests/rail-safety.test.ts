import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { turnoutOccupant, turnoutWorkerPoint, turnoutLeverPose } from '../src/turnout-operation';
import {
  ownedRailActorBoxes,
  roadMoveBlocked,
  workerMoveBlocked,
  equipmentMoveBlocked,
  walkRoute,
  machineRoute,
  staticObstacleRects,
} from '../src/traffic';
import { seedHandlingResources } from './support/yard';
import type { State, RailShunter, RailMove } from '../src/types';
function shunter(s: State, x = 90, z = 5): RailShunter {
  const e: RailShunter = {
    id: 'SHUNTER-SAFETY',
    name: 'Safety test shunter',
    x,
    z,
    yaw: 0,
    phase: 'parked',
    status: 'Parked',
    fuel: 360,
    tank: 360,
    used: 0,
    eta: 0,
  };
  s.shunters = [e];
  return e;
}
function pointsFixture(worker = true) {
  const s = S.createState();
  s.creative = true;
  assert.equal(S.planSidingAccess(s).error, '');
  s.creative = false;
  const rail = s.rails.find((r) => r.track?.section === 0)!;
  if (worker) {
    const foot = turnoutWorkerPoint(rail),
      lever = turnoutLeverPose(rail);
    s.workers.push({
      id: 'WRK-SAFETY',
      name: 'Worker #1',
      role: 'builder',
      duty: 'auto',
      status: 'Available',
      hours: 0,
      wage: 28,
      ...foot,
      heading: 0,
      yaw: Math.atan2(lever.z - foot.z, lever.x - foot.x),
      path: [],
    });
  }
  return { s, rail };
}
const movement: RailMove = {
  points: [
    { x: 1, z: 1, yaw: 0 },
    { x: 2, z: 1, yaw: 0 },
  ],
  segments: [],
  tracks: [],
  switches: [],
  length: 1,
  distance: 0,
  end: 1,
  velocity: 0,
  clock: 0,
};

test('manual turnout refuses parked owned locomotives over its far tail, not just its points module', () => {
  const { s, rail } = pointsFixture();
  const e = shunter(s, 101, 10);
  assert.equal(turnoutOccupant(s, rail), e.id);
  assert.match(S.setTurnoutRoute(s, rail.id, 'branch'), /occupied.*SHUNTER-SAFETY/);
  assert.equal(s.jobs.filter((j) => j.kind === 'throwSwitch').length, 0);
  e.x = 120;
  assert.equal(turnoutOccupant(s, rail), undefined);
  assert.equal(S.setTurnoutRoute(s, rail.id, 'branch'), '');
});

test('a partly thrown manual lever pauses while detached cars occupy the switch and resumes after clearance', () => {
  const { s, rail } = pointsFixture();
  assert.equal(S.setTurnoutRoute(s, rail.id, 'branch'), '');
  for (let i = 0; i < 14; i++) S.tick(s, 0.1);
  const j = s.jobs.find((j) => j.kind === 'throwSwitch')!;
  assert.ok(j.elapsed > 0);
  S.purchaseBatch(s, [{ item: 'slab', qty: 8 }], 'rail');
  const o = s.orders[0];
  o.status = 'unloading';
  o.railFreight!.detached = true;
  o.railFreight!.locomotivePhase = 'gone';
  const car = o.railFreight!.cars[0];
  car.pose = { x: 90, z: 5, yaw: 0 };
  assert.equal(turnoutOccupant(s, rail), car.id);
  const elapsed = j.elapsed;
  for (let i = 0; i < 20; i++) S.tick(s, 0.1);
  assert.equal(j.elapsed, elapsed);
  assert.equal(rail.selectedRoute, undefined);
  assert.match(j.reason, /occupied/);
  car.pose = { x: 50, z: 5, yaw: 0 };
  for (let i = 0; i < 50 && j.status !== 'done'; i++) S.tick(s, 0.1);
  assert.equal(j.status, 'done');
  assert.equal(rail.selectedRoute, 'branch');
});

test('queued manual turnout waits if a reservation appears before the crew is assigned', () => {
  const { s, rail } = pointsFixture();
  assert.equal(S.setTurnoutRoute(s, rail.id, 'branch'), '');
  S.purchaseBatch(s, [{ item: 'slab', qty: 8 }], 'rail');
  const o = s.orders[0];
  o.railFreight!.incomingRailMove = { ...movement, tracks: [rail.id] };
  for (let i = 0; i < 6; i++) S.tick(s, 0.1);
  const j = s.jobs.find((j) => j.kind === 'throwSwitch')!;
  assert.equal(j.status, 'todo');
  assert.match(j.reason, /reserved/);
  assert.equal(s.workers[0].job, undefined);
});

test('incoming supplier carrier is blocked by parked shunters and mainline collection engines', () => {
  const s = S.createState();
  S.purchaseBatch(s, [{ item: 'slab', qty: 8 }], 'rail');
  const o = s.orders[0];
  o.status = 'approaching';
  o.drive = { distance: 170, yaw: 0 };
  const pose = { x: 55, z: 5, yaw: 0 },
    e = shunter(s, 55, 5);
  assert.equal(roadMoveBlocked(s, o, pose), e.id);
  e.phase = 'ordered';
  assert.equal(ownedRailActorBoxes(s).length, 0);
  s.railReturns = [
    {
      id: 'RETURN-SAFETY',
      locomotiveId: 'LOCO-SAFETY',
      orderIds: [],
      carIds: [],
      phase: 'collecting',
      status: 'Collecting',
      x: 55,
      z: 5,
      yaw: 0,
      movement,
      departure: movement,
      clock: 0,
    },
  ];
  assert.equal(roadMoveBlocked(s, o, pose), 'RETURN-SAFETY');
  s.railReturns[0].phase = 'done';
  assert.equal(roadMoveBlocked(s, o, pose), '');
});

test('workers and equipment cannot enter owned locomotive footprints, and can route around them', () => {
  const s = S.createState(),
    e = shunter(s, 50, 30),
    machine = seedHandlingResources(s, 'forklift');
  machine.x = 35;
  machine.z = 30;
  machine.yaw = 0;
  const worker = { id: 'WRK-WALK', x: 35, z: 30 };
  assert.equal(workerMoveBlocked(s, worker, { x: 50, z: 30 }), e.id);
  assert.equal(equipmentMoveBlocked(s, machine, { x: 50, z: 30, yaw: 0 }), e.id);
  const walk = walkRoute(s, worker, { x: 65, z: 30 }, staticObstacleRects(s));
  assert.ok(walk);
  assert.ok(walk.length > 1);
  const drive = machineRoute(s, machine, { x: 65, z: 30 }, staticObstacleRects(s));
  assert.ok(drive);
  assert.ok(drive.length > 1);
});

test('points may be thrown under locomotive nose overhang only when every axle remains clear', () => {
  const { s, rail } = pointsFixture();
  const e = shunter(s, 76.6, 5);
  e.bogies = [
    { x: 73.81, z: 5, yaw: 0 },
    { x: 79.39, z: 5, yaw: 0 },
  ];
  // The chassis reaches E80.9, but its wheels remain before the points E80.
  assert.equal(turnoutOccupant(s, rail), undefined);
  assert.equal(S.setTurnoutRoute(s, rail.id, 'branch'), '');
  e.bogies[1].x = 80.2;
  assert.equal(turnoutOccupant(s, rail), e.id);
  assert.match(S.setTurnoutRoute(s, rail.id, 'branch'), /occupied/);
  // Safe pointwork does not make chassis overhang passable to pedestrians.
  const w = s.workers[0];
  w.x = 83;
  w.z = 5;
  assert.equal(workerMoveBlocked(s, w, { x: 80.7, z: 5 }), e.id);
});
