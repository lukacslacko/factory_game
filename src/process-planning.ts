/** Atomic, grouped placement of a continuous cardinal DN100 pipe run. */
import type { Point, State } from './types';
import * as Sim from './sim';
import { createJobGroup } from './jobs';
export function planProcessPipeRun(s: State, from: Point, to: Point, rotation = 0): { count?: number; workId?: string; error?: string } {
  if (![from.x,from.z,to.x,to.z,rotation].every(Number.isInteger)) return {error:'Pipe runs must follow the meter grid.'};
  const dx=to.x-from.x,dz=to.z-from.z;
  const vertical=dx===0&&dz===0 ? rotation%2===1 : Math.abs(dz)>Math.abs(dx);
  const end=vertical ? {x:from.x,z:to.z} : {x:to.x,z:from.z};
  const length=Math.abs(end.x-from.x)+Math.abs(end.z-from.z)+1;
  if(length>200) return {error:'Plan at most 200 meters of pipe in one run.'};
  const cells=Array.from({length},(_,n)=>({x:from.x+(vertical?0:Math.sign(dx)*n),z:from.z+(vertical?Math.sign(dz)*n:0)}));
  // Preflight on a snapshot so a blocked cell never leaves a half-created order.
  const trial=Sim.load(Sim.save(s));
  for(const p of cells) {const result=Sim.plan(trial,'processPipe',p.x,p.z,vertical?1:0,true);if(result.error)return {error:result.error};}
  const before=new Set((s.jobGroups||[]).map(g=>g.id));
  const ids=new Set(s.jobs.map(j=>j.id));
  for(const p of cells) Sim.plan(s,'processPipe',p.x,p.z,vertical?1:0,true);
  if(s.creative)return {count:length};
  const group=createJobGroup(s,`Build DN100 pipe run · ${length} m`,{x:Math.min(from.x,end.x),z:Math.min(from.z,end.z),w:vertical?1:length,d:vertical?length:1});
  for(const g of s.jobGroups||[])if(g.id!==group.id&&!before.has(g.id)&&!g.parentId)g.parentId=group.id;
  for(const j of s.jobs)if(!ids.has(j.id)&&!j.parentId)j.parentId=group.id;
  s.revision++;
  return {count:length,workId:group.id};
}
