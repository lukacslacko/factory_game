import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { driveShunter,releaseShunterControl,parkShunter } from '../src/rail-operations';
import { seedHandlingResources,tickUntil } from './support/yard';
test('qualified manual reverse follows the rails without rotating the cab and requires explicit release',()=>{
 const s=S.createState();seedHandlingResources(s);const w=s.workers[0];w.railQualified=true;
 const e={id:'SHUNTER-9000',name:'Test shunter',x:60,z:5,yaw:0,fuel:100,tank:360,used:0,phase:'parked' as const,status:'Parked',eta:s.time,driverId:w.id,anchor:{trackId:'BOOTSTRAP-SIDING',route:'straight' as const,offset:35}};
 s.shunters=[e];
 assert.equal(driveShunter(s,e.id,-5),undefined);
 tickUntil(s,()=>s.shunters![0].phase==='parked',300);
 assert.ok(Math.abs(e.x-55)<.01);assert.ok(Math.abs(e.yaw)<.01);assert.equal(s.shunters![0].manualControl,true);
 assert.match(parkShunter(s,e.id,'unused')!,/manual control/);
 assert.equal(releaseShunterControl(s,e.id),undefined);assert.equal(s.shunters![0].manualControl,false);
 assert.doesNotThrow(()=>S.load(S.save(s)));
});
test('manual movement refuses open ends, buffers, unqualified drivers and occupied swept clearance',()=>{
 const s=S.createState();seedHandlingResources(s);const w=s.workers[0];
 const e={id:'SHUNTER-9000',name:'Test shunter',x:115,z:5,yaw:0,fuel:100,tank:360,used:0,phase:'parked' as const,status:'Parked',eta:s.time,driverId:w.id,anchor:{trackId:'BOOTSTRAP-SIDING',route:'straight' as const,offset:90}};s.shunters=[e];
 assert.match(driveShunter(s,e.id,5)!,/qualified/);w.railQualified=true;
 assert.match(driveShunter(s,e.id,20)!,/buffer|open end/);
 assert.match(driveShunter(s,e.id,9)!,/BUFFER|blocked/);
 assert.equal(e.phase,'parked');
});
