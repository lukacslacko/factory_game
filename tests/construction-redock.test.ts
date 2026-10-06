import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { angleDelta } from '../src/motion.ts';
import { dist } from '../src/path.ts';
import { equipmentSweepBlocked, machineRoute, staticObstacleRects } from '../src/traffic.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';

function carriedSlabWithStaleDock() {
  const s = S.createState(),
    e = seedHandlingResources(s, 'excavator');
  // Keep an operator and a separate construction worker, using a forklift
  // for this narrow reproduction of the larger starter-base encounter.
  Object.assign(e, {
    kind: 'forklift',
    x: 32.5,
    z: 45.4,
    yaw: Math.PI / 2,
    fuel: 45,
    tank: 45,
  });
  s.stacks.push({
    id: S.id(s, 'stack'),
    item: 'slab',
    qty: 1,
    reserved: 0,
    x: 32,
    z: 49,
    w: 1,
    d: 1,
    source: 'opening',
  });
  const j = S.plan(s, 'slab', 59, 36).job!;
  tickUntil(s, () => j.handling?.phase === 'carry', 180);
  const h = j.handling!;
  // The destination was surveyed before another crew completed its stores
  // building. Its old north-side dock now intersects that permanent building.
  h.destinationDock = { x: 59.5, z: 33.5 };
  h.destinationClear = { x: 59.5, z: 32.1 };
  e.path = [];
  s.buildings.push({
    id: S.id(s, 'building'),
    kind: 'store',
    x: 55,
    z: 29,
    w: 6,
    d: 4,
    rotation: 0,
    connected: true,
    name: 'Completed stores building',
    source: 'opening',
  });
  return { s, e, j, oldDock: { ...h.destinationDock } };
}

for (const reload of [false, true])
  test(`a carried slab chooses a new dock after fixed construction blocks its old approach${reload ? ' across save/reload' : ''}`, () => {
    const initial = carriedSlabWithStaleDock();
    const s = reload ? S.load(S.save(initial.s)) : initial.s,
      e = s.equipment.find((q) => q.id === initial.e.id)!,
      j = s.jobs.find((q) => q.id === initial.j.id)!,
      target = { x: j.x + 0.5, z: j.z + 0.5 };
    const originalLoad = { ...j.handling!.pose };
    for (const reverse of [false, true])
      assert.equal(
        machineRoute(s, { ...e, reverse }, initial.oldDock, staticObstacleRects(s), 250, true),
        null,
        'Changing gears cannot reach a dock inside the completed building footprint',
      );
    assert.deepEqual(e.cargo, { item: 'slab', qty: 1, yaw: originalLoad.yaw });
    let redocked = false,
      previous = { ...e },
      previousLoad = { ...j.handling!.pose };
    tickUntil(
      s,
      () => j.status === 'done',
      180,
      () => {
        const h = j.handling!;
        redocked ||= dist(h.destinationDock, initial.oldDock) > 0.5;
        assert.deepEqual({ x: j.x + 0.5, z: j.z + 0.5 }, target);
        assert.equal(
          s.stacks.filter((t) => t.item === 'slab').reduce((n, t) => n + t.qty, 0) +
            (e.cargo?.item === 'slab' ? e.cargo.qty : 0) +
            Number(!!s.paving['59,36']),
          1,
          'Redocking preserves the single source slab through installation',
        );
        assert.ok(
          Math.hypot(
            h.pose.x - previousLoad.x,
            h.pose.z - previousLoad.z,
            h.pose.y - previousLoad.y,
          ) < 0.8,
          'Selecting another dock never teleports the supported slab',
        );
        if (dist(previous, e) > 1e-8 || Math.abs(angleDelta(previous.yaw || 0, e.yaw || 0)) > 1e-8)
          assert.equal(
            equipmentSweepBlocked(s, previous, e),
            '',
            'Travel and alignment keep the complete machine and load clear',
          );
        previous = { ...e };
        previousLoad = { ...h.pose };
      },
    );
    assert.ok(redocked, 'The machine chooses another handling face around the completed building');
    assert.equal(s.paving['59,36'], j.id);
    assert.equal(e.cargo, undefined);
  });
