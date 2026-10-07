import assert from 'node:assert/strict';
import * as S from '../../src/sim';
import type { Building, Point, State } from '../../src/types';
/** Explicit opening utility assets for focused fixtures; circuits use the real planner. */
export function wireOpeningConsumer(
  s: State,
  target: Building,
  source?: Building,
  cells?: Point[],
) {
  if (!source) {
    source = {
      id: S.id(s, 'building'),
      kind: 'power',
      x: target.x - 5,
      z: target.z,
      w: 1,
      d: 1,
      rotation: 0,
      name: 'Opening 16 kW incoming cabinet',
      connected: true,
      source: 'opening',
    };
    s.buildings.push(source);
  }
  s.utilities.power = true;
  cells ??= Array.from({ length: target.x - source.x - 1 }, (_, i) => ({
    x: source!.x + 1 + i,
    z: target.z,
  }));
  const creative = s.creative;
  s.creative = true;
  try {
    const result = S.planElectrical(s, { sourceId: source.id, targetId: target.id, cells });
    assert.equal(result.error, undefined, result.error || 'Circuit should plan');
  } finally {
    s.creative = creative;
  }
  return source;
}
