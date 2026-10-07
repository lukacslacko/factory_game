import assert from 'node:assert/strict';
import * as S from '../../src/sim';
import type { State } from '../../src/types';
/** Fixtures explicitly perform the player-directed inherited-steel recovery before construction. */
export function prepareExitSteel(s: State) {
  const creative=s.creative;
  s.creative=true;
  if(!s.zones.some(z=>z.w>=5&&z.d>=2)) assert.equal(S.addZone(s,{x:150,z:80,w:18,d:18}),'');
  assert.equal(S.prepareMainlineExit(s),undefined);
  for(const asset of s.railPossessions!.at(-1)!.assetIds) assert.equal(S.removeRailInfrastructure(s,asset),'');
  s.creative=creative;
}
export function commissionExit(s: State) {
  prepareExitSteel(s);
  const result=S.planMainlineExit(s);
  assert.equal(result.error,'');
  if(s.creative) assert.equal(S.releaseRailPossession(s,s.railPossessions!.at(-1)!.id),undefined);
  return result;
}
export function prepareAccessSteel(s:State,x:number) {
  const creative=s.creative;s.creative=true;
  if(!s.zones.some(z=>z.w>=5&&z.d>=2)) assert.equal(S.addZone(s,{x:150,z:80,w:18,d:18}),'');
  assert.equal(S.prepareSidingAccess(s,x),undefined);
  for(const asset of s.railPossessions!.at(-1)!.assetIds) assert.equal(S.removeRailInfrastructure(s,asset),'');
  s.creative=creative;
}
export function commissionAccess(s:State,x:number) {
  prepareAccessSteel(s,x);
  const result=S.planSidingAccess(s,x);assert.equal(result.error,'');
  if(s.creative) assert.equal(S.releaseRailPossession(s,s.railPossessions!.at(-1)!.id),undefined);
  return result;
}
