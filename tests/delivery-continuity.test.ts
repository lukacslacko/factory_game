import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import type { UnloadTask } from '../src/types.ts';
import { angleDelta } from '../src/motion.ts';
import { center, dist } from '../src/path.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';

for (const kind of ['forklift', 'excavator'] as const) {
  test(`${kind} freight slabs arrive above storage continuously before lowering`, () => {
    const s = S.createState();
    S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
    const e = seedHandlingResources(s, kind);
    const [id] = S.purchase(s, 'slab', 8);
    const o = s.orders.find((o) => o.id === id)!;
    let prior: UnloadTask['cargo'];
    let previousPhase: string | undefined;
    let sawLower = false;
    tickUntil(
      s,
      () => o.status === 'done',
      1200,
      () => {
        const t = o.unload;
        if (!t?.cargo) {
          prior = undefined;
          previousPhase = t?.phase;
          return;
        }
        if (prior && previousPhase === 'carry' && t.phase === 'lower') {
          assert.ok(
            dist(prior, t.cargo) < 0.45,
            'Changing to lowering must not snap cargo sideways',
          );
        }
        if (t.phase === 'lower') {
          sawLower = true;
          assert.ok(
            dist(t.cargo, center(t.destination)) < 0.025,
            'Cargo must already be above its real stack',
          );
          assert.ok(
            Math.abs(angleDelta(e.yaw || 0, Math.atan2(t.cargo.z - e.z, t.cargo.x - e.x))) < 0.025,
            'The machine must face the stack before lowering',
          );
        }
        if (prior && previousPhase === 'lower' && t.phase === 'lower')
          assert.ok(dist(prior, t.cargo) < 0.025, 'Lowering cannot slide cargo horizontally');
        prior = { ...t.cargo };
        previousPhase = t.phase;
        const total = S.totals(s, 'slab');
        assert.equal(total.delivered, total.stored + total.cargo + total.installed);
      },
    );
    assert.ok(sawLower);
    assert.equal(S.totals(s, 'slab').stored, 8);
  });
}
