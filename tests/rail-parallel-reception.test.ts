import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { commissionExit, commissionAccess, prepareAccessSteel } from './support/rail';
import { railReceptionPlan, railFreightCarPose, requestRailUnloading } from '../src/rail-freight';
import { railMovementConflict, detachRailFreight, requestEmptyReturn } from '../src/rail-operations';
import { railRoute } from '../src/rail-routing';
import { nearestRailLocationAnchor, saveRailLocation } from '../src/rail-locations';
import { tickUntil, seedHandlingResources } from './support/yard';
import type { RailMove } from '../src/types';
function parallelYard() {
  const s=S.createState();s.creative=true;
  assert.equal(S.addZone(s,{x:150,z:80,w:18,d:18}),'');
  commissionAccess(s,30);
  for(let x=50;x<100;x+=5) assert.equal(S.planRailLayout(s,'straight',{x,z:10}).error,'');
  prepareAccessSteel(s,100);
  assert.equal(S.planRailLayout(s,'turnout',{x:100,z:5},0,1,'converging').error,'');
  assert.equal(S.releaseRailPossession(s,s.railPossessions!.at(-1)!.id),undefined);
  commissionExit(s);
  for(const [z,name] of [[5,'Reception A'],[10,'Reception B']] as const) {
    const a=nearestRailLocationAnchor(s,{x:75,z})!;
    assert.ok(a);
    assert.equal(saveRailLocation(s,{name,kind:'unloading',trackId:a.trackId,route:a.route,offset:a.offset,length:40}),undefined);
  }
  return s;
}
test('two named parallel reception tracks retain separate supplier trains while shared approach is queued and survives reload',()=>{
  let s=parallelYard();
  for(const l of s.railLocations!) S.purchaseBatch(s,[{item:'slab',qty:4}],'rail',{railLocationId:l.id});
  let [a,b]=s.orders;
  a.eta=b.eta=s.time;
  S.tick(s,.1);
  assert.equal(a.status,'approaching');assert.equal(b.status,'ordered');assert.match(b.note,/queued|reserved/);
  s=S.load(S.save(s));[a,b]=s.orders;
  tickUntil(s,()=>a.status==='unloading'&&b.status==='unloading',900);
  assert.ok(Math.abs(railFreightCarPose(a,0).z-5)<.01);
  assert.ok(Math.abs(railFreightCarPose(b,0).z-10)<.01);
  assert.notEqual(a.railFreight!.cars[0].locationId,b.railFreight!.cars[0].locationId);
  assert.equal(detachRailFreight(s,a.id),undefined);
  tickUntil(s,()=>a.railFreight!.locomotivePhase==='gone',900);
  assert.equal(detachRailFreight(s,b.id),undefined);
  tickUntil(s,()=>b.railFreight!.locomotivePhase==='gone',900);
  assert.equal(a.status,'unloading');assert.equal(b.status,'unloading');
  assert.doesNotThrow(()=>S.load(S.save(s)));
});
test('disjoint five-meter parallel movement corridors proceed, shared turnout and fouling bodies reserve',()=>{
  const s=parallelYard();
  // Direct local anchors on single panels avoid junction traversal; full body clearance remains reserved.
  const source=s.rails.find(r=>r.track?.layout==='straight'&&r.track.origin.x===65&&r.track.origin.z===10)!;
  const r=railRoute(s,{trackId:source.id,route:'straight',offset:1},{trackId:source.id,route:'straight',offset:4})!;
  const m:RailMove={...r,distance:0,end:r.length,velocity:0,clock:0};
  s.railReturns=[{id:'RETURN-9001',locomotiveId:'LOCO-9002',orderIds:[],carIds:[],phase:'collecting',status:'test',x:66,z:10,yaw:0,movement:m,departure:m,clock:0}];
  const original=railRoute(s,{trackId:'BOOTSTRAP-SIDING',route:'straight',offset:41},{trackId:'BOOTSTRAP-SIDING',route:'straight',offset:44})!;
  assert.equal(railMovementConflict(s,[{...original,distance:0,end:original.length,velocity:0,clock:0}]),undefined);
  assert.equal(railMovementConflict(s,[m]),'RETURN-9001');
  const foul={...m,points:m.points.map(p=>({...p,z:p.z-2})),tracks:['OTHER']};
  assert.equal(railMovementConflict(s,[foul]),'RETURN-9001');
});

test('an attached supplier train leaves a named factory reception track physically after unloading, with reload during departure',()=>{
 let s=parallelYard();assert.equal(S.addZone(s,{x:55,z:28,w:14,d:14}),'');seedHandlingResources(s,'forklift');
 const point=s.railLocations!.find(l=>l.name==='Reception B')!;
 S.purchaseBatch(s,[{item:'slab',qty:4}],'rail',{railLocationId:point.id,storageZoneId:s.zones.at(-1)!.id});
 let o=s.orders[0];tickUntil(s,()=>o.status==='unloading',1200);
 assert.equal(requestRailUnloading(s,o.id),undefined);tickUntil(s,()=>o.status==='departing'&&!!o.railFreight!.movement,1800);
 assert.equal(o.railFreight!.departureReverse,false);
 s=S.load(S.save(s));o=s.orders[0];let previous={...o.vehicle};
 tickUntil(s,()=>o.status==='done',1800,()=>{assert.ok(Math.hypot(o.vehicle.x-previous.x,o.vehicle.z-previous.z)<.7);previous={...o.vehicle};});
 assert.ok(o.railFreight!.cars.every(c=>c.returned));assert.equal(o.arrived,4);assert.equal(o.railFreight!.movement,undefined);assert.doesNotThrow(()=>S.load(S.save(s)));
});

test('empty pickup collects from a connected named parallel reception track instead of requiring original siding',()=>{
 const s=parallelYard(),point=s.railLocations!.find(l=>l.name==='Reception B')!;
 S.purchaseBatch(s,[{item:'slab',qty:4}],'rail',{railLocationId:point.id});const o=s.orders[0];
 tickUntil(s,()=>o.status==='unloading',1200);assert.equal(detachRailFreight(s,o.id),undefined);tickUntil(s,()=>o.railFreight!.locomotivePhase==='gone',1200);
 // Isolate pickup geometry from the separate site-handling scenario above with a balanced empty cargo ledger.
 o.arrived=o.qty;o.manifest!.forEach(l=>l.arrived=l.qty);o.railFreight!.cars.forEach(c=>c.manifest.forEach(l=>l.arrived=l.qty));
 assert.equal(requestEmptyReturn(s,{orderIds:[o.id],railLocationId:point.id}).error,undefined);
 tickUntil(s,()=>o.status==='done',1800);assert.ok(o.railFreight!.cars.every(c=>c.returned));assert.doesNotThrow(()=>S.load(S.save(s)));
});
