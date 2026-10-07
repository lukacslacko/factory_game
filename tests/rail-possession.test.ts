import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { railRoute } from '../src/rail-routing';
import { railReceptionPlan } from '../src/rail-freight';
import { seedHandlingResources,tickUntil } from './support/yard';
const main=(x:number)=>({trackId:'BOOTSTRAP-MAINLINE',route:'straight' as const,offset:x+260});
test('explicit mainline possession preserves inherited steel until physical recovery and conserves all four panel identities',()=>{
  const s=S.createState();S.addZone(s,{x:130,z:40,w:18,d:18});
  assert.match(S.planMainlineExit(s).error,/possession/);
  assert.equal(S.prepareMainlineExit(s),undefined);
  const p=s.railPossessions![0],original=p.assetIds.slice();
  assert.equal(s.rails.length,4);assert.equal(s.stacks.length,0);
  assert.ok(railRoute(s,main(120),main(150))?.tracks.some(id=>original.includes(id)),'Visible steel remains real until lifted');
  S.purchaseBatch(s,[{item:'slab',qty:1}],'rail');
  assert.match(railReceptionPlan(s,s.orders[0]).error!,/possession/);
  assert.match(S.releaseRailPossession(s,p.id)!,/Recover/);
  const e=seedHandlingResources(s,'excavator');e.x=120;e.z=18;
  s.workers.forEach((w,i)=>{w.x=116+i;w.z=18;});
  for(const id of original) assert.equal(S.removeRailInfrastructure(s,id),'');
  assert.equal(s.rails.length,4,'Recovery orders cannot instantly delete real steel');
  tickUntil(s,()=>original.every(id=>s.jobs.some(j=>j.railRecovery?.railId===id&&j.status==='done')),4000);
  assert.equal(s.stacks.filter(t=>t.item==='rail').reduce((n,t)=>n+t.qty,0),4);
  const recovered=s.stacks.flatMap(t=>t.railAssetIds|| (t.assetId?[t.assetId]:[]));
  for(const id of original) assert.ok(recovered.includes(id));
  assert.equal(railRoute(s,main(120),main(150)),undefined);
  assert.match(S.releaseRailPossession(s,p.id)!,/gap|continuous/);
  assert.doesNotThrow(()=>S.load(S.save(s)));
  s.creative=true;
  assert.equal(S.planMainlineExit(s).error,'');
  assert.equal(S.releaseRailPossession(s,p.id),undefined);
  assert.ok(railRoute(s,main(120),main(150)));
  assert.equal(railReceptionPlan(s,s.orders[0]).error,undefined);
});
test('a moving train refuses a work boundary instead of being replaced by inherited steel',()=>{
 const s=S.createState();
 s.shunters=[{id:'SHUNTER-9000',name:'test',x:135,z:0,yaw:0,fuel:100,tank:360,used:0,phase:'parked',status:'Parked',eta:s.time,anchor:main(135)}];
 assert.match(S.prepareMainlineExit(s)!,/SHUNTER-9000/);assert.equal(s.railPossessions,undefined);assert.equal(s.rails.length,0);
});

test('a canceled replacement can restore ordinary straight panels inside its protected work boundary and reopen it',()=>{
 const s=S.createState();s.creative=true;S.addZone(s,{x:150,z:80,w:18,d:18});assert.equal(S.prepareMainlineExit(s),undefined);const p=s.railPossessions![0];
 for(const id of p.assetIds) assert.equal(S.removeRailInfrastructure(s,id),'');
 for(let x=125;x<145;x+=5) assert.equal(S.planRailLayout(s,'straight',{x,z:0}).error,'');
 assert.equal(S.releaseRailPossession(s,p.id),undefined);assert.ok(railRoute(s,main(120),main(150)));
 assert.equal(S.prepareMainlineExit(s),undefined);assert.equal(p.released,false);
 assert.ok(S.planMainlineExit(s).error,'Existing restored rails must still be recovered manually; no automatic replacement');
 assert.ok(S.planRailLayout(s,'straight',{x:145,z:0}).error,'The exception cannot escape the possessed span');
});
