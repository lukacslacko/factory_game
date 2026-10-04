import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim.ts';
import { setWorkerSchedule, shiftIsActive, workerAvailable, setEquipmentParking, clearEquipmentParking } from '../src/workforce.ts';
import { seedHandlingResources, tickUntil } from './support/yard.ts';
import { dist } from '../src/path.ts';

test('legacy always-on workers and overnight schedule boundaries',()=>{
  const s=S.createState(); seedHandlingResources(s); const w=s.workers[0];
  s.time=23*3600; assert.ok(workerAvailable(s,w));
  assert.equal(setWorkerSchedule(s,w.id,22,6),'');
  assert.ok(shiftIsActive(s,w)); s.time=2*3600; assert.ok(shiftIsActive(s,w));
  s.time=6*3600; assert.ok(!shiftIsActive(s,w)); s.time=22*3600; assert.ok(shiftIsActive(s,w));
  assert.match(setWorkerSchedule(s,w.id,8,8),/different/);
  assert.equal(setWorkerSchedule(s,w.id,null),''); assert.ok(workerAvailable(s,w));
});
test('idle equipment is boarded, driven and aligned into its assigned parking bay',()=>{
  const s=S.createState(),e=seedHandlingResources(s),w=s.workers[0];
  assert.equal(setEquipmentParking(s,e.id,15,32,1),'');
  let sawBoarding=false,sawDriving=false;
  tickUntil(s,()=>e.parkingState==='parked',180,()=>{
    sawBoarding ||= !!w.transition; sawDriving ||= e.path.length>0 && w.vehicle===e.id;
  });
  assert.ok(sawBoarding && sawDriving); assert.ok(dist(e,e.parking!)<0.08);
  assert.ok(e.used>0,'Parking movement consumes fuel');
  const loaded=S.load(S.save(s)); assert.equal(loaded.equipment[0].parkingState,'parked');
  assert.equal(clearEquipmentParking(s,e.id),''); assert.equal(e.parking,undefined);
});
test('scheduled worker parks, leaves a cab, walks to actual bus, goes home and returns without creating workers',()=>{
  const s=S.createState(),e=seedHandlingResources(s),w=s.workers[0];
  s.time=16*3600; w.vehicle=e.id; e.operator=w.id; w.x=e.x; w.z=e.z;
  assert.equal(setEquipmentParking(s,e.id,15,32,0),'');
  assert.equal(setWorkerSchedule(s,w.id,8,16),'');
  let parked=false,exited=false,walked=false,boarded=false;
  tickUntil(s,()=>w.shiftPhase==='home',300,()=>{
    parked ||= e.parkingState==='parked'; exited ||= w.transition?.kind==='exit';
    walked ||= w.status==='Walking to shift bus' && w.path.length>0;
    boarded ||= w.shiftPhase==='aboard';
  });
  assert.ok(parked && exited && walked && boarded,JSON.stringify({parked,exited,walked,boarded}));
  assert.equal(w.vehicle,undefined); assert.equal(s.workers.length,1);
  assert.equal(s.orders.filter(o=>o.commute).length,1); assert.equal(s.costs.filter(c=>c.description.includes('Chartered')).length,1);
  const resumed=S.load(S.save(s)); resumed.time=32*3600;
  tickUntil(resumed,()=>resumed.workers[0].shiftPhase==='working' && !resumed.workers[0].transportOrder,180);
  assert.equal(resumed.workers.length,1); assert.ok(workerAvailable(resumed,resumed.workers[0]));
  assert.equal(resumed.orders.filter(o=>o.commute).length,2);
});
test('off-shift workers finish existing jobs and cannot accept new jobs',()=>{
  const s=S.createState();seedHandlingResources(s);const w=s.workers[0];
  w.job='current-operation';s.time=17*3600;setWorkerSchedule(s,w.id,8,16);
  S.tick(s,0.1);assert.equal(w.shiftPhase,'finishing');assert.equal(w.job,'current-operation');
  assert.ok(!workerAvailable(s,w));assert.equal(s.orders.length,0);
});
test('a real carried slab finishes safely at shift end, parking and bus departure resume from saves',()=>{
  let s=S.demoState(); s.jobs=[]; s.equipment=s.equipment.filter(e=>e.kind==='forklift');
  const e=s.equipment[0],first=S.plan(s,'slab',50,45).job!,second=S.plan(s,'slab',51,45).job!;
  tickUntil(s,()=>first.handling?.state==='carried',200);
  s.time=16*3600;
  for(const w of s.workers) assert.equal(setWorkerSchedule(s,w.id,8,16),'');
  S.tick(s,0.1);
  assert.ok(first.operator && !workerAvailable(s,s.workers.find(w=>w.id===first.operator)!));
  assert.equal(setEquipmentParking(s,e.id,45,36,0),'');
  s=S.load(S.save(s));
  const restoredFirst=s.jobs.find(j=>j.id===first.id)!,restoredSecond=s.jobs.find(j=>j.id===second.id)!;
  tickUntil(s,()=>restoredFirst.status==='done',300);
  assert.equal(restoredSecond.status,'todo','Off-shift team never starts another slab');
  tickUntil(s,()=>s.workers.every(w=>w.shiftPhase==='home'),600);
  assert.equal(s.equipment[0].parkingState,'parked');
  assert.equal(s.equipment[0].cargo,undefined);
});
test('outbound climbing and inbound alighting restore actual people and keep charter invoices unique',()=>{
  const start=S.createState();seedHandlingResources(start);start.time=16*3600;
  setWorkerSchedule(start,start.workers[0].id,8,16);
  tickUntil(start,()=>!!start.orders.find(o=>o.commute?.boarding),150);
  const out=S.load(S.save(start));
  tickUntil(out,()=>out.workers[0].shiftPhase==='home',120);
  assert.equal(out.costs.filter(c=>c.description.includes('Chartered')).length,1);
  out.time=32*3600;
  tickUntil(out,()=>!!out.workers[0].transportOrder && out.orders.some(o=>o.commute?.direction==='inbound'),150);
  const incoming=S.load(S.save(out));
  tickUntil(incoming,()=>incoming.orders.filter(o=>o.commute).every(o=>o.status==='done'),150);
  assert.equal(incoming.workers.length,1);assert.equal(incoming.workers[0].shiftPhase,'working');
  assert.equal(incoming.costs.filter(c=>c.description.includes('Chartered')).length,2);
  assert.ok(S.moveWorker(incoming,incoming.workers[0].id,{x:20,z:30})==='');
  incoming.workers[0].shiftPhase='home';
  assert.match(S.moveWorker(incoming,incoming.workers[0].id,{x:20,z:30}),/off shift/);
});
