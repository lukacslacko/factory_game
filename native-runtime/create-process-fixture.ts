/** Public, synthetic example only. Does not read the user's save directory. */
import fs from 'node:fs';
import * as S from '../src/sim';
import { createProcessYard } from '../tests/support/process';
import { renderState } from './render';
import { processRows } from '../src/process-fluids';
import { MATERIALS, BUILDINGS, EQUIPMENT, ROLES, SERVICES } from '../src/catalog';
const f=createProcessYard({liters:20000,running:true});
for(let i=0;i<30000;i++) S.tick(f.s,.1);
f.s.paused=true;f.s.name='First fluid transfer';
for(const notice of f.s.notices) notice.seen=true;
const json=S.save(f.s);S.load(json);
fs.writeFileSync('examples/first-fluid-transfer.json',json+'\n');
fs.writeFileSync('native/tests/fixtures/process-fluid-system.json',JSON.stringify({state:f.s,process:processRows(f.s),catalog:{materials:MATERIALS,buildings:BUILDINGS,equipment:EQUIPMENT,roles:ROLES,services:SERVICES},render:renderState(f.s),storage:{started:true,hasSave:true},inventory:[],workRows:[]})+'\n');
console.log(JSON.stringify({pumpId:f.pump.id,tankId:f.tank.id,carId:f.car.id,liters:f.s.process!.tanks[0].liters,source:f.car.tank!.liters}));
