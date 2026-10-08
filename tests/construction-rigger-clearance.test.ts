import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { equipmentBoxes, personTouchesBox, staticObstacleRects, walkRoute } from '../src/traffic';
import { checkScenarioFuel, seedHandlingResources } from './support/yard';

function fixture() {
  const s = S.createState();
  const e = seedHandlingResources(s, 'excavator');
  const [operator, worker] = s.workers;
  const j = S.plan(s, 'slab', 12, 49).job!;
  const source = {
    id: S.id(s, 'stack'), item: 'slab' as const, qty: 3, reserved: 0,
    x: 35, z: 49, w: 1, d: 1, source: 'opening', yaw: Math.PI,
  };
  s.stacks.push(source);
  for (const [item, x, z, w, d, qty] of [
    ['slab', 36, 49, 1, 1, 12], ['slab', 37, 49, 1, 1, 12],
    ['shed', 31, 48, 4, 2, 1], ['store', 38, 47, 4, 3, 1],
    ['lamp', 42, 49, 4, 1, 3], ['lamp', 46, 49, 4, 1, 1],
    ['rail', 42, 46, 5, 3, 5],
  ] as const) s.stacks.push({ id: S.id(s, 'stack'), item, x, z, w, d, qty, reserved: 0, source: 'opening' });
  // A saved real pickup had mutually blocked paths: the worker's old escape
  // crosses the excavator's turn while the machine backs away from its stack.
  Object.assign(e, {
    x: 35.508, z: 45.397791839712696, yaw: -174.80839227423354,
    reach: 4, lift: .97, reverse: false, cargo: { item: 'slab', qty: 1, yaw: 2.6915926535897654 },
    operator: operator.id, job: j.id, blockedBy: worker.id, trafficWait: 2,
    path: [
      { x: 36.75, z: 45.397791839712696 },
      { x: 38, z: 44.147791839712696 },
      { x: 39.25, z: 42.897791839712696 },
      { x: 40.5, z: 41.647791839712696 },
      { x: 40.5, z: 44.1 },
      { x: 35.5, z: 44.1 },
    ],
  });
  Object.assign(operator, { x: e.x, z: e.z, vehicle: e.id, job: j.id });
  Object.assign(worker, {
    x: 37.34350288425444, z: 47.003603896932084, job: j.id,
    blockedBy: e.id, trafficWait: 2, status: 'Stepping clear of moving equipment',
    path: [
      { x: 37.34350288425444, z: 43.15649711574556 },
      { x: 33.84350288425444, z: 43.15649711574556 },
      { x: 33.84350288425444, z: 44.65649711574556 },
      { x: 30.34350288425444, z: 48.15649711574556 },
      { x: 30.34350288425444, z: 50.15649711574556 },
      { x: 30.84350288425444, z: 50.65649711574556 },
      { x: 34.84350288425444, z: 50.65649711574556 },
      { x: 35.5, z: 50.891791839712695 },
    ],
  });
  Object.assign(j, {
    status: 'doing', phase: 'Back clear of slab stack', equipment: e.id,
    worker: worker.id, operator: operator.id,
    handling: {
      phase: 'clear', clock: 0, state: 'carried',
      pose: { x: 37.24786213644498, z: 48.999580249123376, y: .97, yaw: 2.6915926535897654 },
      source: { x: 35.5, z: 49.5, y: .62, yaw: Math.PI }, sourceId: source.id,
      sourceDock: { x: 35.5, z: 45.5 }, sourceApproach: { x: 35.5, z: 45.5 },
      sourceClear: { x: 35.5, z: 44.1 },
      destinationDock: { x: 12.5, z: 45.5 }, destinationClear: { x: 12.5, z: 44.1 },
      reach: 4, yawOffset: 177.4999849278233, toolLift: 1.79, toolReach: 4,
      from: { x: 35.5, z: 49.5, y: .97, yaw: Math.PI },
    },
  });
  return { s, machineId: e.id, workerId: worker.id, jobId: j.id, sourceId: source.id };
}

