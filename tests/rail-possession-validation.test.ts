import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { commissionExit, prepareAccessSteel } from './support/rail';
import type { State } from '../src/types';

test('explicit rail possession keeps its inherited asset history through recovery, commissioning and reload', () => {
  let s = S.createState(); s.creative = true;
  assert.equal(S.prepareMainlineExit(s), undefined);
  assert.doesNotThrow(() => S.load(S.save(s)));
  S.addZone(s, { x: 150, z: 80, w: 18, d: 18 });
  const ids = [...s.railPossessions![0].assetIds];
  for (const id of ids) assert.equal(S.removeRailInfrastructure(s, id), '');
  assert.ok(ids.every(id => s.stacks.some(t => t.railAssetIds?.includes(id))));
  assert.doesNotThrow(() => S.load(S.save(s)));
  assert.equal(S.planMainlineExit(s).error, '');
  assert.equal(S.releaseRailPossession(s, s.railPossessions![0].id), undefined);
  s = S.load(S.save(s));
  assert.equal(s.railPossessions![0].released, true);
  assert.deepEqual(s.railPossessions![0].assetIds, ids);
});
test('rail possession imports reject forged boundaries, overlapping work, missing history and invalid release flags', () => {
  const s = S.createState(); s.creative = true; commissionExit(s); prepareAccessSteel(s, 30);
  const saved = S.save(s);
  for (const change of [
    (q: State) => q.railPossessions = {} as any,
    (q: State) => q.railPossessions![0].to += 1,
    (q: State) => q.railPossessions![0].z = 5,
    (q: State) => q.railPossessions![0].released = 'yes' as any,
    (q: State) => q.railPossessions![0].assetIds[0] = 'RAIL-999999',
    (q: State) => q.railPossessions![0].assetIds[1] = q.railPossessions![0].assetIds[0],
    (q: State) => q.railPossessions!.push({ ...q.railPossessions![1], id: 'POSSESSION-999999' }),
  ]) {
    const q = JSON.parse(saved); change(q);
    assert.throws(() => S.load(JSON.stringify(q)), /Invalid save/);
  }
});
