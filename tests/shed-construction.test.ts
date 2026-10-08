import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources } from './support/yard';
import {
  equipmentBoxes,
  personTouchesBox,
  staticObstacleRects,
  workerMoveBlocked,
} from '../src/traffic';
import { equipmentCanDoJob, setJobEquipment } from '../src/jobs';
import { shedPostPoints } from '../src/shed-geometry';
import type { State } from '../src/types';

function yard(rotation = 0) {
  const s = S.createState();
  seedHandlingResources(s, 'excavator');
  s.stacks.push({
    id: 'TEST-SHED-KIT',
    item: 'shed',
    qty: 1,
    reserved: 0,
    x: 24,
    z: 32,
    w: 4,
    d: 2,
    source: 'opening',
  });
  for (let x = 45; x < 45 + (rotation ? 6 : 8); x++)
    for (let z = 35; z < 35 + (rotation ? 8 : 6); z++) s.paving[`${x},${z}`] = 'EXISTING';
  assert.equal(S.plan(s, 'shed', 45, 35, rotation).error, '');
  return s;
}
function step(s: State, predicate: () => boolean, limit = 1500) {
  for (let t = 0; t < limit && !predicate(); t += 0.1) S.tick(s, 0.1);
  assert.ok(predicate(), JSON.stringify({ jobs: s.jobs, e: s.equipment, w: s.workers }));
}
function balanced(s: State) {
  const t = S.totals(s, 'shed');
  assert.equal(t.stored + t.cargo + t.inConstruction + t.installed, 1, JSON.stringify(t));
}

test('shed construction stages a real kit and erects anchors, columns, frames, roof and wall with saved physical crew', () => {
  let s = yard();
  step(s, () => s.jobs[0].shedAssembly?.phase === 'anchor');
  assert.equal(s.buildings.filter((b) => b.kind === 'shed').length, 0);
  assert.equal(s.equipment[0].cargo, undefined);
  assert.equal(S.totals(s, 'shed').inConstruction, 1);
  const stages = new Set<string>();
  let reloads = 0;
  let lastTotal = 0;
  let sawLadder = false;
  for (let t = 0; t < 1500 && s.jobs[0].status !== 'done'; t += 0.1) {
    S.tick(s, 0.1);
    balanced(s);
    const machine = s.equipment[0];
    if (machine.assemblyLoad && machine.path.length) {
      const load = equipmentBoxes(machine).at(-1)!;
      for (const person of s.workers.filter((w) => !w.vehicle))
        assert.equal(
          personTouchesBox(person, load, 0.4),
          false,
          JSON.stringify({
            phase: s.jobs[0].shedAssembly?.phase,
            part: s.jobs[0].shedAssembly?.part,
            machine,
            person,
            load,
          }),
        );
    }
    const j = s.jobs[0],
      h = j.shedAssembly!;
    if (h.ladder) {
      const worker = s.workers.find((w) => w.id === j.worker)!;
      if ((worker.y || 0) > 1) {
        sawLadder = true;
        assert.ok(Math.hypot(worker.x - h.ladder.x, worker.z - h.ladder.z) < 0.01);
      }
    }
    stages.add(h.phase + (h.part ? ':' + h.part.kind : ''));
    const total = h.anchors + h.posts + h.beams + h.roofSheets + h.wallPanels + h.braces;
    assert.ok(total >= lastTotal && total <= lastTotal + 1);
    lastTotal = total;
    if (h.phase === 'lift' && h.clock >= 1 && reloads < 2) {
      s = S.load(S.save(s));
      reloads++;
    }
    if (j.status !== 'done') assert.equal(s.buildings.filter((b) => b.kind === 'shed').length, 0);
  }
  assert.equal(
    s.jobs[0].status,
    'done',
    JSON.stringify({ jobs: s.jobs, e: s.equipment, w: s.workers }),
  );
  assert.equal(s.buildings.filter((b) => b.kind === 'shed').length, 1);
  assert.equal(reloads, 2);
  assert.ok(sawLadder, 'High shed fastening needs a real climb on the kit assembly ladder');
  assert.ok(
    s.workers.every((w) => (w.y || 0) === 0),
    'Crew descends before the completed job releases them',
  );
  for (const kind of ['post', 'beam', 'roof', 'wall', 'brace'])
    assert.ok(stages.has('lift:' + kind));
  assert.deepEqual(
    [
      s.jobs[0].shedAssembly!.anchors,
      s.jobs[0].shedAssembly!.posts,
      s.jobs[0].shedAssembly!.beams,
      s.jobs[0].shedAssembly!.roofSheets,
      s.jobs[0].shedAssembly!.wallPanels,
      s.jobs[0].shedAssembly!.braces,
    ],
    [6, 6, 3, 4, 2, 1],
  );
  assert.equal(s.movements.filter((m) => m.reason === 'Shed kit unpacked at site').length, 1);
  assert.equal(s.stacks[0].qty, 0);
  balanced(s);
});

