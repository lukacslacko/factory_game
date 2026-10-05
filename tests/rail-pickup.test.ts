import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { MATERIALS } from '../src/catalog';
import { planRailPickup, railCrewStandingPoints, staticRailPickupFaces } from '../src/rail-pickup';
import { boxOverlap, equipmentBoxes, workerMoveBlocked } from '../src/traffic';
import { seedHandlingResources, tickUntil } from './support/yard';
import type { Item, Stack } from '../src/types';

function stock(
  s: ReturnType<typeof S.createState>,
  item: Item,
  x: number,
  z: number,
  qty = 1,
): Stack {
  const m = MATERIALS[item];
  const stack = {
    id: S.id(s, 'stack'),
    item,
    x,
    z,
    w: m.w,
    d: m.d,
    qty,
    reserved: 0,
    source: 'opening',
    ...(item === 'diesel' ? { liters: 200 } : {}),
  };
  s.stacks.push(stack);
  return stack;
}

test('a rigger can use a safe exposed mid-edge when the six old corner/end spots are obstructed', () => {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  const stack = stock(s, 'rail', 30, 29),
    worker = s.workers.find((w) => w.role === 'builder')!;
  const p = { x: stack.x + stack.w / 2, z: stack.z + stack.d / 2 },
    m = MATERIALS.rail;
  const oldPoints = [
    { x: p.x + m.w / 2 + 1, z: p.z },
    { x: p.x - m.w / 2 - 1, z: p.z },
  ];
  for (const sign of [-1, 1])
    for (const along of [-m.w / 2 + 0.55, m.w / 2 - 0.55])
      oldPoints.push({ x: p.x + along, z: p.z + sign * (m.d / 2 + 0.6) });
  for (const point of oldPoints) stock(s, 'diesel', Math.floor(point.x), Math.floor(point.z));
  assert(oldPoints.every((point) => workerMoveBlocked(s, worker, point)));
  const pickup = planRailPickup(s, e, worker, stack, 1, S.obstacles(s));
  assert(pickup.source, pickup.reason);
  assert(!workerMoveBlocked(s, worker, pickup.source.workerPoint));
  assert(
    railCrewStandingPoints(stack).some(
      (point) =>
        Math.hypot(point.x - pickup.source!.workerPoint.x, point.z - pickup.source!.workerPoint.z) <
        0.01,
    ),
  );
  assert(
    !oldPoints.some(
      (point) =>
        Math.hypot(point.x - pickup.source!.workerPoint.x, point.z - pickup.source!.workerPoint.z) <
        0.01,
    ),
  );
});

test('the shared pickup plan respects load mass and keeps a lower physical stack solid during withdrawal', () => {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator'),
    stack = stock(s, 'railCurve', 30, 29, 4);
  const worker = s.workers.find((w) => w.role === 'builder')!;
  assert(!planRailPickup(s, e, worker, stack, 4, S.obstacles(s)).source);
  const pickup = planRailPickup(s, e, worker, stack, 3, S.obstacles(s));
  assert(pickup.source, pickup.reason);
  assert.equal(pickup.source.pose.y, 0.36);
  assert(staticRailPickupFaces(s, stack, 'excavator', S.obstacles(s)).length > 0);
});

function obstructedFixture(alternative = true) {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  const source = stock(s, 'rail', 30, 29);
  const obstructions = [
    stock(s, 'railCurve', 29, 25),
    stock(s, 'railCurve', 29, 32),
    stock(s, 'railCurve', 23, 29),
    stock(s, 'diesel', 36, 29),
  ];
  const next = alternative ? stock(s, 'rail', 50, 45) : undefined;
  const job = S.plan(s, 'rail', 125, 4).job!;
  const worker = s.workers.find((w) => w.role === 'builder')!,
    operator = s.workers.find((w) => w.role === 'operator')!;
  Object.assign(job, {
    status: 'doing',
    phase: 'Collect material',
    worker: worker.id,
    operator: operator.id,
    equipment: e.id,
    preferredEquipment: e.id,
    stack: source.id,
  });
  source.reserved = 1;
  Object.assign(e, { job: job.id, operator: operator.id });
  Object.assign(operator, { vehicle: e.id, job: job.id, x: e.x, z: e.z });
  worker.job = job.id;
  return { s, e, source, next, job, worker, operator, obstructions };
}

test('an already assigned crew changes only its unlifted reservation to accessible same-kind stock and physically installs it', () => {
  const { s, e, source, next, job, worker, operator } = obstructedFixture();
  tickUntil(s, () => !!job.railWork?.source, 30);
  assert.equal(job.railWork!.source!.stackId, next!.id);
  assert.equal(source.reserved, 0);
  assert.equal(source.qty, 1);
  assert.equal(next!.reserved, 1);
  assert.equal(job.equipment, e.id);
  assert.equal(job.worker, worker.id);
  assert.equal(job.operator, operator.id);
  assert.equal(job.preferredEquipment, e.id);
  assert(
    s.events.some((event) => event.text.includes(`from ${source.id} to accessible ${next!.id}`)),
  );
  Object.assign(s, S.load(S.save(s)));
  tickUntil(
    s,
    () => s.jobs.find((j) => j.id === job.id)!.status === 'done',
    1800,
    () => {
      assert.equal(
        S.totals(s, 'rail').stored + S.totals(s, 'rail').cargo + S.totals(s, 'rail').installed,
        2,
      );
      for (const equipment of s.equipment)
        for (const pile of s.stacks.filter((t) => t.qty > 0))
          assert(
            !boxOverlap(equipmentBoxes(equipment)[0], {
              x: pile.x + pile.w / 2,
              z: pile.z + pile.d / 2,
              length: pile.w,
              width: pile.d,
              yaw: 0,
            }),
          );
    },
  );
  assert.equal(s.stacks.find((t) => t.id === source.id)!.qty, 1);
  assert.equal(S.totals(s, 'rail').installed, 1);
  S.load(S.save(s));
});

test('an enclosed source retains its stock, names the blockers, throttles retries and emits one warning', () => {
  const { s, job, source, obstructions } = obstructedFixture(false);
  S.tick(s, 0.1);
  assert(!job.railWork);
  assert(job.reason.includes(source.id));
  assert(
    obstructions.some((pile) => job.reason.includes(pile.id)),
    job.reason,
  );
  assert.equal(source.reserved, 1);
  assert.equal(source.qty, 1);
  assert(job.retryAt! > s.elapsed);
  for (let i = 0; i < 100; i++) S.tick(s, 0.1);
  assert.equal(
    s.events.filter((event) => event.entity === job.id && event.severity === 'warning').length,
    1,
  );
  assert.equal(
    s.notices.filter((notice) => notice.entity === job.id && notice.title === 'Rail pickup blocked')
      .length,
    1,
  );
  assert.equal(source.qty, 1);
  S.load(S.save(s));
  const accessible = stock(s, 'rail', 50, 45);
  s.revision++;
  tickUntil(s, () => !!s.jobs.find((j) => j.id === job.id)?.railWork?.source, 3);
  assert.equal(s.jobs.find((j) => j.id === job.id)?.railWork?.source?.stackId, accessible.id);
  assert.equal(source.reserved, 0);
  assert.equal(
    s.notices.find((notice) => notice.entity === job.id && notice.title === 'Rail pickup blocked')!
      .state,
    'done',
  );
  assert.equal(
    s.events.filter((event) => event.entity === job.id && event.severity === 'warning').length,
    1,
  );
  S.load(S.save(s));
});
