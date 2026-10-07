import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { planProcessPipeRun } from '../src/process-planning';
import { workLeaves, setJobEquipment } from '../src/jobs';
import { seedHandlingResources } from './support/yard';
import { processNetworkRoute, processPorts } from '../src/process-fluids';
test('dragged pipe run follows one grid axis and is assigned as one complete work order',()=>{
  const s=S.createState(), e=seedHandlingResources(s,'excavator');
  const result=planProcessPipeRun(s,{x:30,z:30},{x:35,z:32});
  assert.equal(result.error,undefined);assert.equal(result.count,6);assert.ok(result.workId);
  const leaves=workLeaves(s,result.workId!);assert.equal(leaves.length,6);assert.ok(leaves.every(j=>j.kind==='processPipe'&&j.z===30&&j.rotation===0));
  assert.equal(setJobEquipment(s,result.workId!,e.id),'');
  S.load(S.save(s));
});
test('a blocked or oversized run is rejected atomically',()=>{
  const s=S.createState();S.plan(s,'office',35,30);const before=S.save(s);
  for(const to of [{x:40,z:30},{x:250,z:30}]){assert.ok(planProcessPipeRun(s,{x:30,z:30},to).error);assert.equal(S.save(s),before);}
  assert.ok(planProcessPipeRun(s,{x:30.5,z:30},{x:30,z:30}).error);assert.equal(S.save(s),before);
});
test('creative pipe runs connect real opposing ports; an unfinished run cannot conduct fluid',()=>{
  const s=S.createState();s.creative=true;
  assert.equal(S.plan(s,'transferPump',30,30).error,'');const pump=s.buildings.at(-1)!;
  assert.equal(S.plan(s,'processTank',36,28).error,'');const tank=s.buildings.at(-1)!;
  assert.equal(planProcessPipeRun(s,{x:32,z:30},{x:35,z:30}).count,4);
  assert.equal(processNetworkRoute(s,pump.id,tank.id)?.length,6);
  assert.equal(processPorts(tank)[0].x,36);assert.equal(processPorts(tank)[0].z,30.5);
  const partial=S.createState();partial.creative=true;S.plan(partial,'transferPump',30,30);const p=partial.buildings.at(-1)!;S.plan(partial,'processTank',36,28);const t=partial.buildings.at(-1)!;partial.creative=false;
  planProcessPipeRun(partial,{x:32,z:30},{x:35,z:30});assert.equal(processNetworkRoute(partial,p.id,t.id),undefined);
  S.load(S.save(s));
});
