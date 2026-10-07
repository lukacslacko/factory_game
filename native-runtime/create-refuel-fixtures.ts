/** Public QA states from real simulation steps; never reads a player's save. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources } from '../tests/support/yard';
import { renderState } from './render';
const directory=path.resolve(import.meta.dirname,'../native/tests/fixtures');
const catalog=JSON.parse(fs.readFileSync(path.resolve(directory,'../renderer-fixtures.json'),'utf8')).empty.catalog;
const phases=new Set<string>();
const s=S.createState(),e=seedHandlingResources(s,'excavator');e.fuel=20;
s.name='Public fuel-service QA yard';
s.stacks.push({id:S.id(s,'stack'),item:'diesel',qty:1,reserved:0,liters:200,x:32,z:30,w:1,d:1,source:'synthetic opening QA asset'});
assert.equal(S.refuel(s,e.id),'');
for(let i=0;i<4000&&s.jobs[0].status!=='done';i++) {
  S.tick(s,.1);const j=s.jobs[0],w=s.workers.find(w=>w.id===j.worker);
  let name:string|undefined;
  if(j.phase==='Drive to diesel barrel'&&e.x>14)name='refuel-driving';
  if(j.phase==='Fill service can'&&j.elapsed>1)name='refuel-filling';
  if(j.phase==='Carry fuel'&&w?.path.length&&j.fuelLiters)name='refuel-carrying';
  if(j.phase==='Carry fuel'&&(j.fuelWork?.canDelivered||0)>2)name='refuel-pouring';
  if(name&&!phases.has(name)) {
    const state=S.load(S.save({...s,paused:true}));
    fs.writeFileSync(path.join(directory,name+'.save.json'),S.save(state));
    fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify({state,catalog,render:renderState(state)})+'\n');
    phases.add(name);
  }
}
assert.equal(s.jobs[0].status,'done');assert.equal(phases.size,4);
console.log(JSON.stringify({fixtures:[...phases],finished:s.jobs[0].status,fuel:e.fuel,used:e.used}));
