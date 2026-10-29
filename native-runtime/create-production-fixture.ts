/** Synthetic tutorial yard built through public game commands. Never reads player data. */
import fs from 'node:fs';
import * as S from '../src/sim';
import { createProductionYard } from '../tests/support/production';
import { configureProcessReactor, setProcessReactorRunning } from '../src/process-production';
import { detachRailFreight } from '../src/rail-operations';
import { processRows } from '../src/process-fluids';
import { renderState } from './render';
import { MATERIALS, BUILDINGS, EQUIPMENT, ROLES, SERVICES } from '../src/catalog';
const f = createProductionYard(2000);
configureProcessReactor(f.s, f.reactor.id, { batchSize: 500 });
setProcessReactorRunning(f.s, f.reactor.id, true);
detachRailFreight(f.s, f.order.id);
for (let i = 0; i < 20000; i++) {
  S.tick(f.s, 0.1);
  if (
    f.car.tank!.liters === 0 &&
    f.s.process!.tanks.find((t) => t.id === f.productTank.id)!.liters > 800
  )
    break;
}
f.s.paused = true;
f.s.name = 'First production cycle';
f.s.creative = false;
for (const notice of f.s.notices) notice.seen = true;
const json = S.save(f.s);
S.load(json);
fs.writeFileSync('examples/first-production-cycle.json', json + '\n');
fs.writeFileSync(
  'native/tests/fixtures/production-cycle.json',
  JSON.stringify({
    state: f.s,
    process: processRows(f.s),
    catalog: {
      materials: MATERIALS,
      buildings: BUILDINGS,
      equipment: EQUIPMENT,
      roles: ROLES,
      services: SERVICES,
    },
    render: renderState(f.s),
    storage: { started: true, hasSave: true },
    inventory: [],
    workRows: [],
    productionFixture: {
      reactorId: f.reactor.id,
      inputTankId: f.tank.id,
      outputTankId: f.productTank.id,
      loadingPumpId: f.loadingPump.id,
      unloadingPumpId: f.pump.id,
      carId: f.car.id,
      orderId: f.order.id,
    },
  }) + '\n',
);
console.log(
  JSON.stringify({
    reactor: f.reactor.id,
    storedProduct: f.s.process!.tanks.find((t) => t.id === f.productTank.id)!.liters,
    phase: f.s.process!.reactors![0].phase,
  }),
);
