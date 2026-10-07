import type { State, Worker, RailShunter, Point } from './types';
import { localPoint } from './motion';
import { walkRoute, staticObstacleRects } from './traffic';
import { shiftIsActive } from './workforce';

export const isRailQualified = (w: Worker | undefined): w is Worker & ({ role: 'railDriver' } | { role: 'operator'; railQualified: true }) =>
  !!w && (w.role === 'railDriver' || (w.role === 'operator' && w.railQualified === true));

/** A recorded license verification, rather than silently qualifying all machine operators. */
export function verifyRailQualification(s: State, workerId: string): string | undefined {
  const w = s.workers.find(w => w.id === workerId);
  if (!w || !['operator', 'railDriver'].includes(w.role)) return 'Choose a railway driver or equipment operator with a railway license.';
  if (isRailQualified(w)) return 'This worker already has a recorded railway qualification.';
  if (w.job || w.vehicle || w.deliveryOrder || w.railAssignment || w.transportOrder) return 'Finish the current assignment before verifying a railway license.';
  w.railQualified = true;
  s.costs.push({id: next(s, 'COST'), time: s.time, category: 'Railway', entity: w.id, description: 'Railway license verification and site authorization', amount: 180});
  record(s,w.id,'Railway license verified; authorized to drive owned shunters.');
}
const next = (s: State, p: string) => `${p}-${String(s.next++).padStart(4,'0')}`;
function record(s: State, entity: string, text: string) {
  s.events.push({id: next(s,'EV'), time:s.time,type:'Railway',entity,text}); s.revision++;
}
function barrelFoot(s: State, e: RailShunter, point: Point): Point | undefined {
  const t=s.stacks.find(t=>t.id===e.refueling?.barrelId);
  if(!t)return;
  const choices=[{x:t.x-.65,z:t.z+t.d/2},{x:t.x+t.w+.65,z:t.z+t.d/2},{x:t.x+t.w/2,z:t.z-.65},{x:t.x+t.w/2,z:t.z+t.d+.65}];
  return choices.sort((a,b)=>Math.hypot(a.x-point.x,a.z-point.z)-Math.hypot(b.x-point.x,b.z-point.z)).find(p=>walkRoute(s,point,p,staticObstacleRects(s))!==null);
}
export function beginShunterRefueling(s: State, shunterId: string): string | undefined {
  const e=s.shunters?.find(e=>e.id===shunterId), w=s.workers.find(w=>w.id===e?.driverId);
  if(!e || e.phase!=='parked' || e.carIds?.length) return 'Stop and uncouple the shunter before refueling.';
  if(e.refueling)return 'Refueling is already in progress.';
  if(!isRailQualified(w))return 'Assign a qualified railway driver before refueling.';
  if(!shiftIsActive(s,w!) || w!.duty==='rest' || w!.job || w!.deliveryOrder || w!.transportOrder || w!.commuteOrder || w!.parkingEquipment || w!.yieldingTo ||
    (w!.shiftPhase && w!.shiftPhase!=='working') || (w!.railAssignment && w!.railAssignment!==e.id) ||
    (w!.vehicle && w!.vehicle!==e.id))return 'The assigned driver must be available and on duty.';
  if(e.fuel>=e.tank-0.01)return 'The fuel tank is already full.';
  const barrel=s.stacks.filter(t=>t.item==='diesel' && (t.liters||0)>0 && Math.hypot(t.x+t.w/2-e.x,t.z+t.d/2-e.z)<=8 && !s.shunters?.some(q=>q.refueling?.barrelId===t.id) && !s.jobs.some(j=>j.kind==='refuel' && j.status!=='done' && j.stack===t.id)).sort((a,b)=>Math.hypot(a.x-e.x,a.z-e.z)-Math.hypot(b.x-e.x,b.z-e.z))[0];
  if(!barrel)return 'Park within 8 m of an available diesel barrel before refueling.';
  const aboard=w!.vehicle===e.id;
  e.refueling={barrelId:barrel.id,workerId:w!.id,phase:aboard?'alighting':'approach-engine',clock:0,carried:0,delivered:0};
  if(!barrelFoot(s,e,localPoint(e,0,2))){e.refueling=undefined;return 'No accessible side of the fuel barrel. Clear a walking route.';}
  w!.path=[];
  if(aboard){w!.vehicle=undefined;w!.y=1.65;Object.assign(w!,localPoint(e,0,2));}
  w!.railAssignment=e.id;
  e.driverPhase=undefined; e.status=`Refueling · ${w!.id} walking to ${barrel.id}`;
  record(s,e.id,`Driver ${w!.id} began can refueling from ${barrel.id}; locomotive secured.`);
}
function go(s: State,e: RailShunter,w: Worker,target: Point|undefined): boolean {
  const f=e.refueling!;
  if(target && Math.hypot(w.x-target.x,w.z-target.z)<.4){w.path=[];f.blockedSince=undefined;f.warned=false;f.retryAt=undefined;return true;}
  if(target && (!w.path.length || w.blockedBy) && s.elapsed>=(f.retryAt||0)){w.path=walkRoute(s,w,target,staticObstacleRects(s))||[];f.retryAt=s.elapsed+2;}
  if(!target || !w.path.length || w.blockedBy){f.blockedSince??=s.elapsed;if(s.elapsed-f.blockedSince>15 && !f.warned){f.warned=true;s.notices.unshift({id:next(s,'N'),time:s.time,title:'Shunter refueling blocked',detail:`${e.id}: clear a walking route between ${f.barrelId} and the fuel filler. ${f.carried.toFixed(1)} L remains accounted in the can.`,entity:e.id,state:'todo',seen:false});}e.status='Refueling · waiting for a clear walking route';}
  return false;
}
function atWorkPosition(s: State, e: RailShunter, w: Worker, target: Point | undefined) {
  // Honor an accepted traffic escape before requesting a route back. A can
  // never fills or pours simply because its worker was nearby on an earlier tick.
  const escape = w.path.at(-1);
  if (w.yieldingTo || (escape && target && Math.hypot(escape.x-target.x, escape.z-target.z) > 0.5)) {
    e.status='Refueling · driver clearing traffic before resuming'; return false;
  }
  return go(s,e,w,target);
}
/** Fuel is removed only when a physical can is filled, then poured gradually at the filler. */
export function tickShunterRefueling(s: State,e: RailShunter,dt: number): boolean {
  const f=e.refueling;if(!f)return false;
  const w=s.workers.find(w=>w.id===f.workerId),barrel=s.stacks.find(t=>t.id===f.barrelId);
  if(!w || !barrel){e.status='Refueling blocked · missing driver or barrel';return true;}
  w.railAssignment=e.id;w.status=`${f.phase} · refuel ${e.id}`;
  const engineFoot=localPoint(e,1.8,2);
  if(f.phase==='approach-engine'){
    if(!go(s,e,w,localPoint(e,0,2)))return true;
    f.phase='to-barrel';f.clock=0;
  } else if(f.phase==='alighting'){
    f.clock+=dt;w.y=Math.max(0,1.65*(1-f.clock/2));e.status='Refueling · driver alighting';
    if(f.clock<2)return true;
    f.phase='to-barrel';f.clock=0;
  } else if(f.phase==='to-barrel' || f.phase==='return'){
    const foot=barrelFoot(s,e,w);
    if(!go(s,e,w,foot))return true;
    if(e.fuel>=e.tank-.001 || (barrel.liters||0)<.001){
      record(s,e.id,`Refueling complete: ${f.delivered.toFixed(1)} L from ${barrel.id}, carried by ${w.id}.`);
      e.refueling=undefined;w.railAssignment=undefined;w.status='Available';e.status=e.manualControl?'Manual control · stopped':'Parked · automatic shunting available';return true;
    }
    f.phase='fill-can';f.clock=0;
  } else if(f.phase==='fill-can'){
    if(!atWorkPosition(s,e,w,barrelFoot(s,e,w))){f.clock=0;return true;}
    f.clock+=dt;e.status=`Refueling · filling can at ${barrel.id}`;
    if(f.clock<4)return true;
    f.carried=Math.min(20,e.tank-e.fuel,barrel.liters||0);barrel.liters=(barrel.liters||0)-f.carried;
    s.movements.push({id:next(s,'MV'),time:s.time,item:'diesel',qty:f.carried,from:barrel.id,to:e.id+'/CAN',reason:'Diesel collected in refueling can (liters)'});
    f.phase='to-engine';f.clock=0;s.revision++;
  } else if(f.phase==='to-engine'){
    if(!go(s,e,w,engineFoot))return true;f.phase='pour';f.clock=0;
  } else if(f.phase==='pour'){
    if(!atWorkPosition(s,e,w,engineFoot))return true;
    const liters=Math.min(f.carried,e.tank-e.fuel,dt*1.5);f.carried-=liters;f.delivered+=liters;f.clock+=liters;e.fuel+=liters;e.status=`Refueling · pouring ${f.delivered.toFixed(1)} L`;
    if(f.carried<.0001){s.movements.push({id:next(s,'MV'),time:s.time,item:'diesel',qty:f.clock,from:e.id+'/CAN',to:e.id,reason:'Diesel poured into shunter (liters)'});f.carried=0;f.phase='return';f.clock=0;}s.revision++;
  }
  return true;
}