test('cardinally rotated shed assembly preserves all component geometry and kit ownership', () => {
  const s = yard(1);
  step(s, () => s.jobs[0].status === 'done');
  balanced(s);
  assert.deepEqual([s.buildings.find((b) => b.kind === 'shed')!.w, s.buildings.find((b) => b.kind === 'shed')!.d, s.buildings.find((b) => b.kind === 'shed')!.rotation], [6, 8, 1]);
  const points = shedPostPoints(s.jobs[0]);
  for (const point of points)
    assert.ok(
      staticObstacleRects(s).some(
        (r) =>
          r.id === s.buildings.find((b) => b.kind === 'shed')!.id &&
          Math.abs(r.x + 0.2 - point.x) < 0.01 &&
          Math.abs(r.z + 0.2 - point.z) < 0.01,
      ),
    );
});

test('a forklift can receive the packed shed kit but shed erection requires an excavator', () => {
  const s = yard(),
    e = s.equipment[0];
  e.kind = 'forklift';
  e.fuel = e.tank = 45;
  assert.equal(equipmentCanDoJob(e, s.jobs[0]), false);
  assert.match(setJobEquipment(s, s.jobs[0].id, e.id), /shed erection requires an excavator/);
  for (let t = 0; t < 10; t += 0.1) S.tick(s, 0.1);
  assert.equal(s.jobs[0].status, 'todo');
  assert.match(s.jobs[0].reason, /excavator/);
  assert.equal(s.stacks[0].qty, 1);
  assert.equal(e.cargo, undefined);
  balanced(s);
});

test('older active forklift shed trips stage their kit as real stock instead of revealing a building', () => {
  let s = yard();
  step(s, () => s.jobs[0].phase === 'Carry to site');
  // Imported older versions allowed a forklift to claim this entire task.
  const e = s.equipment[0];
  e.kind = 'forklift';
  e.fuel = e.tank = 45;
  s = S.load(S.save(s));
  step(
    s,
    () => s.jobs[0].status === 'todo' && s.jobs[0].phase === 'Waiting for excavator erection',
  );
  assert.equal(s.buildings.filter((b) => b.kind === 'shed').length, 0);
  assert.equal(s.jobs[0].delivered, false);
  assert.equal(s.jobs[0].shedAssembly, undefined);
  assert.equal(s.equipment[0].cargo, undefined);
  assert.equal(s.stacks.filter((t) => t.item === 'shed' && t.qty > 0).length, 1);
  balanced(s);
  assert.equal(
    s.movements.filter((m) => m.reason === 'Legacy forklift staged shed kit for erection').length,
    1,
  );
});

test('canceling a carried roof section first sets it down safely then physically recovers the shed', () => {
  let s = yard();
  step(
    s,
    () =>
      s.jobs[0].shedAssembly?.part?.kind === 'roof' && s.jobs[0].shedAssembly?.phase === 'carry',
  );
  const j = s.jobs[0];
  S.cancelJob(s, j.id);
  s = S.load(S.save(s));
  step(s, () => s.jobs[0].status === 'canceled');
  assert.equal(s.buildings.filter((b) => b.kind === 'shed').length, 0);
  assert.equal(s.equipment[0].assemblyLoad, undefined);
  assert.equal(s.jobs[0].shedAssembly?.posts, 0);
  assert.equal(s.jobs[0].shedAssembly?.roofSheets, 0);
  balanced(s);
});

test('partially erected shed cancellation reverses physical assembly and preserves its whole kit', () => {
  let s = yard();
  step(s, () => !!s.jobs[0].shedAssembly && s.jobs[0].shedAssembly!.posts >= 2);
  const j = s.jobs[0];
  const point = shedPostPoints(j)[0];
  assert.ok(
    staticObstacleRects(s).some(
      (r) => r.id === j.id + '-post' && Math.abs(r.x + 0.2 - point.x) < 0.01,
    ),
  );
  assert.equal(
    workerMoveBlocked(s, { x: point.x - 1, z: point.z }, { x: point.x, z: point.z }),
    j.id + '-post',
  );
  S.cancelJob(s, j.id);
  s = S.load(S.save(s));
  step(s, () => s.jobs[0].status === 'canceled');
  assert.equal(s.buildings.filter((b) => b.kind === 'shed').length, 0);
  assert.equal(S.totals(s, 'shed').stored, 1);
  assert.equal(S.totals(s, 'shed').inConstruction, 0);
  assert.equal(s.jobs[0].shedAssembly!.posts, 0);
  assert.equal(s.jobs[0].shedAssembly!.anchors, 0);
  assert.equal(s.equipment[0].job, undefined);
  balanced(s);
});

test('save import rejects damaged staged shed counts and missing component ownership', () => {
  const s = yard();
  step(s, () => s.jobs[0].shedAssembly?.phase === 'anchor');
  const damaged = JSON.parse(S.save(s));
  damaged.jobs[0].shedAssembly.posts = 7;
  assert.throws(() => S.load(JSON.stringify(damaged)), /Invalid save/);
  const broken = JSON.parse(S.save(s));
  broken.jobs[0].delivered = false;
  assert.throws(() => S.load(JSON.stringify(broken)), /Invalid save/);
});