test('an excavator reroutes its mutually blocked rigger and physically withdraws its slab across reload', () => {
  const f = fixture();
  let s = S.load(S.save(f.s));
  const initialWorker = s.workers.find((w) => w.id === f.workerId)!;
  const exit = { x: 41.39551484484146, z: 45.046258993431486 };
  const obstacles = staticObstacleRects(s);
  assert.equal(walkRoute(s, initialWorker, exit, obstacles), null, 'The coarse grid cannot resolve this diagonal pocket');
  assert.ok(walkRoute(s, initialWorker, exit, obstacles, false, .2)?.length, 'Checked finer steps find its real walking exit');
  const oldPath = JSON.stringify(initialWorker.path);
  let reloaded = false;
  let workerWalked = false;
  for (let t = 0; t < 90; t += .1) {
    const e = s.equipment.find((e) => e.id === f.machineId)!;
    const w = s.workers.find((w) => w.id === f.workerId)!;
    const beforeMachine = { x: e.x, z: e.z }, beforeWorker = { x: w.x, z: w.z };
    S.tick(s, .1);
    assert.ok(Math.hypot(e.x - beforeMachine.x, e.z - beforeMachine.z) < .3, 'The machine must drive continuously');
    assert.ok(Math.hypot(w.x - beforeWorker.x, w.z - beforeWorker.z) < .3, 'The worker must walk continuously');
    assert.ok(equipmentBoxes(e).every((box) => !personTouchesBox(w, box, .2)), 'The rigger stays outside the chassis, boom and suspended slab');
    checkScenarioFuel(s);
    assert.equal(s.stacks.find((t) => t.id === f.sourceId)!.qty + (e.cargo?.qty || 0), 4);
    if (Math.hypot(w.x - 37.34350288425444, w.z - 47.003603896932084) > .5) workerWalked = true;
    if (!reloaded && JSON.stringify(w.path) !== oldPath) {
      assert.equal(w.yieldingTo, e.id, 'Construction retains its accepted worker escape');
      s = S.load(S.save(s));
      assert.equal(s.workers.find((w) => w.id === f.workerId)!.yieldingTo, e.id);
      reloaded = true;
    }
    if (s.jobs.find((j) => j.id === f.jobId)!.handling!.phase !== 'clear') break;
  }
  const e = s.equipment.find((e) => e.id === f.machineId)!;
  assert.ok(reloaded && workerWalked, 'A replacement escape route must remain physical and survive reload');
  assert.equal(s.jobs.find((j) => j.id === f.jobId)!.handling!.phase, 'carry');
  assert.equal(e.cargo?.item, 'slab');
  assert.equal(e.cargo.qty, 1);
  assert.ok(e.used > 0 && e.fuel < e.tank);
});


test('an empty excavator keeps its checked approach moving while its own crew walks clear', () => {
  const f = fixture();
  const s = f.s, e = s.equipment.find((e) => e.id === f.machineId)!;
  const w = s.workers.find((w) => w.id === f.workerId)!;
  const j = s.jobs.find((j) => j.id === f.jobId)!;
  Object.assign(e, {
    x: 20, z: 30, yaw: 0, reach: 2.1, lift: 2, cargo: undefined,
    path: [{ x: 25, z: 30 }], blockedBy: undefined, trafficWait: 0,
  });
  Object.assign(w, {
    x: 30, z: 40, path: [{ x: 34, z: 40 }], yieldingTo: e.id,
    yieldTarget: { x: 35, z: 40 }, blockedBy: undefined, trafficWait: 0,
  });
  j.phase = 'Face slab storage';
  j.handling!.phase = 'approach';
  j.handling!.state = 'stored';
  S.tick(s, .1);
  assert.ok(e.x > 20, 'Ordinary approach can advance alongside its physically separate walking crew');
  assert.ok(w.x > 30, 'The worker also continues walking');
  assert.equal(w.yieldingTo, undefined, 'Normal approach retains its prior yield ownership behavior');
  checkScenarioFuel(s);
});
